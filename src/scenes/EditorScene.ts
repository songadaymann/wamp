import Phaser from 'phaser';
import {
  TILE_SIZE,
  ROOM_WIDTH,
  ROOM_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_PX_HEIGHT,
  LAYER_NAMES,
  TILESETS,
  editorState,
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
  cloneRoomGoal,
  goalSupportsTimeLimit,
  type RoomGoal,
  type RoomGoalType,
} from '../goals/roomGoals';
import { setAppMode } from '../ui/appMode';
import { isTextInputFocused } from '../ui/keyboardFocus';
import type { EditorSceneData, OverworldPlaySceneData } from './sceneData';
import { EditorUiBridge } from './editor/uiBridge';
import { EditorRoomSession } from './editor/roomSession';
import { EditorBackgroundController } from './editor/backgrounds';
import { EditorEditRuntime, type GoalPlacementMode } from './editor/editRuntime';
import { EditorInteractionController } from './editor/interaction';

const EDITOR_NEIGHBOR_RADIUS = 1;

export class EditorScene extends Phaser.Scene {
  private uiBridge: EditorUiBridge | null = null;

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
  private readonly handleWake = (): void => {
    setAppMode('editor');
    editorState.isPlaying = false;
    this.updateBottomBar();
    this.updateGoalUi();
  };
  private readonly handleBackgroundChanged = (): void => {
    this.updateBackground();
    this.markRoomDirty();
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
    document.removeEventListener('keydown', this.handleDocumentKeyDown);
    this.events.off('wake', this.handleWake, this);
    this.scale.off('resize', this.handleResize, this);
    this.input.removeAllListeners();
    this.input.keyboard?.removeAllListeners();
    this.game.canvas.removeEventListener('contextmenu', this.handleCanvasContextMenu);
    this.uiBridge?.destroy();
    this.uiBridge = null;
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
      getGoalPlacementMode: () => this.goalPlacementMode,
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
    return this.editRuntime.currentGoalMarkerSprites;
  }

  private get goalMarkerLabels(): Phaser.GameObjects.Text[] {
    return this.editRuntime.currentGoalMarkerLabels;
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

  private get goalPlacementMode(): GoalPlacementMode {
    return this.editRuntime.currentGoalPlacementMode;
  }

  private set goalPlacementMode(value: GoalPlacementMode) {
    this.editRuntime.currentGoalPlacementMode = value;
  }

  create(data?: EditorSceneData): void {
    this.resetRuntimeState();

    this.initialRoomSnapshot = data?.roomSnapshot ? cloneRoomSnapshot(data.roomSnapshot) : null;

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
    this.setupCamera();
    this.setupInput();
    this.setupKeyboard();
    this.rebuildObjectSprites();
    this.syncBackgroundCameraIgnores();
    this.updateBackgroundPreview();

    this.events.on('wake', this.handleWake, this);
    window.addEventListener('background-changed', this.handleBackgroundChanged);
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
    this.updateBottomBar();
    this.updateGoalUi();
  }

  update(time: number): void {
    this.maybeAutoSave(time);
    this.updateBackgroundPreview();
    this.updateCursorHighlight();
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
    this.tilesets = new Map();
    this.layers = new Map();
    this.editRuntime.reset();
    this.roomSession.reset();
    editorState.isPlaying = false;
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
    await this.roomSession.loadPersistedRoom(this.initialRoomSnapshot);
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
    this.updatePersistenceStatus(
      this.roomPermissions.canSaveDraft
        ? 'Draft changes...'
        : 'Read-only minted room. Changes are local only.'
    );
  }

  private updatePersistenceStatus(text: string): void {
    this.roomSession.setStatusText(text);
  }

  async saveDraft(force: boolean = false): Promise<RoomRecord | null> {
    return this.roomSession.saveDraft(force);
  }

  async publishRoom(successText?: string): Promise<RoomRecord | null> {
    return this.roomSession.publishRoom(successText);
  }

  async revertToVersion(targetVersion: number): Promise<RoomRecord | null> {
    return this.roomSession.revertToVersion(targetVersion, this.initialRoomSnapshot);
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

  startGoalMarkerPlacement(mode: GoalPlacementMode): void {
    this.editRuntime.startGoalMarkerPlacement(mode);
  }

  clearGoalMarkers(): void {
    this.editRuntime.clearGoalMarkers();
  }

  getGoalEditorState(): {
    goal: RoomGoal | null;
    placementMode: GoalPlacementMode;
    availableCollectibles: number;
    availableEnemies: number;
  } {
    return this.editRuntime.getGoalEditorState();
  }

  private placeGoalMarker(tileX: number, tileY: number): void {
    this.editRuntime.placeGoalMarker(tileX, tileY);
  }

  private removeGoalMarkerAt(worldX: number, worldY: number): boolean {
    return this.editRuntime.removeGoalMarkerAt(worldX, worldY);
  }

  private goalUsesMarkers(goal: RoomGoal | null): boolean {
    return this.editRuntime.goalUsesMarkers(goal);
  }

  private getGoalSummaryText(): string {
    return this.editRuntime.getGoalSummaryText();
  }

  private updateGoalUi(): void {
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

  startPlayMode(): void {
    if (this.roomPermissions.canSaveDraft) {
      void this.saveDraft(true);
    }
    const playData: OverworldPlaySceneData = {
      centerCoordinates: { ...this.roomCoordinates },
      roomCoordinates: { ...this.roomCoordinates },
      draftRoom: this.exportRoomSnapshot(),
      mode: 'play',
    };

    this.scene.sleep();
    this.scene.wake('OverworldPlayScene', playData);
    this.updateBottomBar();
  }

  // ══════════════════════════════════════
  // UI SYNC
  // ══════════════════════════════════════

  private updateToolUI(): void {
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.tool === editorState.activeTool);
    });
  }

  private updateBottomBar(): void {
    this.renderEditorUi();
  }

  private renderEditorUi(): void {
    this.uiBridge?.render({
      roomTitleValue: this.roomTitle ?? '',
      roomCoordinatesText: `Room (${this.roomCoordinates.x}, ${this.roomCoordinates.y})`,
      saveStatusText:
        this.persistenceStatusText ||
        (this.entrySource === 'world' && !this.roomDirty ? this.getIdleStatusText() : ''),
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
      goal: {
        goalTypeValue: this.roomGoal?.type ?? '',
        timeLimitHidden: !this.roomGoal || !goalSupportsTimeLimit(this.roomGoal.type),
        timeLimitValue:
          this.roomGoal && goalSupportsTimeLimit(this.roomGoal.type) && this.roomGoal.type !== 'survival' && this.roomGoal.timeLimitMs
            ? String(Math.round(this.roomGoal.timeLimitMs / 1000))
            : '',
        requiredCountHidden: this.roomGoal?.type !== 'collect_target',
        requiredCountValue:
          this.roomGoal?.type === 'collect_target' ? String(this.roomGoal.requiredCount) : '1',
        survivalHidden: this.roomGoal?.type !== 'survival',
        survivalValue:
          this.roomGoal?.type === 'survival'
            ? String(Math.round(this.roomGoal.durationMs / 1000))
            : '30',
        markerControlsHidden: !this.goalUsesMarkers(this.roomGoal),
        placementHintHidden: this.goalPlacementMode === null,
        placementHintText:
          this.goalPlacementMode === 'exit'
            ? 'Click the canvas to place the exit marker.'
            : this.goalPlacementMode === 'checkpoint'
              ? 'Click the canvas to add a checkpoint marker.'
              : this.goalPlacementMode === 'finish'
                ? 'Click the canvas to place the finish marker.'
                : '',
        summaryText: this.getGoalSummaryText(),
        placeExitHidden: this.roomGoal?.type !== 'reach_exit',
        placeExitActive: this.goalPlacementMode === 'exit',
        addCheckpointHidden: this.roomGoal?.type !== 'checkpoint_sprint',
        addCheckpointActive: this.goalPlacementMode === 'checkpoint',
        placeFinishHidden: this.roomGoal?.type !== 'checkpoint_sprint',
        placeFinishActive: this.goalPlacementMode === 'finish',
      },
    });
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
    const wakeData = await this.roomSession.buildReturnToWorldWakeData();
    if (!wakeData) {
      return;
    }

    this.scene.stop();
    this.scene.wake('OverworldPlayScene', wakeData);
  }

  async mintRoom(): Promise<RoomRecord | null> {
    return this.roomSession.mintRoom();
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
      isPlaying: editorState.isPlaying,
    };
  }
}
