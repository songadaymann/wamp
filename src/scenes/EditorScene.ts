import Phaser from 'phaser';
import {
  TILE_SIZE,
  ROOM_WIDTH,
  ROOM_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_PX_HEIGHT,
  LAYER_NAMES,
  TILESETS,
  getBackgroundGroup,
  editorState,
  getSelectionGid,
  getObjectById,
  type BackgroundLayer,
  type LayerName,
  type PlacedObject,
} from '../config';
import {
  DEFAULT_ROOM_COORDINATES,
  DEFAULT_ROOM_ID,
  cloneRoomSnapshot,
  createDefaultRoomPermissions,
  createRoomRepository,
  isRoomSnapshotBlank,
  roomIdFromCoordinates,
  type RoomPermissions,
  type RoomRecord,
  type RoomSnapshot,
  type RoomTileData,
  type RoomVersionRecord,
} from '../persistence/roomRepository';
import { createWorldRepository } from '../persistence/worldRepository';
import {
  RETRO_COLORS,
  ensureStarfieldTexture,
} from '../visuals/starfield';
import { buildRoomSnapshotTexture, buildRoomTextureKey } from '../visuals/roomSnapshotTexture';
import { setAppMode } from '../ui/appMode';
import type { EditorSceneData, OverworldPlaySceneData } from './sceneData';

// ── Undo/Redo ──
interface TileAction {
  layer: LayerName;
  x: number;
  y: number;
  oldGid: number;
  newGid: number;
}

interface ObjectAction {
  type: 'add' | 'remove';
  object: PlacedObject;
  index: number;
}

type UndoAction = { kind: 'tiles'; actions: TileAction[] } | { kind: 'object'; action: ObjectAction };

interface ParallaxSprite {
  sprite: Phaser.GameObjects.TileSprite;
  layer: BackgroundLayer;
}

const EDITOR_NEIGHBOR_RADIUS = 1;

export class EditorScene extends Phaser.Scene {
  // Tilemap
  private map!: Phaser.Tilemaps.Tilemap;
  private tilesets: Map<string, Phaser.Tilemaps.Tileset> = new Map();
  private layers: Map<string, Phaser.Tilemaps.TilemapLayer> = new Map();

  // Active-room background art is rendered in world space so it stays inside the room bounds.
  private bgSprites: ParallaxSprite[] = [];
  private fallbackBgSprites: Phaser.GameObjects.TileSprite[] = [];
  private bgColorRect: Phaser.GameObjects.Rectangle | null = null;
  private bgCamera: Phaser.Cameras.Scene2D.Camera | null = null;
  private surroundingRoomImages: Phaser.GameObjects.Image[] = [];
  private surroundingRoomBorders: Phaser.GameObjects.Graphics | null = null;
  private surroundingRoomTextureKeys = new Set<string>();

  // Placed objects (visual representations in editor)
  private objectSprites: Phaser.GameObjects.Sprite[] = [];

  // Graphics overlays
  private gridGraphics!: Phaser.GameObjects.Graphics;
  private cursorGraphics!: Phaser.GameObjects.Graphics;
  private rectPreviewGraphics!: Phaser.GameObjects.Graphics;
  private borderGraphics!: Phaser.GameObjects.Graphics;

  // Interaction state
  private isPanning = false;
  private panStartPointer = { x: 0, y: 0 };
  private panStartScroll = { x: 0, y: 0 };
  private isDrawing = false;
  private spaceDown = false;
  private rectStart: { x: number; y: number } | null = null;

  // Undo system
  private undoStack: UndoAction[] = [];
  private redoStack: UndoAction[] = [];
  private currentBatch: TileAction[] = [];

  // Single-room persistence (local-first, ready for a remote adapter later)
  private readonly AUTO_SAVE_DELAY_MS = 600;
  private roomRepository = createRoomRepository();
  private readonly worldRepository = createWorldRepository();
  private roomId = DEFAULT_ROOM_ID;
  private roomCoordinates = DEFAULT_ROOM_COORDINATES;
  private roomVersion = 1;
  private publishedVersion = 0;
  private roomCreatedAt = '';
  private roomUpdatedAt = '';
  private roomPublishedAt: string | null = null;
  private roomPermissions: RoomPermissions = createDefaultRoomPermissions();
  private roomVersionHistory: RoomVersionRecord[] = [];
  private claimerDisplayName: string | null = null;
  private claimerUserId: string | null = null;
  private claimedAt: string | null = null;
  private lastPublishedByDisplayName: string | null = null;
  private surroundingPreviewToken = 0;
  private roomDirty = false;
  private lastDirtyAt = 0;
  private saveInFlight = false;
  private entrySource: 'world' | 'direct' = 'direct';
  private initialRoomSnapshot: RoomSnapshot | null = null;
  private readonly handleWake = (): void => {
    setAppMode('editor');
    editorState.isPlaying = false;
    this.updateBottomBar();
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
  private readonly handleShutdown = (): void => {
    window.removeEventListener('background-changed', this.handleBackgroundChanged);
    this.events.off('wake', this.handleWake, this);
    this.scale.off('resize', this.handleResize, this);
    this.input.removeAllListeners();
    this.input.keyboard?.removeAllListeners();
    this.game.canvas.removeEventListener('contextmenu', this.handleCanvasContextMenu);
    this.resetRuntimeState();
  };

  constructor() {
    super({ key: 'EditorScene' });
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
    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);

    if (this.initialRoomSnapshot) {
      this.applyRoomSnapshot(this.getEditableSnapshotFromSource(this.initialRoomSnapshot));
      this.updatePersistenceStatus('Loading room...');
    }

    void this.loadPersistedRoom();
    this.updateBottomBar();
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
    this.updateBackground();
  }

  private resetRuntimeState(): void {
    if (this.bgCamera && this.cameras.cameras.includes(this.bgCamera)) {
      this.cameras.remove(this.bgCamera, true);
    }

    this.surroundingPreviewToken++;
    this.clearSurroundingRoomPreviews();
    this.tilesets = new Map();
    this.layers = new Map();
    this.bgSprites = [];
    this.fallbackBgSprites = [];
    this.bgColorRect = null;
    this.bgCamera = null;
    this.objectSprites = [];
    this.roomPermissions = createDefaultRoomPermissions();
    this.roomVersionHistory = [];
    this.claimerDisplayName = null;
    this.claimerUserId = null;
    this.claimedAt = null;
    this.lastPublishedByDisplayName = null;
    editorState.isPlaying = false;
  }

  updateBackground(): void {
    // Remove old background layers and color rect
    for (const bg of this.bgSprites) bg.sprite.destroy();
    this.bgSprites = [];
    for (const sprite of this.fallbackBgSprites) sprite.destroy();
    this.fallbackBgSprites = [];
    if (this.bgColorRect) {
      this.bgColorRect.destroy();
      this.bgColorRect = null;
    }

    const w = ROOM_PX_WIDTH;
    const h = ROOM_PX_HEIGHT;
    const group = getBackgroundGroup(editorState.selectedBackground);

    if (!group || group.layers.length === 0) {
      const textureKey = ensureStarfieldTexture(this);

      this.bgColorRect = this.add.rectangle(0, 0, w, h, RETRO_COLORS.backgroundNumber);
      this.bgColorRect.setOrigin(0, 0);
      this.bgColorRect.setDepth(-20);

      const farLayer = this.add.tileSprite(0, 0, w, h, textureKey);
      farLayer.setOrigin(0, 0);
      farLayer.setDepth(-10);
      farLayer.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);

      const nearLayer = this.add.tileSprite(0, 0, w, h, textureKey);
      nearLayer.setOrigin(0, 0);
      nearLayer.setDepth(-9);
      nearLayer.setAlpha(0.28);
      nearLayer.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);

      this.fallbackBgSprites = [farLayer, nearLayer];
      this.syncBackgroundCameraIgnores();
      this.updateBackgroundPreview();
      return;
    }

    // Solid background color behind all layers (for transparent layer assets)
    if (group.bgColor) {
      const color = Phaser.Display.Color.HexStringToColor(group.bgColor).color;
      this.bgColorRect = this.add.rectangle(0, 0, w, h, color);
      this.bgColorRect.setOrigin(0, 0);
      this.bgColorRect.setDepth(-20);
    }

    // Keep the layered background effect, but constrain it to the active room bounds.
    for (let i = 0; i < group.layers.length; i++) {
      const layer = group.layers[i];
      const sprite = this.add.tileSprite(0, 0, w, h, layer.key);
      sprite.setOrigin(0, 0);
      sprite.setDepth(-10 + i);
      // Force nearest-neighbor sampling for crisp pixel art
      sprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);

      this.bgSprites.push({ sprite, layer });
    }

    this.syncBackgroundCameraIgnores();
    this.updateBackgroundPreview();
  }

  private syncBackgroundCameraIgnores(): void {
    const mainCam = this.cameras.main;
    if (!this.bgCamera) {
      mainCam.transparent = false;
      return;
    }

    mainCam.transparent = true;

    for (const layerName of LAYER_NAMES) {
      const tilemapLayer = this.map?.getLayer(layerName);
      if (tilemapLayer?.tilemapLayer) {
        this.bgCamera.ignore(tilemapLayer.tilemapLayer);
      }
    }

    for (const sprite of this.objectSprites) {
      this.bgCamera.ignore(sprite);
    }

    const overlays = [
      this.gridGraphics,
      this.cursorGraphics,
      this.rectPreviewGraphics,
      this.borderGraphics,
    ];

    for (const overlay of overlays) {
      if (overlay) {
        this.bgCamera.ignore(overlay);
      }
    }
  }

  private updateBackgroundPreview(): void {
    const cam = this.cameras.main;
    const w = ROOM_PX_WIDTH;
    const h = ROOM_PX_HEIGHT;

    if (this.bgColorRect) {
      this.bgColorRect.setPosition(0, 0);
      this.bgColorRect.setSize(w, h);
    }

    for (const bg of this.bgSprites) {
      bg.sprite.setPosition(0, 0);
      bg.sprite.setSize(w, h);

      const scale = h / bg.layer.height;
      bg.sprite.setTileScale(scale, scale);
      bg.sprite.tilePositionX = (cam.scrollX * bg.layer.scrollFactor) / scale;
      bg.sprite.tilePositionY = 0;
    }

    const fallbackConfigs = [
      { parallax: 0.035, tileScale: 1 },
      { parallax: 0.12, tileScale: 0.58 },
    ];
    for (let index = 0; index < this.fallbackBgSprites.length; index++) {
      const sprite = this.fallbackBgSprites[index];
      const config = fallbackConfigs[Math.min(index, fallbackConfigs.length - 1)];
      sprite.setPosition(0, 0);
      sprite.setSize(w, h);
      sprite.setTileScale(config.tileScale, config.tileScale);
      sprite.tilePositionX = (cam.scrollX * config.parallax) / config.tileScale;
      sprite.tilePositionY = (cam.scrollY * config.parallax) / config.tileScale;
    }
  }

  private clearSurroundingRoomPreviews(): void {
    for (const image of this.surroundingRoomImages) {
      image.destroy();
    }
    this.surroundingRoomImages = [];

    if (this.surroundingRoomBorders) {
      this.surroundingRoomBorders.destroy();
      this.surroundingRoomBorders = null;
    }

    for (const textureKey of this.surroundingRoomTextureKeys) {
      if (this.textures.exists(textureKey)) {
        this.textures.remove(textureKey);
      }
    }
    this.surroundingRoomTextureKeys.clear();
  }

  private async refreshSurroundingRoomPreviews(): Promise<void> {
    const token = ++this.surroundingPreviewToken;

    try {
      const worldWindow = await this.worldRepository.loadWorldWindow(
        this.roomCoordinates,
        EDITOR_NEIGHBOR_RADIUS,
      );

      const publishedNeighbors = worldWindow.rooms.filter((room) =>
        room.id !== this.roomId && room.state === 'published',
      );

      const loadedNeighbors = await Promise.all(
        publishedNeighbors.map(async (room) => {
          const snapshot = await this.worldRepository.loadPublishedRoom(room.id, room.coordinates);
          return snapshot ? { room, snapshot } : null;
        }),
      );

      if (token !== this.surroundingPreviewToken || !this.scene.isActive(this.scene.key)) {
        return;
      }

      this.clearSurroundingRoomPreviews();
      this.surroundingRoomBorders = this.add.graphics();
      this.surroundingRoomBorders.setDepth(0);
      this.surroundingRoomBorders.lineStyle(2, RETRO_COLORS.published, 0.24);

      for (const loadedNeighbor of loadedNeighbors) {
        if (!loadedNeighbor) continue;

        const { room, snapshot } = loadedNeighbor;
        const textureKey = buildRoomTextureKey(snapshot, 'editor-preview', TILE_SIZE);
        if (!this.textures.exists(textureKey)) {
          buildRoomSnapshotTexture(this, snapshot, textureKey, TILE_SIZE);
        }

        this.surroundingRoomTextureKeys.add(textureKey);

        const offsetX = (room.coordinates.x - this.roomCoordinates.x) * ROOM_PX_WIDTH;
        const offsetY = (room.coordinates.y - this.roomCoordinates.y) * ROOM_PX_HEIGHT;
        const image = this.add.image(
          offsetX + ROOM_PX_WIDTH / 2,
          offsetY + ROOM_PX_HEIGHT / 2,
          textureKey,
        );
        image.setDepth(-2);
        image.setAlpha(0.92);
        this.surroundingRoomImages.push(image);

        this.surroundingRoomBorders.strokeRect(offsetX, offsetY, ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
      }
    } catch (error) {
      if (token !== this.surroundingPreviewToken) {
        return;
      }

      console.error('Failed to load surrounding room previews', error);
      this.clearSurroundingRoomPreviews();
    }
  }

  // ══════════════════════════════════════
  // ROOM PERSISTENCE
  // ══════════════════════════════════════

  private async loadPersistedRoom(): Promise<void> {
    this.updatePersistenceStatus('Loading draft...');

    try {
      const record = await this.roomRepository.loadRoom(this.roomId, this.roomCoordinates);
      this.syncRoomMetadata(record);
      this.applyRoomSnapshot(this.resolveRoomSnapshotForEditing(record));
      void this.refreshSurroundingRoomPreviews();

      this.updatePersistenceStatus(this.getIdleStatusText());
      this.updateBottomBar();
    } catch (error) {
      console.error('Failed to load room draft', error);
      this.updatePersistenceStatus('Failed to load draft.');
    }
  }

  private syncRoomMetadata(record: RoomRecord): void {
    this.roomId = record.draft.id;
    this.roomCoordinates = { ...record.draft.coordinates };
    this.roomVersion = record.draft.version;
    this.publishedVersion = record.published?.version ?? 0;
    this.roomCreatedAt = record.draft.createdAt;
    this.roomUpdatedAt = record.draft.updatedAt;
    this.roomPublishedAt = record.published?.publishedAt ?? null;
    this.roomPermissions = { ...record.permissions };
    this.roomVersionHistory = record.versions.map((version) => ({
      ...version,
      snapshot: cloneRoomSnapshot(version.snapshot),
    }));
    this.claimerDisplayName = record.claimerDisplayName;
    this.claimerUserId = record.claimerUserId;
    this.claimedAt = record.claimedAt;
    this.lastPublishedByDisplayName = record.lastPublishedByDisplayName;
    this.updateRoomCoordsUi();
  }

  private getIdleStatusText(): string {
    if (!this.roomPermissions.canPublish && this.publishedVersion > 0) {
      return 'Publish locked for minted room.';
    }

    if (this.claimerDisplayName) {
      return `Claimed by ${this.claimerDisplayName}.`;
    }

    if (this.publishedVersion > 0) {
      return `Editing published room v${this.publishedVersion}.`;
    }

    return 'Editing frontier draft.';
  }

  private resolveRoomSnapshotForEditing(record: RoomRecord): RoomSnapshot {
    if (this.initialRoomSnapshot && this.shouldPreferInitialRoomSnapshot(record)) {
      return this.getEditableSnapshotFromSource(this.initialRoomSnapshot);
    }

    if (record.published && this.shouldPreferPublishedSnapshot(record)) {
      return this.getEditableSnapshotFromSource(record.published);
    }

    return cloneRoomSnapshot(record.draft);
  }

  private shouldPreferInitialRoomSnapshot(record: RoomRecord): boolean {
    return isRoomSnapshotBlank(record.draft) && !isRoomSnapshotBlank(this.initialRoomSnapshot!);
  }

  private shouldPreferPublishedSnapshot(record: RoomRecord): boolean {
    return isRoomSnapshotBlank(record.draft) && !isRoomSnapshotBlank(record.published!);
  }

  private getEditableSnapshotFromSource(source: RoomSnapshot): RoomSnapshot {
    const snapshot = cloneRoomSnapshot(source);
    snapshot.status = 'draft';
    snapshot.version = this.roomVersion;
    snapshot.createdAt = this.roomCreatedAt || snapshot.createdAt;
    snapshot.updatedAt = this.roomUpdatedAt || snapshot.updatedAt;
    snapshot.publishedAt = this.roomPublishedAt ?? snapshot.publishedAt;
    return snapshot;
  }

  private applyRoomSnapshot(room: RoomSnapshot): void {
    const tileData = room.tileData;

    for (const layerName of LAYER_NAMES) {
      const layer = this.layers.get(layerName);
      if (!layer) continue;

      for (let y = 0; y < ROOM_HEIGHT; y++) {
        for (let x = 0; x < ROOM_WIDTH; x++) {
          const gid = tileData[layerName][y][x];

          if (gid > 0) {
            layer.putTileAt(gid, x, y);
          } else {
            layer.removeTileAt(x, y);
          }
        }
      }
    }

    editorState.selectedBackground = room.background;
    const backgroundSelect = document.getElementById('background-select') as HTMLSelectElement | null;
    if (backgroundSelect) {
      backgroundSelect.value = room.background;
    }
    this.updateBackground();

    editorState.placedObjects = room.placedObjects.map((placed) => ({ ...placed }));
    this.rebuildObjectSprites();

    this.undoStack = [];
    this.redoStack = [];
    this.currentBatch = [];
    this.roomDirty = false;
    this.lastDirtyAt = 0;
  }

  private exportRoomSnapshot(): RoomSnapshot {
    return {
      id: this.roomId,
      coordinates: { ...this.roomCoordinates },
      background: editorState.selectedBackground,
      tileData: this.serializeTileData(),
      placedObjects: editorState.placedObjects.map((placed) => ({ ...placed })),
      version: this.roomVersion,
      status: 'draft',
      createdAt: this.roomCreatedAt || new Date().toISOString(),
      updatedAt: this.roomUpdatedAt || new Date().toISOString(),
      publishedAt: this.roomPublishedAt,
    };
  }

  private serializeTileData(): RoomTileData {
    const tileData = {} as RoomTileData;

    for (const layerName of LAYER_NAMES) {
      const layer = this.layers.get(layerName);
      const data: (number | -1)[][] = [];

      for (let y = 0; y < ROOM_HEIGHT; y++) {
        const row: (number | -1)[] = [];

        for (let x = 0; x < ROOM_WIDTH; x++) {
          const tile = layer?.getTileAt(x, y);
          row.push(tile ? tile.index : -1);
        }

        data.push(row);
      }

      tileData[layerName] = data;
    }

    return tileData;
  }

  private maybeAutoSave(_time: number): void {
    if (!this.roomDirty || this.saveInFlight || editorState.isPlaying) return;
    if (performance.now() - this.lastDirtyAt < this.AUTO_SAVE_DELAY_MS) return;

    void this.saveDraft();
  }

  private markRoomDirty(): void {
    this.roomDirty = true;
    this.lastDirtyAt = performance.now();
    this.updatePersistenceStatus('Draft changes...');
  }

  private updateRoomCoordsUi(): void {
    const coordsEl = document.getElementById('room-coords');
    if (!coordsEl) return;

    coordsEl.textContent = `Room (${this.roomCoordinates.x}, ${this.roomCoordinates.y})`;
  }

  private updatePersistenceStatus(text: string): void {
    const statusEl = document.getElementById('room-save-status');
    if (!statusEl) return;

    statusEl.textContent = text;
  }

  async saveDraft(force: boolean = false): Promise<RoomRecord | null> {
    if (this.saveInFlight) return null;
    if (!force && !this.roomDirty) return null;

    const saveStartedAt = this.lastDirtyAt;
    this.saveInFlight = true;
    this.updatePersistenceStatus('Saving draft...');

    try {
      const record = await this.roomRepository.saveDraft(this.exportRoomSnapshot());
      this.syncRoomMetadata(record);

      if (this.lastDirtyAt === saveStartedAt) {
        this.roomDirty = false;
      }

      const publishSuffix = this.publishedVersion > 0 ? ` Published v${this.publishedVersion}.` : '';
      this.updatePersistenceStatus(`Draft saved v${this.roomVersion}.${publishSuffix}`);
      this.updateBottomBar();
      return record;
    } catch (error) {
      console.error('Failed to save room draft', error);
      this.updatePersistenceStatus('Draft save failed.');
    } finally {
      this.saveInFlight = false;
    }

    return null;
  }

  async publishRoom(successText?: string): Promise<RoomRecord | null> {
    if (this.saveInFlight) return null;

    this.saveInFlight = true;
    this.updatePersistenceStatus('Publishing...');

    try {
      const record = await this.roomRepository.publish(this.exportRoomSnapshot());
      this.syncRoomMetadata(record);
      this.roomDirty = false;
      this.updatePersistenceStatus(successText ?? `Published v${this.publishedVersion}.`);
      this.updateBottomBar();
      return record;
    } catch (error) {
      console.error('Failed to publish room', error);
      const message = error instanceof Error ? error.message : 'Publish failed.';
      this.updatePersistenceStatus(message);
    } finally {
      this.saveInFlight = false;
    }

    return null;
  }

  async revertToVersion(targetVersion: number): Promise<RoomRecord | null> {
    if (this.saveInFlight) return null;

    this.saveInFlight = true;
    this.updatePersistenceStatus(`Reverting to v${targetVersion}...`);

    try {
      const record = await this.roomRepository.revert(this.roomId, this.roomCoordinates, targetVersion);
      this.syncRoomMetadata(record);
      this.applyRoomSnapshot(this.resolveRoomSnapshotForEditing(record));
      this.updatePersistenceStatus(`Reverted to v${targetVersion}.`);
      this.updateBottomBar();
      return record;
    } catch (error) {
      console.error('Failed to revert room version', error);
      const message = error instanceof Error ? error.message : 'Revert failed.';
      this.updatePersistenceStatus(message);
    } finally {
      this.saveInFlight = false;
    }

    return null;
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
    this.cursorGraphics = this.add.graphics();
    this.cursorGraphics.setDepth(99);

    this.rectPreviewGraphics = this.add.graphics();
    this.rectPreviewGraphics.setDepth(98);
  }

  private updateCursorHighlight(): void {
    this.cursorGraphics.clear();

    if (editorState.isPlaying) return;

    const pointer = this.input.activePointer;
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tileX = Math.floor(worldPoint.x / TILE_SIZE);
    const tileY = Math.floor(worldPoint.y / TILE_SIZE);

    if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) return;

    // In object mode, show a single tile cursor
    if (editorState.paletteMode === 'objects') {
      const objConfig = editorState.selectedObjectId ? getObjectById(editorState.selectedObjectId) : null;
      if (objConfig && editorState.activeTool !== 'eraser') {
        // Show object-sized cursor snapped to grid
        const objW = objConfig.frameWidth;
        const objH = objConfig.frameHeight;
        this.cursorGraphics.fillStyle(RETRO_COLORS.draft, 0.14);
        this.cursorGraphics.fillRect(
          tileX * TILE_SIZE, tileY * TILE_SIZE + TILE_SIZE - objH,
          objW, objH
        );
        this.cursorGraphics.lineStyle(1, RETRO_COLORS.draft, 0.75);
        this.cursorGraphics.strokeRect(
          tileX * TILE_SIZE, tileY * TILE_SIZE + TILE_SIZE - objH,
          objW, objH
        );
      } else {
        // Eraser or no object selected - red cursor
        this.cursorGraphics.lineStyle(2, RETRO_COLORS.danger, 0.85);
        this.cursorGraphics.strokeRect(
          tileX * TILE_SIZE, tileY * TILE_SIZE,
          TILE_SIZE, TILE_SIZE
        );
      }

      // Update cursor coordinates
      const coordsEl = document.getElementById('cursor-coords');
      if (coordsEl) coordsEl.textContent = `Tile: ${tileX}, ${tileY}`;
      return;
    }

    // Tile mode cursor
    const sel = editorState.selection;
    const cursorW = (editorState.activeTool === 'pencil') ? sel.width : 1;
    const cursorH = (editorState.activeTool === 'pencil') ? sel.height : 1;

    if (editorState.activeTool === 'eraser') {
      this.cursorGraphics.lineStyle(2, RETRO_COLORS.danger, 0.85);
      this.cursorGraphics.strokeRect(
        tileX * TILE_SIZE, tileY * TILE_SIZE,
        TILE_SIZE, TILE_SIZE
      );
    } else {
      this.cursorGraphics.fillStyle(RETRO_COLORS.draft, 0.18);
      this.cursorGraphics.fillRect(
        tileX * TILE_SIZE, tileY * TILE_SIZE,
        cursorW * TILE_SIZE, cursorH * TILE_SIZE
      );
      this.cursorGraphics.lineStyle(1, RETRO_COLORS.draft, 0.8);
      this.cursorGraphics.strokeRect(
        tileX * TILE_SIZE, tileY * TILE_SIZE,
        cursorW * TILE_SIZE, cursorH * TILE_SIZE
      );
    }

    // Update cursor coordinates in bottom bar
    const coordsEl = document.getElementById('cursor-coords');
    if (coordsEl) {
      coordsEl.textContent = `Tile: ${tileX}, ${tileY}`;
    }
  }

  // ══════════════════════════════════════
  // CAMERA
  // ══════════════════════════════════════

  private setupCamera(): void {
    const cam = this.cameras.main;
    const margin = TILE_SIZE * 4;
    const previewSpanX = ROOM_PX_WIDTH * EDITOR_NEIGHBOR_RADIUS;
    const previewSpanY = ROOM_PX_HEIGHT * EDITOR_NEIGHBOR_RADIUS;
    cam.setBounds(
      -previewSpanX - margin,
      -previewSpanY - margin,
      ROOM_PX_WIDTH + previewSpanX * 2 + margin * 2,
      ROOM_PX_HEIGHT + previewSpanY * 2 + margin * 2,
    );
    cam.transparent = true;
    this.centerCameraOnRoom();
  }

  private centerCameraOnRoom(): void {
    const cam = this.cameras.main;
    cam.setZoom(editorState.zoom);
    cam.centerOn(ROOM_PX_WIDTH / 2, ROOM_PX_HEIGHT / 2);
    this.constrainEditorCamera();
  }

  private constrainEditorCamera(): void {
    const cam = this.cameras.main;
    const bounds = cam.getBounds();
    const minScrollX = bounds.x + (cam.displayWidth - cam.width) * 0.5;
    const maxScrollX = Math.max(minScrollX, minScrollX + bounds.width - cam.displayWidth);
    const minScrollY = bounds.y + (cam.displayHeight - cam.height) * 0.5;
    const maxScrollY = Math.max(minScrollY, minScrollY + bounds.height - cam.displayHeight);

    cam.scrollX =
      maxScrollX < minScrollX
        ? bounds.centerX - cam.width * cam.originX
        : Phaser.Math.Clamp(cam.scrollX, minScrollX, maxScrollX);
    cam.scrollY =
      maxScrollY < minScrollY
        ? bounds.centerY - cam.height * cam.originY
        : Phaser.Math.Clamp(cam.scrollY, minScrollY, maxScrollY);
  }

  private handleZoom(zoomFactor: number): void {
    const nextZoom = Phaser.Math.Clamp(editorState.zoom * zoomFactor, 0.25, 6);

    if (Math.abs(nextZoom - editorState.zoom) < 0.0001) {
      return;
    }

    editorState.zoom = Number(nextZoom.toFixed(2));
    this.centerCameraOnRoom();

    this.updateBackgroundPreview();
    this.updateZoomUI();
  }

  private updateZoomUI(): void {
    const zoomEl = document.getElementById('zoom-level');
    if (zoomEl) {
      zoomEl.textContent = `Zoom: ${editorState.zoom}x`;
    }
  }

  fitToScreen(): void {
    const viewW = this.scale.width;
    const viewH = this.scale.height;
    const padding = 32; // pixels of padding around the room

    const fitZoom = Math.min(
      (viewW - padding) / ROOM_PX_WIDTH,
      (viewH - padding) / ROOM_PX_HEIGHT
    );

    // Round to nearest 0.25
    editorState.zoom = Math.round(fitZoom * 4) / 4;
    editorState.zoom = Math.max(0.25, Math.min(6, editorState.zoom));

    this.centerCameraOnRoom();
    this.updateBackgroundPreview();
    this.updateZoomUI();
  }

  // ══════════════════════════════════════
  // INPUT
  // ══════════════════════════════════════

  private setupInput(): void {
    // Pointer down
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (editorState.isPlaying) return;

      // Middle mouse = pan
      if (pointer.middleButtonDown() || this.spaceDown) {
        this.isPanning = true;
        this.panStartPointer = { x: pointer.x, y: pointer.y };
        this.panStartScroll = {
          x: this.cameras.main.scrollX,
          y: this.cameras.main.scrollY,
        };
        return;
      }

      // Right click = always erase
      if (pointer.rightButtonDown()) {
        if (editorState.paletteMode === 'objects') {
          const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          this.removeObjectAt(worldPoint.x, worldPoint.y);
        } else {
          this.isDrawing = true;
          this.currentBatch = [];
          const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          this.eraseTileAt(worldPoint.x, worldPoint.y);
        }
        return;
      }

      // Left click = use active tool
      if (pointer.leftButtonDown()) {
        if (editorState.paletteMode === 'objects') {
          this.handleObjectPlace(pointer);
        } else {
          this.handleToolDown(pointer);
        }
      }
    });

    // Pointer move
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (editorState.isPlaying) return;

      if (this.isPanning) {
        const dx = (this.panStartPointer.x - pointer.x) / this.cameras.main.zoom;
        const dy = (this.panStartPointer.y - pointer.y) / this.cameras.main.zoom;
        this.cameras.main.scrollX = this.panStartScroll.x + dx;
        this.cameras.main.scrollY = this.panStartScroll.y + dy;
        this.constrainEditorCamera();
        this.updateBackgroundPreview();
        return;
      }

      if (editorState.paletteMode === 'tiles') {
        if (this.isDrawing && pointer.leftButtonDown()) {
          const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          if (editorState.activeTool === 'pencil') {
            this.placeTileAt(worldPoint.x, worldPoint.y);
          } else if (editorState.activeTool === 'eraser') {
            this.eraseTileAt(worldPoint.x, worldPoint.y);
          }
        }

        // Right-click drag erases
        if (this.isDrawing && pointer.rightButtonDown()) {
          const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          this.eraseTileAt(worldPoint.x, worldPoint.y);
        }

        // Rectangle preview
        if (editorState.activeTool === 'rect' && this.rectStart && pointer.leftButtonDown()) {
          const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          const endX = Math.floor(worldPoint.x / TILE_SIZE);
          const endY = Math.floor(worldPoint.y / TILE_SIZE);
          this.drawRectPreview(this.rectStart.x, this.rectStart.y, endX, endY);
        }
      }
    });

    // Pointer up
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (this.isPanning) {
        this.isPanning = false;
        return;
      }

      if (this.isDrawing) {
        // Finalize rectangle fill
        if (editorState.activeTool === 'rect' && this.rectStart && pointer.leftButtonReleased()) {
          const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          const endX = Math.floor(worldPoint.x / TILE_SIZE);
          const endY = Math.floor(worldPoint.y / TILE_SIZE);
          this.fillRect(this.rectStart.x, this.rectStart.y, endX, endY);
          this.rectStart = null;
          this.rectPreviewGraphics.clear();
        }

        // Commit undo batch
        if (this.currentBatch.length > 0) {
          this.undoStack.push({ kind: 'tiles', actions: [...this.currentBatch] });
          this.redoStack = [];
          this.currentBatch = [];
          this.markRoomDirty();
        }
        this.isDrawing = false;
      }
    });

    // Scroll wheel = zoom
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: unknown[], _deltaX: number, deltaY: number) => {
      if (editorState.isPlaying) return;
      const zoomFactor = Phaser.Math.Clamp(
        Math.exp(-deltaY * 0.00055),
        0.92,
        1.08
      );
      this.handleZoom(zoomFactor);
    });

    // Prevent context menu
    this.game.canvas.addEventListener('contextmenu', this.handleCanvasContextMenu);
  }

  private setupKeyboard(): void {
    const keyboard = this.input.keyboard!;

    // Tool shortcuts
    keyboard.on('keydown-B', () => { editorState.activeTool = 'pencil'; this.updateToolUI(); });
    keyboard.on('keydown-R', () => { editorState.activeTool = 'rect'; this.updateToolUI(); });
    keyboard.on('keydown-G', () => { editorState.activeTool = 'fill'; this.updateToolUI(); });
    keyboard.on('keydown-E', () => { editorState.activeTool = 'eraser'; this.updateToolUI(); });

    // F = fit to screen
    keyboard.on('keydown-F', () => { this.fitToScreen(); });

    // Space = pan mode
    keyboard.on('keydown-SPACE', () => { this.spaceDown = true; });
    keyboard.on('keyup-SPACE', () => { this.spaceDown = false; this.isPanning = false; });

    // Ctrl+Z = undo, Ctrl+Shift+Z = redo
    keyboard.on('keydown-Z', (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) {
        if (event.shiftKey) {
          this.redo();
        } else {
          this.undo();
        }
      }
    });

    // P = toggle play mode
    keyboard.on('keydown-P', () => {
      this.startPlayMode();
    });
  }

  // ══════════════════════════════════════
  // OBJECT PLACEMENT
  // ══════════════════════════════════════

  private handleObjectPlace(pointer: Phaser.Input.Pointer): void {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tileX = Math.floor(worldPoint.x / TILE_SIZE);
    const tileY = Math.floor(worldPoint.y / TILE_SIZE);

    if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) return;

    if (editorState.activeTool === 'eraser') {
      this.removeObjectAt(worldPoint.x, worldPoint.y);
      return;
    }

    if (!editorState.selectedObjectId) return;

    const objConfig = getObjectById(editorState.selectedObjectId);
    if (!objConfig) return;

    // Snap to tile grid, bottom-aligned
    const px = tileX * TILE_SIZE + objConfig.frameWidth / 2;
    const py = tileY * TILE_SIZE + TILE_SIZE - objConfig.frameHeight / 2;

    const placed: PlacedObject = {
      id: editorState.selectedObjectId,
      x: px,
      y: py,
    };

    editorState.placedObjects.push(placed);
    const index = editorState.placedObjects.length - 1;

    // Undo action
    this.undoStack.push({
      kind: 'object',
      action: { type: 'add', object: placed, index },
    });
    this.redoStack = [];

    this.rebuildObjectSprites();
    this.markRoomDirty();
  }

  private removeObjectAt(worldX: number, worldY: number): void {
    // Find nearest object within ~12px
    let bestIndex = -1;
    let bestDist = 12;

    for (let i = editorState.placedObjects.length - 1; i >= 0; i--) {
      const obj = editorState.placedObjects[i];
      const dist = Math.sqrt((obj.x - worldX) ** 2 + (obj.y - worldY) ** 2);
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0) {
      const removed = editorState.placedObjects.splice(bestIndex, 1)[0];
      this.undoStack.push({
        kind: 'object',
        action: { type: 'remove', object: removed, index: bestIndex },
      });
      this.redoStack = [];
      this.rebuildObjectSprites();
      this.markRoomDirty();
    }
  }

  rebuildObjectSprites(): void {
    // Destroy existing sprites
    for (const sprite of this.objectSprites) {
      sprite.destroy();
    }
    this.objectSprites = [];

    // Create sprites for each placed object
    for (const placed of editorState.placedObjects) {
      const objConfig = getObjectById(placed.id);
      if (!objConfig) continue;

      const sprite = this.add.sprite(placed.x, placed.y, objConfig.id, 0);
      sprite.setDepth(25); // between terrain and foreground
      sprite.setOrigin(0.5, 0.5);

      // Play animation if available
      if (objConfig.frameCount > 1 && objConfig.fps > 0) {
        const animKey = `${objConfig.id}_anim`;
        if (this.anims.exists(animKey)) {
          sprite.play(animKey);
        }
      }

      this.objectSprites.push(sprite);
    }

    this.syncBackgroundCameraIgnores();
  }

  // ══════════════════════════════════════
  // TOOL HANDLERS
  // ══════════════════════════════════════

  private handleToolDown(pointer: Phaser.Input.Pointer): void {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tileX = Math.floor(worldPoint.x / TILE_SIZE);
    const tileY = Math.floor(worldPoint.y / TILE_SIZE);

    if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) return;

    this.isDrawing = true;
    this.currentBatch = [];

    switch (editorState.activeTool) {
      case 'pencil':
        this.placeTileAt(worldPoint.x, worldPoint.y);
        break;
      case 'eraser':
        this.eraseTileAt(worldPoint.x, worldPoint.y);
        break;
      case 'rect':
        this.rectStart = { x: tileX, y: tileY };
        break;
      case 'fill':
        this.floodFill(tileX, tileY);
        // Commit immediately
        if (this.currentBatch.length > 0) {
          this.undoStack.push({ kind: 'tiles', actions: [...this.currentBatch] });
          this.redoStack = [];
          this.currentBatch = [];
          this.markRoomDirty();
        }
        this.isDrawing = false;
        break;
    }
  }

  // ── Pencil (supports multi-tile selection) ──

  private placeTileAt(worldX: number, worldY: number): void {
    const baseTileX = Math.floor(worldX / TILE_SIZE);
    const baseTileY = Math.floor(worldY / TILE_SIZE);

    const layer = this.layers.get(editorState.activeLayer);
    if (!layer) return;

    const sel = editorState.selection;

    for (let dy = 0; dy < sel.height; dy++) {
      for (let dx = 0; dx < sel.width; dx++) {
        const tileX = baseTileX + dx;
        const tileY = baseTileY + dy;

        if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) continue;

        const newGid = getSelectionGid(dx, dy);
        if (newGid < 0) continue;
        const existingTile = layer.getTileAt(tileX, tileY);
        const oldGid = existingTile ? existingTile.index : -1;

        if (oldGid === newGid) continue;

        layer.putTileAt(newGid, tileX, tileY);

        this.currentBatch.push({
          layer: editorState.activeLayer,
          x: tileX,
          y: tileY,
          oldGid,
          newGid,
        });
      }
    }
  }

  // ── Eraser ──

  private eraseTileAt(worldX: number, worldY: number): void {
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);

    if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) return;

    const layer = this.layers.get(editorState.activeLayer);
    if (!layer) return;

    const existingTile = layer.getTileAt(tileX, tileY);
    if (!existingTile) return;  // Already empty

    const oldGid = existingTile.index;
    layer.removeTileAt(tileX, tileY);

    this.currentBatch.push({
      layer: editorState.activeLayer,
      x: tileX,
      y: tileY,
      oldGid,
      newGid: -1,
    });
  }

  // ── Rectangle Fill ──

  private drawRectPreview(x1: number, y1: number, x2: number, y2: number): void {
    this.rectPreviewGraphics.clear();

    const minX = Math.min(x1, x2);
    const minY = Math.min(y1, y2);
    const maxX = Math.max(x1, x2);
    const maxY = Math.max(y1, y2);

    this.rectPreviewGraphics.fillStyle(RETRO_COLORS.draft, 0.15);
    this.rectPreviewGraphics.fillRect(
      minX * TILE_SIZE, minY * TILE_SIZE,
      (maxX - minX + 1) * TILE_SIZE, (maxY - minY + 1) * TILE_SIZE
    );
    this.rectPreviewGraphics.lineStyle(1, RETRO_COLORS.draft, 0.65);
    this.rectPreviewGraphics.strokeRect(
      minX * TILE_SIZE, minY * TILE_SIZE,
      (maxX - minX + 1) * TILE_SIZE, (maxY - minY + 1) * TILE_SIZE
    );
  }

  private fillRect(x1: number, y1: number, x2: number, y2: number): void {
    const minX = Math.max(0, Math.min(x1, x2));
    const minY = Math.max(0, Math.min(y1, y2));
    const maxX = Math.min(ROOM_WIDTH - 1, Math.max(x1, x2));
    const maxY = Math.min(ROOM_HEIGHT - 1, Math.max(y1, y2));

    const layer = this.layers.get(editorState.activeLayer);
    if (!layer) return;
    if (editorState.selectedTileGid < 0) return;

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const existingTile = layer.getTileAt(x, y);
        const oldGid = existingTile ? existingTile.index : -1;
        const newGid = editorState.selectedTileGid;

        if (oldGid !== newGid) {
          layer.putTileAt(newGid, x, y);
          this.currentBatch.push({
            layer: editorState.activeLayer,
            x, y, oldGid, newGid,
          });
        }
      }
    }
  }

  // ── Flood Fill ──

  private floodFill(startX: number, startY: number): void {
    const layer = this.layers.get(editorState.activeLayer);
    if (!layer) return;
    if (editorState.selectedTileGid < 0) return;

    const targetTile = layer.getTileAt(startX, startY);
    const targetGid = targetTile ? targetTile.index : -1;
    const fillGid = editorState.selectedTileGid;

    if (targetGid === fillGid) return;  // Already this tile

    const visited = new Set<string>();
    const queue: [number, number][] = [[startX, startY]];

    while (queue.length > 0) {
      const [x, y] = queue.shift()!;
      const key = `${x},${y}`;

      if (visited.has(key)) continue;
      if (x < 0 || x >= ROOM_WIDTH || y < 0 || y >= ROOM_HEIGHT) continue;

      const tile = layer.getTileAt(x, y);
      const currentGid = tile ? tile.index : -1;

      if (currentGid !== targetGid) continue;

      visited.add(key);
      layer.putTileAt(fillGid, x, y);

      this.currentBatch.push({
        layer: editorState.activeLayer,
        x, y,
        oldGid: targetGid,
        newGid: fillGid,
      });

      queue.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
    }
  }

  // ══════════════════════════════════════
  // UNDO / REDO
  // ══════════════════════════════════════

  private undo(): void {
    const action = this.undoStack.pop();
    if (!action) return;

    if (action.kind === 'tiles') {
      const reverseActions: TileAction[] = [];
      for (const a of action.actions) {
        const layer = this.layers.get(a.layer);
        if (!layer) continue;

        if (a.oldGid === -1) {
          layer.removeTileAt(a.x, a.y);
        } else {
          layer.putTileAt(a.oldGid, a.x, a.y);
        }

        reverseActions.push({
          ...a,
          oldGid: a.newGid,
          newGid: a.oldGid,
        });
      }
      this.redoStack.push({ kind: 'tiles', actions: reverseActions });
      this.markRoomDirty();
    } else if (action.kind === 'object') {
      const objAction = action.action;
      if (objAction.type === 'add') {
        // Undo add = remove
        editorState.placedObjects.splice(objAction.index, 1);
        this.redoStack.push({
          kind: 'object',
          action: { type: 'remove', object: objAction.object, index: objAction.index },
        });
      } else {
        // Undo remove = add back
        editorState.placedObjects.splice(objAction.index, 0, objAction.object);
        this.redoStack.push({
          kind: 'object',
          action: { type: 'add', object: objAction.object, index: objAction.index },
        });
      }
      this.rebuildObjectSprites();
      this.markRoomDirty();
    }
  }

  private redo(): void {
    const action = this.redoStack.pop();
    if (!action) return;

    if (action.kind === 'tiles') {
      const reverseActions: TileAction[] = [];
      for (const a of action.actions) {
        const layer = this.layers.get(a.layer);
        if (!layer) continue;

        if (a.newGid === -1) {
          layer.removeTileAt(a.x, a.y);
        } else {
          layer.putTileAt(a.newGid, a.x, a.y);
        }

        reverseActions.push({
          ...a,
          oldGid: a.newGid,
          newGid: a.oldGid,
        });
      }
      this.undoStack.push({ kind: 'tiles', actions: reverseActions });
      this.markRoomDirty();
    } else if (action.kind === 'object') {
      const objAction = action.action;
      if (objAction.type === 'add') {
        editorState.placedObjects.splice(objAction.index, 1);
        this.undoStack.push({
          kind: 'object',
          action: { type: 'remove', object: objAction.object, index: objAction.index },
        });
      } else {
        editorState.placedObjects.splice(objAction.index, 0, objAction.object);
        this.undoStack.push({
          kind: 'object',
          action: { type: 'add', object: objAction.object, index: objAction.index },
        });
      }
      this.rebuildObjectSprites();
      this.markRoomDirty();
    }
  }

  // ══════════════════════════════════════
  // PLAY MODE
  // ══════════════════════════════════════

  startPlayMode(): void {
    void this.saveDraft(true);
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
    const backToWorldBtn = document.getElementById('btn-back-to-world') as HTMLButtonElement | null;
    const playBtn = document.getElementById('btn-test-play') as HTMLButtonElement | null;
    const saveBtn = document.getElementById('btn-save-draft') as HTMLButtonElement | null;
    const publishBtn = document.getElementById('btn-publish-room') as HTMLButtonElement | null;
    const historyBtn = document.getElementById('btn-room-history') as HTMLButtonElement | null;
    const fitBtn = document.getElementById('btn-fit-screen') as HTMLButtonElement | null;
    const saveStatusEl = document.getElementById('room-save-status');
    const coordsEl = document.getElementById('room-coords');

    if (coordsEl) {
      coordsEl.textContent = `Room (${this.roomCoordinates.x}, ${this.roomCoordinates.y})`;
    }

    if (playBtn) playBtn.classList.toggle('hidden', false);
    if (backToWorldBtn) {
      backToWorldBtn.classList.toggle('hidden', this.entrySource !== 'world');
    }
    if (saveBtn) saveBtn.classList.toggle('hidden', false);
    if (publishBtn) publishBtn.classList.toggle('hidden', false);
    if (publishBtn) publishBtn.disabled = !this.roomPermissions.canPublish;
    if (historyBtn) {
      historyBtn.classList.toggle('hidden', false);
      historyBtn.disabled = this.roomVersionHistory.length === 0;
    }
    if (fitBtn) fitBtn.classList.toggle('hidden', false);
    if (saveStatusEl && this.entrySource === 'world' && !this.roomDirty) {
      saveStatusEl.textContent = this.getIdleStatusText();
    }
  }

  // ── Public API for UI ──

  getMap(): Phaser.Tilemaps.Tilemap {
    return this.map;
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
    versions: RoomVersionRecord[];
  } {
    return {
      roomId: this.roomId,
      claimerDisplayName: this.claimerDisplayName,
      claimedAt: this.claimedAt,
      canRevert: this.roomPermissions.canRevert,
      canPublish: this.roomPermissions.canPublish,
      versions: this.roomVersionHistory.map((version) => ({
        ...version,
        snapshot: cloneRoomSnapshot(version.snapshot),
      })),
    };
  }

  private shouldShowDraftPreviewInWorld(): boolean {
    return this.roomPublishedAt === null || this.roomUpdatedAt !== this.roomPublishedAt;
  }

  async returnToWorld(): Promise<void> {
    let wakeData: OverworldPlaySceneData;

    if (!this.roomDirty) {
      wakeData = {
        centerCoordinates: { ...this.roomCoordinates },
        roomCoordinates: { ...this.roomCoordinates },
        draftRoom: this.shouldShowDraftPreviewInWorld() ? this.exportRoomSnapshot() : null,
        clearDraftRoomId: this.shouldShowDraftPreviewInWorld() ? null : this.roomId,
        mode: 'browse',
      };
    } else {
      const publishedRecord = await this.publishRoom('Auto-published on exit.');
      if (publishedRecord) {
        wakeData = {
          centerCoordinates: { ...this.roomCoordinates },
          roomCoordinates: { ...this.roomCoordinates },
          statusMessage: 'Auto-published on exit.',
          draftRoom: null,
          clearDraftRoomId: this.roomId,
          mode: 'browse',
        };
      } else {
        const draftRecord = await this.saveDraft(true);
        if (!draftRecord) {
          this.updatePersistenceStatus('Publish failed. Draft save failed.');
          return;
        }

        this.updatePersistenceStatus('Publish failed, draft saved instead.');
        wakeData = {
          centerCoordinates: { ...this.roomCoordinates },
          roomCoordinates: { ...this.roomCoordinates },
          statusMessage: 'Publish failed, draft saved instead.',
          draftRoom: this.exportRoomSnapshot(),
          clearDraftRoomId: null,
          mode: 'browse',
        };
      }
    }

    this.scene.stop();
    this.scene.wake('OverworldPlayScene', wakeData);
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
      canPublish: this.roomPermissions.canPublish,
      canRevert: this.roomPermissions.canRevert,
      background: editorState.selectedBackground,
      backgroundLayerCount: this.bgSprites.length,
      hasBackgroundCamera: !!this.bgCamera,
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
