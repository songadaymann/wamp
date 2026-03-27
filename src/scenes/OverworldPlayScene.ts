import Phaser from 'phaser';
import { playSfx, stopSfx } from '../audio/sfx';
import { createCourseRepository } from '../courses/courseRepository';
import {
  clearActiveCourseDraftSessionRoomOverride,
  getActiveCourseDraftSessionCourseId,
  getActiveCourseDraftSessionDraft,
  getActiveCourseDraftSessionRecord,
  getActiveCourseDraftSessionRoomOverride,
  getActiveCourseDraftSessionSelectedRoomId,
  getActiveCourseDraftSessionSelectedRoomOrder,
  isRoomInActiveCourseDraftSession,
  isActiveCourseDraftSessionDirty,
  setActiveCourseDraftSessionRecord,
  setActiveCourseDraftSessionRoomOverride,
  setActiveCourseDraftSessionSelectedRoom,
  updateActiveCourseDraftSession,
} from '../courses/draftSession';
import {
  areCourseRoomRefsOrthogonallyAdjacent,
  courseRoomRefsFollowLinearPath,
  courseGoalRequiresStartPoint,
  COURSE_GOAL_LABELS,
  cloneCourseSnapshot,
  createDefaultCourseRecord,
  MAX_COURSE_ROOMS,
  type CourseGoal,
  type CourseGoalType,
  type CourseMarkerPoint,
  type CourseRecord,
  type CourseRoomRef,
  type CourseSnapshot,
} from '../courses/model';
import { SceneFxController } from '../fx/controller';
import {
  getObjectById,
  placedObjectContributesToCategory,
  type GameObjectConfig,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
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
import { createRoomRepository } from '../persistence/roomRepository';
import { createWorldRepository } from '../persistence/worldRepository';
import {
  getOrthogonalNeighbors,
  type WorldChunkBounds,
  type WorldChunkWindow,
  type WorldRoomSummary,
  type WorldWindow,
} from '../persistence/worldModel';
import {
  RETRO_COLORS,
  ensureStarfieldTexture,
} from '../visuals/starfield';
import {
  DEFAULT_PLAYER_ANIMATION_KEYS,
  DEFAULT_PLAYER_IDLE_FRAME,
  DEFAULT_PLAYER_IDLE_TEXTURE_KEY,
  DEFAULT_PLAYER_VISUAL_FEET_OFFSET,
  type DefaultPlayerAnimationState,
} from '../player/defaultPlayer';
import {
  ROOM_GOAL_LABELS,
  type GoalMarkerPoint,
  type RoomGoal,
  type RoomGoalType,
} from '../goals/roomGoals';
import { setAppMode } from '../ui/appMode';
import {
  hideBusyOverlay,
  isAppReady,
  isBusyOverlayVisible,
  markAppReady,
  setBootProgress,
  setBootStatus,
  showBootFailure,
  showBusyError,
  showBusyOverlay,
} from '../ui/appFeedback';
import { getDeviceLayoutState, isMobileLandscapeBlocked } from '../ui/deviceLayout';
import {
  COURSE_COMPOSER_STATE_CHANGED_EVENT,
  type CourseComposerState,
} from '../ui/setup/sceneBridge';
import { AUTH_STATE_CHANGED_EVENT, getAuthDebugState } from '../auth/client';
import {
  PLAYFUN_GAME_PAUSE_EVENT,
  PLAYFUN_GAME_RESUME_EVENT,
} from '../playfun/client';
import { createRunRepository } from '../runs/runRepository';
import {
  OverworldGoalRunController,
  type GoalRunMutationResult,
  type GoalRunState,
} from './overworld/goalRuns';
import { OverworldSceneFlowController } from './overworld/flow';
import { OverworldInspectInputController } from './overworld/inspectInput';
import {
  OverworldBrowseOverlayController,
} from './overworld/browseOverlays';
import {
  OverworldGridOverlayController,
} from './overworld/gridOverlay';
import {
  OverworldHudBridge,
} from './overworld/hud';
import {
  buildOverworldHudViewModel,
  formatRoomEditorSummary,
  type SelectedCellState,
} from './overworld/hudViewModel';
import {
  OverworldLiveObjectController,
  isDynamicArcadeBody,
  type ArcadeObjectBody,
  type LoadedRoomObject,
} from './overworld/liveObjects';
import {
  OverworldPresenceController,
} from './overworld/presence';
import {
  OverworldCoursePlaybackController,
} from './overworld/coursePlayback';
import {
  OverworldGoalMarkerController,
} from './overworld/goalMarkers';
import {
  OverworldPresenceOverlayController,
} from './overworld/presenceOverlays';
import {
  OverworldSelectionController,
  type SelectedCourseContext,
} from './overworld/selection';
import {
  OverworldRoomCellController,
} from './overworld/roomCells';
import {
  OverworldWorldStreamingController,
  type LoadedFullRoom,
} from './overworld/worldStreaming';
import {
  getCourseGoalBadgeText,
  getCourseGoalProgressText,
  getCourseGoalTimerText,
  recordCourseRunCollectibleCollected,
  recordCourseRunDeath,
  recordCourseRunEnemyDefeated,
  tickActiveCourseRun,
  type ActiveCourseRunState,
  type CourseRunMutationResult,
} from './overworld/courseRuns';
import {
  constrainInspectCamera,
  getFitZoomForRoom as calculateFitZoomForRoom,
  getMobilePlayFollowOffsetY as calculateMobilePlayFollowOffsetY,
  getScreenAnchorWorldPoint as calculateScreenAnchorWorldPoint,
  getScrollForScreenAnchor as calculateScrollForScreenAnchor,
  type CameraMode,
} from './overworld/camera';
import {
  terrainTileCollidesAtLocalPixel,
} from './overworld/terrainCollision';
import {
  resolveGoalRunStartPoint,
} from './overworld/goalRunStartGate';
import type {
  CourseEditorSceneData,
  CourseEditedRoomData,
  EditorCourseEditData,
  EditorSceneData,
  OverworldMode,
  OverworldPlaySceneData,
} from './sceneData';
import {
  consumeTouchAction,
  getTouchInputState,
} from '../ui/mobile/touchControls';

const MIN_ZOOM = 0.08;
const MAX_ZOOM = 2.5;
const DEFAULT_ZOOM = 0.18;
const BROWSE_VISIBLE_CHUNK_REFRESH_INTERVAL_MS = 15000;
const PLAY_VISIBLE_CHUNK_REFRESH_INTERVAL_MS = 8000;
const BUTTON_ZOOM_FACTOR = 1.12;
const WHEEL_ZOOM_SENSITIVITY = 0.003;
const PLAY_ROOM_FIT_PADDING = 16;
const EDGE_WALL_THICKNESS = 12;
const RESPAWN_FALL_DISTANCE = ROOM_PX_HEIGHT * 2;
const FOLLOW_CAMERA_LERP = 0.12;
const MOBILE_PLAY_CAMERA_TARGET_Y = 0.75;

interface PlayerSpawn {
  x: number;
  y: number;
}

interface RoomEdgeWall {
  rect: Phaser.GameObjects.Rectangle;
  collider: Phaser.Physics.Arcade.Collider;
}

interface PlayerProjectile {
  rect: Phaser.GameObjects.Rectangle;
  directionX: number;
  speed: number;
  expiresAt: number;
}

interface CrateInteraction {
  crateBody: Phaser.Physics.Arcade.Body;
  mode: 'push' | 'pull';
  moveDirectionX: -1 | 1;
  facing: -1 | 1;
}

type SceneLoadedFullRoom = LoadedFullRoom<LoadedRoomObject, RoomEdgeWall>;

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

interface CoursePublishedRoomMeta {
  roomId: string;
  coordinates: RoomCoordinates;
  roomVersion: number;
  roomTitle: string | null;
  publishedByUserId: string | null;
}

export class OverworldPlayScene extends Phaser.Scene {
  private readonly PLAYER_SPEED = 150;
  private readonly JUMP_VELOCITY = -280;
  private readonly GRAVITY = 700;
  private readonly PLAYER_WIDTH = 10;
  private readonly PLAYER_HEIGHT = 14;
  private readonly PLAYER_CROUCH_HEIGHT = 9;
  private readonly PLAYER_PICKUP_SENSOR_EXTRA_HEIGHT = 15;
  private readonly CRAWL_SPEED = 70;
  private readonly CRATE_PUSH_SPEED = 78;
  private readonly CRATE_PULL_SPEED = 66;
  private readonly CRATE_INTERACTION_MAX_GAP = 14;
  private readonly COYOTE_MS = 80;
  private readonly JUMP_BUFFER_MS = 100;
  private readonly WALL_SLIDE_MAX_FALL_SPEED = 70;
  private readonly WALL_JUMP_VELOCITY_X = 205;
  private readonly WALL_JUMP_VELOCITY_Y = -265;
  private readonly WALL_JUMP_INPUT_LOCK_MS = 240;
  private readonly LADDER_CLIMB_SPEED = 90;
  private readonly BOUNCE_PAD_VELOCITY = -392;
  private readonly BOUNCE_PAD_COOLDOWN_MS = 220;
  private readonly BOUNCE_PAD_ACTIVE_MS = 140;
  private readonly QUICKSAND_ACTIVE_BUFFER_MS = 90;
  private readonly QUICKSAND_MOVE_FACTOR = 0.56;
  private readonly QUICKSAND_JUMP_FACTOR = 0.92;
  private readonly QUICKSAND_VISUAL_SINK_MAX = 5;
  private readonly BAT_SPEED = 72;
  private readonly BAT_WAVE_AMPLITUDE = 6;
  private readonly BAT_WAVE_SPEED = 0.012;
  private readonly BIRD_SPEED = 80;
  private readonly BIRD_WAVE_AMPLITUDE = 10;
  private readonly BIRD_WAVE_SPEED = 0.008;
  private readonly CRAB_SPEED = 36;
  private readonly SNAKE_SPEED = 42;
  private readonly SLIME_SPEED = 30;
  private readonly PENGUIN_SPEED = 54;
  private readonly FROG_HOP_SPEED = 68;
  private readonly FROG_HOP_VELOCITY = -236;
  private readonly FROG_HOP_DELAY_MS = 720;
  private readonly CANNON_FIRE_DELAY_MS = 1400;
  private readonly CANNON_BULLET_SPEED = 150;
  private readonly CANNON_BULLET_LIFETIME_MS = 2400;
  private readonly TORNADO_LIFT_VELOCITY = -980;
  private readonly TORNADO_SIDE_VELOCITY = 240;
  private readonly TORNADO_COOLDOWN_MS = 90;
  private readonly SWORD_COOLDOWN_MS = 220;
  private readonly SWORD_ATTACK_MS = 170;
  private readonly WEAPON_KNOCKBACK_MS = 90;
  private readonly SWORD_HIT_LUNGE_VELOCITY = 90;
  private readonly DOWNWARD_SLASH_BOUNCE_VELOCITY = -210;
  private readonly GUN_COOLDOWN_MS = 260;
  private readonly GUN_ATTACK_MS = 120;
  private readonly GUN_RECOIL_VELOCITY = 44;
  private readonly PROJECTILE_SPEED = 360;
  private readonly PROJECTILE_LIFETIME_MS = 720;
  private playfunPauseDepth = 0;
  private playfunPauseApplied = false;

  private player: Phaser.GameObjects.Rectangle | null = null;
  private playerBody: Phaser.Physics.Arcade.Body | null = null;
  private playerPickupSensor: Phaser.GameObjects.Rectangle | null = null;
  private playerPickupSensorBody: Phaser.Physics.Arcade.Body | null = null;
  private playerSprite: Phaser.GameObjects.Sprite | null = null;
  private playerAnimationState: DefaultPlayerAnimationState = 'idle';
  private playerFacing = 1;
  private playerWasGrounded = false;
  private playerLandAnimationUntil = 0;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private attackKeys!: {
    Q: Phaser.Input.Keyboard.Key;
    E: Phaser.Input.Keyboard.Key;
  };
  private cameraToggleKey!: Phaser.Input.Keyboard.Key;
  private isCrouching = false;
  private activeAttackAnimation: DefaultPlayerAnimationState | null = null;
  private activeAttackAnimationUntil = 0;
  private meleeCooldownUntil = 0;
  private rangedCooldownUntil = 0;
  private activeCrateInteractionMode: 'push' | 'pull' | null = null;
  private activeCrateInteractionFacing: -1 | 1 | null = null;
  private weaponKnockbackVelocityX = 0;
  private weaponKnockbackUntil = 0;
  private externalLaunchGraceUntil = 0;
  private playerProjectiles: PlayerProjectile[] = [];
  private ladderClimbSfxPlaying = false;

  private loadingText!: Phaser.GameObjects.Text;
  private starfieldSprites: Phaser.GameObjects.TileSprite[] = [];
  private backdropCamera: Phaser.Cameras.Scene2D.Camera | null = null;
  private zoomDebugText: Phaser.GameObjects.Text | null = null;
  private zoomDebugGraphics: Phaser.GameObjects.Graphics | null = null;
  private zoomDebugEnabled = false;
  private lastZoomDebug: ZoomDebugState | null = null;
  private hudBridge: OverworldHudBridge | null = null;
  private fxController: SceneFxController | null = null;

  private mode: OverworldMode = 'browse';
  private cameraMode: CameraMode = 'inspect';
  private selectedCoordinates: RoomCoordinates = { ...DEFAULT_ROOM_COORDINATES };
  private currentRoomCoordinates: RoomCoordinates = { ...DEFAULT_ROOM_COORDINATES };
  private windowCenterCoordinates: RoomCoordinates = { ...DEFAULT_ROOM_COORDINATES };
  private selectedSummary: WorldRoomSummary | null = null;
  private inspectZoom = DEFAULT_ZOOM;
  private browseInspectZoom = DEFAULT_ZOOM;
  private transientStatusMessage: string | null = null;
  private transientStatusExpiresAt = 0;
  private quicksandTouchedUntil = 0;
  private quicksandVisualSink = 0;
  private quicksandStatusCooldownUntil = 0;
  private readonly roomRepository = createRoomRepository();
  private readonly courseRepository = createCourseRepository();
  private courseComposerOpen = false;
  private courseComposerLoading = false;
  private courseComposerRecord: CourseRecord | null = null;
  private courseComposerStatusText: string | null = null;
  private courseComposerSelectedRoomEligible = false;
  private courseComposerSelectedRoomInDraft = false;
  private courseComposerSelectedRoomOrder: number | null = null;
  private readonly courseRoomMetaByRoomId = new Map<string, CoursePublishedRoomMeta>();
  private activeCourseRun: ActiveCourseRunState | null = null;
  private courseEditorReturnTarget: OverworldPlaySceneData['courseEditorReturnTarget'] = null;

  private coyoteTime = 0;
  private jumpBuffered = false;
  private jumpBufferTime = 0;
  private wallContactSide: -1 | 1 | 0 = 0;
  private isWallSliding = false;
  private wallJumpLockUntil = 0;
  private wallJumpActive = false;
  private wallJumpDirection: -1 | 1 | 0 = 0;
  private wallJumpBlockedSide: -1 | 1 | 0 = 0;
  private isClimbingLadder = false;
  private activeLadderKey: string | null = null;
  private collectedObjectKeys = new Set<string>();
  private heldKeyCount = 0;
  private score = 0;
  private readonly goalRunController: OverworldGoalRunController;
  private readonly flowController: OverworldSceneFlowController;
  private readonly inspectInputController: OverworldInspectInputController;
  private readonly gridOverlayController: OverworldGridOverlayController;
  private readonly browseOverlayController: OverworldBrowseOverlayController;
  private readonly roomCellController: OverworldRoomCellController;
  private readonly coursePlaybackController: OverworldCoursePlaybackController;
  private readonly goalMarkerController: OverworldGoalMarkerController;
  private readonly presenceOverlayController: OverworldPresenceOverlayController;
  private readonly selectionController: OverworldSelectionController;
  private readonly liveObjectController: OverworldLiveObjectController<RoomEdgeWall>;
  private readonly worldStreamingController: OverworldWorldStreamingController<
    LoadedRoomObject,
    RoomEdgeWall
  >;
  private readonly presenceController: OverworldPresenceController;

  private shouldCenterCamera = false;
  private shouldRespawnPlayer = false;
  private visibleChunkRefreshInFlight = false;
  private nextVisibleChunkRefreshAt = 0;
  private readonly handleCanvasWheel = (event: WheelEvent): void => {
    const appMode = document.body.dataset.appMode;
    if (appMode !== 'world' && appMode !== 'play-world') {
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

  private readonly handlePlayfunGamePause = (): void => {
    this.playfunPauseDepth += 1;
    if (this.playfunPauseApplied) {
      return;
    }

    this.playfunPauseApplied = true;
    this.scene.pause();
  };

  private readonly handlePlayfunGameResume = (): void => {
    this.playfunPauseDepth = Math.max(0, this.playfunPauseDepth - 1);
    if (!this.playfunPauseApplied || this.playfunPauseDepth > 0) {
      return;
    }

    this.playfunPauseApplied = false;
    this.scene.resume();
  };

  constructor() {
    super({ key: 'OverworldPlayScene' });
    this.goalRunController = new OverworldGoalRunController({
      playerHeight: this.PLAYER_HEIGHT,
      runRepository: createRunRepository(),
      getScore: () => this.score,
      getAuthenticated: () => getAuthDebugState().authenticated,
      countRoomObjectsByCategory: (room, category) =>
        this.countRoomObjectsByCategory(room, category),
    });
    this.liveObjectController = new OverworldLiveObjectController({
      scene: this,
      settings: {
        bouncePadVelocity: this.BOUNCE_PAD_VELOCITY,
        bouncePadCooldownMs: this.BOUNCE_PAD_COOLDOWN_MS,
        bouncePadActiveMs: this.BOUNCE_PAD_ACTIVE_MS,
        batSpeed: this.BAT_SPEED,
        batWaveAmplitude: this.BAT_WAVE_AMPLITUDE,
        batWaveSpeed: this.BAT_WAVE_SPEED,
        birdSpeed: this.BIRD_SPEED,
        birdWaveAmplitude: this.BIRD_WAVE_AMPLITUDE,
        birdWaveSpeed: this.BIRD_WAVE_SPEED,
        crabSpeed: this.CRAB_SPEED,
        snakeSpeed: this.SNAKE_SPEED,
        slimeSpeed: this.SLIME_SPEED,
        penguinSpeed: this.PENGUIN_SPEED,
        frogHopSpeed: this.FROG_HOP_SPEED,
        frogHopVelocity: this.FROG_HOP_VELOCITY,
        frogHopDelayMs: this.FROG_HOP_DELAY_MS,
        cannonFireDelayMs: this.CANNON_FIRE_DELAY_MS,
        cannonBulletSpeed: this.CANNON_BULLET_SPEED,
        cannonBulletLifetimeMs: this.CANNON_BULLET_LIFETIME_MS,
        tornadoLiftVelocity: this.TORNADO_LIFT_VELOCITY,
        tornadoSideVelocity: this.TORNADO_SIDE_VELOCITY,
        tornadoCooldownMs: this.TORNADO_COOLDOWN_MS,
        respawnFallDistance: RESPAWN_FALL_DISTANCE,
        enemyStompBounceVelocity: this.JUMP_VELOCITY * 0.58,
      },
      getRoomOrigin: (coordinates) => this.getRoomOrigin(coordinates),
      getPlacedObjectRuntimeKey: (roomId, placedObject, placedIndex) =>
        this.getPlacedObjectRuntimeKey(roomId, placedObject, placedIndex),
      isCollectedObjectKey: (key) => this.collectedObjectKeys.has(key),
      markCollectedObjectKey: (key) => {
        this.collectedObjectKeys.add(key);
      },
      getPlayer: () => this.player,
      getPlayerPickupSensor: () => this.playerPickupSensor,
      getPlayerBody: () => this.playerBody,
      isPlayerClimbingLadder: () => this.isClimbingLadder,
      isLadderDropRequested: () => this.isLadderDropRequested(),
      getCurrentTime: () => this.time.now,
      addScore: (delta) => {
        this.score += delta;
      },
      onKeyCollected: () => {
        this.heldKeyCount += 1;
      },
      tryConsumeHeldKey: () => {
        if (this.heldKeyCount <= 0) {
          return false;
        }

        this.heldKeyCount -= 1;
        return true;
      },
      touchQuicksand: () => {
        this.touchQuicksand();
      },
      grantExternalLaunchGrace: (durationMs) => {
        this.externalLaunchGraceUntil = Math.max(
          this.externalLaunchGraceUntil,
          this.time.now + durationMs
        );
      },
      showTransientStatus: (message) => this.showTransientStatus(message),
      handlePlayerDeath: (reason) => this.handlePlayerDeath(reason),
      onEnemyDefeated: (roomId, enemyName) => this.handleEnemyDefeated(roomId, enemyName),
      onCollectibleCollected: (roomId) => this.handleCollectibleCollected(roomId),
      playEnemyKillFx: (x, y) => this.fxController?.playEnemyKillFx(x, y),
      playCollectFx: (x, y, scoreDelta, cue) =>
        this.fxController?.playCollectFx(x, y, scoreDelta, cue),
      playBounceFx: (x, y) => this.fxController?.playBounceFx(x, y),
      playBombExplosionFx: (x, y) => this.fxController?.playBombExplosionFx(x, y),
    });
    this.worldStreamingController = new OverworldWorldStreamingController({
      scene: this,
      worldRepository: createWorldRepository(),
      getMode: () => this.mode,
      getPerformanceProfile: () => getDeviceLayoutState().performanceProfile,
      getSelectedCoordinates: () => this.selectedCoordinates,
      getCurrentRoomCoordinates: () => this.currentRoomCoordinates,
      getRoomOrigin: (coordinates) => this.getRoomOrigin(coordinates),
      getPlayer: () => this.player,
      createLiveObjects: (loadedRoom) => this.createLiveObjects(loadedRoom),
      destroyLiveObjects: (loadedRoom) => this.destroyLiveObjects(loadedRoom),
      destroyEdgeWalls: (loadedRoom) => this.destroyEdgeWalls(loadedRoom),
      onBackdropObjectsChanged: () => this.syncBackdropCameraIgnores(),
      onFullRoomVisibilityChanged: () => this.syncGhostVisibility(),
    });
    this.presenceController = new OverworldPresenceController({
      scene: this,
      isFullRoomLoaded: (roomId) => this.loadedFullRoomsById.has(roomId),
      getMode: () => this.mode,
      getCurrentRoomCoordinates: () => this.currentRoomCoordinates,
      getSelectedCoordinates: () => this.selectedCoordinates,
      getZoom: () => this.cameras.main.zoom,
      onSnapshotUpdated: () => {
        this.presenceOverlayController.syncOverlays();
        this.syncBackdropCameraIgnores();
        this.renderHud();
      },
      onRoomActivityChanged: () => this.redrawWorld(),
      onGhostDisplayObjectsChanged: () => this.syncBackdropCameraIgnores(),
    });
    this.coursePlaybackController = new OverworldCoursePlaybackController({
      getSelectedCoordinates: () => ({ ...this.selectedCoordinates }),
      getActiveCourseRun: () => this.activeCourseRun,
      setActiveCourseRun: (runState) => {
        this.activeCourseRun = runState;
      },
      clearTransientRoomOverride: (roomId) => {
        this.worldStreamingController.clearTransientRoomOverride(roomId);
      },
      setTransientRoomOverride: (snapshot) => {
        this.worldStreamingController.setTransientRoomOverride(snapshot);
      },
      getRoomSnapshotForCoordinates: (coordinates) =>
        this.getRoomSnapshotForCoordinates(coordinates),
      countRoomObjectsByCategory: (room, category) =>
        this.countRoomObjectsByCategory(room, category),
      renderHud: () => this.renderHud(),
    });
    this.gridOverlayController = new OverworldGridOverlayController({
      scene: this,
      getWorldWindow: () => this.worldWindow,
      getZoom: () => this.cameras.main.zoom,
    });
    this.browseOverlayController = new OverworldBrowseOverlayController({
      scene: this,
      getWorldWindow: () => this.worldWindow,
      getMode: () => this.mode,
      getSelectedCoordinates: () => ({ ...this.selectedCoordinates }),
      getZoom: () => this.cameras.main.zoom,
      getRoomOrigin: (coordinates) => this.getRoomOrigin(coordinates),
      getCellStateAt: (coordinates) => this.getCellStateAt(coordinates),
      getRoomSnapshotForCoordinates: (coordinates) =>
        this.getRoomSnapshotForCoordinates(coordinates),
      getRoomSummaryForCoordinates: (coordinates) =>
        this.roomSummariesById.get(roomIdFromCoordinates(coordinates)) ?? null,
      getRoomDisplayTitle: (title, coordinates) =>
        this.getRoomDisplayTitle(title, coordinates),
      getRoomEditorCount: (coordinates) => this.getRoomEditorCount(coordinates),
      isWithinLoadedRoomBounds: (coordinates) => this.isWithinLoadedRoomBounds(coordinates),
      playSelectedRoom: () => this.playSelectedRoom(),
      truncateOverlayText: (value, maxLength) =>
        this.truncateOverlayText(value, maxLength),
    });
    this.roomCellController = new OverworldRoomCellController({
      scene: this,
      getWorldWindow: () => this.worldWindow,
      getRoomOrigin: (coordinates) => this.getRoomOrigin(coordinates),
      getCellStateAt: (coordinates) => this.getCellStateAt(coordinates),
      getRoomEditorCount: (coordinates) => this.getRoomEditorCount(coordinates),
      getCurrentRoomCoordinates: () => ({ ...this.currentRoomCoordinates }),
      getSelectedCoordinates: () => ({ ...this.selectedCoordinates }),
      getMode: () => this.mode,
      isRoomInActiveCourse: (coordinates) => this.isRoomInActiveCourse(coordinates),
    });
    this.goalMarkerController = new OverworldGoalMarkerController({
      scene: this,
      getRoomOrigin: (coordinates) => this.getRoomOrigin(coordinates),
      getSelectedCoordinates: () => ({ ...this.selectedCoordinates }),
      getActiveCourseSnapshot: () => this.activeCourseSnapshot,
      getCourseComposerRecord: () => this.courseComposerRecord,
    });
    this.selectionController = new OverworldSelectionController({
      getMode: () => this.mode,
      setMode: (mode) => {
        this.mode = mode;
      },
      setCameraMode: (mode) => {
        this.cameraMode = mode;
      },
      getFitZoomForRoom: () => this.getFitZoomForRoom(),
      setInspectZoom: (zoom) => {
        this.inspectZoom = zoom;
      },
      setBrowseInspectZoom: (zoom) => {
        this.browseInspectZoom = zoom;
      },
      syncAppMode: () => this.syncAppMode(),
      setSelectedCoordinates: (coordinates) => {
        this.selectedCoordinates = { ...coordinates };
      },
      setCurrentRoomCoordinates: (coordinates) => {
        this.currentRoomCoordinates = { ...coordinates };
      },
      setWindowCenterCoordinates: (coordinates) => {
        this.windowCenterCoordinates = { ...coordinates };
      },
      setShouldCenterCamera: (value) => {
        this.shouldCenterCamera = value;
      },
      setShouldRespawnPlayer: (value) => {
        this.shouldRespawnPlayer = value;
      },
      updateSelectedSummary: () => this.updateSelectedSummary(),
      refreshCourseComposerSelectedRoomState: () => this.refreshCourseComposerSelectedRoomState(),
      refreshLeaderboardForSelection: () => this.refreshLeaderboardForSelection(),
      redrawWorld: () => this.redrawWorld(),
      renderHud: () => this.renderHud(),
      refreshAround: (coordinates, options) => this.refreshAround(coordinates, options),
      getRoomSummary: (roomId) => this.roomSummariesById.get(roomId),
      hasDraftRoom: (roomId) => this.draftRoomsById.has(roomId),
      hasActiveCourseRoomOverride: (roomId) =>
        this.coursePlaybackController.hasActiveCourseRoomOverride(roomId),
      isRoomInActiveCourse: (coordinates) =>
        Boolean(this.activeCourseSnapshot?.roomRefs.some((roomRef) => roomRef.roomId === roomIdFromCoordinates(coordinates))),
      getRoomSnapshotForCoordinates: (coordinates) =>
        this.worldStreamingController.getRoomSnapshotForCoordinates(coordinates),
      isWithinLoadedRoomBounds: (coordinates) =>
        this.worldStreamingController.isWithinLoadedRoomBounds(coordinates),
      getMainCamera: () => this.cameras.main,
      getWindowCenterCoordinates: () => ({ ...this.windowCenterCoordinates }),
      refreshChunkWindowIfNeeded: (coordinates) => this.refreshChunkWindowIfNeeded(coordinates),
    });
    this.presenceOverlayController = new OverworldPresenceOverlayController({
      scene: this,
      getWorldWindow: () => this.worldWindow,
      getCurrentRoomCoordinates: () => ({ ...this.currentRoomCoordinates }),
      getRoomOrigin: (coordinates) => this.getRoomOrigin(coordinates),
      getZoom: () => this.cameras.main.zoom,
      getSampledBrowsePresenceDots: (visibleRooms) =>
        this.presenceController.getSampledBrowsePresenceDots(visibleRooms),
      getPlayRoomPresenceMarkers: (visibleRooms, currentRoomCoordinates) =>
        this.presenceController.getPlayRoomPresenceMarkers(visibleRooms, currentRoomCoordinates),
    });
    this.flowController = new OverworldSceneFlowController(this, {
      getMode: () => this.mode,
      setMode: (mode) => {
        this.mode = mode;
      },
      setCameraMode: (mode) => {
        this.cameraMode = mode;
      },
      getSelectedCoordinates: () => ({ ...this.selectedCoordinates }),
      setSelectedCoordinates: (coordinates) => {
        this.selectedCoordinates = { ...coordinates };
      },
      getCurrentRoomCoordinates: () => ({ ...this.currentRoomCoordinates }),
      setCurrentRoomCoordinates: (coordinates) => {
        this.currentRoomCoordinates = { ...coordinates };
      },
      getSelectedPublishedCourseId: () => this.getSelectedCourseContext()?.courseId ?? null,
      getCourseEditorReturnTarget: () => this.courseEditorReturnTarget ?? null,
      setCourseEditorReturnTarget: (target) => {
        this.courseEditorReturnTarget = target;
      },
      getCellStateAt: (coordinates) => this.getCellStateAt(coordinates),
      isFrontierBuildBlockedByClaimLimit: () => this.isFrontierBuildBlockedByClaimLimit(),
      getSelectedRoomSnapshot: (coordinates) => this.getRoomSnapshotForCoordinates(coordinates),
      getActiveCourseEditContext: (roomId) => this.getActiveCourseDraftSessionContextForRoom(roomId),
      resetPlaySession: () => this.resetPlaySession(),
      clearTouchGestureState: () => this.clearTouchGestureState(),
      clearGoalRun: () => {
        this.goalRunController.clearCurrentRun();
      },
      getInspectZoom: () => this.inspectZoom,
      setInspectZoom: (zoom) => {
        this.inspectZoom = zoom;
      },
      getBrowseInspectZoom: () => this.browseInspectZoom,
      setBrowseInspectZoom: (zoom) => {
        this.browseInspectZoom = zoom;
      },
      getFitZoomForRoom: () => this.getFitZoomForRoom(),
      syncAppMode: () => this.syncAppMode(),
      setShouldCenterCamera: (value) => {
        this.shouldCenterCamera = value;
      },
      setShouldRespawnPlayer: (value) => {
        this.shouldRespawnPlayer = value;
      },
      refreshAround: (coordinates, options) => this.refreshAround(coordinates, options),
      prepareActiveCourseRoomOverrides: (snapshot, options) =>
        this.coursePlaybackController.prepareActiveCourseRoomOverrides(snapshot, options),
      createCourseRunState: (snapshot) =>
        this.coursePlaybackController.createCourseRunState(snapshot),
      getCourseStartRoomRef: (course) =>
        this.coursePlaybackController.getCourseStartRoomRef(course),
      getActiveCourseRun: () => this.activeCourseRun,
      setActiveCourseRun: (runState) => {
        this.activeCourseRun = runState;
      },
      startRemoteCourseRun: (runState) => {
        void this.coursePlaybackController.startRemoteCourseRun(runState);
      },
      setCourseComposerStatusText: (text) => {
        this.courseComposerStatusText = text;
      },
      emitCourseComposerStateChanged: () => this.emitCourseComposerStateChanged(),
      renderHud: () => this.renderHud(),
    });
    this.inspectInputController = new OverworldInspectInputController(this, {
      getMode: () => this.mode,
      getCameraMode: () => this.cameraMode,
      setCameraMode: (mode) => {
        this.cameraMode = mode;
      },
      applyCameraMode: () => this.applyCameraMode(),
      fitLoadedWorld: () => this.fitLoadedWorld(),
      returnToWorld: () => this.returnToWorld(),
      adjustZoomByFactor: (factor, screenX, screenY) =>
        this.adjustZoomByFactor(factor, screenX, screenY),
      constrainInspectCamera: () => this.constrainInspectCamera(),
      getRoomCoordinatesForPoint: (x, y) => this.getRoomCoordinatesForPoint(x, y),
      isWithinLoadedRoomBounds: (coordinates) => this.isWithinLoadedRoomBounds(coordinates),
      onSelectCoordinates: (coordinates) => this.selectRoomCoordinates(coordinates),
      syncBrowseWindowToCamera: (panStartPointer, panCurrentPointer) =>
        this.syncBrowseWindowToCamera(panStartPointer, panCurrentPointer),
    });
  }

  private get currentGoalRun(): GoalRunState | null {
    return this.goalRunController.getCurrentRun();
  }

  private get activeCourseSnapshot(): CourseSnapshot | null {
    return this.activeCourseRun?.course ?? null;
  }

  private getSelectedCourseContext(): SelectedCourseContext | null {
    return this.selectionController.getSelectedCourseContext(this.selectedSummary);
  }

  private getActiveCourseDraftSessionContextForRoom(roomId: string): EditorCourseEditData | null {
    const courseId = getActiveCourseDraftSessionCourseId();
    const draft = getActiveCourseDraftSessionDraft();
    if (!courseId || !draft) {
      return null;
    }

    const roomRef = draft.roomRefs.find((candidate) => candidate.roomId === roomId) ?? null;
    if (!roomRef) {
      return null;
    }

    return {
      courseId,
      roomId,
    };
  }

  private syncCourseComposerRecordFromSession(): void {
    this.courseComposerRecord = getActiveCourseDraftSessionRecord();
  }

  private setCourseComposerRecord(
    record: CourseRecord | null,
    options: { selectedRoomId?: string | null } = {}
  ): void {
    setActiveCourseDraftSessionRecord(record, options);
    this.syncCourseComposerRecordFromSession();
  }

  private sanitizeCourseComposerRecord(record: CourseRecord): {
    record: CourseRecord;
    resetMessage: string | null;
  } {
    if (courseRoomRefsFollowLinearPath(record.draft.roomRefs)) {
      return {
        record,
        resetMessage: null,
      };
    }

    if (record.published && courseRoomRefsFollowLinearPath(record.published.roomRefs)) {
      const nextDraft = cloneCourseSnapshot(record.published);
      nextDraft.status = 'draft';
      nextDraft.updatedAt = new Date().toISOString();
      return {
        record: {
          ...record,
          draft: nextDraft,
        },
        resetMessage: 'Old draft reset to the published linear course path.',
      };
    }

    const reset = createDefaultCourseRecord(record.draft.id);
    reset.ownerUserId = record.ownerUserId;
    reset.ownerDisplayName = record.ownerDisplayName;
    reset.permissions = { ...record.permissions };
    reset.versions = record.versions.map((version) => ({ ...version, snapshot: cloneCourseSnapshot(version.snapshot) }));
    reset.published = record.published ? cloneCourseSnapshot(record.published) : null;
    if (record.draft.title?.trim()) {
      reset.draft.title = record.draft.title;
    }
    return {
      record: reset,
      resetMessage: 'Old draft reset for the new linear course builder.',
    };
  }

  private getCurrentCourseDraftGoalSetupDisabledReason(
    draft: CourseSnapshot | null
  ): string | null {
    if (!draft?.goal) {
      return 'Choose a course goal in the editor first.';
    }

    if (draft.goal && courseGoalRequiresStartPoint(draft.goal) && !draft.startPoint) {
      return 'Place a course start marker first.';
    }

    switch (draft.goal.type) {
      case 'reach_exit':
        return draft.goal.exit ? null : 'Place a course exit first.';
      case 'checkpoint_sprint':
        if (draft.goal.checkpoints.length === 0) {
          return 'Add at least one checkpoint first.';
        }
        return draft.goal.finish ? null : 'Place a course finish marker first.';
      case 'collect_target':
      case 'defeat_all':
      case 'survival':
        return null;
    }
  }

  private getPublishedCourseStillLiveWarningText(): string | null {
    const published = this.courseComposerRecord?.published ?? null;
    if (!published) {
      return null;
    }

    return `Published course v${published.version} is still live until you unpublish it.`;
  }

  private getCourseComposerPublishedStateText(): string {
    const published = this.courseComposerRecord?.published ?? null;
    if (!published) {
      return 'Not published';
    }

    if (this.isCourseComposerDirty()) {
      return `Published v${published.version} live · draft has unpublished changes`;
    }

    return `Published v${published.version} live`;
  }

  private getCourseComposerPublishedDraftWarningText(): string | null {
    const published = this.courseComposerRecord?.published ?? null;
    const draft = this.courseComposerRecord?.draft ?? null;
    if (!published || !draft || draft.roomRefs.length > 0) {
      return null;
    }

    return `Draft is empty. Published course v${published.version} is still live until you unpublish it.`;
  }

  private getCurrentCourseDraftPreviewDisabledReason(): string | null {
    const draft = this.courseComposerRecord?.draft ?? null;
    if (!draft || draft.roomRefs.length === 0) {
      return this.getCourseComposerPublishedDraftWarningText() ?? 'Add at least one room to the course first.';
    }

    return this.getCurrentCourseDraftGoalSetupDisabledReason(draft);
  }

  private getCurrentCourseDraftSaveDisabledReason(): string | null {
    const draft = this.courseComposerRecord?.draft ?? null;
    if (!draft || draft.roomRefs.length === 0) {
      return this.getCourseComposerPublishedDraftWarningText() ?? 'Add at least one room before saving.';
    }

    if (!draft.title?.trim()) {
      return 'Add a course title before saving.';
    }

    if (!this.isCourseComposerDirty()) {
      return 'No unpublished course changes yet.';
    }

    return null;
  }

  private getCurrentCourseDraftPublishDisabledReason(): string | null {
    const draft = this.courseComposerRecord?.draft ?? null;
    if (!draft || draft.roomRefs.length < 2) {
      const published = this.courseComposerRecord?.published ?? null;
      return published
        ? `Add at least 2 rooms before publishing. Published course v${published.version} is still live until you republish or unpublish it.`
        : 'Add at least 2 rooms before publishing.';
    }

    if (!draft.title?.trim()) {
      return 'Add a course title before publishing.';
    }

    return this.getCurrentCourseDraftGoalSetupDisabledReason(draft);
  }

  private getIsCurrentCourseDraftPreviewReady(): boolean {
    return this.getCurrentCourseDraftPreviewDisabledReason() === null;
  }

  private getCourseComposerUnpublishDisabledReason(): string | null {
    if (!this.courseComposerRecord?.published) {
      return 'This course is not published yet.';
    }

    if (!this.courseComposerRecord.permissions.canUnpublish) {
      return 'This course is read-only for your account.';
    }

    return null;
  }

  private get currentRoomLeaderboard() {
    return this.goalRunController.getCurrentRoomLeaderboard();
  }

  private get worldWindow(): WorldWindow | null {
    return this.worldStreamingController.getWorldWindow();
  }

  private get chunkWindow(): WorldChunkWindow | null {
    return this.worldStreamingController.getChunkWindow();
  }

  private get loadedChunkBounds(): WorldChunkBounds | null {
    return this.worldStreamingController.getLoadedChunkBounds();
  }

  private get roomSummariesById(): Map<string, WorldRoomSummary> {
    return this.worldStreamingController.getRoomSummariesById();
  }

  private get draftRoomsById(): Map<string, RoomSnapshot> {
    return this.worldStreamingController.getDraftRoomsById();
  }

  private get previewImages(): Phaser.GameObjects.Image[] {
    return this.worldStreamingController.getPreviewImages();
  }

  private get loadedFullRoomsById(): Map<string, SceneLoadedFullRoom> {
    return this.worldStreamingController.getLoadedFullRoomsById();
  }

  private get nearLodRoomIds(): Set<string> {
    return this.worldStreamingController.getNearLodRoomIds();
  }

  private get midLodRoomIds(): Set<string> {
    return this.worldStreamingController.getMidLodRoomIds();
  }

  private get farLodRoomIds(): Set<string> {
    return this.worldStreamingController.getFarLodRoomIds();
  }

  create(data?: OverworldPlaySceneData): void {
    this.resetRuntimeState();
    this.syncAppMode();
    this.zoomDebugEnabled = this.isDebugQueryEnabled('zoomDebug');

    this.physics.world.gravity.y = this.GRAVITY;

    this.createBackdrop();

    this.gridOverlayController.create();
    this.roomCellController.create();
    this.browseOverlayController.create();
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
    window.addEventListener(PLAYFUN_GAME_PAUSE_EVENT, this.handlePlayfunGamePause);
    window.addEventListener(PLAYFUN_GAME_RESUME_EVENT, this.handlePlayfunGameResume);
    this.hudBridge = new OverworldHudBridge();
    this.fxController = new SceneFxController({
      scene: this,
      onDisplayObjectsChanged: () => this.syncBackdropCameraIgnores(),
    });

    this.setupGameplayKeys();
    this.inspectInputController.initialize();
    this.setupCamera();
    this.initializePresenceClient();
    this.game.canvas.addEventListener('wheel', this.handleCanvasWheel, { passive: false });
    window.addEventListener(AUTH_STATE_CHANGED_EVENT, this.handleAuthStateChanged);
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
      publishedRoom: data?.publishedRoom ?? null,
      clearDraftRoomId: data?.clearDraftRoomId ?? null,
      invalidateRoomId: data?.invalidateRoomId ?? null,
      forceRefreshAround: data?.forceRefreshAround ?? false,
      statusMessage: data?.statusMessage ?? null,
    });

    void this.refreshAround(this.windowCenterCoordinates, {
      forceChunkReload: data?.forceRefreshAround ?? false,
    });
  }

  update(_time: number, delta: number): void {
    this.maybeRefreshVisibleChunks();
    this.updateBackdrop();
    this.gridOverlayController.redraw();
    this.updateLiveObjects(delta);
    this.updateGhosts(delta);
    this.presenceOverlayController.updateBrowseDots(delta);

    if (isMobileLandscapeBlocked()) {
      this.syncLocalPresence();
      this.renderHud();
      return;
    }

    if (
      this.mode === 'play' &&
      (Phaser.Input.Keyboard.JustDown(this.cameraToggleKey) || consumeTouchAction('cameraToggle'))
    ) {
      this.toggleCameraMode();
    }

    if (this.mode === 'play' && consumeTouchAction('stop')) {
      this.returnToWorld();
      return;
    }

    if (!this.playerBody) {
      this.clearCrateInteractionState();
      this.resetWallMovementState();
      this.syncLocalPresence();
      this.renderHud();
      return;
    }

    const touchInput = getTouchInputState();
    const touchLeft = touchInput.active && touchInput.moveX <= -0.28;
    const touchRight = touchInput.active && touchInput.moveX >= 0.28;
    const touchUp = touchInput.active && touchInput.moveY <= -0.42;
    const touchDown = touchInput.active && touchInput.moveY >= 0.42;
    const left = this.cursors.left.isDown || this.wasd.A.isDown || touchLeft;
    const right = this.cursors.right.isDown || this.wasd.D.isDown || touchRight;
    const horizontalInput = (right ? 1 : 0) - (left ? 1 : 0);
    const touchJumpPressed = consumeTouchAction('jump');
    const overlappingLadder = this.findOverlappingLadder();
    const touchClimbUpHeld = overlappingLadder !== null && (touchUp || touchInput.jumpHeld);
    const upHeld = this.cursors.up.isDown || this.wasd.W.isDown || touchClimbUpHeld;
    const downHeld = this.cursors.down.isDown || this.wasd.S.isDown || touchDown;
    const verticalInput = (downHeld ? 1 : 0) - (upHeld ? 1 : 0);
    const touchJumpUsedForLadder = touchJumpPressed && overlappingLadder !== null;
    const upPressed =
      Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
      Phaser.Input.Keyboard.JustDown(this.wasd.W) ||
      touchJumpUsedForLadder;
    const spacePressed =
      Phaser.Input.Keyboard.JustDown(this.cursors.space!) ||
      (touchJumpPressed && !touchJumpUsedForLadder);
    const stayOnLadder =
      overlappingLadder !== null &&
      !spacePressed &&
      (verticalInput !== 0 || (this.isClimbingLadder && !left && !right));
    const jumpedOffLadder = this.isClimbingLadder && spacePressed;
    const swordPressed = Phaser.Input.Keyboard.JustDown(this.attackKeys.Q) || consumeTouchAction('slash');
    const gunPressed = Phaser.Input.Keyboard.JustDown(this.attackKeys.E) || consumeTouchAction('shoot');
    const inQuicksand = this.isPlayerInQuicksand();

    if (stayOnLadder && overlappingLadder) {
      this.setPlayerLadderState(overlappingLadder);
      const ladderDeltaX = overlappingLadder.sprite.x - (this.player?.x ?? this.playerBody.center.x);
      this.playerBody.setVelocityX(Phaser.Math.Clamp(ladderDeltaX * 12, -45, 45));
      this.playerBody.setVelocityY(verticalInput * this.LADDER_CLIMB_SPEED);
      this.coyoteTime = 0;
      this.jumpBuffered = false;
      this.jumpBufferTime = 0;
      this.isCrouching = false;
      this.clearCrateInteractionState();
      this.resetWallMovementState();
      this.syncPlayerHitbox();
    } else {
      if (this.isClimbingLadder) {
        this.setPlayerLadderState(null);
      }

      const onFloor = this.playerBody.blocked.down || this.playerBody.touching.down;
      const crateInteraction =
        !inQuicksand && onFloor && horizontalInput !== 0
          ? this.findCrateInteraction(horizontalInput, downHeld)
          : null;
      const wantsCrouch = onFloor && downHeld && !crateInteraction;
      this.isCrouching = wantsCrouch || (this.isCrouching && !this.canPlayerStandUp());
      this.syncPlayerHitbox();
      const canWallSlide =
        !onFloor &&
        crateInteraction === null &&
        !this.isCrouching &&
        this.playerBody.velocity.y >= 0 &&
        this.time.now >= this.wallJumpLockUntil;
      this.updateWallMovementState(horizontalInput, onFloor, canWallSlide);
      if (onFloor) {
        this.coyoteTime = this.COYOTE_MS;
      } else {
        this.coyoteTime = Math.max(0, this.coyoteTime - delta);
      }

      if (crateInteraction) {
        const moveSpeed =
          crateInteraction.mode === 'push' ? this.CRATE_PUSH_SPEED : this.CRATE_PULL_SPEED;
        this.activeCrateInteractionMode = crateInteraction.mode;
        this.activeCrateInteractionFacing = crateInteraction.facing;
        this.playerBody.setVelocityX(crateInteraction.moveDirectionX * moveSpeed);
        crateInteraction.crateBody.setVelocityX(crateInteraction.moveDirectionX * moveSpeed);
      } else {
        this.clearCrateInteractionState();
        if (this.time.now < this.weaponKnockbackUntil) {
          this.playerBody.setVelocityX(this.weaponKnockbackVelocityX);
        } else if (this.time.now < this.wallJumpLockUntil && this.wallJumpDirection !== 0) {
          this.playerBody.setVelocityX(this.wallJumpDirection * this.WALL_JUMP_VELOCITY_X);
        } else {
          this.weaponKnockbackVelocityX = 0;
          const moveSpeedBase = this.isCrouching ? this.CRAWL_SPEED : this.PLAYER_SPEED;
          const moveSpeed = inQuicksand ? moveSpeedBase * this.QUICKSAND_MOVE_FACTOR : moveSpeedBase;
          if (left) {
            this.playerBody.setVelocityX(-moveSpeed);
          } else if (right) {
            this.playerBody.setVelocityX(moveSpeed);
          } else {
            this.playerBody.setVelocityX(0);
          }
        }
      }

      const jumpPressed =
        !this.isCrouching && (spacePressed || (upPressed && overlappingLadder === null));

      if (jumpedOffLadder) {
        this.playerBody.setVelocityY(
          inQuicksand ? this.JUMP_VELOCITY * this.QUICKSAND_JUMP_FACTOR : this.JUMP_VELOCITY
        );
        this.fxController?.playJumpDustFx(
          this.player?.x ?? this.playerBody.center.x,
          this.playerBody.bottom,
          this.playerFacing
        );
        this.jumpBuffered = false;
        this.jumpBufferTime = 0;
        this.coyoteTime = 0;
        this.resetWallMovementState();
      } else {
        if (jumpPressed) {
          if (this.isWallSliding && this.wallContactSide !== 0) {
            const wallJumpSourceSide = this.wallContactSide;
            const wallJumpDirection = (wallJumpSourceSide === -1 ? 1 : -1) as -1 | 1;
            this.playerBody.setVelocityX(wallJumpDirection * this.WALL_JUMP_VELOCITY_X);
            this.playerBody.setVelocityY(this.WALL_JUMP_VELOCITY_Y);
            this.fxController?.playJumpDustFx(
              this.player?.x ?? this.playerBody.center.x,
              this.playerBody.bottom,
              this.playerFacing
            );
            this.jumpBuffered = false;
            this.jumpBufferTime = 0;
            this.coyoteTime = 0;
            this.clearWallSlideState();
            this.wallJumpLockUntil = this.time.now + this.WALL_JUMP_INPUT_LOCK_MS;
            this.wallJumpActive = true;
            this.wallJumpDirection = wallJumpDirection;
            this.wallJumpBlockedSide = wallJumpSourceSide;
          } else {
            this.jumpBuffered = true;
            this.jumpBufferTime = this.JUMP_BUFFER_MS;
          }
        }

        if (this.jumpBufferTime > 0) {
          this.jumpBufferTime -= delta;
          if (this.jumpBufferTime <= 0) {
            this.jumpBuffered = false;
          }
        }

        if (this.jumpBuffered && this.coyoteTime > 0) {
          this.playerBody.setVelocityY(
            inQuicksand ? this.JUMP_VELOCITY * this.QUICKSAND_JUMP_FACTOR : this.JUMP_VELOCITY
          );
          this.fxController?.playJumpDustFx(
            this.player?.x ?? this.playerBody.center.x,
            this.playerBody.bottom,
            this.playerFacing
          );
          this.jumpBuffered = false;
          this.jumpBufferTime = 0;
          this.coyoteTime = 0;
          this.wallJumpActive = false;
          this.wallJumpDirection = 0;
          this.wallJumpLockUntil = 0;
          this.wallJumpBlockedSide = 0;
        }

        const jumpHeld = upHeld || this.cursors.space!.isDown || touchInput.jumpHeld;
        if (
          !jumpHeld &&
          this.playerBody.velocity.y < 0 &&
          this.time.now >= this.externalLaunchGraceUntil
        ) {
          this.playerBody.setVelocityY(this.playerBody.velocity.y * (inQuicksand ? 0.84 : 0.85));
        }
      }

      if (this.isWallSliding && this.playerBody.velocity.y > this.WALL_SLIDE_MAX_FALL_SPEED) {
        this.playerBody.setVelocityY(this.WALL_SLIDE_MAX_FALL_SPEED);
      }

      if (inQuicksand && onFloor) {
        this.playerBody.setVelocityY(Math.max(this.playerBody.velocity.y, 4));
      }

      this.handleCombatInput({
        swordPressed,
        gunPressed,
        downHeld,
        grounded: onFloor,
      });
    }

    this.updateQuicksandVisualSink();
    this.updatePlayerProjectiles(delta);
    this.syncLadderClimbSfx(verticalInput);
    this.maybeRespawnFromVoid();
    this.maybeAdvancePlayerRoom();
    this.syncPlayerVisual();
    this.syncLocalPresence();
    this.updateGoalRun(delta);
    this.renderHud();
  }

  private resetRuntimeState(): void {
    if (this.backdropCamera && this.cameras.cameras.includes(this.backdropCamera)) {
      this.cameras.remove(this.backdropCamera, true);
    }

    this.worldStreamingController.reset();
    this.starfieldSprites = [];
    this.backdropCamera = null;
    this.mode = 'browse';
    this.cameraMode = 'inspect';
    this.selectedCoordinates = { ...DEFAULT_ROOM_COORDINATES };
    this.currentRoomCoordinates = { ...DEFAULT_ROOM_COORDINATES };
    this.windowCenterCoordinates = { ...DEFAULT_ROOM_COORDINATES };
    this.selectedSummary = null;
    this.inspectZoom = DEFAULT_ZOOM;
    this.browseInspectZoom = DEFAULT_ZOOM;
    this.transientStatusMessage = null;
    this.transientStatusExpiresAt = 0;
    this.quicksandTouchedUntil = 0;
    this.quicksandVisualSink = 0;
    this.quicksandStatusCooldownUntil = 0;
    this.inspectInputController.reset();
    this.coyoteTime = 0;
    this.jumpBuffered = false;
    this.jumpBufferTime = 0;
    this.resetWallMovementState();
    this.isClimbingLadder = false;
    this.activeLadderKey = null;
    this.isCrouching = false;
    this.clearCrateInteractionState();
    this.activeAttackAnimation = null;
    this.activeAttackAnimationUntil = 0;
    this.meleeCooldownUntil = 0;
    this.rangedCooldownUntil = 0;
    this.weaponKnockbackVelocityX = 0;
    this.weaponKnockbackUntil = 0;
    this.setLadderClimbSfxPlaying(false);
    this.destroyPlayerProjectiles();
    this.collectedObjectKeys = new Set();
    this.score = 0;
    this.goalRunController.reset();
    this.playerAnimationState = 'idle';
    this.playerFacing = 1;
    this.playerWasGrounded = false;
    this.playerLandAnimationUntil = 0;
    this.browseOverlayController.destroy();
    this.shouldCenterCamera = false;
    this.shouldRespawnPlayer = false;
    this.presenceController.reset();
    this.courseComposerOpen = false;
    this.courseComposerLoading = false;
    this.courseComposerRecord = null;
    this.courseComposerStatusText = null;
    this.courseComposerSelectedRoomEligible = false;
    this.courseComposerSelectedRoomInDraft = false;
    this.courseComposerSelectedRoomOrder = null;
    this.courseRoomMetaByRoomId.clear();
    this.coursePlaybackController.clearActiveCourseRoomOverrides();
    this.activeCourseRun = null;
    this.courseEditorReturnTarget = null;
    this.hudBridge?.destroy();
    this.hudBridge = null;
    this.fxController?.destroy();
    this.emitCourseComposerStateChanged();
  }

  private initializePresenceClient(): void {
    this.presenceController.initialize();
  }

  private setupGameplayKeys(): void {
    const keyboard = this.input.keyboard!;

    this.cursors = keyboard.createCursorKeys();
    this.wasd = {
      W: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.attackKeys = {
      Q: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
      E: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
    };
    this.cameraToggleKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.BACKTICK);
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
    this.worldStreamingController.updateFullRoomBackgrounds(this.cameras.main);

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

    ignoredObjects.push(...this.gridOverlayController.getBackdropIgnoredObjects());
    ignoredObjects.push(...this.roomCellController.getBackdropIgnoredObjects());
    if (this.loadingText) ignoredObjects.push(this.loadingText);
    if (this.zoomDebugGraphics) ignoredObjects.push(this.zoomDebugGraphics);
    if (this.zoomDebugText) ignoredObjects.push(this.zoomDebugText);
    ignoredObjects.push(...this.goalMarkerController.getBackdropIgnoredObjects());
    ignoredObjects.push(...this.browseOverlayController.getBackdropIgnoredObjects());
    if (this.player) ignoredObjects.push(this.player);
    if (this.playerSprite) ignoredObjects.push(this.playerSprite);
    for (const projectile of this.playerProjectiles) {
      ignoredObjects.push(projectile.rect);
    }

    for (const image of this.previewImages) {
      ignoredObjects.push(image);
    }

    for (const loadedRoom of this.loadedFullRoomsById.values()) {
      if (loadedRoom.backgroundColorRect) {
        ignoredObjects.push(loadedRoom.backgroundColorRect);
      }
      for (const backgroundSprite of loadedRoom.backgroundSprites) {
        ignoredObjects.push(backgroundSprite.sprite);
      }
      ignoredObjects.push(loadedRoom.image, loadedRoom.terrainLayer);
      if (loadedRoom.foregroundImage) {
        ignoredObjects.push(loadedRoom.foregroundImage);
      }
      for (const liveObject of loadedRoom.liveObjects) {
        ignoredObjects.push(liveObject.sprite);
      }
      for (const wall of loadedRoom.edgeWalls) {
        ignoredObjects.push(wall.rect);
      }
    }

    ignoredObjects.push(...this.presenceController.getBackdropIgnoredObjects());
    ignoredObjects.push(...this.presenceOverlayController.getBackdropIgnoredObjects());
    ignoredObjects.push(...(this.fxController?.getBackdropIgnoredObjects() ?? []));

    this.backdropCamera.ignore(ignoredObjects);
  }

  private selectRoomCoordinates(coordinates: RoomCoordinates): void {
    this.selectionController.selectRoomCoordinates(coordinates);
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
      this.refreshChunkWindowIfNeeded(this.getZoomFocusCoordinates());
    } else {
      this.constrainInspectCamera();
    }
    this.gridOverlayController.redraw();
    this.renderHud();
  }

  private handleWake = (_sys: Phaser.Scenes.Systems, data?: OverworldPlaySceneData): void => {
    void this.handleWakeAsync(data);
  };
  private readonly handleAuthStateChanged = (): void => {
    const identityChanged = this.presenceController.refreshIdentity();
    if (identityChanged) {
      if (this.loadedChunkBounds) {
        this.presenceController.setSubscribedChunkBounds(this.loadedChunkBounds);
      }
      this.syncLocalPresence();
    }
    this.renderHud();
  };

  private async handleWakeAsync(data?: OverworldPlaySceneData): Promise<void> {
    this.applySceneData(data);
    if (data?.courseEditorNavigateOffset) {
      await this.continueCourseEditorNavigation(data.courseEditorNavigateOffset);
      return;
    }
    if (data?.courseDraftPreviewId) {
      const draft = getActiveCourseDraftSessionDraft();
      if (draft?.id === data.courseDraftPreviewId && draft.goal) {
        await this.coursePlaybackController.activateDraftCoursePreview(draft, data.draftRoom ?? null);
      }
    }
    this.syncAppMode();
    if (data?.forceRefreshAround) {
      this.worldStreamingController.reset();
      this.updateSelectedSummary();
      this.renderHud();
      await this.refreshAround(this.windowCenterCoordinates, {
        forceChunkReload: true,
      });
      return;
    }

    this.updateSelectedSummary();
    this.redrawWorld();
    this.renderHud();
    await this.refreshAround(this.windowCenterCoordinates, {
      forceChunkReload: data?.forceRefreshAround ?? false,
    });
  }

  private showTransientStatus(message: string): void {
    this.transientStatusMessage = message;
    this.transientStatusExpiresAt = this.time.now + 4200;
  }

  private applyCourseEditedRoomReturn(
    courseEditedRoom: CourseEditedRoomData,
    draftRoom: RoomSnapshot | null,
    publishedRoom: RoomSnapshot | null
  ): void {
    if (getActiveCourseDraftSessionCourseId() !== courseEditedRoom.courseId) {
      return;
    }

    const currentDraft = getActiveCourseDraftSessionDraft();
    const currentRoomRef =
      currentDraft?.roomRefs.find((roomRef) => roomRef.roomId === courseEditedRoom.roomId) ?? null;
    if (!currentRoomRef) {
      return;
    }

    setActiveCourseDraftSessionSelectedRoom(courseEditedRoom.roomId);

    const nextDraftRoom =
      draftRoom?.id === courseEditedRoom.roomId ? cloneRoomSnapshot(draftRoom) : null;
    const nextPublishedRoom =
      publishedRoom?.id === courseEditedRoom.roomId ? cloneRoomSnapshot(publishedRoom) : null;

    if (nextPublishedRoom) {
      clearActiveCourseDraftSessionRoomOverride(courseEditedRoom.roomId);
    } else if (nextDraftRoom) {
      setActiveCourseDraftSessionRoomOverride(nextDraftRoom);
    }

    const nextTitle = (nextPublishedRoom ?? nextDraftRoom)?.title ?? currentRoomRef.roomTitle ?? null;
    const nextVersion = nextPublishedRoom?.version ?? currentRoomRef.roomVersion;
    if (currentRoomRef.roomTitle === nextTitle && currentRoomRef.roomVersion === nextVersion) {
      return;
    }

    updateActiveCourseDraftSession((draft) => {
      const roomRef = draft.roomRefs.find((entry) => entry.roomId === courseEditedRoom.roomId);
      if (!roomRef) {
        return;
      }

      roomRef.roomTitle = nextTitle;
      if (nextPublishedRoom) {
        roomRef.roomVersion = nextPublishedRoom.version;
      }
    });
  }

  private touchQuicksand(): void {
    this.quicksandTouchedUntil = Math.max(
      this.quicksandTouchedUntil,
      this.time.now + this.QUICKSAND_ACTIVE_BUFFER_MS
    );
    if (this.time.now >= this.quicksandStatusCooldownUntil) {
      this.quicksandStatusCooldownUntil = this.time.now + 2400;
      this.showTransientStatus('Quicksand drags you down.');
    }
  }

  private isPlayerInQuicksand(): boolean {
    return this.time.now < this.quicksandTouchedUntil;
  }

  private updateQuicksandVisualSink(): void {
    const target = this.isPlayerInQuicksand() ? this.QUICKSAND_VISUAL_SINK_MAX : 0;
    const lerp = this.isPlayerInQuicksand() ? 0.24 : 0.18;
    this.quicksandVisualSink = Phaser.Math.Linear(this.quicksandVisualSink, target, lerp);
    if (Math.abs(this.quicksandVisualSink - target) < 0.08) {
      this.quicksandVisualSink = target;
    }
  }

  private applySceneData(data?: OverworldPlaySceneData): void {
    const fallback = data?.centerCoordinates ?? data?.roomCoordinates ?? getFocusedCoordinatesFromUrl();
    const wasPlaying = this.mode === 'play';

    if (data?.clearDraftRoomId || data?.draftRoom || data?.publishedRoom || data?.invalidateRoomId) {
      this.worldStreamingController.applyOptimisticMutation({
        clearDraftRoomId: data.clearDraftRoomId ?? null,
        draftRoom: data.draftRoom ? cloneRoomSnapshot(data.draftRoom) : null,
        publishedRoom: data.publishedRoom ? cloneRoomSnapshot(data.publishedRoom) : null,
        invalidateRoomId: data.invalidateRoomId ?? null,
      });
    }

    if (data?.courseEditedRoom) {
      this.applyCourseEditedRoomReturn(
        data.courseEditedRoom,
        data.draftRoom ? cloneRoomSnapshot(data.draftRoom) : null,
        data.publishedRoom ? cloneRoomSnapshot(data.publishedRoom) : null
      );
    }

    if (data?.statusMessage) {
      this.showTransientStatus(data.statusMessage);
    }

    if (data?.courseEditorReturnTarget !== undefined) {
      this.courseEditorReturnTarget = data.courseEditorReturnTarget ?? null;
    }

    this.syncCourseComposerRecordFromSession();
    if (data?.courseEditorReturned && this.courseComposerRecord) {
      this.courseComposerStatusText = 'Course draft updated.';
      void this.refreshCourseComposerSelectedRoomState();
      this.emitCourseComposerStateChanged();
    }

    if (data?.mode) {
      if (data.mode === 'play') {
        if (!wasPlaying) {
          this.browseInspectZoom = this.inspectZoom;
        }
        this.resetPlaySession();
        this.cameraMode = 'follow';
      }
      this.mode = data.mode;
      this.syncAppMode();
    }

    const focusCoordinates = data?.roomCoordinates ?? data?.draftRoom?.coordinates ?? fallback;
    const centerCoordinates = data?.centerCoordinates ?? focusCoordinates;

    this.selectedCoordinates = { ...focusCoordinates };
    this.currentRoomCoordinates = { ...focusCoordinates };
    this.windowCenterCoordinates = { ...centerCoordinates };
    this.shouldCenterCamera = true;
    this.shouldRespawnPlayer = this.mode === 'play';

    if (this.mode === 'play') {
      this.inspectZoom = this.getFitZoomForRoom();
    } else {
      this.cameraMode = 'inspect';
      this.inspectZoom = this.browseInspectZoom;
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
    await this.selectionController.jumpToCoordinates(coordinates);
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
    if (this.mode === 'browse') {
      this.browseInspectZoom = this.inspectZoom;
    }
    camera.setZoom(this.inspectZoom);
    this.centerCameraOnCoordinates(this.getZoomFocusCoordinates());
    this.refreshChunkWindowIfNeeded(this.getZoomFocusCoordinates());
    this.updateBackdrop();
    this.gridOverlayController.redraw();
    this.renderHud();
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
    if (this.mode === 'browse') {
      this.browseInspectZoom = this.inspectZoom;
    }
    camera.setZoom(this.inspectZoom);

    if (this.mode === 'play' && this.cameraMode === 'follow' && this.player) {
      this.startFollowCamera(camera);
    } else {
      const nextScroll = this.getScrollForScreenAnchor(anchorWorldPoint.x, anchorWorldPoint.y, anchorX, anchorY, camera);
      camera.setScroll(nextScroll.x, nextScroll.y);
      this.constrainInspectCamera();
    }

    this.refreshChunkWindowIfNeeded(this.getZoomFocusCoordinates());
    this.updateBackdrop();
    this.gridOverlayController.redraw();
    this.renderHud();
  }

  private getScreenAnchorWorldPoint(
    screenX: number,
    screenY: number,
    camera: Phaser.Cameras.Scene2D.Camera
  ): Phaser.Math.Vector2 {
    return calculateScreenAnchorWorldPoint(screenX, screenY, camera);
  }

  private getScrollForScreenAnchor(
    worldX: number,
    worldY: number,
    screenX: number,
    screenY: number,
    camera: Phaser.Cameras.Scene2D.Camera
  ): Phaser.Math.Vector2 {
    return calculateScrollForScreenAnchor(worldX, worldY, screenX, screenY, camera);
  }

  private getZoomFocusCoordinates(): RoomCoordinates {
    if (this.mode === 'play') {
      return this.currentRoomCoordinates;
    }

    return this.selectedCoordinates;
  }

  private async refreshAround(
    centerCoordinates: RoomCoordinates,
    options: { forceChunkReload?: boolean } = {}
  ): Promise<boolean> {
    this.windowCenterCoordinates = { ...centerCoordinates };
    this.renderHud('Loading world...');
    if (!isAppReady()) {
      setBootProgress(1);
      setBootStatus('Loading world...');
    }

    const refreshed = await this.worldStreamingController.refreshAround(centerCoordinates, options);
    const sceneAvailable =
      this.scene.isActive(this.scene.key) ||
      this.scene.isPaused(this.scene.key);
    if (refreshed === 'success') {
      if (!sceneAvailable) {
        return true;
      }

      this.updateSelectedSummary();
      void this.refreshLeaderboardForSelection();
      this.updateCameraBounds();
      this.syncModeRuntime();
      this.syncPreviewVisibility();
      this.syncPresenceSubscriptions();
      this.syncGhostVisibility();
      this.redrawWorld();
      this.renderHud();
      this.loadingText.setVisible(false);
      this.nextVisibleChunkRefreshAt = this.time.now + this.getVisibleChunkRefreshIntervalMs();
      if (!isAppReady()) {
        markAppReady();
      }
      hideBusyOverlay();
      return true;
    }

    if (refreshed === 'cancelled') {
      return false;
    }

    if (!sceneAvailable) {
      return false;
    }

    console.error('Failed to load overworld window');
    const retry = async (): Promise<void> => {
      if (!isAppReady()) {
        setBootProgress(1);
        setBootStatus('Retrying world...');
      } else {
        showBusyOverlay('Retrying world...', 'Loading world...');
      }
      await this.refreshAround(centerCoordinates, { forceChunkReload: true });
    };

    if (!isAppReady()) {
      showBootFailure('Failed to load world. Check your connection and retry.', retry);
    } else if (isBusyOverlayVisible()) {
      showBusyError('Failed to load world. Check your connection and try again.', {
        retryHandler: retry,
      });
    } else {
      this.renderHud('Failed to load world.');
    }

    return false;
  }

  private refreshChunkWindowIfNeeded(centerCoordinates: RoomCoordinates): void {
    if (this.worldStreamingController.needsRefreshAround(centerCoordinates)) {
      void this.refreshAround(centerCoordinates);
      return;
    }

    this.worldStreamingController.refreshVisibleSelectionFromCache();
    this.syncPreviewVisibility();
  }

  private maybeRefreshVisibleChunks(): void {
    if (this.visibleChunkRefreshInFlight) {
      return;
    }

    const now = this.time.now;
    if (now < this.nextVisibleChunkRefreshAt) {
      return;
    }

    const centerCoordinates = this.getZoomFocusCoordinates();
    if (this.worldStreamingController.needsRefreshAround(centerCoordinates)) {
      return;
    }

    this.visibleChunkRefreshInFlight = true;
    void this.worldStreamingController.refreshLoadedChunksIfChanged(centerCoordinates)
      .then((result) => {
        if (result !== 'updated') {
          return;
        }

        this.updateSelectedSummary();
        void this.refreshLeaderboardForSelection();
        this.syncModeRuntime();
        this.syncPreviewVisibility();
        this.syncPresenceSubscriptions();
        this.syncGhostVisibility();
        this.redrawWorld();
        this.renderHud();
      })
      .finally(() => {
        this.visibleChunkRefreshInFlight = false;
        this.nextVisibleChunkRefreshAt = this.time.now + this.getVisibleChunkRefreshIntervalMs();
      });
  }

  private getVisibleChunkRefreshIntervalMs(): number {
    return this.mode === 'browse'
      ? BROWSE_VISIBLE_CHUNK_REFRESH_INTERVAL_MS
      : PLAY_VISIBLE_CHUNK_REFRESH_INTERVAL_MS;
  }

  private syncPresenceSubscriptions(): void {
    this.presenceController.setSubscribedChunkBounds(this.loadedChunkBounds);
  }

  private syncLocalPresence(): void {
    if (!this.player || !this.playerBody || this.mode !== 'play') {
      this.presenceController.updateLocalPresence(null);
      return;
    }

    this.presenceController.updateLocalPresence({
      mode: this.mode,
      roomCoordinates: { ...this.currentRoomCoordinates },
      x: this.player.x,
      y: this.playerBody.bottom + DEFAULT_PLAYER_VISUAL_FEET_OFFSET,
      velocityX: this.playerBody.velocity.x,
      velocityY: this.playerBody.velocity.y,
      facing: this.playerFacing,
      animationState: this.playerAnimationState,
    });
  }

  private updateGhosts(delta: number): void {
    this.presenceController.updateGhosts(delta);
  }

  private syncGhostVisibility(): void {
    this.presenceController.refreshGhostVisibility();
  }

  private getRoomPopulation(coordinates: RoomCoordinates): number {
    return this.presenceController.getRoomPopulation(coordinates);
  }

  private getRoomEditorCount(coordinates: RoomCoordinates): number {
    return this.presenceController.getRoomEditorCount(coordinates);
  }

  private getRoomEditorDisplayNames(coordinates: RoomCoordinates): string[] {
    return this.presenceController.getRoomEditorDisplayNames(coordinates);
  }

  private destroyEdgeWalls(loadedRoom: SceneLoadedFullRoom): void {
    for (const wall of loadedRoom.edgeWalls) {
      wall.collider.destroy();
      wall.rect.destroy();
    }
    loadedRoom.edgeWalls = [];
  }

  private createLiveObjects(loadedRoom: SceneLoadedFullRoom): void {
    this.liveObjectController.createLiveObjects(loadedRoom);
  }

  private destroyLiveObjects(loadedRoom: SceneLoadedFullRoom): void {
    this.liveObjectController.destroyLiveObjects(loadedRoom);
  }

  private updateLiveObjects(delta: number): void {
    if (this.mode !== 'play') {
      return;
    }

    this.liveObjectController.updateLiveObjects(this.loadedFullRoomsById.values(), delta);
  }

  private syncPreviewVisibility(): void {
    this.worldStreamingController.syncPreviewVisibility();
  }

  private syncModeRuntime(): void {
    if (this.mode === 'browse') {
      this.syncAppMode();
      this.destroyPlayer();
      this.cameraMode = 'inspect';
      this.goalRunController.clearCurrentRun();
      this.redrawGoalMarkers();
      this.syncCameraBoundsUsage();
      this.syncEdgeWalls();
      if (this.shouldCenterCamera) {
        this.centerCameraOnCoordinates(this.selectedCoordinates);
        this.shouldCenterCamera = false;
      } else {
        this.constrainInspectCamera();
      }
      this.syncGhostVisibility();
      return;
    }

    const currentRoom = this.getRoomSnapshotForCoordinates(this.currentRoomCoordinates);
    if (!currentRoom) {
      this.mode = 'browse';
      this.cameraMode = 'inspect';
      this.syncAppMode();
      this.syncCameraBoundsUsage();
      this.applyGoalRunMutation(this.goalRunController.syncRunForRoom(null));
      this.destroyPlayer();
      this.syncGhostVisibility();
      return;
    }

    if (!this.player || this.shouldRespawnPlayer) {
      this.destroyPlayer();
      this.createPlayer(currentRoom);
      this.shouldRespawnPlayer = false;
    }

    if (this.activeCourseRun) {
      this.goalRunController.clearCurrentRun();
      this.redrawGoalMarkers();
    } else {
      this.applyGoalRunMutation(this.goalRunController.syncRunForRoom(currentRoom, 'spawn'));
    }

    this.syncFullRoomColliders();
    this.syncLiveObjectInteractions();
    this.syncEdgeWalls();
    this.applyCameraMode(this.shouldCenterCamera);
    this.shouldCenterCamera = false;
    this.syncGhostVisibility();
  }

  private countRoomObjectsByCategory(room: RoomSnapshot, category: GameObjectConfig['category']): number {
    let count = 0;

    for (const placedObject of room.placedObjects) {
      if (placedObjectContributesToCategory(placedObject, category)) {
        count += 1;
      }
    }

    return count;
  }

  private async refreshLeaderboardForSelection(): Promise<void> {
    if (this.activeCourseRun) {
      return;
    }

    const targetRoom =
      this.mode === 'play'
        ? this.getRoomSnapshotForCoordinates(this.currentRoomCoordinates)
        : this.getRoomSnapshotForCoordinates(this.selectedCoordinates);
    await this.goalRunController.refreshLeaderboardsForRoom(targetRoom);
  }

  private redrawGoalMarkers(): void {
    this.goalMarkerController.redrawMarkers(this.currentGoalRun, this.activeCourseRun);
    this.syncBackdropCameraIgnores();
  }

  private emitCourseComposerStateChanged(): void {
    window.dispatchEvent(new CustomEvent(COURSE_COMPOSER_STATE_CHANGED_EVENT));
  }

  private getCourseGoalTypeBadgeLabel(goalType: CourseGoalType | null): string {
    return (goalType ? COURSE_GOAL_LABELS[goalType] : 'Goal Missing').toUpperCase();
  }

  private getCourseGoalSummaryText(goalType: CourseGoalType | null): string {
    return goalType ? `${COURSE_GOAL_LABELS[goalType]} course` : 'Course objective missing';
  }


  private toWorldGoalPoint(
    roomCoordinates: RoomCoordinates,
    point: GoalMarkerPoint
  ): GoalMarkerPoint {
    return this.goalMarkerController.toWorldGoalPoint(roomCoordinates, point);
  }

  private toWorldCoursePoint(point: CourseMarkerPoint): GoalMarkerPoint {
    return this.goalMarkerController.toWorldCoursePoint(point);
  }

  private destroyPlayer(): void {
    this.destroyPlayerProjectiles();
    for (const loadedRoom of this.loadedFullRoomsById.values()) {
      loadedRoom.terrainCollider?.destroy();
      loadedRoom.terrainCollider = null;
      loadedRoom.terrainInsetCollider?.destroy();
      loadedRoom.terrainInsetCollider = null;
      this.liveObjectController.clearRoomInteractions(loadedRoom);
      this.destroyEdgeWalls(loadedRoom);
    }

    this.isClimbingLadder = false;
    this.activeLadderKey = null;
    this.setLadderClimbSfxPlaying(false);
    this.isCrouching = false;
    this.resetWallMovementState();
    this.activeAttackAnimation = null;
    this.activeAttackAnimationUntil = 0;
    this.playerLandAnimationUntil = 0;
    this.playerWasGrounded = false;
    this.externalLaunchGraceUntil = 0;
    this.playerBody?.destroy();
    this.playerBody = null;
    this.playerPickupSensorBody?.destroy();
    this.playerPickupSensorBody = null;
    this.playerPickupSensor?.destroy();
    this.playerPickupSensor = null;
    this.playerSprite?.destroy();
    this.playerSprite = null;
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
      if (loadedRoom.terrainInsetBodies && !loadedRoom.terrainInsetCollider) {
        loadedRoom.terrainInsetCollider = this.physics.add.collider(
          this.player,
          loadedRoom.terrainInsetBodies
        );
      }
    }
  }

  private syncLiveObjectInteractions(): void {
    this.liveObjectController.syncLiveObjectInteractions(this.loadedFullRoomsById.values());
  }

  private syncEdgeWalls(): void {
    for (const loadedRoom of this.loadedFullRoomsById.values()) {
      this.destroyEdgeWalls(loadedRoom);

      if (!this.playerBody || this.mode !== 'play') {
        continue;
      }

      for (const neighbor of getOrthogonalNeighbors(loadedRoom.room.coordinates)) {
        if (this.isNeighborReachableInCurrentPlayMode(loadedRoom.room.coordinates, neighbor)) {
          continue;
        }

        const edgeWall = this.createEdgeWall(loadedRoom.room.coordinates, neighbor);
        if (edgeWall) {
          loadedRoom.edgeWalls.push(edgeWall);
        }
      }
    }
  }

  private isNeighborReachableInCurrentPlayMode(
    roomCoordinates: RoomCoordinates,
    neighborCoordinates: RoomCoordinates
  ): boolean {
    if (this.activeCourseSnapshot) {
      const deltaX = Math.abs(neighborCoordinates.x - roomCoordinates.x);
      const deltaY = Math.abs(neighborCoordinates.y - roomCoordinates.y);
      if (deltaX + deltaY !== 1) {
        return false;
      }

      const currentRoomId = roomIdFromCoordinates(roomCoordinates);
      const neighborRoomId = roomIdFromCoordinates(neighborCoordinates);
      const currentInCourse = this.activeCourseSnapshot.roomRefs.some(
        (roomRef) => roomRef.roomId === currentRoomId
      );
      const neighborInCourse = this.activeCourseSnapshot.roomRefs.some(
        (roomRef) => roomRef.roomId === neighborRoomId
      );
      return currentInCourse && neighborInCourse;
    }

    const neighborState = this.getCellStateAt(neighborCoordinates);
    return neighborState === 'published' || neighborState === 'draft';
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
    this.roomCellController.redraw();

    if (!this.worldWindow) {
      this.browseOverlayController.redrawBrowseOverlays();
      this.presenceOverlayController.destroy();
      return;
    }

    this.browseOverlayController.redrawBrowseOverlays();
    this.presenceOverlayController.syncOverlays();
    this.syncBackdropCameraIgnores();
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
    this.renderHud();
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
      this.startFollowCamera(camera);
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

  private startFollowCamera(camera: Phaser.Cameras.Scene2D.Camera): void {
    if (!this.player) {
      return;
    }

    camera.startFollow(
      this.player,
      true,
      FOLLOW_CAMERA_LERP,
      FOLLOW_CAMERA_LERP,
      0,
      this.getMobilePlayFollowOffsetY(camera)
    );
  }

  private getMobilePlayFollowOffsetY(camera: Phaser.Cameras.Scene2D.Camera): number {
    return calculateMobilePlayFollowOffsetY(
      camera,
      getDeviceLayoutState(),
      MOBILE_PLAY_CAMERA_TARGET_Y,
    );
  }

  private constrainInspectCamera(): void {
    if (!this.worldWindow) return;
    constrainInspectCamera(this.cameras.main);
  }

  private getFitZoomForRoom(): number {
    return calculateFitZoomForRoom(
      this.scale.width,
      this.scale.height,
      ROOM_PX_WIDTH,
      ROOM_PX_HEIGHT,
      PLAY_ROOM_FIT_PADDING,
      MIN_ZOOM,
      MAX_ZOOM,
    );
  }

  private createPlayer(startRoom: RoomSnapshot): void {
    const spawn = this.getPlayerSpawn(startRoom);

    this.player = this.add.rectangle(
      spawn.x,
      spawn.y,
      this.PLAYER_WIDTH,
      this.PLAYER_HEIGHT,
      RETRO_COLORS.draft
    );
    this.player.setVisible(false);
    this.player.setDepth(25);

    this.physics.add.existing(this.player);
    this.playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    this.playerBody.setCollideWorldBounds(false);
    this.playerBody.setMaxVelocityY(500);
    this.playerBody.setAllowGravity(true);
    this.playerPickupSensor = this.add.rectangle(
      spawn.x,
      spawn.y,
      this.PLAYER_WIDTH,
      this.PLAYER_HEIGHT + this.PLAYER_PICKUP_SENSOR_EXTRA_HEIGHT,
      RETRO_COLORS.draft
    );
    this.playerPickupSensor.setVisible(false);
    this.physics.add.existing(this.playerPickupSensor);
    this.playerPickupSensorBody = this.playerPickupSensor.body as Phaser.Physics.Arcade.Body;
    this.playerPickupSensorBody.setAllowGravity(false);
    this.playerPickupSensorBody.setImmovable(true);
    this.playerPickupSensorBody.moves = false;
    this.externalLaunchGraceUntil = 0;
    this.isCrouching = false;
    this.resetWallMovementState();
    this.syncPlayerHitbox();
    this.playerSprite = this.add.sprite(
      spawn.x,
      spawn.y,
      DEFAULT_PLAYER_IDLE_TEXTURE_KEY,
      DEFAULT_PLAYER_IDLE_FRAME
    );
    this.playerSprite.setOrigin(0.5, 1);
    this.playerSprite.setDepth(26);
    this.playerSprite.play(DEFAULT_PLAYER_ANIMATION_KEYS.idle);
    this.playerSprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.playerAnimationState = 'idle';
    this.playerFacing = 1;
    this.playerWasGrounded = true;
    this.playerLandAnimationUntil = 0;
    this.activeAttackAnimation = null;
    this.activeAttackAnimationUntil = 0;
    this.isClimbingLadder = false;
    this.activeLadderKey = null;
    this.setLadderClimbSfxPlaying(false);
    this.syncPlayerVisual();
    this.syncBackdropCameraIgnores();
  }

  private resetWallMovementState(): void {
    this.clearWallSlideState();
    this.wallJumpLockUntil = 0;
    this.wallJumpActive = false;
    this.wallJumpDirection = 0;
    this.wallJumpBlockedSide = 0;
  }

  private clearWallSlideState(): void {
    this.wallContactSide = 0;
    this.isWallSliding = false;
  }

  private getWallContactSide(horizontalInput: number): -1 | 1 | 0 {
    if (!this.playerBody || horizontalInput === 0) {
      return 0;
    }

    const touchingLeft = this.playerBody.blocked.left || this.playerBody.touching.left;
    const touchingRight = this.playerBody.blocked.right || this.playerBody.touching.right;
    if (horizontalInput < 0 && touchingLeft) {
      return -1;
    }
    if (horizontalInput > 0 && touchingRight) {
      return 1;
    }

    return 0;
  }

  private updateWallMovementState(horizontalInput: number, onFloor: boolean, canWallSlide: boolean): void {
    if (!this.playerBody || onFloor || this.isClimbingLadder) {
      this.resetWallMovementState();
      return;
    }

    if (this.wallJumpActive && this.playerBody.velocity.y >= 0) {
      this.wallJumpActive = false;
      this.wallJumpDirection = 0;
    }

    const rawWallContactSide = canWallSlide ? this.getWallContactSide(horizontalInput) : 0;
    if (
      rawWallContactSide !== 0 &&
      this.wallJumpBlockedSide !== 0 &&
      rawWallContactSide !== this.wallJumpBlockedSide
    ) {
      this.wallJumpBlockedSide = 0;
    }

    const wallContactSide =
      rawWallContactSide !== 0 && rawWallContactSide === this.wallJumpBlockedSide
        ? 0
        : rawWallContactSide;
    this.wallContactSide = wallContactSide;
    this.isWallSliding = wallContactSide !== 0;

    if (this.isWallSliding) {
      this.wallJumpActive = false;
      this.wallJumpDirection = 0;
    } else if (!this.wallJumpActive && this.time.now >= this.wallJumpLockUntil) {
      this.wallJumpDirection = 0;
    }
  }

  private findOverlappingLadder(): LoadedRoomObject | null {
    return this.liveObjectController.findOverlappingLadder(this.loadedFullRoomsById.values());
  }

  private isLadderDropRequested(): boolean {
    const touchInput = getTouchInputState();
    return (
      this.cursors.down.isDown ||
      this.wasd.S.isDown ||
      (touchInput.active && touchInput.moveY >= 0.42)
    );
  }

  private setPlayerLadderState(ladder: LoadedRoomObject | null): void {
    if (!this.playerBody) {
      this.isClimbingLadder = false;
      this.activeLadderKey = null;
      this.resetWallMovementState();
      this.setLadderClimbSfxPlaying(false);
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
    if (!ladder) {
      this.setLadderClimbSfxPlaying(false);
    } else {
      this.resetWallMovementState();
    }

    if (enteringLadder) {
      this.playerBody.setVelocityY(0);
    }
  }

  private syncPlayerHitbox(): void {
    if (!this.playerBody) {
      return;
    }

    const nextHeight = this.isCrouching ? this.PLAYER_CROUCH_HEIGHT : this.PLAYER_HEIGHT;
    if (this.playerBody.height !== nextHeight) {
      this.playerBody.setSize(this.PLAYER_WIDTH, nextHeight, false);
      this.playerBody.setOffset(0, this.PLAYER_HEIGHT - nextHeight);
    }
    this.syncPlayerPickupSensor();
  }

  private clearCrateInteractionState(): void {
    this.activeCrateInteractionMode = null;
    this.activeCrateInteractionFacing = null;
  }

  private applyWeaponKnockback(velocityX: number): void {
    if (!this.playerBody) {
      return;
    }

    this.weaponKnockbackVelocityX = velocityX;
    this.weaponKnockbackUntil = this.time.now + this.WEAPON_KNOCKBACK_MS;
    this.playerBody.setVelocityX(velocityX);
  }

  private canPlayerStandUp(): boolean {
    if (!this.playerBody) {
      return true;
    }

    const room = this.getRoomSnapshotForCoordinates(this.currentRoomCoordinates);
    if (!room) {
      return true;
    }

    const topY = this.playerBody.bottom - this.PLAYER_HEIGHT;
    const sampleXs = [
      this.playerBody.center.x,
      this.playerBody.left + 1,
      this.playerBody.right - 1,
    ];

    return sampleXs.every((sampleX) => !this.isSolidTerrainAtWorldPoint(room, sampleX, topY + 1));
  }

  private findCrateInteraction(horizontalInput: number, downHeld: boolean): CrateInteraction | null {
    if (!this.playerBody || horizontalInput === 0) {
      return null;
    }

    const moveDirectionX = horizontalInput > 0 ? 1 : -1;
    const playerBounds = this.getArcadeBodyBounds(this.playerBody);
    let bestInteraction: CrateInteraction | null = null;
    let bestGap = Number.POSITIVE_INFINITY;

    for (const loadedRoom of this.loadedFullRoomsById.values()) {
      for (const liveObject of loadedRoom.liveObjects) {
        if (
          liveObject.config.id !== 'crate' ||
          !liveObject.sprite.active ||
          !isDynamicArcadeBody(liveObject.sprite.body as ArcadeObjectBody | null)
        ) {
          continue;
        }

        const crateBody = liveObject.sprite.body as Phaser.Physics.Arcade.Body;
        const crateBounds = this.getArcadeBodyBounds(crateBody);
        const verticalOverlap =
          Math.min(playerBounds.bottom, crateBounds.bottom) -
          Math.max(playerBounds.top, crateBounds.top);
        if (verticalOverlap < Math.min(8, playerBounds.height * 0.5)) {
          continue;
        }

        let mode: 'push' | 'pull' | null = null;
        let gap = Number.POSITIVE_INFINITY;
        let facing: -1 | 1 = moveDirectionX;

        if (moveDirectionX > 0) {
          const pushGap = crateBounds.left - playerBounds.right;
          const pullGap = playerBounds.left - crateBounds.right;
          if (pushGap >= -6 && pushGap <= this.CRATE_INTERACTION_MAX_GAP) {
            mode = 'push';
            gap = Math.abs(pushGap);
            facing = 1;
          } else if (downHeld && pullGap >= -6 && pullGap <= this.CRATE_INTERACTION_MAX_GAP) {
            mode = 'pull';
            gap = Math.abs(pullGap);
            facing = -1;
          }
        } else {
          const pushGap = playerBounds.left - crateBounds.right;
          const pullGap = crateBounds.left - playerBounds.right;
          if (pushGap >= -6 && pushGap <= this.CRATE_INTERACTION_MAX_GAP) {
            mode = 'push';
            gap = Math.abs(pushGap);
            facing = -1;
          } else if (downHeld && pullGap >= -6 && pullGap <= this.CRATE_INTERACTION_MAX_GAP) {
            mode = 'pull';
            gap = Math.abs(pullGap);
            facing = 1;
          }
        }

        if (!mode || gap >= bestGap) {
          continue;
        }

        bestGap = gap;
        bestInteraction = {
          crateBody,
          mode,
          moveDirectionX,
          facing,
        };
      }
    }

    return bestInteraction;
  }

  private handleCombatInput(input: {
    swordPressed: boolean;
    gunPressed: boolean;
    downHeld: boolean;
    grounded: boolean;
  }): void {
    if (!this.player || !this.playerBody) {
      return;
    }

    if (input.swordPressed && this.time.now >= this.meleeCooldownUntil) {
      this.performSwordAttack(input.downHeld, input.grounded);
      return;
    }

    if (input.gunPressed && this.time.now >= this.rangedCooldownUntil) {
      this.fireGunProjectile();
    }
  }

  private performSwordAttack(downHeld: boolean, grounded: boolean): void {
    if (!this.player || !this.playerBody) {
      return;
    }

    const downward = !grounded && downHeld;
    const attackAnimation: DefaultPlayerAnimationState = downward ? 'air-slash-down' : 'sword-slash';
    this.activeAttackAnimation = attackAnimation;
    this.activeAttackAnimationUntil = this.time.now + this.SWORD_ATTACK_MS;
    this.meleeCooldownUntil = this.time.now + this.SWORD_COOLDOWN_MS;

    if (downward && this.playerBody.velocity.y < 120) {
      this.playerBody.setVelocityY(120);
    }

    const attackRect = downward
      ? new Phaser.Geom.Rectangle(
          this.playerBody.center.x - 12,
          this.playerBody.bottom - 2,
          24,
          28
        )
      : new Phaser.Geom.Rectangle(
          this.playerBody.center.x + this.playerFacing * 8 - 14,
          this.playerBody.top + 2,
          28,
          this.playerBody.height + 10
        );

    const hits = this.liveObjectController.attackEnemiesInRect(
      this.loadedFullRoomsById.values(),
      attackRect,
      3
    );
    this.fxController?.playSwordSlashFx(
      this.player.x,
      downward ? this.playerBody.bottom - 2 : this.playerBody.center.y,
      this.playerFacing,
      downward
    );
    if (hits.length > 0) {
      playSfx('enemy-hit');
      if (downward) {
        this.playerBody.setVelocityY(this.DOWNWARD_SLASH_BOUNCE_VELOCITY);
      } else {
        this.applyWeaponKnockback(
          Phaser.Math.Clamp(
            this.playerBody.velocity.x + this.playerFacing * this.SWORD_HIT_LUNGE_VELOCITY,
            -this.PLAYER_SPEED * 1.35,
            this.PLAYER_SPEED * 1.35
          )
        );
      }
      this.cameras.main.shake(50, 0.002);
    }
  }

  private fireGunProjectile(): void {
    if (!this.player || !this.playerBody) {
      return;
    }

    this.activeAttackAnimation = 'gun-fire';
    this.activeAttackAnimationUntil = this.time.now + this.GUN_ATTACK_MS;
    this.rangedCooldownUntil = this.time.now + this.GUN_COOLDOWN_MS;

    const muzzleX = this.player.x + this.playerFacing * 10;
    const muzzleY = this.playerBody.center.y - (this.isCrouching ? 1 : 5);
    this.fxController?.playMuzzleFlashFx(muzzleX, muzzleY, this.playerFacing);

    const projectile = this.add.rectangle(muzzleX, muzzleY, 8, 3, 0x9deaff, 1);
    projectile.setDepth(27);
    this.playerProjectiles.push({
      rect: projectile,
      directionX: this.playerFacing,
      speed: this.PROJECTILE_SPEED,
      expiresAt: this.time.now + this.PROJECTILE_LIFETIME_MS,
    });
    this.applyWeaponKnockback(
      Phaser.Math.Clamp(
        this.playerBody.velocity.x - this.playerFacing * this.GUN_RECOIL_VELOCITY,
        -this.PLAYER_SPEED * 1.2,
        this.PLAYER_SPEED * 1.2
      )
    );
    this.syncBackdropCameraIgnores();
  }

  private updatePlayerProjectiles(delta: number): void {
    if (this.playerProjectiles.length === 0) {
      return;
    }

    for (const projectile of [...this.playerProjectiles]) {
      if (!projectile.rect.active || this.time.now >= projectile.expiresAt) {
        this.destroyPlayerProjectile(projectile);
        continue;
      }

      const startX = projectile.rect.x;
      const stepDistance = (projectile.speed * delta) / 1000;
      const nextX = startX + projectile.directionX * stepDistance;
      const sampleCount = Math.max(1, Math.ceil(Math.abs(nextX - startX) / 6));
      let destroyed = false;

      for (let index = 1; index <= sampleCount; index += 1) {
        const sampleX = Phaser.Math.Linear(startX, nextX, index / sampleCount);
        const sampleY = projectile.rect.y;
        const enemyHit = this.liveObjectController.attackEnemyAtPoint(
          this.loadedFullRoomsById.values(),
          sampleX,
          sampleY,
          5
        );
        if (enemyHit) {
          playSfx('enemy-hit');
          this.fxController?.playBulletImpactFx(enemyHit.x, enemyHit.y - 2);
          this.cameras.main.shake(40, 0.0015);
          this.destroyPlayerProjectile(projectile);
          destroyed = true;
          break;
        }

        if (this.isProjectileBlocked(sampleX, sampleY)) {
          this.fxController?.playBulletImpactFx(sampleX, sampleY);
          this.destroyPlayerProjectile(projectile);
          destroyed = true;
          break;
        }
      }

      if (!destroyed) {
        projectile.rect.x = nextX;
      }
    }
  }

  private isProjectileBlocked(worldX: number, worldY: number): boolean {
    const room = this.getRoomSnapshotAtWorldPoint(worldX, worldY);
    if (!room) {
      return true;
    }

    if (this.isSolidTerrainAtWorldPoint(room, worldX, worldY)) {
      return true;
    }

    for (const loadedRoom of this.loadedFullRoomsById.values()) {
      for (const liveObject of loadedRoom.liveObjects) {
        if (
          liveObject.config.category !== 'platform' ||
          !liveObject.sprite.active ||
          !liveObject.sprite.body
        ) {
          continue;
        }

        const bounds = this.getArcadeBodyBounds(liveObject.sprite.body as ArcadeObjectBody);
        if (bounds.contains(worldX, worldY)) {
          return true;
        }
      }
    }

    return false;
  }

  private destroyPlayerProjectiles(): void {
    for (const projectile of this.playerProjectiles) {
      projectile.rect.destroy();
    }
    this.playerProjectiles = [];
    this.syncBackdropCameraIgnores();
  }

  private destroyPlayerProjectile(projectile: PlayerProjectile): void {
    projectile.rect.destroy();
    this.playerProjectiles = this.playerProjectiles.filter((candidate) => candidate !== projectile);
    this.syncBackdropCameraIgnores();
  }

  private getPlayerSpawn(room: RoomSnapshot): PlayerSpawn {
    if (this.activeCourseSnapshot?.startPoint?.roomId === room.id) {
      const origin = this.getRoomOrigin(room.coordinates);
      return {
        x: origin.x + this.activeCourseSnapshot.startPoint.x,
        y: origin.y + this.activeCourseSnapshot.startPoint.y - this.PLAYER_HEIGHT / 2,
      };
    }

    const startPoint = resolveGoalRunStartPoint(room, this.PLAYER_HEIGHT);
    return {
      x: startPoint.x,
      y: startPoint.y - this.PLAYER_HEIGHT / 2,
    };
  }

  private getRoomSnapshotAtWorldPoint(worldX: number, worldY: number): RoomSnapshot | null {
    const coordinates = {
      x: Math.floor(worldX / ROOM_PX_WIDTH),
      y: Math.floor(worldY / ROOM_PX_HEIGHT),
    };
    return this.getRoomSnapshotForCoordinates(coordinates);
  }

  private isSolidTerrainAtWorldPoint(room: RoomSnapshot, worldX: number, worldY: number): boolean {
    const roomOrigin = this.getRoomOrigin(room.coordinates);
    const localX = Math.floor((worldX - roomOrigin.x) / TILE_SIZE);
    const localY = Math.floor((worldY - roomOrigin.y) / TILE_SIZE);

    if (localX < 0 || localX >= ROOM_WIDTH || localY < 0 || localY >= ROOM_HEIGHT) {
      return false;
    }

    const localPixelY = worldY - roomOrigin.y - localY * TILE_SIZE;
    return terrainTileCollidesAtLocalPixel(room, localX, localY, localPixelY);
  }

  private getArcadeBodyBounds(body: ArcadeObjectBody): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(body.left, body.top, body.width, body.height);
  }

  private maybeRespawnFromVoid(): void {
    const currentRoom = this.getRoomSnapshotForCoordinates(this.currentRoomCoordinates);
    if (!currentRoom || !this.player || !this.playerBody) return;

    const roomOrigin = this.getRoomOrigin(currentRoom.coordinates);
    if (this.player.y <= roomOrigin.y + ROOM_PX_HEIGHT + RESPAWN_FALL_DISTANCE) {
      return;
    }

    this.handlePlayerDeath('You fell.');
  }

  private respawnPlayerToCurrentRoom(): void {
    const currentRoom = this.getRoomSnapshotForCoordinates(this.currentRoomCoordinates);
    if (!currentRoom || !this.player || !this.playerBody) return;

    const spawn = this.getPlayerSpawn(currentRoom);
    this.setPlayerLadderState(null);
    this.isCrouching = false;
    this.activeAttackAnimation = null;
    this.activeAttackAnimationUntil = 0;
    this.clearCrateInteractionState();
    this.weaponKnockbackVelocityX = 0;
    this.weaponKnockbackUntil = 0;
    this.externalLaunchGraceUntil = 0;
    this.resetWallMovementState();
    this.destroyPlayerProjectiles();
    this.playerBody.reset(spawn.x, spawn.y);
    this.player.setPosition(spawn.x, spawn.y);
    this.playerBody.setVelocity(0, 0);
    this.syncPlayerHitbox();
    this.playerWasGrounded = false;
    this.setLadderClimbSfxPlaying(false);
    this.syncPlayerVisual();
    playSfx('respawn');
  }

  private syncLadderClimbSfx(verticalInput: number): void {
    const shouldPlay =
      Boolean(this.playerBody) &&
      this.isClimbingLadder &&
      verticalInput !== 0 &&
      Math.abs(this.playerBody?.velocity.y ?? 0) > 6;
    this.setLadderClimbSfxPlaying(shouldPlay);
  }

  private setLadderClimbSfxPlaying(playing: boolean): void {
    if (this.ladderClimbSfxPlaying === playing) {
      return;
    }

    this.ladderClimbSfxPlaying = playing;
    if (playing) {
      playSfx('ladder-climb');
      return;
    }

    stopSfx('ladder-climb');
  }

  private syncPlayerVisual(): void {
    if (!this.player || !this.playerBody || !this.playerSprite) {
      return;
    }

    this.syncPlayerPickupSensor();

    this.playerSprite.setPosition(
      this.player.x,
      this.playerBody.bottom + DEFAULT_PLAYER_VISUAL_FEET_OFFSET + this.quicksandVisualSink
    );

    const facingLockedByWeaponKnockback = this.time.now < this.weaponKnockbackUntil;
    if (this.isWallSliding && this.wallContactSide !== 0) {
      this.playerFacing = this.wallContactSide;
    } else if (this.activeCrateInteractionFacing !== null) {
      this.playerFacing = this.activeCrateInteractionFacing;
    } else if (!facingLockedByWeaponKnockback && Math.abs(this.playerBody.velocity.x) > 8) {
      this.playerFacing = this.playerBody.velocity.x < 0 ? -1 : 1;
    }
    this.playerSprite.setFlipX(this.playerFacing < 0);

    const grounded = this.playerBody.blocked.down || this.playerBody.touching.down;
    if (!this.isClimbingLadder && grounded && !this.playerWasGrounded) {
      this.playerLandAnimationUntil = this.time.now + 120;
      this.fxController?.playLandingDustFx(this.player.x, this.playerBody.bottom, this.playerFacing);
    }

    let nextAnimation: DefaultPlayerAnimationState = 'idle';
    if (this.activeAttackAnimation && this.time.now < this.activeAttackAnimationUntil) {
      nextAnimation = this.activeAttackAnimation;
    } else if (this.isClimbingLadder) {
      nextAnimation = 'ladder-climb';
    } else if (this.isWallSliding) {
      nextAnimation = 'wall-slide';
    } else if (this.wallJumpActive) {
      nextAnimation = 'wall-jump';
    } else if (!grounded) {
      nextAnimation = this.playerBody.velocity.y < -10 ? 'jump-rise' : 'jump-fall';
    } else if (this.activeCrateInteractionMode === 'push') {
      nextAnimation = 'push';
    } else if (this.activeCrateInteractionMode === 'pull') {
      nextAnimation = 'pull';
    } else if (this.isCrouching) {
      nextAnimation = Math.abs(this.playerBody.velocity.x) > 8 ? 'crawl' : 'crouch';
    } else if (this.time.now < this.playerLandAnimationUntil) {
      nextAnimation = 'land';
    } else if (Math.abs(this.playerBody.velocity.x) > 12) {
      nextAnimation = 'run';
    }

    if (nextAnimation !== this.playerAnimationState) {
      this.playerAnimationState = nextAnimation;
      this.playerSprite.play(DEFAULT_PLAYER_ANIMATION_KEYS[nextAnimation], true);
    }

    this.playerWasGrounded = grounded;
  }

  private updateGoalRun(delta: number): void {
    if (this.activeCourseRun) {
      this.updateCourseRun(delta);
      return;
    }

    if (this.playerBody) {
      this.applyGoalRunMutation(
        this.goalRunController.qualifyPracticeRunAt({
          x: this.playerBody.center.x,
          y: this.playerBody.bottom,
        })
      );
    }

    this.applyGoalRunMutation(this.goalRunController.tick(delta));

    const runState = this.currentGoalRun;
    if (!runState || runState.result !== 'active') {
      return;
    }

    if (!this.playerBody || !this.player) {
      return;
    }

    if (
      this.currentRoomCoordinates.x !== runState.roomCoordinates.x ||
      this.currentRoomCoordinates.y !== runState.roomCoordinates.y
    ) {
      return;
    }

    switch (runState.goal.type) {
      case 'reach_exit':
        if (
          runState.goal.exit &&
          this.playerTouchesGoalPoint(
            this.toWorldGoalPoint(runState.roomCoordinates, runState.goal.exit)
          )
        ) {
          this.completeGoalRun('Exit reached.');
        }
        break;
      case 'checkpoint_sprint':
        this.updateCheckpointSprintRun(runState);
        break;
      default:
        break;
    }
  }

  private syncPlayerPickupSensor(): void {
    if (!this.playerBody || !this.playerPickupSensor || !this.playerPickupSensorBody) {
      return;
    }

    const sensorWidth = this.playerBody.width;
    const sensorHeight = this.playerBody.height + this.PLAYER_PICKUP_SENSOR_EXTRA_HEIGHT;
    const sensorX = this.playerBody.center.x;
    const sensorY = this.playerBody.bottom - sensorHeight * 0.5;
    this.playerPickupSensor.setSize(sensorWidth, sensorHeight);
    this.playerPickupSensor.setPosition(sensorX, sensorY);
    this.playerPickupSensorBody.setSize(sensorWidth, sensorHeight, true);
    this.playerPickupSensorBody.reset(sensorX, sensorY);
  }

  private updateCheckpointSprintRun(runState: GoalRunState): void {
    if (runState.goal.type !== 'checkpoint_sprint') {
      return;
    }

    const nextCheckpoint = runState.goal.checkpoints[runState.nextCheckpointIndex] ?? null;
    if (nextCheckpoint) {
      const worldPoint = this.toWorldGoalPoint(runState.roomCoordinates, nextCheckpoint);
      if (this.playerTouchesGoalPoint(worldPoint)) {
        this.applyGoalRunMutation(this.goalRunController.recordCheckpointReached());
      }
      return;
    }

    if (
      runState.goal.finish &&
      this.playerTouchesGoalPoint(this.toWorldGoalPoint(runState.roomCoordinates, runState.goal.finish))
    ) {
      this.completeGoalRun('Sprint clear.');
    }
  }

  private playerTouchesGoalPoint(point: GoalMarkerPoint): boolean {
    if (!this.playerBody) {
      return false;
    }

    const feetX = this.playerBody.center.x;
    const feetY = this.playerBody.bottom;
    return Phaser.Math.Distance.Between(feetX, feetY, point.x, point.y) <= 18;
  }

  private completeGoalRun(message: string): void {
    this.applyGoalRunMutation(this.goalRunController.markCompleted(message));
  }

  private failGoalRun(message: string): void {
    this.applyGoalRunMutation(this.goalRunController.markFailed(message));
  }

  private updateCourseRun(delta: number): void {
    this.applyCourseRunMutation(
      tickActiveCourseRun(this.activeCourseRun, {
        delta,
        touchesCoursePoint: (point) => this.playerTouchesGoalPoint(this.toWorldCoursePoint(point)),
        getPlayerEffectOrigin: () => this.getPlayerEffectOrigin(),
      }),
    );
  }

  private applyCourseRunMutation(result: CourseRunMutationResult): void {
    if (!result.changed) {
      return;
    }

    if (result.transientStatus) {
      this.showTransientStatus(result.transientStatus);
    }

    if (result.checkpointEffectOrigin) {
      this.fxController?.playGoalFx(
        'checkpoint',
        result.checkpointEffectOrigin.x,
        result.checkpointEffectOrigin.y,
      );
    }

    if (result.goalMarkersChanged) {
      this.redrawGoalMarkers();
    }

    if (result.terminalResult === 'completed' && result.terminalMessage) {
      this.completeCourseRun(result.terminalMessage);
    } else if (result.terminalResult === 'failed' && result.terminalMessage) {
      this.failCourseRun(result.terminalMessage);
    }
  }

  private completeCourseRun(message: string): void {
    if (!this.activeCourseRun || this.activeCourseRun.result !== 'active') {
      return;
    }

    this.activeCourseRun.result = 'completed';
    this.activeCourseRun.completionMessage = message;
    this.showTransientStatus(message);
    this.fxController?.playGoalFx('success', this.player?.x ?? 0, this.playerBody?.bottom ?? 0);
    this.redrawGoalMarkers();
    void this.coursePlaybackController.finalizeActiveCourseRun('completed');
  }

  private failCourseRun(message: string): void {
    if (!this.activeCourseRun || this.activeCourseRun.result !== 'active') {
      return;
    }

    this.activeCourseRun.result = 'failed';
    this.activeCourseRun.completionMessage = message;
    this.showTransientStatus(message);
    this.fxController?.playGoalFx('fail', this.player?.x ?? 0, this.playerBody?.bottom ?? 0, 'goal-fail');
    this.redrawGoalMarkers();
    void this.coursePlaybackController.finalizeActiveCourseRun('failed');
  }

  private handlePlayerDeath(reason: string): void {
    const activeRun = this.currentGoalRun;
    const activeCourseRun = this.activeCourseRun;
    this.goalRunController.recordDeath();
    recordCourseRunDeath(activeCourseRun);
    if (this.player && this.playerBody) {
      this.fxController?.playGoalFx('fail', this.player.x, this.playerBody.bottom - 10, null);
    }

    this.respawnPlayerToCurrentRoom();

    if (activeCourseRun?.course.goal?.type === 'survival') {
      this.failCourseRun('Course survival failed.');
      this.showTransientStatus(`${reason} Course run failed.`);
      return;
    }

    if (activeRun?.goal.type === 'survival') {
      const goalRoom = this.getRoomSnapshotForCoordinates(activeRun.roomCoordinates);
      this.failGoalRun('Survival failed.');
      if (goalRoom?.goal) {
        this.applyGoalRunMutation(this.goalRunController.restartRunForRoom(goalRoom, 'respawn'));
        void this.refreshLeaderboardForSelection();
        this.showTransientStatus(`${reason} Survival run restarted.`);
      }
      return;
    }

    if (activeRun?.qualificationState === 'practice') {
      const goalRoom = this.getRoomSnapshotForCoordinates(activeRun.roomCoordinates);
      if (goalRoom?.goal) {
        this.resetSingleRoomChallengeStateForRun(activeRun);
        this.applyGoalRunMutation(this.goalRunController.restartRunForRoom(goalRoom, 'respawn'));
        void this.refreshLeaderboardForSelection();
        return;
      }
    }

    this.showTransientStatus(reason);
  }

  private handleEnemyDefeated(roomId: string, enemyName: string): boolean {
    this.applyCourseRunMutation(recordCourseRunEnemyDefeated(this.activeCourseRun));

    const result = this.goalRunController.recordEnemyDefeated(
      roomId,
      enemyName
    );
    this.applyGoalRunMutation(result);
    return Boolean(result.transientStatus);
  }

  private handleCollectibleCollected(roomId: string): void {
    this.applyCourseRunMutation(recordCourseRunCollectibleCollected(this.activeCourseRun));

    this.applyGoalRunMutation(this.goalRunController.recordCollectibleCollected(roomId));
  }

  private resetPlaySession(): void {
    const singleRoomRunToReset = this.activeCourseRun ? null : this.currentGoalRun;
    this.goalRunController.abandonActiveRun();
    if (this.activeCourseRun?.result === 'active') {
      void this.coursePlaybackController.finalizeActiveCourseRun('abandoned');
    }
    if (
      singleRoomRunToReset &&
      this.shouldResetSingleRoomChallengeStateForRun(singleRoomRunToReset)
    ) {
      this.resetSingleRoomChallengeStateForRun(singleRoomRunToReset);
    }
    this.activeCourseRun = null;
    this.coursePlaybackController.clearActiveCourseRoomOverrides();

    this.collectedObjectKeys.clear();
    this.heldKeyCount = 0;
    this.score = 0;
    this.isCrouching = false;
    this.resetWallMovementState();
    this.activeAttackAnimation = null;
    this.activeAttackAnimationUntil = 0;
    this.externalLaunchGraceUntil = 0;
    this.destroyPlayerProjectiles();
    this.playerLandAnimationUntil = 0;
    this.goalRunController.reset();
    this.redrawGoalMarkers();
  }

  private clearTouchGestureState(): void {
    this.inspectInputController.reset();
  }

  private shouldResetSingleRoomChallengeStateForRun(runState: GoalRunState): boolean {
    return (
      runState.result === 'active' ||
      runState.result === 'completed' ||
      runState.result === 'failed'
    );
  }

  private resetSingleRoomChallengeStateForRun(runState: GoalRunState): void {
    const room = this.getRoomSnapshotForCoordinates(runState.roomCoordinates);
    if (!room) {
      return;
    }

    const restoredKeyCount = this.clearCollectedObjectKeysForRoom(room);
    if (restoredKeyCount > 0) {
      this.heldKeyCount = Math.max(0, this.heldKeyCount - restoredKeyCount);
    }
    this.score = 0;

    const loadedRoom = this.loadedFullRoomsById.get(room.id) ?? null;
    if (!loadedRoom) {
      return;
    }

    this.destroyLiveObjects(loadedRoom);
    this.createLiveObjects(loadedRoom);
    this.syncLiveObjectInteractions();
  }

  private clearCollectedObjectKeysForRoom(room: RoomSnapshot): number {
    let restoredKeyCount = 0;

    for (let index = 0; index < room.placedObjects.length; index += 1) {
      const runtimeKey = this.getPlacedObjectRuntimeKey(room.id, room.placedObjects[index], index);
      if (!this.collectedObjectKeys.delete(runtimeKey)) {
        continue;
      }

      if (room.placedObjects[index]?.id === 'key') {
        restoredKeyCount += 1;
      }
    }

    return restoredKeyCount;
  }

  private getPlacedObjectRuntimeKey(
    roomId: string,
    placedObject: RoomSnapshot['placedObjects'][number],
    placedIndex: number,
  ): string {
    return `${roomId}:${placedObject.instanceId || placedIndex}`;
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

    if (
      this.shouldBlockRoomTransition(this.currentRoomCoordinates, nextRoomCoordinates)
    ) {
      this.blockRoomTransition(this.currentRoomCoordinates, nextRoomCoordinates);
      return;
    }

    const activeGoalRun = this.activeCourseRun ? null : this.currentGoalRun;
    if (
      activeGoalRun &&
      (nextRoomCoordinates.x !== activeGoalRun.roomCoordinates.x ||
        nextRoomCoordinates.y !== activeGoalRun.roomCoordinates.y) &&
      this.shouldResetSingleRoomChallengeStateForRun(activeGoalRun)
    ) {
      this.resetSingleRoomChallengeStateForRun(activeGoalRun);
    }

    this.currentRoomCoordinates = { ...nextRoomCoordinates };
    this.selectedCoordinates = { ...nextRoomCoordinates };
    this.updateSelectedSummary();
    if (!this.activeCourseRun) {
      this.applyGoalRunMutation(
        this.goalRunController.syncRunForRoom(
          this.getRoomSnapshotForCoordinates(this.currentRoomCoordinates),
          'transition'
        )
      );
      void this.refreshLeaderboardForSelection();
    }
    void this.refreshCourseComposerSelectedRoomState();
    setFocusedCoordinatesInUrl(this.currentRoomCoordinates);

    if (
      nextRoomCoordinates.x !== this.windowCenterCoordinates.x ||
      nextRoomCoordinates.y !== this.windowCenterCoordinates.y
    ) {
      void this.refreshAround(nextRoomCoordinates);
      return;
    }

    this.redrawWorld();
    this.renderHud();
  }

  private shouldBlockRoomTransition(
    currentRoomCoordinates: RoomCoordinates,
    nextRoomCoordinates: RoomCoordinates
  ): boolean {
    const deltaX = nextRoomCoordinates.x - currentRoomCoordinates.x;
    const deltaY = nextRoomCoordinates.y - currentRoomCoordinates.y;
    if (Math.abs(deltaX) + Math.abs(deltaY) !== 1) {
      return false;
    }

    return !this.isNeighborReachableInCurrentPlayMode(currentRoomCoordinates, nextRoomCoordinates);
  }

  private blockRoomTransition(
    currentRoomCoordinates: RoomCoordinates,
    nextRoomCoordinates: RoomCoordinates
  ): void {
    if (!this.player || !this.playerBody) {
      return;
    }

    const roomOrigin = this.getRoomOrigin(currentRoomCoordinates);
    const deltaX = nextRoomCoordinates.x - currentRoomCoordinates.x;
    const deltaY = nextRoomCoordinates.y - currentRoomCoordinates.y;
    const halfWidth = this.playerBody.width * 0.5;
    const halfHeight = this.playerBody.height * 0.5;
    const inset = 1;

    let nextX = this.player.x;
    let nextY = this.player.y;

    if (deltaX === 1) {
      nextX = roomOrigin.x + ROOM_PX_WIDTH - halfWidth - inset;
    } else if (deltaX === -1) {
      nextX = roomOrigin.x + halfWidth + inset;
    } else if (deltaY === 1) {
      nextY = roomOrigin.y + ROOM_PX_HEIGHT - halfHeight - inset;
    } else if (deltaY === -1) {
      nextY = roomOrigin.y + halfHeight + inset;
    }

    this.setPlayerLadderState(null);
    this.playerBody.reset(nextX, nextY);
    this.player.setPosition(nextX, nextY);
    this.syncPlayerPickupSensor();
  }

  private syncBrowseWindowToCamera(
    panStartPointer: { x: number; y: number },
    panCurrentPointer: { x: number; y: number },
  ): void {
    this.selectionController.syncBrowseWindowToCamera(panStartPointer, panCurrentPointer);
  }

  private syncCameraBoundsUsage(): void {
    this.cameras.main.useBounds = this.mode === 'play' && this.cameraMode === 'follow';
  }

  private getRoomCoordinatesForPoint(x: number, y: number): RoomCoordinates {
    return this.selectionController.getRoomCoordinatesForPoint(x, y);
  }

  private isWithinLoadedRoomBounds(coordinates: RoomCoordinates): boolean {
    return this.selectionController.isWithinLoadedRoomBounds(coordinates);
  }

  private getRoomOrigin(coordinates: RoomCoordinates): { x: number; y: number } {
    return this.selectionController.getRoomOrigin(coordinates);
  }

  private getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null {
    return this.selectionController.getRoomSnapshotForCoordinates(coordinates);
  }

  private updateSelectedSummary(): void {
    this.selectedSummary = this.roomSummariesById.get(roomIdFromCoordinates(this.selectedCoordinates)) ?? null;
  }

  private getCellStateAt(coordinates: RoomCoordinates): SelectedCellState {
    return this.selectionController.getCellStateAt(coordinates);
  }

  private isRoomInActiveCourse(coordinates: RoomCoordinates): boolean {
    return this.selectionController.isRoomInActiveCourse(coordinates);
  }

  fitLoadedWorld(): void {
    this.flowController.fitLoadedWorld(this.worldWindow);

    if (this.mode === 'play' && this.cameraMode === 'follow' && this.player) {
      this.startFollowCamera(this.cameras.main);
      return;
    }

    const focusCoordinates = this.mode === 'play' ? this.currentRoomCoordinates : this.selectedCoordinates;
    this.centerCameraOnCoordinates(focusCoordinates);
    this.constrainInspectCamera();
  }

  playSelectedRoom(): void {
    this.flowController.playSelectedRoom();
  }

  returnToWorld(): void {
    this.flowController.returnToWorld();
  }

  buildSelectedRoom(): void {
    this.flowController.buildSelectedRoom();
  }

  editSelectedRoom(): void {
    this.flowController.editSelectedRoom();
  }

  editCurrentRoom(): void {
    this.editSelectedRoom();
  }

  async playSelectedCourse(): Promise<void> {
    await this.flowController.playSelectedCourse();
  }

  async openCourseEditor(): Promise<void> {
    await this.flowController.openCourseEditor();
  }

  async openCourseComposer(): Promise<void> {
    await this.flowController.openCourseComposer();
  }

  closeCourseComposer(): void {
    this.courseComposerOpen = false;
    this.emitCourseComposerStateChanged();
    this.renderHud();
  }

  getCourseComposerState(): CourseComposerState | null {
    if (!this.courseComposerOpen || !this.courseComposerRecord) {
      return null;
    }

    const draft = this.courseComposerRecord.draft;
    const testDraftDisabledReason =
      !this.courseComposerRecord.permissions.canSaveDraft
        ? 'This course is read-only for your account.'
        : this.getCurrentCourseDraftPreviewDisabledReason();
    const saveDraftDisabledReason =
      !this.courseComposerRecord.permissions.canSaveDraft
        ? 'This course is read-only for your account.'
        : this.getCurrentCourseDraftSaveDisabledReason();
    const publishCourseDisabledReason =
      !this.courseComposerRecord.permissions.canPublish
        ? 'This course is read-only for your account.'
        : this.getCurrentCourseDraftPublishDisabledReason();
    const unpublishCourseDisabledReason = this.getCourseComposerUnpublishDisabledReason();
    return {
      courseId: draft.id,
      title: draft.title ?? '',
      roomRefs: draft.roomRefs.map((roomRef) => ({
        ...roomRef,
        coordinates: { ...roomRef.coordinates },
      })),
      goalType: draft.goal?.type ?? null,
      timeLimitSeconds:
        draft.goal && 'timeLimitMs' in draft.goal && draft.goal.timeLimitMs !== null
          ? Math.max(1, Math.round(draft.goal.timeLimitMs / 1000))
          : null,
      requiredCount: draft.goal?.type === 'collect_target' ? draft.goal.requiredCount : null,
      survivalSeconds:
        draft.goal?.type === 'survival' ? Math.max(1, Math.round(draft.goal.durationMs / 1000)) : null,
      startPointRoomId: draft.startPoint?.roomId ?? null,
      checkpointCount: draft.goal?.type === 'checkpoint_sprint' ? draft.goal.checkpoints.length : 0,
      finishRoomId:
        draft.goal?.type === 'checkpoint_sprint'
          ? draft.goal.finish?.roomId ?? null
          : draft.goal?.type === 'reach_exit'
            ? draft.goal.exit?.roomId ?? null
            : null,
      selectedRoomInDraft: this.courseComposerSelectedRoomInDraft,
      selectedRoomEligible: this.courseComposerSelectedRoomEligible,
      selectedRoomId: getActiveCourseDraftSessionSelectedRoomId(),
      canEdit: this.courseComposerRecord.permissions.canSaveDraft,
      published: Boolean(this.courseComposerRecord.published),
      publishedVersion: this.courseComposerRecord.published?.version ?? null,
      publishedRoomCount: this.courseComposerRecord.published?.roomRefs.length ?? 0,
      publishedStateText: this.getCourseComposerPublishedStateText(),
      publishedDraftWarningText: this.getCourseComposerPublishedDraftWarningText(),
      dirty: this.isCourseComposerDirty(),
      statusText: this.courseComposerLoading
        ? 'Loading course...'
        : this.courseComposerStatusText,
      selectedRoomOrder: this.courseComposerSelectedRoomOrder,
      canMoveSelectedRoomEarlier: this.canMoveSelectedCourseRoom(-1),
      canMoveSelectedRoomLater: this.canMoveSelectedCourseRoom(1),
      canEditSelectedRoom:
        this.courseComposerRecord.permissions.canSaveDraft &&
        getActiveCourseDraftSessionSelectedRoomId() !== null,
      canTestDraft: testDraftDisabledReason === null,
      testDraftDisabledReason,
      canSaveDraft: saveDraftDisabledReason === null,
      saveDraftDisabledReason,
      canPublishCourse: publishCourseDisabledReason === null,
      publishCourseDisabledReason,
      showUnpublishCourse: Boolean(this.courseComposerRecord.published),
      canUnpublishCourse: unpublishCourseDisabledReason === null,
      unpublishCourseDisabledReason,
    };
  }

  setCourseTitle(title: string | null): void {
    this.updateCourseComposerDraft((draft) => {
      draft.title = title?.trim() ? title.trim() : null;
    });
  }

  addSelectedRoomToCourseDraft(): void {
    void this.addSelectedRoomToCourseDraftAsync();
  }

  private canMoveSelectedCourseRoom(direction: -1 | 1): boolean {
    const draft = this.courseComposerRecord?.draft ?? null;
    const selectedRoomId = getActiveCourseDraftSessionSelectedRoomId();
    if (!draft || !selectedRoomId) {
      return false;
    }

    return this.buildMovedCourseRoomRefs(draft.roomRefs, selectedRoomId, direction) !== null;
  }

  private buildMovedCourseRoomRefs(
    roomRefs: CourseRoomRef[],
    roomId: string,
    direction: -1 | 1,
  ): CourseRoomRef[] | null {
    const currentIndex = roomRefs.findIndex((roomRef) => roomRef.roomId === roomId);
    if (currentIndex < 0) {
      return null;
    }

    const nextIndex = Phaser.Math.Clamp(currentIndex + direction, 0, roomRefs.length - 1);
    if (nextIndex === currentIndex) {
      return null;
    }

    const nextRoomRefs = [...roomRefs];
    const [moved] = nextRoomRefs.splice(currentIndex, 1);
    nextRoomRefs.splice(nextIndex, 0, moved);
    if (!courseRoomRefsFollowLinearPath(nextRoomRefs)) {
      return null;
    }

    return nextRoomRefs;
  }

  removeSelectedRoomFromCourseDraft(): void {
    if (!this.courseComposerRecord?.permissions.canSaveDraft) {
      return;
    }

    const selectedRoomId = getActiveCourseDraftSessionSelectedRoomId();
    if (!selectedRoomId) {
      return;
    }
    this.updateCourseComposerDraft((draft) => {
      draft.roomRefs = draft.roomRefs.filter((roomRef) => roomRef.roomId !== selectedRoomId);
      if (draft.startPoint?.roomId === selectedRoomId) {
        draft.startPoint = null;
      }
      if (draft.goal?.type === 'reach_exit' && draft.goal.exit?.roomId === selectedRoomId) {
        draft.goal.exit = null;
      }
      if (draft.goal?.type === 'checkpoint_sprint') {
        draft.goal.checkpoints = draft.goal.checkpoints.filter(
          (checkpoint) => checkpoint.roomId !== selectedRoomId
        );
        if (draft.goal.finish?.roomId === selectedRoomId) {
          draft.goal.finish = null;
        }
      }
    });
    void this.refreshCourseComposerSelectedRoomState();
  }

  moveSelectedRoomEarlierInCourseDraft(): void {
    this.moveSelectedRoomInCourseDraft(-1);
  }

  moveSelectedRoomLaterInCourseDraft(): void {
    this.moveSelectedRoomInCourseDraft(1);
  }

  selectCourseRoomInComposer(roomId: string): void {
    if (!this.courseComposerRecord) {
      return;
    }

    const roomRef = this.courseComposerRecord.draft.roomRefs.find((candidate) => candidate.roomId === roomId);
    if (!roomRef) {
      return;
    }

    setActiveCourseDraftSessionSelectedRoom(roomId);
    this.courseComposerSelectedRoomOrder = getActiveCourseDraftSessionSelectedRoomOrder();
    this.selectedCoordinates = { ...roomRef.coordinates };
    if (this.mode !== 'play') {
      this.currentRoomCoordinates = { ...roomRef.coordinates };
    }
    this.updateSelectedSummary();
    this.redrawWorld();
    this.renderHud();
    this.emitCourseComposerStateChanged();
  }

  editSelectedCourseRoom(): boolean {
    if (!this.courseComposerRecord?.permissions.canSaveDraft) {
      return false;
    }

    const roomId = getActiveCourseDraftSessionSelectedRoomId();
    const roomRef = roomId
      ? this.courseComposerRecord.draft.roomRefs.find((candidate) => candidate.roomId === roomId) ?? null
      : null;
    if (!roomId) {
      this.courseComposerStatusText = 'Select a room from this course to open it in the editor.';
      this.emitCourseComposerStateChanged();
      return false;
    }

    if (!roomRef) {
      this.courseComposerStatusText = 'Selected course room is no longer in this draft.';
      this.emitCourseComposerStateChanged();
      return false;
    }

    const roomSnapshot = this.getRoomSnapshotForCoordinates(roomRef.coordinates);
    if (!roomSnapshot) {
      this.courseComposerStatusText = 'Selected course room is not loaded yet.';
      this.emitCourseComposerStateChanged();
      return false;
    }

    this.courseComposerStatusText = 'Editing course room in the room editor...';
    this.emitCourseComposerStateChanged();

    const editorData: EditorSceneData = {
      roomCoordinates: { ...roomRef.coordinates },
      source: 'world',
      roomSnapshot,
      courseEdit: {
        courseId: this.courseComposerRecord.draft.id,
        roomId: roomRef.roomId,
      },
    };

    this.flowController.openEditor(editorData);
    return true;
  }

  private async continueCourseEditorNavigation(offset: -1 | 1): Promise<void> {
    const draft = getActiveCourseDraftSessionDraft();
    const currentOrder = getActiveCourseDraftSessionSelectedRoomOrder();
    const nextRoomRef =
      draft && currentOrder !== null ? draft.roomRefs[currentOrder + offset] ?? null : null;
    if (!draft || currentOrder === null || !nextRoomRef) {
      this.courseComposerStatusText =
        offset < 0
          ? 'Previous course room is no longer available.'
          : 'Next course room is no longer available.';
      await this.refreshCourseComposerSelectedRoomState();
      this.emitCourseComposerStateChanged();
      hideBusyOverlay();
      return;
    }

    setActiveCourseDraftSessionSelectedRoom(nextRoomRef.roomId);
    this.syncCourseComposerRecordFromSession();
    this.courseComposerSelectedRoomOrder = getActiveCourseDraftSessionSelectedRoomOrder();
    this.courseComposerSelectedRoomInDraft = true;
    this.selectedCoordinates = { ...nextRoomRef.coordinates };
    if (this.mode !== 'play') {
      this.currentRoomCoordinates = { ...nextRoomRef.coordinates };
    }
    this.windowCenterCoordinates = { ...nextRoomRef.coordinates };
    this.shouldCenterCamera = true;
    this.updateSelectedSummary();
    this.redrawWorld();
    this.renderHud();

    await this.refreshAround(nextRoomRef.coordinates, { forceChunkReload: true });

    const roomSnapshot =
      getActiveCourseDraftSessionRoomOverride(nextRoomRef.roomId) ??
      this.getRoomSnapshotForCoordinates(nextRoomRef.coordinates) ??
      (await (async () => {
        const record = await this.roomRepository.loadRoom(nextRoomRef.roomId, nextRoomRef.coordinates);
        return record.draft ? cloneRoomSnapshot(record.draft) : null;
      })());
    if (!roomSnapshot) {
      this.courseComposerStatusText =
        offset < 0
          ? 'Failed to reopen the previous course room.'
          : 'Failed to reopen the next course room.';
      await this.refreshCourseComposerSelectedRoomState();
      this.emitCourseComposerStateChanged();
      hideBusyOverlay();
      return;
    }

    this.courseComposerStatusText = null;
    this.flowController.openEditor({
      roomCoordinates: { ...nextRoomRef.coordinates },
      source: 'world',
      roomSnapshot: cloneRoomSnapshot(roomSnapshot),
      courseEdit: {
        courseId: draft.id,
        roomId: nextRoomRef.roomId,
      },
    });
  }

  async testDraftCourse(): Promise<void> {
    const draft = this.courseComposerRecord?.draft ?? null;
    const disabledReason =
      !this.courseComposerRecord?.permissions.canSaveDraft
        ? 'This course is read-only for your account.'
        : this.getCurrentCourseDraftPreviewDisabledReason();
    if (!draft || disabledReason) {
      this.courseComposerStatusText = disabledReason ?? 'Course draft is not ready to test.';
      this.emitCourseComposerStateChanged();
      this.renderHud();
      return;
    }

    showBusyOverlay('Testing draft course...', 'Loading draft...');
    try {
      const snapshot = cloneCourseSnapshot(draft);
      await this.flowController.startCoursePlayback(snapshot, 'draftPreview');
      this.showTransientStatus('Testing draft course.');
      hideBusyOverlay();
    } catch (error) {
      console.error('Failed to test draft course', error);
      showBusyError(
        error instanceof Error ? error.message : 'Failed to test draft course.',
        {
          closeHandler: () => hideBusyOverlay(),
        }
      );
    }
  }

  async saveCourseDraft(): Promise<void> {
    const courseRecord = this.courseComposerRecord;
    const disabledReason =
      !courseRecord?.permissions.canSaveDraft
        ? 'This course is read-only for your account.'
        : this.getCurrentCourseDraftSaveDisabledReason();
    if (disabledReason) {
      this.courseComposerStatusText = disabledReason;
      this.emitCourseComposerStateChanged();
      this.renderHud();
      return;
    }
    if (!courseRecord) {
      return;
    }

    this.courseComposerStatusText = 'Saving course draft...';
    this.emitCourseComposerStateChanged();
    try {
      const saved = await this.courseRepository.saveDraft(courseRecord.draft);
      this.setCourseComposerRecord(saved, {
        selectedRoomId: getActiveCourseDraftSessionSelectedRoomId(),
      });
      this.courseComposerStatusText = 'Course draft saved.';
      await this.refreshCourseComposerSelectedRoomState();
      await this.refreshAround(this.windowCenterCoordinates, { forceChunkReload: true });
    } catch (error) {
      console.error('Failed to save course draft', error);
      this.courseComposerStatusText =
        error instanceof Error ? error.message : 'Failed to save course draft.';
    } finally {
      this.emitCourseComposerStateChanged();
      this.renderHud();
    }
  }

  async publishCourseDraft(): Promise<void> {
    const courseRecord = this.courseComposerRecord;
    const disabledReason =
      !courseRecord?.permissions.canPublish
        ? 'This course is read-only for your account.'
        : this.getCurrentCourseDraftPublishDisabledReason();
    if (disabledReason) {
      this.courseComposerStatusText = disabledReason;
      this.emitCourseComposerStateChanged();
      this.renderHud();
      return;
    }
    if (!courseRecord) {
      return;
    }

    this.courseComposerStatusText = 'Publishing course...';
    this.emitCourseComposerStateChanged();
    try {
      const saved = await this.courseRepository.saveDraft(courseRecord.draft);
      this.setCourseComposerRecord(saved, {
        selectedRoomId: getActiveCourseDraftSessionSelectedRoomId(),
      });
      const published = await this.courseRepository.publishCourse(courseRecord.draft.id);
      this.setCourseComposerRecord(published, {
        selectedRoomId: getActiveCourseDraftSessionSelectedRoomId(),
      });
      this.courseComposerStatusText = 'Course published.';
      await this.refreshCourseComposerSelectedRoomState();
      await this.refreshAround(this.windowCenterCoordinates, { forceChunkReload: true });
    } catch (error) {
      console.error('Failed to publish course', error);
      this.courseComposerStatusText =
        error instanceof Error ? error.message : 'Failed to publish course.';
    } finally {
      this.emitCourseComposerStateChanged();
      this.renderHud();
    }
  }

  async unpublishCourse(): Promise<void> {
    const courseRecord = this.courseComposerRecord;
    const disabledReason = this.getCourseComposerUnpublishDisabledReason();
    if (disabledReason) {
      this.courseComposerStatusText = disabledReason;
      this.emitCourseComposerStateChanged();
      this.renderHud();
      return;
    }
    if (!courseRecord) {
      return;
    }

    this.courseComposerStatusText = 'Unpublishing course...';
    this.emitCourseComposerStateChanged();
    try {
      const unpublished = await this.courseRepository.unpublishCourse(courseRecord.draft.id);
      const preservedDraft = cloneCourseSnapshot(courseRecord.draft);
      preservedDraft.status = 'draft';
      preservedDraft.publishedAt = null;
      this.setCourseComposerRecord(
        {
          ...unpublished,
          draft: preservedDraft,
        },
        {
          selectedRoomId: getActiveCourseDraftSessionSelectedRoomId(),
        }
      );

      const unpublishedActiveCourse =
        this.activeCourseRun?.course.id === courseRecord.draft.id;
      if (unpublishedActiveCourse) {
        const returnCoordinates = this.activeCourseRun?.returnCoordinates ?? this.currentRoomCoordinates;
        this.resetPlaySession();
        this.clearTouchGestureState();
        this.mode = 'browse';
        this.cameraMode = 'inspect';
        this.inspectZoom = this.browseInspectZoom;
        this.syncAppMode();
        this.selectedCoordinates = { ...returnCoordinates };
        this.currentRoomCoordinates = { ...returnCoordinates };
        this.shouldCenterCamera = true;
        this.shouldRespawnPlayer = false;
        setFocusedCoordinatesInUrl(this.currentRoomCoordinates);
        this.showTransientStatus('Stopped course because it was unpublished.');
      }

      this.courseComposerStatusText = 'Course unpublished. The live course is no longer public.';
      await this.refreshCourseComposerSelectedRoomState();
      await this.refreshAround(this.currentRoomCoordinates, { forceChunkReload: true });
    } catch (error) {
      console.error('Failed to unpublish course', error);
      this.courseComposerStatusText =
        error instanceof Error ? error.message : 'Failed to unpublish course.';
    } finally {
      this.emitCourseComposerStateChanged();
      this.renderHud();
    }
  }

  private async addSelectedRoomToCourseDraftAsync(): Promise<void> {
    if (!this.courseComposerRecord?.permissions.canSaveDraft) {
      return;
    }

    const meta = await this.loadPublishedRoomMeta(this.selectedCoordinates);
    if (!meta || !this.canSelectedRoomJoinCourseDraft(meta)) {
      this.courseComposerStatusText = 'Selected room cannot be added to this course.';
      this.emitCourseComposerStateChanged();
      return;
    }

    this.updateCourseComposerDraft((draft) => {
      const nextRoomRef = {
        roomId: meta.roomId,
        coordinates: { ...meta.coordinates },
        roomVersion: meta.roomVersion,
        roomTitle: meta.roomTitle,
      };
      if (draft.roomRefs.length === 0) {
        draft.roomRefs = [nextRoomRef];
        return;
      }
      const lastRoomRef = draft.roomRefs[draft.roomRefs.length - 1];
      if (areCourseRoomRefsOrthogonallyAdjacent(nextRoomRef, lastRoomRef)) {
        draft.roomRefs = [...draft.roomRefs, nextRoomRef];
      }
    });
    setActiveCourseDraftSessionSelectedRoom(meta.roomId);
    await this.refreshCourseComposerSelectedRoomState();
  }

  private moveSelectedRoomInCourseDraft(direction: -1 | 1): void {
    if (!this.courseComposerRecord?.permissions.canSaveDraft) {
      return;
    }

    const roomId = getActiveCourseDraftSessionSelectedRoomId();
    if (!roomId) {
      return;
    }
    const nextRoomRefs = this.buildMovedCourseRoomRefs(this.courseComposerRecord.draft.roomRefs, roomId, direction);
    if (!nextRoomRefs) {
      this.courseComposerStatusText =
        direction < 0
          ? 'This room cannot move earlier without breaking the course path.'
          : 'This room cannot move later without breaking the course path.';
      this.emitCourseComposerStateChanged();
      this.renderHud();
      return;
    }

    this.updateCourseComposerDraft((draft) => {
      draft.roomRefs = nextRoomRefs;
    });
    this.courseComposerStatusText =
      direction < 0 ? 'Moved selected room earlier.' : 'Moved selected room later.';
    this.emitCourseComposerStateChanged();
    this.renderHud();
    void this.refreshCourseComposerSelectedRoomState();
  }

  private updateCourseComposerDraft(mutator: (draft: CourseSnapshot) => void): void {
    if (!this.courseComposerRecord?.permissions.canSaveDraft) {
      return;
    }

    updateActiveCourseDraftSession((draft) => {
      mutator(draft);
    });
    this.syncCourseComposerRecordFromSession();
    this.emitCourseComposerStateChanged();
    this.renderHud();
  }

  private isCourseComposerDirty(): boolean {
    return isActiveCourseDraftSessionDirty();
  }

  private async refreshCourseComposerSelectedRoomState(): Promise<void> {
    if (!this.courseComposerOpen || !this.courseComposerRecord) {
      return;
    }

    const roomRefs = this.courseComposerRecord.draft.roomRefs;
    const worldSelectedRoomId = roomIdFromCoordinates(this.selectedCoordinates);
    const worldSelectedRoomOrder = roomRefs.findIndex((roomRef) => roomRef.roomId === worldSelectedRoomId);
    this.courseComposerSelectedRoomInDraft = worldSelectedRoomOrder >= 0;
    if (worldSelectedRoomOrder >= 0) {
      setActiveCourseDraftSessionSelectedRoom(worldSelectedRoomId);
    }
    this.courseComposerSelectedRoomOrder = getActiveCourseDraftSessionSelectedRoomOrder();

    const meta = await this.loadPublishedRoomMeta(this.selectedCoordinates);
    this.courseComposerSelectedRoomEligible =
      meta !== null && this.canSelectedRoomJoinCourseDraft(meta);
    this.emitCourseComposerStateChanged();
  }

  private async loadPublishedRoomMeta(
    coordinates: RoomCoordinates
  ): Promise<CoursePublishedRoomMeta | null> {
    const roomId = roomIdFromCoordinates(coordinates);
    const cached = this.courseRoomMetaByRoomId.get(roomId);
    if (cached) {
      return cached;
    }

    const record = await this.roomRepository.loadRoom(roomId, coordinates);
    if (!record.published) {
      return null;
    }

    const publishedVersion =
      record.versions.find((version) => version.version === record.published?.version) ?? null;
    const meta: CoursePublishedRoomMeta = {
      roomId,
      coordinates: { ...coordinates },
      roomVersion: record.published.version,
      roomTitle: record.published.title,
      publishedByUserId:
        publishedVersion?.publishedByUserId ?? record.lastPublishedByUserId ?? null,
    };
    this.courseRoomMetaByRoomId.set(roomId, meta);
    return meta;
  }

  private canSelectedRoomJoinCourseDraft(meta: CoursePublishedRoomMeta): boolean {
    if (!this.courseComposerRecord?.permissions.canSaveDraft) {
      return false;
    }

    const authState = getAuthDebugState();
    if (!authState.authenticated || !authState.user?.id) {
      return false;
    }

    if (meta.publishedByUserId !== authState.user.id) {
      return false;
    }

    if (
      this.selectedSummary?.course?.courseId &&
      this.selectedSummary.course.courseId !== this.courseComposerRecord.draft.id
    ) {
      return false;
    }

    if (this.courseComposerRecord.draft.roomRefs.some((roomRef) => roomRef.roomId === meta.roomId)) {
      return false;
    }

    if (this.courseComposerRecord.draft.roomRefs.length >= MAX_COURSE_ROOMS) {
      return false;
    }

    if (this.courseComposerRecord.ownerUserId && this.courseComposerRecord.ownerUserId !== meta.publishedByUserId) {
      return false;
    }

    if (this.courseComposerRecord.draft.roomRefs.length === 0) {
      return true;
    }

    if (!courseRoomRefsFollowLinearPath(this.courseComposerRecord.draft.roomRefs)) {
      return false;
    }

    const lastRoomRef =
      this.courseComposerRecord.draft.roomRefs[this.courseComposerRecord.draft.roomRefs.length - 1];
    return areCourseRoomRefsOrthogonallyAdjacent(meta, lastRoomRef);
  }

  private applyGoalRunMutation(result: GoalRunMutationResult): void {
    if (!result.changed) {
      return;
    }

    if (result.resetChallengeState && this.currentGoalRun) {
      this.resetSingleRoomChallengeStateForRun(this.currentGoalRun);
    }

    this.playGoalRunFx(result);

    if (result.transientStatus) {
      this.showTransientStatus(result.transientStatus);
    }

    if (result.goalMarkersChanged) {
      this.redrawGoalMarkers();
    }
  }

  private playGoalRunFx(result: GoalRunMutationResult): void {
    if (!result.event || !this.fxController) {
      return;
    }

    const origin = this.getPlayerEffectOrigin();
    if (!origin) {
      return;
    }

    switch (result.event) {
      case 'start':
        this.fxController.playGoalFx('start', origin.x, origin.y);
        break;
      case 'checkpoint':
        this.fxController.playGoalFx('checkpoint', origin.x, origin.y);
        break;
      case 'complete':
        this.fxController.playGoalFx('success', origin.x, origin.y);
        break;
      case 'fail':
        this.fxController.playGoalFx(
          'fail',
          origin.x,
          origin.y,
          result.transientStatus === 'Time up.' ? 'time-up' : 'goal-fail'
        );
        break;
      case 'abandon':
        this.fxController.playGoalFx('abandon', origin.x, origin.y, 'challenge-abandon');
        break;
      default:
        break;
    }
  }

  private getPlayerEffectOrigin(): { x: number; y: number } | null {
    if (this.player && this.playerBody) {
      return {
        x: this.player.x,
        y: this.playerBody.bottom - this.PLAYER_HEIGHT,
      };
    }

    const currentRoom = this.getRoomSnapshotForCoordinates(this.currentRoomCoordinates);
    if (!currentRoom) {
      return null;
    }

    const roomOrigin = this.getRoomOrigin(currentRoom.coordinates);
    return {
      x: roomOrigin.x + ROOM_PX_WIDTH * 0.5,
      y: roomOrigin.y + ROOM_PX_HEIGHT * 0.5,
    };
  }

  private getGoalBadgeText(goal: RoomGoal): string {
    switch (goal.type) {
      case 'reach_exit':
        return 'Reach Exit';
      case 'collect_target':
        return `Collect ${goal.requiredCount}`;
      case 'defeat_all':
        return 'Defeat All';
      case 'checkpoint_sprint':
        return `${goal.checkpoints.length || 0} Checkpoints`;
      case 'survival':
        return `Survive ${Math.max(1, Math.round(goal.durationMs / 1000))}s`;
    }
  }

  private getCourseGoalBadgeText(goal: CourseGoal | null): string {
    return getCourseGoalBadgeText(goal);
  }

  private getPlayGoalTimerText(runState: GoalRunState): string {
    if (runState.qualificationState === 'practice') {
      return 'PRACTICE';
    }

    if (runState.goal.type === 'survival') {
      return `${this.formatOverlayTimer(Math.max(0, runState.goal.durationMs - runState.elapsedMs))} LEFT`;
    }

    if (runState.goal.timeLimitMs !== null) {
      return `${this.formatOverlayTimer(Math.max(0, runState.goal.timeLimitMs - runState.elapsedMs))} LEFT`;
    }

    return this.formatOverlayTimer(runState.elapsedMs);
  }

  private getCourseGoalTimerText(runState: ActiveCourseRunState): string {
    return getCourseGoalTimerText(runState, (ms) => this.formatOverlayTimer(ms));
  }

  private getPlayGoalProgressText(runState: GoalRunState): string {
    if (runState.qualificationState === 'practice') {
      return runState.leaderboardEligible ? 'Reach spawn to rank' : 'Reach spawn to start';
    }

    switch (runState.goal.type) {
      case 'reach_exit':
        return runState.result === 'completed' ? 'Exit reached' : 'Reach the exit';
      case 'collect_target':
        return `${runState.collectiblesCollected}/${runState.goal.requiredCount} collected`;
      case 'defeat_all':
        return `${runState.enemiesDefeated}/${runState.enemyTarget ?? 0} defeated`;
      case 'checkpoint_sprint':
        return `${runState.checkpointsReached}/${runState.checkpointTarget ?? 0} checkpoints`;
      case 'survival':
        return runState.result === 'completed' ? 'Survived' : 'Stay alive';
    }
  }

  private getCourseGoalProgressText(runState: ActiveCourseRunState): string {
    return getCourseGoalProgressText(runState);
  }

  private formatOverlayTimer(ms: number): string {
    const clampedMs = Math.max(0, Math.round(ms));
    const totalSeconds = Math.floor(clampedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const tenths = Math.floor((clampedMs % 1000) / 100);
    return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
  }

  private truncateOverlayText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, Math.max(1, maxLength - 1))}\u2026`;
  }

  private syncGoalOverlayScale(): void {
    const zoom = this.cameras.main.zoom;
    this.browseOverlayController.syncScale(zoom);
    this.presenceOverlayController.syncOverlayScale();
  }

  private renderHud(statusOverride?: string): void {
    const selectedRoomId = roomIdFromCoordinates(this.selectedCoordinates);
    const selectedState = this.getCellStateAt(this.selectedCoordinates);
    const selectedDraft = this.draftRoomsById.get(selectedRoomId) ?? null;
    const selectedCourse = this.getSelectedCourseContext();
    const activeCourseRun = this.mode === 'play' ? this.activeCourseRun : null;
    const activeRoomGoalRun = activeCourseRun ? null : this.mode === 'play' ? this.currentGoalRun : null;
    const activeGoalRoom = activeRoomGoalRun
      ? this.getRoomSnapshotForCoordinates(activeRoomGoalRun.roomCoordinates)
      : null;
    const onlineRosterEntries = this.presenceController
      .getOnlineRoster()
      .map((entry) => ({
        key: entry.key,
        userId: entry.userId,
        displayName: entry.displayName,
        roomText: `Room ${entry.roomId}`,
        isSelf: entry.isSelf,
      }));

    this.hudBridge?.render(
      buildOverworldHudViewModel({
        selectedState,
        selectedCoordinates: this.selectedCoordinates,
        selectedSummary: this.selectedSummary
          ? {
              title: this.selectedSummary.title ?? null,
              creatorUserId: this.selectedSummary.creatorUserId ?? null,
              creatorDisplayName: this.selectedSummary.creatorDisplayName ?? null,
              goalType: this.selectedSummary.goalType ?? null,
            }
          : null,
        selectedDraft,
        selectedPopulation: this.getRoomPopulation(this.selectedCoordinates),
        selectedEditorCount: this.getRoomEditorCount(this.selectedCoordinates),
        selectedEditorSummary: formatRoomEditorSummary(
          this.getRoomEditorDisplayNames(this.selectedCoordinates),
        ),
        selectedCourse,
        selectedRoomInActiveCourseSession: isRoomInActiveCourseDraftSession(selectedRoomId),
        frontierBuildBlocked:
          selectedState === 'frontier' && this.isFrontierBuildBlockedByClaimLimit(),
        frontierClaimLimit: getAuthDebugState().roomDailyClaimLimit,
        transientStatus: this.getTransientStatusMessage(),
        statusOverride,
        mode: this.mode,
        goalPersistentStatusText: this.goalRunController.getPersistentStatusText() ?? null,
        rankingMode: this.currentRoomLeaderboard?.rankingMode ?? null,
        roomTop: this.currentRoomLeaderboard?.entries[0] ?? null,
        activeCourseRun,
        activeRoomGoalRun,
        activeGoalRoom,
        totalPlayerCount: this.presenceController.getTotalPlayerCount(),
        onlineRosterEntries,
        score: this.score,
        courseBuilderButtonDisabled: this.courseComposerLoading,
        zoom: this.cameras.main.zoom,
        getRoomDisplayTitle: (title, coordinates) => this.getRoomDisplayTitle(title, coordinates),
        getCourseGoalSummaryText: (goalType) => this.getCourseGoalSummaryText(goalType),
        getCourseGoalBadgeText: (goal) => this.getCourseGoalBadgeText(goal),
        getGoalBadgeText: (goal) => this.getGoalBadgeText(goal),
        getCourseGoalTimerText: (runState) => this.getCourseGoalTimerText(runState),
        getPlayGoalTimerText: (runState) => this.getPlayGoalTimerText(runState),
        getCourseGoalProgressText: (runState) => this.getCourseGoalProgressText(runState),
        getPlayGoalProgressText: (runState) => this.getPlayGoalProgressText(runState),
        truncateOverlayText: (text, maxChars) => this.truncateOverlayText(text, maxChars),
      }),
    );
    this.syncGoalOverlayScale();
  }

  private getRoomDisplayTitle(title: string | null, coordinates: RoomCoordinates): string {
    return title?.trim() ? title : `Room ${coordinates.x},${coordinates.y}`;
  }

  private isFrontierBuildBlockedByClaimLimit(): boolean {
    const authState = getAuthDebugState();
    return (
      authState.authenticated &&
      authState.roomClaimsRemainingToday !== null &&
      authState.roomClaimsRemainingToday <= 0
    );
  }

  private syncAppMode(): void {
    setAppMode(this.mode === 'play' ? 'play-world' : 'world');
  }

  getSelectedRoomContext(): {
    roomId: string;
    coordinates: RoomCoordinates;
    state: SelectedCellState;
    courseId: string | null;
    courseTitle: string | null;
    courseGoalType: CourseGoalType | null;
    courseRoomCount: number | null;
  } {
    return {
      roomId: roomIdFromCoordinates(this.selectedCoordinates),
      coordinates: { ...this.selectedCoordinates },
      state: this.getCellStateAt(this.selectedCoordinates),
      courseId: this.getSelectedCourseContext()?.courseId ?? null,
      courseTitle: this.getSelectedCourseContext()?.courseTitle ?? null,
      courseGoalType: this.getSelectedCourseContext()?.goalType ?? null,
      courseRoomCount: this.getSelectedCourseContext()?.roomCount ?? null,
    };
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
    this.presenceController.destroy();
    window.removeEventListener(AUTH_STATE_CHANGED_EVENT, this.handleAuthStateChanged);
    window.removeEventListener(PLAYFUN_GAME_PAUSE_EVENT, this.handlePlayfunGamePause);
    window.removeEventListener(PLAYFUN_GAME_RESUME_EVENT, this.handlePlayfunGameResume);
    this.playfunPauseDepth = 0;
    this.playfunPauseApplied = false;
    this.scale.off('resize', this.handleResize, this);
    this.events.off(Phaser.Scenes.Events.WAKE, this.handleWake, this);
    this.inspectInputController.destroy();
    this.input.removeAllListeners();
    this.input.keyboard?.removeAllListeners();
    this.game.canvas.removeEventListener('wheel', this.handleCanvasWheel);
    delete (window as Window & { get_zoom_debug?: () => ZoomDebugState | null }).get_zoom_debug;
    this.hudBridge?.destroy();
    this.hudBridge = null;
    this.fxController?.destroy();
    this.fxController = null;

    this.destroyPlayer();
    this.worldStreamingController.destroy();
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
    this.goalMarkerController.destroy();
    this.gridOverlayController.destroy();
    this.browseOverlayController.destroy();
    this.roomCellController.destroy();
    this.presenceOverlayController.destroy();
  };

  describeState(): Record<string, unknown> {
    const camera = this.cameras.main;
    const cameraBounds = camera.getBounds();
    const goalRunSnapshot = this.goalRunController.getDebugSnapshot();
    const streamingMetrics = this.worldStreamingController.getDebugMetrics();
    const presenceDebug = this.presenceController.getDebugSnapshot();
    const currentLoadedRoom = this.loadedFullRoomsById.get(
      roomIdFromCoordinates(this.currentRoomCoordinates)
    ) ?? null;
    const currentRoomParallaxLayer =
      currentLoadedRoom?.backgroundSprites.find(
        (backgroundSprite) => Math.abs(backgroundSprite.parallax) > 0.0001
      ) ?? null;
    const liveObjects = Array.from(this.loadedFullRoomsById.values()).flatMap((loadedRoom) =>
      loadedRoom.liveObjects
        .filter((liveObject) => liveObject.sprite.active)
        .map((liveObject) => {
          const body = liveObject.sprite.body as ArcadeObjectBody | null;
          const dynamicBody = isDynamicArcadeBody(body) ? body : null;
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
      performanceProfile: getDeviceLayoutState().performanceProfile,
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
        this.isWithinLoadedRoomBounds(room.coordinates)
      ).map((room) => room.id),
      chunkWindow: this.chunkWindow
        ? {
            chunkBounds: { ...this.chunkWindow.chunkBounds },
            roomBounds: { ...this.chunkWindow.roomBounds },
            loadedChunks: this.chunkWindow.chunks.map((chunk) => ({
              id: chunk.id,
              coordinates: { ...chunk.coordinates },
              roomCount: chunk.rooms.length,
            })),
          }
        : null,
      lod: {
        nearRoomIds: Array.from(this.nearLodRoomIds.values()).sort(),
        midRoomIds: Array.from(this.midLodRoomIds.values()).sort(),
        farRoomIds: Array.from(this.farLodRoomIds.values()).sort(),
      },
      lodMetrics: {
        activeChunkCount: this.chunkWindow?.chunks.length ?? 0,
        activeChunkRadius: streamingMetrics.activeChunkRadius,
        visibleRoomCount: streamingMetrics.visibleRoomCount,
        previewRoomBudget: streamingMetrics.previewRoomBudget,
        fullRoomBudget: streamingMetrics.fullRoomBudget,
        protectedVisiblePreviewRoomCount: streamingMetrics.protectedVisiblePreviewRoomCount,
        loadedPreviewRoomCount: streamingMetrics.loadedPreviewRoomCount,
        loadedFullRoomCount: streamingMetrics.loadedFullRoomCount,
      },
      currentRoomBackground: currentLoadedRoom
        ? {
            background: currentLoadedRoom.room.background,
            layerCount: currentLoadedRoom.backgroundSprites.length,
            sampleParallax: currentRoomParallaxLayer?.parallax ?? null,
            sampleTilePositionX: currentRoomParallaxLayer
              ? Number(currentRoomParallaxLayer.sprite.tilePositionX.toFixed(3))
              : null,
          }
        : null,
      loadedPreviewRooms: this.previewImages.length,
      loadedFullRooms: this.loadedFullRoomsById.size,
      score: this.score,
      keysHeld: this.heldKeyCount,
      goalRun: goalRunSnapshot.goalRun,
      leaderboards: goalRunSnapshot.leaderboards,
      collectibles: this.countLiveObjectsByCategory('collectible'),
      hazards: this.countLiveObjectsByCategory('hazard'),
      enemies: this.countLiveObjectsByCategory('enemy'),
      combat: {
        crouching: this.isCrouching,
        activeAttackAnimation: this.activeAttackAnimation,
        crateInteractionMode: this.activeCrateInteractionMode,
        crateInteractionFacing: this.activeCrateInteractionFacing,
        meleeCooldownMs: Math.max(0, this.meleeCooldownUntil - this.time.now),
        rangedCooldownMs: Math.max(0, this.rangedCooldownUntil - this.time.now),
        projectileCount: this.playerProjectiles.length,
      },
      presence: {
        status: presenceDebug.snapshot?.status ?? 'disabled',
        subscribedShardCount: presenceDebug.snapshot?.subscribedShards.length ?? 0,
        connectedShardCount: presenceDebug.snapshot?.connectedShards.length ?? 0,
        subscribedChunkBounds: presenceDebug.subscribedChunkBounds,
        renderedGhostCount: presenceDebug.renderedGhostCount,
        visibleGhostCount: presenceDebug.visibleGhostCount,
        ghostRenderBudget: presenceDebug.ghostRenderBudget,
        browseDotCount: this.presenceOverlayController.getBrowseDotCount(),
        playRoomMarkerCount: this.presenceOverlayController.getPlayRoomMarkerCount(),
      },
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
            crouching: this.isCrouching,
            climbing: this.isClimbingLadder,
            wallSliding: this.isWallSliding,
            wallContactSide: this.wallContactSide,
            wallJumpBlockedSide: this.wallJumpBlockedSide,
            wallJumpActive: this.wallJumpActive,
            wallJumpLockMs: Math.max(0, this.wallJumpLockUntil - this.time.now),
            ladderKey: this.activeLadderKey,
            animation: this.playerAnimationState,
            facing: this.playerFacing,
          }
        : null,
      presenceDebug: this.presenceController.getDebugSnapshot(),
      liveObjects,
    };
  }
}
