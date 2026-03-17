import Phaser from 'phaser';
import { playSfx, stopSfx } from '../audio/sfx';
import { createCourseRepository } from '../courses/courseRepository';
import {
  clearActiveCourseDraftSessionRoomOverride,
  getActiveCourseDraftSessionCourseId,
  getActiveCourseDraftSessionDraft,
  getActiveCourseDraftSessionRecord,
  getActiveCourseDraftSessionRoomOverrides,
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
  COURSE_GOAL_LABELS,
  cloneCourseSnapshot,
  createDefaultCourseRecord,
  getCourseRoomOrder,
  MAX_COURSE_ROOMS,
  type CourseGoal,
  type CourseGoalType,
  type CourseMarkerPoint,
  type CourseRecord,
  type CourseRoomRef,
  type CourseSnapshot,
} from '../courses/model';
import type { CourseRunFinishRequestBody } from '../courses/runModel';
import { SceneFxController } from '../fx/controller';
import {
  getObjectById,
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
import { ROOM_GOAL_LABELS, type GoalMarkerPoint, type RoomGoal } from '../goals/roomGoals';
import {
  createGoalMarkerFlagSprite,
  type GoalMarkerFlagVariant,
} from '../goals/markerFlags';
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
import { getAuthDebugState } from '../auth/client';
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
import { OverworldHudBridge, type OverworldHudViewModel } from './overworld/hud';
import {
  OverworldLiveObjectController,
  isDynamicArcadeBody,
  type ArcadeObjectBody,
  type LoadedRoomObject,
} from './overworld/liveObjects';
import { OverworldPresenceController } from './overworld/presence';
import {
  OverworldWorldStreamingController,
  type LoadedFullRoom,
} from './overworld/worldStreaming';
import {
  getTerrainTileCollisionProfile,
  terrainTileCollidesAtLocalPixel,
} from './overworld/terrainCollision';
import type {
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
const ROOM_BADGE_FADE_START_ZOOM = 0.14;
const ROOM_BADGE_HIDE_ZOOM = 0.11;
const ROOM_BADGE_SCALE_FULL_ZOOM = 0.5;
const ROOM_BADGE_LAYOUT_FULL_ZOOM = 0.32;
const ROOM_BADGE_MIN_SCREEN_SCALE = 0.72;
const ROOM_BADGE_MAX_SCREEN_SCALE = 1.45;
const BUTTON_ZOOM_FACTOR = 1.12;
const WHEEL_ZOOM_SENSITIVITY = 0.003;
const PLAY_ROOM_FIT_PADDING = 16;
const PAN_THRESHOLD = 4;
const EDGE_WALL_THICKNESS = 12;
const RESPAWN_FALL_DISTANCE = ROOM_PX_HEIGHT * 2;
const FOLLOW_CAMERA_LERP = 0.12;
const MOBILE_PLAY_CAMERA_TARGET_Y = 0.75;

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

interface GoalRoomBadge {
  container: Phaser.GameObjects.Container;
  zoomedInPosition: { x: number; y: number };
  zoomedOutPosition: { x: number; y: number };
}

interface RoomActivityBadge {
  container: Phaser.GameObjects.Container;
  zoomedInPosition: { x: number; y: number };
  zoomedOutPosition: { x: number; y: number };
}

interface CourseRoomBadge {
  container: Phaser.GameObjects.Container;
  zoomedInPosition: { x: number; y: number };
  zoomedOutPosition: { x: number; y: number };
}

interface CoursePublishedRoomMeta {
  roomId: string;
  coordinates: RoomCoordinates;
  roomVersion: number;
  roomTitle: string | null;
  publishedByUserId: string | null;
}

interface SelectedCourseContext {
  courseId: string;
  courseTitle: string | null;
  goalType: CourseGoalType | null;
  roomIndex: number;
  roomCount: number;
}

interface ActiveCourseRunState {
  course: CourseSnapshot;
  returnCoordinates: RoomCoordinates;
  elapsedMs: number;
  deaths: number;
  collectiblesCollected: number;
  collectibleTarget: number | null;
  enemiesDefeated: number;
  enemyTarget: number | null;
  checkpointsReached: number;
  checkpointTarget: number | null;
  nextCheckpointIndex: number;
  result: 'active' | 'completed' | 'failed';
  completionMessage: string | null;
  attemptId: string | null;
  submissionState: 'local-only' | 'starting' | 'active' | 'finishing' | 'submitted' | 'error';
  submissionMessage: string | null;
  pendingResult: 'completed' | 'failed' | 'abandoned' | null;
  submittedScore: number | null;
  leaderboardEligible: boolean;
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
  private modifierKeys!: {
    ALT: Phaser.Input.Keyboard.Key;
    SPACE: Phaser.Input.Keyboard.Key;
  };
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
  private roomGridGraphics!: Phaser.GameObjects.Graphics;
  private roomFillGraphics!: Phaser.GameObjects.Graphics;
  private roomFrameGraphics!: Phaser.GameObjects.Graphics;
  private goalMarkerSprites: Phaser.GameObjects.Sprite[] = [];
  private goalMarkerLabels: Phaser.GameObjects.Text[] = [];
  private roomGoalBadges: GoalRoomBadge[] = [];
  private roomActivityBadges: RoomActivityBadge[] = [];
  private roomCourseBadges: CourseRoomBadge[] = [];
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
  private readonly activeCourseRoomOverrideIds = new Set<string>();
  private courseComposerOpen = false;
  private courseComposerLoading = false;
  private courseComposerRecord: CourseRecord | null = null;
  private courseComposerStatusText: string | null = null;
  private courseComposerSelectedRoomEligible = false;
  private courseComposerSelectedRoomInDraft = false;
  private courseComposerSelectedRoomOrder: number | null = null;
  private readonly courseRoomMetaByRoomId = new Map<string, CoursePublishedRoomMeta>();
  private activeCourseRun: ActiveCourseRunState | null = null;

  private isPanning = false;
  private panStartPointer = { x: 0, y: 0 };
  private panCurrentPointer = { x: 0, y: 0 };
  private panStartScroll = { x: 0, y: 0 };
  private touchPointers = new Map<number, { x: number; y: number }>();
  private activePrimaryTouchId: number | null = null;
  private touchTapCandidate:
    | {
        pointerId: number;
        startX: number;
        startY: number;
      }
    | null = null;
  private touchPinchDistance = 0;
  private touchPinchAnchor = { x: 0, y: 0 };
  private altDown = false;
  private spaceDown = false;

  private coyoteTime = 0;
  private jumpBuffered = false;
  private jumpBufferTime = 0;
  private isClimbingLadder = false;
  private activeLadderKey: string | null = null;
  private collectedObjectKeys = new Set<string>();
  private heldKeyCount = 0;
  private score = 0;
  private readonly goalRunController: OverworldGoalRunController;
  private readonly liveObjectController: OverworldLiveObjectController<RoomEdgeWall>;
  private readonly worldStreamingController: OverworldWorldStreamingController<
    LoadedRoomObject,
    RoomEdgeWall
  >;
  private readonly presenceController: OverworldPresenceController;

  private shouldCenterCamera = false;
  private shouldRespawnPlayer = false;
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
      getPlacedObjectRuntimeKey: (roomId, placedIndex) =>
        this.getPlacedObjectRuntimeKey(roomId, placedIndex),
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
      onSnapshotUpdated: () => this.renderHud(),
      onRoomActivityChanged: () => this.redrawWorld(),
      onGhostDisplayObjectsChanged: () => this.syncBackdropCameraIgnores(),
    });
  }

  private get currentGoalRun(): GoalRunState | null {
    return this.goalRunController.getCurrentRun();
  }

  private get activeCourseSnapshot(): CourseSnapshot | null {
    return this.activeCourseRun?.course ?? null;
  }

  private getSelectedCourseContext(): SelectedCourseContext | null {
    const publishedCourse = this.selectedSummary?.course ?? null;
    if (publishedCourse) {
      return {
        courseId: publishedCourse.courseId,
        courseTitle: publishedCourse.courseTitle,
        goalType: publishedCourse.goalType,
        roomIndex: publishedCourse.roomIndex,
        roomCount: publishedCourse.roomCount,
      };
    }

    return null;
  }

  private getActiveCourseDraftSessionContextForRoom(roomId: string): EditorCourseEditData | null {
    const courseId = getActiveCourseDraftSessionCourseId();
    const draft = getActiveCourseDraftSessionDraft();
    if (!courseId || !draft) {
      return null;
    }

    const roomOrder = getCourseRoomOrder(draft.roomRefs, roomId);
    if (roomOrder < 0) {
      return null;
    }

    return {
      courseId,
      roomId,
      roomOrder,
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

  private getIsCurrentCourseDraftPreviewReady(): boolean {
    const draft = this.courseComposerRecord?.draft ?? null;
    if (!draft?.goal || draft.roomRefs.length === 0 || !draft.startPoint) {
      return false;
    }

    switch (draft.goal.type) {
      case 'reach_exit':
        return draft.goal.exit !== null;
      case 'checkpoint_sprint':
        return draft.goal.finish !== null && draft.goal.checkpoints.length > 0;
      case 'collect_target':
      case 'defeat_all':
      case 'survival':
        return true;
    }
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

  private get previewImagesByRoomId(): Map<string, Phaser.GameObjects.Image> {
    return this.worldStreamingController.getPreviewImagesByRoomId();
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
    window.addEventListener(PLAYFUN_GAME_PAUSE_EVENT, this.handlePlayfunGamePause);
    window.addEventListener(PLAYFUN_GAME_RESUME_EVENT, this.handlePlayfunGameResume);
    this.hudBridge = new OverworldHudBridge();
    this.fxController = new SceneFxController({
      scene: this,
      onDisplayObjectsChanged: () => this.syncBackdropCameraIgnores(),
    });

    this.setupControls();
    this.setupPointerControls();
    this.setupCamera();
    this.initializePresenceClient();
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
    this.updateBackdrop();
    this.redrawGridOverlay();
    this.updateLiveObjects(delta);
    this.updateGhosts(delta);

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
      this.syncLocalPresence();
      this.renderHud();
      return;
    }

    const touchInput = getTouchInputState();
    const touchLeft = touchInput.active && touchInput.moveX <= -0.28;
    const touchRight = touchInput.active && touchInput.moveX >= 0.28;
    const touchUp = touchInput.active && touchInput.moveY <= -0.46;
    const touchDown = touchInput.active && touchInput.moveY >= 0.42;
    const left = this.cursors.left.isDown || this.wasd.A.isDown || touchLeft;
    const right = this.cursors.right.isDown || this.wasd.D.isDown || touchRight;
    const horizontalInput = (right ? 1 : 0) - (left ? 1 : 0);
    const upHeld = this.cursors.up.isDown || this.wasd.W.isDown || touchUp;
    const downHeld = this.cursors.down.isDown || this.wasd.S.isDown || touchDown;
    const verticalInput = (downHeld ? 1 : 0) - (upHeld ? 1 : 0);
    const touchJumpPressed = consumeTouchAction('jump');
    const upPressed =
      Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
      Phaser.Input.Keyboard.JustDown(this.wasd.W) ||
      touchJumpPressed;
    const spacePressed = Phaser.Input.Keyboard.JustDown(this.cursors.space!) || touchJumpPressed;
    const overlappingLadder = this.findOverlappingLadder();
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
          this.playerBody.setVelocityY(
            inQuicksand ? this.JUMP_VELOCITY * this.QUICKSAND_JUMP_FACTOR : this.JUMP_VELOCITY
          );
          this.fxController?.playJumpDustFx(
            this.player?.x ?? this.playerBody.center.x,
            this.playerBody.bottom,
            this.playerFacing
          );
          this.jumpBuffered = false;
          this.coyoteTime = 0;
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
    this.isPanning = false;
    this.panStartPointer = { x: 0, y: 0 };
    this.panCurrentPointer = { x: 0, y: 0 };
    this.panStartScroll = { x: 0, y: 0 };
    this.touchPointers = new Map();
    this.activePrimaryTouchId = null;
    this.touchTapCandidate = null;
    this.touchPinchDistance = 0;
    this.touchPinchAnchor = { x: 0, y: 0 };
    this.altDown = false;
    this.spaceDown = false;
    this.coyoteTime = 0;
    this.jumpBuffered = false;
    this.jumpBufferTime = 0;
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
    this.destroyRoomGoalBadges();
    this.destroyRoomActivityBadges();
    this.destroyRoomCourseBadges();
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
    this.activeCourseRoomOverrideIds.clear();
    this.activeCourseRun = null;
    this.hudBridge?.destroy();
    this.hudBridge = null;
    this.fxController?.destroy();
    this.emitCourseComposerStateChanged();
  }

  private initializePresenceClient(): void {
    this.presenceController.initialize();
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
    this.attackKeys = {
      Q: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
      E: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
    };
    this.cameraToggleKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.BACKTICK);
    this.modifierKeys = {
      ALT: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ALT),
      SPACE: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
    };
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
      if (this.handleTouchPointerDown(pointer)) {
        return;
      }

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
      if (this.handleTouchPointerMove(pointer)) {
        return;
      }

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

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (this.handleTouchPointerUp(pointer)) {
        return;
      }

      const wasPanning = this.isPanning;
      this.isPanning = false;

      if (wasPanning && this.mode === 'browse') {
        this.syncBrowseWindowToCamera();
      }
    });
  }

  private handleTouchPointerDown(pointer: Phaser.Input.Pointer): boolean {
    if (!this.isTouchPointer(pointer)) {
      return false;
    }

    this.touchPointers.set(pointer.id, { x: pointer.x, y: pointer.y });

    if (this.touchPointers.size >= 2) {
      this.touchTapCandidate = null;
      this.activePrimaryTouchId = null;
      this.beginTouchPinchGesture();
      return true;
    }

    this.activePrimaryTouchId = pointer.id;
    this.touchTapCandidate = {
      pointerId: pointer.id,
      startX: pointer.x,
      startY: pointer.y,
    };
    this.panStartPointer = { x: pointer.x, y: pointer.y };
    this.panCurrentPointer = { x: pointer.x, y: pointer.y };
    this.panStartScroll = {
      x: this.cameras.main.scrollX,
      y: this.cameras.main.scrollY,
    };
    return true;
  }

  private handleTouchPointerMove(pointer: Phaser.Input.Pointer): boolean {
    if (!this.isTouchPointer(pointer)) {
      return false;
    }

    if (!this.touchPointers.has(pointer.id)) {
      return true;
    }

    this.touchPointers.set(pointer.id, { x: pointer.x, y: pointer.y });

    if (this.touchPointers.size >= 2) {
      this.handleTouchPinchMove();
      return true;
    }

    if (this.activePrimaryTouchId !== pointer.id) {
      return true;
    }

    this.panCurrentPointer = { x: pointer.x, y: pointer.y };
    const distance = Phaser.Math.Distance.Between(
      this.panStartPointer.x,
      this.panStartPointer.y,
      pointer.x,
      pointer.y,
    );

    if (distance < PAN_THRESHOLD) {
      return true;
    }

    if (this.mode === 'browse' || (this.mode === 'play' && this.cameraMode === 'inspect')) {
      const camera = this.cameras.main;
      const dx = (this.panStartPointer.x - pointer.x) / camera.zoom;
      const dy = (this.panStartPointer.y - pointer.y) / camera.zoom;
      camera.setScroll(this.panStartScroll.x + dx, this.panStartScroll.y + dy);
      this.constrainInspectCamera();
      this.touchTapCandidate = null;
    }

    return true;
  }

  private handleTouchPointerUp(pointer: Phaser.Input.Pointer): boolean {
    if (!this.isTouchPointer(pointer)) {
      return false;
    }

    const wasPinching = this.touchPointers.size >= 2;
    this.touchPointers.delete(pointer.id);

    if (wasPinching) {
      if (this.touchPointers.size === 1) {
        const [remainingId, remainingPoint] = Array.from(this.touchPointers.entries())[0];
        this.activePrimaryTouchId = remainingId;
        this.touchTapCandidate = {
          pointerId: remainingId,
          startX: remainingPoint.x,
          startY: remainingPoint.y,
        };
        this.panStartPointer = { ...remainingPoint };
        this.panCurrentPointer = { ...remainingPoint };
        this.panStartScroll = {
          x: this.cameras.main.scrollX,
          y: this.cameras.main.scrollY,
        };
      } else {
        this.activePrimaryTouchId = null;
        this.touchTapCandidate = null;
      }
      return true;
    }

    if (this.touchTapCandidate?.pointerId === pointer.id) {
      const movedDistance = Phaser.Math.Distance.Between(
        this.touchTapCandidate.startX,
        this.touchTapCandidate.startY,
        pointer.x,
        pointer.y,
      );
      if (movedDistance < PAN_THRESHOLD && this.mode === 'browse') {
        this.handleRoomSelection(pointer);
      } else if (this.mode === 'browse') {
        this.syncBrowseWindowToCamera();
      }
    } else if (this.mode === 'browse') {
      this.syncBrowseWindowToCamera();
    }

    this.touchTapCandidate = null;
    this.activePrimaryTouchId = null;
    return true;
  }

  private beginTouchPinchGesture(): void {
    const points = Array.from(this.touchPointers.values());
    if (points.length < 2) {
      return;
    }

    const [firstPoint, secondPoint] = points;
    this.touchPinchDistance = Phaser.Math.Distance.Between(
      firstPoint.x,
      firstPoint.y,
      secondPoint.x,
      secondPoint.y,
    );
    this.touchPinchAnchor = {
      x: (firstPoint.x + secondPoint.x) * 0.5,
      y: (firstPoint.y + secondPoint.y) * 0.5,
    };
    this.panStartScroll = {
      x: this.cameras.main.scrollX,
      y: this.cameras.main.scrollY,
    };
  }

  private handleTouchPinchMove(): void {
    const points = Array.from(this.touchPointers.values());
    if (points.length < 2) {
      return;
    }

    const [firstPoint, secondPoint] = points;
    const nextDistance = Phaser.Math.Distance.Between(
      firstPoint.x,
      firstPoint.y,
      secondPoint.x,
      secondPoint.y,
    );
    if (this.touchPinchDistance <= 0) {
      this.touchPinchDistance = nextDistance;
      return;
    }

    const anchorX = (firstPoint.x + secondPoint.x) * 0.5;
    const anchorY = (firstPoint.y + secondPoint.y) * 0.5;
    const zoomFactor = nextDistance / this.touchPinchDistance;
    if (Math.abs(zoomFactor - 1) > 0.02) {
      this.adjustZoomByFactor(zoomFactor, anchorX, anchorY);
      this.touchPinchDistance = nextDistance;
    }

    if (this.mode === 'browse' || (this.mode === 'play' && this.cameraMode === 'inspect')) {
      const camera = this.cameras.main;
      const centerX = anchorX;
      const centerY = anchorY;
      const dx = (this.touchPinchAnchor.x - centerX) / camera.zoom;
      const dy = (this.touchPinchAnchor.y - centerY) / camera.zoom;
      camera.setScroll(this.panStartScroll.x + dx, this.panStartScroll.y + dy);
      this.constrainInspectCamera();
    }
  }

  private isTouchPointer(pointer: Phaser.Input.Pointer): boolean {
    const layout = getDeviceLayoutState();
    if (!layout.coarsePointer) {
      return false;
    }

    const event = pointer.event as PointerEvent | MouseEvent | undefined;
    if (!event) {
      return layout.coarsePointer;
    }

    if ('pointerType' in event && typeof event.pointerType === 'string') {
      return event.pointerType === 'touch' || event.pointerType === 'pen';
    }

    return layout.coarsePointer;
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

    if (this.roomFillGraphics) ignoredObjects.push(this.roomFillGraphics);
    if (this.roomGridGraphics) ignoredObjects.push(this.roomGridGraphics);
    if (this.roomFrameGraphics) ignoredObjects.push(this.roomFrameGraphics);
    if (this.loadingText) ignoredObjects.push(this.loadingText);
    if (this.zoomDebugGraphics) ignoredObjects.push(this.zoomDebugGraphics);
    if (this.zoomDebugText) ignoredObjects.push(this.zoomDebugText);
    for (const sprite of this.goalMarkerSprites) {
      ignoredObjects.push(sprite);
    }
    for (const label of this.goalMarkerLabels) {
      ignoredObjects.push(label);
    }
    for (const badge of this.roomGoalBadges) {
      ignoredObjects.push(badge.container);
    }
    for (const badge of this.roomActivityBadges) {
      ignoredObjects.push(badge.container);
    }
    for (const badge of this.roomCourseBadges) {
      ignoredObjects.push(badge.container);
    }
    if (this.player) ignoredObjects.push(this.player);
    if (this.playerSprite) ignoredObjects.push(this.playerSprite);
    for (const projectile of this.playerProjectiles) {
      ignoredObjects.push(projectile.rect);
    }

    for (const image of this.previewImagesByRoomId.values()) {
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
    ignoredObjects.push(...(this.fxController?.getBackdropIgnoredObjects() ?? []));

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
    if (!this.isWithinLoadedRoomBounds(coordinates)) {
      return;
    }

    this.selectedCoordinates = coordinates;
    if (this.mode !== 'play') {
      this.currentRoomCoordinates = { ...coordinates };
    }
    setActiveCourseDraftSessionSelectedRoom(roomIdFromCoordinates(coordinates));
    this.updateSelectedSummary();
    void this.refreshCourseComposerSelectedRoomState();
    void this.refreshLeaderboardForSelection();
    this.redrawWorld();
    this.renderHud();
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
    this.redrawGridOverlay();
    this.renderHud();
  }

  private handleWake = (_sys: Phaser.Scenes.Systems, data?: OverworldPlaySceneData): void => {
    void this.handleWakeAsync(data);
  };

  private async handleWakeAsync(data?: OverworldPlaySceneData): Promise<void> {
    this.applySceneData(data);
    if (data?.courseDraftPreviewId) {
      const draft = getActiveCourseDraftSessionDraft();
      if (draft?.id === data.courseDraftPreviewId && draft.goal) {
        await this.activateDraftCoursePreview(draft, data.draftRoom ?? null);
      }
    }
    this.syncAppMode();
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
    this.mode = 'browse';
    this.cameraMode = 'inspect';
    this.syncAppMode();
    this.selectedCoordinates = { ...coordinates };
    this.currentRoomCoordinates = { ...coordinates };
    this.windowCenterCoordinates = { ...coordinates };
    this.shouldCenterCamera = true;
    this.shouldRespawnPlayer = false;
    playSfx('warp');
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
    if (this.mode === 'browse') {
      this.browseInspectZoom = this.inspectZoom;
    }
    camera.setZoom(this.inspectZoom);
    this.centerCameraOnCoordinates(this.getZoomFocusCoordinates());
    this.refreshChunkWindowIfNeeded(this.getZoomFocusCoordinates());
    this.updateBackdrop();
    this.redrawGridOverlay();
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
    this.redrawGridOverlay();
    this.renderHud();
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
    }
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
      this.applyGoalRunMutation(this.goalRunController.syncRunForRoom(currentRoom));
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
      const config = getObjectById(placedObject.id);
      if (config?.category === category) {
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
    for (const sprite of this.goalMarkerSprites) {
      sprite.destroy();
    }
    this.goalMarkerSprites = [];
    for (const label of this.goalMarkerLabels) {
      label.destroy();
    }
    this.goalMarkerLabels = [];

    if (!this.currentGoalRun && !this.activeCourseRun) {
      this.syncBackdropCameraIgnores();
      return;
    }

    const markers = this.activeCourseRun
      ? this.getCourseMarkerDescriptors(this.activeCourseRun)
      : this.getGoalMarkerDescriptors(this.currentGoalRun!);
    for (const marker of markers) {
      const sprite = createGoalMarkerFlagSprite(
        this,
        marker.variant,
        marker.point.x,
        marker.point.y + 2,
        21,
      );
      this.goalMarkerSprites.push(sprite);

      if (marker.label) {
        const label = this.add.text(marker.point.x, marker.point.y - 28, marker.label, {
          fontFamily: 'Courier New',
          fontSize: '12px',
          color: marker.textColor,
          stroke: '#050505',
          strokeThickness: 4,
        });
        label.setOrigin(0.5, 1);
        label.setDepth(22);
        this.goalMarkerLabels.push(label);
      }
    }

    this.syncBackdropCameraIgnores();
  }

  private destroyRoomGoalBadges(): void {
    for (const badge of this.roomGoalBadges) {
      badge.container.destroy(true);
    }
    this.roomGoalBadges = [];
  }

  private destroyRoomActivityBadges(): void {
    for (const badge of this.roomActivityBadges) {
      badge.container.destroy(true);
    }
    this.roomActivityBadges = [];
  }

  private destroyRoomCourseBadges(): void {
    for (const badge of this.roomCourseBadges) {
      badge.container.destroy(true);
    }
    this.roomCourseBadges = [];
  }

  private emitCourseComposerStateChanged(): void {
    window.dispatchEvent(new CustomEvent(COURSE_COMPOSER_STATE_CHANGED_EVENT));
  }

  private redrawRoomGoalBadges(): void {
    this.destroyRoomGoalBadges();

    if (!this.worldWindow || this.mode !== 'browse') {
      this.syncBackdropCameraIgnores();
      return;
    }

    const gridSize = this.worldWindow.radius * 2 + 1;
    for (let row = 0; row < gridSize; row += 1) {
      for (let col = 0; col < gridSize; col += 1) {
        const coordinates = {
          x: this.worldWindow.center.x + col - this.worldWindow.radius,
          y: this.worldWindow.center.y + row - this.worldWindow.radius,
        };
        const room = this.getRoomSnapshotForCoordinates(coordinates);
        if (!room?.goal) {
          continue;
        }

        const origin = this.getRoomOrigin(coordinates);
        const titleLabel = this.truncateOverlayText(
          this.getRoomDisplayTitle(room.title, coordinates).toUpperCase(),
          20
        );
        const goalLabel = this.truncateOverlayText(this.getGoalBadgeText(room.goal).toUpperCase(), 22);
        const backgroundWidth = Math.max(titleLabel.length * 6.3 + 12, goalLabel.length * 5.8 + 12, 84);
        const backgroundHeight = 26;
        const background = this.add.rectangle(0, 0, backgroundWidth, backgroundHeight, 0x050505, 0.84);
        background.setOrigin(0, 0);
        background.setStrokeStyle(1, 0x347433, 0.92);

        const titleText = this.add.text(6, 3, titleLabel, {
          fontFamily: 'Courier New',
          fontSize: '9px',
          color: '#f3eee2',
          stroke: '#050505',
          strokeThickness: 3,
        });
        const goalText = this.add.text(6, 13, goalLabel, {
          fontFamily: 'Courier New',
          fontSize: '9px',
          color: '#ffc107',
          stroke: '#050505',
          strokeThickness: 3,
        });

        const zoomedInPosition = { x: origin.x + 8, y: origin.y + 8 };
        const zoomedOutPosition = {
          x: origin.x + (ROOM_PX_WIDTH - backgroundWidth) * 0.5,
          y: origin.y + 22,
        };
        const container = this.add.container(zoomedInPosition.x, zoomedInPosition.y, [
          background,
          titleText,
          goalText,
        ]);
        container.setDepth(18);
        container.setScale(this.getRoomBadgeOverlayScale(this.cameras.main.zoom));
        this.roomGoalBadges.push({
          container,
          zoomedInPosition,
          zoomedOutPosition,
        });
      }
    }

    this.syncBackdropCameraIgnores();
  }

  private redrawRoomActivityBadges(): void {
    this.destroyRoomActivityBadges();

    if (!this.worldWindow || this.mode !== 'browse') {
      this.syncBackdropCameraIgnores();
      return;
    }

    const gridSize = this.worldWindow.radius * 2 + 1;
    for (let row = 0; row < gridSize; row += 1) {
      for (let col = 0; col < gridSize; col += 1) {
        const coordinates = {
          x: this.worldWindow.center.x + col - this.worldWindow.radius,
          y: this.worldWindow.center.y + row - this.worldWindow.radius,
        };
        const editorCount = this.getRoomEditorCount(coordinates);
        if (editorCount <= 0) {
          continue;
        }

        const origin = this.getRoomOrigin(coordinates);
        const label = editorCount === 1 ? 'BUILDING' : `${editorCount} BUILDING`;
        const backgroundWidth = Math.max(label.length * 5.9 + 10, 64);
        const background = this.add.rectangle(0, 0, backgroundWidth, 14, RETRO_COLORS.backgroundNumber, 0.88);
        background.setOrigin(0, 0);
        background.setStrokeStyle(1, RETRO_COLORS.frontier, 0.94);

        const labelText = this.add.text(5, 2, label, {
          fontFamily: 'Courier New',
          fontSize: '8px',
          color: '#ffcf86',
          stroke: '#050505',
          strokeThickness: 3,
        });

        const zoomedInPosition = { x: origin.x + 8, y: origin.y + ROOM_PX_HEIGHT - 22 };
        const zoomedOutPosition = {
          x: origin.x + (ROOM_PX_WIDTH - backgroundWidth) * 0.5,
          y: origin.y + ROOM_PX_HEIGHT - 22,
        };
        const container = this.add.container(zoomedInPosition.x, zoomedInPosition.y, [
          background,
          labelText,
        ]);
        container.setDepth(18);
        container.setScale(this.getRoomBadgeOverlayScale(this.cameras.main.zoom));
        this.roomActivityBadges.push({
          container,
          zoomedInPosition,
          zoomedOutPosition,
        });
      }
    }

    this.syncBackdropCameraIgnores();
  }

  private redrawRoomCourseBadges(): void {
    this.destroyRoomCourseBadges();

    if (!this.worldWindow || this.mode !== 'browse') {
      this.syncBackdropCameraIgnores();
      return;
    }

    const gridSize = this.worldWindow.radius * 2 + 1;
    for (let row = 0; row < gridSize; row += 1) {
      for (let col = 0; col < gridSize; col += 1) {
        const coordinates = {
          x: this.worldWindow.center.x + col - this.worldWindow.radius,
          y: this.worldWindow.center.y + row - this.worldWindow.radius,
        };
        const summary = this.roomSummariesById.get(roomIdFromCoordinates(coordinates));
        if (!summary?.course) {
          continue;
        }

        const origin = this.getRoomOrigin(coordinates);
        const titleLabel = this.truncateOverlayText(
          (summary.course.courseTitle?.trim() || 'COURSE').toUpperCase(),
          16
        );
        const goalLabel = this.truncateOverlayText(
          (summary.course.goalType ? COURSE_GOAL_LABELS[summary.course.goalType] : 'Course')
            .toUpperCase(),
          17
        );
        const backgroundWidth = Math.min(
          Math.max(titleLabel.length * 6.3 + 12, goalLabel.length * 5.8 + 12, 84),
          112
        );
        const backgroundHeight = 26;
        const background = this.add.rectangle(0, 0, backgroundWidth, backgroundHeight, 0x050505, 0.88);
        background.setOrigin(0, 0);
        background.setStrokeStyle(1, RETRO_COLORS.selected, 0.88);

        const titleText = this.add.text(6, 3, titleLabel, {
          fontFamily: 'Courier New',
          fontSize: '9px',
          color: '#9ddcff',
          stroke: '#050505',
          strokeThickness: 3,
        });
        const goalText = this.add.text(6, 13, goalLabel, {
          fontFamily: 'Courier New',
          fontSize: '8px',
          color: '#f3eee2',
          stroke: '#050505',
          strokeThickness: 3,
        });

        const zoomedInPosition = {
          x: origin.x + ROOM_PX_WIDTH - backgroundWidth - 8,
          y: origin.y + 8,
        };
        const zoomedOutPosition = {
          x: origin.x + (ROOM_PX_WIDTH - backgroundWidth) * 0.5,
          y: origin.y + 8,
        };
        const container = this.add.container(zoomedInPosition.x, zoomedInPosition.y, [
          background,
          titleText,
          goalText,
        ]);
        container.setDepth(18);
        container.setScale(this.getRoomBadgeOverlayScale(this.cameras.main.zoom));
        this.roomCourseBadges.push({
          container,
          zoomedInPosition,
          zoomedOutPosition,
        });
      }
    }

    this.syncBackdropCameraIgnores();
  }

  private getGoalMarkerDescriptors(runState: GoalRunState): Array<{
    point: GoalMarkerPoint;
    label: string | null;
    variant: GoalMarkerFlagVariant;
    textColor: string;
  }> {
    switch (runState.goal.type) {
      case 'reach_exit':
        return runState.goal.exit
          ? [{
              point: this.toWorldGoalPoint(runState.roomCoordinates, runState.goal.exit),
              label: null,
              variant: (runState.result === 'completed' ? 'finish-cleared' : 'finish-pending') as GoalMarkerFlagVariant,
              textColor: runState.result === 'completed' ? '#f6e6a6' : '#ffefef',
            }]
          : [];
      case 'checkpoint_sprint':
        return [
          ...runState.goal.checkpoints.map((checkpoint, index) => {
            const reached = index < runState.nextCheckpointIndex;
            return {
              point: this.toWorldGoalPoint(runState.roomCoordinates, checkpoint),
              label: `${index + 1}`,
              variant: (reached ? 'checkpoint-reached' : 'checkpoint-pending') as GoalMarkerFlagVariant,
              textColor: reached ? '#a9ffd0' : '#ffefef',
            };
          }),
          ...(runState.goal.finish
            ? [{
                point: this.toWorldGoalPoint(runState.roomCoordinates, runState.goal.finish),
                label: null,
                variant: (runState.result === 'completed' ? 'finish-cleared' : 'finish-pending') as GoalMarkerFlagVariant,
                textColor: runState.result === 'completed' ? '#f6e6a6' : '#ffefef',
              }]
            : []),
        ];
      default:
        return [];
    }
  }

  private getCourseMarkerDescriptors(runState: ActiveCourseRunState): Array<{
    point: GoalMarkerPoint;
    label: string | null;
    variant: GoalMarkerFlagVariant;
    textColor: string;
  }> {
    const goal = runState.course.goal;
    if (!goal) {
      return [];
    }

    const markers: Array<{
      point: GoalMarkerPoint;
      label: string | null;
      variant: GoalMarkerFlagVariant;
      textColor: string;
    }> = [];

    if (runState.course.startPoint) {
      markers.push({
        point: this.toWorldCoursePoint(runState.course.startPoint),
        label: 'S',
        variant: 'checkpoint-pending',
        textColor: '#9fdcff',
      });
    }

    if (goal.type === 'reach_exit' && goal.exit) {
      markers.push({
        point: this.toWorldCoursePoint(goal.exit),
        label: null,
        variant: (runState.result === 'completed' ? 'finish-cleared' : 'finish-pending') as GoalMarkerFlagVariant,
        textColor: runState.result === 'completed' ? '#f6e6a6' : '#ffefef',
      });
    }

    if (goal.type === 'checkpoint_sprint') {
      for (let index = 0; index < goal.checkpoints.length; index += 1) {
        const checkpoint = goal.checkpoints[index];
        const reached = index < runState.nextCheckpointIndex;
        markers.push({
          point: this.toWorldCoursePoint(checkpoint),
          label: `${index + 1}`,
          variant: (reached ? 'checkpoint-reached' : 'checkpoint-pending') as GoalMarkerFlagVariant,
          textColor: reached ? '#a9ffd0' : '#ffefef',
        });
      }

      if (goal.finish) {
        markers.push({
          point: this.toWorldCoursePoint(goal.finish),
          label: null,
          variant: (runState.result === 'completed' ? 'finish-cleared' : 'finish-pending') as GoalMarkerFlagVariant,
          textColor: runState.result === 'completed' ? '#f6e6a6' : '#ffefef',
        });
      }
    }

    return markers;
  }

  private toWorldGoalPoint(
    roomCoordinates: RoomCoordinates,
    point: GoalMarkerPoint
  ): GoalMarkerPoint {
    const origin = this.getRoomOrigin(roomCoordinates);
    return {
      x: origin.x + point.x,
      y: origin.y + point.y,
    };
  }

  private toWorldCoursePoint(point: CourseMarkerPoint): GoalMarkerPoint {
    const roomRef =
      this.activeCourseSnapshot?.roomRefs.find((candidate) => candidate.roomId === point.roomId) ??
      this.courseComposerRecord?.draft.roomRefs.find((candidate) => candidate.roomId === point.roomId) ??
      null;

    const origin = this.getRoomOrigin(roomRef?.coordinates ?? this.selectedCoordinates);
    return {
      x: origin.x + point.x,
      y: origin.y + point.y,
    };
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
      const currentRoomId = roomIdFromCoordinates(roomCoordinates);
      const neighborRoomId = roomIdFromCoordinates(neighborCoordinates);
      const currentIndex = this.activeCourseSnapshot.roomRefs.findIndex(
        (roomRef) => roomRef.roomId === currentRoomId
      );
      const neighborIndex = this.activeCourseSnapshot.roomRefs.findIndex(
        (roomRef) => roomRef.roomId === neighborRoomId
      );
      return currentIndex >= 0 && neighborIndex >= 0 && Math.abs(currentIndex - neighborIndex) === 1;
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
    this.roomFillGraphics.clear();
    this.roomFrameGraphics.clear();

    if (!this.worldWindow) {
      this.destroyRoomGoalBadges();
      this.destroyRoomActivityBadges();
      this.destroyRoomCourseBadges();
      return;
    }

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

    this.redrawRoomGoalBadges();
    this.redrawRoomActivityBadges();
    this.redrawRoomCourseBadges();
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
    if (this.activeCourseSnapshot && this.isRoomInActiveCourse(coordinates)) {
      this.drawActiveCourseBoundary(coordinates, x, y);
      return;
    }

    const editorCount = this.getRoomEditorCount(coordinates);
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

    if (editorCount > 0 && cellState !== 'draft') {
      this.roomFrameGraphics.lineStyle(2, RETRO_COLORS.frontier, 0.88);
      this.roomFrameGraphics.strokeRect(x + 14, y + 14, ROOM_PX_WIDTH - 28, ROOM_PX_HEIGHT - 28);
    }
  }

  private drawActiveCourseBoundary(
    coordinates: RoomCoordinates,
    x: number,
    y: number
  ): void {
    const lineInset = 4;
    const left = x + lineInset;
    const right = x + ROOM_PX_WIDTH - lineInset;
    const top = y + lineInset;
    const bottom = y + ROOM_PX_HEIGHT - lineInset;
    const neighbors = {
      left: this.isRoomInActiveCourse({ x: coordinates.x - 1, y: coordinates.y }),
      right: this.isRoomInActiveCourse({ x: coordinates.x + 1, y: coordinates.y }),
      up: this.isRoomInActiveCourse({ x: coordinates.x, y: coordinates.y - 1 }),
      down: this.isRoomInActiveCourse({ x: coordinates.x, y: coordinates.y + 1 }),
    };

    this.roomFrameGraphics.lineStyle(3, RETRO_COLORS.draft, 0.92);
    if (!neighbors.left) {
      this.roomFrameGraphics.lineBetween(left, top, left, bottom);
    }
    if (!neighbors.right) {
      this.roomFrameGraphics.lineBetween(right, top, right, bottom);
    }
    if (!neighbors.up) {
      this.roomFrameGraphics.lineBetween(left, top, right, top);
    }
    if (!neighbors.down) {
      this.roomFrameGraphics.lineBetween(left, bottom, right, bottom);
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
    const layout = getDeviceLayoutState();
    if (layout.deviceClass !== 'phone' || !layout.coarsePointer || layout.mobileLandscapeBlocked) {
      return 0;
    }

    const visibleWorldHeight = camera.height / Math.max(camera.zoom, 0.001);
    return Math.round((MOBILE_PLAY_CAMERA_TARGET_Y - 0.5) * visibleWorldHeight);
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

  private getFitZoomForRoom(): number {
    const fitZoom = Math.min(
      (this.scale.width - PLAY_ROOM_FIT_PADDING) / ROOM_PX_WIDTH,
      (this.scale.height - PLAY_ROOM_FIT_PADDING) / ROOM_PX_HEIGHT
    );

    return Phaser.Math.Clamp(fitZoom, MIN_ZOOM, MAX_ZOOM);
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

    if (room.spawnPoint) {
      const origin = this.getRoomOrigin(room.coordinates);
      return {
        x: origin.x + room.spawnPoint.x,
        y: origin.y + room.spawnPoint.y - this.PLAYER_HEIGHT / 2,
      };
    }

    return this.getSurfaceSpawn(room);
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
        const profile = getTerrainTileCollisionProfile(room, tileX, surfaceTileY);
        return {
          x: origin.x + tileX * TILE_SIZE + TILE_SIZE / 2,
          y: origin.y + surfaceTileY * TILE_SIZE + profile.topInset - this.PLAYER_HEIGHT / 2,
        };
      }
    }

    const origin = this.getRoomOrigin(room.coordinates);
    return {
      x: origin.x + ROOM_PX_WIDTH / 2,
      y: origin.y + TILE_SIZE * 2,
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
    if (this.activeCrateInteractionFacing !== null) {
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
    const runState = this.activeCourseRun;
    if (!runState || runState.result !== 'active') {
      return;
    }

    runState.elapsedMs += delta;
    const goal = runState.course.goal;
    if (!goal || !this.playerBody || !this.player) {
      return;
    }

    if ('timeLimitMs' in goal && goal.timeLimitMs !== null && runState.elapsedMs >= goal.timeLimitMs) {
      this.failCourseRun('Time up.');
      return;
    }

    if (goal.type === 'survival' && runState.elapsedMs >= goal.durationMs) {
      this.completeCourseRun('Course cleared.');
      return;
    }

    if (goal.type === 'reach_exit' && goal.exit && this.playerTouchesGoalPoint(this.toWorldCoursePoint(goal.exit))) {
      this.completeCourseRun('Exit reached.');
      return;
    }

    if (goal.type === 'checkpoint_sprint') {
      const nextCheckpoint = goal.checkpoints[runState.nextCheckpointIndex] ?? null;
      if (nextCheckpoint && this.playerTouchesGoalPoint(this.toWorldCoursePoint(nextCheckpoint))) {
        runState.nextCheckpointIndex += 1;
        runState.checkpointsReached += 1;
        this.showTransientStatus(`Checkpoint ${runState.checkpointsReached} reached.`);
        this.redrawGoalMarkers();
      }

      if (
        runState.nextCheckpointIndex >= goal.checkpoints.length &&
        goal.finish &&
        this.playerTouchesGoalPoint(this.toWorldCoursePoint(goal.finish))
      ) {
        this.completeCourseRun('Sprint clear.');
      }
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
    void this.finalizeActiveCourseRun('completed');
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
    void this.finalizeActiveCourseRun('failed');
  }

  private handlePlayerDeath(reason: string): void {
    const activeRun = this.currentGoalRun;
    const activeCourseRun = this.activeCourseRun;
    this.goalRunController.recordDeath();
    if (activeCourseRun && activeCourseRun.result === 'active') {
      activeCourseRun.deaths += 1;
    }
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
        this.applyGoalRunMutation(this.goalRunController.restartRunForRoom(goalRoom));
        void this.refreshLeaderboardForSelection();
        this.showTransientStatus(`${reason} Survival run restarted.`);
      }
      return;
    }

    this.showTransientStatus(reason);
  }

  private handleEnemyDefeated(roomId: string, enemyName: string): boolean {
    if (this.activeCourseRun?.result === 'active' && this.activeCourseRun.enemyTarget !== null) {
      this.activeCourseRun.enemiesDefeated += 1;
      if (this.activeCourseRun.enemiesDefeated >= this.activeCourseRun.enemyTarget) {
        this.completeCourseRun('All enemies defeated.');
      }
    }

    const result = this.goalRunController.recordEnemyDefeated(
      roomId,
      enemyName
    );
    this.applyGoalRunMutation(result);
    return Boolean(result.transientStatus);
  }

  private handleCollectibleCollected(roomId: string): void {
    if (this.activeCourseRun?.result === 'active' && this.activeCourseRun.collectibleTarget !== null) {
      this.activeCourseRun.collectiblesCollected += 1;
      if (this.activeCourseRun.collectiblesCollected >= this.activeCourseRun.collectibleTarget) {
        this.completeCourseRun('Collection target reached.');
      }
    }

    this.applyGoalRunMutation(this.goalRunController.recordCollectibleCollected(roomId));
  }

  private resetPlaySession(): void {
    this.goalRunController.abandonActiveRun();
    if (this.activeCourseRun?.result === 'active') {
      void this.finalizeActiveCourseRun('abandoned');
    }
    this.activeCourseRun = null;
    this.clearActiveCourseRoomOverrides();

    this.collectedObjectKeys.clear();
    this.heldKeyCount = 0;
    this.score = 0;
    this.isCrouching = false;
    this.activeAttackAnimation = null;
    this.activeAttackAnimationUntil = 0;
    this.externalLaunchGraceUntil = 0;
    this.destroyPlayerProjectiles();
    this.playerLandAnimationUntil = 0;
    this.goalRunController.reset();
    this.redrawGoalMarkers();
  }

  private resetSingleRoomChallengeStateOnRoomExit(runState: GoalRunState): void {
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
      const runtimeKey = this.getPlacedObjectRuntimeKey(room.id, index);
      if (!this.collectedObjectKeys.delete(runtimeKey)) {
        continue;
      }

      if (room.placedObjects[index]?.id === 'key') {
        restoredKeyCount += 1;
      }
    }

    return restoredKeyCount;
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

    const activeGoalRun = this.activeCourseRun ? null : this.currentGoalRun;
    if (
      activeGoalRun &&
      activeGoalRun.result === 'active' &&
      (nextRoomCoordinates.x !== activeGoalRun.roomCoordinates.x ||
        nextRoomCoordinates.y !== activeGoalRun.roomCoordinates.y)
    ) {
      this.resetSingleRoomChallengeStateOnRoomExit(activeGoalRun);
    }

    this.currentRoomCoordinates = { ...nextRoomCoordinates };
    this.selectedCoordinates = { ...nextRoomCoordinates };
    this.updateSelectedSummary();
    if (!this.activeCourseRun) {
      this.applyGoalRunMutation(
        this.goalRunController.syncRunForRoom(
          this.getRoomSnapshotForCoordinates(this.currentRoomCoordinates)
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
      this.refreshChunkWindowIfNeeded(nextCenterCoordinates);
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

  private isWithinLoadedRoomBounds(coordinates: RoomCoordinates): boolean {
    return this.worldStreamingController.isWithinLoadedRoomBounds(coordinates);
  }

  private getRoomOrigin(coordinates: RoomCoordinates): { x: number; y: number } {
    return {
      x: coordinates.x * ROOM_PX_WIDTH,
      y: coordinates.y * ROOM_PX_HEIGHT,
    };
  }

  private getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null {
    return this.worldStreamingController.getRoomSnapshotForCoordinates(coordinates);
  }

  private updateSelectedSummary(): void {
    this.selectedSummary = this.roomSummariesById.get(roomIdFromCoordinates(this.selectedCoordinates)) ?? null;
  }

  private getCellStateAt(coordinates: RoomCoordinates): SelectedCellState {
    const roomId = roomIdFromCoordinates(coordinates);
    if (this.activeCourseRoomOverrideIds.has(roomId)) {
      return 'published';
    }
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

  private isRoomInActiveCourse(coordinates: RoomCoordinates): boolean {
    const roomId = roomIdFromCoordinates(coordinates);
    return Boolean(this.activeCourseSnapshot?.roomRefs.some((roomRef) => roomRef.roomId === roomId));
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
    if (this.mode === 'browse') {
      this.browseInspectZoom = this.inspectZoom;
    }
    camera.setZoom(this.inspectZoom);

    if (this.mode === 'play' && this.cameraMode === 'follow' && this.player) {
      this.startFollowCamera(camera);
      return;
    }

    const focusCoordinates = this.mode === 'play' ? this.currentRoomCoordinates : this.selectedCoordinates;
    this.centerCameraOnCoordinates(focusCoordinates);
    this.constrainInspectCamera();
  }

  playSelectedRoom(): void {
    if (this.mode === 'play') {
      this.returnToWorld();
      return;
    }

    const selectedState = this.getCellStateAt(this.selectedCoordinates);
    if (selectedState !== 'published' && selectedState !== 'draft') return;

    this.resetPlaySession();
    this.browseInspectZoom = this.inspectZoom;
    this.mode = 'play';
    this.cameraMode = 'follow';
    this.inspectZoom = this.getFitZoomForRoom();
    this.syncAppMode();
    this.currentRoomCoordinates = { ...this.selectedCoordinates };
    this.shouldCenterCamera = true;
    this.shouldRespawnPlayer = true;
    setFocusedCoordinatesInUrl(this.currentRoomCoordinates);
    void this.refreshAround(this.currentRoomCoordinates);
  }

  returnToWorld(): void {
    const returnCoordinates = this.activeCourseRun?.returnCoordinates ?? this.currentRoomCoordinates;
    this.resetPlaySession();
    this.mode = 'browse';
    this.cameraMode = 'inspect';
    this.inspectZoom = this.browseInspectZoom;
    this.syncAppMode();
    this.selectedCoordinates = { ...returnCoordinates };
    this.currentRoomCoordinates = { ...returnCoordinates };
    this.shouldCenterCamera = true;
    this.shouldRespawnPlayer = false;
    void this.refreshAround(returnCoordinates);
  }

  buildSelectedRoom(): void {
    const selectedState = this.getCellStateAt(this.selectedCoordinates);
    if (selectedState !== 'frontier' || this.isFrontierBuildBlockedByClaimLimit()) return;

    const editorData: EditorSceneData = {
      roomCoordinates: { ...this.selectedCoordinates },
      source: 'world',
    };

    this.openEditor(editorData);
  }

  editSelectedRoom(): void {
    const selectedState = this.getCellStateAt(this.selectedCoordinates);
    if (selectedState !== 'published' && selectedState !== 'draft') return;
    const selectedRoomId = roomIdFromCoordinates(this.selectedCoordinates);
    const courseEdit = this.getActiveCourseDraftSessionContextForRoom(selectedRoomId);

    const editorData: EditorSceneData = {
      roomCoordinates: { ...this.selectedCoordinates },
      source: 'world',
      roomSnapshot: this.getRoomSnapshotForCoordinates(this.selectedCoordinates),
      courseEdit,
    };

    this.openEditor(editorData);
  }

  private openEditor(editorData: EditorSceneData): void {
    showBusyOverlay('Opening editor...', 'Loading room...');

    if (
      this.scene.isActive('EditorScene') ||
      this.scene.isSleeping('EditorScene') ||
      this.scene.isPaused('EditorScene')
    ) {
      this.scene.stop('EditorScene');
    }

    this.scene.sleep();
    this.scene.run('EditorScene', editorData);
  }

  editCurrentRoom(): void {
    this.editSelectedRoom();
  }

  async playSelectedCourse(): Promise<void> {
    if (this.activeCourseRun) {
      this.returnToWorld();
      return;
    }

    const selectedCourseId = this.getSelectedCourseContext()?.courseId ?? null;
    if (!selectedCourseId) {
      return;
    }

    showBusyOverlay('Starting course...', 'Loading course...');
    try {
      const record = await this.courseRepository.loadCourse(selectedCourseId);
      const snapshot = record.published ? cloneCourseSnapshot(record.published) : null;
      if (!snapshot || !snapshot.goal) {
        throw new Error('This course is not published yet.');
      }

      await this.startCoursePlayback(snapshot);
      hideBusyOverlay();
    } catch (error) {
      console.error('Failed to start course', error);
      showBusyError(
        error instanceof Error ? error.message : 'Failed to start course.',
        {
          closeHandler: () => hideBusyOverlay(),
        }
      );
    }
  }

  private async startCoursePlayback(snapshot: CourseSnapshot): Promise<void> {
    this.resetPlaySession();
    this.goalRunController.clearCurrentRun();
    await this.prepareActiveCourseRoomOverrides(snapshot);
    this.activeCourseRun = this.createCourseRunState(snapshot);

    if (this.activeCourseRun.leaderboardEligible) {
      void this.startRemoteCourseRun(this.activeCourseRun);
    }

    const startRoom = this.getCourseStartRoomRef(snapshot) ?? snapshot.roomRefs[0] ?? null;
    if (!startRoom) {
      throw new Error('This course has no playable rooms.');
    }

    this.browseInspectZoom = this.inspectZoom;
    this.mode = 'play';
    this.cameraMode = 'follow';
    this.inspectZoom = this.getFitZoomForRoom();
    this.syncAppMode();
    this.currentRoomCoordinates = { ...startRoom.coordinates };
    this.selectedCoordinates = { ...startRoom.coordinates };
    this.shouldCenterCamera = true;
    this.shouldRespawnPlayer = true;
    this.courseComposerStatusText = null;
    this.emitCourseComposerStateChanged();
    setFocusedCoordinatesInUrl(this.currentRoomCoordinates);
    await this.refreshAround(this.currentRoomCoordinates, { forceChunkReload: true });
  }

  async openCourseComposer(): Promise<void> {
    const authState = getAuthDebugState();
    this.courseComposerOpen = true;
    this.courseComposerLoading = true;
    this.emitCourseComposerStateChanged();

    try {
      const sessionRecord = getActiveCourseDraftSessionRecord();
      const selectedRoomId = roomIdFromCoordinates(this.selectedCoordinates);
      const selectedRoomInSession = Boolean(
        sessionRecord &&
        getCourseRoomOrder(sessionRecord.draft.roomRefs, selectedRoomId) >= 0
      );
      const selectedCourseId = selectedRoomInSession
        ? null
        : this.selectedSummary?.course?.courseId ?? null;
      let nextRecord: CourseRecord;
      if (selectedRoomInSession && sessionRecord) {
        nextRecord = sessionRecord;
      } else if (selectedCourseId && sessionRecord?.draft.id !== selectedCourseId) {
        nextRecord = await this.courseRepository.loadCourse(selectedCourseId);
      } else if (selectedCourseId && sessionRecord?.draft.id === selectedCourseId) {
        nextRecord = sessionRecord;
      } else if (sessionRecord) {
        nextRecord = sessionRecord;
      } else {
        nextRecord = createDefaultCourseRecord();
        nextRecord.ownerUserId = authState.user?.id ?? null;
        nextRecord.ownerDisplayName = authState.user?.displayName ?? null;
        nextRecord.permissions = {
          canSaveDraft: Boolean(authState.authenticated),
          canPublish: Boolean(authState.authenticated),
        };
      }

      const sanitized = this.sanitizeCourseComposerRecord(nextRecord);
      this.setCourseComposerRecord(sanitized.record, {
        selectedRoomId: roomIdFromCoordinates(this.selectedCoordinates),
      });
      this.courseComposerStatusText =
        sanitized.resetMessage ??
        (selectedRoomInSession
          ? 'Loaded active course draft.'
          : selectedCourseId
          ? 'Loaded course.'
          : authState.authenticated
            ? 'Build a linear 1-4 room course path.'
            : 'Sign in to author and publish courses.');
      await this.refreshCourseComposerSelectedRoomState();
    } catch (error) {
      console.error('Failed to open course composer', error);
      this.courseComposerStatusText =
        error instanceof Error ? error.message : 'Failed to open course builder.';
    } finally {
      this.courseComposerLoading = false;
      this.emitCourseComposerStateChanged();
      this.renderHud();
    }
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
      dirty: this.isCourseComposerDirty(),
      statusText: this.courseComposerLoading
        ? 'Loading course...'
        : this.courseComposerStatusText,
      selectedRoomOrder: this.courseComposerSelectedRoomOrder,
      canMoveSelectedRoomEarlier:
        this.courseComposerSelectedRoomOrder !== null && this.courseComposerSelectedRoomOrder > 0,
      canMoveSelectedRoomLater:
        this.courseComposerSelectedRoomOrder !== null &&
        this.courseComposerSelectedRoomOrder < draft.roomRefs.length - 1,
      canEditSelectedRoom:
        this.courseComposerRecord.permissions.canSaveDraft &&
        getActiveCourseDraftSessionSelectedRoomId() !== null,
      canTestDraft:
        this.courseComposerRecord.permissions.canSaveDraft && this.getIsCurrentCourseDraftPreviewReady(),
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
    const roomOrder = getActiveCourseDraftSessionSelectedRoomOrder();
    const roomRef = roomId
      ? this.courseComposerRecord.draft.roomRefs.find((candidate) => candidate.roomId === roomId) ?? null
      : null;
    if (roomOrder === null || roomOrder < 0) {
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
        roomOrder,
      },
    };

    this.openEditor(editorData);
    return true;
  }

  async testDraftCourse(): Promise<void> {
    const draft = this.courseComposerRecord?.draft ?? null;
    if (!this.courseComposerRecord?.permissions.canSaveDraft || !draft || !this.getIsCurrentCourseDraftPreviewReady()) {
      return;
    }

    showBusyOverlay('Testing draft course...', 'Loading draft...');
    try {
      const snapshot = cloneCourseSnapshot(draft);
      await this.startCoursePlayback(snapshot);
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
    if (!this.courseComposerRecord?.permissions.canSaveDraft) {
      return;
    }

    this.courseComposerStatusText = 'Saving course draft...';
    this.emitCourseComposerStateChanged();
    try {
      const saved = await this.courseRepository.saveDraft(this.courseComposerRecord.draft);
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
    if (!this.courseComposerRecord?.permissions.canPublish) {
      return;
    }

    this.courseComposerStatusText = 'Publishing course...';
    this.emitCourseComposerStateChanged();
    try {
      const saved = await this.courseRepository.saveDraft(this.courseComposerRecord.draft);
      this.setCourseComposerRecord(saved, {
        selectedRoomId: getActiveCourseDraftSessionSelectedRoomId(),
      });
      const published = await this.courseRepository.publishCourse(this.courseComposerRecord.draft.id);
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

      const firstRoomRef = draft.roomRefs[0];
      const lastRoomRef = draft.roomRefs[draft.roomRefs.length - 1];
      if (areCourseRoomRefsOrthogonallyAdjacent(nextRoomRef, firstRoomRef)) {
        draft.roomRefs = [nextRoomRef, ...draft.roomRefs];
        return;
      }

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
    this.updateCourseComposerDraft((draft) => {
      const currentIndex = draft.roomRefs.findIndex((roomRef) => roomRef.roomId === roomId);
      if (currentIndex < 0) {
        return;
      }

      const nextIndex = Phaser.Math.Clamp(currentIndex + direction, 0, draft.roomRefs.length - 1);
      if (nextIndex === currentIndex) {
        return;
      }

      const nextRoomRefs = [...draft.roomRefs];
      const [moved] = nextRoomRefs.splice(currentIndex, 1);
      nextRoomRefs.splice(nextIndex, 0, moved);
      if (!courseRoomRefsFollowLinearPath(nextRoomRefs)) {
        return;
      }
      draft.roomRefs = nextRoomRefs;
    });
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

    const firstRoomRef = this.courseComposerRecord.draft.roomRefs[0];
    const lastRoomRef =
      this.courseComposerRecord.draft.roomRefs[this.courseComposerRecord.draft.roomRefs.length - 1];
    return (
      areCourseRoomRefsOrthogonallyAdjacent(meta, firstRoomRef) ||
      areCourseRoomRefsOrthogonallyAdjacent(meta, lastRoomRef)
    );
  }

  private clearActiveCourseRoomOverrides(): void {
    for (const roomId of this.activeCourseRoomOverrideIds) {
      this.worldStreamingController.clearTransientRoomOverride(roomId);
    }
    this.activeCourseRoomOverrideIds.clear();
  }

  private async prepareActiveCourseRoomOverrides(
    course: CourseSnapshot,
    roomOverrides: RoomSnapshot[] = [],
  ): Promise<void> {
    this.clearActiveCourseRoomOverrides();
    const overrideByRoomId = new Map<string, RoomSnapshot>();
    for (const room of getActiveCourseDraftSessionRoomOverrides()) {
      overrideByRoomId.set(room.id, cloneRoomSnapshot(room));
    }
    for (const room of roomOverrides) {
      overrideByRoomId.set(room.id, cloneRoomSnapshot(room));
    }

    await Promise.all(
      course.roomRefs.map(async (roomRef) => {
        let snapshot = overrideByRoomId.get(roomRef.roomId) ?? null;
        if (!snapshot) {
          const localDraft = this.draftRoomsById.get(roomRef.roomId) ?? null;
          snapshot = localDraft ? cloneRoomSnapshot(localDraft) : null;
        }
        if (!snapshot) {
          const record = await this.roomRepository.loadRoom(roomRef.roomId, roomRef.coordinates);
          const historicalVersion =
            record.versions.find((entry) => entry.version === roomRef.roomVersion)?.snapshot ??
            record.published ??
            null;
          if (!historicalVersion) {
            return;
          }

          snapshot = cloneRoomSnapshot(historicalVersion);
        }

        snapshot.status = 'published';
        this.worldStreamingController.setTransientRoomOverride(snapshot);
        this.activeCourseRoomOverrideIds.add(snapshot.id);
      })
    );
  }

  private async activateDraftCoursePreview(
    course: CourseSnapshot,
    draftRoom: RoomSnapshot | null,
  ): Promise<void> {
    const snapshot = cloneCourseSnapshot(course);
    await this.prepareActiveCourseRoomOverrides(
      snapshot,
      draftRoom ? [draftRoom] : [],
    );
    this.activeCourseRun = this.createCourseRunState(snapshot);
  }

  private getCourseStartRoomRef(course: CourseSnapshot): CourseRoomRef | null {
    if (course.startPoint) {
      return course.roomRefs.find((roomRef) => roomRef.roomId === course.startPoint?.roomId) ?? null;
    }

    return course.roomRefs[0] ?? null;
  }

  private createCourseRunState(course: CourseSnapshot): ActiveCourseRunState {
    const leaderboardEligible = course.status === 'published' && getAuthDebugState().authenticated;
    return {
      course: cloneCourseSnapshot(course),
      returnCoordinates: { ...this.selectedCoordinates },
      elapsedMs: 0,
      deaths: 0,
      collectiblesCollected: 0,
      collectibleTarget: course.goal?.type === 'collect_target' ? course.goal.requiredCount : null,
      enemiesDefeated: 0,
      enemyTarget:
        course.goal?.type === 'defeat_all'
          ? this.countCourseObjectsByCategory(course, 'enemy')
          : null,
      checkpointsReached: 0,
      checkpointTarget:
        course.goal?.type === 'checkpoint_sprint' ? course.goal.checkpoints.length : null,
      nextCheckpointIndex: 0,
      result: 'active',
      completionMessage: null,
      attemptId: null,
      submissionState: leaderboardEligible ? 'starting' : 'local-only',
      submissionMessage: leaderboardEligible
        ? 'Starting ranked course run...'
        : 'Course run stays local.',
      pendingResult: null,
      submittedScore: null,
      leaderboardEligible,
    };
  }

  private countCourseObjectsByCategory(
    course: CourseSnapshot,
    category: GameObjectConfig['category']
  ): number {
    let count = 0;
    for (const roomRef of course.roomRefs) {
      const room = this.getCourseRoomSnapshot(course, roomRef.roomId);
      if (!room) {
        continue;
      }

      count += this.countRoomObjectsByCategory(room, category);
    }

    return count;
  }

  private getCourseRoomSnapshot(course: CourseSnapshot, roomId: string): RoomSnapshot | null {
    const roomRef = course.roomRefs.find((entry) => entry.roomId === roomId) ?? null;
    if (!roomRef) {
      return null;
    }

    return this.getRoomSnapshotForCoordinates(roomRef.coordinates);
  }

  private async startRemoteCourseRun(runState: ActiveCourseRunState): Promise<void> {
    try {
      const response = await this.courseRepository.startRun(runState.course.id, {
        courseId: runState.course.id,
        courseVersion: runState.course.version,
        goal: runState.course.goal as CourseGoal,
        startedAt: new Date().toISOString(),
      });
      if (this.activeCourseRun?.course.id !== runState.course.id) {
        return;
      }

      this.activeCourseRun.attemptId = response.attemptId;
      this.activeCourseRun.submissionState = 'active';
      this.activeCourseRun.submissionMessage = 'Ranked course run active.';
      this.renderHud();
    } catch (error) {
      console.error('Failed to start ranked course run', error);
      if (this.activeCourseRun?.course.id !== runState.course.id) {
        return;
      }

      this.activeCourseRun.submissionState = 'error';
      this.activeCourseRun.submissionMessage =
        error instanceof Error ? error.message : 'Ranked course run unavailable.';
      this.renderHud();
    }
  }

  private async finalizeActiveCourseRun(
    result: 'completed' | 'failed' | 'abandoned'
  ): Promise<void> {
    if (!this.activeCourseRun || this.activeCourseRun.pendingResult) {
      return;
    }

    this.activeCourseRun.pendingResult = result;
    const attemptId = this.activeCourseRun.attemptId;
    if (!attemptId || this.activeCourseRun.submissionState === 'local-only') {
      this.activeCourseRun.submissionState = 'submitted';
      this.activeCourseRun.submissionMessage = 'Local course run saved on this client only.';
      this.renderHud();
      return;
    }

    this.activeCourseRun.submissionState = 'finishing';
    this.activeCourseRun.submissionMessage = 'Submitting course run...';
    this.renderHud();

    const body: CourseRunFinishRequestBody = {
      result,
      elapsedMs: this.activeCourseRun.elapsedMs,
      deaths: this.activeCourseRun.deaths,
      collectiblesCollected: this.activeCourseRun.collectiblesCollected,
      enemiesDefeated: this.activeCourseRun.enemiesDefeated,
      checkpointsReached: this.activeCourseRun.checkpointsReached,
      score: null,
      finishedAt: new Date().toISOString(),
    };

    try {
      await this.courseRepository.finishRun(attemptId, body);
      if (!this.activeCourseRun || this.activeCourseRun.attemptId !== attemptId) {
        return;
      }

      this.activeCourseRun.submissionState = 'submitted';
      this.activeCourseRun.submissionMessage = 'Ranked course run submitted.';
    } catch (error) {
      console.error('Failed to finish ranked course run', error);
      if (!this.activeCourseRun || this.activeCourseRun.attemptId !== attemptId) {
        return;
      }

      this.activeCourseRun.submissionState = 'error';
      this.activeCourseRun.submissionMessage =
        error instanceof Error ? error.message : 'Failed to submit course run.';
    } finally {
      this.renderHud();
    }
  }

  private applyGoalRunMutation(result: GoalRunMutationResult): void {
    if (!result.changed) {
      return;
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
    if (!goal) {
      return 'Course';
    }

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

  private getPlayGoalTimerText(runState: GoalRunState): string {
    if (runState.goal.type === 'survival') {
      return `${this.formatOverlayTimer(Math.max(0, runState.goal.durationMs - runState.elapsedMs))} LEFT`;
    }

    if (runState.goal.timeLimitMs !== null) {
      return `${this.formatOverlayTimer(Math.max(0, runState.goal.timeLimitMs - runState.elapsedMs))} LEFT`;
    }

    return this.formatOverlayTimer(runState.elapsedMs);
  }

  private getCourseGoalTimerText(runState: ActiveCourseRunState): string {
    const goal = runState.course.goal;
    if (!goal) {
      return this.formatOverlayTimer(runState.elapsedMs);
    }

    if (goal.type === 'survival') {
      return `${this.formatOverlayTimer(Math.max(0, goal.durationMs - runState.elapsedMs))} LEFT`;
    }

    if ('timeLimitMs' in goal && goal.timeLimitMs !== null) {
      return `${this.formatOverlayTimer(Math.max(0, goal.timeLimitMs - runState.elapsedMs))} LEFT`;
    }

    return this.formatOverlayTimer(runState.elapsedMs);
  }

  private getPlayGoalProgressText(runState: GoalRunState): string {
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
    const goal = runState.course.goal;
    if (!goal) {
      return '';
    }

    switch (goal.type) {
      case 'reach_exit':
        return runState.result === 'completed' ? 'Exit reached' : 'Reach the exit';
      case 'collect_target':
        return `${runState.collectiblesCollected}/${runState.collectibleTarget ?? goal.requiredCount} collected`;
      case 'defeat_all':
        return `${runState.enemiesDefeated}/${runState.enemyTarget ?? 0} defeated`;
      case 'checkpoint_sprint':
        return `${runState.checkpointsReached}/${runState.checkpointTarget ?? goal.checkpoints.length} checkpoints`;
      case 'survival':
        return runState.result === 'completed' ? 'Survived' : 'Stay alive';
    }
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

  private getRoomBadgeOverlayScale(zoom: number): number {
    const zoomProgress = this.getRoomBadgeScaleProgress(zoom);
    const desiredScreenScale = Phaser.Math.Linear(
      ROOM_BADGE_MIN_SCREEN_SCALE,
      ROOM_BADGE_MAX_SCREEN_SCALE,
      zoomProgress
    );
    return desiredScreenScale / Math.max(zoom, 0.001);
  }

  private getRoomBadgeScaleProgress(zoom: number): number {
    return Phaser.Math.Clamp(
      (zoom - ROOM_BADGE_HIDE_ZOOM) / (ROOM_BADGE_SCALE_FULL_ZOOM - ROOM_BADGE_HIDE_ZOOM),
      0,
      1
    );
  }

  private getRoomBadgeLayoutProgress(zoom: number): number {
    return Phaser.Math.Clamp(
      (zoom - ROOM_BADGE_HIDE_ZOOM) / (ROOM_BADGE_LAYOUT_FULL_ZOOM - ROOM_BADGE_HIDE_ZOOM),
      0,
      1
    );
  }

  private syncGoalOverlayScale(): void {
    const zoom = this.cameras.main.zoom;
    const overlayScale = this.getRoomBadgeOverlayScale(zoom);
    const layoutProgress = this.getRoomBadgeLayoutProgress(zoom);
    const fadeProgress = Phaser.Math.Clamp(
      (zoom - ROOM_BADGE_HIDE_ZOOM) / (ROOM_BADGE_FADE_START_ZOOM - ROOM_BADGE_HIDE_ZOOM),
      0,
      1
    );
    for (const badge of this.roomGoalBadges) {
      badge.container.setPosition(
        Phaser.Math.Linear(badge.zoomedOutPosition.x, badge.zoomedInPosition.x, layoutProgress),
        Phaser.Math.Linear(badge.zoomedOutPosition.y, badge.zoomedInPosition.y, layoutProgress)
      );
      badge.container.setScale(overlayScale);
      badge.container.setAlpha(fadeProgress);
      badge.container.setVisible(fadeProgress > 0.02);
    }
    for (const badge of this.roomActivityBadges) {
      badge.container.setPosition(
        Phaser.Math.Linear(badge.zoomedOutPosition.x, badge.zoomedInPosition.x, layoutProgress),
        Phaser.Math.Linear(badge.zoomedOutPosition.y, badge.zoomedInPosition.y, layoutProgress)
      );
      badge.container.setScale(overlayScale);
      badge.container.setAlpha(fadeProgress);
      badge.container.setVisible(fadeProgress > 0.02);
    }
    for (const badge of this.roomCourseBadges) {
      badge.container.setPosition(
        Phaser.Math.Linear(badge.zoomedOutPosition.x, badge.zoomedInPosition.x, layoutProgress),
        Phaser.Math.Linear(badge.zoomedOutPosition.y, badge.zoomedInPosition.y, layoutProgress)
      );
      badge.container.setScale(overlayScale);
      badge.container.setAlpha(fadeProgress);
      badge.container.setVisible(fadeProgress > 0.02);
    }
  }

  private renderHud(statusOverride?: string): void {
    this.hudBridge?.render(this.buildHudViewModel(statusOverride));
    this.syncGoalOverlayScale();
  }

  private buildHudViewModel(statusOverride?: string): OverworldHudViewModel {
    const selectedState = this.getCellStateAt(this.selectedCoordinates);
    const selectedRoomId = roomIdFromCoordinates(this.selectedCoordinates);
    const selectedRoomInActiveCourseSession = isRoomInActiveCourseDraftSession(selectedRoomId);
    const selectedDraft = this.draftRoomsById.get(selectedRoomId) ?? null;
    const selectedPopulation = this.getRoomPopulation(this.selectedCoordinates);
    const selectedEditorCount = this.getRoomEditorCount(this.selectedCoordinates);
    const selectedCourse = this.getSelectedCourseContext();
    const transientStatus = this.getTransientStatusMessage();
    const totalPlayerCount = this.presenceController.getTotalPlayerCount();
    const frontierBuildBlocked = selectedState === 'frontier' && this.isFrontierBuildBlockedByClaimLimit();
    const rankingMode = this.currentRoomLeaderboard?.rankingMode ?? null;
    const roomTop = this.currentRoomLeaderboard?.entries[0] ?? null;
    const activeCourseRun = this.mode === 'play' ? this.activeCourseRun : null;
    const activeRoomGoalRun = activeCourseRun ? null : this.mode === 'play' ? this.currentGoalRun : null;
    const activeRunResult = activeCourseRun?.result ?? activeRoomGoalRun?.result ?? null;
    const saveStatusTone =
      this.mode === 'play'
        ? activeCourseRun || activeRoomGoalRun
          ? activeRunResult === 'completed'
            ? 'challenge-complete'
            : activeRunResult === 'failed'
              ? 'challenge-failed'
              : 'challenge-active'
          : 'play-score'
        : 'default';

    const selectedTitleText = this.getRoomDisplayTitle(
      selectedState === 'published'
        ? this.selectedSummary?.title ?? null
        : selectedState === 'draft'
          ? selectedDraft?.title ?? null
          : null,
      this.selectedCoordinates
    );

    let selectedMetaText = 'No room here yet';
    let selectedMetaTone: OverworldHudViewModel['selectedMetaTone'] = 'default';
    if (selectedState === 'published') {
      const metaParts: string[] = [];
      if (selectedCourse) {
        metaParts.push(
          selectedCourse.courseTitle?.trim()
            ? `Part of course: ${selectedCourse.courseTitle}`
            : `Part of course ${selectedCourse.roomIndex + 1}/${selectedCourse.roomCount}`
        );
        selectedMetaTone = 'challenge';
      }
      if (this.selectedSummary?.goalType) {
        metaParts.push(`${ROOM_GOAL_LABELS[this.selectedSummary.goalType]} challenge`);
        selectedMetaTone = 'challenge';
      }
      if (metaParts.length === 0) {
        metaParts.push('No challenge');
      }
      if (selectedPopulation > 0) {
        metaParts.push(`${selectedPopulation} here`);
      }
      if (selectedEditorCount > 0) {
        metaParts.push(`${selectedEditorCount} building`);
      }
      selectedMetaText = metaParts.join(' · ');
    } else if (selectedState === 'draft' && selectedDraft) {
      selectedMetaText = selectedDraft.goal
        ? `Local draft only · ${ROOM_GOAL_LABELS[selectedDraft.goal.type]} challenge · publish to make it public`
        : 'Local draft only · publish to make it public';
      selectedMetaTone = 'draft';
    } else if (selectedState === 'frontier') {
      if (frontierBuildBlocked) {
        const authState = getAuthDebugState();
        const limit = authState.roomDailyClaimLimit;
        selectedMetaText =
          limit === null
            ? 'Daily new-room claim limit reached today'
            : `Daily new-room claim limit reached (${limit}/${limit})`;
        selectedMetaTone = 'default';
      } else {
        selectedMetaText =
          selectedEditorCount > 0
            ? `Building in progress · ${selectedEditorCount} ${selectedEditorCount === 1 ? 'builder' : 'builders'} here`
            : 'Build a room here';
        selectedMetaTone = 'frontier';
      }
    } else if (selectedState === 'empty') {
      if (selectedEditorCount > 0) {
        selectedMetaText = `Building in progress · ${selectedEditorCount} ${selectedEditorCount === 1 ? 'builder' : 'builders'} here`;
        selectedMetaTone = 'frontier';
      } else {
        selectedMetaText = 'You can only build next to an existing published room';
        selectedMetaTone = 'default';
      }
    }

    let statusText: string;
    if (statusOverride) {
      statusText = statusOverride;
    } else if (transientStatus) {
      statusText = transientStatus;
    } else {
      statusText = '';
    }

    let leaderboardText = '';
    if (!activeCourseRun && this.mode !== 'play' && roomTop && rankingMode) {
      const metric =
        rankingMode === 'time'
          ? `${(roomTop.elapsedMs / 1000).toFixed(2)}s`
          : `${roomTop.score} pts`;
      leaderboardText = `Best: ${roomTop.userDisplayName} · ${metric}`;
    }

    const saveStatusText =
      this.mode === 'play'
        ? `Score ${this.score}`
        : statusOverride ??
          transientStatus ??
          '';
    const activeGoalRoom = activeRoomGoalRun
      ? this.getRoomSnapshotForCoordinates(activeRoomGoalRun.roomCoordinates)
      : null;
    const goalPanelTone =
      activeRunResult === 'completed'
        ? 'complete'
        : activeRunResult === 'failed'
          ? 'failed'
          : 'active';

    return {
      saveStatusTone,
      jumpInputValue: roomIdFromCoordinates(this.selectedCoordinates),
      selectedTitleText,
      selectedCoordinatesText: roomIdFromCoordinates(this.selectedCoordinates),
      selectedStateText:
        selectedState === 'published'
          ? 'Published'
          : selectedState === 'draft'
            ? 'Draft'
            : selectedState === 'frontier'
              ? 'Frontier'
              : 'Empty',
      selectedStateTone: selectedState,
      selectedMetaText,
      selectedMetaTone,
      statusText,
      leaderboardText,
      zoomLabelText: `${this.cameras.main.zoom.toFixed(2)}x`,
      playButtonText: activeCourseRun ? 'Play Room' : this.mode === 'play' ? 'Stop' : 'Play Room',
      playButtonDisabled:
        activeCourseRun
          ? true
          : this.mode === 'play'
            ? false
            : selectedState !== 'published' && selectedState !== 'draft',
      playButtonActive: this.mode === 'play' && !activeCourseRun,
      playCourseButtonText: activeCourseRun ? 'Stop Course' : 'Play Course',
      playCourseButtonDisabled: activeCourseRun ? false : !selectedCourse,
      playCourseButtonHidden: !selectedCourse && !activeCourseRun,
      playCourseButtonActive: Boolean(activeCourseRun),
      courseBuilderButtonDisabled:
        this.courseComposerLoading ||
        (!selectedRoomInActiveCourseSession && selectedState !== 'published' && !selectedCourse),
      editButtonDisabled: selectedState !== 'published' && selectedState !== 'draft',
      buildButtonDisabled: selectedState !== 'frontier' || frontierBuildBlocked,
      roomCoordinatesText: '',
      cursorText: '',
      playersOnlineText:
        totalPlayerCount === null ? '' : `${totalPlayerCount} ${totalPlayerCount === 1 ? 'player' : 'players'} online`,
      saveStatusText,
      bottomBarZoomText: `Zoom: ${this.cameras.main.zoom.toFixed(2)}x`,
      goalPanelVisible: Boolean(activeCourseRun || activeRoomGoalRun),
      goalPanelTone,
      goalPanelRoomText: activeCourseRun
        ? this.truncateOverlayText(
            (activeCourseRun.course.title?.trim() || 'COURSE').toUpperCase(),
            22
          )
        : activeRoomGoalRun
        ? this.truncateOverlayText(
            this.getRoomDisplayTitle(activeGoalRoom?.title ?? null, activeRoomGoalRun.roomCoordinates).toUpperCase(),
            22
          )
        : '',
      goalPanelGoalText: activeCourseRun
        ? this.getCourseGoalBadgeText(activeCourseRun.course.goal).toUpperCase()
        : activeRoomGoalRun
          ? this.getGoalBadgeText(activeRoomGoalRun.goal).toUpperCase()
          : '',
      goalPanelTimerText: activeCourseRun
        ? this.getCourseGoalTimerText(activeCourseRun)
        : activeRoomGoalRun
          ? this.getPlayGoalTimerText(activeRoomGoalRun)
          : '',
      goalPanelProgressText: activeCourseRun
        ? this.getCourseGoalProgressText(activeCourseRun)
        : activeRoomGoalRun
          ? this.getPlayGoalProgressText(activeRoomGoalRun)
          : '',
    };
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
    courseRoomIndex: number | null;
    courseRoomCount: number | null;
  } {
    return {
      roomId: roomIdFromCoordinates(this.selectedCoordinates),
      coordinates: { ...this.selectedCoordinates },
      state: this.getCellStateAt(this.selectedCoordinates),
      courseId: this.getSelectedCourseContext()?.courseId ?? null,
      courseTitle: this.getSelectedCourseContext()?.courseTitle ?? null,
      courseGoalType: this.getSelectedCourseContext()?.goalType ?? null,
      courseRoomIndex: this.getSelectedCourseContext()?.roomIndex ?? null,
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
    window.removeEventListener(PLAYFUN_GAME_PAUSE_EVENT, this.handlePlayfunGamePause);
    window.removeEventListener(PLAYFUN_GAME_RESUME_EVENT, this.handlePlayfunGameResume);
    this.playfunPauseDepth = 0;
    this.playfunPauseApplied = false;
    this.scale.off('resize', this.handleResize, this);
    this.events.off(Phaser.Scenes.Events.WAKE, this.handleWake, this);
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
    for (const sprite of this.goalMarkerSprites) {
      sprite.destroy();
    }
    this.goalMarkerSprites = [];
    for (const label of this.goalMarkerLabels) {
      label.destroy();
    }
    this.goalMarkerLabels = [];
    this.destroyRoomGoalBadges();
    this.destroyRoomActivityBadges();
    this.roomGridGraphics?.destroy();
    this.roomFillGraphics?.destroy();
    this.roomFrameGraphics?.destroy();
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
      loadedPreviewRooms: this.previewImagesByRoomId.size,
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
