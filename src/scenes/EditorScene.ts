import Phaser from 'phaser';
import {
  AUTH_STATE_CHANGED_EVENT,
  getAuthDebugState,
  promptForSignIn,
} from '../auth/client';
import {
  canObjectBeStoredInContainer,
  canPlacedObjectBeContainer,
  TILE_SIZE,
  ROOM_WIDTH,
  ROOM_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_PX_HEIGHT,
  LAYER_NAMES,
  TILESETS,
  canPlacedObjectBePressurePlateTarget,
  canPlacedObjectTriggerOtherObjects,
  editorState,
  getObjectById,
  getPlacedObjectLayer,
  type LayerName,
  type PlacedObject,
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
  type RoomGoal,
  type RoomGoalType,
} from '../goals/roomGoals';
import {
  createGoalMarkerFlagSprite,
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
import { EditorEditRuntime, type EditorClipboardState, type GoalPlacementMode } from './editor/editRuntime';
import { EditorInteractionController } from './editor/interaction';
import {
  buildCourseEditedRoomData as buildCourseEditedRoomDataHelper,
  buildCourseEditorState,
  buildCourseMarkerDescriptors,
} from './editor/courseEditing';
import {
  buildEditorPlayModeData,
  getSelectedCoursePreviewForPlay as getSelectedCoursePreviewForPlayHelper,
} from './editor/playMode';
import {
  buildEditorUiViewModel,
  shouldShowPublishNudge as shouldShowPublishNudgeHelper,
} from './editor/viewModel';
import type { EditorCourseUiState } from '../ui/setup/sceneBridge';
import type { EditorInspectorState } from './editor/uiBridge';

const EDITOR_NEIGHBOR_RADIUS = 1;
type EditorMarkerPlacementMode = GoalPlacementMode | 'start';

export class EditorScene extends Phaser.Scene {
  private readonly PUBLISH_NUDGE_EDIT_THRESHOLD = 10;
  private readonly SHARED_PREVIEW_PUBLISH_INTERVAL_MS = 1_200;
  private uiBridge: EditorUiBridge | null = null;
  private layerIndicatorText: Phaser.GameObjects.Text | null = null;
  private layerGuideGraphics: Phaser.GameObjects.Graphics | null = null;
  private pressurePlateGraphics: Phaser.GameObjects.Graphics | null = null;
  private containerGraphics: Phaser.GameObjects.Graphics | null = null;
  private editorPresenceClient: WorldPresenceClient | null = null;
  private sharedConstructionPreviewDirty = true;
  private lastSharedConstructionPreviewPublishAt = 0;
  private lastSharedConstructionPreviewStateKey: string | null = null;
  private courseMarkerSprites: Phaser.GameObjects.Sprite[] = [];
  private courseMarkerLabels: Phaser.GameObjects.Text[] = [];
  private activeCourseMarkerEdit: EditorCourseEditData | null = null;
  private courseGoalPlacementMode: EditorMarkerPlacementMode = null;
  private focusedPressurePlateInstanceId: string | null = null;
  private connectingPressurePlateInstanceId: string | null = null;
  private pressurePlateStatusText: string | null = null;
  private focusedContainerInstanceId: string | null = null;
  private containerStatusText: string | null = null;
  private pinnedInspector: { kind: 'pressure' | 'container'; instanceId: string } | null = null;
  private clipboardPastePreviewActive = false;
  private lastCopySelection: { x1: number; y1: number; x2: number; y2: number } | null = null;
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
    if (key === 'escape') {
      event.preventDefault();
      event.stopPropagation();
      if (this.connectingPressurePlateInstanceId) {
        this.cancelPressurePlateConnection();
        return;
      }

      if (this.clipboardPastePreviewActive) {
        this.cancelClipboardPastePreview();
        return;
      }

      if (this.pinnedInspector) {
        this.clearPinnedInspector();
        return;
      }

      if (this.getCourseEditorState().canReturnToCourseBuilder) {
        void this.returnToCourseBuilder();
      } else {
        void this.returnToWorld();
      }
      return;
    }

    const primaryModifier = event.metaKey || event.ctrlKey;
    if (primaryModifier && key === 's') {
      event.preventDefault();
      event.stopPropagation();
      void this.saveDraft(true, { promptForSignInOnUnauthorized: true });
      return;
    }

    if (primaryModifier && event.shiftKey && key === 'p') {
      event.preventDefault();
      event.stopPropagation();
      void this.publishRoom();
      return;
    }

    if (primaryModifier && key === 'v') {
      if (!this.editRuntime.hasClipboardTiles() || editorState.paletteMode !== 'tiles') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.beginClipboardPastePreview();
      return;
    }

    if (primaryModifier && key === 'c' && editorState.paletteMode === 'tiles' && editorState.activeTool === 'copy') {
      if (!this.lastCopySelection) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.captureCopySelection(
        this.lastCopySelection.x1,
        this.lastCopySelection.y1,
        this.lastCopySelection.x2,
        this.lastCopySelection.y2,
      );
      return;
    }

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
      return;
    }

    if (event.code === 'Digit1') {
      event.preventDefault();
      editorState.activeTool = 'pencil';
      this.updateToolUI();
      return;
    }

    if (event.code === 'Digit2') {
      event.preventDefault();
      editorState.activeTool = 'eraser';
      this.cancelClipboardPastePreview();
      this.updateToolUI();
      return;
    }

    if (event.code === 'Digit3') {
      event.preventDefault();
      editorState.activeTool = 'copy';
      this.updateToolUI();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      void this.startPlayMode();
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
      handleObjectModePrimaryAction: (pointer) => this.handleObjectModePrimaryAction(pointer),
      handleObjectModeSecondaryAction: (worldX, worldY) =>
        this.handleObjectModeSecondaryAction(worldX, worldY),
      handleObjectPlace: (pointer) => this.handleObjectPlace(pointer),
      handleToolDown: (pointer) => this.handleToolDown(pointer),
      removeGoalMarkerAt: (worldX, worldY) => this.removeGoalMarkerAt(worldX, worldY),
      removeObjectAt: (worldX, worldY) => this.removeObjectAt(worldX, worldY),
      placeGoalMarker: (tileX, tileY) => this.placeGoalMarker(tileX, tileY),
      placeTileAt: (worldX, worldY) => this.placeTileAt(worldX, worldY),
      eraseTileAt: (worldX, worldY) => this.eraseTileAt(worldX, worldY),
      fillRect: (x1, y1, x2, y2) => this.fillRect(x1, y1, x2, y2),
      captureCopySelection: (x1, y1, x2, y2) => this.captureCopySelection(x1, y1, x2, y2),
      getClipboardPreview: () => this.getClipboardPreview(),
      isClipboardPastePreviewActive: () => this.isClipboardPastePreviewActive(),
      pasteClipboardAt: (tileX, tileY) => this.pasteClipboardAt(tileX, tileY),
      cancelClipboardPastePreview: () => this.cancelClipboardPastePreview(),
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
    return buildCourseEditedRoomDataHelper(this.activeCourseMarkerEdit);
  }

  private getAdjacentCourseEdit(offset: -1 | 1): EditorCourseEditData | null {
    const courseEdit = this.activeCourseMarkerEdit;
    const draft = this.activeCourseDraft;
    if (!courseEdit || !draft || courseEdit.roomOrder === null) {
      return null;
    }

    const nextOrder = courseEdit.roomOrder + offset;
    const nextRoomRef = draft.roomRefs[nextOrder] ?? null;
    if (!nextRoomRef) {
      return null;
    }

    return {
      courseId: courseEdit.courseId,
      roomId: nextRoomRef.roomId,
      roomOrder: nextOrder,
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

  private redrawCourseGoalMarkers(): void {
    this.destroyCourseMarkerOverlays();
    const markers = buildCourseMarkerDescriptors(this.activeCourseDraft, this.roomId);
    if (markers.length === 0) {
      this.syncBackgroundCameraIgnores();
      return;
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
    return buildCourseEditorState({
      activeCourseMarkerEdit: this.activeCourseMarkerEdit,
      courseEditorStatusText: this.courseEditorStatusText,
      draft: this.activeCourseDraft,
      activeGoal: this.activeCourseGoal,
      coursePlacementMode: this.courseGoalPlacementMode,
    });
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
    this.createPressurePlateOverlay();
    this.createContainerOverlay();
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
    this.updatePressurePlateOverlay();
    this.updateContainerOverlay();
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
    this.pressurePlateGraphics?.destroy();
    this.pressurePlateGraphics = null;
    this.containerGraphics?.destroy();
    this.containerGraphics = null;
    this.tilesets = new Map();
    this.layers = new Map();
    this.editRuntime.reset();
    this.roomSession.reset();
    this.courseEditorStatusText = null;
    this.activeCourseMarkerEdit = null;
    this.courseGoalPlacementMode = null;
    this.focusedPressurePlateInstanceId = null;
    this.connectingPressurePlateInstanceId = null;
    this.pressurePlateStatusText = null;
    this.focusedContainerInstanceId = null;
    this.containerStatusText = null;
    this.pinnedInspector = null;
    this.clipboardPastePreviewActive = false;
    this.lastCopySelection = null;
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
    this.flushSharedConstructionPreviewForExit();
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

  private applyRoomSnapshot(room: RoomSnapshot): void {
    this.editRuntime.applyRoomSnapshot(room);
    this.focusedPressurePlateInstanceId = null;
    this.connectingPressurePlateInstanceId = null;
    this.pressurePlateStatusText = null;
    this.focusedContainerInstanceId = null;
    this.containerStatusText = null;
    this.pinnedInspector = null;
    this.clipboardPastePreviewActive = false;
    this.lastCopySelection = null;
    this.renderPressurePlatePanel();
    this.renderContainerContentsPanel();
  }

  private exportRoomSnapshot(): RoomSnapshot {
    return this.editRuntime.exportRoomSnapshot();
  }

  private maybeAutoSave(_time: number): void {
    this.roomSession.maybeAutoSave(editorState.isPlaying);
  }

  private getDirtyPersistenceStatusText(): string {
    return this.roomPermissions.canSaveDraft
      ? 'Draft changes...'
      : 'Read-only minted room. Changes are local only.';
  }

  private markRoomDirty(): void {
    this.editRuntime.isRoomDirty = true;
    this.editRuntime.currentLastDirtyAt = performance.now();
    this.roomEditCount += 1;
    this.sharedConstructionPreviewDirty = true;
    this.updatePersistenceStatus(this.getDirtyPersistenceStatusText());
    this.maybeTriggerPublishNudge();
  }

  private updatePersistenceStatus(text: string): void {
    this.roomSession.setStatusText(text);
  }

  private restorePersistenceStatus(): void {
    if (this.roomDirty) {
      this.updatePersistenceStatus(this.getDirtyPersistenceStatusText());
      return;
    }

    this.roomSession.setStatusDetails(this.roomSession.getIdleStatusDetails());
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

  private createPressurePlateOverlay(): void {
    this.pressurePlateGraphics?.destroy();
    this.pressurePlateGraphics = this.add.graphics();
    this.pressurePlateGraphics.setDepth(99);
  }

  private createContainerOverlay(): void {
    this.containerGraphics?.destroy();
    this.containerGraphics = this.add.graphics();
    this.containerGraphics.setDepth(98);
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

  private updatePressurePlateOverlay(): void {
    this.pressurePlateGraphics?.clear();
    if (!this.pressurePlateGraphics || editorState.isPlaying) {
      this.renderPressurePlatePanel();
      return;
    }

    if (
      this.focusedPressurePlateInstanceId &&
      !this.editRuntime.hasPlacedObjectInstanceId(this.focusedPressurePlateInstanceId)
    ) {
      this.focusedPressurePlateInstanceId = null;
    }
    if (
      this.connectingPressurePlateInstanceId &&
      !this.editRuntime.hasPlacedObjectInstanceId(this.connectingPressurePlateInstanceId)
    ) {
      this.connectingPressurePlateInstanceId = null;
    }
    if (
      this.pinnedInspector?.kind === 'pressure' &&
      !this.editRuntime.hasPlacedObjectInstanceId(this.pinnedInspector.instanceId)
    ) {
      this.pinnedInspector = null;
    }

    const pointer = this.input.activePointer;
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (!this.connectingPressurePlateInstanceId) {
      const hoveredTrigger = this.editRuntime.findPlacedObjectAt(
        worldPoint.x,
        worldPoint.y,
        (placed) => canPlacedObjectTriggerOtherObjects(placed)
      );
      if (hoveredTrigger) {
        if (this.focusedPressurePlateInstanceId !== hoveredTrigger.instanceId) {
          this.pressurePlateStatusText = null;
        }
        this.focusedPressurePlateInstanceId = hoveredTrigger.instanceId;
      } else if (this.pinnedInspector?.kind !== 'pressure') {
        this.focusedPressurePlateInstanceId = null;
      }
    }

    const source = this.getFocusedPressurePlate();
    if (!source) {
      this.renderPressurePlatePanel();
      return;
    }

    const currentTarget = this.editRuntime.getPlacedObjectByInstanceId(source.triggerTargetInstanceId ?? null);
    if (currentTarget) {
      this.drawPressurePlateLink(source, currentTarget, 0x6dd5ff, 0.9);
    }

    const sourceBounds = this.editRuntime.getPlacedObjectBounds(source);
    this.pressurePlateGraphics.lineStyle(2, 0xc3f4ff, 0.88);
    this.pressurePlateGraphics.strokeRoundedRect(
      sourceBounds.x,
      sourceBounds.y,
      sourceBounds.width,
      sourceBounds.height,
      6,
    );

    if (this.connectingPressurePlateInstanceId === source.instanceId) {
      const hoveredTarget = this.editRuntime.findPlacedObjectAt(
        worldPoint.x,
        worldPoint.y,
        (placed) => canPlacedObjectBePressurePlateTarget(placed) && placed.instanceId !== source.instanceId
      );
      const eligibleTargets = this.editRuntime.getPressurePlateEligibleTargets(source.instanceId);
      for (const target of eligibleTargets) {
        const bounds = this.editRuntime.getPlacedObjectBounds(target);
        this.pressurePlateGraphics.lineStyle(
          2,
          hoveredTarget?.instanceId === target.instanceId ? 0x9dff8a : 0x7ad3ff,
          hoveredTarget?.instanceId === target.instanceId ? 0.95 : 0.55,
        );
        this.pressurePlateGraphics.strokeRoundedRect(
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
          6,
        );
      }

      if (hoveredTarget) {
        this.drawPressurePlateLink(source, hoveredTarget, 0x9dff8a, 0.95);
      } else {
        this.pressurePlateGraphics.lineStyle(2, 0xffd36b, 0.5);
        this.pressurePlateGraphics.beginPath();
        this.pressurePlateGraphics.moveTo(source.x, source.y - 4);
        this.pressurePlateGraphics.lineTo(worldPoint.x, worldPoint.y);
        this.pressurePlateGraphics.strokePath();
      }
    }

    this.renderPressurePlatePanel();
  }

  private drawPressurePlateLink(
    source: PlacedObject,
    target: PlacedObject,
    color: number,
    alpha: number,
  ): void {
    if (!this.pressurePlateGraphics) {
      return;
    }

    this.pressurePlateGraphics.lineStyle(2, color, alpha);
    this.pressurePlateGraphics.beginPath();
    this.pressurePlateGraphics.moveTo(source.x, source.y - 4);
    this.pressurePlateGraphics.lineTo(target.x, target.y - 6);
    this.pressurePlateGraphics.strokePath();
    this.pressurePlateGraphics.fillStyle(color, alpha * 0.9);
    this.pressurePlateGraphics.fillCircle(source.x, source.y - 4, 3);
    this.pressurePlateGraphics.fillCircle(target.x, target.y - 6, 3);
  }

  private renderPressurePlatePanel(): void {
    this.renderInspectorUi();
  }

  private updateContainerOverlay(): void {
    this.containerGraphics?.clear();
    if (
      !this.containerGraphics ||
      editorState.isPlaying ||
      this.connectingPressurePlateInstanceId
    ) {
      this.renderContainerContentsPanel();
      return;
    }

    if (
      this.focusedContainerInstanceId &&
      !this.editRuntime.hasPlacedObjectInstanceId(this.focusedContainerInstanceId)
    ) {
      this.focusedContainerInstanceId = null;
    }
    if (
      this.pinnedInspector?.kind === 'container' &&
      !this.editRuntime.hasPlacedObjectInstanceId(this.pinnedInspector.instanceId)
    ) {
      this.pinnedInspector = null;
    }

    const pointer = this.input.activePointer;
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const hoveredContainer = this.editRuntime.findPlacedObjectAt(
      worldPoint.x,
      worldPoint.y,
      (placed) => canPlacedObjectBeContainer(placed)
    );
    if (hoveredContainer) {
      if (this.focusedContainerInstanceId !== hoveredContainer.instanceId) {
        this.containerStatusText = null;
      }
      this.focusedContainerInstanceId = hoveredContainer.instanceId;
    } else if (this.pinnedInspector?.kind !== 'container') {
      this.focusedContainerInstanceId = null;
    }

    const focused = this.getFocusedContainer();
    if (!focused) {
      this.renderContainerContentsPanel();
      return;
    }

    const bounds = this.editRuntime.getPlacedObjectBounds(focused);
    const selectedObject = editorState.selectedObjectId
      ? getObjectById(editorState.selectedObjectId)
      : null;
    const canStoreSelected = canObjectBeStoredInContainer(focused.id, selectedObject);
    const selectedObjectLooksLikeContents =
      selectedObject?.category === 'enemy' || selectedObject?.category === 'collectible';
    const strokeColor = canStoreSelected
      ? 0x9dff8a
      : selectedObjectLooksLikeContents
        ? 0xffc76b
        : 0xffe0a6;
    const strokeAlpha = canStoreSelected ? 0.92 : 0.74;
    this.containerGraphics.lineStyle(2, strokeColor, strokeAlpha);
    this.containerGraphics.strokeRoundedRect(
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      6,
    );
    this.containerGraphics.fillStyle(strokeColor, 0.86);
    this.containerGraphics.fillCircle(focused.x, focused.y - 6, 3);

    this.renderContainerContentsPanel();
  }

  private renderContainerContentsPanel(): void {
    this.renderInspectorUi();
  }

  private createEmptyInspectorState(): EditorInspectorState {
    return {
      visible: false,
      pressureVisible: false,
      pressureStatusText: '',
      pressureConnectHidden: true,
      pressureConnectDisabled: true,
      pressureConnectTitle: '',
      pressureClearHidden: true,
      pressureClearDisabled: true,
      pressureDoneLaterHidden: true,
      containerVisible: false,
      containerStatusText: '',
      containerClearDisabled: true,
      containerClearTitle: '',
    };
  }

  private renderInspectorUi(): void {
    const hiddenState = this.createEmptyInspectorState();
    if (editorState.isPlaying) {
      this.uiBridge?.renderInspector(hiddenState);
      return;
    }

    const connectMode = this.connectingPressurePlateInstanceId !== null;
    const source =
      this.pinnedInspector?.kind === 'container' && !connectMode
        ? null
        : this.getFocusedPressurePlate();
    if (source && (editorState.paletteMode === 'objects' || connectMode)) {
      const target = this.editRuntime.getPlacedObjectByInstanceId(source.triggerTargetInstanceId ?? null);
      const eligibleTargetCount = this.editRuntime.getPressurePlateEligibleTargets(source.instanceId).length;
      const state: EditorInspectorState = {
        ...hiddenState,
        visible: true,
        pressureVisible: true,
        pressureStatusText:
          this.pressurePlateStatusText ??
          (connectMode
            ? eligibleTargetCount > 0
              ? 'Click a door, metal door, cage, or chest to link this pressure plate.'
              : 'No door, metal door, cage, or chest is in this room yet.'
            : target
              ? `Linked to ${this.getPressurePlateTargetLabel(target.id)}.`
              : 'This pressure plate is not linked yet.'),
        pressureConnectHidden: connectMode,
        pressureConnectDisabled: connectMode || eligibleTargetCount === 0,
        pressureConnectTitle: eligibleTargetCount === 0 ? 'Add a door, metal door, cage, or chest first.' : '',
        pressureClearHidden: connectMode,
        pressureClearDisabled: !target,
        pressureDoneLaterHidden: !connectMode,
      };
      this.uiBridge?.renderInspector(state);
      return;
    }

    const focusedContainer =
      this.pinnedInspector?.kind === 'pressure' && !connectMode
        ? null
        : this.getFocusedContainer();
    if (
      focusedContainer &&
      editorState.paletteMode === 'objects' &&
      !this.connectingPressurePlateInstanceId
    ) {
      const selectedObject = editorState.selectedObjectId
        ? getObjectById(editorState.selectedObjectId)
        : null;
      const selectedLooksLikeContents =
        selectedObject?.category === 'enemy' || selectedObject?.category === 'collectible';
      const canStoreSelected = canObjectBeStoredInContainer(focusedContainer.id, selectedObject);
      const currentContentsLabel = this.editRuntime.getContainerContentsLabel(focusedContainer);
      const state: EditorInspectorState = {
        ...hiddenState,
        visible: true,
        containerVisible: true,
        containerStatusText:
          this.containerStatusText ??
          (canStoreSelected && selectedObject
            ? `Click this ${this.getContainerLabel(focusedContainer.id)} to stash ${selectedObject.name} inside.`
            : selectedLooksLikeContents && selectedObject
              ? `${this.getContainerName(focusedContainer.id)} can only hold ${this.getContainerAcceptedContentsLabel(focusedContainer.id)}.`
              : currentContentsLabel
                ? `${this.getContainerName(focusedContainer.id)} currently holds ${currentContentsLabel}. Select a ${this.getContainerAcceptedContentsLabel(focusedContainer.id)} and click it to change the contents.`
                : `${this.getContainerName(focusedContainer.id)} is empty. Select a ${this.getContainerAcceptedContentsLabel(focusedContainer.id)} from the object list, then click it to fill the container.`),
        containerClearDisabled: !focusedContainer.containedObjectId,
        containerClearTitle: focusedContainer.containedObjectId ? '' : 'This container is empty.',
      };
      this.uiBridge?.renderInspector(state);
      return;
    }

    this.uiBridge?.renderInspector(hiddenState);
  }

  private updateLayerGuideOverlay(): void {
    this.layerGuideGraphics?.clear();
    if (!this.layerGuideGraphics || editorState.isPlaying || !editorState.showLayerGuides) {
      return;
    }

    for (const layerName of LAYER_NAMES) {
      const occupiedCells = this.collectLayerGuideCells(layerName);
      if (occupiedCells.size === 0) {
        continue;
      }

      this.layerGuideGraphics.fillStyle(this.getLayerGuideColor(layerName), 0.72);
      for (const key of occupiedCells) {
        const [xText, yText] = key.split(':');
        const tileX = Number.parseInt(xText, 10);
        const tileY = Number.parseInt(yText, 10);
        this.layerGuideGraphics.fillCircle(
          tileX * TILE_SIZE + TILE_SIZE * 0.5,
          tileY * TILE_SIZE + TILE_SIZE * 0.5,
          2.5,
        );
      }
    }
  }

  private collectLayerGuideCells(layerName: LayerName): Set<string> {
    const occupiedCells = new Set<string>();
    const layer = this.layers.get(layerName);
    if (layer) {
      for (let y = 0; y < ROOM_HEIGHT; y += 1) {
        for (let x = 0; x < ROOM_WIDTH; x += 1) {
          if (layer.getTileAt(x, y)) {
            occupiedCells.add(this.getLayerGuideCellKey(x, y));
          }
        }
      }
    }

    for (const placedObject of editorState.placedObjects) {
      const objectConfig = getObjectById(placedObject.id);
      if (!objectConfig || getPlacedObjectLayer(placedObject) !== layerName) {
        continue;
      }

      const previewWidth = objectConfig.previewWidth ?? objectConfig.frameWidth;
      const previewHeight = objectConfig.previewHeight ?? objectConfig.frameHeight;
      const previewOffsetX = objectConfig.previewOffsetX ?? 0;
      const previewOffsetY = objectConfig.previewOffsetY ?? 0;
      const minTileX = Math.max(
        0,
        Math.floor((placedObject.x - objectConfig.frameWidth * 0.5 + previewOffsetX) / TILE_SIZE),
      );
      const maxTileX = Math.min(
        ROOM_WIDTH,
        Math.ceil((placedObject.x - objectConfig.frameWidth * 0.5 + previewOffsetX + previewWidth) / TILE_SIZE),
      );
      const minTileY = Math.max(
        0,
        Math.floor((placedObject.y - objectConfig.frameHeight * 0.5 + previewOffsetY) / TILE_SIZE),
      );
      const maxTileY = Math.min(
        ROOM_HEIGHT,
        Math.ceil((placedObject.y - objectConfig.frameHeight * 0.5 + previewOffsetY + previewHeight) / TILE_SIZE),
      );
      for (let tileY = minTileY; tileY < maxTileY; tileY += 1) {
        for (let tileX = minTileX; tileX < maxTileX; tileX += 1) {
          occupiedCells.add(this.getLayerGuideCellKey(tileX, tileY));
        }
      }
    }

    return occupiedCells;
  }

  private getLayerGuideCellKey(x: number, y: number): string {
    return `${x}:${y}`;
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
        ? 'Gameplay'
        : editorState.activeLayer === 'background'
          ? 'Back'
          : 'Front';
    const layerColor =
      editorState.activeLayer === 'terrain'
        ? '#347433'
        : editorState.activeLayer === 'background'
          ? '#2f6b7f'
          : '#ff6f3c';
    const modeLabel = editorState.paletteMode === 'objects' ? 'Objects' : 'Tiles';
    const toolLabel =
      editorState.activeTool === 'eraser'
        ? `Erase ${editorState.eraserBrushSize}x${editorState.eraserBrushSize}`
        : editorState.activeTool === 'rect'
          ? 'Rect'
          : editorState.activeTool === 'fill'
            ? 'Fill'
            : editorState.activeTool === 'copy'
              ? this.clipboardPastePreviewActive
                ? 'Paste'
                : 'Copy'
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

  private handleObjectModePrimaryAction(pointer: Phaser.Input.Pointer): boolean {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (this.connectingPressurePlateInstanceId) {
      return this.handlePressurePlateConnectionClick(worldPoint.x, worldPoint.y);
    }

    const clickedPressurePlate = this.editRuntime.findPlacedObjectAt(
      worldPoint.x,
      worldPoint.y,
      (placed) => canPlacedObjectTriggerOtherObjects(placed)
    );
    if (clickedPressurePlate) {
      this.focusedPressurePlateInstanceId = clickedPressurePlate.instanceId;
      this.focusedContainerInstanceId = null;
      this.pinInspector('pressure', clickedPressurePlate.instanceId);
      this.pressurePlateStatusText = null;
      this.renderPressurePlatePanel();
      return true;
    }

    if (this.handleContainerContentsClick(worldPoint.x, worldPoint.y)) {
      return true;
    }

    if (this.pinnedInspector) {
      const hasSelectedObject = Boolean(editorState.selectedObjectId);
      this.clearPinnedInspector();
      return !hasSelectedObject;
    }

    return false;
  }

  private handleObjectModeSecondaryAction(worldX: number, worldY: number): boolean {
    if (!this.connectingPressurePlateInstanceId) {
      return false;
    }

    if (this.editRuntime.canRemoveObjectAt(worldX, worldY)) {
      return false;
    }

    this.cancelPressurePlateConnection();
    return true;
  }

  private handleObjectPlace(pointer: Phaser.Input.Pointer): void {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tileX = Math.floor(worldPoint.x / TILE_SIZE);
    const tileY = Math.floor(worldPoint.y / TILE_SIZE);
    const placed = this.editRuntime.handleObjectPlace(worldPoint.x, worldPoint.y, tileX, tileY);
    if (placed && canPlacedObjectTriggerOtherObjects(placed)) {
      this.focusedContainerInstanceId = null;
      this.focusedPressurePlateInstanceId = placed.instanceId;
      this.pinInspector('pressure', placed.instanceId);
      this.beginPressurePlateConnection(placed.instanceId, true);
    } else if (placed && canPlacedObjectBeContainer(placed)) {
      this.focusedContainerInstanceId = placed.instanceId;
      this.focusedPressurePlateInstanceId = null;
      this.pinInspector('container', placed.instanceId);
      this.containerStatusText = `${this.getContainerName(placed.id)} placed. Select a ${this.getContainerAcceptedContentsLabel(placed.id)} and click it to fill the container.`;
      this.renderContainerContentsPanel();
    }
  }

  private removeObjectAt(worldX: number, worldY: number): void {
    const removed = this.editRuntime.removeObjectAt(worldX, worldY);
    if (!removed) {
      return;
    }

    if (removed.instanceId === this.connectingPressurePlateInstanceId) {
      this.connectingPressurePlateInstanceId = null;
    }
    if (removed.instanceId === this.focusedPressurePlateInstanceId) {
      this.focusedPressurePlateInstanceId = null;
    }
    if (removed.instanceId === this.focusedContainerInstanceId) {
      this.focusedContainerInstanceId = null;
    }
    if (this.pinnedInspector?.instanceId === removed.instanceId) {
      this.pinnedInspector = null;
    }
    if (canPlacedObjectBePressurePlateTarget(removed)) {
      this.pressurePlateStatusText = `${this.getPressurePlateTargetLabel(removed.id)} removed. Linked plates were cleared.`;
    }
    if (canPlacedObjectBeContainer(removed)) {
      this.containerStatusText = `${this.getContainerName(removed.id)} removed.`;
    }
    this.renderPressurePlatePanel();
    this.renderContainerContentsPanel();
  }

  rebuildObjectSprites(): void {
    this.editRuntime.rebuildObjectSprites();
    if (this.pinnedInspector && !this.editRuntime.hasPlacedObjectInstanceId(this.pinnedInspector.instanceId)) {
      this.pinnedInspector = null;
    }
    this.renderPressurePlatePanel();
    this.renderContainerContentsPanel();
  }

  beginFocusedPressurePlateConnection(): void {
    const focused = this.getFocusedPressurePlate();
    if (!focused) {
      this.pressurePlateStatusText = 'Hover or place a pressure plate first.';
      this.renderPressurePlatePanel();
      return;
    }

    this.beginPressurePlateConnection(focused.instanceId, false);
  }

  clearFocusedPressurePlateConnection(): void {
    const focused = this.getFocusedPressurePlate();
    if (!focused || !canPlacedObjectTriggerOtherObjects(focused)) {
      return;
    }

    if (this.editRuntime.setPressurePlateTarget(focused.instanceId, null)) {
      this.pressurePlateStatusText = 'Pressure plate link cleared.';
      this.connectingPressurePlateInstanceId = null;
      this.focusedPressurePlateInstanceId = focused.instanceId;
      this.pinInspector('pressure', focused.instanceId);
      this.renderPressurePlatePanel();
    }
  }

  cancelPressurePlateConnection(): void {
    if (!this.connectingPressurePlateInstanceId) {
      return;
    }

    this.connectingPressurePlateInstanceId = null;
    this.pressurePlateStatusText = 'Pressure plate left unlinked for now.';
    if (this.focusedPressurePlateInstanceId) {
      this.pinInspector('pressure', this.focusedPressurePlateInstanceId);
    }
    this.renderPressurePlatePanel();
  }

  clearFocusedContainerContents(): void {
    const focused = this.getFocusedContainer();
    if (!focused || !canPlacedObjectBeContainer(focused)) {
      return;
    }

    if (this.editRuntime.setContainerContents(focused.instanceId, null)) {
      this.focusedContainerInstanceId = focused.instanceId;
      this.pinInspector('container', focused.instanceId);
      this.containerStatusText = `${this.getContainerName(focused.id)} is now empty.`;
      this.renderContainerContentsPanel();
    }
  }

  private beginPressurePlateConnection(triggerInstanceId: string, autoPlaced: boolean): void {
    const trigger = this.editRuntime.getPlacedObjectByInstanceId(triggerInstanceId);
    if (!trigger || !canPlacedObjectTriggerOtherObjects(trigger)) {
      return;
    }

    this.focusedPressurePlateInstanceId = trigger.instanceId;
    this.connectingPressurePlateInstanceId = trigger.instanceId;
    this.pinInspector('pressure', trigger.instanceId);
    const eligibleTargets = this.editRuntime.getPressurePlateEligibleTargets(trigger.instanceId);
    this.pressurePlateStatusText =
      eligibleTargets.length > 0
        ? autoPlaced
          ? 'Pressure plate placed. Click a door, metal door, cage, or chest to link it.'
          : 'Click a door, metal door, cage, or chest to link this pressure plate.'
        : 'No door, metal door, cage, or chest is in this room yet. You can link this pressure plate later.';
    this.renderPressurePlatePanel();
  }

  private handlePressurePlateConnectionClick(worldX: number, worldY: number): boolean {
    const source = this.getConnectingPressurePlate();
    if (!source) {
      this.connectingPressurePlateInstanceId = null;
      return false;
    }

    const target = this.editRuntime.findPlacedObjectAt(
      worldX,
      worldY,
      (placed) => canPlacedObjectBePressurePlateTarget(placed) && placed.instanceId !== source.instanceId
    );
    if (!target) {
      this.pressurePlateStatusText = 'Pick a door, metal door, cage, or chest in this room.';
      this.renderPressurePlatePanel();
      return true;
    }

    if (this.editRuntime.setPressurePlateTarget(source.instanceId, target.instanceId)) {
      this.connectingPressurePlateInstanceId = null;
      this.focusedPressurePlateInstanceId = source.instanceId;
      this.pinInspector('pressure', source.instanceId);
      this.pressurePlateStatusText = `Pressure plate linked to ${this.getPressurePlateTargetLabel(target.id)}.`;
      this.renderPressurePlatePanel();
    }
    return true;
  }

  private handleContainerContentsClick(worldX: number, worldY: number): boolean {
    const focused = this.editRuntime.findPlacedObjectAt(
      worldX,
      worldY,
      (placed) => canPlacedObjectBeContainer(placed)
    );
    if (!focused || !focused.instanceId) {
      return false;
    }

    this.focusedContainerInstanceId = focused.instanceId;
    this.focusedPressurePlateInstanceId = null;
    this.pinInspector('container', focused.instanceId);
    const selectedObject = editorState.selectedObjectId
      ? getObjectById(editorState.selectedObjectId)
      : null;
    if (!selectedObject) {
      this.renderContainerContentsPanel();
      return true;
    }

    const selectedLooksLikeContents =
      selectedObject.category === 'enemy' || selectedObject.category === 'collectible';
    if (!selectedLooksLikeContents) {
      this.renderContainerContentsPanel();
      return true;
    }

    if (!canObjectBeStoredInContainer(focused.id, selectedObject)) {
      this.containerStatusText = `${this.getContainerName(focused.id)} can only hold ${this.getContainerAcceptedContentsLabel(focused.id)}.`;
      this.renderContainerContentsPanel();
      return true;
    }

    if (this.editRuntime.setContainerContents(focused.instanceId, selectedObject.id)) {
      this.containerStatusText = `${this.getContainerName(focused.id)} now holds ${selectedObject.name}.`;
      this.renderContainerContentsPanel();
      return true;
    }

    return true;
  }

  private pinInspector(kind: 'pressure' | 'container', instanceId: string): void {
    this.pinnedInspector = { kind, instanceId };
  }

  private clearPinnedInspector(): void {
    this.pinnedInspector = null;
    this.focusedPressurePlateInstanceId = null;
    this.focusedContainerInstanceId = null;
    this.pressurePlateStatusText = null;
    this.containerStatusText = null;
    this.renderInspectorUi();
  }

  private getFocusedPressurePlate(): PlacedObject | null {
    const pinnedPressureId = this.pinnedInspector?.kind === 'pressure'
      ? this.pinnedInspector.instanceId
      : null;
    const activeId = this.connectingPressurePlateInstanceId ?? pinnedPressureId ?? this.focusedPressurePlateInstanceId;
    const focused = this.editRuntime.getPlacedObjectByInstanceId(activeId);
    if (focused && canPlacedObjectTriggerOtherObjects(focused)) {
      return focused;
    }

    return null;
  }

  private getFocusedContainer(): PlacedObject | null {
    const pinnedContainerId = this.pinnedInspector?.kind === 'container'
      ? this.pinnedInspector.instanceId
      : null;
    const focused = this.editRuntime.getPlacedObjectByInstanceId(pinnedContainerId ?? this.focusedContainerInstanceId);
    if (focused && canPlacedObjectBeContainer(focused)) {
      return focused;
    }

    return null;
  }

  private getConnectingPressurePlate(): PlacedObject | null {
    const focused = this.editRuntime.getPlacedObjectByInstanceId(this.connectingPressurePlateInstanceId);
    if (focused && canPlacedObjectTriggerOtherObjects(focused)) {
      return focused;
    }

    return null;
  }

  private getPressurePlateTargetLabel(objectId: string): string {
    switch (objectId) {
      case 'door_locked':
        return 'door';
      case 'door_metal':
        return 'metal door';
      case 'treasure_chest':
        return 'treasure chest';
      case 'cage':
        return 'cage';
      default:
        return getObjectById(objectId)?.name ?? 'object';
    }
  }

  private getContainerLabel(objectId: string): string {
    return objectId === 'cage' ? 'cage' : 'treasure chest';
  }

  private getContainerName(objectId: string): string {
    return objectId === 'cage' ? 'This cage' : 'This treasure chest';
  }

  private getContainerAcceptedContentsLabel(objectId: string): string {
    return objectId === 'cage' ? 'enemies' : 'collectibles';
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
    return getSelectedCoursePreviewForPlayHelper(this.activeCourseDraft, this.roomId);
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

    switch (editorState.activeTool) {
      case 'pencil':
        this.editRuntime.beginTileBatch();
        this.placeTileAt(worldPoint.x, worldPoint.y);
        break;
      case 'eraser':
        this.editRuntime.beginTileBatch();
        this.eraseTileAt(worldPoint.x, worldPoint.y);
        break;
      case 'rect':
        this.editRuntime.beginTileBatch();
        this.interactionController.startRectDrawing(tileX, tileY);
        break;
      case 'fill':
        this.editRuntime.beginTileBatch();
        this.floodFill(tileX, tileY);
        this.editRuntime.commitTileBatch();
        break;
      case 'copy':
        this.interactionController.startRectDrawing(tileX, tileY);
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

  private captureCopySelection(x1: number, y1: number, x2: number, y2: number): void {
    if (editorState.paletteMode !== 'tiles') {
      return;
    }

    this.lastCopySelection = { x1, y1, x2, y2 };
    const copied = this.editRuntime.copyTilesToClipboard(x1, y1, x2, y2);
    if (!copied) {
      this.clipboardPastePreviewActive = false;
      this.updatePersistenceStatus('No tiles in that selection to copy.');
      this.renderEditorUi();
      return;
    }

    this.beginClipboardPastePreview();
    this.updatePersistenceStatus('Copied tile region. Move the mouse and click to place it.');
  }

  private getClipboardPreview(): EditorClipboardState | null {
    return this.editRuntime.currentClipboardState;
  }

  private isClipboardPastePreviewActive(): boolean {
    return this.clipboardPastePreviewActive;
  }

  private beginClipboardPastePreview(): void {
    if (!this.editRuntime.hasClipboardTiles() || editorState.paletteMode !== 'tiles') {
      return;
    }

    this.clipboardPastePreviewActive = true;
    editorState.activeTool = 'copy';
    this.updateToolUI();
    this.updatePersistenceStatus('Copy preview active. Move the mouse and click to place tiles, or press Esc to cancel.');
  }

  private cancelClipboardPastePreview(): void {
    if (!this.clipboardPastePreviewActive) {
      return;
    }

    this.clipboardPastePreviewActive = false;
    this.interactionController.clearShapePreview();
    this.restorePersistenceStatus();
  }

  private pasteClipboardAt(tileX: number, tileY: number): void {
    if (!this.clipboardPastePreviewActive) {
      return;
    }

    this.editRuntime.beginTileBatch();
    const pasted = this.editRuntime.pasteClipboardAt(tileX, tileY);
    this.editRuntime.commitTileBatch();
    if (!pasted) {
      this.updatePersistenceStatus('Nothing to paste at that position.');
      return;
    }

    this.updatePersistenceStatus('Pasted tile region. Click again to repeat, or press Esc to stop pasting.');
    this.renderEditorUi();
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
    this.cancelClipboardPastePreview();
    const coursePreview = this.getSelectedCoursePreviewForPlay();
    if (this.roomPermissions.canSaveDraft) {
      void this.saveDraft(true);
    }
    const currentRoomSnapshot = this.exportRoomSnapshot();
    // A saved draft on top of a published room is "clean" but still must stay on the draft path.
    const usePublishedCourseRoomVersion =
      !this.roomDirty &&
      this.publishedVersion > 0 &&
      !this.roomSession.hasDraftPreviewInWorld();
    this.syncActiveCourseRoomSessionSnapshot(currentRoomSnapshot, {
      published: usePublishedCourseRoomVersion,
    });
    const playData: OverworldPlaySceneData = buildEditorPlayModeData({
      roomCoordinates: this.roomCoordinates,
      roomSnapshot: currentRoomSnapshot,
      usePublishedCourseRoomVersion,
      coursePreview,
      courseEditedRoom: this.buildCourseEditedRoomData(),
    });

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

  updateToolUi(): void {
    this.updateToolUI();
  }

  // ══════════════════════════════════════
  // UI SYNC
  // ══════════════════════════════════════

  private updateToolUI(): void {
    if (this.clipboardPastePreviewActive && editorState.activeTool !== 'copy') {
      this.cancelClipboardPastePreview();
    }

    if (editorState.activeTool !== 'rect' && editorState.activeTool !== 'copy') {
      this.interactionController.clearShapePreview();
    }

    document.querySelectorAll<HTMLButtonElement>('.tool-btn[data-tool]').forEach((button) => {
      button.classList.toggle('active', button.dataset.tool === editorState.activeTool);
    });

    const moreToolsPanel = document.getElementById('more-tools-panel');
    const eraseControls = document.getElementById('erase-controls');
    const showMoreTools =
      moreToolsPanel?.dataset.open === 'true' ||
      (editorState.paletteMode === 'tiles' &&
        (editorState.activeTool === 'rect' || editorState.activeTool === 'fill'));
    moreToolsPanel?.classList.toggle('hidden', !showMoreTools);
    if (moreToolsPanel) {
      moreToolsPanel.dataset.open = showMoreTools ? 'true' : 'false';
    }
    eraseControls?.classList.toggle(
      'hidden',
      !(editorState.paletteMode === 'tiles' && editorState.activeTool === 'eraser'),
    );

    document.getElementById('btn-tool-more')?.classList.toggle(
      'active',
      showMoreTools || editorState.activeTool === 'rect' || editorState.activeTool === 'fill',
    );
    this.renderEditorUi();
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
    this.uiBridge?.render(
      buildEditorUiViewModel({
        roomTitle: this.roomTitle,
        roomCoordinates: this.roomCoordinates,
        roomGoal: this.roomGoal,
        roomPlacementMode,
        goalUsesMarkers: this.goalUsesMarkers(this.roomGoal),
        goalSummaryText: this.getGoalSummaryText(),
        roomPermissions: this.roomPermissions,
        mintedTokenId: this.mintedTokenId,
        canRefreshMintMetadata: this.roomSession.getHistoryState().canRefreshMintMetadata,
        saveInFlight: this.saveInFlight,
        mintedMetadataCurrent: this.roomSession.getHistoryState().mintedMetadataCurrent,
        roomVersionHistory: this.roomVersionHistory,
        entrySource: this.entrySource,
        zoomText: `Zoom: ${editorState.zoom}x`,
        saveStatus,
        publishNudgeVisible,
        publishNudgeText,
        publishNudgeActionText,
        courseEditorState,
      }),
    );
    this.renderInspectorUi();
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
    this.syncSharedConstructionPreview();
  }

  private flushSharedConstructionPreviewForExit(): void {
    this.syncSharedConstructionPreview({ force: true });
  }

  private syncSharedConstructionPreview(options?: { force?: boolean }): void {
    if (!this.editorPresenceClient) {
      return;
    }

    const force = options?.force === true;
    const stateKey = this.shouldPublishSharedConstructionPreview()
      ? `${this.roomCoordinates.x},${this.roomCoordinates.y}:${this.publishedVersion}`
      : null;
    if (!stateKey) {
      this.clearSharedConstructionPreview();
      return;
    }

    const now = performance.now();
    const stateChanged = this.lastSharedConstructionPreviewStateKey !== stateKey;
    if (
      !force &&
      !stateChanged &&
      !this.sharedConstructionPreviewDirty &&
      this.lastSharedConstructionPreviewStateKey !== null
    ) {
      return;
    }

    if (
      !force &&
      !stateChanged &&
      now - this.lastSharedConstructionPreviewPublishAt < this.SHARED_PREVIEW_PUBLISH_INTERVAL_MS
    ) {
      return;
    }

    this.editorPresenceClient.updateLocalRoomPreview({
      roomCoordinates: this.roomCoordinates,
      snapshot: this.buildSharedConstructionPreviewSnapshot(),
    });
    this.sharedConstructionPreviewDirty = false;
    this.lastSharedConstructionPreviewPublishAt = now;
    this.lastSharedConstructionPreviewStateKey = stateKey;
  }

  private clearSharedConstructionPreview(): void {
    if (!this.editorPresenceClient || this.lastSharedConstructionPreviewStateKey === null) {
      return;
    }

    this.editorPresenceClient.updateLocalRoomPreview(null);
    this.lastSharedConstructionPreviewStateKey = null;
  }

  private shouldPublishSharedConstructionPreview(): boolean {
    return this.entrySource === 'world' && this.publishedVersion === 0;
  }

  private buildSharedConstructionPreviewSnapshot(): RoomSnapshot {
    const snapshot = this.exportRoomSnapshot();
    snapshot.status = 'draft';
    snapshot.updatedAt = new Date().toISOString();
    snapshot.publishedAt = null;
    return snapshot;
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
    return shouldShowPublishNudgeHelper(
      this.publishedVersion,
      this.roomPermissions.canSaveDraft,
      this.mintedTokenId,
      this.roomEditCount,
      this.PUBLISH_NUDGE_EDIT_THRESHOLD,
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
    canRefreshMintMetadata: boolean;
    mintedTokenId: string | null;
    mintedOwnerWalletAddress: string | null;
    mintedMetadataRoomVersion: number | null;
    mintedMetadataUpdatedAt: string | null;
    mintedMetadataCurrent: boolean;
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

    this.flushSharedConstructionPreviewForExit();
    this.scene.stop();
    this.scene.wake('OverworldPlayScene', wakeData);
  }

  async returnToCourseBuilder(): Promise<void> {
    await this.returnToWorld();
  }

  async editPreviousCourseRoom(): Promise<void> {
    await this.editAdjacentCourseRoom(-1);
  }

  async editNextCourseRoom(): Promise<void> {
    await this.editAdjacentCourseRoom(1);
  }

  private async editAdjacentCourseRoom(offset: -1 | 1): Promise<void> {
    const adjacent = this.getAdjacentCourseEdit(offset);
    if (!adjacent) {
      this.courseEditorStatusText =
        offset < 0 ? 'Already at the first course room.' : 'Already at the last course room.';
      this.updateGoalUi();
      return;
    }

    showBusyOverlay(
      offset < 0 ? 'Opening previous room...' : 'Opening next room...',
      'Saving room state...'
    );
    const wakeData = await this.roomSession.buildReturnToWorldWakeData();
    if (!wakeData) {
      showBusyError(this.persistenceStatusText || 'Failed to open the adjacent room.', {
        closeHandler: () => hideBusyOverlay(),
      });
      return;
    }

    wakeData.courseEditorReturned = false;
    wakeData.courseEditedRoom = this.buildCourseEditedRoomData();
    wakeData.courseEditorNavigateOffset = offset;

    this.flushSharedConstructionPreviewForExit();
    this.scene.stop();
    this.scene.wake('OverworldPlayScene', wakeData);
  }

  async mintRoom(): Promise<RoomRecord | null> {
    return this.roomSession.mintRoom();
  }

  async refreshMintMetadata(): Promise<RoomRecord | null> {
    return this.roomSession.refreshMintMetadata();
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
