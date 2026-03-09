import Phaser from 'phaser';
import {
  getObjectById,
  type GameObjectConfig,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILESETS,
  TILE_SIZE,
} from '../config';
import { getFocusedCoordinatesFromUrl, setFocusedCoordinatesInUrl } from '../navigation/worldNavigation';
import {
  cloneRoomSnapshot,
  DEFAULT_ROOM_COORDINATES,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../persistence/roomModel';
import { createWorldRepository } from '../persistence/worldRepository';
import {
  getOrthogonalNeighbors,
  isWithinWorldWindow,
  type WorldRoomSummary,
  type WorldWindow,
} from '../persistence/worldModel';
import {
  RETRO_COLORS,
  ensureStarfieldTexture,
} from '../visuals/starfield';
import { buildRoomSnapshotTexture, buildRoomTextureKey } from '../visuals/roomSnapshotTexture';
import { setAppMode } from '../ui/appMode';
import type { EditorSceneData, OverworldMode, OverworldPlaySceneData } from './sceneData';

const WINDOW_RADIUS = 8;
const STREAM_RADIUS = 1;
const PREVIEW_TILE_SIZE = 4;
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 2.5;
const DEFAULT_ZOOM = 0.18;
const BUTTON_ZOOM_FACTOR = 1.12;
const WHEEL_ZOOM_SENSITIVITY = 0.003;
const PAN_THRESHOLD = 4;
const EDGE_WALL_THICKNESS = 12;
const RESPAWN_FALL_DISTANCE = ROOM_PX_HEIGHT * 2;

type CameraMode = 'inspect' | 'follow';
type SelectedCellState = 'published' | 'draft' | 'frontier' | 'empty';

interface PlayerSpawn {
  x: number;
  y: number;
}

interface RoomEdgeWall {
  rect: Phaser.GameObjects.Rectangle;
  collider: Phaser.Physics.Arcade.Collider;
}

interface LoadedFullRoom {
  room: RoomSnapshot;
  image: Phaser.GameObjects.Image;
  textureKey: string;
  map: Phaser.Tilemaps.Tilemap;
  terrainLayer: Phaser.Tilemaps.TilemapLayer;
  terrainCollider: Phaser.Physics.Arcade.Collider | null;
  edgeWalls: RoomEdgeWall[];
  liveObjects: LoadedRoomObject[];
}

type ArcadeObjectBody = Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody;

interface LoadedRoomObjectRuntimeState {
  baseX: number;
  baseY: number;
  initialDirectionX: number;
  directionX: number;
  elapsedMs: number;
  nextActionAt: number;
  cooldownUntil: number;
  activatedUntil: number;
}

interface LoadedRoomObject {
  key: string;
  config: GameObjectConfig;
  sprite: Phaser.GameObjects.Sprite;
  interactions: Phaser.Physics.Arcade.Collider[];
  worldColliders: Phaser.Physics.Arcade.Collider[];
  runtime: LoadedRoomObjectRuntimeState;
}

interface RenderableRoom {
  id: string;
  coordinates: RoomCoordinates;
  room: RoomSnapshot;
}

interface ZoomDebugState {
  source: 'canvas-wheel';
  rawClient: { x: number; y: number };
  screen: { x: number; y: number };
  phaserPointer: { x: number; y: number };
  deltaY: number;
  anchorWorldBefore: { x: number; y: number };
  anchorWorldAfter: { x: number; y: number };
  zoom: { before: number; after: number };
  scroll: {
    beforeX: number;
    beforeY: number;
    afterX: number;
    afterY: number;
  };
  mode: OverworldMode;
  cameraMode: CameraMode;
  selected: RoomCoordinates;
  currentRoom: RoomCoordinates;
}

export class OverworldPlayScene extends Phaser.Scene {
  private readonly worldRepository = createWorldRepository();

  private readonly PLAYER_SPEED = 150;
  private readonly JUMP_VELOCITY = -280;
  private readonly GRAVITY = 700;
  private readonly PLAYER_WIDTH = 10;
  private readonly PLAYER_HEIGHT = 14;
  private readonly COYOTE_MS = 80;
  private readonly JUMP_BUFFER_MS = 100;
  private readonly LADDER_CLIMB_SPEED = 90;
  private readonly BOUNCE_PAD_VELOCITY = -392;
  private readonly BOUNCE_PAD_COOLDOWN_MS = 220;
  private readonly BOUNCE_PAD_ACTIVE_MS = 140;
  private readonly BIRD_SPEED = 80;
  private readonly BIRD_WAVE_AMPLITUDE = 10;
  private readonly BIRD_WAVE_SPEED = 0.008;
  private readonly SNAKE_SPEED = 42;
  private readonly PENGUIN_SPEED = 54;
  private readonly FROG_HOP_SPEED = 68;
  private readonly FROG_HOP_VELOCITY = -236;
  private readonly FROG_HOP_DELAY_MS = 720;

  private player: Phaser.GameObjects.Rectangle | null = null;
  private playerBody: Phaser.Physics.Arcade.Body | null = null;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private modifierKeys!: {
    ALT: Phaser.Input.Keyboard.Key;
    SPACE: Phaser.Input.Keyboard.Key;
  };

  private loadingText!: Phaser.GameObjects.Text;
  private roomGridGraphics!: Phaser.GameObjects.Graphics;
  private roomFillGraphics!: Phaser.GameObjects.Graphics;
  private roomFrameGraphics!: Phaser.GameObjects.Graphics;
  private starfieldSprites: Phaser.GameObjects.TileSprite[] = [];
  private backdropCamera: Phaser.Cameras.Scene2D.Camera | null = null;
  private zoomDebugText: Phaser.GameObjects.Text | null = null;
  private zoomDebugGraphics: Phaser.GameObjects.Graphics | null = null;
  private zoomDebugEnabled = false;
  private lastZoomDebug: ZoomDebugState | null = null;

  private worldWindow: WorldWindow | null = null;
  private roomSummariesById = new Map<string, WorldRoomSummary>();
  private draftRoomsById = new Map<string, RoomSnapshot>();
  private roomSnapshotsById = new Map<string, RoomSnapshot>();
  private roomLoadPromisesById = new Map<string, Promise<RoomSnapshot | null>>();
  private previewImagesByRoomId = new Map<string, Phaser.GameObjects.Image>();
  private previewTextureKeysByRoomId = new Map<string, string>();
  private loadedFullRoomsById = new Map<string, LoadedFullRoom>();

  private mode: OverworldMode = 'browse';
  private cameraMode: CameraMode = 'inspect';
  private selectedCoordinates: RoomCoordinates = { ...DEFAULT_ROOM_COORDINATES };
  private currentRoomCoordinates: RoomCoordinates = { ...DEFAULT_ROOM_COORDINATES };
  private windowCenterCoordinates: RoomCoordinates = { ...DEFAULT_ROOM_COORDINATES };
  private selectedSummary: WorldRoomSummary | null = null;
  private inspectZoom = DEFAULT_ZOOM;
  private transientStatusMessage: string | null = null;
  private transientStatusExpiresAt = 0;

  private isPanning = false;
  private panStartPointer = { x: 0, y: 0 };
  private panCurrentPointer = { x: 0, y: 0 };
  private panStartScroll = { x: 0, y: 0 };
  private altDown = false;
  private spaceDown = false;

  private coyoteTime = 0;
  private jumpBuffered = false;
  private jumpBufferTime = 0;
  private isClimbingLadder = false;
  private activeLadderKey: string | null = null;
  private collectedObjectKeys = new Set<string>();
  private score = 0;

  private destroyed = false;
  private loadGeneration = 0;
  private shouldCenterCamera = false;
  private shouldRespawnPlayer = false;
  private readonly handleCanvasWheel = (event: WheelEvent): void => {
    if (document.body.dataset.appMode !== 'world') {
      return;
    }

    const rect = this.game.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const screenX = ((event.clientX - rect.left) / rect.width) * this.scale.width;
    const screenY = ((event.clientY - rect.top) / rect.height) * this.scale.height;

    if (screenX < 0 || screenX > this.scale.width || screenY < 0 || screenY > this.scale.height) {
      return;
    }

    event.preventDefault();

    const camera = this.cameras.main;
    const beforeZoom = camera.zoom;
    const beforeScrollX = camera.scrollX;
    const beforeScrollY = camera.scrollY;
    const anchorWorldBefore = this.getScreenAnchorWorldPoint(screenX, screenY, camera);
    const phaserPointer = {
      x: this.input.activePointer.x,
      y: this.input.activePointer.y,
    };

    this.handleWheelZoom(screenX, screenY, event.deltaY);

    const anchorWorldAfter = this.getScreenAnchorWorldPoint(screenX, screenY, camera);
    this.recordZoomDebug({
      source: 'canvas-wheel',
      rawClient: { x: event.clientX, y: event.clientY },
      screen: { x: screenX, y: screenY },
      phaserPointer,
      deltaY: event.deltaY,
      anchorWorldBefore: { x: anchorWorldBefore.x, y: anchorWorldBefore.y },
      anchorWorldAfter: { x: anchorWorldAfter.x, y: anchorWorldAfter.y },
      zoom: { before: beforeZoom, after: camera.zoom },
      scroll: {
        beforeX: beforeScrollX,
        beforeY: beforeScrollY,
        afterX: camera.scrollX,
        afterY: camera.scrollY,
      },
      mode: this.mode,
      cameraMode: this.cameraMode,
      selected: { ...this.selectedCoordinates },
      currentRoom: { ...this.currentRoomCoordinates },
    });
  };

  constructor() {
    super({ key: 'OverworldPlayScene' });
  }

  create(data?: OverworldPlaySceneData): void {
    this.resetRuntimeState();
    setAppMode('world');
    this.zoomDebugEnabled = this.isDebugQueryEnabled('zoomDebug');

    this.physics.world.gravity.y = this.GRAVITY;

    this.createBackdrop();

    this.roomFillGraphics = this.add.graphics();
    this.roomFillGraphics.setDepth(-5);
    this.roomGridGraphics = this.add.graphics();
    this.roomGridGraphics.setDepth(-4);
    this.roomFrameGraphics = this.add.graphics();
    this.roomFrameGraphics.setDepth(20);

    this.loadingText = this.add.text(this.scale.width / 2, this.scale.height / 2, 'Loading world...', {
      fontFamily: 'Courier New',
      fontSize: '16px',
      color: RETRO_COLORS.text,
    });
    this.loadingText.setOrigin(0.5);
    this.loadingText.setScrollFactor(0);
    this.loadingText.setDepth(200);
    this.syncBackdropCameraIgnores();
    this.setupZoomDebug();

    this.setupControls();
    this.setupPointerControls();
    this.setupCamera();
    this.game.canvas.addEventListener('wheel', this.handleCanvasWheel, { passive: false });
    (window as Window & { get_zoom_debug?: () => ZoomDebugState | null }).get_zoom_debug = () =>
      this.lastZoomDebug;

    this.scale.on('resize', this.handleResize, this);
    this.events.on(Phaser.Scenes.Events.WAKE, this.handleWake, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);

    const initialFocus = data?.centerCoordinates ?? data?.roomCoordinates ?? getFocusedCoordinatesFromUrl();
    this.applySceneData({
      centerCoordinates: initialFocus,
      roomCoordinates: initialFocus,
      mode: data?.mode ?? 'browse',
      draftRoom: data?.draftRoom ?? null,
    });

    void this.refreshAround(this.windowCenterCoordinates);
  }

  update(_time: number, delta: number): void {
    this.updateBackdrop();
    this.redrawGridOverlay();
    this.updateLiveObjects(delta);

    if (!this.playerBody) {
      this.updateHud();
      this.updateBottomBar();
      return;
    }

    const left = this.cursors.left.isDown || this.wasd.A.isDown;
    const right = this.cursors.right.isDown || this.wasd.D.isDown;
    const upHeld = this.cursors.up.isDown || this.wasd.W.isDown;
    const downHeld = this.cursors.down.isDown || this.wasd.S.isDown;
    const verticalInput = (downHeld ? 1 : 0) - (upHeld ? 1 : 0);
    const upPressed =
      Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
      Phaser.Input.Keyboard.JustDown(this.wasd.W);
    const spacePressed = Phaser.Input.Keyboard.JustDown(this.cursors.space!);
    const overlappingLadder = this.findOverlappingLadder();
    const stayOnLadder =
      overlappingLadder !== null &&
      !spacePressed &&
      (verticalInput !== 0 || (this.isClimbingLadder && !left && !right));
    const jumpedOffLadder = this.isClimbingLadder && spacePressed;

    if (stayOnLadder && overlappingLadder) {
      this.setPlayerLadderState(overlappingLadder);
      const ladderDeltaX = overlappingLadder.sprite.x - (this.player?.x ?? this.playerBody.center.x);
      this.playerBody.setVelocityX(Phaser.Math.Clamp(ladderDeltaX * 12, -45, 45));
      this.playerBody.setVelocityY(verticalInput * this.LADDER_CLIMB_SPEED);
      this.coyoteTime = 0;
      this.jumpBuffered = false;
      this.jumpBufferTime = 0;
    } else {
      if (this.isClimbingLadder) {
        this.setPlayerLadderState(null);
      }

      const onFloor = this.playerBody.blocked.down || this.playerBody.touching.down;
      if (onFloor) {
        this.coyoteTime = this.COYOTE_MS;
      } else {
        this.coyoteTime = Math.max(0, this.coyoteTime - delta);
      }

      if (left) {
        this.playerBody.setVelocityX(-this.PLAYER_SPEED);
      } else if (right) {
        this.playerBody.setVelocityX(this.PLAYER_SPEED);
      } else {
        this.playerBody.setVelocityX(0);
      }

      const jumpPressed = spacePressed || (upPressed && overlappingLadder === null);

      if (jumpedOffLadder) {
        this.playerBody.setVelocityY(this.JUMP_VELOCITY);
        this.jumpBuffered = false;
        this.jumpBufferTime = 0;
        this.coyoteTime = 0;
      } else {
        if (jumpPressed) {
          this.jumpBuffered = true;
          this.jumpBufferTime = this.JUMP_BUFFER_MS;
        }

        if (this.jumpBufferTime > 0) {
          this.jumpBufferTime -= delta;
          if (this.jumpBufferTime <= 0) {
            this.jumpBuffered = false;
          }
        }

        if (this.jumpBuffered && this.coyoteTime > 0) {
          this.playerBody.setVelocityY(this.JUMP_VELOCITY);
          this.jumpBuffered = false;
          this.coyoteTime = 0;
        }

        const jumpHeld = upHeld || this.cursors.space!.isDown;
        if (!jumpHeld && this.playerBody.velocity.y < 0) {
          this.playerBody.setVelocityY(this.playerBody.velocity.y * 0.85);
        }
      }
    }

    this.maybeRespawnFromVoid();
    this.maybeAdvancePlayerRoom();
    this.updateHud();
    this.updateBottomBar();
  }

  private resetRuntimeState(): void {
    if (this.backdropCamera && this.cameras.cameras.includes(this.backdropCamera)) {
      this.cameras.remove(this.backdropCamera, true);
    }

    this.destroyed = false;
    this.worldWindow = null;
    this.roomSummariesById = new Map();
    this.draftRoomsById = new Map();
    this.roomSnapshotsById = new Map();
    this.roomLoadPromisesById = new Map();
    this.previewImagesByRoomId = new Map();
    this.previewTextureKeysByRoomId = new Map();
    this.loadedFullRoomsById = new Map();
    this.starfieldSprites = [];
    this.backdropCamera = null;
    this.mode = 'browse';
    this.cameraMode = 'inspect';
    this.selectedCoordinates = { ...DEFAULT_ROOM_COORDINATES };
    this.currentRoomCoordinates = { ...DEFAULT_ROOM_COORDINATES };
    this.windowCenterCoordinates = { ...DEFAULT_ROOM_COORDINATES };
    this.selectedSummary = null;
    this.inspectZoom = DEFAULT_ZOOM;
    this.transientStatusMessage = null;
    this.transientStatusExpiresAt = 0;
    this.isPanning = false;
    this.panStartPointer = { x: 0, y: 0 };
    this.panCurrentPointer = { x: 0, y: 0 };
    this.panStartScroll = { x: 0, y: 0 };
    this.altDown = false;
    this.spaceDown = false;
    this.coyoteTime = 0;
    this.jumpBuffered = false;
    this.jumpBufferTime = 0;
    this.isClimbingLadder = false;
    this.activeLadderKey = null;
    this.collectedObjectKeys = new Set();
    this.score = 0;
    this.loadGeneration = 0;
    this.shouldCenterCamera = false;
    this.shouldRespawnPlayer = false;
  }

  private setupControls(): void {
    const keyboard = this.input.keyboard!;

    this.cursors = keyboard.createCursorKeys();
    this.wasd = {
      W: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.modifierKeys = {
      ALT: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ALT),
      SPACE: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
    };

    keyboard.on('keydown-C', () => {
      if (this.mode !== 'play') return;
      this.toggleCameraMode();
    });
    keyboard.on('keydown-F', () => {
      this.fitLoadedWorld();
    });
    keyboard.on('keydown-P', () => {
      if (this.mode === 'play') {
        this.returnToWorld();
      }
    });
    keyboard.on('keydown-ESC', () => {
      if (this.mode === 'play') {
        this.returnToWorld();
      }
    });
    keyboard.on('keydown-ALT', () => {
      this.altDown = true;
    });
    keyboard.on('keyup-ALT', () => {
      this.altDown = false;
      this.isPanning = false;
    });
    keyboard.on('keydown-SPACE', () => {
      this.spaceDown = true;
    });
    keyboard.on('keyup-SPACE', () => {
      this.spaceDown = false;
      this.isPanning = false;
    });
  }

  private setupPointerControls(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const wantsPan = this.pointerRequestsPan(pointer);
      if (wantsPan) {
        if (this.cameraMode === 'follow') {
          this.cameraMode = 'inspect';
          this.applyCameraMode();
        }

        this.isPanning = true;
        this.panStartPointer = { x: pointer.x, y: pointer.y };
        this.panCurrentPointer = { x: pointer.x, y: pointer.y };
        this.panStartScroll = {
          x: this.cameras.main.scrollX,
          y: this.cameras.main.scrollY,
        };
        return;
      }

      this.handleRoomSelection(pointer);
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.isPanning) return;

      const distance = Phaser.Math.Distance.Between(
        this.panStartPointer.x,
        this.panStartPointer.y,
        pointer.x,
        pointer.y
      );
      if (distance < PAN_THRESHOLD) return;

      this.panCurrentPointer = { x: pointer.x, y: pointer.y };

      const camera = this.cameras.main;
      const dx = (this.panStartPointer.x - pointer.x) / camera.zoom;
      const dy = (this.panStartPointer.y - pointer.y) / camera.zoom;
      camera.setScroll(this.panStartScroll.x + dx, this.panStartScroll.y + dy);
      this.constrainInspectCamera();
    });

    this.input.on('pointerup', () => {
      const wasPanning = this.isPanning;
      this.isPanning = false;

      if (wasPanning && this.mode === 'browse') {
        this.syncBrowseWindowToCamera();
      }
    });
  }

  private setupCamera(): void {
    const camera = this.cameras.main;
    camera.setRoundPixels(true);
    camera.setZoom(this.inspectZoom);
    camera.useBounds = false;
  }

  private createBackdrop(): void {
    const textureKey = ensureStarfieldTexture(this);
    const farLayer = this.add.tileSprite(0, 0, this.scale.width, this.scale.height, textureKey);
    farLayer.setOrigin(0, 0);
    farLayer.setDepth(-80);
    farLayer.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);

    const nearLayer = this.add.tileSprite(0, 0, this.scale.width, this.scale.height, textureKey);
    nearLayer.setOrigin(0, 0);
    nearLayer.setDepth(-79);
    nearLayer.setAlpha(0.28);
    nearLayer.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);

    this.starfieldSprites = [farLayer, nearLayer];
    this.ensureBackdropCamera();
    this.syncBackdropCameraIgnores();
    this.updateBackdrop();
  }

  private updateBackdrop(): void {
    if (this.starfieldSprites.length === 0) {
      return;
    }

    const motionCamera = this.cameras.main;
    const backdropCamera = this.backdropCamera;
    const configs = [
      { parallax: 0.035, tileScale: 1 },
      { parallax: 0.12, tileScale: 0.58 },
    ];

    for (let index = 0; index < this.starfieldSprites.length; index++) {
      const sprite = this.starfieldSprites[index];
      const config = configs[Math.min(index, configs.length - 1)];
      sprite.setPosition(0, 0);
      sprite.setSize(this.scale.width, this.scale.height);
      sprite.setTileScale(config.tileScale, config.tileScale);
      sprite.tilePositionX = (motionCamera.scrollX * config.parallax) / config.tileScale;
      sprite.tilePositionY = (motionCamera.scrollY * config.parallax) / config.tileScale;
    }

    if (backdropCamera) {
      backdropCamera.setSize(this.scale.width, this.scale.height);
      backdropCamera.setScroll(0, 0);
    }
  }

  private ensureBackdropCamera(): void {
    if (!this.backdropCamera) {
      this.backdropCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
      this.backdropCamera.setScroll(0, 0);
      this.backdropCamera.setRoundPixels(true);

      const cameras = this.cameras.cameras;
      const backdropIndex = cameras.indexOf(this.backdropCamera);
      if (backdropIndex > 0) {
        cameras.splice(backdropIndex, 1);
        cameras.unshift(this.backdropCamera);
      }
      return;
    }

    this.backdropCamera.setSize(this.scale.width, this.scale.height);
  }

  private syncBackdropCameraIgnores(): void {
    const mainCamera = this.cameras.main;
    mainCamera.transparent = true;

    for (const sprite of this.starfieldSprites) {
      mainCamera.ignore(sprite);
    }

    if (!this.backdropCamera) {
      return;
    }

    const ignoredObjects: Phaser.GameObjects.GameObject[] = [];

    if (this.roomFillGraphics) ignoredObjects.push(this.roomFillGraphics);
    if (this.roomGridGraphics) ignoredObjects.push(this.roomGridGraphics);
    if (this.roomFrameGraphics) ignoredObjects.push(this.roomFrameGraphics);
    if (this.loadingText) ignoredObjects.push(this.loadingText);
    if (this.zoomDebugGraphics) ignoredObjects.push(this.zoomDebugGraphics);
    if (this.zoomDebugText) ignoredObjects.push(this.zoomDebugText);
    if (this.player) ignoredObjects.push(this.player);

    for (const image of this.previewImagesByRoomId.values()) {
      ignoredObjects.push(image);
    }

    for (const loadedRoom of this.loadedFullRoomsById.values()) {
      ignoredObjects.push(loadedRoom.image, loadedRoom.terrainLayer);
      for (const liveObject of loadedRoom.liveObjects) {
        ignoredObjects.push(liveObject.sprite);
      }
      for (const wall of loadedRoom.edgeWalls) {
        ignoredObjects.push(wall.rect);
      }
    }

    this.backdropCamera.ignore(ignoredObjects);
  }

  private pointerRequestsPan(pointer: Phaser.Input.Pointer): boolean {
    const altPressed =
      this.altDown ||
      Boolean((pointer.event as MouseEvent | undefined)?.altKey) ||
      this.modifierKeys.ALT.isDown;
    return pointer.middleButtonDown() || this.spaceDown || altPressed;
  }

  private handleRoomSelection(pointer: Phaser.Input.Pointer): void {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const coordinates = this.getRoomCoordinatesForPoint(worldPoint.x, worldPoint.y);
    if (!isWithinWorldWindow(coordinates, this.windowCenterCoordinates, WINDOW_RADIUS)) {
      return;
    }

    this.selectedCoordinates = coordinates;
    if (this.mode !== 'play') {
      this.currentRoomCoordinates = { ...coordinates };
    }
    this.updateSelectedSummary();
    this.redrawWorld();
    this.updateHud();
    this.updateBottomBar();
  }

  private handleResize(): void {
    this.loadingText.setPosition(this.scale.width / 2, this.scale.height / 2);
    this.updateBackdrop();
    this.updateZoomDebugOverlay();

    if (this.mode === 'play' && this.cameraMode === 'follow') {
      this.applyCameraMode();
      return;
    }

    if (this.worldWindow) {
      this.centerCameraOnCoordinates(this.getZoomFocusCoordinates());
    } else {
      this.constrainInspectCamera();
    }
    this.redrawGridOverlay();
    this.updateHud();
    this.updateBottomBar();
  }

  private handleWake = (_sys: Phaser.Scenes.Systems, data?: OverworldPlaySceneData): void => {
    setAppMode('world');
    this.applySceneData(data);
    void this.refreshAround(this.windowCenterCoordinates);
  };

  private showTransientStatus(message: string): void {
    this.transientStatusMessage = message;
    this.transientStatusExpiresAt = this.time.now + 4200;
  }

  private applySceneData(data?: OverworldPlaySceneData): void {
    const fallback = data?.centerCoordinates ?? data?.roomCoordinates ?? getFocusedCoordinatesFromUrl();

    if (data?.clearDraftRoomId) {
      this.draftRoomsById.delete(data.clearDraftRoomId);
    }

    if (data?.draftRoom) {
      const draftRoom = cloneRoomSnapshot(data.draftRoom);
      this.draftRoomsById.set(draftRoom.id, draftRoom);
    }

    if (data?.statusMessage) {
      this.showTransientStatus(data.statusMessage);
    }

    if (data?.mode) {
      if (data.mode === 'play') {
        this.resetPlaySession();
      }
      this.mode = data.mode;
    }

    const focusCoordinates = data?.roomCoordinates ?? data?.draftRoom?.coordinates ?? fallback;
    const centerCoordinates = data?.centerCoordinates ?? focusCoordinates;

    this.selectedCoordinates = { ...focusCoordinates };
    this.currentRoomCoordinates = { ...focusCoordinates };
    this.windowCenterCoordinates = { ...centerCoordinates };
    this.shouldCenterCamera = true;
    this.shouldRespawnPlayer = this.mode === 'play';

    if (this.mode === 'browse') {
      this.cameraMode = 'inspect';
    }
  }

  private getTransientStatusMessage(): string | null {
    if (!this.transientStatusMessage) {
      return null;
    }

    if (this.time.now > this.transientStatusExpiresAt) {
      this.transientStatusMessage = null;
      this.transientStatusExpiresAt = 0;
      return null;
    }

    return this.transientStatusMessage;
  }

  async jumpToCoordinates(coordinates: RoomCoordinates): Promise<void> {
    this.mode = 'browse';
    this.cameraMode = 'inspect';
    this.selectedCoordinates = { ...coordinates };
    this.currentRoomCoordinates = { ...coordinates };
    this.windowCenterCoordinates = { ...coordinates };
    this.shouldCenterCamera = true;
    this.shouldRespawnPlayer = false;
    await this.refreshAround(coordinates);
  }

  zoomIn(): void {
    this.adjustButtonZoom(BUTTON_ZOOM_FACTOR);
  }

  zoomOut(): void {
    this.adjustButtonZoom(1 / BUTTON_ZOOM_FACTOR);
  }

  private handleWheelZoom(screenX: number, screenY: number, deltaY: number): void {
    const zoomFactor = Phaser.Math.Clamp(
      Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY),
      0.92,
      1.08
    );
    this.adjustZoomByFactor(zoomFactor, screenX, screenY);
  }

  private adjustButtonZoom(factor: number): void {
    if (this.mode === 'play' && this.cameraMode === 'follow' && this.player) {
      this.adjustZoomByFactor(factor);
      return;
    }

    const camera = this.cameras.main;
    const nextZoom = Phaser.Math.Clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(nextZoom - camera.zoom) < 0.0001) {
      return;
    }

    this.inspectZoom = Number(nextZoom.toFixed(3));
    camera.setZoom(this.inspectZoom);
    this.centerCameraOnCoordinates(this.getZoomFocusCoordinates());
    this.updateBackdrop();
    this.redrawGridOverlay();
    this.updateHud();
    this.updateBottomBar();
  }

  private adjustZoomByFactor(factor: number, screenX?: number, screenY?: number): void {
    const camera = this.cameras.main;
    const anchorX = screenX ?? camera.width * 0.5;
    const anchorY = screenY ?? camera.height * 0.5;
    const nextZoom = Phaser.Math.Clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(nextZoom - camera.zoom) < 0.0001) {
      return;
    }

    const anchorWorldPoint = this.getScreenAnchorWorldPoint(anchorX, anchorY, camera);
    this.inspectZoom = Number(nextZoom.toFixed(3));
    camera.setZoom(this.inspectZoom);

    if (this.mode === 'play' && this.cameraMode === 'follow' && this.player) {
      camera.centerOn(this.player.x, this.player.y);
    } else {
      const nextScroll = this.getScrollForScreenAnchor(anchorWorldPoint.x, anchorWorldPoint.y, anchorX, anchorY, camera);
      camera.setScroll(nextScroll.x, nextScroll.y);
      this.constrainInspectCamera();
    }

    this.updateBackdrop();
    this.redrawGridOverlay();
    this.updateHud();
    this.updateBottomBar();
  }

  private getScreenAnchorWorldPoint(
    screenX: number,
    screenY: number,
    camera: Phaser.Cameras.Scene2D.Camera
  ): Phaser.Math.Vector2 {
    const localX = screenX - camera.x;
    const localY = screenY - camera.y;
    return new Phaser.Math.Vector2(
      camera.scrollX + camera.width * camera.originX - camera.displayWidth * 0.5 + localX / camera.zoom,
      camera.scrollY + camera.height * camera.originY - camera.displayHeight * 0.5 + localY / camera.zoom
    );
  }

  private getScrollForScreenAnchor(
    worldX: number,
    worldY: number,
    screenX: number,
    screenY: number,
    camera: Phaser.Cameras.Scene2D.Camera
  ): Phaser.Math.Vector2 {
    const localX = screenX - camera.x;
    const localY = screenY - camera.y;
    return new Phaser.Math.Vector2(
      worldX - camera.width * camera.originX + camera.displayWidth * 0.5 - localX / camera.zoom,
      worldY - camera.height * camera.originY + camera.displayHeight * 0.5 - localY / camera.zoom
    );
  }

  private getZoomFocusCoordinates(): RoomCoordinates {
    if (this.mode === 'play') {
      return this.currentRoomCoordinates;
    }

    return this.selectedCoordinates;
  }

  private async refreshAround(centerCoordinates: RoomCoordinates): Promise<boolean> {
    const generation = ++this.loadGeneration;
    this.windowCenterCoordinates = { ...centerCoordinates };
    this.updateHud('Loading world...');
    this.updateBottomBar('Loading world...');

    try {
      const worldWindow = await this.worldRepository.loadWorldWindow(centerCoordinates, WINDOW_RADIUS);
      if (this.destroyed || generation !== this.loadGeneration) {
        return false;
      }

      this.worldWindow = worldWindow;
      this.roomSummariesById = new Map(worldWindow.rooms.map((summary) => [summary.id, summary]));

      const renderableRooms = await this.collectRenderableRooms(worldWindow);
      if (this.destroyed || generation !== this.loadGeneration) {
        return false;
      }

      for (const renderableRoom of renderableRooms.values()) {
        this.ensureRoomPreview(renderableRoom.room);
      }

      const fullRoomIds = new Set<string>();
      if (this.mode === 'play') {
        for (const renderableRoom of renderableRooms.values()) {
          if (this.isWithinStreamRadius(renderableRoom.coordinates, this.currentRoomCoordinates)) {
            await this.ensureFullRoom(renderableRoom.room);
            fullRoomIds.add(renderableRoom.id);
          }
        }
      }

      this.unloadRoomsOutsideWindow(new Set(renderableRooms.keys()));
      this.unloadFullRoomsOutsideStream(fullRoomIds);
      this.updateSelectedSummary();
      this.updateCameraBounds();
      this.syncModeRuntime();
      this.syncPreviewVisibility();
      this.redrawWorld();
      this.updateHud();
      this.updateBottomBar();
      this.loadingText.setVisible(false);
      return true;
    } catch (error) {
      console.error('Failed to load overworld window', error);
      this.updateHud('Failed to load world.');
      this.updateBottomBar('Failed to load world.');
      return false;
    }
  }

  private async collectRenderableRooms(worldWindow: WorldWindow): Promise<Map<string, RenderableRoom>> {
    const renderableRooms = new Map<string, RenderableRoom>();
    const visibleDraftRooms = Array.from(this.draftRoomsById.values()).filter((room) =>
      isWithinWorldWindow(room.coordinates, worldWindow.center, worldWindow.radius)
    );

    for (const draftRoom of visibleDraftRooms) {
      renderableRooms.set(draftRoom.id, {
        id: draftRoom.id,
        coordinates: { ...draftRoom.coordinates },
        room: cloneRoomSnapshot(draftRoom),
      });
    }

    const visiblePublishedRooms = worldWindow.rooms.filter((room) => room.state === 'published');
    await Promise.all(
      visiblePublishedRooms.map(async (summary) => {
        if (renderableRooms.has(summary.id)) return;

        const publishedRoom = await this.ensurePublishedRoomSnapshot(summary);
        if (!publishedRoom) return;

        renderableRooms.set(summary.id, {
          id: summary.id,
          coordinates: { ...summary.coordinates },
          room: publishedRoom,
        });
      })
    );

    return renderableRooms;
  }

  private async ensurePublishedRoomSnapshot(summary: WorldRoomSummary): Promise<RoomSnapshot | null> {
    const cached = this.roomSnapshotsById.get(summary.id);
    if (cached && cached.version === (summary.version ?? cached.version)) {
      return cached;
    }

    const inFlight = this.roomLoadPromisesById.get(summary.id);
    if (inFlight) {
      return inFlight;
    }

    const request = this.worldRepository
      .loadPublishedRoom(summary.id, summary.coordinates)
      .then((room) => {
        if (room) {
          this.roomSnapshotsById.set(room.id, room);
        }
        return room;
      })
      .finally(() => {
        this.roomLoadPromisesById.delete(summary.id);
      });

    this.roomLoadPromisesById.set(summary.id, request);
    return request;
  }

  private ensureRoomPreview(room: RoomSnapshot): void {
    const textureKey = buildRoomTextureKey(room, 'preview', PREVIEW_TILE_SIZE);
    const previousTextureKey = this.previewTextureKeysByRoomId.get(room.id);

    if (previousTextureKey && previousTextureKey !== textureKey && this.textures.exists(previousTextureKey)) {
      this.textures.remove(previousTextureKey);
    }

    if (!this.textures.exists(textureKey)) {
      buildRoomSnapshotTexture(this, room, textureKey, PREVIEW_TILE_SIZE);
    }

    let previewImage = this.previewImagesByRoomId.get(room.id) ?? null;
    if (!previewImage) {
      previewImage = this.add.image(0, 0, textureKey);
      previewImage.setOrigin(0.5);
      previewImage.setDepth(0);
      this.previewImagesByRoomId.set(room.id, previewImage);
    } else {
      previewImage.setTexture(textureKey);
    }

    const origin = this.getRoomOrigin(room.coordinates);
    previewImage.setPosition(origin.x + ROOM_PX_WIDTH / 2, origin.y + ROOM_PX_HEIGHT / 2);
    previewImage.setDisplaySize(ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
    previewImage.setVisible(!this.loadedFullRoomsById.has(room.id));
    this.previewTextureKeysByRoomId.set(room.id, textureKey);
    this.syncBackdropCameraIgnores();
  }

  private async ensureFullRoom(room: RoomSnapshot): Promise<void> {
    const existing = this.loadedFullRoomsById.get(room.id);
    if (
      existing &&
      existing.room.version === room.version &&
      existing.room.updatedAt === room.updatedAt
    ) {
      existing.image.setVisible(true);
      for (const liveObject of existing.liveObjects) {
        liveObject.sprite.setVisible(true);
      }
      this.previewImagesByRoomId.get(room.id)?.setVisible(false);
      return;
    }

    this.destroyFullRoom(room.id);

    const textureKey = buildRoomTextureKey(room, 'full', TILE_SIZE, { includeObjects: false });
    if (!this.textures.exists(textureKey)) {
      buildRoomSnapshotTexture(this, room, textureKey, TILE_SIZE, { includeObjects: false });
    }

    const origin = this.getRoomOrigin(room.coordinates);
    const image = this.add.image(origin.x + ROOM_PX_WIDTH / 2, origin.y + ROOM_PX_HEIGHT / 2, textureKey);
    image.setOrigin(0.5);
    image.setDepth(10);
    image.setDisplaySize(ROOM_PX_WIDTH, ROOM_PX_HEIGHT);

    const map = this.make.tilemap({
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      width: ROOM_WIDTH,
      height: ROOM_HEIGHT,
    });
    const tilesets: Phaser.Tilemaps.Tileset[] = [];
    for (const tilesetConfig of TILESETS) {
      const tileset = map.addTilesetImage(
        tilesetConfig.key,
        tilesetConfig.key,
        TILE_SIZE,
        TILE_SIZE,
        0,
        0,
        tilesetConfig.firstGid
      );
      if (tileset) {
        tilesets.push(tileset);
      }
    }

    const terrainLayer = map.createBlankLayer(`terrain-${room.id}`, tilesets, origin.x, origin.y);
    if (!terrainLayer) {
      image.destroy();
      return;
    }

    for (let y = 0; y < ROOM_HEIGHT; y++) {
      for (let x = 0; x < ROOM_WIDTH; x++) {
        const gid = room.tileData.terrain[y][x];
        if (gid > 0) {
          terrainLayer.putTileAt(gid, x, y);
        }
      }
    }

    terrainLayer.setCollisionByExclusion([-1]);
    terrainLayer.setVisible(false);

    const loadedRoom: LoadedFullRoom = {
      room,
      image,
      textureKey,
      map,
      terrainLayer,
      terrainCollider: this.player ? this.physics.add.collider(this.player, terrainLayer) : null,
      edgeWalls: [],
      liveObjects: [],
    };
    this.createLiveObjects(loadedRoom);
    this.loadedFullRoomsById.set(room.id, loadedRoom);
    this.previewImagesByRoomId.get(room.id)?.setVisible(false);
    this.syncBackdropCameraIgnores();
  }

  private unloadRoomsOutsideWindow(visibleRoomIds: Set<string>): void {
    for (const [roomId, image] of this.previewImagesByRoomId.entries()) {
      if (visibleRoomIds.has(roomId)) continue;

      image.destroy();
      this.previewImagesByRoomId.delete(roomId);

      const textureKey = this.previewTextureKeysByRoomId.get(roomId);
      if (textureKey && this.textures.exists(textureKey)) {
        this.textures.remove(textureKey);
      }
      this.previewTextureKeysByRoomId.delete(roomId);
    }

    for (const roomId of Array.from(this.roomSnapshotsById.keys())) {
      if (!visibleRoomIds.has(roomId) && !this.loadedFullRoomsById.has(roomId)) {
        this.roomSnapshotsById.delete(roomId);
      }
    }

    this.syncBackdropCameraIgnores();
  }

  private unloadFullRoomsOutsideStream(fullRoomIds: Set<string>): void {
    for (const roomId of Array.from(this.loadedFullRoomsById.keys())) {
      if (fullRoomIds.has(roomId)) continue;
      this.destroyFullRoom(roomId);
      this.previewImagesByRoomId.get(roomId)?.setVisible(true);
    }
  }

  private destroyFullRoom(roomId: string): void {
    const loadedRoom = this.loadedFullRoomsById.get(roomId);
    if (!loadedRoom) return;

    this.destroyEdgeWalls(loadedRoom);
    this.destroyLiveObjects(loadedRoom);
    loadedRoom.terrainCollider?.destroy();
    loadedRoom.terrainLayer.destroy();
    loadedRoom.map.destroy();
    loadedRoom.image.destroy();

    if (this.textures.exists(loadedRoom.textureKey)) {
      this.textures.remove(loadedRoom.textureKey);
    }

    this.loadedFullRoomsById.delete(roomId);
    this.syncBackdropCameraIgnores();
  }

  private destroyEdgeWalls(loadedRoom: LoadedFullRoom): void {
    for (const wall of loadedRoom.edgeWalls) {
      wall.collider.destroy();
      wall.rect.destroy();
    }
    loadedRoom.edgeWalls = [];
  }

  private createLiveObjects(loadedRoom: LoadedFullRoom): void {
    const roomOrigin = this.getRoomOrigin(loadedRoom.room.coordinates);

    for (let index = 0; index < loadedRoom.room.placedObjects.length; index += 1) {
      const placedObject = loadedRoom.room.placedObjects[index];
      const config = getObjectById(placedObject.id);
      if (!config) continue;

      const objectKey = this.getPlacedObjectRuntimeKey(loadedRoom.room.id, index);
      if (this.collectedObjectKeys.has(objectKey)) {
        continue;
      }

      const sprite = this.add.sprite(
        roomOrigin.x + placedObject.x,
        roomOrigin.y + placedObject.y,
        config.id,
        0
      );
      sprite.setOrigin(0.5, 0.5);
      sprite.setDepth(18);

      if (config.frameCount > 1 && config.fps > 0) {
        const animKey = `${config.id}_anim`;
        if (this.anims.exists(animKey)) {
          sprite.play(animKey);
        }
      }

      if (config.bodyWidth > 0 && config.bodyHeight > 0) {
        if (this.usesDynamicObjectBody(config)) {
          this.physics.add.existing(sprite);
          const body = sprite.body as Phaser.Physics.Arcade.Body;
          body.setSize(config.bodyWidth, config.bodyHeight, true);
          body.setOffset(...this.getObjectBodyOffset(config));
          body.setCollideWorldBounds(false);
          body.setAllowGravity(this.objectUsesGravity(config));
        } else {
          this.physics.add.existing(sprite, true);
          const body = sprite.body as Phaser.Physics.Arcade.StaticBody;
          body.updateFromGameObject();
          body.setSize(config.bodyWidth, config.bodyHeight);
          body.setOffset(...this.getObjectBodyOffset(config));
        }
      }

      const initialDirectionX = placedObject.x <= ROOM_PX_WIDTH * 0.5 ? 1 : -1;
      loadedRoom.liveObjects.push({
        key: objectKey,
        config,
        sprite,
        interactions: [],
        worldColliders: [],
        runtime: {
          baseX: sprite.x,
          baseY: sprite.y,
          initialDirectionX,
          directionX: initialDirectionX,
          elapsedMs: 0,
          nextActionAt: config.id === 'frog' ? this.time.now + 250 : this.time.now,
          cooldownUntil: 0,
          activatedUntil: 0,
        },
      });
    }

    this.syncRoomObjectWorldColliders(loadedRoom);
  }

  private destroyLiveObjects(loadedRoom: LoadedFullRoom): void {
    for (const liveObject of loadedRoom.liveObjects) {
      this.destroyLiveObjectInteractions(liveObject);
      this.destroyLiveObjectWorldColliders(liveObject);
      liveObject.sprite.destroy();
    }

    loadedRoom.liveObjects = [];
  }

  private destroyLiveObjectInteractions(liveObject: LoadedRoomObject): void {
    for (const interaction of liveObject.interactions) {
      interaction.destroy();
    }
    liveObject.interactions = [];
  }

  private destroyLiveObjectWorldColliders(liveObject: LoadedRoomObject): void {
    for (const collider of liveObject.worldColliders) {
      collider.destroy();
    }
    liveObject.worldColliders = [];
  }

  private syncRoomObjectWorldColliders(loadedRoom: LoadedFullRoom): void {
    const solidPlatforms = loadedRoom.liveObjects.filter(
      (candidate) => candidate.config.category === 'platform' && candidate.sprite.body
    );

    for (const liveObject of loadedRoom.liveObjects) {
      this.destroyLiveObjectWorldColliders(liveObject);

      if (!this.usesDynamicObjectBody(liveObject.config) || !liveObject.sprite.body) {
        continue;
      }

      liveObject.worldColliders.push(this.physics.add.collider(liveObject.sprite, loadedRoom.terrainLayer));
      for (const platform of solidPlatforms) {
        if (!platform.sprite.active || !platform.sprite.body) {
          continue;
        }

        liveObject.worldColliders.push(this.physics.add.collider(liveObject.sprite, platform.sprite));
      }
    }
  }

  private updateLiveObjects(delta: number): void {
    if (this.mode !== 'play') {
      return;
    }

    for (const loadedRoom of this.loadedFullRoomsById.values()) {
      for (const liveObject of loadedRoom.liveObjects) {
        if (!liveObject.sprite.active) {
          continue;
        }

        switch (liveObject.config.id) {
          case 'bird':
            this.updateBirdObject(loadedRoom.room, liveObject, delta);
            break;
          case 'snake':
          case 'penguin':
            this.updatePatrolEnemy(loadedRoom.room, liveObject);
            break;
          case 'frog':
            this.updateFrogEnemy(loadedRoom.room, liveObject);
            break;
          case 'bounce_pad':
            this.updateBouncePadObject(liveObject);
            break;
          default:
            break;
        }
      }
    }
  }

  private updateBirdObject(room: RoomSnapshot, liveObject: LoadedRoomObject, delta: number): void {
    const body = liveObject.sprite.body as Phaser.Physics.Arcade.StaticBody | null;
    if (!body) {
      return;
    }

    const bounds = this.getObjectHorizontalTravelBounds(room, liveObject.config);
    liveObject.runtime.elapsedMs += delta;

    let nextX = liveObject.sprite.x + liveObject.runtime.directionX * this.BIRD_SPEED * (delta / 1000);
    if (nextX <= bounds.left || nextX >= bounds.right) {
      nextX = Phaser.Math.Clamp(nextX, bounds.left, bounds.right);
      liveObject.runtime.directionX *= -1;
    }

    const nextY =
      liveObject.runtime.baseY +
      Math.sin(liveObject.runtime.elapsedMs * this.BIRD_WAVE_SPEED) * this.BIRD_WAVE_AMPLITUDE;
    liveObject.sprite.setPosition(nextX, nextY);
    body.updateFromGameObject();
  }

  private updatePatrolEnemy(room: RoomSnapshot, liveObject: LoadedRoomObject): void {
    const body = this.getDynamicBody(liveObject.sprite);
    if (!body) {
      return;
    }

    if (this.resetDynamicObjectIfOutOfBounds(room, liveObject, body)) {
      return;
    }

    this.maybeReverseGroundEnemy(room, liveObject, body);
    body.setVelocityX(liveObject.runtime.directionX * this.getGroundEnemySpeed(liveObject.config.id));
  }

  private updateFrogEnemy(room: RoomSnapshot, liveObject: LoadedRoomObject): void {
    const body = this.getDynamicBody(liveObject.sprite);
    if (!body) {
      return;
    }

    if (this.resetDynamicObjectIfOutOfBounds(room, liveObject, body)) {
      return;
    }

    this.maybeReverseGroundEnemy(room, liveObject, body);
    const onFloor = body.blocked.down || body.touching.down;

    if (onFloor) {
      if (this.time.now >= liveObject.runtime.nextActionAt) {
        body.setVelocityX(liveObject.runtime.directionX * this.FROG_HOP_SPEED);
        body.setVelocityY(this.FROG_HOP_VELOCITY);
        liveObject.runtime.nextActionAt = this.time.now + this.FROG_HOP_DELAY_MS;
      } else {
        body.setVelocityX(0);
      }
      return;
    }

    if (Math.abs(body.velocity.x) < this.FROG_HOP_SPEED * 0.8) {
      body.setVelocityX(liveObject.runtime.directionX * this.FROG_HOP_SPEED);
    }
  }

  private updateBouncePadObject(liveObject: LoadedRoomObject): void {
    if (liveObject.config.frameCount <= 1) {
      return;
    }

    const nextFrame = this.time.now < liveObject.runtime.activatedUntil ? 1 : 0;
    if (Number(liveObject.sprite.frame.name) !== nextFrame) {
      liveObject.sprite.setFrame(nextFrame);
    }
  }

  private maybeReverseGroundEnemy(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body
  ): void {
    const bounds = this.getObjectHorizontalTravelBounds(room, liveObject.config);
    const touchingWall =
      (body.blocked.left && liveObject.runtime.directionX < 0) ||
      (body.blocked.right && liveObject.runtime.directionX > 0);
    const reachedBounds =
      (liveObject.sprite.x <= bounds.left && liveObject.runtime.directionX < 0) ||
      (liveObject.sprite.x >= bounds.right && liveObject.runtime.directionX > 0);
    const onFloor = body.blocked.down || body.touching.down;
    const missingGroundAhead =
      onFloor && !this.hasSolidTerrainAhead(room, body, liveObject.runtime.directionX);

    if (touchingWall || reachedBounds || missingGroundAhead) {
      liveObject.runtime.directionX *= -1;
    }
  }

  private resetDynamicObjectIfOutOfBounds(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body
  ): boolean {
    const roomOrigin = this.getRoomOrigin(room.coordinates);
    if (liveObject.sprite.y <= roomOrigin.y + ROOM_PX_HEIGHT + RESPAWN_FALL_DISTANCE) {
      return false;
    }

    liveObject.runtime.directionX = liveObject.runtime.initialDirectionX;
    liveObject.runtime.elapsedMs = 0;
    liveObject.runtime.nextActionAt = this.time.now + 250;
    body.reset(liveObject.runtime.baseX, liveObject.runtime.baseY);
    liveObject.sprite.setPosition(liveObject.runtime.baseX, liveObject.runtime.baseY);
    body.setVelocity(0, 0);
    return true;
  }

  private hasSolidTerrainAhead(
    room: RoomSnapshot,
    body: Phaser.Physics.Arcade.Body,
    directionX: number
  ): boolean {
    const probeX = body.center.x + directionX * (body.halfWidth + 4);
    const probeY = body.bottom + 2;
    return this.hasSolidTerrainAtWorldPoint(room, probeX, probeY);
  }

  private hasSolidTerrainAtWorldPoint(room: RoomSnapshot, worldX: number, worldY: number): boolean {
    const roomOrigin = this.getRoomOrigin(room.coordinates);
    const localX = Math.floor((worldX - roomOrigin.x) / TILE_SIZE);
    const localY = Math.floor((worldY - roomOrigin.y) / TILE_SIZE);

    if (localX < 0 || localX >= ROOM_WIDTH || localY < 0 || localY >= ROOM_HEIGHT) {
      return false;
    }

    return room.tileData.terrain[localY][localX] > 0;
  }

  private getObjectHorizontalTravelBounds(
    room: RoomSnapshot,
    config: GameObjectConfig
  ): { left: number; right: number } {
    const roomOrigin = this.getRoomOrigin(room.coordinates);
    const halfWidth = Math.max(4, (config.bodyWidth > 0 ? config.bodyWidth : config.frameWidth) * 0.5);
    return {
      left: roomOrigin.x + halfWidth + 2,
      right: roomOrigin.x + ROOM_PX_WIDTH - halfWidth - 2,
    };
  }

  private usesDynamicObjectBody(config: GameObjectConfig): boolean {
    return config.id === 'snake' || config.id === 'penguin' || config.id === 'frog';
  }

  private objectUsesGravity(config: GameObjectConfig): boolean {
    return config.id !== 'bird';
  }

  private getObjectBodyOffset(config: GameObjectConfig): [number, number] {
    const centeredX = Math.max(0, (config.frameWidth - config.bodyWidth) * 0.5);
    let offsetY = Math.max(0, (config.frameHeight - config.bodyHeight) * 0.5);

    switch (config.id) {
      case 'bounce_pad':
      case 'snake':
      case 'penguin':
      case 'frog':
        offsetY = Math.max(0, config.frameHeight - config.bodyHeight);
        break;
      default:
        break;
    }

    return [centeredX, offsetY];
  }

  private getDynamicBody(sprite: Phaser.GameObjects.Sprite): Phaser.Physics.Arcade.Body | null {
    const body = sprite.body as ArcadeObjectBody | null;
    if (!this.isDynamicArcadeBody(body)) {
      return null;
    }

    return body;
  }

  private isDynamicArcadeBody(body: ArcadeObjectBody | null): body is Phaser.Physics.Arcade.Body {
    return Boolean(body && 'velocity' in body);
  }

  private getGroundEnemySpeed(objectId: string): number {
    switch (objectId) {
      case 'penguin':
        return this.PENGUIN_SPEED;
      case 'snake':
      default:
        return this.SNAKE_SPEED;
    }
  }

  private syncPreviewVisibility(): void {
    for (const [roomId, image] of this.previewImagesByRoomId.entries()) {
      image.setVisible(!this.loadedFullRoomsById.has(roomId));
    }
  }

  private syncModeRuntime(): void {
    if (this.mode === 'browse') {
      this.destroyPlayer();
      this.cameraMode = 'inspect';
      this.syncCameraBoundsUsage();
      this.syncEdgeWalls();
      if (this.shouldCenterCamera) {
        this.centerCameraOnCoordinates(this.selectedCoordinates);
        this.shouldCenterCamera = false;
      } else {
        this.constrainInspectCamera();
      }
      return;
    }

    const currentRoom = this.getRoomSnapshotForCoordinates(this.currentRoomCoordinates);
    if (!currentRoom) {
      this.mode = 'browse';
      this.cameraMode = 'inspect';
      this.syncCameraBoundsUsage();
      this.destroyPlayer();
      return;
    }

    if (!this.player || this.shouldRespawnPlayer) {
      this.destroyPlayer();
      this.createPlayer(currentRoom);
      this.shouldRespawnPlayer = false;
    }

    this.syncFullRoomColliders();
    this.syncLiveObjectInteractions();
    this.syncEdgeWalls();
    this.applyCameraMode(this.shouldCenterCamera);
    this.shouldCenterCamera = false;
  }

  private destroyPlayer(): void {
    for (const loadedRoom of this.loadedFullRoomsById.values()) {
      loadedRoom.terrainCollider?.destroy();
      loadedRoom.terrainCollider = null;
      for (const liveObject of loadedRoom.liveObjects) {
        this.destroyLiveObjectInteractions(liveObject);
      }
      this.destroyEdgeWalls(loadedRoom);
    }

    this.isClimbingLadder = false;
    this.activeLadderKey = null;
    this.playerBody?.destroy();
    this.playerBody = null;
    this.player?.destroy();
    this.player = null;
    this.syncBackdropCameraIgnores();
  }

  private syncFullRoomColliders(): void {
    if (!this.player) return;

    for (const loadedRoom of this.loadedFullRoomsById.values()) {
      if (!loadedRoom.terrainCollider) {
        loadedRoom.terrainCollider = this.physics.add.collider(this.player, loadedRoom.terrainLayer);
      }
    }
  }

  private syncLiveObjectInteractions(): void {
    for (const loadedRoom of this.loadedFullRoomsById.values()) {
      for (const liveObject of loadedRoom.liveObjects) {
        this.destroyLiveObjectInteractions(liveObject);

        if (!this.player || !this.playerBody || !liveObject.sprite.active || !liveObject.sprite.body) {
          continue;
        }

        switch (liveObject.config.category) {
          case 'collectible':
            liveObject.interactions.push(
              this.physics.add.overlap(this.player, liveObject.sprite, () => {
                this.collectLiveObject(loadedRoom, liveObject);
              })
            );
            break;
          case 'hazard':
          case 'enemy':
            liveObject.interactions.push(
              this.physics.add.overlap(this.player, liveObject.sprite, () => {
                this.respawnPlayerToCurrentRoom();
              })
            );
            break;
          case 'platform':
            liveObject.interactions.push(this.physics.add.collider(this.player, liveObject.sprite));
            break;
          case 'interactive':
            if (liveObject.config.id === 'bounce_pad') {
              liveObject.interactions.push(
                this.physics.add.overlap(this.player, liveObject.sprite, () => {
                  const padBody = liveObject.sprite.body as ArcadeObjectBody | null;
                  if (!this.playerBody || !padBody) {
                    return;
                  }

                  if (this.time.now < liveObject.runtime.cooldownUntil || this.playerBody.velocity.y < -24) {
                    return;
                  }

                  const playerBottom = this.playerBody.bottom;
                  const padTop = padBody.top;
                  if (playerBottom > padTop + 12) {
                    return;
                  }

                  liveObject.runtime.cooldownUntil = this.time.now + this.BOUNCE_PAD_COOLDOWN_MS;
                  liveObject.runtime.activatedUntil = this.time.now + this.BOUNCE_PAD_ACTIVE_MS;
                  this.playerBody.setVelocityY(this.BOUNCE_PAD_VELOCITY);
                  this.showTransientStatus('Bounce pad launched you.');
                })
              );
            }
            break;
          default:
            break;
        }
      }
    }
  }

  private syncEdgeWalls(): void {
    for (const loadedRoom of this.loadedFullRoomsById.values()) {
      this.destroyEdgeWalls(loadedRoom);

      if (!this.playerBody || this.mode !== 'play') {
        continue;
      }

      for (const neighbor of getOrthogonalNeighbors(loadedRoom.room.coordinates)) {
        const neighborState = this.getCellStateAt(neighbor);
        if (neighborState === 'published' || neighborState === 'draft') {
          continue;
        }

        const edgeWall = this.createEdgeWall(loadedRoom.room.coordinates, neighbor);
        if (edgeWall) {
          loadedRoom.edgeWalls.push(edgeWall);
        }
      }
    }
  }

  private createEdgeWall(
    roomCoordinates: RoomCoordinates,
    neighborCoordinates: RoomCoordinates
  ): RoomEdgeWall | null {
    if (!this.player) return null;

    const roomOrigin = this.getRoomOrigin(roomCoordinates);
    const deltaX = neighborCoordinates.x - roomCoordinates.x;
    const deltaY = neighborCoordinates.y - roomCoordinates.y;

    let x = 0;
    let y = 0;
    let width = 0;
    let height = 0;

    if (deltaX === 1) {
      x = roomOrigin.x + ROOM_PX_WIDTH - EDGE_WALL_THICKNESS / 2;
      y = roomOrigin.y + ROOM_PX_HEIGHT / 2;
      width = EDGE_WALL_THICKNESS;
      height = ROOM_PX_HEIGHT;
    } else if (deltaX === -1) {
      x = roomOrigin.x + EDGE_WALL_THICKNESS / 2;
      y = roomOrigin.y + ROOM_PX_HEIGHT / 2;
      width = EDGE_WALL_THICKNESS;
      height = ROOM_PX_HEIGHT;
    } else if (deltaY === 1) {
      x = roomOrigin.x + ROOM_PX_WIDTH / 2;
      y = roomOrigin.y + ROOM_PX_HEIGHT - EDGE_WALL_THICKNESS / 2;
      width = ROOM_PX_WIDTH;
      height = EDGE_WALL_THICKNESS;
    } else if (deltaY === -1) {
      x = roomOrigin.x + ROOM_PX_WIDTH / 2;
      y = roomOrigin.y + EDGE_WALL_THICKNESS / 2;
      width = ROOM_PX_WIDTH;
      height = EDGE_WALL_THICKNESS;
    } else {
      return null;
    }

    const rect = this.add.rectangle(x, y, width, height, 0xffffff, 0);
    rect.setDepth(15);
    this.physics.add.existing(rect, true);
    const collider = this.physics.add.collider(this.player, rect);
    this.syncBackdropCameraIgnores();
    return { rect, collider };
  }

  private redrawWorld(): void {
    this.roomFillGraphics.clear();
    this.roomFrameGraphics.clear();

    if (!this.worldWindow) return;

    const gridSize = this.worldWindow.radius * 2 + 1;
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const coordinates = {
          x: this.worldWindow.center.x + col - this.worldWindow.radius,
          y: this.worldWindow.center.y + row - this.worldWindow.radius,
        };
        const roomId = roomIdFromCoordinates(coordinates);
        const origin = this.getRoomOrigin(coordinates);
        const cellState = this.getCellStateAt(coordinates);
        const previewImage = this.previewImagesByRoomId.get(roomId) ?? null;
        const cellFill = this.getCellFillStyle(cellState);

        this.roomFillGraphics.fillStyle(cellFill.color, cellFill.alpha);
        this.roomFillGraphics.fillRect(origin.x, origin.y, ROOM_PX_WIDTH, ROOM_PX_HEIGHT);

        if (previewImage) {
          previewImage.setPosition(origin.x + ROOM_PX_WIDTH / 2, origin.y + ROOM_PX_HEIGHT / 2);
          previewImage.setDisplaySize(ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
          previewImage.setVisible(
            (cellState === 'draft' || cellState === 'published') && !this.loadedFullRoomsById.has(roomId)
          );
        }

        this.drawCellFrame(coordinates, cellState, origin.x, origin.y);
      }
    }
  }

  private redrawGridOverlay(): void {
    this.roomGridGraphics.clear();

    if (!this.worldWindow) {
      return;
    }

    const camera = this.cameras.main;
    const worldView = camera.worldView;
    const firstCol = Math.floor(worldView.left / ROOM_PX_WIDTH) - 1;
    const lastCol = Math.ceil(worldView.right / ROOM_PX_WIDTH) + 1;
    const firstRow = Math.floor(worldView.top / ROOM_PX_HEIGHT) - 1;
    const lastRow = Math.ceil(worldView.bottom / ROOM_PX_HEIGHT) + 1;
    const left = firstCol * ROOM_PX_WIDTH;
    const right = lastCol * ROOM_PX_WIDTH;
    const top = firstRow * ROOM_PX_HEIGHT;
    const bottom = lastRow * ROOM_PX_HEIGHT;
    const lineWidth = 1 / camera.zoom;

    this.roomGridGraphics.fillStyle(RETRO_COLORS.grid, 0.14);

    for (let col = firstCol; col <= lastCol; col++) {
      const worldX = col * ROOM_PX_WIDTH;
      this.roomGridGraphics.fillRect(
        worldX - lineWidth * 0.5,
        top,
        lineWidth,
        bottom - top
      );
    }

    for (let row = firstRow; row <= lastRow; row++) {
      const worldY = row * ROOM_PX_HEIGHT;
      this.roomGridGraphics.fillRect(
        left,
        worldY - lineWidth * 0.5,
        right - left,
        lineWidth
      );
    }
  }

  private drawCellFrame(
    coordinates: RoomCoordinates,
    cellState: SelectedCellState,
    x: number,
    y: number
  ): void {
    if (cellState === 'draft') {
      this.roomFrameGraphics.lineStyle(2, RETRO_COLORS.draft, 0.95);
      this.roomFrameGraphics.strokeRect(x + 4, y + 4, ROOM_PX_WIDTH - 8, ROOM_PX_HEIGHT - 8);
    } else if (cellState === 'frontier') {
      this.roomFrameGraphics.lineStyle(2, RETRO_COLORS.frontier, 0.9);
      this.roomFrameGraphics.strokeRect(x + 4, y + 4, ROOM_PX_WIDTH - 8, ROOM_PX_HEIGHT - 8);
    } else if (cellState === 'published') {
      this.roomFrameGraphics.lineStyle(1, RETRO_COLORS.published, 0.45);
      this.roomFrameGraphics.strokeRect(x + 2, y + 2, ROOM_PX_WIDTH - 4, ROOM_PX_HEIGHT - 4);
    }

    if (
      coordinates.x === this.currentRoomCoordinates.x &&
      coordinates.y === this.currentRoomCoordinates.y &&
      this.mode === 'play'
    ) {
      this.roomFrameGraphics.lineStyle(3, RETRO_COLORS.draft, 0.98);
      this.roomFrameGraphics.strokeRect(x + 4, y + 4, ROOM_PX_WIDTH - 8, ROOM_PX_HEIGHT - 8);
    }

    if (
      coordinates.x === this.selectedCoordinates.x &&
      coordinates.y === this.selectedCoordinates.y
    ) {
      this.roomFrameGraphics.lineStyle(2, RETRO_COLORS.selected, 0.95);
      this.roomFrameGraphics.strokeRect(x + 8, y + 8, ROOM_PX_WIDTH - 16, ROOM_PX_HEIGHT - 16);
    }
  }

  private getCellFillStyle(cellState: SelectedCellState): { color: number; alpha: number } {
    switch (cellState) {
      case 'draft':
        return { color: RETRO_COLORS.draft, alpha: 0.07 };
      case 'published':
        return { color: RETRO_COLORS.published, alpha: 0.025 };
      case 'frontier':
        return { color: RETRO_COLORS.frontier, alpha: 0.16 };
      default:
        return { color: RETRO_COLORS.backgroundNumber, alpha: 0.18 };
    }
  }

  private updateCameraBounds(): void {
    if (!this.worldWindow) return;

    const left = (this.worldWindow.center.x - this.worldWindow.radius) * ROOM_PX_WIDTH;
    const top = (this.worldWindow.center.y - this.worldWindow.radius) * ROOM_PX_HEIGHT;
    const width = (this.worldWindow.radius * 2 + 1) * ROOM_PX_WIDTH;
    const height = (this.worldWindow.radius * 2 + 1) * ROOM_PX_HEIGHT;

    this.cameras.main.setBounds(left, top, width, height);
    this.syncCameraBoundsUsage();
  }

  private toggleCameraMode(): void {
    if (this.mode !== 'play') return;
    this.cameraMode = this.cameraMode === 'inspect' ? 'follow' : 'inspect';
    this.applyCameraMode(true);
    this.updateHud();
    this.updateBottomBar();
  }

  private applyCameraMode(forceCenter: boolean = false): void {
    const camera = this.cameras.main;

    if (!this.player || this.mode !== 'play') {
      this.syncCameraBoundsUsage();
      camera.stopFollow();
      camera.setZoom(this.inspectZoom);
      return;
    }

    if (this.cameraMode === 'follow') {
      this.syncCameraBoundsUsage();
      camera.startFollow(this.player, true, 0.12, 0.12);
      camera.setZoom(this.inspectZoom);
      return;
    }

    this.syncCameraBoundsUsage();
    camera.stopFollow();
    camera.setZoom(this.inspectZoom);
    if (forceCenter) {
      camera.centerOn(this.player.x, this.player.y);
    }
    this.constrainInspectCamera();
  }

  private centerCameraOnCoordinates(coordinates: RoomCoordinates): void {
    const camera = this.cameras.main;
    const origin = this.getRoomOrigin(coordinates);
    this.syncCameraBoundsUsage();
    camera.setZoom(this.inspectZoom);
    camera.stopFollow();
    camera.centerOn(origin.x + ROOM_PX_WIDTH / 2, origin.y + ROOM_PX_HEIGHT / 2);
    this.constrainInspectCamera();
  }

  private constrainInspectCamera(): void {
    if (!this.worldWindow) return;

    const camera = this.cameras.main;
    const bounds = camera.getBounds();
    const minScrollX = bounds.x + (camera.displayWidth - camera.width) * 0.5;
    const maxScrollX = minScrollX + bounds.width - camera.displayWidth;
    const minScrollY = bounds.y + (camera.displayHeight - camera.height) * 0.5;
    const maxScrollY = minScrollY + bounds.height - camera.displayHeight;
    const boundsFitWithinViewportX = bounds.width <= camera.displayWidth;
    const boundsFitWithinViewportY = bounds.height <= camera.displayHeight;

    const nextScrollX =
      boundsFitWithinViewportX
        ? bounds.centerX - camera.width * camera.originX
        : Phaser.Math.Clamp(camera.scrollX, minScrollX, maxScrollX);
    const nextScrollY =
      boundsFitWithinViewportY
        ? bounds.centerY - camera.height * camera.originY
        : Phaser.Math.Clamp(camera.scrollY, minScrollY, maxScrollY);

    camera.setScroll(nextScrollX, nextScrollY);
  }

  private createPlayer(startRoom: RoomSnapshot): void {
    const spawn = this.getSurfaceSpawn(startRoom);

    this.player = this.add.rectangle(
      spawn.x,
      spawn.y,
      this.PLAYER_WIDTH,
      this.PLAYER_HEIGHT,
      RETRO_COLORS.draft
    );
    this.player.setDepth(25);

    this.physics.add.existing(this.player);
    this.playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    this.playerBody.setSize(this.PLAYER_WIDTH, this.PLAYER_HEIGHT);
    this.playerBody.setCollideWorldBounds(false);
    this.playerBody.setMaxVelocityY(500);
    this.playerBody.setAllowGravity(true);
    this.isClimbingLadder = false;
    this.activeLadderKey = null;
    this.syncBackdropCameraIgnores();
  }

  private findOverlappingLadder(): LoadedRoomObject | null {
    if (!this.playerBody) {
      return null;
    }

    const playerBounds = this.getArcadeBodyBounds(this.playerBody);
    let closestLadder: LoadedRoomObject | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const loadedRoom of this.loadedFullRoomsById.values()) {
      for (const liveObject of loadedRoom.liveObjects) {
        if (liveObject.config.id !== 'ladder' || !liveObject.sprite.active || !liveObject.sprite.body) {
          continue;
        }

        const ladderBounds = this.getArcadeBodyBounds(liveObject.sprite.body as ArcadeObjectBody);
        if (!Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, ladderBounds)) {
          continue;
        }

        const distance =
          Math.abs(liveObject.sprite.x - this.playerBody.center.x) +
          Math.abs(liveObject.sprite.y - this.playerBody.center.y);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestLadder = liveObject;
        }
      }
    }

    return closestLadder;
  }

  private getArcadeBodyBounds(body: ArcadeObjectBody): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(body.left, body.top, body.width, body.height);
  }

  private setPlayerLadderState(ladder: LoadedRoomObject | null): void {
    if (!this.playerBody) {
      this.isClimbingLadder = false;
      this.activeLadderKey = null;
      return;
    }

    const nextKey = ladder?.key ?? null;
    if (this.activeLadderKey === nextKey && this.isClimbingLadder === Boolean(ladder)) {
      return;
    }

    const enteringLadder = ladder !== null && !this.isClimbingLadder;
    this.isClimbingLadder = ladder !== null;
    this.activeLadderKey = nextKey;
    this.playerBody.setAllowGravity(!ladder);

    if (enteringLadder) {
      this.playerBody.setVelocityY(0);
    }
  }

  private getSurfaceSpawn(room: RoomSnapshot): PlayerSpawn {
    const centerCol = Math.floor(ROOM_WIDTH / 2);
    const candidateCols: number[] = [centerCol];

    for (let offset = 1; offset < ROOM_WIDTH; offset++) {
      const left = centerCol - offset;
      const right = centerCol + offset;
      if (left >= 0) candidateCols.push(left);
      if (right < ROOM_WIDTH) candidateCols.push(right);
    }

    for (const tileX of candidateCols) {
      const surfaceTileY = this.findSpawnSurfaceTile(room, tileX);
      if (surfaceTileY !== null) {
        const origin = this.getRoomOrigin(room.coordinates);
        return {
          x: origin.x + tileX * TILE_SIZE + TILE_SIZE / 2,
          y: origin.y + surfaceTileY * TILE_SIZE - this.PLAYER_HEIGHT / 2,
        };
      }
    }

    const origin = this.getRoomOrigin(room.coordinates);
    return {
      x: origin.x + ROOM_PX_WIDTH / 2,
      y: origin.y + TILE_SIZE * 2,
    };
  }

  private findSpawnSurfaceTile(room: RoomSnapshot, tileX: number): number | null {
    const clearTilesNeeded = Math.max(2, Math.ceil(this.PLAYER_HEIGHT / TILE_SIZE) + 1);

    for (let tileY = ROOM_HEIGHT - 1; tileY >= 0; tileY--) {
      const tile = room.tileData.terrain[tileY][tileX];
      if (tile <= 0) continue;

      let hasClearHeadroom = true;
      for (let offset = 1; offset <= clearTilesNeeded; offset++) {
        const aboveTileY = tileY - offset;
        if (aboveTileY < 0) break;
        if (room.tileData.terrain[aboveTileY][tileX] > 0) {
          hasClearHeadroom = false;
          break;
        }
      }

      if (hasClearHeadroom) {
        return tileY;
      }
    }

    return null;
  }

  private maybeRespawnFromVoid(): void {
    const currentRoom = this.getRoomSnapshotForCoordinates(this.currentRoomCoordinates);
    if (!currentRoom || !this.player || !this.playerBody) return;

    const roomOrigin = this.getRoomOrigin(currentRoom.coordinates);
    if (this.player.y <= roomOrigin.y + ROOM_PX_HEIGHT + RESPAWN_FALL_DISTANCE) {
      return;
    }

    const spawn = this.getSurfaceSpawn(currentRoom);
    this.setPlayerLadderState(null);
    this.playerBody.reset(spawn.x, spawn.y);
    this.player.setPosition(spawn.x, spawn.y);
    this.playerBody.setVelocity(0, 0);
  }

  private respawnPlayerToCurrentRoom(): void {
    const currentRoom = this.getRoomSnapshotForCoordinates(this.currentRoomCoordinates);
    if (!currentRoom || !this.player || !this.playerBody) return;

    const spawn = this.getSurfaceSpawn(currentRoom);
    this.setPlayerLadderState(null);
    this.playerBody.reset(spawn.x, spawn.y);
    this.player.setPosition(spawn.x, spawn.y);
    this.playerBody.setVelocity(0, 0);
  }

  private collectLiveObject(loadedRoom: LoadedFullRoom, liveObject: LoadedRoomObject): void {
    if (this.collectedObjectKeys.has(liveObject.key)) {
      return;
    }

    this.collectedObjectKeys.add(liveObject.key);
    this.score += this.getCollectibleScoreValue(liveObject.config.id);
    this.showTransientStatus(`${liveObject.config.name} collected.`);
    this.destroyLiveObjectInteractions(liveObject);

    const startY = liveObject.sprite.y;
    this.tweens.add({
      targets: liveObject.sprite,
      y: startY - 16,
      scaleX: 1.5,
      scaleY: 1.5,
      alpha: 0,
      duration: 300,
      ease: 'Quad.easeOut',
      onComplete: () => {
        liveObject.sprite.destroy();
      },
    });

    loadedRoom.liveObjects = loadedRoom.liveObjects.filter((candidate) => candidate !== liveObject);
  }

  private getCollectibleScoreValue(objectId: string): number {
    switch (objectId) {
      case 'gem':
        return 5;
      case 'coin_gold':
        return 3;
      case 'coin_silver':
        return 2;
      default:
        return 1;
    }
  }

  private resetPlaySession(): void {
    this.collectedObjectKeys.clear();
    this.score = 0;
  }

  private getPlacedObjectRuntimeKey(roomId: string, placedIndex: number): string {
    return `${roomId}:${placedIndex}`;
  }

  private countLiveObjectsByCategory(category: GameObjectConfig['category']): number {
    let count = 0;

    for (const loadedRoom of this.loadedFullRoomsById.values()) {
      for (const liveObject of loadedRoom.liveObjects) {
        if (liveObject.config.category === category && liveObject.sprite.active) {
          count += 1;
        }
      }
    }

    return count;
  }

  private maybeAdvancePlayerRoom(): void {
    if (this.mode !== 'play' || !this.player) return;

    const nextRoomCoordinates = this.getRoomCoordinatesForPoint(this.player.x, this.player.y);
    if (
      nextRoomCoordinates.x === this.currentRoomCoordinates.x &&
      nextRoomCoordinates.y === this.currentRoomCoordinates.y
    ) {
      return;
    }

    this.currentRoomCoordinates = { ...nextRoomCoordinates };
    this.selectedCoordinates = { ...nextRoomCoordinates };
    this.updateSelectedSummary();
    setFocusedCoordinatesInUrl(this.currentRoomCoordinates);

    if (
      nextRoomCoordinates.x !== this.windowCenterCoordinates.x ||
      nextRoomCoordinates.y !== this.windowCenterCoordinates.y
    ) {
      void this.refreshAround(nextRoomCoordinates);
      return;
    }

    this.redrawWorld();
    this.updateHud();
    this.updateBottomBar();
  }

  private syncBrowseWindowToCamera(): void {
    if (this.mode !== 'browse') return;

    const camera = this.cameras.main;
    const centerWorldPoint = camera.getWorldPoint(camera.width * 0.5, camera.height * 0.5);
    const nextCenterCoordinates = this.getRoomCoordinatesForPoint(centerWorldPoint.x, centerWorldPoint.y);
    const dragDeltaX = this.panStartPointer.x - this.panCurrentPointer.x;
    const dragDeltaY = this.panStartPointer.y - this.panCurrentPointer.y;

    if (Math.abs(dragDeltaX) > Math.abs(dragDeltaY) * 1.5) {
      nextCenterCoordinates.y = this.windowCenterCoordinates.y;
    } else if (Math.abs(dragDeltaY) > Math.abs(dragDeltaX) * 1.5) {
      nextCenterCoordinates.x = this.windowCenterCoordinates.x;
    }

    if (
      nextCenterCoordinates.x === this.windowCenterCoordinates.x &&
      nextCenterCoordinates.y === this.windowCenterCoordinates.y
    ) {
      return;
    }

    void this.refreshAround(nextCenterCoordinates);
  }

  private syncCameraBoundsUsage(): void {
    this.cameras.main.useBounds = this.mode === 'play' && this.cameraMode === 'follow';
  }

  private getRoomCoordinatesForPoint(x: number, y: number): RoomCoordinates {
    return {
      x: Math.floor(x / ROOM_PX_WIDTH),
      y: Math.floor(y / ROOM_PX_HEIGHT),
    };
  }

  private isWithinStreamRadius(target: RoomCoordinates, center: RoomCoordinates): boolean {
    return (
      Math.abs(target.x - center.x) <= STREAM_RADIUS &&
      Math.abs(target.y - center.y) <= STREAM_RADIUS
    );
  }

  private getRoomOrigin(coordinates: RoomCoordinates): { x: number; y: number } {
    return {
      x: coordinates.x * ROOM_PX_WIDTH,
      y: coordinates.y * ROOM_PX_HEIGHT,
    };
  }

  private getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null {
    const roomId = roomIdFromCoordinates(coordinates);
    const draftRoom = this.draftRoomsById.get(roomId);
    if (draftRoom) {
      return cloneRoomSnapshot(draftRoom);
    }

    return this.roomSnapshotsById.get(roomId) ?? null;
  }

  private updateSelectedSummary(): void {
    this.selectedSummary = this.roomSummariesById.get(roomIdFromCoordinates(this.selectedCoordinates)) ?? null;
  }

  private getCellStateAt(coordinates: RoomCoordinates): SelectedCellState {
    const roomId = roomIdFromCoordinates(coordinates);
    if (this.draftRoomsById.has(roomId)) {
      return 'draft';
    }

    const summary = this.roomSummariesById.get(roomId);
    if (summary?.state === 'published') {
      return 'published';
    }
    if (summary?.state === 'frontier') {
      return 'frontier';
    }
    return 'empty';
  }

  fitLoadedWorld(): void {
    if (!this.worldWindow) return;

    const camera = this.cameras.main;
    const totalWidth = (this.worldWindow.radius * 2 + 1) * ROOM_PX_WIDTH;
    const totalHeight = (this.worldWindow.radius * 2 + 1) * ROOM_PX_HEIGHT;
    const padding = 48;
    const fitZoom = Math.min(
      (this.scale.width - padding) / totalWidth,
      (this.scale.height - padding) / totalHeight
    );

    this.inspectZoom = Phaser.Math.Clamp(fitZoom, MIN_ZOOM, MAX_ZOOM);
    camera.setZoom(this.inspectZoom);

    if (this.mode === 'play' && this.cameraMode === 'follow' && this.player) {
      camera.startFollow(this.player, true, 0.12, 0.12);
      return;
    }

    const focusCoordinates = this.mode === 'play' ? this.currentRoomCoordinates : this.selectedCoordinates;
    this.centerCameraOnCoordinates(focusCoordinates);
    this.constrainInspectCamera();
  }

  playSelectedRoom(): void {
    const selectedState = this.getCellStateAt(this.selectedCoordinates);
    if (selectedState !== 'published' && selectedState !== 'draft') return;

    this.resetPlaySession();
    this.mode = 'play';
    this.currentRoomCoordinates = { ...this.selectedCoordinates };
    this.shouldCenterCamera = true;
    this.shouldRespawnPlayer = true;
    setFocusedCoordinatesInUrl(this.currentRoomCoordinates);
    void this.refreshAround(this.currentRoomCoordinates);
  }

  returnToWorld(): void {
    this.mode = 'browse';
    this.cameraMode = 'inspect';
    this.selectedCoordinates = { ...this.currentRoomCoordinates };
    this.shouldCenterCamera = true;
    this.shouldRespawnPlayer = false;
    void this.refreshAround(this.currentRoomCoordinates);
  }

  buildSelectedRoom(): void {
    if (this.getCellStateAt(this.selectedCoordinates) !== 'frontier') return;

    const editorData: EditorSceneData = {
      roomCoordinates: { ...this.selectedCoordinates },
      source: 'world',
    };

    this.scene.sleep();
    this.scene.run('EditorScene', editorData);
  }

  editSelectedRoom(): void {
    const selectedState = this.getCellStateAt(this.selectedCoordinates);
    if (selectedState !== 'published' && selectedState !== 'draft') return;

    const editorData: EditorSceneData = {
      roomCoordinates: { ...this.selectedCoordinates },
      source: 'world',
      roomSnapshot: this.getRoomSnapshotForCoordinates(this.selectedCoordinates),
    };

    this.scene.sleep();
    this.scene.run('EditorScene', editorData);
  }

  editCurrentRoom(): void {
    this.editSelectedRoom();
  }

  private updateHud(statusOverride?: string): void {
    const hud = document.getElementById('world-hud');
    const selectedCoordsEl = document.getElementById('world-selected-coords');
    const selectedStateEl = document.getElementById('world-selected-state');
    const selectedMetaEl = document.getElementById('world-selected-meta');
    const statusEl = document.getElementById('world-status');
    const playBtn = document.getElementById('btn-world-play') as HTMLButtonElement | null;
    const editBtn = document.getElementById('btn-world-edit') as HTMLButtonElement | null;
    const buildBtn = document.getElementById('btn-world-build') as HTMLButtonElement | null;
    const jumpInput = document.getElementById('world-jump-input') as HTMLInputElement | null;
    const zoomLabel = document.getElementById('world-zoom-label');

    if (hud) {
      hud.classList.remove('hidden');
    }

    if (jumpInput && document.activeElement !== jumpInput) {
      jumpInput.value = roomIdFromCoordinates(this.selectedCoordinates);
    }

    if (selectedCoordsEl) {
      selectedCoordsEl.textContent = roomIdFromCoordinates(this.selectedCoordinates);
    }

    const selectedState = this.getCellStateAt(this.selectedCoordinates);
    const selectedRoomId = roomIdFromCoordinates(this.selectedCoordinates);
    const selectedDraft = this.draftRoomsById.get(selectedRoomId) ?? null;

    if (selectedStateEl) {
      selectedStateEl.textContent =
        selectedState === 'published'
          ? 'Published'
          : selectedState === 'draft'
            ? 'Draft'
            : selectedState === 'frontier'
              ? 'Frontier'
              : 'Empty';
    }

    if (selectedMetaEl) {
      if (selectedState === 'published') {
        selectedMetaEl.textContent = `Published v${this.selectedSummary?.version ?? 1} · room is ${ROOM_WIDTH}x${ROOM_HEIGHT} tiles`;
      } else if (selectedState === 'draft' && selectedDraft) {
        selectedMetaEl.textContent = `Draft preview · background ${selectedDraft.background} · testable in the stitched world`;
      } else if (selectedState === 'frontier') {
        selectedMetaEl.textContent = `Frontier room · build here to add a new room to the world`;
      } else {
        selectedMetaEl.textContent = 'No room here yet';
      }
    }

    if (zoomLabel) {
      zoomLabel.textContent = `${this.cameras.main.zoom.toFixed(2)}x`;
    }

    if (playBtn) {
      playBtn.disabled = selectedState !== 'published' && selectedState !== 'draft';
    }
    if (editBtn) {
      editBtn.disabled = selectedState !== 'published' && selectedState !== 'draft';
    }
    if (buildBtn) {
      buildBtn.disabled = selectedState !== 'frontier';
    }

    if (statusEl) {
      const transientStatus = this.getTransientStatusMessage();
      if (statusOverride) {
        statusEl.textContent = statusOverride;
      } else if (transientStatus) {
        statusEl.textContent = transientStatus;
      } else if (this.mode === 'play') {
        statusEl.textContent = `Play mode · score ${this.score} · wheel zooms on cursor · +/- zoom current room · C follow cam · Option-drag pans`;
      } else {
        statusEl.textContent = 'Browse mode · click rooms to select · wheel zooms on cursor · +/- zoom selected room · Jump recenters';
      }
    }
  }

  private updateBottomBar(statusOverride?: string): void {
    const coordsEl = document.getElementById('room-coords');
    const cursorEl = document.getElementById('cursor-coords');
    const saveStatusEl = document.getElementById('room-save-status');
    const fitBtn = document.getElementById('btn-fit-screen');
    const zoomEl = document.getElementById('zoom-level');

    if (coordsEl) {
      const focus = this.mode === 'play' ? this.currentRoomCoordinates : this.selectedCoordinates;
      coordsEl.textContent = `Room (${focus.x}, ${focus.y})`;
    }

    if (cursorEl) {
      cursorEl.textContent =
        this.mode === 'play' && this.player
          ? `Player: ${Math.round(this.player.x)}, ${Math.round(this.player.y)}`
          : `Selected: ${roomIdFromCoordinates(this.selectedCoordinates)}`;
    }

    if (saveStatusEl) {
      const transientStatus = this.getTransientStatusMessage();
      saveStatusEl.textContent =
        statusOverride ??
        transientStatus ??
        (this.mode === 'play'
          ? `World test mode · score ${this.score} · ${this.cameraMode} cam · wheel=cursor · +/- current room`
          : 'World browse mode · wheel=cursor · +/- selected room');
    }

    if (fitBtn) {
      fitBtn.classList.remove('hidden');
    }

    if (zoomEl) {
      zoomEl.textContent = `Zoom: ${this.cameras.main.zoom.toFixed(2)}x`;
    }
  }

  private setupZoomDebug(): void {
    this.zoomDebugGraphics = this.add.graphics();
    this.zoomDebugGraphics.setDepth(240);
    this.zoomDebugGraphics.setScrollFactor(0);

    this.zoomDebugText = this.add.text(0, 0, '', {
      fontFamily: 'Courier New',
      fontSize: '12px',
      color: '#7de5ff',
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      padding: { x: 8, y: 6 },
    });
    this.zoomDebugText.setDepth(241);
    this.zoomDebugText.setScrollFactor(0);
    this.zoomDebugText.setVisible(this.zoomDebugEnabled);

    this.updateZoomDebugOverlay();
    this.syncBackdropCameraIgnores();
  }

  private updateZoomDebugOverlay(): void {
    if (this.zoomDebugText) {
      this.zoomDebugText.setPosition(Math.max(16, this.scale.width - 320), 16);
      this.zoomDebugText.setVisible(this.zoomDebugEnabled);
    }

    if (!this.zoomDebugEnabled && this.zoomDebugGraphics) {
      this.zoomDebugGraphics.clear();
    }
  }

  private recordZoomDebug(debugState: ZoomDebugState): void {
    this.lastZoomDebug = debugState;

    if (!this.zoomDebugEnabled) {
      return;
    }

    if (this.zoomDebugGraphics) {
      const { x, y } = debugState.screen;
      this.zoomDebugGraphics.clear();
      this.zoomDebugGraphics.lineStyle(1, RETRO_COLORS.draft, 0.95);
      this.zoomDebugGraphics.strokeCircle(x, y, 12);
      this.zoomDebugGraphics.lineBetween(x - 18, y, x + 18, y);
      this.zoomDebugGraphics.lineBetween(x, y - 18, x, y + 18);
    }

    if (this.zoomDebugText) {
      this.zoomDebugText.setText([
        `zoomDebug`,
        `screen ${debugState.screen.x.toFixed(1)}, ${debugState.screen.y.toFixed(1)}`,
        `phaser ${debugState.phaserPointer.x.toFixed(1)}, ${debugState.phaserPointer.y.toFixed(1)}`,
        `world ${debugState.anchorWorldBefore.x.toFixed(1)}, ${debugState.anchorWorldBefore.y.toFixed(1)}`,
        `zoom ${debugState.zoom.before.toFixed(3)} -> ${debugState.zoom.after.toFixed(3)}`,
        `scroll ${debugState.scroll.beforeX.toFixed(1)}, ${debugState.scroll.beforeY.toFixed(1)}`,
        `     -> ${debugState.scroll.afterX.toFixed(1)}, ${debugState.scroll.afterY.toFixed(1)}`,
      ]);
      this.zoomDebugText.setVisible(true);
    }

    console.info('[zoom-debug]', debugState);
  }

  private isDebugQueryEnabled(name: string): boolean {
    const value = new URLSearchParams(window.location.search).get(name);
    if (!value) {
      return false;
    }

    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  }

  private handleShutdown = (): void => {
    this.destroyed = true;
    this.scale.off('resize', this.handleResize, this);
    this.events.off(Phaser.Scenes.Events.WAKE, this.handleWake, this);
    this.input.removeAllListeners();
    this.input.keyboard?.removeAllListeners();
    this.game.canvas.removeEventListener('wheel', this.handleCanvasWheel);
    delete (window as Window & { get_zoom_debug?: () => ZoomDebugState | null }).get_zoom_debug;

    this.destroyPlayer();

    for (const roomId of Array.from(this.loadedFullRoomsById.keys())) {
      this.destroyFullRoom(roomId);
    }

    for (const image of this.previewImagesByRoomId.values()) {
      image.destroy();
    }

    for (const textureKey of this.previewTextureKeysByRoomId.values()) {
      if (this.textures.exists(textureKey)) {
        this.textures.remove(textureKey);
      }
    }

    this.previewImagesByRoomId.clear();
    this.previewTextureKeysByRoomId.clear();
    for (const sprite of this.starfieldSprites) {
      sprite.destroy();
    }
    this.starfieldSprites = [];
    if (this.backdropCamera && this.cameras.cameras.includes(this.backdropCamera)) {
      this.cameras.remove(this.backdropCamera, true);
    }
    this.backdropCamera = null;
    this.zoomDebugGraphics?.destroy();
    this.zoomDebugGraphics = null;
    this.zoomDebugText?.destroy();
    this.zoomDebugText = null;
    this.roomGridGraphics?.destroy();
    this.roomFillGraphics?.destroy();
    this.roomFrameGraphics?.destroy();
  };

  describeState(): Record<string, unknown> {
    const camera = this.cameras.main;
    const cameraBounds = camera.getBounds();
    const liveObjects = Array.from(this.loadedFullRoomsById.values()).flatMap((loadedRoom) =>
      loadedRoom.liveObjects
        .filter((liveObject) => liveObject.sprite.active)
        .map((liveObject) => {
          const body = liveObject.sprite.body as ArcadeObjectBody | null;
          const dynamicBody = this.isDynamicArcadeBody(body) ? body : null;
          return {
            id: liveObject.config.id,
            category: liveObject.config.category,
            room: { ...loadedRoom.room.coordinates },
            x: Math.round(liveObject.sprite.x),
            y: Math.round(liveObject.sprite.y),
            directionX: liveObject.runtime.directionX,
            velocityX: dynamicBody ? Math.round(dynamicBody.velocity.x) : 0,
            velocityY: dynamicBody ? Math.round(dynamicBody.velocity.y) : 0,
          };
        })
    );

    return {
      scene: 'overworld-play',
      mode: this.mode,
      cameraMode: this.cameraMode,
      selected: { ...this.selectedCoordinates },
      currentRoom: { ...this.currentRoomCoordinates },
      windowCenter: { ...this.windowCenterCoordinates },
      selectedState: this.getCellStateAt(this.selectedCoordinates),
      publishedRoomsInWindow: Array.from(this.roomSummariesById.values()).filter(
        (room) => room.state === 'published'
      ).length,
      draftRoomsInWindow: Array.from(this.draftRoomsById.values()).filter((room) =>
        isWithinWorldWindow(room.coordinates, this.windowCenterCoordinates, WINDOW_RADIUS)
      ).map((room) => room.id),
      loadedPreviewRooms: this.previewImagesByRoomId.size,
      loadedFullRooms: this.loadedFullRoomsById.size,
      score: this.score,
      collectibles: this.countLiveObjectsByCategory('collectible'),
      hazards: this.countLiveObjectsByCategory('hazard'),
      enemies: this.countLiveObjectsByCategory('enemy'),
      zoom: Number(camera.zoom.toFixed(3)),
      camera: {
        scrollX: Math.round(camera.scrollX),
        scrollY: Math.round(camera.scrollY),
        width: Math.round(camera.width),
        height: Math.round(camera.height),
        worldView: {
          x: Math.round(camera.worldView.x),
          y: Math.round(camera.worldView.y),
          width: Math.round(camera.worldView.width),
          height: Math.round(camera.worldView.height),
        },
        bounds: {
          x: Math.round(cameraBounds.x),
          y: Math.round(cameraBounds.y),
          width: Math.round(cameraBounds.width),
          height: Math.round(cameraBounds.height),
        },
      },
      player: this.playerBody && this.player
        ? {
            x: Math.round(this.player.x),
            y: Math.round(this.player.y),
            velocityX: Math.round(this.playerBody.velocity.x),
            velocityY: Math.round(this.playerBody.velocity.y),
            climbing: this.isClimbingLadder,
            ladderKey: this.activeLadderKey,
          }
        : null,
      liveObjects,
    };
  }
}
