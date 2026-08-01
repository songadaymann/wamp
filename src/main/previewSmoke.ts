import Phaser from 'phaser';
import { createDefaultCoursePermissions, createDefaultCourseSnapshot, type CourseRecord } from '../courses/model';
import {
  setActiveCourseDraftSessionRecord,
  setActiveCourseDraftSessionRoomOverride,
} from '../courses/draftSession';
import {
  createDefaultRoomRecord,
  createDefaultRoomSnapshot,
  type RoomRecord,
  type RoomSnapshot,
} from '../persistence/roomModel';
import { markAppReady } from '../ui/appFeedback';

type PreviewSmokeScene = {
  describeState: () => Record<string, unknown>;
  jumpToCoordinates: (coordinates: { x: number; y: number }) => Promise<void> | void;
  playSelectedRoom: () => void;
  returnToWorld: () => void;
  editSelectedRoom: () => void;
  debugSetPlayerPosition?: (options: {
    x?: number;
    y?: number;
    velocityX?: number;
    velocityY?: number;
    bodyEnabled?: boolean;
  }) => Record<string, unknown>;
  debugPrepareTransitionDestination?: (roomId: string) => Record<string, unknown>;
  debugClearTransitionDestinationPreparation?: (roomId: string) => Record<string, unknown>;
  roomSummariesById?: Map<string, { id?: string; coordinates?: { x: number; y: number }; state?: string }>;
  draftRoomsById?: Map<string, { id: string; coordinates: { x: number; y: number } }>;
};

type PreviewSmokeAction =
  | 'selectEditableRoom'
  | 'playSelectedRoom'
  | 'returnToWorld'
  | 'editSelectedRoom'
  | 'openSyntheticEditor'
  | 'openSyntheticCourseEditor'
  | 'setPlayerPosition'
  | 'prepareTransitionDestination'
  | 'clearTransitionDestinationPreparation';

interface PreviewSmokePayload {
  roomId?: string | null;
  x?: number;
  y?: number;
  velocityX?: number;
  velocityY?: number;
  bodyEnabled?: boolean;
}

export function installPreviewSmokeActions(
  game: Phaser.Game,
  getDebugState: () => Record<string, unknown>,
): void {
  window.run_preview_smoke_action = async (action: PreviewSmokeAction, payload?: PreviewSmokePayload) => {
    switch (action) {
      case 'selectEditableRoom':
        return selectEditableRoomForPreviewSmoke(game, payload?.roomId ?? null);
      case 'playSelectedRoom':
        return runOverworldPreviewSmokeAction(
          game,
          getDebugState,
          (scene) => {
            scene.playSelectedRoom();
          },
        );
      case 'returnToWorld':
        return runOverworldPreviewSmokeAction(
          game,
          getDebugState,
          (scene) => {
            scene.returnToWorld();
          },
        );
      case 'editSelectedRoom':
        return runOverworldPreviewSmokeAction(
          game,
          getDebugState,
          (scene) => {
            scene.editSelectedRoom();
          },
          1200,
        );
      case 'openSyntheticEditor':
        return openSyntheticEditorForPreviewSmoke(game, getDebugState);
      case 'openSyntheticCourseEditor':
        return openSyntheticCourseEditorForPreviewSmoke(game, getDebugState);
      case 'setPlayerPosition':
        return runOverworldPreviewSmokeAction(
          game,
          getDebugState,
          (scene) => {
            return scene.debugSetPlayerPosition?.({
              x: payload?.x,
              y: payload?.y,
              velocityX: payload?.velocityX ?? 0,
              velocityY: payload?.velocityY ?? 0,
              bodyEnabled: payload?.bodyEnabled,
            });
          },
          50,
        );
      case 'prepareTransitionDestination':
        return runOverworldPreviewSmokeAction(
          game,
          getDebugState,
          (scene) => {
            if (typeof payload?.roomId !== 'string') {
              return { ok: false, reason: 'room-id-required' };
            }
            return scene.debugPrepareTransitionDestination?.(payload.roomId)
              ?? { ok: false, reason: 'transition-preparation-unavailable' };
          },
          50,
        );
      case 'clearTransitionDestinationPreparation':
        return runOverworldPreviewSmokeAction(
          game,
          getDebugState,
          (scene) => {
            if (typeof payload?.roomId !== 'string') {
              return { ok: false, reason: 'room-id-required' };
            }
            return scene.debugClearTransitionDestinationPreparation?.(payload.roomId)
              ?? { ok: false, reason: 'transition-preparation-unavailable' };
          },
          0,
        );
      default:
        return { ok: false, reason: `unsupported-action:${action}` };
    }
  };
}

async function openSyntheticCourseEditorForPreviewSmoke(
  game: Phaser.Game,
  getDebugState: () => Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const courseEditorScene = game.scene.keys.CourseEditorScene as unknown as {
    roomRepository?: {
      loadRoom: (roomId: string, coordinates: { x: number; y: number }) => Promise<RoomRecord>;
    };
  };
  if (!courseEditorScene?.roomRepository) {
    return { ok: false, reason: 'course-editor-scene-missing' };
  }

  const roomSnapshots = [
    createDefaultRoomSnapshot('99,99', { x: 99, y: 99 }),
    createDefaultRoomSnapshot('100,99', { x: 100, y: 99 }),
  ];
  roomSnapshots[0].title = 'Preview Smoke Left';
  roomSnapshots[0].spawnPoint = { x: 320, y: 176 };
  roomSnapshots[1].title = 'Preview Smoke Right';

  const courseDraft = createDefaultCourseSnapshot('preview-smoke-expanded-room');
  courseDraft.title = 'Preview Smoke Expanded Room';
  courseDraft.roomRefs = roomSnapshots.map((snapshot) => ({
    roomId: snapshot.id,
    coordinates: { ...snapshot.coordinates },
    roomVersion: snapshot.version,
    roomTitle: snapshot.title,
  }));
  const courseRecord: CourseRecord = {
    draft: courseDraft,
    published: null,
    versions: [],
    ownerUserId: null,
    ownerDisplayName: null,
    permissions: createDefaultCoursePermissions(),
    expandedRoomCellLimit: 16,
  };

  setActiveCourseDraftSessionRecord(courseRecord, { selectedRoomId: roomSnapshots[0].id });
  const snapshotsByRoomId = new Map<string, RoomSnapshot>();
  for (const snapshot of roomSnapshots) {
    snapshotsByRoomId.set(snapshot.id, snapshot);
    setActiveCourseDraftSessionRoomOverride(snapshot);
  }

  courseEditorScene.roomRepository.loadRoom = async (roomId, coordinates) => {
    const snapshot = snapshotsByRoomId.get(roomId) ?? createDefaultRoomSnapshot(roomId, coordinates);
    const record = createDefaultRoomRecord(roomId, coordinates);
    record.draft = snapshot;
    return record;
  };

  if (
    game.scene.isActive('CourseEditorScene')
    || game.scene.isSleeping('CourseEditorScene')
    || game.scene.isPaused('CourseEditorScene')
  ) {
    game.scene.stop('CourseEditorScene');
  }
  if (
    game.scene.isActive('CourseComposerScene')
    || game.scene.isSleeping('CourseComposerScene')
    || game.scene.isPaused('CourseComposerScene')
  ) {
    game.scene.stop('CourseComposerScene');
  }

  game.scene.run('CourseComposerScene', { courseId: courseDraft.id });
  await waitForPreviewSmoke(200);
  if (game.scene.isActive('CourseComposerScene')) {
    game.scene.sleep('CourseComposerScene');
  }
  game.scene.run('CourseEditorScene', {
    courseId: courseDraft.id,
    selectedRoomId: roomSnapshots[0].id,
    statusMessage: 'Preview smoke expanded room editor.',
  });
  if (game.scene.isActive('OverworldPlayScene')) {
    game.scene.sleep('OverworldPlayScene');
  }
  markAppReady();
  await waitForPreviewSmoke(1500);

  return {
    ok: true,
    activeScene: getDebugState(),
  };
}

async function selectEditableRoomForPreviewSmoke(
  game: Phaser.Game,
  roomId: string | null,
): Promise<Record<string, unknown>> {
  const scene = getOverworldSceneForPreviewSmoke(game);
  if (!scene) {
    return { ok: false, reason: 'overworld-scene-missing' };
  }

  const requestedCoordinates = parsePreviewSmokeRoomId(roomId);
  const currentState = scene.describeState();
  const currentSelectedCoordinates = currentState.selected as { x: number; y: number } | undefined;
  const currentSelectedState = currentState.selectedState;
  const currentSelectionIsEditable =
    currentSelectedCoordinates
    && (currentSelectedState === 'published' || currentSelectedState === 'draft')
    && requestedCoordinates === null;
  const target =
    currentSelectionIsEditable
      ? {
          roomId: `${currentSelectedCoordinates.x},${currentSelectedCoordinates.y}`,
          coordinates: { ...currentSelectedCoordinates },
          selectedState: currentSelectedState,
        }
      : findEditableRoomCandidate(scene, requestedCoordinates);
  if (!target) {
    return {
      ok: false,
      reason: 'no-editable-room-loaded',
    };
  }

  await scene.jumpToCoordinates(target.coordinates);
  await waitForPreviewSmoke(1200);

  const selectedState = scene.describeState().selectedState;
  return {
    ok: true,
    roomId: target.roomId,
    coordinates: target.coordinates,
    selectedState,
  };
}

async function runOverworldPreviewSmokeAction(
  game: Phaser.Game,
  getDebugState: () => Record<string, unknown>,
  action: (scene: PreviewSmokeScene) => Record<string, unknown> | void,
  waitMs = 900,
): Promise<Record<string, unknown>> {
  const scene = getOverworldSceneForPreviewSmoke(game);
  if (!scene) {
    return { ok: false, reason: 'overworld-scene-missing' };
  }

  const result = action(scene) ?? null;
  await waitForPreviewSmoke(waitMs);
  if (isPreviewSmokeActionFailure(result)) {
    return {
      ok: false,
      reason: typeof result.reason === 'string' ? result.reason : 'preview-action-failed',
      result,
      activeScene: getDebugState(),
    };
  }
  return {
    ok: true,
    result,
    activeScene: getDebugState(),
  };
}

function isPreviewSmokeActionFailure(
  result: Record<string, unknown> | null,
): result is Record<string, unknown> & { ok: false } {
  return Boolean(result && result.ok === false && typeof result.status !== 'string');
}

function getOverworldSceneForPreviewSmoke(game: Phaser.Game): PreviewSmokeScene | null {
  try {
    return game.scene.getScene('OverworldPlayScene') as unknown as PreviewSmokeScene;
  } catch {
    return null;
  }
}

async function openSyntheticEditorForPreviewSmoke(
  game: Phaser.Game,
  getDebugState: () => Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const editorScene = game.scene.keys.EditorScene as unknown as {
    roomSession?: {
      loadPersistedRoom: (initialRoomSnapshot: unknown) => Promise<boolean>;
    };
  };
  if (!editorScene?.roomSession) {
    return { ok: false, reason: 'editor-scene-missing' };
  }

  editorScene.roomSession.loadPersistedRoom = async () => true;

  const roomSnapshot = createDefaultRoomSnapshot('99,99', { x: 99, y: 99 });
  roomSnapshot.background = 'cave';
  roomSnapshot.spawnPoint = { x: 320, y: 176 };
  roomSnapshot.lighting = {
    mode: 'playerAuraDark',
    darkness: 88,
    radius: 24,
  };

  if (
    game.scene.isActive('EditorScene')
    || game.scene.isSleeping('EditorScene')
    || game.scene.isPaused('EditorScene')
  ) {
    game.scene.stop('EditorScene');
  }

  game.scene.run('EditorScene', {
    source: 'direct',
    roomSnapshot,
  });
  if (game.scene.isActive('OverworldPlayScene')) {
    game.scene.sleep('OverworldPlayScene');
  }
  markAppReady();
  await waitForPreviewSmoke(1200);

  return {
    ok: true,
    activeScene: getDebugState(),
  };
}

function findEditableRoomCandidate(
  scene: PreviewSmokeScene,
  requestedCoordinates: { x: number; y: number } | null,
): {
  roomId: string;
  coordinates: { x: number; y: number };
} | null {
  const summaryCandidates = Array.from(scene.roomSummariesById?.values() ?? [])
    .filter((candidate) => candidate.coordinates && (candidate.state === 'published' || candidate.state === 'draft'))
    .map((candidate) => ({
      roomId: candidate.id ?? `${candidate.coordinates!.x},${candidate.coordinates!.y}`,
      coordinates: { ...candidate.coordinates! },
    }));
  const draftCandidates = Array.from(scene.draftRoomsById?.values() ?? []).map((candidate) => ({
    roomId: candidate.id,
    coordinates: { ...candidate.coordinates },
  }));
  const allCandidates = [...summaryCandidates, ...draftCandidates];
  if (requestedCoordinates) {
    return (
      allCandidates.find(
        (candidate) =>
          candidate.coordinates.x === requestedCoordinates.x
          && candidate.coordinates.y === requestedCoordinates.y
      ) ?? null
    );
  }

  return allCandidates[0] ?? null;
}

function parsePreviewSmokeRoomId(value: string | null): { x: number; y: number } | null {
  if (!value || !value.trim()) {
    return null;
  }

  const match = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/.exec(value);
  if (!match) {
    return null;
  }

  return {
    x: Number(match[1]),
    y: Number(match[2]),
  };
}

function waitForPreviewSmoke(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
