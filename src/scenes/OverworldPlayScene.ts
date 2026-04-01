import Phaser from 'phaser';
import { playSfx, stopSfx } from '../audio/sfx';
import { createCourseRepository } from '../courses/courseRepository';
import { globalRoomMusicController } from '../music/controller';
import {
  clearActiveCourseDraftSessionRoomOverride,
  getActiveCourseDraftSessionCourseId,
  getActiveCourseDraftSessionDraft,
  getActiveCourseDraftSessionRecord,
  getActiveCourseDraftSessionRoomOverride,
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
  isRoomMinted,
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
import {
  getCenteredRoomBadgePosition as calculateCenteredRoomBadgePosition,
  getRoomBadgeOverlayScale as calculateRoomBadgeOverlayScale,
  syncBadgePlacements,
  type OverworldBadgePlacement,
  type OverworldBadgeTierDisplay,
  type RoomBadgeScaleConfig,
} from './overworld/badgeOverlays';
import {
  OverworldHudBridge,
  type OverworldHudViewModel,
  type OverworldOnlineRosterViewEntry,
} from './overworld/hud';
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
  OverworldRoomChatController,
} from './overworld/roomChat';
import { OverworldRoomAudioController } from './overworld/roomAudio';
import { RoomLightingController } from '../lighting/controller';
import {
  OverworldWorldStreamingController,
  type LoadedFullRoom,
} from './overworld/worldStreaming';
import {
  createActiveCourseRunState,
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
const ROOM_BADGE_DOT_TIER_MAX_ZOOM = 0.22;
const ROOM_BADGE_COMPACT_TIER_MAX_ZOOM = 0.95;
const ROOM_BADGE_TIER_FADE_SPAN = 0.032;
const ROOM_BADGE_TEXT_MIN_WIDTH = 98;
const ROOM_BADGE_TEXT_MAX_WIDTH = Math.round(
  (ROOM_PX_WIDTH * ROOM_BADGE_SCALE_FULL_ZOOM * 0.88) / ROOM_BADGE_MAX_SCREEN_SCALE,
);
const ROOM_BADGE_CORNER_INSET_X = 10;
const ROOM_BADGE_CORNER_INSET_Y = 8;
const ROOM_BADGE_CHIP_WIDTH = 22;
const ROOM_BADGE_CHIP_HEIGHT = 12;
const ROOM_BADGE_DOT_SIZE = 6;
const ROOM_BADGE_SEMANTIC_COLORS: Record<RoomGoalType, number> = {
  reach_exit: 0x6dd3ff,
  checkpoint_sprint: 0xffd166,
  collect_target: 0x7ee081,
  defeat_all: 0xff7a7a,
  survival: 0xc297ff,
};
const ROOM_BADGE_SEMANTIC_CODES: Record<RoomGoalType, string> = {
  reach_exit: 'EX',
  checkpoint_sprint: 'CP',
  collect_target: 'CL',
  defeat_all: 'KO',
  survival: 'SV',
};
const BROWSE_VISIBLE_CHUNK_REFRESH_INTERVAL_MS = 15000;
const PLAY_VISIBLE_CHUNK_REFRESH_INTERVAL_MS = 8000;
const SELECTED_ROOM_PLAY_BUTTON_RADIUS = 10;
const SELECTED_ROOM_PLAY_BUTTON_SCALE_FACTOR = 0.9;
const SELECTED_ROOM_PLAY_BUTTON_MIN_SCALE = 1;
const SELECTED_ROOM_PLAY_BUTTON_MAX_SCALE = 8;
const BUTTON_ZOOM_FACTOR = 1.12;
const WHEEL_ZOOM_SENSITIVITY = 0.003;
const PLAY_ROOM_FIT_PADDING = 16;
const PAN_THRESHOLD = 4;
const EDGE_WALL_THICKNESS = 12;
const RESPAWN_FALL_DISTANCE = ROOM_PX_HEIGHT * 2;
const FOLLOW_CAMERA_LERP = 0.12;
const MOBILE_PLAY_CAMERA_TARGET_Y = 0.75;
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

type GoalRoomBadge = OverworldBadgePlacement;
type RoomActivityBadge = OverworldBadgePlacement;
type CourseRoomBadge = OverworldBadgePlacement;
type SemanticBadgeOwner = 'goal' | 'course';

interface SemanticRoomBadgeDescriptor {
  owner: SemanticBadgeOwner;
  title: string;
  typeLabel: string;
  compactCode: string;
  color: number;
  coordinates: RoomCoordinates;
}

interface BrowsePresenceDotRenderer {
  connectionId: string;
  dot: Phaser.GameObjects.Arc;
  targetX: number;
  targetY: number;
}

interface PlayRoomPresenceMarker {
  roomId: string;
  container: Phaser.GameObjects.Container;
  pips: Phaser.GameObjects.Arc[];
}

interface SelectedRoomPlayAffordance {
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Arc;
  icon: Phaser.GameObjects.Graphics;
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

interface SelectedRoomOwnershipDetails {
  roomId: string;
  claimerUserId: string | null;
  isMinted: boolean;
  mintedOwnerWalletAddress: string | null;
}

type CoursePlaybackRoomSourceMode = 'published' | 'draftPreview';

interface PlayGoalMarkerDescriptor {
  point: GoalMarkerPoint;
  label: string | null;
  textColor: string;
  variant?: GoalMarkerFlagVariant;
  textureKey?: string;
  spriteOffsetY?: number;
  alpha?: number;
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
  private selectedRoomPlayAffordance: SelectedRoomPlayAffordance | null = null;
  private readonly browsePresenceDotsByConnectionId = new Map<string, BrowsePresenceDotRenderer>();
  private playRoomPresenceMarkers: PlayRoomPresenceMarker[] = [];
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
  private readonly selectedRoomOwnershipById = new Map<string, SelectedRoomOwnershipDetails>();
  private selectedRoomOwnershipRequestId = 0;
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
  private readonly roomAudioController: OverworldRoomAudioController;
  private readonly lightingController: RoomLightingController;
  private readonly roomBadgeScaleConfig: RoomBadgeScaleConfig = {
    hideZoom: ROOM_BADGE_HIDE_ZOOM,
    fadeStartZoom: ROOM_BADGE_FADE_START_ZOOM,
    scaleFullZoom: ROOM_BADGE_SCALE_FULL_ZOOM,
    layoutFullZoom: ROOM_BADGE_LAYOUT_FULL_ZOOM,
    minScreenScale: ROOM_BADGE_MIN_SCREEN_SCALE,
    maxScreenScale: ROOM_BADGE_MAX_SCREEN_SCALE,
    dotTierMaxZoom: ROOM_BADGE_DOT_TIER_MAX_ZOOM,
    compactTierMaxZoom: ROOM_BADGE_COMPACT_TIER_MAX_ZOOM,
    tierFadeSpan: ROOM_BADGE_TIER_FADE_SPAN,
  };
  private readonly liveObjectController: OverworldLiveObjectController<RoomEdgeWall>;
  private readonly worldStreamingController: OverworldWorldStreamingController<
    LoadedRoomObject,
    RoomEdgeWall
  >;
  private readonly presenceController: OverworldPresenceController;
  private readonly roomChatController: OverworldRoomChatController;

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
    this.roomAudioController = new OverworldRoomAudioController({
      scene: this,
      getMode: () => this.mode,
      getCurrentRoomCoordinates: () => this.currentRoomCoordinates,
    });
    this.lightingController = new RoomLightingController({
      scene: this,
      overlayDepth: 35,
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
      playRoomSfx: (cue, roomCoordinates) =>
        this.roomAudioController.playRoomSfx(cue, roomCoordinates),
      playEnemyKillFx: (x, y, roomCoordinates) =>
        this.fxController?.playEnemyKillFx(
          x,
          y,
          this.roomAudioController.getPlaybackOptionsForRoom(roomCoordinates)
        ),
      playCollectFx: (x, y, scoreDelta, roomCoordinates, cue) =>
        this.fxController?.playCollectFx(
          x,
          y,
          scoreDelta,
          cue,
          this.roomAudioController.getPlaybackOptionsForRoom(roomCoordinates)
        ),
      playBounceFx: (x, y, roomCoordinates) =>
        this.fxController?.playBounceFx(
          x,
          y,
          this.roomAudioController.getPlaybackOptionsForRoom(roomCoordinates)
        ),
      playBombExplosionFx: (x, y, roomCoordinates) =>
        this.fxController?.playBombExplosionFx(
          x,
          y,
          this.roomAudioController.getPlaybackOptionsForRoom(roomCoordinates)
        ),
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
        this.syncPresenceOverlays();
        this.renderHud();
      },
      onRoomActivityChanged: () => this.redrawWorld(),
      onGhostDisplayObjectsChanged: () => this.syncBackdropCameraIgnores(),
    });
    this.roomChatController = new OverworldRoomChatController({
      scene: this,
      getMode: () => this.mode,
      getCurrentRoomCoordinates: () => this.currentRoomCoordinates,
      getPlayerAnchor: () =>
        this.player && this.playerBody
          ? {
              x: this.player.x,
              y: this.playerBody.bottom + DEFAULT_PLAYER_VISUAL_FEET_OFFSET,
            }
          : null,
      getRenderedGhostsByConnectionId: () => this.presenceController.getRenderedGhostsByConnectionId(),
      showTransientStatus: (message) => this.showTransientStatus(message),
      onDisplayObjectsChanged: () => this.syncBackdropCameraIgnores(),
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

  private getCurrentCourseDraftGoalSetupDisabledReason(
    draft: CourseSnapshot | null
  ): string | null {
    if (!draft?.goal) {
      return 'Choose a course goal in the editor first.';
    }

    if (!draft.startPoint) {
      return 'Place a course start marker first.';
    }

    switch (draft.goal.type) {
      case 'reach_exit':
        return draft.goal.exit ? null : 'Place a course exit in the last room first.';
      case 'checkpoint_sprint':
        if (draft.goal.checkpoints.length === 0) {
          return 'Add at least one checkpoint first.';
        }
        return draft.goal.finish ? null : 'Place a course finish marker in the last room first.';
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

    this.roomFillGraphics = this.add.graphics();
    this.roomFillGraphics.setDepth(-5);
    this.roomGridGraphics = this.add.graphics();
    this.roomGridGraphics.setDepth(-4);
    this.roomFrameGraphics = this.add.graphics();
    this.roomFrameGraphics.setDepth(20);
    this.createSelectedRoomPlayAffordance();
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
    this.initializeRoomChatClient();
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
    this.redrawGridOverlay();
    this.updateLiveObjects(delta);
    this.updateGhosts(delta);
    this.roomChatController.update();
    this.updateBrowsePresenceDots(delta);

    if (isMobileLandscapeBlocked()) {
      this.syncLocalPresence();
      this.updateRoomLighting();
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
      this.updateRoomLighting();
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
    this.updateRoomLighting();
    this.updateGoalRun(delta);
    this.renderHud();
  }

  private updateRoomLighting(): void {
    if (this.mode !== 'play' || !this.player || !this.playerBody) {
      const structureChanged = this.lightingController.sync({
        roomId: null,
        bounds: null,
        lighting: null,
        emitters: [],
      });
      if (structureChanged) {
        this.syncBackdropCameraIgnores();
      }
      return;
    }

    const currentRoom = this.getRoomSnapshotForCoordinates(this.currentRoomCoordinates);
    if (!currentRoom) {
      const structureChanged = this.lightingController.sync({
        roomId: null,
        bounds: null,
        lighting: null,
        emitters: [],
      });
      if (structureChanged) {
        this.syncBackdropCameraIgnores();
      }
      return;
    }

    const roomOrigin = this.getRoomOrigin(currentRoom.coordinates);
    const emitters = [
      {
        x: this.playerBody.center.x,
        y: this.playerBody.bottom - this.PLAYER_HEIGHT * 0.65,
      },
      ...Array.from(this.presenceController.getRenderedGhostsByConnectionId().values())
        .filter((ghost) => ghost.presence.roomId === currentRoom.id)
        .map((ghost) => ({
          x: ghost.sprite.x,
          y: ghost.sprite.y - this.PLAYER_HEIGHT * 0.65,
        })),
    ];
    const structureChanged = this.lightingController.sync({
      roomId: currentRoom.id,
      bounds: {
        x: roomOrigin.x,
        y: roomOrigin.y,
        width: ROOM_PX_WIDTH,
        height: ROOM_PX_HEIGHT,
      },
      lighting: currentRoom.lighting,
      emitters,
    });

    if (structureChanged) {
      this.syncBackdropCameraIgnores();
    }
  }

  private resetRuntimeState(): void {
    if (this.backdropCamera && this.cameras.cameras.includes(this.backdropCamera)) {
      this.cameras.remove(this.backdropCamera, true);
    }

    this.worldStreamingController.reset();
    this.lightingController.reset();
    this.starfieldSprites = [];
    this.backdropCamera = null;
    this.mode = 'browse';
    this.cameraMode = 'inspect';
    this.selectedCoordinates = { ...DEFAULT_ROOM_COORDINATES };
    this.currentRoomCoordinates = { ...DEFAULT_ROOM_COORDINATES };
    this.windowCenterCoordinates = { ...DEFAULT_ROOM_COORDINATES };
    this.selectedSummary = null;
    this.selectedRoomOwnershipById.clear();
    this.selectedRoomOwnershipRequestId += 1;
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
    this.destroyRoomGoalBadges();
    this.destroyRoomActivityBadges();
    this.destroyRoomCourseBadges();
    this.shouldCenterCamera = false;
    this.shouldRespawnPlayer = false;
    this.presenceController.reset();
    this.roomChatController.reset();
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

  private initializeRoomChatClient(): void {
    this.roomChatController.initialize();
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
    keyboard.on('keydown-T', () => {
      if (this.mode === 'play') {
        this.roomChatController.openComposer();
      }
    });
    keyboard.on('keydown-ESC', () => {
      if (this.roomChatController.handleEscapeKey()) {
        return;
      }
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
    if (this.selectedRoomPlayAffordance) {
      ignoredObjects.push(this.selectedRoomPlayAffordance.container);
    }
    for (const presenceDot of this.browsePresenceDotsByConnectionId.values()) {
      ignoredObjects.push(presenceDot.dot);
    }
    for (const marker of this.playRoomPresenceMarkers) {
      ignoredObjects.push(marker.container);
    }
    if (this.player) ignoredObjects.push(this.player);
    if (this.playerSprite) ignoredObjects.push(this.playerSprite);
    for (const projectile of this.playerProjectiles) {
      ignoredObjects.push(projectile.rect);
    }
    ignoredObjects.push(...this.lightingController.getBackdropIgnoredObjects());

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
    ignoredObjects.push(...this.roomChatController.getBackdropIgnoredObjects());
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
  private readonly handleAuthStateChanged = (): void => {
    const identityChanged = this.presenceController.refreshIdentity();
    const roomChatIdentityChanged = this.roomChatController.refreshIdentity();
    if (identityChanged) {
      if (this.loadedChunkBounds) {
        this.presenceController.setSubscribedChunkBounds(this.loadedChunkBounds);
      }
    }
    if (roomChatIdentityChanged) {
      if (this.loadedChunkBounds) {
        this.roomChatController.setSubscribedChunkBounds(this.loadedChunkBounds);
      }
    }
    if (identityChanged || roomChatIdentityChanged) {
      this.syncLocalPresence();
    }
    this.refreshSelectedRoomOwnershipDetails();
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
      this.clearSelectedRoomOwnershipDetails(data.clearDraftRoomId ?? null);
      this.clearSelectedRoomOwnershipDetails(data.draftRoom?.id ?? null);
      this.clearSelectedRoomOwnershipDetails(data.publishedRoom?.id ?? null);
      this.clearSelectedRoomOwnershipDetails(data.invalidateRoomId ?? null);
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
    this.inspectZoom = this.getFitZoomForRoom();
    this.browseInspectZoom = this.inspectZoom;
    this.syncAppMode();
    this.syncRoomMusicPlayback();
    this.selectedCoordinates = { ...coordinates };
    this.currentRoomCoordinates = { ...coordinates };
    this.windowCenterCoordinates = { ...coordinates };
    this.shouldCenterCamera = true;
    this.shouldRespawnPlayer = false;
    setFocusedCoordinatesInUrl(this.currentRoomCoordinates);
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

    const worldView = this.cameras.main.worldView;
    return this.getRoomCoordinatesForPoint(worldView.centerX, worldView.centerY);
  }

  private refreshAroundIfNeededOrFromCache(
    centerCoordinates: RoomCoordinates,
    options: { forceChunkReload?: boolean; refreshLeaderboards?: boolean } = {}
  ): void {
    if (
      options.forceChunkReload ||
      this.worldStreamingController.needsRefreshAround(centerCoordinates)
    ) {
      void this.refreshAround(centerCoordinates, {
        forceChunkReload: options.forceChunkReload,
      });
      return;
    }

    this.windowCenterCoordinates = { ...centerCoordinates };
    this.worldStreamingController.refreshVisibleSelectionFromCache();
    this.updateSelectedSummary();
    if (options.refreshLeaderboards !== false) {
      void this.refreshLeaderboardForSelection();
    }
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
    this.roomChatController.setSubscribedChunkBounds(this.loadedChunkBounds);
  }

  private syncLocalPresence(): void {
    const localPresence =
      !this.player || !this.playerBody || this.mode !== 'play'
        ? null
        : {
            mode: this.mode,
            roomCoordinates: { ...this.currentRoomCoordinates },
            x: this.player.x,
            y: this.playerBody.bottom + DEFAULT_PLAYER_VISUAL_FEET_OFFSET,
            velocityX: this.playerBody.velocity.x,
            velocityY: this.playerBody.velocity.y,
            facing: this.playerFacing,
            animationState: this.playerAnimationState,
          };

    this.presenceController.updateLocalPresence(localPresence);
    this.roomChatController.updateLocalPresence(localPresence);
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
      this.syncRoomMusicPlayback();
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
      this.syncRoomMusicPlayback();
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

    this.syncRoomMusicPlayback();
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
      const sprite = marker.variant
        ? createGoalMarkerFlagSprite(
            this,
            marker.variant,
            marker.point.x,
            marker.point.y + (marker.spriteOffsetY ?? 2),
            21,
          )
        : this.add.sprite(
            marker.point.x,
            marker.point.y + (marker.spriteOffsetY ?? 0),
            marker.textureKey ?? 'spawn_point',
            0,
          );
      sprite.setOrigin(0.5, 1);
      sprite.setDepth(21);
      if (marker.alpha !== undefined) {
        sprite.setAlpha(marker.alpha);
      }
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

  private destroyBrowsePresenceDots(): void {
    for (const presenceDot of this.browsePresenceDotsByConnectionId.values()) {
      presenceDot.dot.destroy();
    }
    this.browsePresenceDotsByConnectionId.clear();
  }

  private destroyPlayRoomPresenceMarkers(): void {
    for (const marker of this.playRoomPresenceMarkers) {
      marker.container.destroy(true);
    }
    this.playRoomPresenceMarkers = [];
  }

  private getVisibleRoomCoordinates(): RoomCoordinates[] {
    if (!this.worldWindow) {
      return [];
    }

    const worldView = this.cameras.main.worldView;
    const minWorldX = this.worldWindow.center.x - this.worldWindow.radius;
    const maxWorldX = this.worldWindow.center.x + this.worldWindow.radius;
    const minWorldY = this.worldWindow.center.y - this.worldWindow.radius;
    const maxWorldY = this.worldWindow.center.y + this.worldWindow.radius;
    const minX = Math.max(minWorldX, Math.floor(worldView.left / ROOM_PX_WIDTH));
    const maxX = Math.min(maxWorldX, Math.floor((worldView.right - 1) / ROOM_PX_WIDTH));
    const minY = Math.max(minWorldY, Math.floor(worldView.top / ROOM_PX_HEIGHT));
    const maxY = Math.min(maxWorldY, Math.floor((worldView.bottom - 1) / ROOM_PX_HEIGHT));
    const coordinates: RoomCoordinates[] = [];

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        coordinates.push({ x, y });
      }
    }

    return coordinates;
  }

  private syncPresenceOverlays(): void {
    this.syncBrowsePresenceDots();
    this.syncPlayRoomPresenceMarkers();
    this.syncBackdropCameraIgnores();
  }

  private syncBrowsePresenceDots(): void {
    if (!this.worldWindow || this.mode !== 'browse') {
      if (this.browsePresenceDotsByConnectionId.size > 0) {
        this.destroyBrowsePresenceDots();
      }
      return;
    }

    const visibleRooms = this.getVisibleRoomCoordinates();
    const sampledDots = this.presenceController.getSampledBrowsePresenceDots(visibleRooms);
    const nextConnectionIds = new Set<string>();
    let structureChanged = false;

    for (const sampledDot of sampledDots) {
      nextConnectionIds.add(sampledDot.connectionId);
      const existing = this.browsePresenceDotsByConnectionId.get(sampledDot.connectionId);
      if (!existing) {
        const dot = this.add.circle(sampledDot.x, sampledDot.y, 4, 0xffffff, 0.96);
        dot.setDepth(17);
        this.browsePresenceDotsByConnectionId.set(sampledDot.connectionId, {
          connectionId: sampledDot.connectionId,
          dot,
          targetX: sampledDot.x,
          targetY: sampledDot.y,
        });
        structureChanged = true;
        continue;
      }

      existing.targetX = sampledDot.x;
      existing.targetY = sampledDot.y;
    }

    for (const [connectionId, presenceDot] of this.browsePresenceDotsByConnectionId.entries()) {
      if (nextConnectionIds.has(connectionId)) {
        continue;
      }

      presenceDot.dot.destroy();
      this.browsePresenceDotsByConnectionId.delete(connectionId);
      structureChanged = true;
    }

    this.syncPresenceOverlayScale();
    if (structureChanged) {
      this.syncBackdropCameraIgnores();
    }
  }

  private syncPlayRoomPresenceMarkers(): void {
    if (!this.worldWindow || this.mode !== 'play') {
      if (this.playRoomPresenceMarkers.length > 0) {
        this.destroyPlayRoomPresenceMarkers();
      }
      return;
    }

    const visibleRooms = this.getVisibleRoomCoordinates();
    const descriptors = this.presenceController.getPlayRoomPresenceMarkers(
      visibleRooms,
      this.currentRoomCoordinates
    );
    const existingMarkersByRoomId = new Map(
      this.playRoomPresenceMarkers.map((marker) => [marker.roomId, marker] as const)
    );
    const nextMarkers: PlayRoomPresenceMarker[] = [];
    let structureChanged = false;

    for (const descriptor of descriptors) {
      const pipCount = this.getPlayRoomPresenceMarkerPipCount(descriptor.population);
      const origin = this.getRoomOrigin(descriptor.coordinates);
      const existing = existingMarkersByRoomId.get(descriptor.roomId);
      if (existing && existing.pips.length === pipCount) {
        existing.container.setPosition(origin.x + ROOM_PX_WIDTH * 0.5, origin.y + 8);
        existingMarkersByRoomId.delete(descriptor.roomId);
        nextMarkers.push(existing);
        continue;
      }

      if (existing) {
        existing.container.destroy(true);
        existingMarkersByRoomId.delete(descriptor.roomId);
      }

      nextMarkers.push(this.createPlayRoomPresenceMarker(descriptor, pipCount));
      structureChanged = true;
    }

    for (const marker of existingMarkersByRoomId.values()) {
      marker.container.destroy(true);
      structureChanged = true;
    }

    this.playRoomPresenceMarkers = nextMarkers;
    this.syncPresenceOverlayScale();
    if (structureChanged) {
      this.syncBackdropCameraIgnores();
    }
  }

  private getPlayRoomPresenceMarkerPipCount(population: number): number {
    if (population >= 4) {
      return 3;
    }

    if (population >= 2) {
      return 2;
    }

    return 1;
  }

  private createPlayRoomPresenceMarker(
    descriptor: { roomId: string; coordinates: RoomCoordinates },
    pipCount: number,
  ): PlayRoomPresenceMarker {
    const background = this.add.rectangle(0, 0, 24, 10, 0x050505, 0.76);
    background.setOrigin(0.5, 0.5);
    background.setStrokeStyle(1, 0xffffff, 0.6);

    const pips: Phaser.GameObjects.Arc[] = [];
    for (let index = 0; index < pipCount; index += 1) {
      const pip = this.add.circle(0, 0, 2, 0xffffff, 0.96);
      pip.setOrigin(0.5);
      pips.push(pip);
    }

    const origin = this.getRoomOrigin(descriptor.coordinates);
    const container = this.add.container(origin.x + ROOM_PX_WIDTH * 0.5, origin.y + 8, [
      background,
      ...pips,
    ]);
    container.setDepth(21);
    return {
      roomId: descriptor.roomId,
      container,
      pips,
    };
  }

  private updateBrowsePresenceDots(delta: number): void {
    if (this.browsePresenceDotsByConnectionId.size === 0) {
      return;
    }

    const step = Math.min(1, delta / 90);
    for (const presenceDot of this.browsePresenceDotsByConnectionId.values()) {
      presenceDot.dot.x = Phaser.Math.Linear(presenceDot.dot.x, presenceDot.targetX, step);
      presenceDot.dot.y = Phaser.Math.Linear(presenceDot.dot.y, presenceDot.targetY, step);
    }
  }

  private syncPresenceOverlayScale(): void {
    const zoom = Math.max(this.cameras.main.zoom, MIN_ZOOM);
    const browseDotRadius = Phaser.Math.Clamp(2.2 / zoom, 1.2, 26);
    for (const presenceDot of this.browsePresenceDotsByConnectionId.values()) {
      presenceDot.dot.setRadius(browseDotRadius);
    }

    const markerBackgroundWidth = Phaser.Math.Clamp(20 / zoom, 18, 44);
    const markerBackgroundHeight = Phaser.Math.Clamp(8 / zoom, 8, 18);
    const markerPipRadius = Phaser.Math.Clamp(2.1 / zoom, 1.4, 5);
    const markerSpacing = markerPipRadius * 2.8;
    for (const marker of this.playRoomPresenceMarkers) {
      const [background, ...pips] = marker.container.list as Phaser.GameObjects.GameObject[];
      if (background instanceof Phaser.GameObjects.Rectangle) {
        background.setSize(markerBackgroundWidth, markerBackgroundHeight);
      }

      const totalWidth = (marker.pips.length - 1) * markerSpacing;
      marker.pips.forEach((pip, index) => {
        pip.setRadius(markerPipRadius);
        pip.setPosition(index * markerSpacing - totalWidth * 0.5, 0);
      });
    }
  }

  private emitCourseComposerStateChanged(): void {
    window.dispatchEvent(new CustomEvent(COURSE_COMPOSER_STATE_CHANGED_EVENT));
  }

  private getCenteredRoomBadgePosition(
    origin: { x: number; y: number },
    backgroundWidth: number,
    backgroundHeight: number,
    stackIndex: number,
    stackCount: number,
  ): { x: number; y: number } {
    return calculateCenteredRoomBadgePosition({
      origin,
      backgroundWidth,
      backgroundHeight,
      stackIndex,
      stackCount,
      roomWidth: ROOM_PX_WIDTH,
      roomHeight: ROOM_PX_HEIGHT,
    });
  }

  private getCornerRoomBadgeAnchorPosition(
    origin: { x: number; y: number },
    owner: SemanticBadgeOwner,
  ): { x: number; y: number } {
    return owner === 'goal'
      ? {
          x: origin.x + ROOM_BADGE_CORNER_INSET_X,
          y: origin.y + ROOM_BADGE_CORNER_INSET_Y,
        }
      : {
          x: origin.x + ROOM_PX_WIDTH - ROOM_BADGE_CORNER_INSET_X,
          y: origin.y + ROOM_BADGE_CORNER_INSET_Y,
        };
  }

  private getSemanticBadgeColor(goalType: RoomGoalType | CourseGoalType | null): number {
    if (!goalType) {
      return RETRO_COLORS.selected;
    }

    return ROOM_BADGE_SEMANTIC_COLORS[goalType];
  }

  private getSemanticBadgeCode(goalType: RoomGoalType | CourseGoalType | null): string {
    if (!goalType) {
      return '??';
    }

    return ROOM_BADGE_SEMANTIC_CODES[goalType];
  }

  private getRoomGoalTypeBadgeLabel(goal: RoomGoal): string {
    return ROOM_GOAL_LABELS[goal.type].toUpperCase();
  }

  private getCourseGoalTypeBadgeLabel(goalType: CourseGoalType | null): string {
    return (goalType ? COURSE_GOAL_LABELS[goalType] : 'Goal Missing').toUpperCase();
  }

  private getCourseGoalSummaryText(goalType: CourseGoalType | null): string {
    return goalType ? `${COURSE_GOAL_LABELS[goalType]} course` : 'Course objective missing';
  }

  private createRoundedBadgeBackground(
    width: number,
    height: number,
    fillColor: number,
    fillAlpha: number,
    strokeColor: number,
    strokeAlpha: number,
    radius: number,
  ): Phaser.GameObjects.Graphics {
    const graphic = this.add.graphics();
    graphic.fillStyle(fillColor, fillAlpha);
    graphic.fillRoundedRect(-width * 0.5, -height * 0.5, width, height, radius);
    graphic.lineStyle(1, strokeColor, strokeAlpha);
    graphic.strokeRoundedRect(-width * 0.5, -height * 0.5, width, height, radius);
    return graphic;
  }

  private createDiamondBadgeBackground(
    size: number,
    fillColor: number,
    fillAlpha: number,
    strokeColor: number,
    strokeAlpha: number,
  ): Phaser.GameObjects.Graphics {
    const half = size * 0.5;
    const points = [
      new Phaser.Math.Vector2(0, -half),
      new Phaser.Math.Vector2(half, 0),
      new Phaser.Math.Vector2(0, half),
      new Phaser.Math.Vector2(-half, 0),
    ];
    const graphic = this.add.graphics();
    graphic.fillStyle(fillColor, fillAlpha);
    graphic.fillPoints(points, true, true);
    graphic.lineStyle(1, strokeColor, strokeAlpha);
    graphic.strokePoints(points, true, true);
    return graphic;
  }

  private createChamferBadgeBackground(
    width: number,
    height: number,
    fillColor: number,
    fillAlpha: number,
    strokeColor: number,
    strokeAlpha: number,
    chamfer: number,
  ): Phaser.GameObjects.Graphics {
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    const points = [
      new Phaser.Math.Vector2(-halfWidth + chamfer, -halfHeight),
      new Phaser.Math.Vector2(halfWidth - chamfer, -halfHeight),
      new Phaser.Math.Vector2(halfWidth, -halfHeight + chamfer),
      new Phaser.Math.Vector2(halfWidth, halfHeight - chamfer),
      new Phaser.Math.Vector2(halfWidth - chamfer, halfHeight),
      new Phaser.Math.Vector2(-halfWidth + chamfer, halfHeight),
      new Phaser.Math.Vector2(-halfWidth, halfHeight - chamfer),
      new Phaser.Math.Vector2(-halfWidth, -halfHeight + chamfer),
    ];
    const graphic = this.add.graphics();
    graphic.fillStyle(fillColor, fillAlpha);
    graphic.fillPoints(points, true, true);
    graphic.lineStyle(1, strokeColor, strokeAlpha);
    graphic.strokePoints(points, true, true);
    return graphic;
  }

  private fitTextBadgeTitle(
    rawTitle: string,
    titleText: Phaser.GameObjects.Text,
    typeText: Phaser.GameObjects.Text,
    maxWidth: number,
    horizontalPadding: number,
  ): string {
    const widestType = typeText.width;
    for (let maxLength = rawTitle.length; maxLength >= 1; maxLength -= 1) {
      const candidate =
        maxLength === rawTitle.length ? rawTitle : this.truncateOverlayText(rawTitle, maxLength);
      titleText.setText(candidate);
      if (Math.max(titleText.width, widestType) + horizontalPadding * 2 <= maxWidth) {
        return candidate;
      }
    }

    const fallback = this.truncateOverlayText(rawTitle, 1);
    titleText.setText(fallback);
    return fallback;
  }

  private createBadgeDotTier(
    owner: SemanticBadgeOwner,
    color: number,
  ): Phaser.GameObjects.Container {
    const shape =
      owner === 'goal'
        ? this.add.circle(0, 0, ROOM_BADGE_DOT_SIZE * 0.5, color, 0.98)
        : this.createDiamondBadgeBackground(
            ROOM_BADGE_DOT_SIZE + 1,
            color,
            0.98,
            RETRO_COLORS.selected,
            0.88,
          );

    if (shape instanceof Phaser.GameObjects.Arc) {
      shape.setStrokeStyle(1, RETRO_COLORS.backgroundNumber, 0.72);
    }

    return this.add.container(owner === 'goal' ? 0 : 0, ROOM_BADGE_DOT_SIZE * 0.5, [shape]);
  }

  private createBadgeCompactTier(
    owner: SemanticBadgeOwner,
    color: number,
    compactCode: string,
  ): Phaser.GameObjects.Container {
    const background =
      owner === 'goal'
        ? this.createRoundedBadgeBackground(
            ROOM_BADGE_CHIP_WIDTH,
            ROOM_BADGE_CHIP_HEIGHT,
            color,
            0.98,
            RETRO_COLORS.backgroundNumber,
            0.84,
            6,
          )
        : this.createChamferBadgeBackground(
            ROOM_BADGE_CHIP_WIDTH,
            ROOM_BADGE_CHIP_HEIGHT,
            RETRO_COLORS.backgroundNumber,
            0.9,
            color,
            0.98,
            3,
          );

    const label = this.add.text(0, 0, compactCode, {
      fontFamily: 'Courier New',
      fontSize: '8px',
      color: owner === 'goal' ? '#050505' : Phaser.Display.Color.IntegerToColor(color).rgba,
      stroke: owner === 'goal' ? '#f3eee2' : '#050505',
      strokeThickness: owner === 'goal' ? 0 : 2,
    });
    label.setOrigin(0.5, 0.5);

    return this.add.container(
      owner === 'goal' ? ROOM_BADGE_CHIP_WIDTH * 0.5 : -ROOM_BADGE_CHIP_WIDTH * 0.5,
      ROOM_BADGE_CHIP_HEIGHT * 0.5,
      [background, label],
    );
  }

  private createBadgeTextTier(
    descriptor: SemanticRoomBadgeDescriptor,
  ): Phaser.GameObjects.Container {
    const titleText = this.add.text(0, 0, descriptor.title, {
      fontFamily: 'Courier New',
      fontSize: '12px',
      color: '#f3eee2',
      stroke: '#050505',
      strokeThickness: 3,
      align: 'center',
    });
    titleText.setOrigin(0.5, 1);

    const typeText = this.add.text(0, 0, descriptor.typeLabel, {
      fontFamily: 'Courier New',
      fontSize: '10px',
      color: Phaser.Display.Color.IntegerToColor(descriptor.color).rgba,
      stroke: '#050505',
      strokeThickness: 3,
      align: 'center',
    });
    typeText.setOrigin(0.5, 0);

    const horizontalPadding = 10;
    const verticalPadding = 8;
    this.fitTextBadgeTitle(
      descriptor.title,
      titleText,
      typeText,
      ROOM_BADGE_TEXT_MAX_WIDTH,
      horizontalPadding,
    );

    const backgroundWidth = Phaser.Math.Clamp(
      Math.max(titleText.width, typeText.width) + horizontalPadding * 2,
      ROOM_BADGE_TEXT_MIN_WIDTH,
      ROOM_BADGE_TEXT_MAX_WIDTH,
    );
    const backgroundHeight = 38;
    const background =
      descriptor.owner === 'goal'
        ? this.createRoundedBadgeBackground(
            backgroundWidth,
            backgroundHeight,
            RETRO_COLORS.backgroundNumber,
            0.9,
            descriptor.color,
            0.94,
            8,
          )
        : this.createChamferBadgeBackground(
            backgroundWidth,
            backgroundHeight,
            RETRO_COLORS.backgroundNumber,
            0.84,
            descriptor.color,
            0.98,
            5,
          );

    const accent =
      descriptor.owner === 'goal'
        ? this.add.rectangle(
            -backgroundWidth * 0.5 + 8,
            -backgroundHeight * 0.5 + verticalPadding + 1,
            6,
            6,
            descriptor.color,
            0.98,
          )
        : this.createDiamondBadgeBackground(7, descriptor.color, 0.98, RETRO_COLORS.selected, 0.82);
    if (descriptor.owner === 'course' && accent instanceof Phaser.GameObjects.Graphics) {
      accent.setPosition(-backgroundWidth * 0.5 + 10, -backgroundHeight * 0.5 + verticalPadding + 1);
    }

    titleText.setPosition(0, -2);
    typeText.setPosition(0, 5);

    return this.add.container(
      descriptor.owner === 'goal' ? backgroundWidth * 0.5 : -backgroundWidth * 0.5,
      backgroundHeight * 0.5,
      [background, accent, titleText, typeText],
    );
  }

  private createSemanticRoomBadge(
    descriptor: SemanticRoomBadgeDescriptor,
  ): OverworldBadgePlacement {
    const dotTier = this.createBadgeDotTier(descriptor.owner, descriptor.color);
    const compactTier = this.createBadgeCompactTier(
      descriptor.owner,
      descriptor.color,
      descriptor.compactCode,
    );
    const textTier = this.createBadgeTextTier(descriptor);
    const container = this.add.container(0, 0, [dotTier, compactTier, textTier]);
    container.setDepth(18);

    const position = this.getCornerRoomBadgeAnchorPosition(
      this.getRoomOrigin(descriptor.coordinates),
      descriptor.owner,
    );

    const tierDisplays: OverworldBadgeTierDisplay[] = [
      { tier: 'dot', container: dotTier },
      { tier: 'compact', container: compactTier },
      { tier: 'text', container: textTier },
    ];

    return {
      container,
      zoomedInPosition: position,
      zoomedOutPosition: position,
      tierDisplays,
    };
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

        const hasCourseBadge = Boolean(
          this.roomSummariesById.get(roomIdFromCoordinates(coordinates))?.course,
        );
        this.roomGoalBadges.push(
          this.createSemanticRoomBadge({
            owner: 'goal',
            title: this.getRoomDisplayTitle(room.title, coordinates).toUpperCase(),
            typeLabel: this.getRoomGoalTypeBadgeLabel(room.goal),
            compactCode: this.getSemanticBadgeCode(room.goal.type),
            color: this.getSemanticBadgeColor(room.goal.type),
            coordinates,
          }),
        );
      }
    }

    syncBadgePlacements(this.roomGoalBadges, this.cameras.main.zoom, this.roomBadgeScaleConfig);
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

        const zoomedInPosition = { x: origin.x + 8, y: origin.y + ROOM_PX_HEIGHT - 34 };
        const zoomedOutPosition = {
          x: origin.x + (ROOM_PX_WIDTH - backgroundWidth) * 0.5,
          y: origin.y + ROOM_PX_HEIGHT - 34,
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

        const hasRoomGoalBadge = Boolean(this.getRoomSnapshotForCoordinates(coordinates)?.goal);
        this.roomCourseBadges.push(
          this.createSemanticRoomBadge({
            owner: 'course',
            title: (summary.course.courseTitle?.trim() || 'COURSE').toUpperCase(),
            typeLabel: this.getCourseGoalTypeBadgeLabel(summary.course.goalType),
            compactCode: this.getSemanticBadgeCode(summary.course.goalType),
            color: this.getSemanticBadgeColor(summary.course.goalType),
            coordinates,
          }),
        );
      }
    }

    syncBadgePlacements(this.roomCourseBadges, this.cameras.main.zoom, this.roomBadgeScaleConfig);
    this.syncBackdropCameraIgnores();
  }

  private getGoalMarkerDescriptors(runState: GoalRunState): PlayGoalMarkerDescriptor[] {
    const markers: PlayGoalMarkerDescriptor[] = [];

    if (runState.qualificationState === 'practice') {
      markers.push({
        point: runState.rankedStartPoint,
        label: 'START',
        textColor: '#9fdcff',
        textureKey: 'spawn_point',
        spriteOffsetY: 0,
        alpha: 0.94,
      });
    }

    switch (runState.goal.type) {
      case 'reach_exit':
        return runState.goal.exit
          ? [
              ...markers,
              {
              point: this.toWorldGoalPoint(runState.roomCoordinates, runState.goal.exit),
              label: null,
              variant: (runState.result === 'completed' ? 'finish-cleared' : 'finish-pending') as GoalMarkerFlagVariant,
              textColor: runState.result === 'completed' ? '#f6e6a6' : '#ffefef',
            },
            ]
          : markers;
      case 'checkpoint_sprint':
        return [
          ...markers,
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
        return markers;
    }
  }

  private getCourseMarkerDescriptors(runState: ActiveCourseRunState): PlayGoalMarkerDescriptor[] {
    const goal = runState.course.goal;
    if (!goal) {
      return [];
    }

    const markers: PlayGoalMarkerDescriptor[] = [];

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

  private createSelectedRoomPlayAffordance(): void {
    const background = this.add.circle(
      0,
      0,
      SELECTED_ROOM_PLAY_BUTTON_RADIUS,
      RETRO_COLORS.backgroundNumber,
      0.9
    );
    background.setStrokeStyle(1.5, RETRO_COLORS.selected, 0.92);

    const icon = this.add.graphics();
    icon.fillStyle(RETRO_COLORS.selected, 1);
    icon.fillTriangle(-3, -5, -3, 5, 5, 0);

    const container = this.add.container(0, 0, [background, icon]);
    container.setDepth(28);
    container.setVisible(false);
    container.setSize(
      SELECTED_ROOM_PLAY_BUTTON_RADIUS * 2,
      SELECTED_ROOM_PLAY_BUTTON_RADIUS * 2
    );
    container.setInteractive(
      new Phaser.Geom.Circle(0, 0, SELECTED_ROOM_PLAY_BUTTON_RADIUS + 4),
      Phaser.Geom.Circle.Contains
    );
    container.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_OVER,
      () => background.setFillStyle(RETRO_COLORS.backgroundNumber, 0.98)
    );
    container.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_OUT,
      () => background.setFillStyle(RETRO_COLORS.backgroundNumber, 0.9)
    );
    container.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData
      ) => {
        event.stopPropagation();
        this.playSelectedRoom();
      }
    );

    this.selectedRoomPlayAffordance = {
      container,
      background,
      icon,
    };
  }

  private updateSelectedRoomPlayAffordance(): void {
    const affordance = this.selectedRoomPlayAffordance;
    if (!affordance) {
      return;
    }

    const selectedState = this.getCellStateAt(this.selectedCoordinates);
    const shouldShow =
      Boolean(this.worldWindow) &&
      this.mode === 'browse' &&
      (selectedState === 'published' || selectedState === 'draft') &&
      this.isWithinLoadedRoomBounds(this.selectedCoordinates);

    affordance.container.setVisible(shouldShow);
    if (!shouldShow) {
      return;
    }

    const origin = this.getRoomOrigin(this.selectedCoordinates);
    affordance.container.setPosition(
      origin.x + ROOM_PX_WIDTH * 0.5,
      origin.y + ROOM_PX_HEIGHT * 0.5
    );
    affordance.container.setScale(this.getSelectedRoomPlayAffordanceScale(this.cameras.main.zoom));
  }

  private getSelectedRoomPlayAffordanceScale(zoom: number): number {
    return Phaser.Math.Clamp(
      SELECTED_ROOM_PLAY_BUTTON_SCALE_FACTOR / Math.max(zoom, MIN_ZOOM),
      SELECTED_ROOM_PLAY_BUTTON_MIN_SCALE,
      SELECTED_ROOM_PLAY_BUTTON_MAX_SCALE
    );
  }

  private redrawWorld(): void {
    this.roomFillGraphics.clear();
    this.roomFrameGraphics.clear();

    if (!this.worldWindow) {
      this.destroyRoomGoalBadges();
      this.destroyRoomActivityBadges();
      this.destroyRoomCourseBadges();
      this.destroyBrowsePresenceDots();
      this.destroyPlayRoomPresenceMarkers();
      this.updateSelectedRoomPlayAffordance();
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
        const cellFill = this.getCellFillStyle(cellState);

        this.roomFillGraphics.fillStyle(cellFill.color, cellFill.alpha);
        this.roomFillGraphics.fillRect(origin.x, origin.y, ROOM_PX_WIDTH, ROOM_PX_HEIGHT);

        this.drawCellFrame(coordinates, cellState, origin.x, origin.y);
      }
    }

    this.redrawRoomGoalBadges();
    this.redrawRoomActivityBadges();
    this.redrawRoomCourseBadges();
    this.syncPresenceOverlays();
    this.updateSelectedRoomPlayAffordance();
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
      void this.finalizeActiveCourseRun('abandoned');
    }
    if (
      singleRoomRunToReset &&
      this.shouldResetSingleRoomChallengeStateForRun(singleRoomRunToReset)
    ) {
      this.resetSingleRoomChallengeStateForRun(singleRoomRunToReset);
    }
    this.activeCourseRun = null;
    this.clearActiveCourseRoomOverrides();

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
    this.isPanning = false;
    this.panStartPointer = { x: 0, y: 0 };
    this.panCurrentPointer = { x: 0, y: 0 };
    this.panStartScroll = {
      x: this.cameras.main.scrollX,
      y: this.cameras.main.scrollY,
    };
    this.touchPointers.clear();
    this.activePrimaryTouchId = null;
    this.touchTapCandidate = null;
    this.touchPinchDistance = 0;
    this.touchPinchAnchor = { x: 0, y: 0 };
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
      this.refreshAroundIfNeededOrFromCache(nextRoomCoordinates, {
        refreshLeaderboards: false,
      });
      return;
    }

    this.syncRoomMusicPlayback();
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
    this.refreshSelectedRoomOwnershipDetails();
  }

  private clearSelectedRoomOwnershipDetails(roomId: string | null): void {
    if (!roomId) {
      return;
    }

    this.selectedRoomOwnershipById.delete(roomId);
  }

  private refreshSelectedRoomOwnershipDetails(force = false): void {
    const selectedState = this.getCellStateAt(this.selectedCoordinates);
    if (selectedState !== 'published' && selectedState !== 'draft') {
      return;
    }

    const roomId = roomIdFromCoordinates(this.selectedCoordinates);
    if (!force && this.selectedRoomOwnershipById.has(roomId)) {
      return;
    }

    const requestId = ++this.selectedRoomOwnershipRequestId;
    const coordinates = { ...this.selectedCoordinates };
    void this.roomRepository
      .loadRoom(roomId, coordinates)
      .then((record) => {
        if (requestId !== this.selectedRoomOwnershipRequestId) {
          return;
        }

        this.selectedRoomOwnershipById.set(roomId, {
          roomId,
          claimerUserId: record.claimerUserId,
          isMinted: isRoomMinted(record),
          mintedOwnerWalletAddress: record.mintedOwnerWalletAddress,
        });

        if (roomId === roomIdFromCoordinates(this.selectedCoordinates)) {
          this.renderHud();
        }
      })
      .catch((error) => {
        if (requestId !== this.selectedRoomOwnershipRequestId) {
          return;
        }

        console.warn('Failed to load selected room ownership details', error);
      });
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
    this.clearTouchGestureState();
    this.browseInspectZoom = this.inspectZoom;
    this.mode = 'play';
    this.cameraMode = 'follow';
    this.inspectZoom = this.getFitZoomForRoom();
    this.syncAppMode();
    this.currentRoomCoordinates = { ...this.selectedCoordinates };
    this.shouldCenterCamera = true;
    this.shouldRespawnPlayer = true;
    setFocusedCoordinatesInUrl(this.currentRoomCoordinates);
    this.syncRoomMusicPlayback();
    void this.refreshAround(this.currentRoomCoordinates);
  }

  returnToWorld(): void {
    const returnCoordinates = this.activeCourseRun?.returnCoordinates ?? this.currentRoomCoordinates;
    this.resetPlaySession();
    this.clearTouchGestureState();
    this.mode = 'browse';
    this.cameraMode = 'inspect';
    this.inspectZoom = this.browseInspectZoom;
    this.syncAppMode();
    this.syncRoomMusicPlayback();
    this.selectedCoordinates = { ...returnCoordinates };
    this.currentRoomCoordinates = { ...returnCoordinates };
    this.shouldCenterCamera = true;
    this.shouldRespawnPlayer = false;
    this.refreshAroundIfNeededOrFromCache(returnCoordinates);
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

  openRoomChatComposer(): boolean {
    return this.roomChatController.openComposer();
  }

  closeRoomChatComposer(): void {
    this.roomChatController.closeComposer();
  }

  isRoomChatComposerOpen(): boolean {
    return this.roomChatController.isComposerOpen();
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
      if (!snapshot) {
        throw new Error('This course is not published yet.');
      }
      if (!snapshot.goal) {
        throw new Error('Published course is missing objective data. Reopen the builder and publish again.');
      }

      await this.startCoursePlayback(snapshot, 'published');
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

  private async startCoursePlayback(
    snapshot: CourseSnapshot,
    roomSourceMode: CoursePlaybackRoomSourceMode,
  ): Promise<void> {
    this.resetPlaySession();
    this.clearTouchGestureState();
    this.goalRunController.clearCurrentRun();
    await this.prepareActiveCourseRoomOverrides(snapshot, { mode: roomSourceMode });
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
    this.syncRoomMusicPlayback();
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
      const selectedPublishedCourseId = this.selectedSummary?.course?.courseId ?? null;
      let nextRecord: CourseRecord;
      if (selectedRoomInSession && sessionRecord) {
        nextRecord = sessionRecord;
      } else if (selectedPublishedCourseId && sessionRecord?.draft.id !== selectedPublishedCourseId) {
        nextRecord = await this.courseRepository.loadCourse(selectedPublishedCourseId);
      } else if (selectedPublishedCourseId && sessionRecord?.draft.id === selectedPublishedCourseId) {
        nextRecord = sessionRecord;
      } else {
        nextRecord = createDefaultCourseRecord();
        nextRecord.ownerUserId = authState.user?.id ?? null;
        nextRecord.ownerDisplayName = authState.user?.displayName ?? null;
        nextRecord.permissions = {
          canSaveDraft: Boolean(authState.authenticated),
          canPublish: Boolean(authState.authenticated),
          canUnpublish: Boolean(authState.authenticated),
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
          : selectedPublishedCourseId
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
    this.openEditor({
      roomCoordinates: { ...nextRoomRef.coordinates },
      source: 'world',
      roomSnapshot: cloneRoomSnapshot(roomSnapshot),
      courseEdit: {
        courseId: draft.id,
        roomId: nextRoomRef.roomId,
        roomOrder: currentOrder + offset,
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
      await this.startCoursePlayback(snapshot, 'draftPreview');
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

  private clearActiveCourseRoomOverrides(): void {
    for (const roomId of this.activeCourseRoomOverrideIds) {
      this.worldStreamingController.clearTransientRoomOverride(roomId);
    }
    this.activeCourseRoomOverrideIds.clear();
  }

  private async loadPinnedCourseRoomSnapshot(roomRef: CourseRoomRef): Promise<RoomSnapshot> {
    const record = await this.roomRepository.loadRoom(roomRef.roomId, roomRef.coordinates);
    const historicalVersion =
      record.versions.find((entry) => entry.version === roomRef.roomVersion)?.snapshot ??
      (record.published?.version === roomRef.roomVersion ? record.published : null);
    if (!historicalVersion) {
      const roomLabel =
        roomRef.roomTitle?.trim() || `Room ${roomRef.coordinates.x},${roomRef.coordinates.y}`;
      throw new Error(
        `${roomLabel} is missing published room version v${roomRef.roomVersion}. Reopen the course builder and publish again.`
      );
    }

    return cloneRoomSnapshot(historicalVersion);
  }

  private async prepareActiveCourseRoomOverrides(
    course: CourseSnapshot,
    options: {
      mode: CoursePlaybackRoomSourceMode;
      roomOverrides?: RoomSnapshot[];
    },
  ): Promise<void> {
    this.clearActiveCourseRoomOverrides();
    const overrideByRoomId = new Map<string, RoomSnapshot>();
    if (options.mode === 'draftPreview') {
      for (const room of options.roomOverrides ?? []) {
        overrideByRoomId.set(room.id, cloneRoomSnapshot(room));
      }
      for (const room of getActiveCourseDraftSessionRoomOverrides()) {
        overrideByRoomId.set(room.id, cloneRoomSnapshot(room));
      }
    }

    const snapshots = await Promise.all(
      course.roomRefs.map(async (roomRef) => {
        const draftOverride = overrideByRoomId.get(roomRef.roomId);
        const snapshot = draftOverride
          ? cloneRoomSnapshot(draftOverride)
          : await this.loadPinnedCourseRoomSnapshot(roomRef);
        snapshot.status = 'published';
        return snapshot;
      })
    );

    for (const snapshot of snapshots) {
      this.worldStreamingController.setTransientRoomOverride(snapshot);
      this.activeCourseRoomOverrideIds.add(snapshot.id);
    }
  }

  private async activateDraftCoursePreview(
    course: CourseSnapshot,
    draftRoom: RoomSnapshot | null,
  ): Promise<void> {
    const snapshot = cloneCourseSnapshot(course);
    await this.prepareActiveCourseRoomOverrides(
      snapshot,
      {
        mode: 'draftPreview',
        roomOverrides: draftRoom ? [draftRoom] : [],
      },
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
    return createActiveCourseRunState({
      course: cloneCourseSnapshot(course),
      returnCoordinates: { ...this.selectedCoordinates },
      enemyTarget:
        course.goal?.type === 'defeat_all'
          ? this.countCourseObjectsByCategory(course, 'enemy')
          : null,
      leaderboardEligible,
    });
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

  private getRoomBadgeOverlayScale(zoom: number): number {
    return calculateRoomBadgeOverlayScale(zoom, this.roomBadgeScaleConfig);
  }

  private syncGoalOverlayScale(): void {
    const zoom = this.cameras.main.zoom;
    syncBadgePlacements(this.roomGoalBadges, zoom, this.roomBadgeScaleConfig);
    syncBadgePlacements(this.roomActivityBadges, zoom, this.roomBadgeScaleConfig);
    syncBadgePlacements(this.roomCourseBadges, zoom, this.roomBadgeScaleConfig);
    this.syncPresenceOverlayScale();
    this.updateSelectedRoomPlayAffordance();
  }

  private renderHud(statusOverride?: string): void {
    this.hudBridge?.render(this.buildHudViewModel(statusOverride));
    this.syncGoalOverlayScale();
  }

  private formatRoomEditorSummary(coordinates: RoomCoordinates): string | null {
    const names = this.getRoomEditorDisplayNames(coordinates);
    if (names.length === 0) {
      return null;
    }

    if (names.length === 1) {
      return `${names[0]} building`;
    }

    if (names.length === 2) {
      return `${names[0]} + ${names[1]} building`;
    }

    return `${names[0]} + ${names.length - 1} others building`;
  }

  private buildHudViewModel(statusOverride?: string): OverworldHudViewModel {
    const selectedState = this.getCellStateAt(this.selectedCoordinates);
    const selectedRoomId = roomIdFromCoordinates(this.selectedCoordinates);
    const selectedRoomInActiveCourseSession = isRoomInActiveCourseDraftSession(selectedRoomId);
    const selectedDraft = this.draftRoomsById.get(selectedRoomId) ?? null;
    const selectedOwnership = this.selectedRoomOwnershipById.get(selectedRoomId) ?? null;
    const selectedPopulation = this.getRoomPopulation(this.selectedCoordinates);
    const selectedEditorCount = this.getRoomEditorCount(this.selectedCoordinates);
    const selectedEditorSummary = this.formatRoomEditorSummary(this.selectedCoordinates);
    const selectedCourse = this.getSelectedCourseContext();
    const transientStatus = this.getTransientStatusMessage();
    const authState = getAuthDebugState();
    const currentUserId = authState.user?.id ?? null;
    const currentWalletAddress = authState.user?.walletAddress?.trim().toLowerCase() ?? null;
    const selectedRoomMinted = selectedState === 'published' && Boolean(selectedOwnership?.isMinted);
    const selectedRoomClaimOwnerUserId =
      selectedOwnership?.claimerUserId
      ?? (selectedState === 'published' ? this.selectedSummary?.creatorUserId ?? null : null);
    const viewerOwnsSelectedRoom = Boolean(
      currentUserId &&
      selectedRoomClaimOwnerUserId &&
      currentUserId === selectedRoomClaimOwnerUserId
    );
    const viewerOwnsMintedRoom = Boolean(
      selectedOwnership?.mintedOwnerWalletAddress &&
      currentWalletAddress &&
      currentWalletAddress === selectedOwnership.mintedOwnerWalletAddress.trim().toLowerCase()
    );
    const canEditSelectedRoom =
      selectedState === 'draft'
        ? true
        : selectedState === 'published'
          ? selectedOwnership === null || !selectedRoomMinted || viewerOwnsMintedRoom
          : false;
    const editButtonTitle =
      selectedState !== 'published' && selectedState !== 'draft'
        ? 'Select a published or draft room to edit.'
        : selectedRoomMinted && !viewerOwnsMintedRoom
            ? 'Only the room token owner can edit a minted room.'
            : '';
    const canOpenCourseBuilder = selectedState === 'published' && viewerOwnsSelectedRoom;
    const courseBuilderButtonTitle =
      this.courseComposerLoading
        ? 'Loading course builder...'
        : selectedRoomInActiveCourseSession
          ? ''
          : selectedState !== 'published'
            ? 'Only published rooms can start a course.'
            : !viewerOwnsSelectedRoom
              ? 'Only the room claimer can build a course from this room.'
              : '';
    const totalPlayerCount = this.presenceController.getTotalPlayerCount();
    const onlineRosterEntries: OverworldOnlineRosterViewEntry[] = this.presenceController
      .getOnlineRoster()
      .map((entry) => ({
        key: entry.key,
        userId: entry.userId,
        displayName: entry.displayName,
        roomText: `Room ${entry.roomId}`,
        isSelf: entry.isSelf,
      }));
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
    const selectedCreatorUserId =
      selectedState === 'published'
      && this.selectedSummary?.creatorUserId
      && this.selectedSummary.creatorDisplayName
        ? this.selectedSummary.creatorUserId
        : null;
    const selectedCreatorText = selectedCreatorUserId && this.selectedSummary?.creatorDisplayName
      ? `by ${this.selectedSummary.creatorDisplayName}`
      : roomIdFromCoordinates(this.selectedCoordinates);

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
        metaParts.push(this.getCourseGoalSummaryText(selectedCourse.goalType));
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
        metaParts.push(selectedEditorSummary ?? `${selectedEditorCount} building`);
      }
      selectedMetaText = metaParts.join(' · ');
    } else if (selectedState === 'draft' && selectedDraft) {
      const metaParts = ['Local draft only'];
      if (selectedCourse) {
        metaParts.push(
          selectedCourse.courseTitle?.trim()
            ? `Part of course: ${selectedCourse.courseTitle}`
            : `Part of course ${selectedCourse.roomIndex + 1}/${selectedCourse.roomCount}`
        );
        metaParts.push(this.getCourseGoalSummaryText(selectedCourse.goalType));
      }
      if (selectedDraft.goal) {
        metaParts.push(`${ROOM_GOAL_LABELS[selectedDraft.goal.type]} challenge`);
      }
      metaParts.push('publish to make it public');
      selectedMetaText = metaParts.join(' · ');
      selectedMetaTone = selectedCourse ? 'challenge' : 'draft';
    } else if (selectedState === 'frontier') {
      if (frontierBuildBlocked) {
        const limit = authState.roomDailyClaimLimit;
        selectedMetaText =
          limit === null
            ? 'Daily new-room claim limit reached today'
            : `Daily new-room claim limit reached (${limit}/${limit})`;
        selectedMetaTone = 'default';
      } else {
        selectedMetaText =
          selectedEditorCount > 0
            ? `Building in progress · ${
              selectedEditorSummary
              ?? `${selectedEditorCount} ${selectedEditorCount === 1 ? 'builder' : 'builders'} here`
            }`
            : 'Build a room here';
        selectedMetaTone = 'frontier';
      }
    } else if (selectedState === 'empty') {
      if (selectedEditorCount > 0) {
        selectedMetaText = `Building in progress · ${
          selectedEditorSummary
          ?? `${selectedEditorCount} ${selectedEditorCount === 1 ? 'builder' : 'builders'} here`
        }`;
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
    } else if (this.mode === 'play') {
      statusText = this.goalRunController.getPersistentStatusText() ?? '';
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
      selectedCreatorText,
      selectedCreatorUserId,
      selectedStateText:
        selectedRoomMinted
          ? 'Minted'
          : selectedState === 'published'
            ? 'Published'
          : selectedState === 'draft'
            ? 'Draft'
            : selectedState === 'frontier'
              ? 'Frontier'
              : 'Empty',
      selectedStateTone: selectedRoomMinted ? 'minted' : selectedState,
      selectedStateInfoVisible: selectedRoomMinted,
      selectedStateInfoText:
        selectedRoomMinted
          ? 'Minted rooms are onchain room NFTs. Only the token owner can edit the live room or publish updates.'
          : '',
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
        (!selectedRoomInActiveCourseSession && !canOpenCourseBuilder),
      courseBuilderButtonTitle,
      editButtonDisabled: !canEditSelectedRoom,
      editButtonTitle,
      buildButtonDisabled: selectedState !== 'frontier' || frontierBuildBlocked,
      roomCoordinatesText: '',
      cursorText: '',
      playersOnlineText:
        totalPlayerCount === null ? '' : `${totalPlayerCount} ${totalPlayerCount === 1 ? 'player' : 'players'} online`,
      playersOnlineSummaryText:
        totalPlayerCount === null
          ? ''
          : onlineRosterEntries.length === 0
            ? 'Live presence in loaded rooms.'
            : `${onlineRosterEntries.length} ${onlineRosterEntries.length === 1 ? 'player' : 'players'} visible right now`,
      playersOnlineEntries: onlineRosterEntries,
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

  private syncRoomMusicPlayback(): void {
    if (this.mode !== 'play') {
      globalRoomMusicController.stopArrangement({
        transition: 'bar',
        mode: 'idle',
      });
      return;
    }

    const currentRoom = this.getRoomSnapshotForCoordinates(this.currentRoomCoordinates);
    if (!currentRoom?.music) {
      globalRoomMusicController.stopArrangement({
        transition: 'bar',
        mode: 'world-play',
      });
      return;
    }

    void globalRoomMusicController.playArrangement(currentRoom.music, {
      mode: 'world-play',
      transition: 'bar',
    });
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
    globalRoomMusicController.stopArrangement({
      transition: 'immediate',
      mode: 'idle',
    });
    this.presenceController.destroy();
    this.roomChatController.destroy();
    this.roomAudioController.destroy();
    this.lightingController.destroy();
    window.removeEventListener(AUTH_STATE_CHANGED_EVENT, this.handleAuthStateChanged);
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
    this.destroyRoomCourseBadges();
    this.destroyBrowsePresenceDots();
    this.destroyPlayRoomPresenceMarkers();
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
    const roomChatDebug = this.roomChatController.getDebugSnapshot();
    const roomAudioDebug = this.roomAudioController.getDebugSnapshot();
    const roomMusicDebug = globalRoomMusicController.getDebugState();
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
        browseDotCount: this.browsePresenceDotsByConnectionId.size,
        playRoomMarkerCount: this.playRoomPresenceMarkers.length,
      },
      roomChat: {
        status: roomChatDebug.snapshot?.status ?? 'disabled',
        subscribedShardCount: roomChatDebug.snapshot?.subscribedShards.length ?? 0,
        connectedShardCount: roomChatDebug.snapshot?.connectedShards.length ?? 0,
        composerOpen: roomChatDebug.composerOpen,
        messageCount: roomChatDebug.snapshot?.messages.length ?? 0,
        activeBubbleCount: roomChatDebug.activeBubbleCount,
        latestMessage: roomChatDebug.latestMessage
          ? {
              userId: roomChatDebug.latestMessage.userId,
              displayName: roomChatDebug.latestMessage.displayName,
              roomId: roomChatDebug.latestMessage.roomId,
              text: roomChatDebug.latestMessage.text,
              expiresAt: roomChatDebug.latestMessage.expiresAt,
            }
          : null,
      },
      roomAudio: roomAudioDebug,
      roomMusic: roomMusicDebug,
      lighting: this.lightingController.getDebugState(),
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
      roomChatDebug,
      liveObjects,
    };
  }
}
