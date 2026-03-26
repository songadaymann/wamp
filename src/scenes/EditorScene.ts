import Phaser from 'phaser';
import {
  getAuthDebugState,
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
  resetEditorPaletteSelection,
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
import { RETRO_COLORS } from '../visuals/starfield';
import {
  type CourseGoalType,
  type CourseSnapshot,
} from '../courses/model';
import {
  cloneRoomGoal,
  type RoomGoal,
  type RoomGoalType,
} from '../goals/roomGoals';
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
import { EditorSceneFlowController } from './editor/flow';
import { EditorInspectorController } from './editor/inspector';
import { EditorInteractionController } from './editor/interaction';
import { EditorPresenceController } from './editor/presence';
import { EditorCourseController } from './editor/courseController';
import {
  buildEditorUiViewModel,
} from './editor/viewModel';
import type { EditorCourseUiState } from '../ui/setup/sceneBridge';

const EDITOR_NEIGHBOR_RADIUS = 1;
type EditorMarkerPlacementMode = Exclude<GoalPlacementMode, null> | 'start';

export class EditorScene extends Phaser.Scene {
  private uiBridge: EditorUiBridge | null = null;
  private layerIndicatorText: Phaser.GameObjects.Text | null = null;
  private layerGuideGraphics: Phaser.GameObjects.Graphics | null = null;
  private pressurePlateGraphics: Phaser.GameObjects.Graphics | null = null;
  private containerGraphics: Phaser.GameObjects.Graphics | null = null;
  private clipboardPastePreviewActive = false;
  private lastCopySelection: { x1: number; y1: number; x2: number; y2: number } | null = null;
  private roomEditCount = 0;

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
  private readonly courseController: EditorCourseController;
  private readonly flowController: EditorSceneFlowController;
  private readonly inspectorController: EditorInspectorController;
  private readonly interactionController: EditorInteractionController;
  private readonly presenceController: EditorPresenceController;
  private entrySource: 'world' | 'direct' = 'direct';
  private initialRoomSnapshot: RoomSnapshot | null = null;
  private readonly handleWake = (): void => {
    setAppMode('editor');
    editorState.isPlaying = false;
    this.presenceController.sync();
    this.updateBottomBar();
    this.updateGoalUi();
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
      if (this.inspectorController.isConnectingPressurePlate()) {
        this.cancelPressurePlateConnection();
        return;
      }

      if (this.clipboardPastePreviewActive) {
        this.cancelClipboardPastePreview();
        return;
      }

      if (this.inspectorController.hasPinnedInspector()) {
        this.inspectorController.clearPinnedSelection();
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
    this.events.off('wake', this.handleWake, this);
    this.scale.off('resize', this.handleResize, this);
    this.input.removeAllListeners();
    this.input.keyboard?.removeAllListeners();
    this.game.canvas.removeEventListener('contextmenu', this.handleCanvasContextMenu);
    this.uiBridge?.destroy();
    this.uiBridge = null;
    this.layerIndicatorText?.destroy();
    this.layerIndicatorText = null;
    this.presenceController.destroy();
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
    this.courseController = new EditorCourseController(this, {
      getRoomId: () => this.roomId,
      syncBackgroundCameraIgnores: () => this.syncBackgroundCameraIgnores(),
      updateGoalUi: () => this.updateGoalUi(),
      clearRoomGoalPlacementMode: () => {
        this.editRuntime.currentGoalPlacementMode = null;
      },
    });
    this.flowController = new EditorSceneFlowController(this.roomSession, {
      cancelClipboardPastePreview: () => this.cancelClipboardPastePreview(),
      getSelectedCoursePreviewForPlay: () => this.getSelectedCoursePreviewForPlay(),
      getRoomPermissions: () => this.roomPermissions,
      saveDraft: (force = false) => this.saveDraft(force),
      exportRoomSnapshot: () => this.exportRoomSnapshot(),
      getRoomDirty: () => this.roomDirty,
      getPublishedVersion: () => this.publishedVersion,
      getRoomCoordinates: () => ({ ...this.roomCoordinates }),
      buildCourseEditedRoomData: () => this.buildCourseEditedRoomData(),
      syncActiveCourseRoomSessionSnapshot: (room, options) => {
        this.syncActiveCourseRoomSessionSnapshot(room, options);
      },
      clearEditorPresence: () => this.presenceController.clear(),
      sleepEditorScene: () => this.scene.sleep(),
      stopEditorScene: () => this.scene.stop(),
      wakeOverworld: (data) => this.scene.wake('OverworldPlayScene', data),
      updateBottomBar: () => this.updateBottomBar(),
      hasActiveCourseEdit: () => this.courseController.hasActiveCourseEdit(),
      canReturnToCourseBuilder: () => this.courseController.getCourseEditorState().canReturnToCourseBuilder,
      getAdjacentCourseEdit: (offset) => this.courseController.getAdjacentCourseEdit(offset),
      setCourseEditorStatusText: (text) => this.courseController.setStatusText(text),
      updateGoalUi: () => this.updateGoalUi(),
      getPersistenceStatusText: () => this.persistenceStatusText,
      getMintedTokenId: () => this.mintedTokenId,
      getRoomEditCount: () => this.roomEditCount,
      publishRoom: () => this.publishRoom(),
    });
    this.inspectorController = new EditorInspectorController(
      this,
      this.editRuntime,
      (state) => this.uiBridge?.renderInspector(state),
    );
    this.presenceController = new EditorPresenceController({
      getRoomCoordinates: () => ({ ...this.roomCoordinates }),
      isPlaying: () => editorState.isPlaying,
      isSceneActive: () => this.scene.isActive(this.scene.key),
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
    return [...this.editRuntime.currentGoalMarkerSprites, ...this.courseController.getMarkerSprites()];
  }

  private get goalMarkerLabels(): Phaser.GameObjects.Text[] {
    return [...this.editRuntime.currentGoalMarkerLabels, ...this.courseController.getMarkerLabels()];
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
    return this.courseController.getGoalPlacementMode() ?? (this.editRuntime.currentGoalPlacementMode as EditorMarkerPlacementMode);
  }

  private buildCourseEditedRoomData(): CourseEditedRoomData | null {
    return this.courseController.buildCourseEditedRoomData();
  }

  private getAdjacentCourseEdit(offset: -1 | 1): EditorCourseEditData | null {
    return this.courseController.getAdjacentCourseEdit(offset);
  }

  private syncActiveCourseRoomSessionSnapshot(
    room: RoomSnapshot,
    options: { published: boolean }
  ): void {
    this.courseController.syncActiveCourseRoomSessionSnapshot(room, options);
  }

  getCourseEditorState(): EditorCourseUiState {
    return this.courseController.getCourseEditorState();
  }

  create(data?: EditorSceneData): void {
    this.resetRuntimeState();

    this.initialRoomSnapshot = data?.roomSnapshot ? cloneRoomSnapshot(data.roomSnapshot) : null;
    this.courseController.initialize(data?.courseEdit ?? null);

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
    this.uiBridge = new EditorUiBridge({
      onRequestRender: () => this.renderEditorUi(),
      onDocumentKeyDown: this.handleDocumentKeyDown,
      onAuthStateChanged: () => {
        this.presenceController.refreshIdentity();
        this.renderEditorUi();
      },
      onBack: () => this.handleEditorBackAction(),
      onStartPlayMode: () => this.startPlayMode(),
      onSaveDraft: async () => {
        await this.saveDraft(true, { promptForSignInOnUnauthorized: true });
      },
      onPublishRoom: async () => {
        await this.publishRoom();
      },
      onPublishNudge: () => this.handlePublishNudgeAction(),
      onMintRoom: async () => {
        await this.mintRoom();
      },
      onRefreshMintMetadata: async () => {
        await this.refreshMintMetadata();
      },
      onFitToScreen: () => this.fitToScreen(),
      onZoomIn: () => this.zoomIn(),
      onZoomOut: () => this.zoomOut(),
      onSetRoomTitle: (title) => this.setRoomTitle(title),
      onSelectTool: (tool) => {
        editorState.activeTool = tool;
        this.updateToolUI();
      },
      onClearCurrentLayer: () => this.clearCurrentLayer(),
      onClearAllTiles: () => this.clearAllTiles(),
      onSelectBackground: () => this.applySelectedBackground(),
      onSetGoalType: (nextType) => this.setGoalType(nextType),
      onSetGoalTimeLimitSeconds: (seconds) => this.setGoalTimeLimitSeconds(seconds),
      onSetGoalRequiredCount: (requiredCount) => this.setGoalRequiredCount(requiredCount),
      onSetGoalSurvivalSeconds: (seconds) => this.setGoalSurvivalSeconds(seconds),
      onStartGoalMarkerPlacement: (mode) => this.startGoalMarkerPlacement(mode),
      onClearGoalMarkers: () => this.clearGoalMarkers(),
      onSetCourseGoalType: (goalType) => this.setCourseGoalType(goalType),
      onSetCourseGoalTimeLimitSeconds: (seconds) => this.setCourseGoalTimeLimitSeconds(seconds),
      onSetCourseGoalRequiredCount: (requiredCount) => this.setCourseGoalRequiredCount(requiredCount),
      onSetCourseGoalSurvivalSeconds: (seconds) => this.setCourseGoalSurvivalSeconds(seconds),
      onStartCourseGoalMarkerPlacement: (mode) => this.startCourseGoalMarkerPlacement(mode),
      onClearCourseGoalMarkers: () => this.clearCourseGoalMarkers(),
      onEditPreviousCourseRoom: () => this.editPreviousCourseRoom(),
      onEditNextCourseRoom: () => this.editNextCourseRoom(),
      onBeginPressurePlateConnection: () => this.beginFocusedPressurePlateConnection(),
      onClearPressurePlateConnection: () => this.clearFocusedPressurePlateConnection(),
      onCancelPressurePlateConnection: () => this.cancelPressurePlateConnection(),
      onClearContainerContents: () => this.clearFocusedContainerContents(),
    });

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
    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);

    if (this.initialRoomSnapshot) {
      const editableSnapshot = cloneRoomSnapshot(this.initialRoomSnapshot);
      editableSnapshot.status = 'draft';
      this.applyRoomSnapshot(editableSnapshot);
      this.updatePersistenceStatus('Loading room...');
    }

    void this.loadPersistedRoom();
    this.presenceController.initialize();
    this.updateBottomBar();
    this.updateGoalUi();
  }

  update(time: number): void {
    this.maybeAutoSave(time);
    this.presenceController.sync();
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
    this.flowController.reset();
    this.inspectorController.reset();
    this.courseController.reset();
    this.roomSession.reset();
    this.clipboardPastePreviewActive = false;
    this.lastCopySelection = null;
    this.roomEditCount = 0;
    resetEditorPaletteSelection();
    editorState.tileFlipX = false;
    editorState.tileFlipY = false;
    editorState.isPlaying = false;
    this.uiBridge?.notifyEditorStateChanged();
  }

  updateBackground(): void {
    this.backgroundController.updateBackground(editorState.selectedBackground);
  }

  private applySelectedBackground(): void {
    this.updateBackground();
    this.markRoomDirty();
    this.renderEditorUi();
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

    this.presenceController.sync();
    this.updateGoalUi();
  }

  private returnToWorldReadOnly(): void {
    this.flowController.returnToWorldReadOnly();
  }

  private applyRoomSnapshot(room: RoomSnapshot): void {
    this.editRuntime.applyRoomSnapshot(room);
    this.inspectorController.reset();
    this.inspectorController.handleObjectSpritesRebuilt();
    this.clipboardPastePreviewActive = false;
    this.lastCopySelection = null;
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
    this.updatePersistenceStatus(this.getDirtyPersistenceStatusText());
    this.flowController.maybeTriggerPublishNudge();
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
    this.inspectorController.updatePressurePlateOverlay(this.pressurePlateGraphics);
  }

  private updateContainerOverlay(): void {
    this.inspectorController.updateContainerOverlay(this.containerGraphics);
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
    return this.inspectorController.handleObjectModePrimaryAction(pointer);
  }

  private handleObjectModeSecondaryAction(worldX: number, worldY: number): boolean {
    return this.inspectorController.handleObjectModeSecondaryAction(worldX, worldY);
  }

  private handleObjectPlace(pointer: Phaser.Input.Pointer): void {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tileX = Math.floor(worldPoint.x / TILE_SIZE);
    const tileY = Math.floor(worldPoint.y / TILE_SIZE);
    const placed = this.editRuntime.handleObjectPlace(worldPoint.x, worldPoint.y, tileX, tileY);
    this.inspectorController.handleObjectPlaced(placed);
  }

  private removeObjectAt(worldX: number, worldY: number): void {
    const removed = this.editRuntime.removeObjectAt(worldX, worldY);
    this.inspectorController.handleObjectRemoved(removed);
  }

  rebuildObjectSprites(): void {
    this.editRuntime.rebuildObjectSprites();
    this.inspectorController.handleObjectSpritesRebuilt();
  }

  beginFocusedPressurePlateConnection(): void {
    this.inspectorController.beginFocusedPressurePlateConnection();
  }

  clearFocusedPressurePlateConnection(): void {
    this.inspectorController.clearFocusedPressurePlateConnection();
  }

  cancelPressurePlateConnection(): void {
    this.inspectorController.cancelPressurePlateConnection();
  }

  clearFocusedContainerContents(): void {
    this.inspectorController.clearFocusedContainerContents();
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
    this.courseController.clearPlacementMode();
    this.editRuntime.startGoalMarkerPlacement(mode as GoalPlacementMode);
  }

  clearGoalMarkers(): void {
    this.editRuntime.clearGoalMarkers();
  }

  setCourseGoalType(goalType: CourseGoalType | null): void {
    this.courseController.setCourseGoalType(goalType);
  }

  setCourseGoalTimeLimitSeconds(seconds: number | null): void {
    this.courseController.setCourseGoalTimeLimitSeconds(seconds);
  }

  setCourseGoalRequiredCount(requiredCount: number): void {
    this.courseController.setCourseGoalRequiredCount(requiredCount);
  }

  setCourseGoalSurvivalSeconds(seconds: number): void {
    this.courseController.setCourseGoalSurvivalSeconds(seconds);
  }

  startCourseGoalMarkerPlacement(mode: EditorMarkerPlacementMode): void {
    this.courseController.startCourseGoalMarkerPlacement(mode);
  }

  clearCourseGoalMarkers(): void {
    this.courseController.clearCourseGoalMarkers();
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
    return this.courseController.getSelectedCoursePreviewForPlay();
  }

  private placeGoalMarker(tileX: number, tileY: number): void {
    if (this.courseController.placeGoalMarker(tileX, tileY)) {
      return;
    }

    this.editRuntime.placeGoalMarker(tileX, tileY);
  }

  private removeGoalMarkerAt(worldX: number, worldY: number): boolean {
    if (this.courseController.removeGoalMarkerAt(worldX, worldY)) {
      return true;
    }

    return this.editRuntime.removeGoalMarkerAt(worldX, worldY);
  }

  private getGoalSummaryText(): string {
    return this.editRuntime.getGoalSummaryText();
  }

  private updateGoalUi(): void {
    this.courseController.redrawMarkers();
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
    await this.flowController.startPlayMode();
  }

  async handlePublishNudgeAction(): Promise<void> {
    await this.flowController.handlePublishNudgeAction();
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
    const publishNudgeVisible = this.flowController.shouldShowPublishNudge();
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
        goalUsesMarkers: this.editRuntime.goalUsesMarkers(this.roomGoal),
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
    this.inspectorController.refreshUi();
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
    canonicalVersion: number | null;
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
    await this.flowController.returnToWorld();
  }

  async returnToCourseBuilder(): Promise<void> {
    await this.flowController.returnToCourseBuilder();
  }

  private async handleEditorBackAction(): Promise<void> {
    await this.flowController.handleEditorBackAction();
  }

  async editPreviousCourseRoom(): Promise<void> {
    await this.flowController.editPreviousCourseRoom();
  }

  async editNextCourseRoom(): Promise<void> {
    await this.flowController.editNextCourseRoom();
  }

  async mintRoom(): Promise<RoomRecord | null> {
    return this.roomSession.mintRoom();
  }

  async refreshMintMetadata(): Promise<RoomRecord | null> {
    return this.roomSession.refreshMintMetadata();
  }

  async setCanonicalVersion(targetVersion: number): Promise<RoomRecord | null> {
    return this.roomSession.setCanonicalVersion(targetVersion);
  }

  async setLeaderboardSourceVersion(
    targetVersion: number,
    sourceVersion: number | null
  ): Promise<RoomRecord | null> {
    return this.roomSession.setLeaderboardSourceVersion(targetVersion, sourceVersion);
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
      courseEdit: this.buildCourseEditedRoomData(),
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
