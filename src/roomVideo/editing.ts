import { canPlacedObjectTriggerOtherObjects, type PlacedObject } from '../config';
import type { RoomSnapshot } from '../persistence/roomRepository';
import { EditorEditRuntime } from '../scenes/editor/editRuntime';
import { ROOM_VIDEO_LINK_TARGET_ID } from './link';
import {
  createDefaultRoomVideo,
  fetchYouTubeAspectRatio,
  guessYouTubeAspect,
  normalizeRoomVideo,
  parseYouTubeVideoUrl,
  resizeRoomVideoAspect,
  roomVideosEqual,
  type RoomVideo,
} from './model';
import {
  clearRoomVideoState,
  ensureRoomVideoState,
  getActiveRoomVideoRuntime,
  getRoomVideo,
} from './uiState';

export { getActiveRoomVideoRuntime, getRoomVideo, roomVideoUiFields, setActiveRoomVideoRuntime } from './uiState';

interface VideoRuntime {
  guardEditable(): boolean;
  canEditRoom(): boolean;
  roomDirty: boolean;
  lastDirtyAt: number;
  host: {
    canSaveDraft(): boolean;
    updatePersistenceStatus(text: string): void;
    updateGoalUi(): void;
    getPlacedObjects(): PlacedObject[];
    setPlacedObjects(next: PlacedObject[]): void;
  };
  clonePlacedObjects(source?: readonly PlacedObject[]): PlacedObject[];
  rebuildObjectSprites(): void;
  markRoomDirty(): void;
  history: {
    record(entry: {
      kind: 'objects';
      action: { previous: PlacedObject[]; next: PlacedObject[] };
    }): void;
  };
}

let installed = false;

function asRuntime(runtime: object): VideoRuntime {
  return runtime as VideoRuntime;
}

export function setRoomVideo(runtime: object, next: RoomVideo | null, quiet = false): void {
  const host = asRuntime(runtime);
  if (quiet) {
    if (!host.canEditRoom()) return;
  } else if (!host.guardEditable()) {
    return;
  }
  const state = ensureRoomVideoState(runtime);
  const normalized = normalizeRoomVideo(next);
  if (roomVideosEqual(state.video, normalized)) {
    if (!quiet && host.roomDirty) {
      host.host.updatePersistenceStatus(
        host.host.canSaveDraft()
          ? 'Draft changes...'
          : 'This room is read-only. Changes are local only.',
      );
    }
    return;
  }
  state.video = normalized;
  host.roomDirty = true;
  host.lastDirtyAt = performance.now();
  if (!quiet) {
    host.host.updatePersistenceStatus(
      host.host.canSaveDraft()
        ? 'Draft changes...'
        : 'This room is read-only. Changes are local only.',
    );
    host.host.updateGoalUi();
  }
}

export function setRoomVideoUrl(runtime: object, raw: string, commit = true): void {
  const host = asRuntime(runtime);
  if (!host.guardEditable()) return;
  const state = ensureRoomVideoState(runtime);
  const trimmed = raw.trim();
  if (!trimmed) {
    state.error = null;
    setRoomVideo(runtime, null);
    return;
  }
  const parsed = parseYouTubeVideoUrl(trimmed);
  if (!parsed) {
    if (!commit) {
      if (state.error) {
        state.error = null;
        host.host.updateGoalUi();
      }
      return;
    }
    state.error = 'Paste a YouTube link, like https://youtu.be/...';
    host.host.updateGoalUi();
    return;
  }
  state.error = null;
  const aspect = guessYouTubeAspect(parsed.kind);
  const current = state.video;
  if (!current) {
    setRoomVideo(runtime, createDefaultRoomVideo(parsed.id, aspect));
  } else if (current.youtubeId !== parsed.id) {
    setRoomVideo(runtime, resizeRoomVideoAspect({ ...current, youtubeId: parsed.id }, aspect));
  } else {
    host.host.updateGoalUi();
  }
  const youtubeId = parsed.id;
  void fetchYouTubeAspectRatio(parsed).then((nextAspect) => {
    const latest = ensureRoomVideoState(runtime).video;
    if (!nextAspect || latest?.youtubeId !== youtubeId) return;
    if (Math.abs(latest.aspect - nextAspect) < 0.02) return;
    setRoomVideo(runtime, resizeRoomVideoAspect(latest, nextAspect));
  });
}

export function patchRoomVideo(
  runtime: object,
  patch: Partial<Pick<RoomVideo, 'loop' | 'autoplay' | 'trigger' | 'volume' | 'muteMusic' | 'snap'>>,
): void {
  const video = getRoomVideo(runtime);
  if (!video) return;
  setRoomVideo(runtime, { ...video, ...patch });
}

export function clearRoomVideo(runtime: object): void {
  const state = ensureRoomVideoState(runtime);
  state.error = null;
  setRoomVideo(runtime, null);
}

export function linkPressurePlateToRoomVideo(runtime: object, sourceInstanceId: string): boolean {
  if (!getRoomVideo(runtime)?.trigger) return false;
  const host = asRuntime(runtime);
  if (!host.guardEditable()) return false;
  const placedObjects = host.host.getPlacedObjects();
  const sourceIndex = placedObjects.findIndex((placed) => placed.instanceId === sourceInstanceId);
  if (sourceIndex < 0) return false;
  const source = placedObjects[sourceIndex];
  if (!canPlacedObjectTriggerOtherObjects(source)) return false;
  if (source.triggerTargetInstanceId === ROOM_VIDEO_LINK_TARGET_ID) return true;

  const previous = host.clonePlacedObjects();
  const next = previous.map((placed, index) =>
    index === sourceIndex
      ? { ...placed, triggerTargetInstanceId: ROOM_VIDEO_LINK_TARGET_ID, linkedTargetInstanceIds: null }
      : placed,
  );
  host.host.setPlacedObjects(next);
  host.history.record({
    kind: 'objects',
    action: { previous, next: host.clonePlacedObjects(next) },
  });
  host.rebuildObjectSprites();
  host.markRoomDirty();
  return true;
}

export function installRoomVideoEditing(): void {
  if (installed) return;
  installed = true;
  const prototype = EditorEditRuntime.prototype;
  const originalReset = prototype.reset;
  prototype.reset = function resetRoomVideo(this: EditorEditRuntime) {
    originalReset.call(this);
    clearRoomVideoState(this);
  };
  const originalApply = prototype.applyRoomSnapshot;
  prototype.applyRoomSnapshot = function applyRoomVideo(
    this: EditorEditRuntime,
    room: RoomSnapshot,
    resetHistory = true,
  ) {
    originalApply.call(this, room, resetHistory);
    const state = ensureRoomVideoState(this);
    state.video = normalizeRoomVideo(room.video);
    state.error = null;
  };
  const originalExport = prototype.exportRoomSnapshot;
  prototype.exportRoomSnapshot = function exportRoomVideo(this: EditorEditRuntime) {
    const snapshot = originalExport.call(this);
    const video = getRoomVideo(this);
    return video ? { ...snapshot, video: { ...video } } : snapshot;
  };
}

export function bindRoomVideoControls(doc: Document): void {
  const root = doc.documentElement;
  if (root.dataset.roomVideoControls === 'true') return;
  root.dataset.roomVideoControls = 'true';
  const withRuntime = (apply: (runtime: object) => void) => {
    const runtime = getActiveRoomVideoRuntime();
    if (runtime) apply(runtime);
  };
  const urlInput = doc.getElementById('room-video-url');
  if (urlInput instanceof HTMLInputElement) {
    urlInput.addEventListener('change', () => withRuntime((runtime) => setRoomVideoUrl(runtime, urlInput.value, true)));
    urlInput.addEventListener('input', () => withRuntime((runtime) => setRoomVideoUrl(runtime, urlInput.value, false)));
  }
  const bindCheck = (id: string, apply: (runtime: object, enabled: boolean) => void) => {
    const input = doc.getElementById(id);
    if (!(input instanceof HTMLInputElement)) return;
    input.addEventListener('change', () => withRuntime((runtime) => apply(runtime, input.checked)));
  };
  bindCheck('room-video-loop', (runtime, enabled) => patchRoomVideo(runtime, { loop: enabled }));
  bindCheck('room-video-autoplay', (runtime, enabled) => patchRoomVideo(runtime, { autoplay: enabled }));
  bindCheck('room-video-trigger', (runtime, enabled) => patchRoomVideo(runtime, { trigger: enabled }));
  bindCheck('room-video-mute-music', (runtime, enabled) => patchRoomVideo(runtime, { muteMusic: enabled }));
  bindCheck('room-video-snap', (runtime, enabled) => patchRoomVideo(runtime, { snap: enabled }));
  const volumeInput = doc.getElementById('room-video-volume');
  if (volumeInput instanceof HTMLInputElement) {
    volumeInput.addEventListener('input', () => {
      withRuntime((runtime) => patchRoomVideo(runtime, { volume: Number(volumeInput.value) / 100 }));
    });
  }
  const clearButton = doc.getElementById('room-video-clear');
  clearButton?.addEventListener('click', () => withRuntime((runtime) => clearRoomVideo(runtime)));
}
