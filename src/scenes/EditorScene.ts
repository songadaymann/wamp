import Phaser from 'phaser';
import {
  AUTH_STATE_CHANGED_EVENT,
  getAuthDebugState,
  promptForSignIn,
} from '../auth/client';
import {
  TILE_SIZE,
  ROOM_WIDTH,
  ROOM_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_PX_HEIGHT,
  LAYER_NAMES,
  TILESETS,
  editorState,
  getObjectById,
  getPlacedObjectLayer,
  type LayerName,
} from '../config';
import {
  DEFAULT_ROOM_COORDINATES,
  DEFAULT_ROOM_ID,
  cloneRoomSnapshot,
  createRoomRepository,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomPermissions,
  type RoomRecord,
  type RoomSpawnPoint,
  type RoomSnapshot,
  type RoomVersionRecord,
} from '../persistence/roomRepository';
import { createWorldRepository } from '../persistence/worldRepository';
import { roomToChunkCoordinates } from '../persistence/worldModel';
import {
  resolveWorldPresenceConfig,
  resolveWorldPresenceIdentity,
  WorldPresenceClient,
} from '../presence/worldPresence';
import { RETRO_COLORS } from '../visuals/starfield';
import {
  cloneCourseSnapshot,
  createDefaultCourseGoal,
  type CourseGoal,
  type CourseGoalType,
  type CourseMarkerPoint,
  type CourseSnapshot,
} from '../courses/model';
import {
  clearActiveCourseDraftSessionRoomOverride,
  getActiveCourseDraftSessionCourseId,
  getActiveCourseDraftSessionDraft,
  setActiveCourseDraftSessionRoomOverride,
  updateActiveCourseDraftSession,
} from '../courses/draftSession';
import {
  cloneRoomGoal,
  createGoalMarkerPointFromTile,
  goalSupportsTimeLimit,
  type RoomGoal,
  type RoomGoalType,
} from '../goals/roomGoals';
import {
  createGoalMarkerFlagSprite,
  type GoalMarkerFlagVariant,
} from '../goals/markerFlags';
import { setAppMode } from '../ui/appMode';
import {
  hideBusyOverlay,
  showBusyError,
  showBusyOverlay,
} from '../ui/appFeedback';
import { isTextInputFocused } from '../ui/keyboardFocus';
import type {
  CourseEditedRoomData,
  EditorCourseEditData,
  EditorSceneData,
  OverworldPlaySceneData,
} from './sceneData';
import { EditorUiBridge } from './editor/uiBridge';
import { EditorRoomSession } from './editor/roomSession';
import { EditorBackgroundController } from './editor/backgrounds';
import { EditorEditRuntime, type GoalPlacementMode } from './editor/editRuntime';
import { EditorInteractionController } from './editor/interaction';
import type { EditorCourseUiState } from '../ui/setup/sceneBridge';

const EDITOR_NEIGHBOR_RADIUS = 1;
type EditorMarkerPlacementMode = GoalPlacementMode | 'start';

export class EditorScene extends Phaser.Scene {
  private readonly PUBLISH_NUDGE_EDIT_THRESHOLD = 10;
  private uiBridge: EditorUiBridge | null = null;
  private layerIndicatorText: Phaser.GameObjects.Text | null = null;
  private layerGuideGraphics: Phaser.GameObjects.Graphics | null = null;
  private editorPresenceClient: WorldPresenceClient | null = null;
  private courseMarkerSprites: Phaser.GameObjects.Sprite[] = [];
  private courseMarkerLabels: Phaser.GameObjects.Text[] = [];
  private activeCourseMarkerEdit: EditorCourseEditData | null = null;
  private courseGoalPlacementMode: EditorMarkerPlacementMode = null;
  private roomEditCount = 0;
  private publishNudgeTriggered = false;

  // Tilemap
  private map!: Phaser.Tilemaps.Tilemap;
  private tilesets: Map<string, Phaser.Tilemaps.Tileset> = new Map();
  private layers: Map<string, Phaser.Tilemaps.TilemapLayer> = new Map();

  // Graphics overlays
  private gridGraphics!: Phaser.GameObjects.Graphics;
  private borderGraphics!: Phaser.GameObjects.Graphics;

  // Single-room persistence (local-first, ready for a remote adapter later)
  private readonly editRuntime: EditorEditRuntime;
  private readonly roomSession: EditorRoomSession;
  private readonly worldRepository = createWorldRepository();
  private readonly backgroundController: EditorBackgroundController;
  private readonly interactionController: EditorInteractionController;
  private entrySource: 'world' | 'direct' = 'direct';
  private initialRoomSnapshot: RoomSnapshot | null = null;
  private courseEditorStatusText: string | null = null;
  private readonly handleWake = (): void => {
    setAppMode('editor');
    editorState.isPlaying = false;
    this.syncEditorPresence();
    this.updateBottomBar();
    this.updateGoalUi();
  };
  private readonly handleAuthStateChanged = (): void => {
    this.renderEditorUi();
  };
  private readonly handleBackgroundChanged = (): void => {
    this.updateBackground();
    this.markRoomDirty();
    this.renderEditorUi();
  };
  private readonly handleCanvasContextMenu = (event: Event): void => {
    event.preventDefault();
  };
  private readonly handleResize = (): void => {
    this.centerCameraOnRoom();
    this.updateBackgroundPreview();
    this.updateZoomUI();
  };
  private readonly handleDocumentKeyDown = (event: KeyboardEvent): void => {
    if (!this.scene.isActive(this.scene.key) || editorState.isPlaying || isTextInputFocused()) {
      return;
    }

    const key = event.key.toLowerCase();
    const primaryModifier = event.metaKey || event.ctrlKey;
    if (primaryModifier && key === 'z') {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        this.redo();
      } else {
        this.undo();
      }
      return;
    }

    if (event.ctrlKey && !event.metaKey && key === 'y') {
      event.preventDefault();
      event.stopPropagation();
      this.redo();
    }
  };
  private readonly handleShutdown = (): void => {
    window.removeEventListener('background-changed', this.handleBackgroundChanged);
    window.removeEventListener(AUTH_STATE_CHANGED_EVENT, this.handleAuthStateChanged);
    document.removeEventListener('keydown', this.handleDocumentKeyDown);
    this.events.off('wake', this.handleWake, this);
    this.scale.off('resize', this.handleResize, this);
    this.input.removeAllListeners();
    this.input.keyboard?.removeAllListeners();
    this.game.canvas.removeEventListener('contextmenu', this.handleCanvasContextMenu);
    this.uiBridge?.destroy();
    this.uiBridge = null;
    this.layerIndicatorText?.destroy();
    this.layerIndicatorText = null;
    this.editorPresenceClient?.destroy();
    this.editorPresenceClient = null;
    this.destroyCourseMarkerOverlays();
    this.resetRuntimeState();
  };

  constructor() {
    super({ key: 'EditorScene' });
    this.editRuntime = new EditorEditRuntime(this, {
      getLayers: () => this.layers,
      getRoomSnapshotMetadata: () => ({
        roomId: this.roomId,
        coordinates: this.roomCoordinates,
        title: this.roomTitle,
        version: this.roomVersion,
        createdAt: this.roomCreatedAt,
        updatedAt: this.roomUpdatedAt,
        publishedAt: this.roomPublishedAt,
      }),
      updateBackgroundSelectValue: (backgroundId) => {
        const backgroundSelect = document.getElementById('background-select') as HTMLSelectElement | null;
        if (backgroundSelect) {
          backgroundSelect.value = backgroundId;
        }
      },
      updateBackground: () => this.updateBackground(),
      updateGoalUi: () => this.updateGoalUi(),
      syncBackgroundCameraIgnores: () => this.syncBackgroundCameraIgnores(),
      updatePersistenceStatus: (text) => this.updatePersistenceStatus(text),
      canSaveDraft: () => this.roomPermissions.canSaveDraft,
    });
    this.roomSession = new EditorRoomSession(createRoomRepository(), {
      applyRoomSnapshot: (room) => {
        this.applyRoomSnapshot(room);
      },
      exportRoomSnapshot: () => this.exportRoomSnapshot(),
      getRoomDirty: () => this.roomDirty,
      setRoomDirty: (dirty) => {
        this.roomDirty = dirty;
      },
      getLastDirtyAt: () => this.lastDirtyAt,
      refreshUi: () => {
        this.renderEditorUi();
      },
      refreshSurroundingRoomPreviews: () => {
        void this.refreshSurroundingRoomPreviews();
      },
    });
    this.interactionController = new EditorInteractionController(this, {
      getNeighborRadius: () => EDITOR_NEIGHBOR_RADIUS,
      getGoalPlacementMode: () => this.goalPlacementMode as GoalPlacementMode,
      handleObjectPlace: (pointer) => this.handleObjectPlace(pointer),
      handleToolDown: (pointer) => this.handleToolDown(pointer),
      removeGoalMarkerAt: (worldX, worldY) => this.removeGoalMarkerAt(worldX, worldY),
      removeObjectAt: (worldX, worldY) => this.removeObjectAt(worldX, worldY),
      placeGoalMarker: (tileX, tileY) => this.placeGoalMarker(tileX, tileY),
      placeTileAt: (worldX, worldY) => this.placeTileAt(worldX, worldY),
      eraseTileAt: (worldX, worldY) => this.eraseTileAt(worldX, worldY),
      fillRect: (x1, y1, x2, y2) => this.fillRect(x1, y1, x2, y2),
      beginTileBatch: () => this.editRuntime.beginTileBatch(),
      commitTileBatch: () => this.editRuntime.commitTileBatch(),
      startPlayMode: () => this.startPlayMode(),
      updateToolUi: () => this.updateToolUI(),
      updateBackgroundPreview: () => this.updateBackgroundPreview(),
      updateZoomUI: () => this.updateZoomUI(),
    });
    this.backgroundController = new EditorBackgroundController(this, this.worldRepository, {
      getRoomId: () => this.roomId,
      getRoomCoordinates: () => this.roomCoordinates,
      getIgnoredBackgroundObjects: () => {
        const ignored: Phaser.GameObjects.GameObject[] = [];

        for (const layerName of LAYER_NAMES) {
          const tilemapLayer = this.map?.getLayer(layerName);
          if (tilemapLayer?.tilemapLayer) {
            ignored.push(tilemapLayer.tilemapLayer);
          }
        }

        ignored.push(...this.objectSprites);
        if (this.spawnMarkerSprite) {
          ignored.push(this.spawnMarkerSprite);
        }
        ignored.push(...this.goalMarkerSprites);
        ignored.push(...this.goalMarkerLabels);

        const overlays = [
          this.gridGraphics,
          this.layerGuideGraphics,
          this.interactionController.cursorOverlay,
          this.interactionController.rectPreviewOverlay,
          this.borderGraphics,
        ];
        for (const overlay of overlays) {
          if (overlay) {
            ignored.push(overlay);
          }
        }

        return ignored;
      },
      isSceneActive: () => this.scene.isActive(this.scene.key),
    });
  }

  private get objectSprites(): Phaser.GameObjects.Sprite[] {
    return this.editRuntime.placedObjectSprites;
  }

  private get spawnMarkerSprite(): Phaser.GameObjects.Sprite | null {
    return this.editRuntime.currentSpawnMarkerSprite;
  }

  private get goalMarkerSprites(): Phaser.GameObjects.Sprite[] {
    return [...this.editRuntime.currentGoalMarkerSprites, ...this.courseMarkerSprites];
  }

  private get goalMarkerLabels(): Phaser.GameObjects.Text[] {
    return [...this.editRuntime.currentGoalMarkerLabels, ...this.courseMarkerLabels];
  }

  private get roomId(): string {
    return this.roomSession.currentRoomId;
  }

  private set roomId(value: string) {
    this.roomSession.currentRoomId = value;
  }

  private get roomCoordinates(): RoomCoordinates {
    return this.roomSession.currentRoomCoordinates;
  }

  private set roomCoordinates(value: RoomCoordinates) {
    this.roomSession.currentRoomCoordinates = value;
  }

  private get roomVersion(): number {
    return this.roomSession.currentRoomVersion;
  }

  private get roomTitle(): string | null {
    return this.roomSession.currentRoomTitle;
  }

  private set roomTitle(value: string | null) {
    this.roomSession.currentRoomTitle = value;
  }

  private get publishedVersion(): number {
    return this.roomSession.currentPublishedVersion;
  }

  private get roomCreatedAt(): string {
    return this.roomSession.currentRoomCreatedAt;
  }

  private get roomUpdatedAt(): string {
    return this.roomSession.currentRoomUpdatedAt;
  }

  private get roomPublishedAt(): string | null {
    return this.roomSession.currentRoomPublishedAt;
  }

  private get roomPermissions(): RoomPermissions {
    return this.roomSession.currentRoomPermissions;
  }

  private get roomVersionHistory(): RoomVersionRecord[] {
    return this.roomSession.currentRoomVersionHistory;
  }

  private get claimerDisplayName(): string | null {
    return this.roomSession.currentClaimerDisplayName;
  }

  private get mintedChainId(): number | null {
    return this.roomSession.currentMintedChainId;
  }

  private get mintedContractAddress(): string | null {
    return this.roomSession.currentMintedContractAddress;
  }

  private get mintedTokenId(): string | null {
    return this.roomSession.currentMintedTokenId;
  }

  private get mintedOwnerWalletAddress(): string | null {
    return this.roomSession.currentMintedOwnerWalletAddress;
  }

  private get mintedOwnerSyncedAt(): string | null {
    return this.roomSession.currentMintedOwnerSyncedAt;
  }

  private get saveInFlight(): boolean {
    return this.roomSession.isSaveInFlight;
  }

  private get persistenceStatusText(): string {
    return this.roomSession.statusText;
  }

  private get roomGoal(): RoomGoal | null {
    return this.editRuntime.currentRoomGoal;
  }

  private get roomSpawnPoint(): RoomSpawnPoint | null {
    return this.editRuntime.currentRoomSpawnPoint;
  }

  private get roomDirty(): boolean {
    return this.editRuntime.isRoomDirty;
  }

  private set roomDirty(value: boolean) {
    this.editRuntime.isRoomDirty = value;
  }

  private get lastDirtyAt(): number {
    return this.editRuntime.currentLastDirtyAt;
  }

  private set lastDirtyAt(value: number) {
    this.editRuntime.currentLastDirtyAt = value;
  }

  private get goalPlacementMode(): EditorMarkerPlacementMode {
    return this.courseGoalPlacementMode ?? (this.editRuntime.currentGoalPlacementMode as EditorMarkerPlacementMode);
  }

  private get activeCourseDraft(): CourseSnapshot | null {
    if (!this.activeCourseMarkerEdit) {
      return null;
    }

    if (getActiveCourseDraftSessionCourseId() !== this.activeCourseMarkerEdit.courseId) {
      return null;
    }

    return getActiveCourseDraftSessionDraft();
  }

  private get activeCourseGoal(): CourseGoal | null {
    return this.activeCourseDraft?.goal ?? null;
  }

  private getCourseEditorContextStatusText(): string | null {
    if (!this.activeCourseMarkerEdit) {
      return this.courseEditorStatusText;
    }

    const draft = this.activeCourseDraft;
    if (!draft) {
      return this.courseEditorStatusText ?? 'Open this room from the active course builder session.';
    }

    const stepText =
      this.activeCourseMarkerEdit.roomOrder === null
        ? 'Course room'
        : `Step ${this.activeCourseMarkerEdit.roomOrder + 1}`;
    const titleText = draft.title?.trim() || 'Untitled Course';
    return `${stepText} · ${titleText}`;
  }

  private destroyCourseMarkerOverlays(): void {
    for (const sprite of this.courseMarkerSprites) {
      sprite.destroy();
    }
    this.courseMarkerSprites = [];
    for (const label of this.courseMarkerLabels) {
      label.destroy();
    }
    this.courseMarkerLabels = [];
  }

  private setActiveCourseDraft(nextDraft: CourseSnapshot): void {
    if (!this.activeCourseMarkerEdit || getActiveCourseDraftSessionCourseId() !== this.activeCourseMarkerEdit.courseId) {
      return;
    }

    const normalized = cloneCourseSnapshot(nextDraft);
    updateActiveCourseDraftSession((draft) => {
      draft.title = normalized.title;
      draft.roomRefs = normalized.roomRefs;
      draft.startPoint = normalized.startPoint;
      draft.goal = normalized.goal;
    });
    this.updateGoalUi();
  }

  private buildCourseEditedRoomData(): CourseEditedRoomData | null {
    if (!this.activeCourseMarkerEdit) {
      return null;
    }

    return {
      courseId: this.activeCourseMarkerEdit.courseId,
      roomId: this.activeCourseMarkerEdit.roomId,
      roomOrder: this.activeCourseMarkerEdit.roomOrder,
    };
  }

  private syncActiveCourseRoomSessionSnapshot(
    room: RoomSnapshot,
    options: { published: boolean }
  ): void {
    const courseEdit = this.activeCourseMarkerEdit;
    if (!courseEdit || getActiveCourseDraftSessionCourseId() !== courseEdit.courseId) {
      return;
    }

    const snapshot = cloneRoomSnapshot(room);
    if (options.published) {
      clearActiveCourseDraftSessionRoomOverride(snapshot.id);
    } else {
      setActiveCourseDraftSessionRoomOverride(snapshot);
    }

    const currentDraft = getActiveCourseDraftSessionDraft();
    const currentRoomRef = currentDraft?.roomRefs.find((entry) => entry.roomId === snapshot.id) ?? null;
    const nextTitle = snapshot.title ?? null;
    const needsRecordUpdate =
      currentRoomRef !== null &&
      (currentRoomRef.roomTitle !== nextTitle ||
        (options.published && currentRoomRef.roomVersion !== snapshot.version));
    if (needsRecordUpdate) {
      updateActiveCourseDraftSession((draft) => {
        const roomRef = draft.roomRefs.find((entry) => entry.roomId === snapshot.id);
        if (!roomRef) {
          return;
        }

        roomRef.roomTitle = nextTitle;
        if (options.published) {
          roomRef.roomVersion = snapshot.version;
        }
      });
      this.updateGoalUi();
    }
  }

  private getCourseGoalUsesMarkers(goal: CourseGoal | null): boolean {
    return goal !== null;
  }

  private getCourseGoalSummaryText(): string {
    const draft = this.activeCourseDraft;
    const goal = draft?.goal ?? null;
    if (!goal) {
      return 'No course goal selected.';
    }

    const parts: string[] = [];
    switch (goal.type) {
      case 'reach_exit':
        parts.push('Reach Exit');
        parts.push(draft?.startPoint ? 'start set' : 'start missing');
        parts.push(goal.exit ? 'exit set' : 'exit missing');
        break;
      case 'checkpoint_sprint':
        parts.push('Checkpoint Sprint');
        parts.push(draft?.startPoint ? 'start set' : 'start missing');
        parts.push(`${goal.checkpoints.length} checkpoint${goal.checkpoints.length === 1 ? '' : 's'}`);
        parts.push(goal.finish ? 'finish set' : 'finish missing');
        break;
      case 'collect_target':
        parts.push(`Collect Target · ${goal.requiredCount} required`);
        break;
      case 'defeat_all':
        parts.push('Defeat All');
        break;
      case 'survival':
        parts.push(`Survival · ${Math.max(1, Math.round(goal.durationMs / 1000))}s`);
        break;
    }

    if (draft?.roomRefs.length) {
      parts.push(`${draft.roomRefs.length} room${draft.roomRefs.length === 1 ? '' : 's'}`);
    }

    return parts.join(' · ');
  }

  private redrawCourseGoalMarkers(): void {
    this.destroyCourseMarkerOverlays();
    if (!this.activeCourseDraft) {
      this.syncBackgroundCameraIgnores();
      return;
    }

    const draft = this.activeCourseDraft;
    const goal = draft?.goal ?? null;
    if (!draft || !goal) {
      this.syncBackgroundCameraIgnores();
      return;
    }

    const markers: Array<{
      point: CourseMarkerPoint;
      label: string | null;
      variant: GoalMarkerFlagVariant;
      textColor: string;
    }> = [];
    const currentRoomId = this.roomId;

    if (draft.startPoint?.roomId === currentRoomId) {
      markers.push({
        point: draft.startPoint,
        label: 'START',
        variant: 'checkpoint-pending',
        textColor: '#ffefef',
      });
    }

    if (goal.type === 'reach_exit' && goal.exit?.roomId === currentRoomId) {
      markers.push({
        point: goal.exit,
        label: null,
        variant: 'finish-pending',
        textColor: '#ffefef',
      });
    }

    if (goal.type === 'checkpoint_sprint') {
      goal.checkpoints.forEach((checkpoint, index) => {
        if (checkpoint.roomId !== currentRoomId) {
          return;
        }

        markers.push({
          point: checkpoint,
          label: `${index + 1}`,
          variant: 'checkpoint-pending',
          textColor: '#ffefef',
        });
      });

      if (goal.finish?.roomId === currentRoomId) {
        markers.push({
          point: goal.finish,
          label: 'FINISH',
          variant: 'finish-pending',
          textColor: '#ffefef',
        });
      }
    }

    for (const marker of markers) {
      const sprite = createGoalMarkerFlagSprite(
        this,
        marker.variant,
        marker.point.x,
        marker.point.y + 2,
        97,
      );
      this.courseMarkerSprites.push(sprite);

      if (marker.label) {
        const label = this.add.text(marker.point.x, marker.point.y - 28, marker.label, {
          fontFamily: 'Courier New',
          fontSize: '12px',
          color: marker.textColor,
          stroke: '#050505',
          strokeThickness: 4,
        });
        label.setOrigin(0.5, 1);
        label.setDepth(98);
        this.courseMarkerLabels.push(label);
      }
    }

    this.syncBackgroundCameraIgnores();
  }

  getCourseEditorState(): EditorCourseUiState {
    const draft = this.activeCourseDraft;
    const activeGoal = this.activeCourseGoal;
    const coursePlacementMode = this.courseGoalPlacementMode;
    return {
      visible: Boolean(this.activeCourseMarkerEdit || this.courseEditorStatusText),
      statusHidden: !this.getCourseEditorContextStatusText(),
      statusText: this.getCourseEditorContextStatusText(),
      goalTypeValue: activeGoal?.type ?? '',
      goalTypeDisabled: !draft,
      timeLimitHidden: !activeGoal || !('timeLimitMs' in activeGoal),
      timeLimitDisabled: !draft,
      timeLimitValue:
        activeGoal && 'timeLimitMs' in activeGoal && activeGoal.timeLimitMs
          ? String(Math.round(activeGoal.timeLimitMs / 1000))
          : '',
      requiredCountHidden: activeGoal?.type !== 'collect_target',
      requiredCountDisabled: !draft,
      requiredCountValue:
        activeGoal?.type === 'collect_target' ? String(activeGoal.requiredCount) : '1',
      survivalHidden: activeGoal?.type !== 'survival',
      survivalDisabled: !draft,
      survivalValue:
        activeGoal?.type === 'survival'
          ? String(Math.round(activeGoal.durationMs / 1000))
          : '30',
      markerControlsHidden: !activeGoal,
      placementHintHidden: coursePlacementMode === null,
      placementHintText:
        coursePlacementMode === 'start'
          ? 'Click the canvas to place the course start marker.'
          : coursePlacementMode === 'exit'
            ? 'Click the canvas to place the course exit marker.'
            : coursePlacementMode === 'checkpoint'
              ? 'Click the canvas to add a course checkpoint.'
            : coursePlacementMode === 'finish'
              ? 'Click the canvas to place the course finish marker.'
              : '',
      summaryText: draft ? this.getCourseGoalSummaryText() : 'Open this room from the course builder.',
      placeStartHidden: !activeGoal,
      placeStartActive: coursePlacementMode === 'start',
      placeExitHidden: activeGoal?.type !== 'reach_exit',
      placeExitActive: coursePlacementMode === 'exit',
      addCheckpointHidden: activeGoal?.type !== 'checkpoint_sprint',
      addCheckpointActive: coursePlacementMode === 'checkpoint',
      placeFinishHidden: activeGoal?.type !== 'checkpoint_sprint',
      placeFinishActive: coursePlacementMode === 'finish',
    };
  }

  create(data?: EditorSceneData): void {
    this.resetRuntimeState();

    this.initialRoomSnapshot = data?.roomSnapshot ? cloneRoomSnapshot(data.roomSnapshot) : null;
    this.activeCourseMarkerEdit = data?.courseEdit
      ? {
          courseId: data.courseEdit.courseId,
          roomId: data.courseEdit.roomId,
          roomOrder: data.courseEdit.roomOrder,
        }
      : null;
    this.courseEditorStatusText = this.activeCourseMarkerEdit
      ? null
      : 'Open this room from the course builder to edit course goals.';

    if (this.initialRoomSnapshot) {
      this.roomCoordinates = { ...this.initialRoomSnapshot.coordinates };
      this.roomId = this.initialRoomSnapshot.id;
    } else if (data?.roomCoordinates) {
      this.roomCoordinates = { ...data.roomCoordinates };
      this.roomId = roomIdFromCoordinates(this.roomCoordinates);
    } else {
      this.roomCoordinates = { ...DEFAULT_ROOM_COORDINATES };
      this.roomId = DEFAULT_ROOM_ID;
    }
    this.entrySource = data?.source ?? 'direct';
    setAppMode('editor');
    this.uiBridge = new EditorUiBridge();

    this.createBackground();
    this.createTilemap();
    this.drawRoomBorder();
    this.drawGrid();
    this.createCursorOverlay();
    this.createLayerIndicator();
    this.setupCamera();
    this.setupInput();
    this.setupKeyboard();
    this.rebuildObjectSprites();
    this.syncBackgroundCameraIgnores();
    this.updateBackgroundPreview();

    this.events.on('wake', this.handleWake, this);
    window.addEventListener('background-changed', this.handleBackgroundChanged);
    window.addEventListener(AUTH_STATE_CHANGED_EVENT, this.handleAuthStateChanged);
    document.addEventListener('keydown', this.handleDocumentKeyDown);
    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);

    if (this.initialRoomSnapshot) {
      const editableSnapshot = cloneRoomSnapshot(this.initialRoomSnapshot);
      editableSnapshot.status = 'draft';
      this.applyRoomSnapshot(editableSnapshot);
      this.updatePersistenceStatus('Loading room...');
    }

    void this.loadPersistedRoom();
    this.initializeEditorPresence();
    this.updateBottomBar();
    this.updateGoalUi();
  }

  update(time: number): void {
    this.maybeAutoSave(time);
    this.syncEditorPresence();
    this.updateBackgroundPreview();
    this.updateLayerGuideOverlay();
    this.updateCursorHighlight();
    this.updateLayerIndicator();
  }

  // ══════════════════════════════════════
  // BACKGROUND
  // ══════════════════════════════════════

  private createBackground(): void {
    this.backgroundController.createBackground(editorState.selectedBackground);
  }

  private resetRuntimeState(): void {
    this.backgroundController.reset();
    this.interactionController.reset();
    this.layerIndicatorText?.destroy();
    this.layerIndicatorText = null;
    this.layerGuideGraphics?.destroy();
    this.layerGuideGraphics = null;
    this.tilesets = new Map();
    this.layers = new Map();
    this.editRuntime.reset();
    this.roomSession.reset();
    this.courseEditorStatusText = null;
    this.activeCourseMarkerEdit = null;
    this.courseGoalPlacementMode = null;
    this.destroyCourseMarkerOverlays();
    this.roomEditCount = 0;
    this.publishNudgeTriggered = false;
    editorState.tileFlipX = false;
    editorState.tileFlipY = false;
    editorState.isPlaying = false;
    window.dispatchEvent(new Event('tile-flip-changed'));
  }

  updateBackground(): void {
    this.backgroundController.updateBackground(editorState.selectedBackground);
  }

  private syncBackgroundCameraIgnores(): void {
    this.backgroundController.syncBackgroundCameraIgnores();
  }

  private updateBackgroundPreview(): void {
    this.backgroundController.updateBackgroundPreview();
  }

  private async refreshSurroundingRoomPreviews(): Promise<void> {
    await this.backgroundController.refreshSurroundingRoomPreviews(EDITOR_NEIGHBOR_RADIUS);
  }

  // ══════════════════════════════════════
  // ROOM PERSISTENCE
  // ══════════════════════════════════════

  private async loadPersistedRoom(): Promise<void> {
    const loaded = await this.roomSession.loadPersistedRoom(this.initialRoomSnapshot);
    if (!loaded) {
      if (this.entrySource === 'world') {
        showBusyError('Failed to load room.', {
          retryHandler: () => {
            showBusyOverlay('Opening editor...', 'Loading room...');
            return this.loadPersistedRoom();
          },
          closeHandler: async () => {
            hideBusyOverlay();
            this.scene.stop();
            this.scene.wake('OverworldPlayScene', {
              centerCoordinates: { ...this.roomCoordinates },
              roomCoordinates: { ...this.roomCoordinates },
              mode: 'browse',
              statusMessage: 'Failed to open room.',
            });
          },
        });
      }
      return;
    }

    if (this.entrySource === 'world' && this.mintedTokenId && !this.roomPermissions.canSaveDraft) {
      this.returnToWorldReadOnly();
      return;
    }

    if (this.entrySource === 'world') {
      hideBusyOverlay();
    }

    this.syncEditorPresence();
    this.updateGoalUi();
  }

  private returnToWorldReadOnly(): void {
    const wakeData: OverworldPlaySceneData = {
      centerCoordinates: { ...this.roomCoordinates },
      roomCoordinates: { ...this.roomCoordinates },
      statusMessage: 'This minted room can only be edited by its token owner.',
      draftRoom: null,
      clearDraftRoomId: this.roomId,
      mode: 'browse',
    };

    this.scene.stop();
    this.scene.wake('OverworldPlayScene', wakeData);
  }

  private getIdleStatusText(): string {
    return this.roomSession.getIdleStatusText();
  }

  private applyRoomSnapshot(room: RoomSnapshot): void {
    this.editRuntime.applyRoomSnapshot(room);
  }

  private exportRoomSnapshot(): RoomSnapshot {
    return this.editRuntime.exportRoomSnapshot();
  }

  private maybeAutoSave(_time: number): void {
    this.roomSession.maybeAutoSave(editorState.isPlaying);
  }

  private markRoomDirty(): void {
    this.editRuntime.isRoomDirty = true;
    this.editRuntime.currentLastDirtyAt = performance.now();
    this.roomEditCount += 1;
    this.updatePersistenceStatus(
      this.roomPermissions.canSaveDraft
        ? 'Draft changes...'
        : 'Read-only minted room. Changes are local only.'
    );
    this.maybeTriggerPublishNudge();
  }

  private updatePersistenceStatus(text: string): void {
    this.roomSession.setStatusText(text);
  }

  async saveDraft(
    force: boolean = false,
    options?: { promptForSignInOnUnauthorized?: boolean }
  ): Promise<RoomRecord | null> {
    const record = await this.roomSession.saveDraft(force, options);
    if (record?.draft) {
      this.syncActiveCourseRoomSessionSnapshot(record.draft, { published: false });
    }
    return record;
  }

  async publishRoom(successText?: string): Promise<RoomRecord | null> {
    showBusyOverlay('Publishing room...', 'Saving the latest version...');
    const record = await this.roomSession.publishRoom(successText);
    if (record?.published) {
      this.syncActiveCourseRoomSessionSnapshot(record.published, { published: true });
    }
    hideBusyOverlay();
    return record;
  }

  async revertToVersion(targetVersion: number): Promise<RoomRecord | null> {
    showBusyOverlay(`Reverting room...`, `Loading version ${targetVersion}...`);
    const record = await this.roomSession.revertToVersion(targetVersion, this.initialRoomSnapshot);
    hideBusyOverlay();
    return record;
  }

  // ══════════════════════════════════════
  // TILEMAP SETUP
  // ══════════════════════════════════════

  private createTilemap(): void {
    this.map = this.make.tilemap({
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      width: ROOM_WIDTH,
      height: ROOM_HEIGHT,
    });

    // Add all tilesets with their firstGid offsets
    for (const ts of TILESETS) {
      const tileset = this.map.addTilesetImage(ts.key, ts.key, TILE_SIZE, TILE_SIZE, 0, 0, ts.firstGid);
      if (tileset) {
        this.tilesets.set(ts.key, tileset);
      }
    }

    const allTilesets = Array.from(this.tilesets.values());

    // Create layers in render order (bottom to top)
    for (const layerName of LAYER_NAMES) {
      const layer = this.map.createBlankLayer(layerName, allTilesets, 0, 0);
      if (layer) {
        this.layers.set(layerName, layer);
        // Foreground renders above player
        if (layerName === 'foreground') {
          layer.setDepth(50);
        } else if (layerName === 'terrain') {
          layer.setDepth(10);
        } else {
          layer.setDepth(1);
        }
      }
    }
  }

  // ══════════════════════════════════════
  // GRID & VISUAL OVERLAYS
  // ══════════════════════════════════════

  private drawRoomBorder(): void {
    this.borderGraphics = this.add.graphics();
    this.borderGraphics.lineStyle(2, RETRO_COLORS.published, 0.85);
    this.borderGraphics.strokeRect(0, 0, ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
    this.borderGraphics.setDepth(90);
  }

  private drawGrid(): void {
    this.gridGraphics = this.add.graphics();
    this.gridGraphics.lineStyle(1, RETRO_COLORS.grid, 0.12);

    // Vertical lines
    for (let x = 0; x <= ROOM_WIDTH; x++) {
      this.gridGraphics.moveTo(x * TILE_SIZE, 0);
      this.gridGraphics.lineTo(x * TILE_SIZE, ROOM_PX_HEIGHT);
    }
    // Horizontal lines
    for (let y = 0; y <= ROOM_HEIGHT; y++) {
      this.gridGraphics.moveTo(0, y * TILE_SIZE);
      this.gridGraphics.lineTo(ROOM_PX_WIDTH, y * TILE_SIZE);
    }

    this.gridGraphics.strokePath();
    this.gridGraphics.setDepth(95);
  }

  private createCursorOverlay(): void {
    this.interactionController.initializeOverlays();
    this.editRuntime.initializeGraphics();
    this.layerGuideGraphics?.destroy();
    this.layerGuideGraphics = this.add.graphics();
    this.layerGuideGraphics.setDepth(97);
  }

  private createLayerIndicator(): void {
    this.layerIndicatorText?.destroy();
    this.layerIndicatorText = this.add.text(0, 0, '', {
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#f6f1de',
      backgroundColor: '#121109cc',
      padding: {
        x: 12,
        y: 7,
      },
    });
    this.layerIndicatorText.setDepth(130);
    this.layerIndicatorText.setScrollFactor(0);
    this.updateLayerIndicator();
  }

  private updateCursorHighlight(): void {
    this.interactionController.updateCursorHighlight();
  }

  private updateLayerGuideOverlay(): void {
    this.layerGuideGraphics?.clear();
    if (!this.layerGuideGraphics || editorState.isPlaying || !editorState.showLayerGuides) {
      return;
    }

    for (const layerName of LAYER_NAMES) {
      const layer = this.layers.get(layerName);
      if (!layer) {
        continue;
      }

      this.layerGuideGraphics.lineStyle(1, this.getLayerGuideColor(layerName), 0.42);
      for (let y = 0; y < ROOM_HEIGHT; y += 1) {
        for (let x = 0; x < ROOM_WIDTH; x += 1) {
          if (!layer.getTileAt(x, y)) {
            continue;
          }

          this.layerGuideGraphics.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
      }
    }

    for (const placedObject of editorState.placedObjects) {
      const objectConfig = getObjectById(placedObject.id);
      if (!objectConfig) {
        continue;
      }

      const layerName = getPlacedObjectLayer(placedObject);
      const previewWidth = objectConfig.previewWidth ?? objectConfig.frameWidth;
      const previewHeight = objectConfig.previewHeight ?? objectConfig.frameHeight;
      const previewOffsetX = objectConfig.previewOffsetX ?? 0;
      const previewOffsetY = objectConfig.previewOffsetY ?? 0;
      this.layerGuideGraphics.lineStyle(1, this.getLayerGuideColor(layerName), 0.62);
      this.layerGuideGraphics.strokeRect(
        placedObject.x - objectConfig.frameWidth * 0.5 + previewOffsetX,
        placedObject.y - objectConfig.frameHeight * 0.5 + previewOffsetY,
        previewWidth,
        previewHeight,
      );
    }
  }

  private getLayerGuideColor(layerName: LayerName): number {
    switch (layerName) {
      case 'background':
        return 0x2f6b7f;
      case 'foreground':
        return 0xff6f3c;
      case 'terrain':
      default:
        return 0x347433;
    }
  }

  private updateLayerIndicator(): void {
    if (!this.layerIndicatorText) {
      return;
    }

    const layerLabel =
      editorState.activeLayer === 'terrain'
        ? 'Terrain'
        : editorState.activeLayer === 'background'
          ? 'Background'
          : 'Foreground';
    const layerColor =
      editorState.activeLayer === 'terrain'
        ? '#347433'
        : editorState.activeLayer === 'background'
          ? '#2f6b7f'
          : '#ff6f3c';
    const modeLabel = editorState.paletteMode === 'objects' ? 'Objects' : 'Terrain';
    const toolLabel =
      editorState.activeTool === 'eraser'
        ? `Erase ${editorState.eraserBrushSize}x${editorState.eraserBrushSize}`
        : editorState.activeTool === 'rect'
          ? 'Rect'
          : editorState.activeTool === 'fill'
            ? 'Fill'
            : 'Draw';
    const flipLabels: string[] = [];
    if (editorState.paletteMode === 'tiles' && editorState.tileFlipX) {
      flipLabels.push('Flip H');
    }
    if (editorState.paletteMode === 'tiles' && editorState.tileFlipY) {
      flipLabels.push('Flip V');
    }
    const detailParts = [toolLabel, ...flipLabels];
    const text = `${modeLabel} -> ${layerLabel}\n${detailParts.join('  |  ')}`;
    if (this.layerIndicatorText.text !== text) {
      this.layerIndicatorText.setText(text);
    }

    this.layerIndicatorText.setBackgroundColor(`${layerColor}cc`);
    this.layerIndicatorText.setPosition(
      this.scale.width - this.layerIndicatorText.width - 18,
      18,
    );
  }

  // ══════════════════════════════════════
  // CAMERA
  // ══════════════════════════════════════

  private setupCamera(): void {
    this.interactionController.setupCamera();
  }

  private centerCameraOnRoom(): void {
    this.interactionController.centerCameraOnRoom();
  }

  private updateZoomUI(): void {
    this.renderEditorUi();
  }

  fitToScreen(): void {
    this.interactionController.fitToScreen();
  }

  zoomIn(): void {
    this.interactionController.zoomIn();
  }

  zoomOut(): void {
    this.interactionController.zoomOut();
  }

  // ══════════════════════════════════════
  // INPUT
  // ══════════════════════════════════════

  private setupInput(): void {
    this.interactionController.setupInput(this.handleCanvasContextMenu);
  }

  private setupKeyboard(): void {
    this.interactionController.setupKeyboard();
  }

  // ══════════════════════════════════════
  // OBJECT PLACEMENT
  // ══════════════════════════════════════

  private handleObjectPlace(pointer: Phaser.Input.Pointer): void {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tileX = Math.floor(worldPoint.x / TILE_SIZE);
    const tileY = Math.floor(worldPoint.y / TILE_SIZE);
    this.editRuntime.handleObjectPlace(worldPoint.x, worldPoint.y, tileX, tileY);
  }

  private removeObjectAt(worldX: number, worldY: number): void {
    this.editRuntime.removeObjectAt(worldX, worldY);
  }

  rebuildObjectSprites(): void {
    this.editRuntime.rebuildObjectSprites();
  }

  setGoalType(nextType: RoomGoalType | null): void {
    this.editRuntime.setGoalType(nextType);
  }

  setGoalTimeLimitSeconds(seconds: number | null): void {
    this.editRuntime.setGoalTimeLimitSeconds(seconds);
  }

  setGoalRequiredCount(requiredCount: number): void {
    this.editRuntime.setGoalRequiredCount(requiredCount);
  }

  setGoalSurvivalSeconds(seconds: number): void {
    this.editRuntime.setGoalSurvivalSeconds(seconds);
  }

  startGoalMarkerPlacement(mode: EditorMarkerPlacementMode): void {
    this.courseGoalPlacementMode = null;
    this.editRuntime.startGoalMarkerPlacement(mode as GoalPlacementMode);
  }

  clearGoalMarkers(): void {
    this.editRuntime.clearGoalMarkers();
  }

  setCourseGoalType(goalType: CourseGoalType | null): void {
    const draft = this.activeCourseDraft;
    if (!draft) {
      return;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    nextDraft.goal = goalType ? createDefaultCourseGoal(goalType) : null;
    if (!goalType) {
      nextDraft.startPoint = null;
    }
    this.courseGoalPlacementMode = null;
    this.setActiveCourseDraft(nextDraft);
  }

  setCourseGoalTimeLimitSeconds(seconds: number | null): void {
    const draft = this.activeCourseDraft;
    if (!draft?.goal || draft.goal.type === 'survival' || !('timeLimitMs' in draft.goal)) {
      return;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    if (nextDraft.goal && 'timeLimitMs' in nextDraft.goal) {
      nextDraft.goal.timeLimitMs = seconds === null ? null : Math.max(1, seconds) * 1000;
      this.setActiveCourseDraft(nextDraft);
    }
  }

  setCourseGoalRequiredCount(requiredCount: number): void {
    const draft = this.activeCourseDraft;
    if (draft?.goal?.type !== 'collect_target') {
      return;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    if (nextDraft.goal?.type === 'collect_target') {
      nextDraft.goal.requiredCount = Math.max(1, requiredCount);
      this.setActiveCourseDraft(nextDraft);
    }
  }

  setCourseGoalSurvivalSeconds(seconds: number): void {
    const draft = this.activeCourseDraft;
    if (draft?.goal?.type !== 'survival') {
      return;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    if (nextDraft.goal?.type === 'survival') {
      nextDraft.goal.durationMs = Math.max(1, seconds) * 1000;
      this.setActiveCourseDraft(nextDraft);
    }
  }

  startCourseGoalMarkerPlacement(mode: EditorMarkerPlacementMode): void {
    if (!this.activeCourseDraft || !this.getCourseGoalUsesMarkers(this.activeCourseGoal)) {
      return;
    }

    this.editRuntime.currentGoalPlacementMode = null;
    this.courseGoalPlacementMode = this.courseGoalPlacementMode === mode ? null : mode;
    this.updateGoalUi();
  }

  clearCourseGoalMarkers(): void {
    const draft = this.activeCourseDraft;
    if (!draft) {
      return;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    nextDraft.startPoint = null;
    if (nextDraft.goal?.type === 'reach_exit') {
      nextDraft.goal.exit = null;
    } else if (nextDraft.goal?.type === 'checkpoint_sprint') {
      nextDraft.goal.checkpoints = [];
      nextDraft.goal.finish = null;
    }
    this.courseGoalPlacementMode = null;
    this.setActiveCourseDraft(nextDraft);
  }

  getGoalEditorState(): {
    goal: RoomGoal | null;
    placementMode: GoalPlacementMode;
    availableCollectibles: number;
    availableEnemies: number;
  } {
    return this.editRuntime.getGoalEditorState();
  }

  private getSelectedCoursePreviewForPlay(): CourseSnapshot | null {
    const draft = this.activeCourseDraft;
    if (!draft?.goal || !draft.startPoint) {
      return null;
    }

    if (!draft.roomRefs.some((roomRef) => roomRef.roomId === this.roomId)) {
      return null;
    }

    if (draft.goal.type === 'reach_exit' && !draft.goal.exit) {
      return null;
    }

    if (
      draft.goal.type === 'checkpoint_sprint' &&
      (!draft.goal.finish || draft.goal.checkpoints.length === 0)
    ) {
      return null;
    }

    return cloneCourseSnapshot(draft);
  }

  private placeGoalMarker(tileX: number, tileY: number): void {
    if (this.courseGoalPlacementMode !== null) {
      const draft = this.activeCourseDraft;
      const goal = this.activeCourseGoal;
      if (!draft || !goal) {
        return;
      }

      const localPoint: CourseMarkerPoint = {
        roomId: this.roomId,
        ...createGoalMarkerPointFromTile(tileX, tileY),
      };
      const nextDraft = cloneCourseSnapshot(draft);

      if (this.courseGoalPlacementMode === 'start') {
        nextDraft.startPoint = localPoint;
        this.courseGoalPlacementMode = null;
        this.setActiveCourseDraft(nextDraft);
        return;
      }

      if (goal.type === 'reach_exit' && this.courseGoalPlacementMode === 'exit' && nextDraft.goal?.type === 'reach_exit') {
        nextDraft.goal.exit = localPoint;
        this.courseGoalPlacementMode = null;
        this.setActiveCourseDraft(nextDraft);
        return;
      }

      if (goal.type !== 'checkpoint_sprint' || nextDraft.goal?.type !== 'checkpoint_sprint') {
        return;
      }

      if (this.courseGoalPlacementMode === 'checkpoint') {
        nextDraft.goal.checkpoints = [...nextDraft.goal.checkpoints, localPoint];
        this.setActiveCourseDraft(nextDraft);
        return;
      }

      if (this.courseGoalPlacementMode === 'finish') {
        nextDraft.goal.finish = localPoint;
        this.courseGoalPlacementMode = null;
        this.setActiveCourseDraft(nextDraft);
      }
      return;
    }

    this.editRuntime.placeGoalMarker(tileX, tileY);
  }

  private removeGoalMarkerAt(worldX: number, worldY: number): boolean {
    if (this.activeCourseDraft) {
      const draft = this.activeCourseDraft;
      const goal = this.activeCourseGoal;
      if (!draft || !goal) {
        return false;
      }

      const nextDraft = cloneCourseSnapshot(draft);
      const tryRemovePoint = (point: CourseMarkerPoint | null): boolean =>
        Boolean(point && point.roomId === this.roomId && Math.hypot(point.x - worldX, point.y - worldY) < 16);

      if (tryRemovePoint(nextDraft.startPoint)) {
        nextDraft.startPoint = null;
        this.setActiveCourseDraft(nextDraft);
        return true;
      }

      if (goal.type === 'reach_exit' && nextDraft.goal?.type === 'reach_exit' && tryRemovePoint(nextDraft.goal.exit)) {
        nextDraft.goal.exit = null;
        this.setActiveCourseDraft(nextDraft);
        return true;
      }

      if (goal.type !== 'checkpoint_sprint' || nextDraft.goal?.type !== 'checkpoint_sprint') {
        return false;
      }

      if (tryRemovePoint(nextDraft.goal.finish)) {
        nextDraft.goal.finish = null;
        this.setActiveCourseDraft(nextDraft);
        return true;
      }

      const index = nextDraft.goal.checkpoints.findIndex(
        (checkpoint) =>
          checkpoint.roomId === this.roomId &&
          Math.hypot(checkpoint.x - worldX, checkpoint.y - worldY) < 16
      );
      if (index >= 0) {
        nextDraft.goal.checkpoints.splice(index, 1);
        this.setActiveCourseDraft(nextDraft);
        return true;
      }
    }

    return this.editRuntime.removeGoalMarkerAt(worldX, worldY);
  }

  private goalUsesMarkers(goal: RoomGoal | null): boolean {
    return this.editRuntime.goalUsesMarkers(goal);
  }

  private getGoalSummaryText(): string {
    return this.editRuntime.getGoalSummaryText();
  }

  private updateGoalUi(): void {
    this.redrawCourseGoalMarkers();
    this.renderEditorUi();
  }

  // ══════════════════════════════════════
  // TOOL HANDLERS
  // ══════════════════════════════════════

  private handleToolDown(pointer: Phaser.Input.Pointer): void {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tileX = Math.floor(worldPoint.x / TILE_SIZE);
    const tileY = Math.floor(worldPoint.y / TILE_SIZE);

    if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) return;

    this.editRuntime.beginTileBatch();

    switch (editorState.activeTool) {
      case 'pencil':
        this.placeTileAt(worldPoint.x, worldPoint.y);
        break;
      case 'eraser':
        this.eraseTileAt(worldPoint.x, worldPoint.y);
        break;
      case 'rect':
        this.interactionController.startRectDrawing(tileX, tileY);
        break;
      case 'fill':
        this.floodFill(tileX, tileY);
        this.editRuntime.commitTileBatch();
        break;
    }
  }

  // ── Pencil (supports multi-tile selection) ──

  private placeTileAt(worldX: number, worldY: number): void {
    this.editRuntime.placeTileAt(worldX, worldY);
  }

  // ── Eraser ──

  private eraseTileAt(worldX: number, worldY: number): void {
    this.editRuntime.eraseTileAt(worldX, worldY);
  }

  clearCurrentLayer(): void {
    this.editRuntime.clearCurrentLayer();
  }

  clearAllTiles(): void {
    this.editRuntime.clearAllTiles();
  }

  private fillRect(x1: number, y1: number, x2: number, y2: number): void {
    this.editRuntime.fillRect(x1, y1, x2, y2);
  }

  // ── Flood Fill ──

  private floodFill(startX: number, startY: number): void {
    this.editRuntime.floodFill(startX, startY);
  }

  // ══════════════════════════════════════
  // UNDO / REDO
  // ══════════════════════════════════════

  private undo(): void {
    this.editRuntime.undo();
  }

  private redo(): void {
    this.editRuntime.redo();
  }

  // ══════════════════════════════════════
  // PLAY MODE
  // ══════════════════════════════════════

  async startPlayMode(): Promise<void> {
    const coursePreview = this.getSelectedCoursePreviewForPlay();
    if (this.roomPermissions.canSaveDraft) {
      void this.saveDraft(true);
    }
    const currentRoomSnapshot = this.exportRoomSnapshot();
    const usePublishedCourseRoomVersion =
      !this.roomDirty &&
      this.publishedVersion > 0 &&
      this.roomVersion === this.publishedVersion;
    this.syncActiveCourseRoomSessionSnapshot(currentRoomSnapshot, {
      published: usePublishedCourseRoomVersion,
    });
    const startRoomRef = coursePreview
      ? (coursePreview.startPoint
          ? coursePreview.roomRefs.find((roomRef) => roomRef.roomId === coursePreview.startPoint?.roomId) ?? null
          : coursePreview.roomRefs[0] ?? null)
      : null;
    const playCoordinates = startRoomRef?.coordinates ?? this.roomCoordinates;
    const playData: OverworldPlaySceneData = {
      centerCoordinates: { ...playCoordinates },
      roomCoordinates: { ...playCoordinates },
      draftRoom: usePublishedCourseRoomVersion ? null : currentRoomSnapshot,
      publishedRoom: usePublishedCourseRoomVersion ? currentRoomSnapshot : null,
      invalidateRoomId: currentRoomSnapshot.id,
      forceRefreshAround: usePublishedCourseRoomVersion,
      courseDraftPreviewId: coursePreview?.id ?? null,
      courseEditedRoom: this.buildCourseEditedRoomData(),
      statusMessage: coursePreview ? 'Testing draft course.' : null,
      mode: 'play',
    };

    this.editorPresenceClient?.updateLocalPresence(null);
    this.scene.sleep();
    this.scene.wake('OverworldPlayScene', playData);
    this.updateBottomBar();
  }

  async handlePublishNudgeAction(): Promise<void> {
    if (!this.shouldShowPublishNudge()) {
      return;
    }

    if (!getAuthDebugState().authenticated) {
      promptForSignIn('People can’t see this room until you publish it. Sign in to publish.');
      return;
    }

    if (this.roomPermissions.canPublish) {
      await this.publishRoom();
    }
  }

  // ══════════════════════════════════════
  // UI SYNC
  // ══════════════════════════════════════

  private updateToolUI(): void {
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.tool === editorState.activeTool);
    });
    document.getElementById('erase-controls')?.classList.toggle(
      'hidden',
      !(editorState.paletteMode === 'tiles' && editorState.activeTool === 'eraser'),
    );
  }

  private updateBottomBar(): void {
    this.renderEditorUi();
  }

  private renderEditorUi(): void {
    const roomPlacementMode = this.editRuntime.currentGoalPlacementMode;
    const courseEditorState = this.getCourseEditorState();
    const saveStatus =
      this.roomSession.statusDetails.text ||
      this.roomSession.statusDetails.accentText ||
      this.roomSession.statusDetails.linkLabel
        ? this.roomSession.statusDetails
        : this.roomSession.getIdleStatusDetails();
    const publishNudgeVisible = this.shouldShowPublishNudge();
    const publishNudgeText = getAuthDebugState().authenticated
      ? 'People can’t see this room until you publish it.'
      : 'People can’t see this room until you sign in and publish it.';
    const publishNudgeActionText = getAuthDebugState().authenticated
      ? 'Publish Now'
      : 'Sign In to Publish';
    const goalModel = {
      goalTypeValue: this.roomGoal?.type ?? '',
      goalTypeDisabled: false,
      timeLimitHidden: !this.roomGoal || !goalSupportsTimeLimit(this.roomGoal.type),
      timeLimitDisabled: false,
      timeLimitValue:
        this.roomGoal &&
        goalSupportsTimeLimit(this.roomGoal.type) &&
        this.roomGoal.type !== 'survival' &&
        this.roomGoal.timeLimitMs
          ? String(Math.round(this.roomGoal.timeLimitMs / 1000))
          : '',
      requiredCountHidden: this.roomGoal?.type !== 'collect_target',
      requiredCountDisabled: false,
      requiredCountValue:
        this.roomGoal?.type === 'collect_target' ? String(this.roomGoal.requiredCount) : '1',
      survivalHidden: this.roomGoal?.type !== 'survival',
      survivalDisabled: false,
      survivalValue:
        this.roomGoal?.type === 'survival'
          ? String(Math.round(this.roomGoal.durationMs / 1000))
          : '30',
      markerControlsHidden: !this.goalUsesMarkers(this.roomGoal),
      placementHintHidden: roomPlacementMode === null,
      placementHintText:
        roomPlacementMode === 'exit'
          ? 'Click the canvas to place the exit marker.'
          : roomPlacementMode === 'checkpoint'
            ? 'Click the canvas to add a checkpoint marker.'
            : roomPlacementMode === 'finish'
              ? 'Click the canvas to place the finish marker.'
              : '',
      summaryText: this.getGoalSummaryText(),
      contextHidden: true,
      contextText: '',
      placeStartHidden: true,
      placeStartActive: false,
      placeExitHidden: this.roomGoal?.type !== 'reach_exit',
      placeExitActive: roomPlacementMode === 'exit',
      addCheckpointHidden: this.roomGoal?.type !== 'checkpoint_sprint',
      addCheckpointActive: roomPlacementMode === 'checkpoint',
      placeFinishHidden: this.roomGoal?.type !== 'checkpoint_sprint',
      placeFinishActive: roomPlacementMode === 'finish',
    };

    this.uiBridge?.render({
      roomTitleValue: this.roomTitle ?? '',
      roomCoordinatesText: `Room (${this.roomCoordinates.x}, ${this.roomCoordinates.y})`,
      saveStatusText: saveStatus.text,
      saveStatusAccentText: saveStatus.accentText,
      saveStatusLinkText: saveStatus.linkLabel,
      saveStatusLinkHref: saveStatus.linkHref,
      publishNudgeVisible,
      publishNudgeText,
      publishNudgeActionText,
      zoomText: `Zoom: ${editorState.zoom}x`,
      backToWorldHidden: this.entrySource !== 'world',
      playHidden: false,
      saveHidden: false,
      saveDisabled: !this.roomPermissions.canSaveDraft,
      publishHidden: false,
      publishDisabled: !this.roomPermissions.canPublish,
      mintHidden: false,
      mintDisabled: Boolean(this.mintedTokenId) || this.saveInFlight,
      mintButtonText: this.mintedTokenId ? 'Minted' : 'Mint Room',
      historyHidden: false,
      historyDisabled: this.roomVersionHistory.length === 0,
      fitHidden: false,
      goal: goalModel,
      course: {
        visible: courseEditorState.visible,
        statusHidden: courseEditorState.statusHidden,
        statusText: courseEditorState.statusText ?? '',
        goalTypeValue: courseEditorState.goalTypeValue,
        goalTypeDisabled: courseEditorState.goalTypeDisabled,
        timeLimitHidden: courseEditorState.timeLimitHidden,
        timeLimitDisabled: courseEditorState.timeLimitDisabled,
        timeLimitValue: courseEditorState.timeLimitValue,
        requiredCountHidden: courseEditorState.requiredCountHidden,
        requiredCountDisabled: courseEditorState.requiredCountDisabled,
        requiredCountValue: courseEditorState.requiredCountValue,
        survivalHidden: courseEditorState.survivalHidden,
        survivalDisabled: courseEditorState.survivalDisabled,
        survivalValue: courseEditorState.survivalValue,
        markerControlsHidden: courseEditorState.markerControlsHidden,
        placementHintHidden: courseEditorState.placementHintHidden,
        placementHintText: courseEditorState.placementHintText,
        summaryText: courseEditorState.summaryText,
        placeStartHidden: courseEditorState.placeStartHidden,
        placeStartActive: courseEditorState.placeStartActive,
        placeExitHidden: courseEditorState.placeExitHidden,
        placeExitActive: courseEditorState.placeExitActive,
        addCheckpointHidden: courseEditorState.addCheckpointHidden,
        addCheckpointActive: courseEditorState.addCheckpointActive,
        placeFinishHidden: courseEditorState.placeFinishHidden,
        placeFinishActive: courseEditorState.placeFinishActive,
      },
    });
  }

  private initializeEditorPresence(): void {
    this.editorPresenceClient?.destroy();
    this.editorPresenceClient = null;

    const config = resolveWorldPresenceConfig();
    if (!config) {
      return;
    }

    this.editorPresenceClient = new WorldPresenceClient({
      ...config,
      identity: resolveWorldPresenceIdentity(),
      onSnapshot: () => {
        // Editor presence only publishes activity to the overworld.
      },
    });
    this.editorPresenceClient.setSubscribedShards([
      roomToChunkCoordinates(this.roomCoordinates),
    ]);
    this.syncEditorPresence();
  }

  private syncEditorPresence(): void {
    if (!this.editorPresenceClient || !this.scene.isActive(this.scene.key) || editorState.isPlaying) {
      this.editorPresenceClient?.updateLocalPresence(null);
      return;
    }

    this.editorPresenceClient.updateLocalPresence({
      roomCoordinates: { ...this.roomCoordinates },
      x: ROOM_PX_WIDTH * 0.5,
      y: ROOM_PX_HEIGHT * 0.5,
      velocityX: 0,
      velocityY: 0,
      facing: 1,
      animationState: 'idle',
      mode: 'edit',
      timestamp: Date.now(),
    });
  }

  private maybeTriggerPublishNudge(): void {
    if (this.publishNudgeTriggered || !this.shouldShowPublishNudge()) {
      return;
    }

    this.publishNudgeTriggered = true;
    if (!getAuthDebugState().authenticated) {
      promptForSignIn('People can’t see this room until you publish it. Sign in to publish.');
      return;
    }

    this.roomSession.setStatusText('Draft only. Not visible in the world until published.');
  }

  private shouldShowPublishNudge(): boolean {
    return (
      this.publishedVersion === 0
      && this.roomPermissions.canSaveDraft
      && !this.mintedTokenId
      && this.roomEditCount >= this.PUBLISH_NUDGE_EDIT_THRESHOLD
    );
  }

  // ── Public API for UI ──

  getMap(): Phaser.Tilemaps.Tilemap {
    return this.map;
  }

  setRoomTitle(nextTitle: string | null): void {
    const normalized = typeof nextTitle === 'string' ? nextTitle.trim().slice(0, 40) || null : null;
    if (this.roomTitle === normalized) {
      return;
    }

    this.roomTitle = normalized;
    this.markRoomDirty();
    this.renderEditorUi();
  }

  getLayers(): Map<string, Phaser.Tilemaps.TilemapLayer> {
    return this.layers;
  }

  getHistoryState(): {
    roomId: string;
    claimerDisplayName: string | null;
    claimedAt: string | null;
    canRevert: boolean;
    canPublish: boolean;
    canMint: boolean;
    mintedTokenId: string | null;
    mintedOwnerWalletAddress: string | null;
    versions: RoomVersionRecord[];
  } {
    return this.roomSession.getHistoryState();
  }

  async returnToWorld(): Promise<void> {
    showBusyOverlay('Returning to world...', 'Saving room state...');
    const wakeData = await this.roomSession.buildReturnToWorldWakeData();
    if (!wakeData) {
      showBusyError(this.persistenceStatusText || 'Failed to return to world.', {
        closeHandler: () => hideBusyOverlay(),
      });
      return;
    }

    wakeData.courseEditorReturned = Boolean(this.activeCourseMarkerEdit);
    wakeData.courseEditedRoom = this.buildCourseEditedRoomData();

    this.scene.stop();
    this.scene.wake('OverworldPlayScene', wakeData);
  }

  async mintRoom(): Promise<RoomRecord | null> {
    return this.roomSession.mintRoom();
  }

  undoAction(): void {
    this.undo();
    this.updateBottomBar();
  }

  redoAction(): void {
    this.redo();
    this.updateBottomBar();
  }

  describeState(): Record<string, unknown> {
    return {
      scene: 'editor',
      roomId: this.roomId,
      coordinates: { ...this.roomCoordinates },
      source: this.entrySource,
      roomVersion: this.roomVersion,
      publishedVersion: this.publishedVersion,
      versionHistoryCount: this.roomVersionHistory.length,
      roomDirty: this.roomDirty,
      claimerDisplayName: this.claimerDisplayName,
      mintedChainId: this.mintedChainId,
      mintedContractAddress: this.mintedContractAddress,
      mintedTokenId: this.mintedTokenId,
      mintedOwnerWalletAddress: this.mintedOwnerWalletAddress,
      mintedOwnerSyncedAt: this.mintedOwnerSyncedAt,
      canSaveDraft: this.roomPermissions.canSaveDraft,
      canPublish: this.roomPermissions.canPublish,
      canRevert: this.roomPermissions.canRevert,
      canMint: this.roomPermissions.canMint,
      background: editorState.selectedBackground,
      goal: cloneRoomGoal(this.roomGoal),
      goalPlacementMode: this.goalPlacementMode,
      courseEdit: this.activeCourseMarkerEdit
        ? {
            courseId: this.activeCourseMarkerEdit.courseId,
            roomId: this.activeCourseMarkerEdit.roomId,
            roomOrder: this.activeCourseMarkerEdit.roomOrder,
          }
        : null,
      spawnPoint: this.roomSpawnPoint ? { ...this.roomSpawnPoint } : null,
      backgroundLayerCount: this.backgroundController.backgroundLayerCount,
      hasBackgroundCamera: this.backgroundController.hasBackgroundCamera,
      activeTool: editorState.activeTool,
      selectedLayer: editorState.activeLayer,
      zoom: editorState.zoom,
      camera: {
        scrollX: Math.round(this.cameras.main.scrollX),
        scrollY: Math.round(this.cameras.main.scrollY),
      },
      placedObjects: editorState.placedObjects.length,
      canUndo: this.editRuntime.hasUndoHistory(),
      canRedo: this.editRuntime.hasRedoHistory(),
      isPlaying: editorState.isPlaying,
    };
  }
}
