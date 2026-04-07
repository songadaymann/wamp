import Phaser from 'phaser';
import { getAuthDebugState } from '../auth/client';
import {
  TILE_SIZE,
  ROOM_WIDTH,
  ROOM_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_PX_HEIGHT,
  LAYER_NAMES,
  TILESETS,
  editorState,
  resetEditorPaletteSelection,
} from '../config';
import { globalRoomMusicController } from '../music/controller';
import {
  getMusicPhraseSampleName as getMusicPhraseDisplayName,
  type MusicPhraseRecord,
} from '../music/library';
import { deleteMusicPhrase, getMusicPhrase, listMusicPhrases, saveMusicPhrases } from '../music/libraryClient';
import {
  ROOM_MUSIC_KEY_MODES,
  ROOM_MUSIC_KEY_TONICS,
  ROOM_PATTERN_INSTRUMENT_IDS,
  ROOM_PATTERN_MAX_BPM,
  ROOM_PATTERN_MIN_BPM,
  ROOM_PATTERN_MAX_SWING_PERCENT,
  ROOM_PATTERN_MIN_SWING_PERCENT,
  ROOM_PHRASE_ARRANGEMENT_SLOT_COUNT,
  cloneRoomPatternMusic,
  createDefaultRoomPatternMusic,
  cloneRoomPhraseArrangementMusic,
  createDefaultRoomPhraseArrangementMusic,
  detectRoomPatternTrackKey,
  getRoomPhraseArrangementActiveSlotCount,
  getPatternInstrumentColorCss,
  getPatternInstrumentColorRgbCss,
  getPatternInstrumentIcon,
  getPatternInstrumentLabel,
  isPatternRoomMusic,
  isPhraseArrangementRoomMusic,
  isRoomPhraseArrangementEmpty,
  isStemArrangementRoomMusic,
  rekeyRoomPatternMusicPreservingMidi,
  type RoomMusic,
  type RoomMusicKeyMode,
  type RoomMusicKeyTonic,
  type RoomPatternInstrumentId,
  type RoomPatternPitchMode,
  type RoomPatternTonalInstrumentId,
  type RoomPhraseArrangementMusic,
} from '../music/model';
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
import { getSolidColorFromBackgroundValue } from '../backgrounds/model';
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
  CourseEditorSceneData,
  CourseEditedRoomData,
  EditorCourseEditData,
  EditorSceneData,
  OverworldPlaySceneData,
} from './sceneData';
import { EditorUiBridge } from './editor/uiBridge';
import { EditorRoomSession } from './editor/roomSession';
import { EditorBackgroundController } from './editor/backgrounds';
import { EditorEditRuntime, type GoalPlacementMode } from './editor/editRuntime';
import { EditorSceneFlowController } from './editor/flow';
import { EditorInspectorController } from './editor/inspector';
import { EditorInteractionController } from './editor/interaction';
import { EditorMusicPatternController } from './editor/musicPatternEditor';
import { EditorPresenceController } from './editor/presence';
import { EditorPersistenceController } from './editor/persistence';
import { EditorToolController } from './editor/tools';
import { EditorCourseController } from './editor/courseController';
import { EditorOverlayController } from './editor/overlays';
import { EditorChromeController } from './editor/chrome';
import { RoomLightingController } from '../lighting/controller';
import { cloneRoomLightingSettings, type RoomLightingSettings } from '../lighting/model';
import { playSfx } from '../audio/sfx';
import type { EditorCourseUiState } from '../ui/setup/sceneBridge';

const EDITOR_NEIGHBOR_RADIUS = 1;
type EditorMarkerPlacementMode = Exclude<GoalPlacementMode, null> | 'start';
type EditorMusicComposerMode = 'sequencer' | 'arrangement';
type EditorMusicArrangementSelection = {
  instrumentId: RoomPatternInstrumentId;
  slotIndex: number;
};

export class EditorScene extends Phaser.Scene {
  private uiBridge: EditorUiBridge | null = null;
  private roomEditCount = 0;
  private musicModeActive = false;
  private musicComposerMode: EditorMusicComposerMode = 'sequencer';
  private musicPreviewState: 'stopped' | 'playing' = 'stopped';
  private musicPhraseMetadataEditing = false;
  private musicPhraseLibraryInstrument: RoomPatternInstrumentId = 'drums';
  private musicPhraseLibraryItems: MusicPhraseRecord[] = [];
  private musicPhraseLibraryNextCursor: string | null = null;
  private musicPhraseLibraryLoading = false;
  private musicPhraseLibraryLoadingMore = false;
  private musicPhraseLibraryLoaded = false;
  private musicPhraseLibraryError: string | null = null;
  private musicPhraseLibraryRequestId = 0;
  private musicPhraseSaveInFlight = false;
  private musicPhraseDeleteInFlight = false;
  private musicArrangementSelection: EditorMusicArrangementSelection | null = null;
  private readonly musicPhraseRecordCache = new Map<string, MusicPhraseRecord>();
  private readonly musicPhraseDetailLoading = new Set<string>();

  // Tilemap
  private map!: Phaser.Tilemaps.Tilemap;
  private tilesets: Map<string, Phaser.Tilemaps.Tileset> = new Map();
  private layers: Map<string, Phaser.Tilemaps.TilemapLayer> = new Map();

  // Single-room persistence (local-first, ready for a remote adapter later)
  private readonly editRuntime: EditorEditRuntime;
  private readonly roomSession: EditorRoomSession;
  private readonly worldRepository = createWorldRepository();
  private readonly backgroundController: EditorBackgroundController;
  private readonly courseController: EditorCourseController;
  private readonly flowController: EditorSceneFlowController;
  private readonly inspectorController: EditorInspectorController;
  private readonly interactionController: EditorInteractionController;
  private readonly musicPatternController: EditorMusicPatternController;
  private readonly overlayController: EditorOverlayController;
  private readonly presenceController: EditorPresenceController;
  private readonly persistenceController: EditorPersistenceController;
  private readonly toolController: EditorToolController;
  private readonly chromeController: EditorChromeController;
  private readonly lightingController: RoomLightingController;
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
      if (this.musicModeActive) {
        if (this.musicPatternController.isPastePreviewActive()) {
          this.musicPatternController.cancelPastePreview();
          this.renderEditorUi();
          return;
        }

        this.setMusicModeActive(false);
        return;
      }

      if (this.inspectorController.isConnectingPressurePlate()) {
        this.cancelPressurePlateConnection();
        return;
      }

      if (this.toolController.isClipboardPastePreviewActive()) {
        this.toolController.cancelClipboardPastePreview();
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
    if (this.musicModeActive && this.musicComposerMode === 'sequencer' && primaryModifier && key === 'v') {
      event.preventDefault();
      event.stopPropagation();
      this.musicPatternController.beginPastePreview();
      this.renderEditorUi();
      return;
    }

    if (primaryModifier && key === 's') {
      event.preventDefault();
      event.stopPropagation();
      if (this.musicModeActive) {
        void this.saveRoomMusicDraftAndPhrases();
      } else {
        void this.saveDraft(true, { promptForSignInOnUnauthorized: true });
      }
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
      this.toolController.beginClipboardPastePreview();
      return;
    }

    if (primaryModifier && key === 'c' && editorState.paletteMode === 'tiles' && editorState.activeTool === 'copy') {
      if (!this.toolController.repeatLastCopySelection()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (primaryModifier && key === 'z') {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        this.toolController.redo();
      } else {
        this.toolController.undo();
      }
      return;
    }

    if (event.ctrlKey && !event.metaKey && key === 'y') {
      event.preventDefault();
      event.stopPropagation();
      this.toolController.redo();
      return;
    }

    if (event.code === 'Digit1') {
      event.preventDefault();
      this.toolController.selectTool('pencil');
      return;
    }

    if (event.code === 'Digit2') {
      event.preventDefault();
      this.toolController.selectTool('eraser');
      return;
    }

    if (event.code === 'Digit3') {
      event.preventDefault();
      this.toolController.selectTool('copy');
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      void this.startPlayMode();
      return;
    }

    if (this.musicModeActive && event.code === 'Space') {
      event.preventDefault();
      event.stopPropagation();
      this.toggleRoomMusicPreview();
    }
  };
  private readonly handleShutdown = (): void => {
    this.events.off('wake', this.handleWake, this);
    this.scale.off('resize', this.handleResize, this);
    this.input.removeAllListeners();
    this.input.keyboard?.removeAllListeners();
    this.game.canvas.removeEventListener('contextmenu', this.handleCanvasContextMenu);
    this.inspectorController.reset();
    globalRoomMusicController.stopArrangement({
      transition: 'immediate',
      fadeDurationSec: 0.08,
      mode: 'idle',
      resetTransport: true,
    });
    this.uiBridge?.destroy();
    this.uiBridge = null;
    this.musicPatternController.destroy();
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
      getRoomOrigin: () => ({ x: 0, y: 0 }),
      getSelectedBackground: () => editorState.selectedBackground,
      setSelectedBackground: (backgroundId) => {
        editorState.selectedBackground = backgroundId;
        editorState.selectedSolidBackgroundColor = getSolidColorFromBackgroundValue(
          backgroundId,
          editorState.selectedSolidBackgroundColor,
        );
      },
      getSelectedLightingSettings: () => this.getSelectedLightingSettings(),
      setSelectedLightingSettings: (lighting) => {
        this.setSelectedLightingSettings(lighting);
      },
      getPlacedObjects: () => editorState.placedObjects,
      setPlacedObjects: (placedObjects) => {
        editorState.placedObjects = placedObjects;
      },
      updateBackgroundSelectValue: () => {},
      updateLightingControlsValue: (lighting) => {
        this.syncLightingControls(lighting);
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
    this.persistenceController = new EditorPersistenceController(this.roomSession, {
      getRoomPermissions: () => this.roomPermissions,
      getRoomTitle: () => this.roomTitle,
      setRoomTitle: (title) => {
        this.roomTitle = title;
      },
      getRoomDirty: () => this.roomDirty,
      setRoomDirty: (dirty) => {
        this.roomDirty = dirty;
      },
      getLastDirtyAt: () => this.lastDirtyAt,
      setLastDirtyAt: (value) => {
        this.lastDirtyAt = value;
      },
      getInitialRoomSnapshot: () => this.initialRoomSnapshot ? cloneRoomSnapshot(this.initialRoomSnapshot) : null,
      syncActiveCourseRoomSessionSnapshot: (room, options) => {
        this.syncActiveCourseRoomSessionSnapshot(room, options);
      },
      onRoomMarkedDirty: () => {
        this.roomEditCount += 1;
        this.flowController.maybeTriggerPublishNudge();
      },
    });
    this.toolController = new EditorToolController(
      this,
      this.editRuntime,
      this.persistenceController,
      {
        startRectDrawing: (tileX, tileY) => this.interactionController.startRectDrawing(tileX, tileY),
        clearShapePreview: () => this.interactionController.clearShapePreview(),
        clearCoursePlacementMode: () => this.courseController.clearPlacementMode(),
        renderUi: () => this.renderEditorUi(),
      },
    );
    this.courseController = new EditorCourseController(this, {
      getRoomId: () => this.roomId,
      syncBackgroundCameraIgnores: () => this.syncBackgroundCameraIgnores(),
      updateGoalUi: () => this.updateGoalUi(),
      clearRoomGoalPlacementMode: () => {
        this.editRuntime.currentGoalPlacementMode = null;
      },
    });
    this.flowController = new EditorSceneFlowController(this.roomSession, {
      cancelClipboardPastePreview: () => this.toolController.cancelClipboardPastePreview(),
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
      wakeCourseComposer: (data) => this.scene.wake('CourseComposerScene', data),
      updateBottomBar: () => this.updateBottomBar(),
      hasActiveCourseEdit: () => this.courseController.hasActiveCourseEdit(),
      canReturnToCourseBuilder: () => this.courseController.getCourseEditorState().canReturnToCourseBuilder,
      shouldReturnToCourseEditor: () => this.shouldReturnToCourseEditor(),
      buildCourseEditorWakeData: (wakeData) => this.buildCourseEditorWakeData(wakeData),
      setCourseEditorStatusText: (text) => this.courseController.setStatusText(text),
      updateGoalUi: () => this.updateGoalUi(),
      getPersistenceStatusText: () => this.persistenceController.statusText,
      getMintedTokenId: () => this.mintedTokenId,
      getRoomEditCount: () => this.roomEditCount,
      publishRoom: () => this.publishRoom(),
    });
    this.inspectorController = new EditorInspectorController(
      this,
      this.editRuntime,
      (state) => this.uiBridge?.renderInspector(state),
    );
    this.chromeController = new EditorChromeController(
      this.editRuntime,
      this.flowController,
      this.persistenceController,
      this.toolController,
      this.inspectorController,
      this.courseController,
      {
        getUiBridge: () => this.uiBridge,
        getRoomTitle: () => this.roomTitle,
        getRoomCoordinates: () => ({ ...this.roomCoordinates }),
        getRoomGoal: () => this.roomGoal,
        getRoomPermissions: () => this.roomPermissions,
        getMintedTokenId: () => this.mintedTokenId,
        getRoomVersionHistory: () => this.roomVersionHistory,
        getEntrySource: () => this.entrySource,
        getCourseEditorState: () => this.courseController.getCourseEditorState(),
        getSaveInFlight: () => this.saveInFlight,
      },
    );
    this.presenceController = new EditorPresenceController({
      getRoomCoordinates: () => ({ ...this.roomCoordinates }),
      isPlaying: () => editorState.isPlaying,
      isSceneActive: () => this.scene.isActive(this.scene.key),
    });
    this.interactionController = new EditorInteractionController(this, {
      getNeighborRadius: () => EDITOR_NEIGHBOR_RADIUS,
      getGoalPlacementMode: () => this.goalPlacementMode as GoalPlacementMode,
      isMusicModeActive: () => this.musicModeActive,
      handleMusicPointerDown: (pointer) => this.handleMusicPointerDown(pointer),
      handleMusicPointerMove: (pointer) => this.handleMusicPointerMove(pointer),
      handleMusicPointerUp: (pointer) => this.handleMusicPointerUp(pointer),
      updateMusicCursorHighlight: (graphics) => this.updateMusicCursorHighlight(graphics),
      handleObjectModePrimaryAction: (pointer) => this.handleObjectModePrimaryAction(pointer),
      handleObjectModeSecondaryAction: (worldX, worldY) =>
        this.handleObjectModeSecondaryAction(worldX, worldY),
      handleObjectPlace: (pointer) => this.handleObjectPlace(pointer),
      handleToolDown: (pointer) => this.toolController.handleToolDown(pointer),
      removeGoalMarkerAt: (worldX, worldY) => this.removeGoalMarkerAt(worldX, worldY),
      removeObjectAt: (worldX, worldY) => this.removeObjectAt(worldX, worldY),
      placeGoalMarker: (tileX, tileY) => this.placeGoalMarker(tileX, tileY),
      placeTileAt: (worldX, worldY) => this.editRuntime.placeTileAt(worldX, worldY),
      eraseTileAt: (worldX, worldY) => this.editRuntime.eraseTileAt(worldX, worldY),
      fillRect: (x1, y1, x2, y2) => this.editRuntime.fillRect(x1, y1, x2, y2),
      captureCopySelection: (x1, y1, x2, y2) => this.toolController.captureCopySelection(x1, y1, x2, y2),
      getClipboardPreview: () => this.toolController.getClipboardPreview(),
      isClipboardPastePreviewActive: () => this.toolController.isClipboardPastePreviewActive(),
      pasteClipboardAt: (tileX, tileY) => this.toolController.pasteClipboardAt(tileX, tileY),
      cancelClipboardPastePreview: () => this.toolController.cancelClipboardPastePreview(),
      beginTileBatch: () => this.editRuntime.beginTileBatch(),
      commitTileBatch: () => this.editRuntime.commitTileBatch(),
      startPlayMode: () => this.startPlayMode(),
      updateToolUi: () => this.toolController.updateToolUi(),
      updateBackgroundPreview: () => this.updateBackgroundPreview(),
      updateZoomUI: () => this.updateZoomUI(),
    });
    this.musicPatternController = new EditorMusicPatternController(this, {
      getRoomMusic: () => this.roomMusic,
      commitRoomMusic: (nextMusic) => this.commitRoomMusic(nextMusic),
      replaceLegacyRoomMusicWithPattern: () => this.commitLegacyRoomMusicPatternReplacement(),
      renderUi: () => this.renderEditorUi(),
      getMusicPlaybackDebugState: () => globalRoomMusicController.getDebugState(),
      getMusicPreviewState: () => this.musicPreviewState,
      previewPatternCell: (pattern, instrumentId, row) =>
        globalRoomMusicController.previewPatternCell(pattern, instrumentId, row),
    });
    this.overlayController = new EditorOverlayController(this, {
      getLayers: () => this.layers,
      getPlacedObjects: () => editorState.placedObjects,
      isClipboardPastePreviewActive: () => this.toolController.isClipboardPastePreviewActive(),
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
          this.overlayController.gridOverlay,
          this.overlayController.layerGuideOverlay,
          this.interactionController.cursorOverlay,
          this.interactionController.rectPreviewOverlay,
          this.overlayController.borderOverlay,
        ];
        for (const overlay of overlays) {
          if (overlay) {
            ignored.push(overlay);
          }
        }

        ignored.push(...this.lightingController.getBackdropIgnoredObjects());
        ignored.push(...this.musicPatternController.getIgnoredObjects());

        return ignored;
      },
      isSceneActive: () => this.scene.isActive(this.scene.key),
    });
    this.lightingController = new RoomLightingController({
      scene: this,
      overlayDepth: 80,
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

  private get roomGoal(): RoomGoal | null {
    return this.editRuntime.currentRoomGoal;
  }

  private get roomSpawnPoint(): RoomSpawnPoint | null {
    return this.editRuntime.currentRoomSpawnPoint;
  }

  private get roomMusic(): RoomMusic | null {
    return this.editRuntime.currentRoomMusic;
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
    return null;
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
        await this.persistenceController.mintRoom();
      },
      onRefreshMintMetadata: async () => {
        await this.persistenceController.refreshMintMetadata();
      },
      onFitToScreen: () => this.fitToScreen(),
      onZoomIn: () => this.zoomIn(),
      onZoomOut: () => this.zoomOut(),
      onSetRoomTitle: (title) => this.persistenceController.setRoomTitle(title),
      onSelectTool: (tool) => this.toolController.selectTool(tool),
      onClearCurrentLayer: () => this.toolController.clearCurrentLayer(),
      onClearAllTiles: () => this.toolController.clearAllTiles(),
      onSelectBackground: () => this.applySelectedBackground(),
      onSelectLighting: (mode) => this.applySelectedLightingMode(mode),
      onSetLightingDarkness: (darkness) => this.applySelectedLightingDarkness(darkness),
      onSetLightingRadius: (radius) => this.applySelectedLightingRadius(radius),
      onSetGoalType: (nextType) => this.toolController.setGoalType(nextType),
      onSetGoalTimeLimitSeconds: (seconds) => this.toolController.setGoalTimeLimitSeconds(seconds),
      onSetGoalRequiredCount: (requiredCount) => this.toolController.setGoalRequiredCount(requiredCount),
      onSetGoalSurvivalSeconds: (seconds) => this.toolController.setGoalSurvivalSeconds(seconds),
      onStartGoalMarkerPlacement: (mode) => this.toolController.startGoalMarkerPlacement(mode),
      onClearGoalMarkers: () => this.toolController.clearGoalMarkers(),
      onSetCourseGoalType: (goalType) => this.setCourseGoalType(goalType),
      onSetCourseGoalTimeLimitSeconds: (seconds) => this.setCourseGoalTimeLimitSeconds(seconds),
      onSetCourseGoalRequiredCount: (requiredCount) => this.setCourseGoalRequiredCount(requiredCount),
      onSetCourseGoalSurvivalSeconds: (seconds) => this.setCourseGoalSurvivalSeconds(seconds),
      onStartCourseGoalMarkerPlacement: (mode) => this.startCourseGoalMarkerPlacement(mode),
      onClearCourseGoalMarkers: () => this.clearCourseGoalMarkers(),
      onBeginPressurePlateConnection: () => this.beginFocusedPressurePlateConnection(),
      onClearPressurePlateConnection: () => this.clearFocusedPressurePlateConnection(),
      onCancelPressurePlateConnection: () => this.cancelPressurePlateConnection(),
      onClearContainerContents: () => this.clearFocusedContainerContents(),
    });

    this.createBackground();
    this.createTilemap();
    this.createCursorOverlay();
    this.musicPatternController.create();
    this.overlayController.createOverlays();
    this.setupCamera();
    this.setupInput();
    this.setupKeyboard();
    this.rebuildObjectSprites();
    this.syncBackgroundCameraIgnores();
    this.updateBackgroundPreview();
    this.updateLightingPreview();
    this.renderMusicUi();

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
    this.updateLightingPreview();
    this.updateCursorHighlight();
    this.overlayController.updateLayerGuideOverlay();
    this.overlayController.updatePressurePlateOverlay((graphics) => {
      this.inspectorController.updatePressurePlateOverlay(graphics);
    });
    this.overlayController.updateContainerOverlay((graphics) => {
      this.inspectorController.updateContainerOverlay(graphics);
    });
    this.overlayController.updateLayerIndicator();
    this.musicPatternController.updateOverlay(this.musicModeActive && this.musicComposerMode === 'sequencer');
  }

  // ══════════════════════════════════════
  // BACKGROUND
  // ══════════════════════════════════════

  private createBackground(): void {
    this.backgroundController.createBackground(editorState.selectedBackground);
  }

  private resetRuntimeState(): void {
    this.lightingController.reset();
    this.backgroundController.reset();
    this.interactionController.reset();
    this.overlayController.reset();
    this.tilesets = new Map();
    this.layers = new Map();
    this.editRuntime.reset();
    this.musicPatternController.reset();
    this.flowController.reset();
    this.inspectorController.reset();
    this.courseController.reset();
    this.roomSession.reset();
    this.toolController.reset();
    this.roomEditCount = 0;
    resetEditorPaletteSelection();
    editorState.tileFlipX = false;
    editorState.tileFlipY = false;
    this.setSelectedLightingSettings(null);
    editorState.isPlaying = false;
    this.musicModeActive = false;
    this.musicPreviewState = 'stopped';
    globalRoomMusicController.stopArrangement({
      transition: 'immediate',
      fadeDurationSec: 0.08,
      mode: 'idle',
      resetTransport: true,
    });
    globalRoomMusicController.stopPreviewClip();
    document.body.dataset.editorMusicMode = 'false';
    document.body.dataset.editorMusicUiLocked = 'false';
    this.uiBridge?.notifyEditorStateChanged();
  }

  updateBackground(): void {
    this.backgroundController.updateBackground(editorState.selectedBackground);
  }

  private applySelectedBackground(): void {
    this.updateBackground();
    this.persistenceController.markRoomDirty();
    this.renderEditorUi();
  }

  private getSelectedLightingSettings(): RoomLightingSettings {
    return cloneRoomLightingSettings({
      mode: editorState.selectedLightingMode,
      darkness: editorState.selectedLightingDarkness,
      radius: editorState.selectedLightingRadius,
    });
  }

  private setSelectedLightingSettings(lighting: RoomLightingSettings | null | undefined): void {
    const normalized = cloneRoomLightingSettings(lighting);
    editorState.selectedLightingMode = normalized.mode;
    editorState.selectedLightingDarkness = normalized.darkness;
    editorState.selectedLightingRadius = normalized.radius;
  }

  private syncLightingControls(lighting: RoomLightingSettings | null | undefined): void {
    const normalized = cloneRoomLightingSettings(lighting);
    const lightingSelect = document.getElementById(
      'lighting-mode-select'
    ) as HTMLSelectElement | null;
    const darknessRange = document.getElementById(
      'lighting-darkness-range'
    ) as HTMLInputElement | null;
    const radiusRange = document.getElementById(
      'lighting-radius-range'
    ) as HTMLInputElement | null;
    if (lightingSelect) {
      lightingSelect.value = normalized.mode;
    }
    if (darknessRange) {
      darknessRange.value = String(normalized.darkness);
    }
    if (radiusRange) {
      radiusRange.value = String(normalized.radius);
    }
  }

  private applySelectedLightingMode(mode: RoomSnapshot['lighting']['mode']): void {
    editorState.selectedLightingMode = mode;
    this.updateLightingPreview();
    this.persistenceController.markRoomDirty();
    this.renderEditorUi();
  }

  private applySelectedLightingDarkness(darkness: number): void {
    editorState.selectedLightingDarkness = darkness;
    this.updateLightingPreview();
    this.persistenceController.markRoomDirty();
    this.renderEditorUi();
  }

  private applySelectedLightingRadius(radius: number): void {
    editorState.selectedLightingRadius = radius;
    this.updateLightingPreview();
    this.persistenceController.markRoomDirty();
    this.renderEditorUi();
  }

  private syncBackgroundCameraIgnores(): void {
    this.backgroundController.syncBackgroundCameraIgnores();
  }

  private updateBackgroundPreview(): void {
    this.backgroundController.updateBackgroundPreview();
  }

  private updateLightingPreview(): void {
    const emitter = this.roomSpawnPoint
      ? {
          x: this.roomSpawnPoint.x,
          y: this.roomSpawnPoint.y,
        }
      : {
          x: ROOM_PX_WIDTH * 0.5,
          y: ROOM_PX_HEIGHT * 0.5,
        };
    const structureChanged = this.lightingController.sync({
      roomId: this.roomId,
      bounds: {
        x: 0,
        y: 0,
        width: ROOM_PX_WIDTH,
        height: ROOM_PX_HEIGHT,
      },
      lighting: this.getSelectedLightingSettings(),
      emitters: [emitter],
    });

    if (structureChanged) {
      this.syncBackgroundCameraIgnores();
    }
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
            if (this.shouldReturnToCourseEditor()) {
              const courseEdit = this.buildCourseEditedRoomData();
              this.scene.wake('CourseComposerScene', {
                courseId: courseEdit?.courseId ?? null,
                selectedCoordinates: { ...this.roomCoordinates },
                centerCoordinates: { ...this.roomCoordinates },
                statusMessage: 'Failed to open room.',
              } satisfies CourseEditorSceneData);
              return;
            }

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
    this.toolController.reset();
    this.updateLightingPreview();
    if (this.musicPreviewState === 'playing') {
      this.syncRoomMusicPreviewPlayback();
    }
    this.renderMusicUi();
  }

  private exportRoomSnapshot(): RoomSnapshot {
    return this.editRuntime.exportRoomSnapshot();
  }

  private maybeAutoSave(_time: number): void {
    this.persistenceController.maybeAutoSave(editorState.isPlaying);
  }

  private updatePersistenceStatus(text: string): void {
    this.persistenceController.setStatusText(text);
  }

  async saveDraft(
    force: boolean = false,
    options?: { promptForSignInOnUnauthorized?: boolean }
  ): Promise<RoomRecord | null> {
    return this.persistenceController.saveDraft(force, options);
  }

  async saveRoomMusicDraftAndPhrases(
    options?: { instrumentId?: RoomPatternInstrumentId | null }
  ): Promise<RoomRecord | null> {
    const record = await this.saveDraft(true, { promptForSignInOnUnauthorized: true });
    if (!record) {
      return null;
    }

    if (this.musicComposerMode !== 'sequencer' || !isPatternRoomMusic(record.draft.music)) {
      return record;
    }

    this.musicPhraseSaveInFlight = true;
    this.renderEditorUi();

    try {
      const response = await saveMusicPhrases(record.draft, {
        instrumentId: options?.instrumentId ?? null,
      });
      this.rememberMusicPhrases(response.items);
      this.applySavedMusicPhrasesToLibrary(response.items);

      if (response.items.length === 0) {
        const label = options?.instrumentId
          ? `${getPatternInstrumentLabel(options.instrumentId)} phrase`
          : 'phrases';
        this.updatePersistenceStatus(`Draft saved v${this.roomVersion}. No non-empty ${label} to save yet.`);
      } else {
        this.updatePersistenceStatus(
          response.items.length === 1
            ? `Draft saved v${this.roomVersion}. Saved 1 phrase.`
            : `Draft saved v${this.roomVersion}. Saved ${response.items.length} phrases.`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : 'Phrase save failed.';
      this.musicPhraseLibraryError = message;
      this.updatePersistenceStatus(`Draft saved v${this.roomVersion}. ${message}`);
    } finally {
      this.musicPhraseSaveInFlight = false;
      this.renderEditorUi();
    }

    return record;
  }

  private inferAndApplyActiveRoomMusicPhraseKey(): { tonic: RoomMusicKeyTonic; mode: RoomMusicKeyMode } | null {
    if (this.musicComposerMode !== 'sequencer') {
      return null;
    }

    const instrumentId = this.musicPatternController.getActiveInstrumentTab();
    if (instrumentId === 'drums') {
      return null;
    }

    const pattern = this.getEditablePatternMusic();
    if (!pattern) {
      return null;
    }

    const detectedKey = detectRoomPatternTrackKey(pattern, instrumentId as RoomPatternTonalInstrumentId);
    if (!detectedKey) {
      return null;
    }

    if (pattern.keyTonic === detectedKey.tonic && pattern.keyMode === detectedKey.mode) {
      return detectedKey;
    }

    this.commitRoomMusic(
      rekeyRoomPatternMusicPreservingMidi(
        pattern,
        detectedKey.tonic,
        detectedKey.mode,
      ),
    );
    return detectedKey;
  }

  async saveActiveRoomMusicPhrase(): Promise<RoomRecord | null> {
    if (this.musicComposerMode !== 'sequencer') {
      return this.saveDraft(true, { promptForSignInOnUnauthorized: true });
    }

    const detectedKey = this.inferAndApplyActiveRoomMusicPhraseKey();
    if (detectedKey) {
      this.updatePersistenceStatus(`Detected ${detectedKey.tonic} ${detectedKey.mode === 'minor' ? 'Minor' : 'Major'} before save.`);
    }

    return this.saveRoomMusicDraftAndPhrases({
      instrumentId: this.musicPatternController.getActiveInstrumentTab(),
    });
  }

  async startNewRoomMusicPhrase(): Promise<void> {
    if (
      this.saveInFlight ||
      this.musicPhraseSaveInFlight ||
      this.musicPhraseDeleteInFlight ||
      !this.roomPermissions.canSaveDraft
    ) {
      return;
    }

    if (this.musicComposerMode === 'arrangement') {
      const record = await this.saveDraft(true, { promptForSignInOnUnauthorized: true });
      if (!record) {
        return;
      }
      this.setMusicComposerMode('sequencer');
    } else {
      const record = await this.saveActiveRoomMusicPhrase();
      if (!record) {
        return;
      }
    }

    this.musicPatternController.clearActivePhrase();
    this.musicPhraseMetadataEditing = true;
    this.updatePersistenceStatus(`Started a new ${getPatternInstrumentLabel(this.musicPatternController.getActiveInstrumentTab())} phrase.`);
    this.renderEditorUi();
  }

  toggleRoomMusicPhraseMetadataEditor(): void {
    if (this.musicComposerMode !== 'sequencer') {
      return;
    }

    this.musicPhraseMetadataEditing = !this.musicPhraseMetadataEditing;
    if (this.musicPhraseMetadataEditing) {
      this.ensureActivePatternPhraseCache();
    }
    this.renderEditorUi();
  }

  async deleteActiveRoomMusicPhrase(): Promise<void> {
    if (
      this.musicComposerMode !== 'sequencer' ||
      this.saveInFlight ||
      this.musicPhraseSaveInFlight ||
      this.musicPhraseDeleteInFlight
    ) {
      return;
    }

    const phrase = this.getActivePatternPhraseRecord();
    const currentUserId = this.getCurrentMusicPhraseUserId();
    if (!phrase || !currentUserId || phrase.creatorUserId !== currentUserId) {
      this.updatePersistenceStatus('You can only delete phrases you created.');
      return;
    }

    this.musicPhraseDeleteInFlight = true;
    this.renderEditorUi();

    try {
      await deleteMusicPhrase(phrase.id);
      this.musicPhraseRecordCache.delete(phrase.id);
      this.musicPhraseLibraryItems = this.musicPhraseLibraryItems.filter((item) => item.id !== phrase.id);
      this.musicPhraseLibraryError = null;
      this.musicPatternController.clearActivePhrase();
      this.musicPhraseMetadataEditing = true;
      this.updatePersistenceStatus(`Deleted ${this.getMusicPhraseSampleName(phrase)}.`);
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : 'Phrase delete failed.';
      this.musicPhraseLibraryError = message;
      this.updatePersistenceStatus(message);
    } finally {
      this.musicPhraseDeleteInFlight = false;
      this.renderEditorUi();
    }
  }

  async publishRoom(successText?: string): Promise<RoomRecord | null> {
    const record = await this.persistenceController.publishRoom(successText);
    if (record?.published) {
      this.musicPhraseLibraryLoaded = false;
      this.musicPhraseLibraryError = null;
      this.musicPhraseLibraryNextCursor = null;
      if (this.musicModeActive) {
        await this.loadMusicPhraseLibrary(true);
      }
    }
    return record;
  }

  async revertToVersion(targetVersion: number): Promise<RoomRecord | null> {
    return this.persistenceController.revertToVersion(targetVersion);
  }

  async adminRestoreToVersion(targetVersion: number): Promise<RoomRecord | null> {
    return this.persistenceController.adminRestoreToVersion(targetVersion);
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

  private createCursorOverlay(): void {
    this.interactionController.initializeOverlays();
    this.editRuntime.initializeGraphics();
  }

  private updateCursorHighlight(): void {
    this.interactionController.updateCursorHighlight();
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

  setPlacedSignText(instanceId: string, text: string | null): boolean {
    const updated = this.editRuntime.setSignText(instanceId, text);
    if (updated) {
      this.renderEditorUi();
    }
    return updated;
  }

  setGoalType(nextType: RoomGoalType | null): void {
    this.toolController.setGoalType(nextType);
  }

  setGoalTimeLimitSeconds(seconds: number | null): void {
    this.toolController.setGoalTimeLimitSeconds(seconds);
  }

  setGoalRequiredCount(requiredCount: number): void {
    this.toolController.setGoalRequiredCount(requiredCount);
  }

  setGoalSurvivalSeconds(seconds: number): void {
    this.toolController.setGoalSurvivalSeconds(seconds);
  }

  startGoalMarkerPlacement(mode: EditorMarkerPlacementMode): void {
    this.toolController.startGoalMarkerPlacement(mode);
  }

  clearGoalMarkers(): void {
    this.toolController.clearGoalMarkers();
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
    return this.toolController.getGoalEditorState();
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

  private updateGoalUi(): void {
    this.chromeController.refreshGoalUi();
  }

  // ══════════════════════════════════════
  // PLAY MODE
  // ══════════════════════════════════════

  async startPlayMode(): Promise<void> {
    if (this.musicPreviewState !== 'stopped') {
      this.stopRoomMusicPreview();
    }
    await this.flowController.startPlayMode();
  }

  async handlePublishNudgeAction(): Promise<void> {
    await this.flowController.handlePublishNudgeAction();
  }

  updateToolUi(): void {
    this.toolController.updateToolUi();
  }

  private updateBottomBar(): void {
    this.chromeController.refreshBottomBar();
  }

  private renderEditorUi(): void {
    this.chromeController.render();
    this.renderMusicUi();
  }

  // ── Public API for UI ──

  getMap(): Phaser.Tilemaps.Tilemap {
    return this.map;
  }

  setRoomTitle(nextTitle: string | null): void {
    this.persistenceController.setRoomTitle(nextTitle);
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
    return this.persistenceController.getHistoryState();
  }

  async returnToWorld(): Promise<void> {
    if (this.musicPreviewState !== 'stopped') {
      this.stopRoomMusicPreview();
    }
    await this.flowController.returnToWorld();
  }

  async returnToCourseBuilder(): Promise<void> {
    await this.flowController.returnToCourseBuilder();
  }

  private async handleEditorBackAction(): Promise<void> {
    await this.flowController.handleEditorBackAction();
  }

  private shouldReturnToCourseEditor(): boolean {
    return Boolean(
      this.buildCourseEditedRoomData() &&
        (this.scene.isSleeping('CourseComposerScene') ||
          this.scene.isPaused('CourseComposerScene') ||
          this.scene.isActive('CourseComposerScene'))
    );
  }

  private buildCourseEditorWakeData(wakeData: OverworldPlaySceneData): CourseEditorSceneData {
    const courseEdit = this.buildCourseEditedRoomData();
    return {
      courseId: courseEdit?.courseId ?? null,
      selectedCoordinates: { ...this.roomCoordinates },
      centerCoordinates: { ...(wakeData.centerCoordinates ?? this.roomCoordinates) },
      statusMessage: wakeData.statusMessage ?? null,
      courseEditedRoom: this.buildCourseEditedRoomData(),
      draftRoom: wakeData.draftRoom ?? null,
      publishedRoom: wakeData.publishedRoom ?? null,
      clearDraftRoomId: wakeData.clearDraftRoomId ?? null,
      invalidateRoomId: wakeData.invalidateRoomId ?? null,
    };
  }

  async mintRoom(): Promise<RoomRecord | null> {
    return this.persistenceController.mintRoom();
  }

  async refreshMintMetadata(): Promise<RoomRecord | null> {
    return this.persistenceController.refreshMintMetadata();
  }

  async setCanonicalVersion(targetVersion: number): Promise<RoomRecord | null> {
    return this.persistenceController.setCanonicalVersion(targetVersion);
  }

  async setLeaderboardSourceVersion(
    targetVersion: number,
    sourceVersion: number | null
  ): Promise<RoomRecord | null> {
    return this.persistenceController.setLeaderboardSourceVersion(targetVersion, sourceVersion);
  }

  undoAction(): void {
    this.toolController.undo();
    this.updateBottomBar();
  }

  redoAction(): void {
    this.toolController.redo();
    this.updateBottomBar();
  }

  private getDisplayPatternMusic() {
    return isPatternRoomMusic(this.roomMusic)
      ? this.roomMusic
      : createDefaultRoomPatternMusic();
  }

  private getEditablePatternMusic() {
    if (isStemArrangementRoomMusic(this.roomMusic)) {
      return null;
    }

    return isPatternRoomMusic(this.roomMusic)
      ? cloneRoomPatternMusic(this.roomMusic)
      : createDefaultRoomPatternMusic();
  }

  private getDisplayPhraseArrangement(): RoomPhraseArrangementMusic {
    return isPhraseArrangementRoomMusic(this.roomMusic)
      ? this.roomMusic
      : createDefaultRoomPhraseArrangementMusic();
  }

  private getEditablePhraseArrangement(): RoomPhraseArrangementMusic | null {
    if (isStemArrangementRoomMusic(this.roomMusic)) {
      return null;
    }

    return isPhraseArrangementRoomMusic(this.roomMusic)
      ? cloneRoomPhraseArrangementMusic(this.roomMusic)
      : createDefaultRoomPhraseArrangementMusic();
  }

  private getActiveMusicKeyTonic(): RoomMusicKeyTonic {
    return this.musicComposerMode === 'arrangement'
      ? this.getDisplayPhraseArrangement().keyTonic
      : this.musicPatternController.getKeyTonic();
  }

  private getActiveMusicKeyMode(): RoomMusicKeyMode {
    return this.musicComposerMode === 'arrangement'
      ? this.getDisplayPhraseArrangement().keyMode
      : this.musicPatternController.getKeyMode();
  }

  private getActiveMusicPitchMode(): RoomPatternPitchMode {
    return this.musicComposerMode === 'arrangement'
      ? this.getDisplayPhraseArrangement().pitchMode
      : this.musicPatternController.getPitchMode();
  }

  private getActiveMusicTempo(): number {
    return this.musicComposerMode === 'arrangement'
      ? this.getDisplayPhraseArrangement().bpm
      : this.getDisplayPatternMusic().bpm;
  }

  private getActiveMusicSwing(): number {
    return this.musicComposerMode === 'arrangement'
      ? this.getDisplayPhraseArrangement().swingPercent
      : this.getDisplayPatternMusic().swingPercent;
  }

  private getActiveMusicPhraseNameSuffix(): string {
    return this.getDisplayPatternMusic().phraseNameSuffixes[this.musicPatternController.getActiveInstrumentTab()] ?? '';
  }

  private getCurrentMusicPhraseUserId(): string | null {
    return getAuthDebugState().user?.id ?? null;
  }

  private getActivePatternSourcePhraseId(): string | null {
    if (this.musicComposerMode !== 'sequencer') {
      return null;
    }

    const pattern = this.getDisplayPatternMusic();
    const sourceIds = pattern.sourcePhraseIds[this.musicPatternController.getActiveInstrumentTab()] ?? [];
    const phraseId = sourceIds[0]?.trim();
    return phraseId ? phraseId : null;
  }

  private getActivePatternPhraseRecord(): MusicPhraseRecord | null {
    const phraseId = this.getActivePatternSourcePhraseId();
    if (!phraseId) {
      return null;
    }

    return this.musicPhraseRecordCache.get(phraseId) ?? null;
  }

  private canDeleteActivePatternPhrase(): boolean {
    const phrase = this.getActivePatternPhraseRecord();
    const currentUserId = this.getCurrentMusicPhraseUserId();
    return !!phrase && !!currentUserId && phrase.creatorUserId === currentUserId;
  }

  private getActiveMusicOctaveShift(): number | null {
    if (this.musicComposerMode === 'arrangement') {
      const instrumentId = this.musicPatternController.getActiveInstrumentTab();
      if (instrumentId === 'drums') {
        return null;
      }

      return this.getDisplayPhraseArrangement().octaveShift[instrumentId];
    }

    return this.musicPatternController.getActiveOctaveShift();
  }

  private rememberMusicPhrases(phrases: readonly MusicPhraseRecord[]): void {
    for (const phrase of phrases) {
      this.musicPhraseRecordCache.set(phrase.id, phrase);
    }
  }

  private applySavedMusicPhrasesToLibrary(phrases: readonly MusicPhraseRecord[]): void {
    if (phrases.length === 0) {
      return;
    }

    const activeInstrumentId = this.musicPatternController.getActiveInstrumentTab();
    const relevantPhrases = phrases.filter((phrase) => phrase.instrumentId === activeInstrumentId);
    if (relevantPhrases.length === 0) {
      return;
    }

    const nextItems = [...this.musicPhraseLibraryItems];
    for (const phrase of relevantPhrases) {
      const existingIndex = nextItems.findIndex((item) => item.id === phrase.id);
      if (existingIndex >= 0) {
        nextItems[existingIndex] = phrase;
      } else {
        nextItems.unshift(phrase);
      }
    }

    nextItems.sort((left, right) => {
      const createdAtDiff = Date.parse(right.createdAt) - Date.parse(left.createdAt);
      if (createdAtDiff !== 0) {
        return createdAtDiff;
      }
      return right.id.localeCompare(left.id);
    });

    this.musicPhraseLibraryInstrument = activeInstrumentId;
    this.musicPhraseLibraryLoaded = true;
    this.musicPhraseLibraryError = null;
    this.musicPhraseLibraryItems = nextItems;
  }

  private ensureArrangementSelection(instrumentId: RoomPatternInstrumentId): void {
    if (!this.musicArrangementSelection || this.musicArrangementSelection.instrumentId !== instrumentId) {
      this.musicArrangementSelection = {
        instrumentId,
        slotIndex: 0,
      };
    }
  }

  private getArrangementSelection(): EditorMusicArrangementSelection {
    const instrumentId = this.musicPatternController.getActiveInstrumentTab();
    this.ensureArrangementSelection(instrumentId);
    return this.musicArrangementSelection as EditorMusicArrangementSelection;
  }

  private async loadMusicPhraseLibrary(reset: boolean): Promise<void> {
    const instrumentId = this.musicPatternController.getActiveInstrumentTab();
    const requestId = this.musicPhraseLibraryRequestId + 1;
    this.musicPhraseLibraryRequestId = requestId;
    this.musicPhraseLibraryInstrument = instrumentId;
    if (reset) {
      this.musicPhraseLibraryLoading = true;
      this.musicPhraseLibraryLoadingMore = false;
      this.musicPhraseLibraryLoaded = false;
      this.musicPhraseLibraryItems = [];
      this.musicPhraseLibraryNextCursor = null;
      this.musicPhraseLibraryError = null;
    } else {
      if (!this.musicPhraseLibraryNextCursor) {
        return;
      }
      this.musicPhraseLibraryLoadingMore = true;
      this.musicPhraseLibraryError = null;
    }
    this.renderEditorUi();

    try {
      const response = await listMusicPhrases({
        instrumentId,
        cursor: reset ? null : this.musicPhraseLibraryNextCursor,
        limit: 24,
      });
      if (requestId !== this.musicPhraseLibraryRequestId) {
        return;
      }

      this.rememberMusicPhrases(response.items);
      this.musicPhraseLibraryLoaded = true;
      this.musicPhraseLibraryItems = reset
        ? [...response.items]
        : [...this.musicPhraseLibraryItems, ...response.items];
      this.musicPhraseLibraryNextCursor = response.nextCursor;
      this.musicPhraseLibraryError = null;
    } catch (error) {
      if (requestId !== this.musicPhraseLibraryRequestId) {
        return;
      }
      this.musicPhraseLibraryError =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : 'Failed to load music phrases.';
    } finally {
      if (requestId === this.musicPhraseLibraryRequestId) {
        this.musicPhraseLibraryLoading = false;
        this.musicPhraseLibraryLoadingMore = false;
        this.renderEditorUi();
      }
    }
  }

  private ensureMusicPhraseLibraryLoaded(force = false): void {
    const instrumentId = this.musicPatternController.getActiveInstrumentTab();
    const instrumentChanged = this.musicPhraseLibraryInstrument !== instrumentId;
    if (force || instrumentChanged) {
      void this.loadMusicPhraseLibrary(true);
      return;
    }

    if (
      !this.musicPhraseLibraryLoading &&
      !this.musicPhraseLibraryLoadingMore &&
      !this.musicPhraseLibraryLoaded &&
      !this.musicPhraseLibraryError
    ) {
      void this.loadMusicPhraseLibrary(true);
    }
  }

  private ensureArrangementPhraseCache(): void {
    if (!isPhraseArrangementRoomMusic(this.roomMusic)) {
      return;
    }

    for (const instrumentId of ROOM_PATTERN_INSTRUMENT_IDS) {
      for (const phraseId of this.roomMusic.slots[instrumentId]) {
        if (!phraseId || this.musicPhraseRecordCache.has(phraseId) || this.musicPhraseDetailLoading.has(phraseId)) {
          continue;
        }

        this.musicPhraseDetailLoading.add(phraseId);
        void getMusicPhrase(phraseId)
          .then((phrase) => {
            this.musicPhraseRecordCache.set(phrase.id, phrase);
            this.renderEditorUi();
          })
          .catch(() => {
            void 0;
          })
          .finally(() => {
            this.musicPhraseDetailLoading.delete(phraseId);
          });
      }
    }
  }

  private ensureActivePatternPhraseCache(): void {
    const phraseId = this.getActivePatternSourcePhraseId();
    if (!phraseId || this.musicPhraseRecordCache.has(phraseId) || this.musicPhraseDetailLoading.has(phraseId)) {
      return;
    }

    this.musicPhraseDetailLoading.add(phraseId);
    void getMusicPhrase(phraseId)
      .then((phrase) => {
        this.musicPhraseRecordCache.set(phrase.id, phrase);
        this.renderEditorUi();
      })
      .catch(() => {
        void 0;
      })
      .finally(() => {
        this.musicPhraseDetailLoading.delete(phraseId);
      });
  }

  private getArrangementSlotLabel(phraseId: string | null): string {
    if (!phraseId) {
      return 'Empty';
    }

    const phrase = this.musicPhraseRecordCache.get(phraseId) ?? null;
    if (!phrase) {
      return `Phrase ${phraseId.slice(0, 6)}`;
    }

    return getMusicPhraseDisplayName(phrase);
  }

  private getMusicPhraseSampleName(phrase: MusicPhraseRecord): string {
    return getMusicPhraseDisplayName(phrase);
  }

  private getMusicPhraseRoomLabel(phrase: MusicPhraseRecord): string {
    return phrase.roomTitle?.trim() ? phrase.roomTitle.trim() : `${phrase.roomX},${phrase.roomY}`;
  }

  private getMusicPhraseKeyLabel(phrase: MusicPhraseRecord): string {
    if (phrase.payload.kind === 'drums') {
      return 'No Key';
    }

    return `${phrase.payload.keyTonic} ${phrase.payload.keyMode === 'minor' ? 'Minor' : 'Major'}`;
  }

  setMusicModeActive(active: boolean): void {
    this.musicModeActive = active;
    if (active) {
      this.musicComposerMode = isPhraseArrangementRoomMusic(this.roomMusic)
        ? 'arrangement'
        : 'sequencer';
      this.musicPhraseMetadataEditing = false;
    }
    if (active && editorState.activeTool !== 'pencil' && editorState.activeTool !== 'eraser' && editorState.activeTool !== 'copy') {
      editorState.activeTool = 'pencil';
      this.toolController.updateToolUi();
    }
    if (active) {
      this.ensureArrangementSelection(this.musicPatternController.getActiveInstrumentTab());
      this.ensureMusicPhraseLibraryLoaded();
      this.ensureActivePatternPhraseCache();
    }
    if (!active) {
      this.musicPhraseMetadataEditing = false;
      this.musicPatternController.cancelPastePreview();
      if (this.musicPreviewState !== 'stopped') {
        this.stopRoomMusicPreview();
        return;
      }
    }
    this.renderEditorUi();
  }

  toggleMusicMode(): void {
    this.setMusicModeActive(!this.musicModeActive);
  }

  setMusicComposerMode(mode: EditorMusicComposerMode): void {
    if (this.musicComposerMode === mode) {
      return;
    }

    this.musicComposerMode = mode;
    if (mode === 'arrangement') {
      this.musicPhraseMetadataEditing = false;
    }
    if (mode === 'arrangement') {
      this.ensureArrangementSelection(this.musicPatternController.getActiveInstrumentTab());
    }
    this.ensureMusicPhraseLibraryLoaded();
    this.renderEditorUi();
  }

  setMusicPatternInstrumentTab(instrumentId: RoomPatternInstrumentId): void {
    this.musicPatternController.setActiveInstrumentTab(instrumentId);
    if (this.musicComposerMode === 'arrangement') {
      this.ensureArrangementSelection(instrumentId);
    }
    this.ensureMusicPhraseLibraryLoaded();
    this.renderEditorUi();
  }

  setRoomMusicPitchMode(mode: RoomPatternPitchMode): void {
    if (this.musicComposerMode === 'arrangement') {
      const arrangement = this.getEditablePhraseArrangement();
      if (!arrangement || arrangement.pitchMode === mode) {
        return;
      }

      arrangement.pitchMode = mode;
      this.commitRoomMusic(arrangement);
      return;
    }

    this.musicPatternController.setPitchMode(mode);
  }

  setRoomMusicKeyTonic(tonic: RoomMusicKeyTonic): void {
    if (this.musicComposerMode === 'arrangement') {
      const arrangement = this.getEditablePhraseArrangement();
      if (!arrangement || arrangement.keyTonic === tonic) {
        return;
      }

      arrangement.keyTonic = tonic;
      this.commitRoomMusic(arrangement);
      return;
    }

    this.musicPatternController.setKeyTonic(tonic);
  }

  setRoomMusicKeyMode(mode: RoomMusicKeyMode): void {
    if (this.musicComposerMode === 'arrangement') {
      const arrangement = this.getEditablePhraseArrangement();
      if (!arrangement || arrangement.keyMode === mode) {
        return;
      }

      arrangement.keyMode = mode;
      this.commitRoomMusic(arrangement);
      return;
    }

    this.musicPatternController.setKeyMode(mode);
  }

  shiftRoomMusicOctave(delta: number): void {
    if (this.musicComposerMode === 'arrangement') {
      const instrumentId = this.musicPatternController.getActiveInstrumentTab();
      if (instrumentId === 'drums') {
        return;
      }

      const arrangement = this.getEditablePhraseArrangement();
      if (!arrangement) {
        return;
      }

      const nextValue = Phaser.Math.Clamp(arrangement.octaveShift[instrumentId] + delta, -2, 2);
      if (nextValue === arrangement.octaveShift[instrumentId]) {
        return;
      }

      arrangement.octaveShift[instrumentId] = nextValue;
      this.commitRoomMusic(arrangement);
      return;
    }

    this.musicPatternController.shiftActiveOctave(delta);
  }

  shiftRoomMusicTempo(delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) {
      return;
    }

    if (this.musicComposerMode === 'arrangement') {
      const arrangement = this.getEditablePhraseArrangement();
      if (!arrangement) {
        return;
      }

      const nextValue = Phaser.Math.Clamp(Math.round(arrangement.bpm + delta), ROOM_PATTERN_MIN_BPM, ROOM_PATTERN_MAX_BPM);
      if (nextValue === arrangement.bpm) {
        return;
      }

      arrangement.bpm = nextValue;
      this.commitRoomMusic(arrangement);
      return;
    }

    const pattern = this.getEditablePatternMusic();
    if (!pattern) {
      return;
    }

    const nextValue = Phaser.Math.Clamp(Math.round(pattern.bpm + delta), ROOM_PATTERN_MIN_BPM, ROOM_PATTERN_MAX_BPM);
    if (nextValue === pattern.bpm) {
      return;
    }

    pattern.bpm = nextValue;
    this.commitRoomMusic(pattern);
  }

  shiftRoomMusicSwing(delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) {
      return;
    }

    if (this.musicComposerMode === 'arrangement') {
      const arrangement = this.getEditablePhraseArrangement();
      if (!arrangement) {
        return;
      }

      const nextValue = Phaser.Math.Clamp(
        Math.round(arrangement.swingPercent + delta),
        ROOM_PATTERN_MIN_SWING_PERCENT,
        ROOM_PATTERN_MAX_SWING_PERCENT,
      );
      if (nextValue === arrangement.swingPercent) {
        return;
      }

      arrangement.swingPercent = nextValue;
      this.commitRoomMusic(arrangement);
      return;
    }

    const pattern = this.getEditablePatternMusic();
    if (!pattern) {
      return;
    }

    const nextValue = Phaser.Math.Clamp(
      Math.round(pattern.swingPercent + delta),
      ROOM_PATTERN_MIN_SWING_PERCENT,
      ROOM_PATTERN_MAX_SWING_PERCENT,
    );
    if (nextValue === pattern.swingPercent) {
      return;
    }

    pattern.swingPercent = nextValue;
    this.commitRoomMusic(pattern);
  }

  setRoomMusicPhraseNameSuffix(value: string): void {
    if (this.musicComposerMode === 'arrangement') {
      return;
    }

    const pattern = this.getEditablePatternMusic();
    if (!pattern) {
      return;
    }

    const instrumentId = this.musicPatternController.getActiveInstrumentTab();
    const normalized = value.trim().slice(0, 24);
    const nextValue = normalized.length > 0 ? normalized : null;
    if ((pattern.phraseNameSuffixes[instrumentId] ?? null) === nextValue) {
      return;
    }

    pattern.phraseNameSuffixes[instrumentId] = nextValue;
    this.commitRoomMusic(pattern);
  }

  replaceLegacyRoomMusicWithPattern(): void {
    this.musicPatternController.replaceLegacyWithPattern();
  }

  refreshMusicPhraseLibrary(): void {
    this.ensureMusicPhraseLibraryLoaded(true);
  }

  loadMoreMusicPhrases(): void {
    if (this.musicPhraseLibraryLoading || this.musicPhraseLibraryLoadingMore || !this.musicPhraseLibraryNextCursor) {
      return;
    }

    void this.loadMusicPhraseLibrary(false);
  }

  async useMusicPhrase(phraseId: string): Promise<void> {
    try {
      const phrase = await getMusicPhrase(phraseId);
      this.rememberMusicPhrases([phrase]);
      if (this.musicComposerMode === 'arrangement') {
        await this.assignPhraseToArrangementSlot(phrase);
      } else {
        this.musicPatternController.insertPhrase(phrase);
      }
      playSfx('music-phrase-place', { ignoreCooldown: true });
      this.renderEditorUi();
    } catch (error) {
      this.musicPhraseLibraryError =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : 'Failed to load music phrase.';
      this.renderEditorUi();
    }
  }

  selectArrangementSlot(instrumentId: RoomPatternInstrumentId, slotIndex: number): void {
    if (slotIndex < 0 || slotIndex >= ROOM_PHRASE_ARRANGEMENT_SLOT_COUNT) {
      return;
    }

    this.musicArrangementSelection = { instrumentId, slotIndex };
    this.musicPatternController.setActiveInstrumentTab(instrumentId);
    this.ensureMusicPhraseLibraryLoaded();
    this.renderEditorUi();
  }

  clearSelectedArrangementSlot(): void {
    const arrangement = this.getEditablePhraseArrangement();
    if (!arrangement) {
      return;
    }

    const selection = this.getArrangementSelection();
    if (arrangement.slots[selection.instrumentId][selection.slotIndex] === null) {
      return;
    }

    arrangement.slots[selection.instrumentId][selection.slotIndex] = null;
    playSfx('music-slot-clear', { ignoreCooldown: true });
    this.commitRoomMusic(arrangement);
  }

  clearAllArrangementSlots(): void {
    const arrangement = this.getEditablePhraseArrangement();
    if (!arrangement) {
      return;
    }

    let changed = false;
    for (const instrumentId of ROOM_PATTERN_INSTRUMENT_IDS) {
      for (let slotIndex = 0; slotIndex < ROOM_PHRASE_ARRANGEMENT_SLOT_COUNT; slotIndex += 1) {
        if (arrangement.slots[instrumentId][slotIndex] !== null) {
          arrangement.slots[instrumentId][slotIndex] = null;
          changed = true;
        }
      }
    }

    if (!changed) {
      return;
    }

    playSfx('music-slot-clear-all', { ignoreCooldown: true });
    this.commitRoomMusic(arrangement);
  }

  async assignMusicPhraseToArrangementSlot(
    phraseId: string,
    instrumentId: RoomPatternInstrumentId,
    slotIndex: number,
  ): Promise<void> {
    if (slotIndex < 0 || slotIndex >= ROOM_PHRASE_ARRANGEMENT_SLOT_COUNT) {
      return;
    }

    this.musicArrangementSelection = { instrumentId, slotIndex };
    this.musicPatternController.setActiveInstrumentTab(instrumentId);
    this.ensureMusicPhraseLibraryLoaded();
    this.renderEditorUi();
    await this.useMusicPhrase(phraseId);
  }

  private async assignPhraseToArrangementSlot(phrase: MusicPhraseRecord): Promise<void> {
    const selection = this.getArrangementSelection();
    if (phrase.instrumentId !== selection.instrumentId) {
      this.musicPhraseLibraryError = `Selected slot expects ${getPatternInstrumentLabel(selection.instrumentId)} phrases.`;
      return;
    }

    const arrangement = this.getEditablePhraseArrangement();
    if (!arrangement) {
      return;
    }

    if (
      isRoomPhraseArrangementEmpty(arrangement) &&
      phrase.payload.kind === 'tonal'
    ) {
      arrangement.keyTonic = phrase.sourceKeyTonic ?? phrase.payload.keyTonic;
      arrangement.keyMode = phrase.sourceKeyMode ?? phrase.payload.keyMode;
    }

    arrangement.slots[selection.instrumentId][selection.slotIndex] = phrase.id;
    this.musicArrangementSelection = {
      instrumentId: selection.instrumentId,
      slotIndex: Math.min(ROOM_PHRASE_ARRANGEMENT_SLOT_COUNT - 1, selection.slotIndex + 1),
    };
    this.commitRoomMusic(arrangement);
  }

  toggleRoomMusicPreview(): void {
    if (this.musicPreviewState === 'playing') {
      this.stopRoomMusicPreview();
      return;
    }

    this.playRoomMusicPreview();
  }

  private playRoomMusicPreview(): void {
    this.musicPreviewState = 'playing';
    this.syncRoomMusicPreviewPlayback();
    this.renderMusicUi();
  }

  private stopRoomMusicPreview(): void {
    this.musicPreviewState = 'stopped';
    globalRoomMusicController.stopArrangement({
      transition: 'immediate',
      fadeDurationSec: 0.08,
      mode: 'editor-preview',
      resetTransport: true,
    });
    this.renderEditorUi();
  }

  private syncRoomMusicPreviewPlayback(): void {
    if (this.musicPreviewState !== 'playing') {
      globalRoomMusicController.stopArrangement({
        transition: 'immediate',
        fadeDurationSec: 0.08,
        mode: 'editor-preview',
        resetTransport: true,
      });
      return;
    }

    const roomMusic = this.roomMusic;
    if (!roomMusic) {
      this.musicPreviewState = 'stopped';
      globalRoomMusicController.stopArrangement({
        transition: 'immediate',
        fadeDurationSec: 0.08,
        mode: 'editor-preview',
        resetTransport: true,
      });
      return;
    }

    void globalRoomMusicController.playArrangement(roomMusic, {
      mode: 'editor-preview',
      transition: 'immediate',
    });
  }

  private commitRoomMusic(nextMusic: RoomMusic | null): RoomMusic | null {
    const committed = this.editRuntime.setRoomMusic(nextMusic);
    if (this.musicPreviewState === 'playing') {
      this.syncRoomMusicPreviewPlayback();
    }
    this.renderEditorUi();
    return committed;
  }

  private commitLegacyRoomMusicPatternReplacement(): RoomMusic | null {
    const committed = this.editRuntime.replaceRoomMusicWithPattern();
    if (this.musicPreviewState === 'playing') {
      this.syncRoomMusicPreviewPlayback();
    }
    this.renderEditorUi();
    return committed;
  }

  private handleMusicPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.musicComposerMode !== 'sequencer') {
      return;
    }
    this.musicPatternController.handlePointerDown(pointer);
  }

  private handleMusicPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.musicComposerMode !== 'sequencer') {
      return;
    }
    this.musicPatternController.handlePointerMove(pointer);
  }

  private handleMusicPointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.musicComposerMode !== 'sequencer') {
      return;
    }
    this.musicPatternController.handlePointerUp(pointer);
  }

  private updateMusicCursorHighlight(graphics: Phaser.GameObjects.Graphics): boolean {
    if (this.musicComposerMode !== 'sequencer') {
      return false;
    }
    return this.musicPatternController.updateCursorHighlight(graphics);
  }

  private renderMusicWorkbenchModeButtons(legacyLocked: boolean): void {
    const modeRoot = document.getElementById('editor-music-composer-modes');
    if (!modeRoot) {
      return;
    }

    modeRoot.replaceChildren(
      ...([
        { mode: 'sequencer', label: 'Sequencer' },
        { mode: 'arrangement', label: 'Arrange' },
      ] as const).map(({ mode, label }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'bar-btn bar-btn-small editor-music-chip-button';
        if (mode === this.musicComposerMode) {
          button.classList.add('active');
        }
        button.dataset.roomMusicComposerMode = mode;
        button.textContent = label;
        button.disabled = legacyLocked;
        return button;
      }),
    );
  }

  private renderMusicWorkbenchKeyControls(legacyLocked: boolean): void {
    const tonicSelect = document.getElementById('editor-music-key-tonic-select') as HTMLSelectElement | null;
    const modeSelect = document.getElementById('editor-music-key-mode-select') as HTMLSelectElement | null;
    const activeTonic = this.getActiveMusicKeyTonic();
    const activeMode = this.getActiveMusicKeyMode();

    if (tonicSelect) {
      tonicSelect.replaceChildren(
        ...ROOM_MUSIC_KEY_TONICS.map((tonic) => {
          const option = document.createElement('option');
          option.value = tonic;
          option.textContent = tonic;
          return option;
        }),
      );
      tonicSelect.value = activeTonic;
      tonicSelect.disabled = legacyLocked;
    }

    if (modeSelect) {
      modeSelect.replaceChildren(
        ...ROOM_MUSIC_KEY_MODES.map((mode) => {
          const option = document.createElement('option');
          option.value = mode;
          option.textContent = mode === 'major' ? 'Major' : 'Minor';
          return option;
        }),
      );
      modeSelect.value = activeMode;
      modeSelect.disabled = legacyLocked;
    }
  }

  private renderMusicArrangementPanel(legacyLocked: boolean): void {
    const panel = document.getElementById('editor-music-arrangement-panel');
    const grid = document.getElementById('editor-music-arrangement-grid');
    const status = document.getElementById('editor-music-arrangement-status');
    const clearButton = document.getElementById('btn-editor-music-arrangement-clear-slot') as HTMLButtonElement | null;
    const clearAllButton = document.getElementById('btn-editor-music-arrangement-clear-all') as HTMLButtonElement | null;
    if (!panel || !grid || !status) {
      return;
    }

    const showPanel = this.musicComposerMode === 'arrangement';
    panel.classList.toggle('hidden', !showPanel);
    if (!showPanel) {
      return;
    }

    const arrangement = this.getDisplayPhraseArrangement();
    const selection = this.getArrangementSelection();
    const selectedPhraseId = arrangement.slots[selection.instrumentId][selection.slotIndex] ?? null;
    const filledSlotCount = ROOM_PATTERN_INSTRUMENT_IDS.reduce(
      (count, instrumentId) =>
        count + arrangement.slots[instrumentId].filter((phraseId) => phraseId !== null).length,
      0,
    );
    status.textContent = selectedPhraseId
      ? `Selected ${getPatternInstrumentLabel(selection.instrumentId)} ${selection.slotIndex + 1}. Drag in a phrase, click a library phrase, or clear this slot.`
      : `Selected ${getPatternInstrumentLabel(selection.instrumentId)} ${selection.slotIndex + 1}. Drag in a phrase or click one in the library to patch it here.`;

    grid.replaceChildren(
      ...ROOM_PATTERN_INSTRUMENT_IDS.map((instrumentId) => {
        const row = document.createElement('div');
        row.className = 'editor-music-arrangement-row';
        row.dataset.roomMusicArrangementInstrument = instrumentId;
        row.style.setProperty('--editor-music-instrument-accent', getPatternInstrumentColorCss(instrumentId));
        row.style.setProperty('--editor-music-instrument-rgb', getPatternInstrumentColorRgbCss(instrumentId));

        const label = document.createElement('div');
        label.className = 'editor-music-arrangement-label';
        label.textContent = `${getPatternInstrumentIcon(instrumentId)} ${getPatternInstrumentLabel(instrumentId)}`;
        row.append(label);

        const cells = document.createElement('div');
        cells.className = 'editor-music-arrangement-cells';
        for (let slotIndex = 0; slotIndex < ROOM_PHRASE_ARRANGEMENT_SLOT_COUNT; slotIndex += 1) {
          const phraseId = arrangement.slots[instrumentId][slotIndex] ?? null;
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'editor-music-arrangement-slot';
          if (
            selection.instrumentId === instrumentId &&
            selection.slotIndex === slotIndex
          ) {
            button.classList.add('active');
          }
          if (phraseId) {
            button.classList.add('filled');
          }
          button.dataset.roomMusicArrangementInstrument = instrumentId;
          button.dataset.roomMusicArrangementSlot = String(slotIndex);
          button.disabled = legacyLocked;
          button.dataset.roomMusicTooltip = phraseId
            ? this.getArrangementSlotLabel(phraseId)
            : `${getPatternInstrumentLabel(instrumentId)} slot ${slotIndex + 1} is empty.`;
          button.ariaLabel = phraseId
            ? `${getPatternInstrumentLabel(instrumentId)} slot ${slotIndex + 1}: ${this.getArrangementSlotLabel(phraseId)}`
            : `Empty ${getPatternInstrumentLabel(instrumentId)} slot ${slotIndex + 1}`;

          const slotNumber = document.createElement('span');
          slotNumber.className = 'editor-music-arrangement-slot-index';
          slotNumber.textContent = String(slotIndex + 1);
          button.append(slotNumber);

          if (phraseId) {
            const slotGlyph = document.createElement('span');
            slotGlyph.className = 'editor-music-arrangement-slot-glyph';
            slotGlyph.textContent = getPatternInstrumentIcon(instrumentId);
            button.append(slotGlyph);
          }

          cells.append(button);
        }

        row.append(cells);
        return row;
      }),
    );

    if (clearButton) {
      clearButton.disabled = legacyLocked || selectedPhraseId === null;
    }
    if (clearAllButton) {
      clearAllButton.disabled = legacyLocked || filledSlotCount === 0;
    }
  }

  private renderMusicLibraryPanel(legacyLocked: boolean): void {
    const listRoot = document.getElementById('editor-music-library-list');
    const status = document.getElementById('editor-music-library-status');
    const moreButton = document.getElementById('btn-editor-music-library-more') as HTMLButtonElement | null;
    const instrumentId = this.musicPatternController.getActiveInstrumentTab();
    const actionLabel =
      this.musicComposerMode === 'arrangement'
        ? `Drag or click a ${getPatternInstrumentLabel(instrumentId)} phrase into the selected slot.`
        : `Insert ${getPatternInstrumentLabel(instrumentId)} phrase into the sequencer lane.`;

    if (status) {
      if (this.musicPhraseLibraryLoading) {
        status.textContent = `Loading ${getPatternInstrumentLabel(instrumentId)} phrases...`;
      } else if (this.musicPhraseLibraryError) {
        status.textContent = this.musicPhraseLibraryError;
      } else if (this.musicPhraseLibraryItems.length === 0) {
        status.textContent = `No published ${getPatternInstrumentLabel(instrumentId).toLowerCase()} phrases yet.`;
      } else {
        status.textContent = actionLabel;
      }
    }

    if (!listRoot) {
      return;
    }

    if (this.musicPhraseLibraryLoading && this.musicPhraseLibraryItems.length === 0) {
      listRoot.replaceChildren();
    } else if (this.musicPhraseLibraryItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'editor-music-library-empty';
      empty.textContent = 'Publish a sequencer loop to start building the library.';
      listRoot.replaceChildren(empty);
    } else {
      listRoot.replaceChildren(
        ...this.musicPhraseLibraryItems.map((phrase) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'editor-music-library-item';
          button.dataset.roomMusicPhraseId = phrase.id;
          button.dataset.roomMusicInstrument = phrase.instrumentId;
          button.draggable = !legacyLocked;
          button.disabled = legacyLocked;
          button.title = phrase.label;
          button.style.setProperty('--editor-music-instrument-accent', getPatternInstrumentColorCss(phrase.instrumentId));
          button.style.setProperty('--editor-music-instrument-rgb', getPatternInstrumentColorRgbCss(phrase.instrumentId));

          const header = document.createElement('span');
          header.className = 'editor-music-library-item-header';

          const icon = document.createElement('span');
          icon.className = 'editor-music-library-item-icon';
          icon.textContent = getPatternInstrumentIcon(phrase.instrumentId);
          header.append(icon);

          const title = document.createElement('span');
          title.className = 'editor-music-library-item-title';
          title.textContent = this.getMusicPhraseSampleName(phrase);
          header.append(title);

          const detail = document.createElement('span');
          detail.className = 'editor-music-library-item-detail';
          detail.textContent = `${this.getMusicPhraseKeyLabel(phrase)} · ${phrase.payload.bpm} BPM`;
          header.append(detail);
          button.append(header);

          const meta = document.createElement('span');
          meta.className = 'editor-music-library-item-meta';
          meta.textContent = `${phrase.creatorDisplayName} · ${this.getMusicPhraseRoomLabel(phrase)}`;
          button.append(meta);

          return button;
        }),
      );
    }

    if (moreButton) {
      moreButton.classList.toggle('hidden', !this.musicPhraseLibraryNextCursor);
      moreButton.disabled = legacyLocked || this.musicPhraseLibraryLoadingMore;
      moreButton.textContent = this.musicPhraseLibraryLoadingMore ? 'Loading...' : 'Load More';
    }
  }

  private renderMusicUi(): void {
    const body = document.body;
    body.dataset.editorMusicMode = this.musicModeActive ? 'true' : 'false';
    body.dataset.editorMusicUiLocked = this.musicModeActive ? 'true' : 'false';
    if (this.musicModeActive) {
      this.ensureMusicPhraseLibraryLoaded();
      this.ensureArrangementPhraseCache();
    }

    const modeButton = document.getElementById('btn-editor-music-mode') as HTMLButtonElement | null;
    if (modeButton) {
      modeButton.textContent = this.musicModeActive ? 'Close Music' : 'Edit Music';
      modeButton.classList.toggle('active', this.musicModeActive);
    }

    const summary = document.getElementById('music-summary');
    if (summary) {
      if (isStemArrangementRoomMusic(this.roomMusic)) {
        summary.textContent = 'Legacy WAMP stem music is saved in this room. Replace it to edit on the room grid.';
      } else if (isPhraseArrangementRoomMusic(this.roomMusic)) {
        const arrangement = this.roomMusic;
        const filledSlotCount = ROOM_PATTERN_INSTRUMENT_IDS.reduce(
          (count, instrumentId) =>
            count + arrangement.slots[instrumentId].filter((phraseId: string | null) => phraseId !== null).length,
          0,
        );
        const activeSegmentCount = getRoomPhraseArrangementActiveSlotCount(arrangement);
        summary.textContent = `${filledSlotCount} phrase slots arranged across ${activeSegmentCount} active segments.`;
      } else if (isPatternRoomMusic(this.roomMusic)) {
        summary.textContent = `${this.musicPatternController.getActiveCellCount()} notes and hits on ${getPatternInstrumentLabel(this.musicPatternController.getActiveInstrumentTab())}.`;
      } else {
        summary.textContent =
          this.musicComposerMode === 'arrangement'
            ? 'No phrase arrangement yet. Pick a slot, then click a phrase from the library.'
            : 'No room music yet. Click on the room grid to start a sequencer loop.';
      }
    }

    const overlay = document.getElementById('editor-music-overlay');
    overlay?.classList.toggle('hidden', !this.musicModeActive);
    const workbench = document.getElementById('editor-music-workbench');
    workbench?.classList.toggle('hidden', !this.musicModeActive);
    const legacyLocked = this.musicPatternController.getLegacyStemNoticeVisible();

    const previewToggleButton = document.getElementById('btn-editor-music-preview-toggle') as HTMLButtonElement | null;
    if (previewToggleButton) {
      const isPlaying = this.musicPreviewState === 'playing';
      previewToggleButton.textContent = isPlaying ? '⏹' : '▶';
      previewToggleButton.title = isPlaying ? 'Stop room music preview' : 'Play room music preview';
      previewToggleButton.ariaLabel = previewToggleButton.title;
      previewToggleButton.disabled = (this.musicPreviewState === 'stopped' && !this.roomMusic) || this.saveInFlight;
    }

    const saveButton = document.getElementById('btn-editor-music-save') as HTMLButtonElement | null;
    if (saveButton) {
      const savePhrases = this.musicComposerMode === 'sequencer' && !legacyLocked;
      saveButton.disabled = !this.roomPermissions.canSaveDraft || this.saveInFlight || this.musicPhraseSaveInFlight;
      saveButton.title = this.roomPermissions.canSaveDraft
        ? savePhrases
          ? 'Save room draft and phrases (Cmd/Ctrl+S)'
          : 'Save Room Draft (Cmd/Ctrl+S)'
        : 'You cannot save drafts for this room.';
      saveButton.ariaLabel = saveButton.title;
    }

    const publishButton = document.getElementById('btn-editor-music-publish') as HTMLButtonElement | null;
    if (publishButton) {
      publishButton.disabled = !this.roomPermissions.canPublish || this.saveInFlight;
      publishButton.title = this.roomPermissions.canPublish
        ? 'Publish Room (Cmd/Ctrl+Shift+P)'
        : 'You cannot publish this room.';
      publishButton.ariaLabel = publishButton.title;
    }

    const instrumentTabsRoot = document.getElementById('editor-music-instrument-tabs');
    if (instrumentTabsRoot) {
      instrumentTabsRoot.replaceChildren(
        ...ROOM_PATTERN_INSTRUMENT_IDS.map((instrumentId) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'bar-btn bar-btn-small editor-music-tab-button editor-music-icon-button';
          if (instrumentId === this.musicPatternController.getActiveInstrumentTab()) {
            button.classList.add('active');
          }
          button.dataset.roomMusicInstrumentTab = instrumentId;
          button.dataset.roomMusicInstrument = instrumentId;
          button.style.setProperty('--editor-music-instrument-accent', getPatternInstrumentColorCss(instrumentId));
          button.style.setProperty('--editor-music-instrument-rgb', getPatternInstrumentColorRgbCss(instrumentId));
          button.textContent = getPatternInstrumentIcon(instrumentId);
          button.title = getPatternInstrumentLabel(instrumentId);
          button.ariaLabel = getPatternInstrumentLabel(instrumentId);
          return button;
        }),
      );
    }

    const pitchModesRoot = document.getElementById('editor-music-pitch-modes');
    if (pitchModesRoot) {
      const pitchMode = this.getActiveMusicPitchMode();
      pitchModesRoot.replaceChildren(
        ...(['scale', 'chromatic'] as const).map((mode) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'bar-btn bar-btn-small editor-music-chip-button';
          if (mode === pitchMode) {
            button.classList.add('active');
          }
          button.dataset.roomMusicPitchMode = mode;
          button.textContent = mode === 'scale' ? 'Scale Lock' : 'Chromatic';
          button.disabled = legacyLocked;
          return button;
        }),
      );
    }

    const octaveControls = document.getElementById('editor-music-octave-controls');
    const octaveLabel = document.getElementById('editor-music-octave-label');
    const activeOctaveShift = this.getActiveMusicOctaveShift();
    if (octaveControls) {
      octaveControls.classList.toggle('is-inactive', activeOctaveShift === null);
    }
    if (octaveLabel) {
      octaveLabel.textContent =
        activeOctaveShift === null
          ? ''
          : `Octave ${activeOctaveShift >= 0 ? '+' : ''}${activeOctaveShift}`;
    }

    const octaveDownButton = document.getElementById('btn-editor-music-octave-down') as HTMLButtonElement | null;
    const octaveUpButton = document.getElementById('btn-editor-music-octave-up') as HTMLButtonElement | null;
    if (octaveDownButton) {
      octaveDownButton.disabled = activeOctaveShift === null || activeOctaveShift <= -2;
    }
    if (octaveUpButton) {
      octaveUpButton.disabled = activeOctaveShift === null || activeOctaveShift >= 2;
    }

    const tempoLabel = document.getElementById('editor-music-tempo-label');
    if (tempoLabel) {
      tempoLabel.textContent = `Tempo ${this.getActiveMusicTempo()}`;
    }

    const tempoDownButton = document.getElementById('btn-editor-music-tempo-down') as HTMLButtonElement | null;
    const tempoUpButton = document.getElementById('btn-editor-music-tempo-up') as HTMLButtonElement | null;
    const activeTempo = this.getActiveMusicTempo();
    if (tempoDownButton) {
      tempoDownButton.disabled = legacyLocked || activeTempo <= ROOM_PATTERN_MIN_BPM;
    }
    if (tempoUpButton) {
      tempoUpButton.disabled = legacyLocked || activeTempo >= ROOM_PATTERN_MAX_BPM;
    }

    const swingLabel = document.getElementById('editor-music-swing-label');
    if (swingLabel) {
      swingLabel.textContent = `Swing ${this.getActiveMusicSwing()}%`;
    }

    const swingDownButton = document.getElementById('btn-editor-music-swing-down') as HTMLButtonElement | null;
    const swingUpButton = document.getElementById('btn-editor-music-swing-up') as HTMLButtonElement | null;
    const activeSwing = this.getActiveMusicSwing();
    if (swingDownButton) {
      swingDownButton.disabled = legacyLocked || activeSwing <= ROOM_PATTERN_MIN_SWING_PERCENT;
    }
    if (swingUpButton) {
      swingUpButton.disabled = legacyLocked || activeSwing >= ROOM_PATTERN_MAX_SWING_PERCENT;
    }

    const phraseActionRow = document.getElementById('editor-music-phrase-action-row');
    const phraseNewButton = document.getElementById('btn-editor-music-phrase-new') as HTMLButtonElement | null;
    const phraseEditButton = document.getElementById('btn-editor-music-phrase-edit') as HTMLButtonElement | null;
    const phraseSaveButton = document.getElementById('btn-editor-music-phrase-save') as HTMLButtonElement | null;
    const phraseDeleteButton = document.getElementById('btn-editor-music-phrase-delete') as HTMLButtonElement | null;
    const phraseNameRow = document.getElementById('editor-music-phrase-name-row');
    const phraseNameLabel = document.getElementById('editor-music-phrase-name-label');
    const phraseNameInput = document.getElementById('editor-music-phrase-name-input') as HTMLInputElement | null;
    const activeInstrumentLabel = getPatternInstrumentLabel(this.musicPatternController.getActiveInstrumentTab());
    const showPhraseNameInput = !legacyLocked && this.musicComposerMode === 'sequencer' && this.musicPhraseMetadataEditing;
    const canDeletePhrase = !legacyLocked && showPhraseNameInput && this.canDeleteActivePatternPhrase();
    phraseActionRow?.classList.toggle('hidden', legacyLocked);
    phraseNameRow?.classList.toggle('hidden', !showPhraseNameInput);
    if (phraseNameLabel) {
      phraseNameLabel.textContent = `${activeInstrumentLabel} Phrase Name`;
    }
    if (phraseNameInput) {
      phraseNameInput.disabled = !showPhraseNameInput;
      phraseNameInput.placeholder = `Auto: ${activeInstrumentLabel} 1`;
      const nextValue = this.getActiveMusicPhraseNameSuffix();
      const phraseNameFocused = document.activeElement === phraseNameInput;
      if (!phraseNameFocused && phraseNameInput.value !== nextValue) {
        phraseNameInput.value = nextValue;
      }
    }
    if (phraseNewButton) {
      phraseNewButton.disabled =
        legacyLocked ||
        !this.roomPermissions.canSaveDraft ||
        this.saveInFlight ||
        this.musicPhraseSaveInFlight ||
        this.musicPhraseDeleteInFlight;
      phraseNewButton.title = this.musicComposerMode === 'arrangement'
        ? `Save the arrangement draft and open a fresh ${activeInstrumentLabel} sequence.`
        : `Autosave and start a fresh ${activeInstrumentLabel} phrase.`;
      phraseNewButton.ariaLabel = phraseNewButton.title;
    }
    if (phraseEditButton) {
      const disabled = legacyLocked || this.musicComposerMode !== 'sequencer' || this.musicPhraseDeleteInFlight;
      phraseEditButton.disabled = disabled;
      phraseEditButton.classList.toggle('active', !disabled && this.musicPhraseMetadataEditing);
      phraseEditButton.title = disabled
        ? 'Phrase metadata editing is only available in Sequencer mode.'
        : `${this.musicPhraseMetadataEditing ? 'Hide' : 'Edit'} phrase name. Key and tempo stay in the controls above.`;
      phraseEditButton.ariaLabel = phraseEditButton.title;
    }
    if (phraseSaveButton) {
      phraseSaveButton.disabled =
        legacyLocked ||
        this.musicComposerMode !== 'sequencer' ||
        !this.roomPermissions.canSaveDraft ||
        this.saveInFlight ||
        this.musicPhraseSaveInFlight ||
        this.musicPhraseDeleteInFlight;
      phraseSaveButton.title = this.musicComposerMode === 'sequencer'
        ? `Detect key and save ${activeInstrumentLabel} phrase.`
        : 'Phrase save is only available in Sequencer mode.';
      phraseSaveButton.ariaLabel = phraseSaveButton.title;
    }
    if (phraseDeleteButton) {
      phraseDeleteButton.classList.toggle('hidden', !showPhraseNameInput);
      phraseDeleteButton.disabled = !canDeletePhrase || this.musicPhraseDeleteInFlight;
      phraseDeleteButton.title = canDeletePhrase
        ? `Delete your saved ${activeInstrumentLabel} phrase.`
        : 'Only your own saved phrases can be deleted.';
      phraseDeleteButton.ariaLabel = phraseDeleteButton.title;
      phraseDeleteButton.textContent = this.musicPhraseDeleteInFlight ? 'Deleting...' : 'Delete';
    }

    const legacyNotice = document.getElementById('editor-music-legacy-notice');
    legacyNotice?.classList.toggle('hidden', !legacyLocked);
    this.renderMusicWorkbenchModeButtons(legacyLocked);
    this.renderMusicWorkbenchKeyControls(legacyLocked);
    this.renderMusicArrangementPanel(legacyLocked);
    this.renderMusicLibraryPanel(legacyLocked);
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
      lighting: this.lightingController.getDebugState(),
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
