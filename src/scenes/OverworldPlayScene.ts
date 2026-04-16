import Phaser from 'phaser';
import { playSfx } from '../audio/sfx';
import { createCourseRepository } from '../courses/courseRepository';
import { globalRoomMusicController } from '../music/controller';
import { getRoomMusicKey } from '../music/model';
import { getCoursePressurePlateLink } from '../courses/pressurePlateLinks';
import {
  getActiveCourseDraftSessionCourseId,
  getActiveCourseDraftSessionDraft,
} from '../courses/draftSession';
import {
  cloneCourseSnapshot,
  type CourseMarkerPoint,
  type CourseRoomRef,
  type CourseSnapshot,
} from '../courses/model';
import { SceneFxController } from '../fx/controller';
import {
  placedObjectContributesToCategory,
  type GameObjectConfig,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILE_SIZE,
} from '../config';
import {
  getFocusedCoordinatesFromUrl,
  hasFocusedCoordinatesInUrl,
  setFocusedCoordinatesInUrl,
} from '../navigation/worldNavigation';
import {
  DEFAULT_ROOM_COORDINATES,
  isRoomMinted,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../persistence/roomModel';
import { createRoomRepository } from '../persistence/roomRepository';
import { createWorldRepository } from '../persistence/worldRepository';
import {
  type WorldChunkBounds,
  type WorldChunkWindow,
  type WorldRoomSummary,
  type WorldWindow,
} from '../persistence/worldModel';
import {
  RETRO_COLORS,
  ensureStarfieldTexture,
} from '../visuals/starfield';
import { RoomLightingController } from '../lighting/controller';
import { type RoomLightingEmitter } from '../lighting/model';
import { resolvePlayerAuraDarkAuraDiameter } from '../lighting/presets';
import {
  DEFAULT_PLAYER_VISUAL_FEET_OFFSET,
  type DefaultPlayerAnimationState,
} from '../player/defaultPlayer';
import { resolveActivePlayerAvatarId } from '../player/avatar/runtime';
import { PLAYER_AVATAR_CHANGED_EVENT } from '../player/avatar/storage';
import {
  formatRoomGoalShortText,
  resolveRoomGoalIntroText,
  type GoalMarkerPoint,
} from '../goals/roomGoals';
import { setAppMode } from '../ui/appMode';
import { getDeviceLayoutState } from '../ui/deviceLayout';
import { createProfileRepository } from '../profiles/profileRepository';
import {
  COURSE_COMPOSER_STATE_CHANGED_EVENT,
  type MobilePortraitCameraTuningAdjustment,
  type MobilePortraitCameraTuningInput,
  type MobilePortraitCameraTuningSnapshot,
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
  type SelectedCellState,
} from './overworld/hudViewModel';
import {
  OverworldHudStateController,
  type SelectedRoomContext,
} from './overworld/hudState';
import {
  OverworldLiveObjectController,
  isDynamicArcadeBody,
  type ArcadeObjectBody,
  type LoadedRoomObject,
} from './overworld/liveObjects';
import { buildAmbientRoomLightingBounds } from './overworld/lighting';
import {
  OverworldPresenceController,
} from './overworld/presence';
import {
  OverworldRoomChatController,
} from './overworld/roomChat';
import { OverworldRoomAudioController } from './overworld/roomAudio';
import {
  OverworldCoursePlaybackController,
} from './overworld/coursePlayback';
import {
  OverworldGoalMarkerController,
} from './overworld/goalMarkers';
import {
  OverworldCameraController,
} from './overworld/cameraController';
import {
  OverworldRuntimeController,
  type OverworldRoomEdgeWall,
} from './overworld/runtimeController';
import {
  OverworldPlayerLifecycleController,
  type OverworldPlayerEntities,
} from './overworld/playerLifecycle';
import {
  OverworldCombatController,
} from './overworld/combatController';
import {
  OverworldMovementController,
  type OverworldMovementControllerState,
} from './overworld/movementController';
import {
  OverworldPlayerPresentationController,
  type OverworldPlayerPresentationControllerState,
} from './overworld/playerPresentation';
import {
  OverworldObjectiveController,
} from './overworld/objectiveController';
import {
  OverworldSessionResetController,
} from './overworld/sessionReset';
import {
  OverworldRoomTransitionController,
} from './overworld/roomTransition';
import {
  OverworldCourseComposerController,
} from './overworld/courseComposer';
import {
  OverworldWindowController,
} from './overworld/windowController';
import {
  OverworldViewportController,
} from './overworld/viewportController';
import {
  OverworldPresenceOverlayController,
} from './overworld/presenceOverlays';
import {
  OverworldSelectionController,
} from './overworld/selection';
import { OverworldSignController } from './overworld/signPosts';
import {
  OverworldRoomCellController,
} from './overworld/roomCells';
import {
  OverworldWorldStreamingController,
  type LoadedFullRoom,
} from './overworld/worldStreaming';
import {
  recordCourseRunDeath,
  type ActiveCourseRunState,
} from './overworld/courseRuns';
import {
  RankedRunTraceRecorder,
  type RankedRunTraceBinding,
  type RankedRunTraceFrameInput,
} from './overworld/rankedRunTraceRecorder';
import type { RankedRunVerificationTrace } from '../runs/verificationTrace';
import {
  getScrollForScreenAnchor,
  type CameraMode,
} from './overworld/camera';
import {
  terrainTileCollidesAtLocalPixel,
} from './overworld/terrainCollision';
import type {
  EditorCourseEditData,
  OverworldMode,
  OverworldPlaySceneData,
} from './sceneData';
import {
  consumeTouchAction,
  getTouchInputState,
} from '../ui/mobile/touchControls';
import { getRoomGoalIntroModalController } from '../ui/setup/roomGoalIntroModal';
import {
  createMobilePerformanceProfiler,
  type MobilePerformanceContext,
  type MobilePerformanceProfiler,
} from '../debug/mobilePerformanceProfiler';

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
const MOBILE_PORTRAIT_PLAY_CAMERA_TARGET_Y = 0.44;
const MOBILE_PORTRAIT_PLAY_CAMERA_ZOOM_MULTIPLIER = 2.25;
const MOBILE_PORTRAIT_PLAY_CAMERA_MIN_ZOOM_MULTIPLIER = 0.75;
const MOBILE_PORTRAIT_PLAY_CAMERA_MAX_ZOOM_MULTIPLIER = 3.25;
const MOBILE_PORTRAIT_PLAY_CAMERA_MIN_TARGET_Y = 0.25;
const MOBILE_PORTRAIT_PLAY_CAMERA_MAX_TARGET_Y = 0.78;
const MOBILE_PORTRAIT_CAMERA_TUNING_STORAGE_KEY = 'wamp_mobile_portrait_camera_tuning_v1';

type RoomEdgeWall = OverworldRoomEdgeWall;

type SceneLoadedFullRoom = LoadedFullRoom<LoadedRoomObject, RoomEdgeWall>;

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
  private readonly WALL_JUMP_BUFFER_MS = 240;
  private readonly WALL_CONTACT_GRACE_MS = 140;
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
  private playfunPauseRequested = false;
  private roomGoalIntroFromOverworldPending = false;
  private roomGoalIntroPauseRequested = false;
  private scenePauseApplied = false;

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
  private activeCrateInteractionMode: 'push' | 'pull' | null = null;
  private activeCrateInteractionFacing: -1 | 1 | null = null;
  private weaponKnockbackVelocityX = 0;
  private weaponKnockbackUntil = 0;
  private externalLaunchGraceUntil = 0;
  private ladderClimbSfxPlaying = false;

  private loadingText!: Phaser.GameObjects.Text;
  private starfieldSprites: Phaser.GameObjects.TileSprite[] = [];
  private backdropCamera: Phaser.Cameras.Scene2D.Camera | null = null;
  private hudBridge: OverworldHudBridge | null = null;
  private fxController: SceneFxController | null = null;
  private mobilePerformanceProfiler: MobilePerformanceProfiler | null = null;

  private mode: OverworldMode = 'browse';
  private cameraMode: CameraMode = 'inspect';
  private selectedCoordinates: RoomCoordinates = { ...DEFAULT_ROOM_COORDINATES };
  private currentRoomCoordinates: RoomCoordinates = { ...DEFAULT_ROOM_COORDINATES };
  private windowCenterCoordinates: RoomCoordinates = { ...DEFAULT_ROOM_COORDINATES };
  private inspectZoom = DEFAULT_ZOOM;
  private browseInspectZoom = DEFAULT_ZOOM;
  private mobilePortraitCameraTuningEnabled = false;
  private mobilePortraitCameraZoomMultiplier = MOBILE_PORTRAIT_PLAY_CAMERA_ZOOM_MULTIPLIER;
  private mobilePortraitCameraTargetY = MOBILE_PORTRAIT_PLAY_CAMERA_TARGET_Y;
  private mobilePortraitCameraTunerApi: Window['wampMobileCameraTuner'] | null = null;
  private shouldAutoPlayDeepLinkedRoomOnBoot = false;
  private lastRoomMusicSyncSignature = '';
  private transientStatusMessage: string | null = null;
  private transientStatusExpiresAt = 0;
  private quicksandTouchedUntil = 0;
  private quicksandVisualSink = 0;
  private quicksandStatusCooldownUntil = 0;
  private readonly roomRepository = createRoomRepository();
  private readonly courseRepository = createCourseRepository();
  private readonly profileRepository = createProfileRepository();
  private activeCourseRun: ActiveCourseRunState | null = null;
  private courseEditorReturnTarget: OverworldPlaySceneData['courseEditorReturnTarget'] = null;

  private coyoteTime = 0;
  private jumpBuffered = false;
  private jumpBufferTime = 0;
  private wallContactSide: -1 | 1 | 0 = 0;
  private wallContactGraceSide: -1 | 1 | 0 = 0;
  private wallContactGraceUntil = 0;
  private isWallSliding = false;
  private wallJumpLockUntil = 0;
  private wallJumpActive = false;
  private wallJumpDirection: -1 | 1 | 0 = 0;
  private wallJumpChainActive = false;
  private isClimbingLadder = false;
  private activeLadderKey: string | null = null;
  private collectedObjectKeys = new Set<string>();
  private heldKeyCount = 0;
  private score = 0;
  private readonly rankedRunTraceRecorder = new RankedRunTraceRecorder();
  private readonly goalRunController: OverworldGoalRunController;
  private readonly roomAudioController: OverworldRoomAudioController;
  private readonly lightingController: RoomLightingController;
  private readonly flowController: OverworldSceneFlowController;
  private readonly inspectInputController: OverworldInspectInputController;
  private readonly gridOverlayController: OverworldGridOverlayController;
  private readonly browseOverlayController: OverworldBrowseOverlayController;
  private readonly roomCellController: OverworldRoomCellController;
  private readonly coursePlaybackController: OverworldCoursePlaybackController;
  private readonly goalMarkerController: OverworldGoalMarkerController;
  private readonly cameraController: OverworldCameraController;
  private readonly runtimeController: OverworldRuntimeController<LoadedRoomObject>;
  private readonly playerLifecycleController: OverworldPlayerLifecycleController<LoadedRoomObject>;
  private readonly playerPresentationController: OverworldPlayerPresentationController;
  private readonly objectiveController: OverworldObjectiveController;
  private readonly movementController: OverworldMovementController;
  private readonly combatController: OverworldCombatController;
  private readonly sessionResetController: OverworldSessionResetController;
  private readonly roomTransitionController: OverworldRoomTransitionController;
  private readonly courseComposerController: OverworldCourseComposerController;
  private readonly windowController: OverworldWindowController;
  private readonly viewportController: OverworldViewportController;
  private readonly presenceOverlayController: OverworldPresenceOverlayController;
  private readonly selectionController: OverworldSelectionController;
  private readonly hudStateController: OverworldHudStateController;
  private readonly liveObjectController: OverworldLiveObjectController<RoomEdgeWall>;
  private readonly signController: OverworldSignController<RoomEdgeWall>;
  private readonly worldStreamingController: OverworldWorldStreamingController<
    LoadedRoomObject,
    RoomEdgeWall
  >;
  private readonly presenceController: OverworldPresenceController;
  private readonly roomChatController: OverworldRoomChatController;

  private shouldCenterCamera = false;
  private shouldRespawnPlayer = false;
  private readonly handlePlayfunGamePause = (): void => {
    this.playfunPauseDepth += 1;
    this.playfunPauseRequested = true;
    this.syncScenePauseState();
  };

  private readonly handlePlayfunGameResume = (): void => {
    this.playfunPauseDepth = Math.max(0, this.playfunPauseDepth - 1);
    this.playfunPauseRequested = this.playfunPauseDepth > 0;
    this.syncScenePauseState();
  };

  constructor() {
    super({ key: 'OverworldPlayScene' });
    const thisScene = this;
    this.goalRunController = new OverworldGoalRunController({
      playerHeight: this.PLAYER_HEIGHT,
      runRepository: createRunRepository(),
      getScore: () => this.score,
      getAuthenticated: () => getAuthDebugState().authenticated,
      getAuthSource: () => getAuthDebugState().source ?? null,
      getAuthDisplayName: () => getAuthDebugState().user?.displayName ?? null,
      showTransientStatus: (message) => this.showTransientStatus(message),
      countRoomObjectsByCategory: (room, category) =>
        this.countRoomObjectsByCategory(room, category),
      onRankedRunStarted: (binding) => {
        this.startRankedRunTrace(binding.kind, binding);
      },
      buildVerificationTrace: (runState, result) =>
        this.buildRankedRunVerificationTrace('room', runState.elapsedMs, result),
      clearVerificationTrace: () => {
        this.clearRankedRunTrace();
      },
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
      getLoadedFullRooms: () => this.loadedFullRoomsById.values(),
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
      handlePlayerDeath: (reason) => this.sessionResetController.handlePlayerDeath(reason),
      onEnemyDefeated: (event) => this.handleEnemyDefeated(event),
      onCollectibleCollected: (event) => this.handleCollectibleCollected(event),
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
    this.signController = new OverworldSignController({
      getMode: () => this.mode,
      getPlayerBody: () => this.playerBody,
      getLoadedFullRooms: () => this.loadedFullRoomsById.values(),
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
      syncLiveObjectWorldColliders: (loadedRooms) =>
        this.liveObjectController.syncLoadedWorldColliders(loadedRooms),
      onBackdropObjectsChanged: () => this.syncBackdropCameraIgnores(),
      onFullRoomVisibilityChanged: () => this.syncGhostVisibility(),
      measurePerformance: (label, callback) => this.measureMobilePerformance(label, callback),
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
      showTransientStatus: (message) => this.showTransientStatus(message),
      renderHud: () => this.renderHud(),
      onRankedRunStarted: (binding) => {
        this.startRankedRunTrace(binding.kind, binding);
      },
      buildVerificationTrace: (runState, result) =>
        this.buildRankedRunVerificationTrace('course', runState.elapsedMs, result),
      clearVerificationTrace: () => {
        this.clearRankedRunTrace();
      },
    });
    this.courseComposerController = new OverworldCourseComposerController({
      roomRepository: this.roomRepository,
      courseRepository: this.courseRepository,
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
      setShouldCenterCamera: (value) => {
        this.shouldCenterCamera = value;
      },
      setShouldRespawnPlayer: (value) => {
        this.shouldRespawnPlayer = value;
      },
      getBrowseInspectZoom: () => this.browseInspectZoom,
      setInspectZoom: (zoom) => {
        this.inspectZoom = zoom;
      },
      syncAppMode: () => this.syncAppMode(),
      getRoomSnapshotForCoordinates: (coordinates) => this.getRoomSnapshotForCoordinates(coordinates),
      getSelectedSummaryCourseId: () =>
        this.hudStateController.getSelectedSummary()?.course?.courseId ?? null,
      getActiveCourseRun: () => this.activeCourseRun,
      resetPlaySession: () => {
        this.sessionResetController.resetPlaySession();
      },
      clearTouchGestureState: () => this.clearTouchGestureState(),
      showTransientStatus: (message) => this.showTransientStatus(message),
      updateSelectedSummary: () => this.updateSelectedSummary(),
      redrawWorld: () => this.redrawWorld(),
      renderHud: () => this.renderHud(),
      emitStateChanged: () => this.emitCourseComposerStateChanged(),
      refreshAround: (coordinates, options) => this.refreshAround(coordinates, options),
      openEditor: (editorData) => this.flowController.openEditor(editorData),
      startDraftCoursePlayback: (snapshot) =>
        this.flowController.startCoursePlayback(snapshot, 'draftPreview'),
    });
    this.windowController = new OverworldWindowController(this, {
      worldStreamingController: this.worldStreamingController,
      getMode: () => this.mode,
      setMode: (mode) => {
        this.mode = mode;
      },
      setCameraMode: (mode) => {
        this.cameraMode = mode;
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
      getRefreshCenterCoordinates: () => this.getZoomFocusCoordinates(),
      getWindowCenterCoordinates: () => ({ ...this.windowCenterCoordinates }),
      setWindowCenterCoordinates: (coordinates) => {
        this.windowCenterCoordinates = { ...coordinates };
      },
      setSelectedCoordinates: (coordinates) => {
        this.selectedCoordinates = { ...coordinates };
      },
      setCurrentRoomCoordinates: (coordinates) => {
        this.currentRoomCoordinates = { ...coordinates };
      },
      getCurrentRoomCoordinates: () => ({ ...this.currentRoomCoordinates }),
      setShouldCenterCamera: (value) => {
        this.shouldCenterCamera = value;
      },
      setShouldRespawnPlayer: (value) => {
        this.shouldRespawnPlayer = value;
      },
      syncAppMode: () => this.syncAppMode(),
      resetPlaySession: () => {
        this.sessionResetController.resetPlaySession();
      },
      showTransientStatus: (message) => this.showTransientStatus(message),
      setCourseEditorReturnTarget: (target) => {
        this.courseEditorReturnTarget = target;
      },
      syncCourseComposerRecordFromSession: () => {
        this.courseComposerController.syncRecordFromSession();
      },
      handleCourseEditorReturned: () => {
        this.courseComposerController.handleCourseEditorReturned();
      },
      activateDraftCoursePreview: (snapshot, draftRoom) =>
        this.coursePlaybackController.activateDraftCoursePreview(snapshot, draftRoom),
      updateSelectedSummary: () => this.updateSelectedSummary(),
      refreshLeaderboardForSelection: () => this.refreshLeaderboardForSelection(),
      updateCameraBounds: () => this.updateCameraBounds(),
      syncModeRuntime: () => this.syncModeRuntime(),
      syncPreviewVisibility: () => this.syncPreviewVisibility(),
      syncPresenceSubscriptions: () => this.syncPresenceSubscriptions(),
      syncGhostVisibility: () => this.syncGhostVisibility(),
      redrawWorld: () => this.redrawWorld(),
      renderHud: (statusOverride) => this.renderHud(statusOverride),
      hideLoadingText: () => {
        this.loadingText.setVisible(false);
      },
      getTimeNow: () => this.time.now,
      getBrowseRefreshIntervalMs: () => BROWSE_VISIBLE_CHUNK_REFRESH_INTERVAL_MS,
      getPlayRefreshIntervalMs: () => PLAY_VISIBLE_CHUNK_REFRESH_INTERVAL_MS,
    });
    this.objectiveController = new OverworldObjectiveController(
      {
        goalRunController: this.goalRunController,
        getActiveCourseRun: () => this.activeCourseRun,
        getPlayer: () => this.player,
        getPlayerBody: () => this.playerBody,
        getCurrentRoomCoordinates: () => this.currentRoomCoordinates,
        getPlayerEffectOrigin: () => this.getPlayerEffectOrigin(),
        toWorldGoalPoint: (roomCoordinates, point) =>
          this.toWorldGoalPoint(roomCoordinates, point),
        toWorldCoursePoint: (point) => this.toWorldCoursePoint(point),
        resetChallengeStateForCurrentRun: () =>
          this.sessionResetController.resetChallengeStateForCurrentRun(),
        showTransientStatus: (message) => this.showTransientStatus(message),
        redrawGoalMarkers: () => this.redrawGoalMarkers(),
        playGoalFx: (effect, x, y, cue) => this.fxController?.playGoalFx(effect, x, y, cue),
        finalizeActiveCourseRun: (result) => {
          void this.coursePlaybackController.finalizeActiveCourseRun(result);
        },
        recordRankedGoalEvent: (event) => {
          this.recordRankedGoalEvent(event);
        },
      },
      {
        goalTouchRadius: 18,
      },
    );
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
      getZoom: () => this.cameras.main.zoom,
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
      getCourseComposerRecord: () => this.courseComposerController.getRecord(),
    });
    this.cameraController = new OverworldCameraController(
      {
        scene: this,
        getWorldWindow: () => this.worldWindow,
        getMode: () => this.mode,
        getCameraMode: () => this.cameraMode,
        setCameraMode: (mode) => {
          this.cameraMode = mode;
        },
        getInspectZoom: () => this.inspectZoom,
        getPlayer: () => this.player,
        getRoomOrigin: (coordinates) => this.getRoomOrigin(coordinates),
        renderHud: () => this.renderHud(),
      },
      {
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        playRoomFitPadding: PLAY_ROOM_FIT_PADDING,
        followCameraLerp: FOLLOW_CAMERA_LERP,
        mobilePlayCameraTargetY: MOBILE_PLAY_CAMERA_TARGET_Y,
        getMobilePortraitPlayCameraTargetY: () => this.mobilePortraitCameraTargetY,
      },
    );
    this.viewportController = new OverworldViewportController(
      {
        scene: this,
        getMode: () => this.mode,
        getCameraMode: () => this.cameraMode,
        getPlayer: () => this.player,
        getInspectZoom: () => this.inspectZoom,
        setInspectZoom: (zoom) => {
          this.inspectZoom = zoom;
        },
        getBrowseInspectZoom: () => this.browseInspectZoom,
        setBrowseInspectZoom: (zoom) => {
          this.browseInspectZoom = zoom;
        },
        getZoomFocusCoordinates: () => this.getZoomFocusCoordinates(),
        centerCameraOnCoordinates: (coordinates) => this.centerCameraOnCoordinates(coordinates),
        startFollowCamera: (camera) => this.startFollowCamera(camera),
        constrainInspectCamera: () => this.constrainInspectCamera(),
        refreshChunkWindowIfNeeded: (centerCoordinates) =>
          this.refreshChunkWindowIfNeeded(centerCoordinates),
        updateBackdrop: () => this.updateBackdrop(),
        redrawWorldCells: () => this.roomCellController.redrawForZoom(),
        redrawGridOverlay: () => this.gridOverlayController.redraw(),
        renderHud: () => this.renderHud(),
        getSelectedCoordinates: () => ({ ...this.selectedCoordinates }),
        getCurrentRoomCoordinates: () => ({ ...this.currentRoomCoordinates }),
      },
      {
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        buttonZoomFactor: BUTTON_ZOOM_FACTOR,
        wheelZoomSensitivity: WHEEL_ZOOM_SENSITIVITY,
      },
    );
    this.runtimeController = new OverworldRuntimeController(
      {
        scene: this,
        getLoadedFullRooms: () => this.loadedFullRoomsById.values(),
        getMode: () => this.mode,
        setMode: (mode) => {
          this.mode = mode;
        },
        getSelectedCoordinates: () => ({ ...this.selectedCoordinates }),
        getCurrentRoomSnapshot: () => this.getRoomSnapshotForCoordinates(this.currentRoomCoordinates),
        getActiveCourseSnapshot: () => this.activeCourseSnapshot,
        getActiveCourseRun: () => this.activeCourseRun,
        getShouldRespawnPlayer: () => this.shouldRespawnPlayer,
        setShouldRespawnPlayer: (value) => {
          this.shouldRespawnPlayer = value;
        },
        getPlayer: () => this.player,
        getPlayerBody: () => this.playerBody,
        createPlayer: (room) => this.createPlayer(room),
        destroyPlayer: () => this.destroyPlayer(),
        syncAppMode: () => this.syncAppMode(),
        setCameraMode: (mode) => {
          this.cameraMode = mode;
        },
        clearCurrentGoalRun: () => {
          this.goalRunController.clearCurrentRun();
        },
        syncGoalRunForRoom: (room, entryContext) => {
          this.syncGoalRunForRoomWithIntro(room, entryContext);
        },
        redrawGoalMarkers: () => this.redrawGoalMarkers(),
        syncCameraBoundsUsage: () => this.syncCameraBoundsUsage(),
        syncGhostVisibility: () => this.syncGhostVisibility(),
        getShouldCenterCamera: () => this.shouldCenterCamera,
        setShouldCenterCamera: (value) => {
          this.shouldCenterCamera = value;
        },
        centerCameraOnCoordinates: (coordinates) =>
          this.centerCameraOnCoordinates(coordinates),
        constrainInspectCamera: () => this.constrainInspectCamera(),
        applyCameraMode: (forceCenter) => this.applyCameraMode(forceCenter),
        syncLiveObjectWorldColliders: (loadedRooms) =>
          this.liveObjectController.syncLoadedWorldColliders(loadedRooms),
        syncLiveObjectInteractions: (loadedRooms) =>
          this.liveObjectController.syncLiveObjectInteractions(loadedRooms),
        clearRoomInteractions: (loadedRoom) =>
          this.liveObjectController.clearRoomInteractions(loadedRoom),
        destroyRoomEdgeWalls: (loadedRoom) => this.destroyEdgeWalls(loadedRoom),
        getRoomOrigin: (coordinates) => this.getRoomOrigin(coordinates),
        getCellStateAt: (coordinates) => this.getCellStateAt(coordinates),
        syncBackdropCameraIgnores: () => this.syncBackdropCameraIgnores(),
      },
      {
        edgeWallThickness: EDGE_WALL_THICKNESS,
      },
    );
    this.playerLifecycleController = new OverworldPlayerLifecycleController(
      {
        scene: this,
        getActiveCourseSnapshot: () => this.activeCourseSnapshot,
        getRoomOrigin: (coordinates) => this.getRoomOrigin(coordinates),
        clearRoomInteractions: (loadedRoom) =>
          this.liveObjectController.clearRoomInteractions(loadedRoom),
        destroyRoomEdgeWalls: (loadedRoom) => this.destroyEdgeWalls(loadedRoom),
        syncBackdropCameraIgnores: () => this.syncBackdropCameraIgnores(),
      },
      {
        playerWidth: this.PLAYER_WIDTH,
        playerHeight: this.PLAYER_HEIGHT,
        playerPickupSensorExtraHeight: this.PLAYER_PICKUP_SENSOR_EXTRA_HEIGHT,
      },
    );
    const playerPresentationState: OverworldPlayerPresentationControllerState = {
      get animationState() {
        return thisScene.playerAnimationState;
      },
      set animationState(value: DefaultPlayerAnimationState) {
        thisScene.playerAnimationState = value;
      },
      get facing() {
        return thisScene.playerFacing as -1 | 1;
      },
      set facing(value: -1 | 1) {
        thisScene.playerFacing = value;
      },
      get wasGrounded() {
        return thisScene.playerWasGrounded;
      },
      set wasGrounded(value: boolean) {
        thisScene.playerWasGrounded = value;
      },
      get landAnimationUntil() {
        return thisScene.playerLandAnimationUntil;
      },
      set landAnimationUntil(value: number) {
        thisScene.playerLandAnimationUntil = value;
      },
    };
    this.playerPresentationController = new OverworldPlayerPresentationController(
      {
        state: playerPresentationState,
        getCurrentTime: () => this.time.now,
        getPlayer: () => this.player,
        getPlayerBody: () => this.playerBody,
        getPlayerSprite: () => this.playerSprite,
        getPlayerPickupSensor: () => this.playerPickupSensor,
        getPlayerPickupSensorBody: () => this.playerPickupSensorBody,
        getQuicksandVisualSink: () => this.quicksandVisualSink,
        getWeaponKnockbackUntil: () => this.weaponKnockbackUntil,
        getIsClimbingLadder: () => this.isClimbingLadder,
        getIsWallSliding: () => this.isWallSliding,
        getWallContactSide: () => this.wallContactSide,
        getWallJumpActive: () => this.wallJumpActive,
        getIsCrouching: () => this.isCrouching,
        getActiveCrateInteractionMode: () => this.activeCrateInteractionMode,
        getActiveCrateInteractionFacing: () => this.activeCrateInteractionFacing,
        getCurrentAttackAnimation: (now) => this.combatController.getCurrentAttackAnimation(now),
        playLandingDustFx: (x, y, facing) => this.fxController?.playLandingDustFx(x, y, facing),
      },
      {
        playerPickupSensorExtraHeight: this.PLAYER_PICKUP_SENSOR_EXTRA_HEIGHT,
        playerVisualFeetOffset: DEFAULT_PLAYER_VISUAL_FEET_OFFSET,
        landingAnimationMs: 120,
        facingVelocityThreshold: 8,
        jumpRiseVelocityThreshold: -10,
        crouchMoveVelocityThreshold: 8,
        runVelocityThreshold: 12,
      },
    );
    const movementState: OverworldMovementControllerState = {
      get isCrouching() {
        return thisScene.isCrouching;
      },
      set isCrouching(value: boolean) {
        thisScene.isCrouching = value;
      },
      get activeCrateInteractionMode() {
        return thisScene.activeCrateInteractionMode;
      },
      set activeCrateInteractionMode(value: 'push' | 'pull' | null) {
        thisScene.activeCrateInteractionMode = value;
      },
      get activeCrateInteractionFacing() {
        return thisScene.activeCrateInteractionFacing;
      },
      set activeCrateInteractionFacing(value: -1 | 1 | null) {
        thisScene.activeCrateInteractionFacing = value;
      },
      get weaponKnockbackVelocityX() {
        return thisScene.weaponKnockbackVelocityX;
      },
      set weaponKnockbackVelocityX(value: number) {
        thisScene.weaponKnockbackVelocityX = value;
      },
      get weaponKnockbackUntil() {
        return thisScene.weaponKnockbackUntil;
      },
      set weaponKnockbackUntil(value: number) {
        thisScene.weaponKnockbackUntil = value;
      },
      get ladderClimbSfxPlaying() {
        return thisScene.ladderClimbSfxPlaying;
      },
      set ladderClimbSfxPlaying(value: boolean) {
        thisScene.ladderClimbSfxPlaying = value;
      },
      get coyoteTime() {
        return thisScene.coyoteTime;
      },
      set coyoteTime(value: number) {
        thisScene.coyoteTime = value;
      },
      get jumpBuffered() {
        return thisScene.jumpBuffered;
      },
      set jumpBuffered(value: boolean) {
        thisScene.jumpBuffered = value;
      },
      get jumpBufferTime() {
        return thisScene.jumpBufferTime;
      },
      set jumpBufferTime(value: number) {
        thisScene.jumpBufferTime = value;
      },
      get wallContactSide() {
        return thisScene.wallContactSide;
      },
      set wallContactSide(value: -1 | 1 | 0) {
        thisScene.wallContactSide = value;
      },
      get wallContactGraceSide() {
        return thisScene.wallContactGraceSide;
      },
      set wallContactGraceSide(value: -1 | 1 | 0) {
        thisScene.wallContactGraceSide = value;
      },
      get wallContactGraceUntil() {
        return thisScene.wallContactGraceUntil;
      },
      set wallContactGraceUntil(value: number) {
        thisScene.wallContactGraceUntil = value;
      },
      get isWallSliding() {
        return thisScene.isWallSliding;
      },
      set isWallSliding(value: boolean) {
        thisScene.isWallSliding = value;
      },
      get wallJumpLockUntil() {
        return thisScene.wallJumpLockUntil;
      },
      set wallJumpLockUntil(value: number) {
        thisScene.wallJumpLockUntil = value;
      },
      get wallJumpActive() {
        return thisScene.wallJumpActive;
      },
      set wallJumpActive(value: boolean) {
        thisScene.wallJumpActive = value;
      },
      get wallJumpDirection() {
        return thisScene.wallJumpDirection;
      },
      set wallJumpDirection(value: -1 | 1 | 0) {
        thisScene.wallJumpDirection = value;
      },
      get wallJumpChainActive() {
        return thisScene.wallJumpChainActive;
      },
      set wallJumpChainActive(value: boolean) {
        thisScene.wallJumpChainActive = value;
      },
      get isClimbingLadder() {
        return thisScene.isClimbingLadder;
      },
      set isClimbingLadder(value: boolean) {
        thisScene.isClimbingLadder = value;
      },
      get activeLadderKey() {
        return thisScene.activeLadderKey;
      },
      set activeLadderKey(value: string | null) {
        thisScene.activeLadderKey = value;
      },
    };
    this.movementController = new OverworldMovementController(
      {
        state: movementState,
        getCurrentTime: () => this.time.now,
        getPlayer: () => this.player,
        getPlayerBody: () => this.playerBody,
        getPlayerFacing: () => this.playerFacing as -1 | 1,
        getCurrentRoomCoordinates: () => this.currentRoomCoordinates,
        getRoomSnapshotForCoordinates: (coordinates) => this.getRoomSnapshotForCoordinates(coordinates),
        isSolidTerrainAtWorldPoint: (room, worldX, worldY) =>
          this.isSolidTerrainAtWorldPoint(room, worldX, worldY),
        getExternalLaunchGraceUntil: () => this.externalLaunchGraceUntil,
        getLoadedLiveObjects: function* () {
          for (const loadedRoom of thisScene.loadedFullRoomsById.values()) {
            yield* loadedRoom.liveObjects;
          }
        },
        getArcadeBodyBounds: (body) => this.getArcadeBodyBounds(body),
        getCursors: () => this.cursors,
        getWasd: () => this.wasd,
        findOverlappingLadder: () => this.findOverlappingLadder(),
        playJumpDustFx: (x, y, facing) => this.fxController?.playJumpDustFx(x, y, facing),
        syncPlayerPickupSensor: () => this.playerPresentationController.syncPlayerPickupSensor(),
      },
      {
        playerWidth: this.PLAYER_WIDTH,
        playerHeight: this.PLAYER_HEIGHT,
        playerCrouchHeight: this.PLAYER_CROUCH_HEIGHT,
        playerSpeed: this.PLAYER_SPEED,
        crawlSpeed: this.CRAWL_SPEED,
        cratePushSpeed: this.CRATE_PUSH_SPEED,
        cratePullSpeed: this.CRATE_PULL_SPEED,
        crateInteractionMaxGap: this.CRATE_INTERACTION_MAX_GAP,
        coyoteMs: this.COYOTE_MS,
        jumpBufferMs: this.JUMP_BUFFER_MS,
        wallJumpBufferMs: this.WALL_JUMP_BUFFER_MS,
        wallContactGraceMs: this.WALL_CONTACT_GRACE_MS,
        jumpVelocity: this.JUMP_VELOCITY,
        wallSlideMaxFallSpeed: this.WALL_SLIDE_MAX_FALL_SPEED,
        wallJumpVelocityX: this.WALL_JUMP_VELOCITY_X,
        wallJumpVelocityY: this.WALL_JUMP_VELOCITY_Y,
        wallJumpInputLockMs: this.WALL_JUMP_INPUT_LOCK_MS,
        ladderClimbSpeed: this.LADDER_CLIMB_SPEED,
        quicksandMoveFactor: this.QUICKSAND_MOVE_FACTOR,
        quicksandJumpFactor: this.QUICKSAND_JUMP_FACTOR,
        weaponKnockbackMs: this.WEAPON_KNOCKBACK_MS,
      },
    );
    this.combatController = new OverworldCombatController(
      {
        scene: this,
        getCurrentTime: () => this.time.now,
        getPlayer: () => this.player,
        getPlayerBody: () => this.playerBody,
        getPlayerFacing: () => this.playerFacing as -1 | 1,
        isPlayerCrouching: () => this.isCrouching,
        attackEnemiesInRect: (attackRect, damage) =>
          this.liveObjectController.attackEnemiesInRect(
            this.loadedFullRoomsById.values(),
            attackRect,
            damage,
          ),
        attackEnemyAtPoint: (worldX, worldY, damage) =>
          this.liveObjectController.attackEnemyAtPoint(
            this.loadedFullRoomsById.values(),
            worldX,
            worldY,
            damage,
          ),
        isProjectileBlocked: (worldX, worldY) => this.isProjectileBlocked(worldX, worldY),
        applyWeaponKnockback: (velocityX) => this.movementController.applyWeaponKnockback(velocityX),
        playSwordSlashFx: (x, y, facing, downward) =>
          this.fxController?.playSwordSlashFx(x, y, facing, downward),
        playMuzzleFlashFx: (x, y, facing) =>
          this.fxController?.playMuzzleFlashFx(x, y, facing),
        playBulletImpactFx: (x, y) => this.fxController?.playBulletImpactFx(x, y),
        shakeCamera: (durationMs, intensity) => this.cameras.main.shake(durationMs, intensity),
        syncBackdropCameraIgnores: () => this.syncBackdropCameraIgnores(),
      },
      {
        swordCooldownMs: this.SWORD_COOLDOWN_MS,
        swordAttackMs: this.SWORD_ATTACK_MS,
        swordHitDamage: 3,
        swordHitLungeVelocity: this.SWORD_HIT_LUNGE_VELOCITY,
        downwardSlashBounceVelocity: this.DOWNWARD_SLASH_BOUNCE_VELOCITY,
        gunCooldownMs: this.GUN_COOLDOWN_MS,
        gunAttackMs: this.GUN_ATTACK_MS,
        gunHitDamage: 5,
        gunRecoilVelocity: this.GUN_RECOIL_VELOCITY,
        projectileSpeed: this.PROJECTILE_SPEED,
        projectileLifetimeMs: this.PROJECTILE_LIFETIME_MS,
        playerSpeed: this.PLAYER_SPEED,
      },
    );
    this.sessionResetController = new OverworldSessionResetController({
      getCurrentGoalRun: () => this.currentGoalRun,
      getActiveCourseRun: () => this.activeCourseRun,
      setActiveCourseRun: (runState) => {
        this.activeCourseRun = runState;
      },
      recordGoalRunDeath: () => {
        this.goalRunController.recordDeath();
      },
      recordCourseRunDeath: () => {
        recordCourseRunDeath(this.activeCourseRun);
      },
      playPlayerFailFx: () => {
        if (this.player && this.playerBody) {
          this.fxController?.playGoalFx('fail', this.player.x, this.playerBody.bottom - 10, null);
        }
      },
      respawnPlayerToCurrentRoom: () => this.respawnPlayerToCurrentRoom(),
      failCourseRun: (message) => this.objectiveController.failCourseRun(message),
      failGoalRun: (message) => this.objectiveController.failGoalRun(message),
      showTransientStatus: (message) => this.showTransientStatus(message),
      getRoomSnapshotForCoordinates: (coordinates) =>
        this.getRoomSnapshotForCoordinates(coordinates),
      restartGoalRunForRoom: (room) => {
        this.objectiveController.restartGoalRunForRoom(room, 'respawn');
      },
      refreshLeaderboardForSelection: () => {
        void this.refreshLeaderboardForSelection();
      },
      abandonGoalRun: () => {
        this.goalRunController.abandonActiveRun();
      },
      finalizeActiveCourseRun: (result) => {
        void this.coursePlaybackController.finalizeActiveCourseRun(result);
      },
      clearActiveCourseRoomOverrides: () => {
        this.coursePlaybackController.clearActiveCourseRoomOverrides();
      },
      resetRoomChallengeState: (room) => this.resetRoomChallengeState(room),
      resetTransientPlayState: () => this.resetTransientPlayState(),
      resetGoalRunController: () => {
        this.goalRunController.reset();
      },
      redrawGoalMarkers: () => this.redrawGoalMarkers(),
    });
    this.hudStateController = new OverworldHudStateController({
      getMode: () => this.mode,
      getSelectedCoordinates: () => ({ ...this.selectedCoordinates }),
      getCellStateAt: (coordinates) => this.getCellStateAt(coordinates),
      getRoomSummary: (roomId) => this.roomSummariesById.get(roomId),
      getDraftRoom: (roomId) => this.draftRoomsById.get(roomId) ?? null,
      getRoomPopulation: (coordinates) => this.getRoomPopulation(coordinates),
      getRoomEditorCount: (coordinates) => this.getRoomEditorCount(coordinates),
      getRoomEditorDisplayNames: (coordinates) => this.getRoomEditorDisplayNames(coordinates),
      getActiveCourseRun: () => this.activeCourseRun,
      getCurrentGoalRun: () => this.currentGoalRun,
      getRoomSnapshotForCoordinates: (coordinates) => this.getRoomSnapshotForCoordinates(coordinates),
      getCurrentRoomLeaderboard: () => this.currentRoomLeaderboard,
      getGoalPersistentStatusText: () => this.goalRunController.getPersistentStatusText() ?? null,
      getTotalPlayerCount: () => this.presenceController.getTotalPlayerCount(),
      getOnlineRosterEntries: () =>
        this.presenceController.getOnlineRoster().map((entry) => ({
          key: entry.key,
          userId: entry.userId,
          displayName: entry.displayName,
          roomText:
            entry.mode === 'play'
              ? `Playing in Room ${entry.roomId}`
              : entry.mode === 'edit'
                ? `Building in Room ${entry.roomId}`
                : `Browsing Room ${entry.roomId}`,
          roomCoordinates: entry.roomCoordinates,
          mode: entry.mode,
          isSelf: entry.isSelf,
        })),
      getActiveSignState: () => this.signController.getActiveSign(),
      loadRoomOwnershipDetails: async (roomId, coordinates) => {
        const record = await this.roomRepository.loadRoom(roomId, coordinates);
        return {
          claimerUserId: record.claimerUserId,
          isMinted: isRoomMinted(record),
          mintedOwnerWalletAddress: record.mintedOwnerWalletAddress,
        };
      },
      loadPublicProfileSummary: async (userId) => {
        const profile = await this.profileRepository.loadProfile(userId);
        return {
          displayName: profile.displayName,
          playerLevel: profile.progression.player.level,
          playerProgressFraction: profile.progression.player.progressFraction,
          curatorLevel: profile.progression.curator.level,
          curatorProgressFraction: profile.progression.curator.progressFraction,
          builderLevel: profile.progression.builder.level,
          builderProgressFraction: profile.progression.builder.progressFraction,
        };
      },
      loadPublishedCourseSnapshot: async (courseId) => {
        const record = await this.courseRepository.loadCourse(courseId);
        return record.published ? cloneCourseSnapshot(record.published) : null;
      },
      countRoomEnemies: (room) => this.countRoomObjectsByCategory(room, 'enemy'),
      getScore: () => this.score,
      isCourseComposerLoading: () => this.courseComposerController.isLoading(),
      getZoom: () => this.cameras.main.zoom,
      getTransientStatusMessage: () => this.getTransientStatusMessage(),
      renderHudViewModel: (viewModel) => {
        this.hudBridge?.render(viewModel);
      },
      syncOverlayScale: () => this.syncGoalOverlayScale(),
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
    this.roomTransitionController = new OverworldRoomTransitionController({
      getMode: () => this.mode,
      getPlayer: () => this.player,
      getPlayerBody: () => this.playerBody,
      getCurrentRoomCoordinates: () => ({ ...this.currentRoomCoordinates }),
      setCurrentRoomCoordinates: (coordinates) => {
        this.currentRoomCoordinates = { ...coordinates };
      },
      setSelectedCoordinates: (coordinates) => {
        this.selectedCoordinates = { ...coordinates };
      },
      getWindowCenterCoordinates: () => ({ ...this.windowCenterCoordinates }),
      getRoomCoordinatesForPoint: (x, y) => this.getRoomCoordinatesForPoint(x, y),
      isNeighborReachable: (roomCoordinates, neighborCoordinates) =>
        this.runtimeController.isNeighborReachable(roomCoordinates, neighborCoordinates),
      resetChallengeStateForRoomExit: (nextRoomCoordinates) => {
        this.sessionResetController.resetChallengeStateForRoomExit(nextRoomCoordinates);
      },
      updateSelectedSummary: () => this.updateSelectedSummary(),
      getActiveCourseRun: () => this.activeCourseRun,
      syncGoalRunForRoom: (room, entryContext) => {
        this.syncGoalRunForRoomWithIntro(room, entryContext);
      },
      getRoomSnapshotForCoordinates: (coordinates) => this.getRoomSnapshotForCoordinates(coordinates),
      refreshLeaderboardForSelection: () => this.refreshLeaderboardForSelection(),
      refreshCourseComposerSelectedRoomState: () => this.refreshCourseComposerSelectedRoomState(),
      setFocusedCoordinates: (coordinates) => {
        setFocusedCoordinatesInUrl(coordinates);
      },
      refreshAround: (coordinates) => this.refreshAround(coordinates),
      refreshAroundIfNeededOrFromCache: (coordinates, options) =>
        this.refreshAroundIfNeededOrFromCache(coordinates, options),
      redrawWorld: () => this.redrawWorld(),
      renderHud: () => this.renderHud(),
      getRoomOrigin: (coordinates) => this.getRoomOrigin(coordinates),
      clearLadderState: () => {
        this.movementController.clearLadderState();
      },
      syncPlayerPickupSensor: () => this.playerPresentationController.syncPlayerPickupSensor(),
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
      resetPlaySession: () => this.sessionResetController.resetPlaySession(),
      clearTouchGestureState: () => this.clearTouchGestureState(),
      requestRoomGoalIntroForNextOverworldEntry: () => {
        this.roomGoalIntroFromOverworldPending = true;
      },
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
      refreshAroundIfNeededOrFromCache: (coordinates, options) =>
        this.refreshAroundIfNeededOrFromCache(coordinates, options),
      prepareActiveCourseRoomOverrides: (snapshot, options) =>
        this.coursePlaybackController.prepareActiveCourseRoomOverrides(snapshot, options),
      createCourseRunState: (snapshot, options) =>
        this.coursePlaybackController.createCourseRunState(snapshot, options),
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
        this.courseComposerController.setStatusText(text);
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
        this.viewportController.adjustZoomByFactor(factor, screenX, screenY),
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

  private getSelectedCourseContext() {
    return this.hudStateController.getSelectedCourseContext();
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
    this.initializeMobilePerformanceProfiler();
    this.syncAppMode();
    this.initializeMobilePortraitCameraTuning();
    this.viewportController.setZoomDebugEnabled(this.isDebugQueryEnabled('zoomDebug'));

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
    this.viewportController.initialize();
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
    this.initializeRoomChatClient();
    window.addEventListener(AUTH_STATE_CHANGED_EVENT, this.handleAuthStateChanged);
    window.addEventListener(PLAYER_AVATAR_CHANGED_EVENT, this.handlePlayerAvatarChanged);
    this.syncBackdropCameraIgnores();

    this.scale.on('resize', this.handleResize, this);
    this.events.on(Phaser.Scenes.Events.WAKE, this.handleWake, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);

    const deepLinkedInitialFocus =
      !data?.centerCoordinates && !data?.roomCoordinates && hasFocusedCoordinatesInUrl();
    this.shouldAutoPlayDeepLinkedRoomOnBoot =
      deepLinkedInitialFocus && (data?.mode ?? 'browse') === 'browse';
    const initialFocus =
      data?.centerCoordinates ?? data?.roomCoordinates ?? getFocusedCoordinatesFromUrl();
    this.windowController.applySceneData({
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
    if (deepLinkedInitialFocus && (data?.mode ?? 'browse') === 'browse') {
      const fitZoom = this.getFitZoomForRoom();
      this.inspectZoom = fitZoom;
      this.browseInspectZoom = fitZoom;
    }

    void this.windowController
      .refreshAround(this.windowCenterCoordinates, {
        forceChunkReload: data?.forceRefreshAround ?? false,
      })
      .then((refreshed) => {
        this.maybeAutoPlayDeepLinkedRoomOnBoot(refreshed);
      });
  }

  update(_time: number, delta: number): void {
    this.mobilePerformanceProfiler?.beginFrame(delta, this.buildMobilePerformanceContext());
    try {
      this.measureMobilePerformance('update.visibleChunks', () => {
        this.windowController.maybeRefreshVisibleChunks();
      });
      this.measureMobilePerformance('update.backdrop', () => {
        this.updateBackdrop();
      });
      this.measureMobilePerformance('update.grid', () => {
        this.gridOverlayController.redraw();
      });
      this.measureMobilePerformance('update.liveObjects', () => {
        this.updateLiveObjects(delta);
      });
      this.measureMobilePerformance('update.signs', () => {
        this.signController.update();
      });
      this.measureMobilePerformance('update.ghosts', () => {
        this.updateGhosts(delta);
      });
      this.measureMobilePerformance('update.roomChat', () => {
        this.roomChatController.update();
      });
      this.measureMobilePerformance('update.presenceDots', () => {
        this.presenceOverlayController.updateBrowseDots(delta);
      });
      this.measureMobilePerformance('update.music', () => {
        this.maybeSyncRoomMusicPlayback();
      });

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

      if (this.mode === 'play' && consumeTouchAction('restart')) {
        void this.restartCurrentRun();
        return;
      }

      if (!this.playerBody) {
        this.measureMobilePerformance('update.noPlayerRuntime', () => {
          this.movementController.handleNoPlayerRuntime();
        });
        this.measureMobilePerformance('update.presence', () => {
          this.syncLocalPresence();
        });
        this.measureMobilePerformance('update.lighting', () => {
          this.updateRoomLighting();
        });
        this.renderHud();
        return;
      }

      const swordPressed = Phaser.Input.Keyboard.JustDown(this.attackKeys.Q) || consumeTouchAction('slash');
      const gunPressed = Phaser.Input.Keyboard.JustDown(this.attackKeys.E) || consumeTouchAction('shoot');
      const inQuicksand = this.isPlayerInQuicksand();
      const movement = this.measureMobilePerformance('update.movement', () =>
        this.movementController.updateMovement(delta, inQuicksand)
      );
      this.measureMobilePerformance('update.combatInput', () => {
        this.combatController.handleCombatInput({
          swordPressed,
          gunPressed,
          downHeld: movement.downHeld,
          grounded: movement.grounded,
        });
      });

      this.measureMobilePerformance('update.quicksand', () => {
        this.updateQuicksandVisualSink();
      });
      this.measureMobilePerformance('update.projectiles', () => {
        this.combatController.updateProjectiles(delta);
      });
      this.measureMobilePerformance('update.ladderSfx', () => {
        this.movementController.syncLadderClimbSfx(movement.verticalInput);
      });
      this.measureMobilePerformance('update.respawnTransition', () => {
        this.maybeRespawnFromVoid();
        this.roomTransitionController.maybeAdvancePlayerRoom();
      });
      this.measureMobilePerformance('update.rankedTrace', () => {
        this.recordRankedRunTraceFrame(delta, movement);
      });
      this.measureMobilePerformance('update.presentation', () => {
        this.playerPresentationController.syncPlayerVisual();
      });
      this.measureMobilePerformance('update.presence', () => {
        this.syncLocalPresence();
      });
      this.measureMobilePerformance('update.lighting', () => {
        this.updateRoomLighting();
      });
      this.measureMobilePerformance('update.objective', () => {
        this.objectiveController.update(delta);
      });
      this.renderHud();
    } finally {
      this.mobilePerformanceProfiler?.endFrame(this.buildMobilePerformanceContext());
    }
  }

  private updateRoomLighting(): void {
    if (this.mode !== 'play' || !this.player || !this.playerBody) {
      const structureChanged = this.lightingController.sync({
        roomId: null,
        bounds: null,
        lighting: null,
        emitters: [],
        ambientBounds: [],
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
        ambientBounds: [],
      });
      if (structureChanged) {
        this.syncBackdropCameraIgnores();
      }
      return;
    }

    const roomOrigin = this.getRoomOrigin(currentRoom.coordinates);
    const currentLoadedRoom = this.loadedFullRoomsById.get(currentRoom.id) ?? null;
    const playerRevealRadiusPx = resolvePlayerAuraDarkAuraDiameter(currentRoom.lighting.radius) * 0.5;
    const ghostEmitters: RoomLightingEmitter[] = Array.from(
      this.presenceController.getRenderedGhostsByConnectionId().values(),
    )
      .filter((ghost) => ghost.presence.roomId === currentRoom.id)
      .map((ghost) => ({
        sourceType: 'ghost',
        x: ghost.sprite.x,
        y: ghost.sprite.y - this.PLAYER_HEIGHT * 0.65,
        revealRadiusPx: playerRevealRadiusPx,
      }));
    const emitters: RoomLightingEmitter[] = [
      {
        sourceType: 'player',
        x: this.playerBody.center.x,
        y: this.playerBody.bottom - this.PLAYER_HEIGHT * 0.65,
        revealRadiusPx: playerRevealRadiusPx,
      },
      ...ghostEmitters,
      ...(currentLoadedRoom?.staticLighting.emitters ?? []),
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
      ambientBounds: buildAmbientRoomLightingBounds({
        roomCoordinates: currentRoom.coordinates,
        roomWidth: ROOM_PX_WIDTH,
        roomHeight: ROOM_PX_HEIGHT,
        getCellStateAt: (coordinates) => this.getCellStateAt(coordinates),
        getRoomOrigin: (coordinates) => this.getRoomOrigin(coordinates),
      }),
      debugCounts: {
        playerGhostEmitterCount: 1 + ghostEmitters.length,
        staticObjectEmitterCount: currentLoadedRoom?.staticLighting.objectCount ?? 0,
        staticTileEmitterCount: currentLoadedRoom?.staticLighting.tileCount ?? 0,
      },
    });

    if (structureChanged) {
      this.syncBackdropCameraIgnores();
    }
  }

  private resetRuntimeState(): void {
    this.removeMobilePortraitCameraTunerApi();
    if (this.backdropCamera && this.cameras.cameras.includes(this.backdropCamera)) {
      this.cameras.remove(this.backdropCamera, true);
    }

    this.lastRoomMusicSyncSignature = '';
    globalRoomMusicController.stopArrangement({
      transition: 'immediate',
      fadeDurationSec: 0.08,
      mode: 'idle',
      resetTransport: true,
    });
    this.worldStreamingController.reset();
    this.lightingController.reset();
    this.starfieldSprites = [];
    this.backdropCamera = null;
    this.mode = 'browse';
    this.cameraMode = 'inspect';
    this.selectedCoordinates = { ...DEFAULT_ROOM_COORDINATES };
    this.currentRoomCoordinates = { ...DEFAULT_ROOM_COORDINATES };
    this.windowCenterCoordinates = { ...DEFAULT_ROOM_COORDINATES };
    this.hudStateController.reset();
    this.inspectZoom = DEFAULT_ZOOM;
    this.browseInspectZoom = DEFAULT_ZOOM;
    this.mobilePortraitCameraTuningEnabled = false;
    this.mobilePortraitCameraZoomMultiplier = MOBILE_PORTRAIT_PLAY_CAMERA_ZOOM_MULTIPLIER;
    this.mobilePortraitCameraTargetY = MOBILE_PORTRAIT_PLAY_CAMERA_TARGET_Y;
    this.transientStatusMessage = null;
    this.transientStatusExpiresAt = 0;
    this.quicksandTouchedUntil = 0;
    this.quicksandVisualSink = 0;
    this.quicksandStatusCooldownUntil = 0;
    this.inspectInputController.reset();
    this.movementController.reset();
    this.combatController.reset();
    this.collectedObjectKeys = new Set();
    this.score = 0;
    this.clearRankedRunTrace();
    this.goalRunController.reset();
    this.playerPresentationController.reset();
    this.browseOverlayController.destroy();
    this.shouldCenterCamera = false;
    this.shouldRespawnPlayer = false;
    this.presenceController.reset();
    this.roomChatController.reset();
    this.courseComposerController.reset();
    this.windowController.reset();
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

  private initializeRoomChatClient(): void {
    this.roomChatController.initialize();
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
    keyboard.on('keydown-T', () => {
      if (this.mode === 'play') {
        this.roomChatController.openComposer();
      }
    });
    keyboard.on('keydown-ESC', () => {
      if (this.roomChatController.handleEscapeKey()) {
        return;
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
    ignoredObjects.push(...this.viewportController.getBackdropIgnoredObjects());
    ignoredObjects.push(...this.goalMarkerController.getBackdropIgnoredObjects());
    ignoredObjects.push(...this.browseOverlayController.getBackdropIgnoredObjects());
    if (this.player) ignoredObjects.push(this.player);
    if (this.playerSprite) ignoredObjects.push(this.playerSprite);
    ignoredObjects.push(...this.combatController.getBackdropIgnoredObjects());
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
    this.viewportController.handleResize();

    if (this.mode === 'play' && this.cameraMode === 'follow') {
      this.inspectZoom = this.getFitZoomForRoom();
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
    void this.windowController.handleWakeAsync(data);
  };
  private readonly handleAuthStateChanged = (): void => {
    const identityChanged = this.presenceController.refreshIdentity();
    const roomChatIdentityChanged = this.roomChatController.refreshIdentity();
    if (this.loadedChunkBounds) {
      if (identityChanged) {
        this.presenceController.setSubscribedChunkBounds(this.loadedChunkBounds);
      }
      if (roomChatIdentityChanged) {
        this.roomChatController.setSubscribedChunkBounds(this.loadedChunkBounds);
      }
    }
    if (identityChanged || roomChatIdentityChanged) {
      this.syncLocalPresence();
    }
    this.renderHud();
  };

  private readonly handlePlayerAvatarChanged = (): void => {
    const identityChanged = this.presenceController.refreshIdentity();
    const roomChatIdentityChanged = this.roomChatController.refreshIdentity();
    if (this.loadedChunkBounds) {
      if (identityChanged) {
        this.presenceController.setSubscribedChunkBounds(this.loadedChunkBounds);
      }
      if (roomChatIdentityChanged) {
        this.roomChatController.setSubscribedChunkBounds(this.loadedChunkBounds);
      }
    }
    this.playerPresentationController.syncPlayerVisual();
    this.syncLocalPresence();
    this.renderHud();
  };

  private showTransientStatus(message: string): void {
    this.transientStatusMessage = message;
    this.transientStatusExpiresAt = this.time.now + 4200;
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

  private maybeAutoPlayDeepLinkedRoomOnBoot(refreshed: boolean): void {
    if (!this.shouldAutoPlayDeepLinkedRoomOnBoot) {
      return;
    }

    this.shouldAutoPlayDeepLinkedRoomOnBoot = false;
    if (!refreshed || this.mode !== 'browse') {
      return;
    }

    const selectedState = this.getCellStateAt(this.selectedCoordinates);
    if (selectedState !== 'published' && selectedState !== 'draft') {
      return;
    }

    this.flowController.playSelectedRoom();
  }

  zoomIn(): void {
    this.viewportController.zoomIn();
  }

  zoomOut(): void {
    this.viewportController.zoomOut();
  }

  private getZoomFocusCoordinates(): RoomCoordinates {
    if (this.mode === 'play') {
      return this.currentRoomCoordinates;
    }

    const worldView = this.cameras.main.worldView;
    return this.getRoomCoordinatesForPoint(worldView.centerX, worldView.centerY);
  }

  private async refreshAround(
    centerCoordinates: RoomCoordinates,
    options: { forceChunkReload?: boolean } = {}
  ): Promise<boolean> {
    return this.windowController.refreshAround(centerCoordinates, options);
  }

  private refreshAroundIfNeededOrFromCache(
    centerCoordinates: RoomCoordinates,
    options: { forceChunkReload?: boolean; refreshLeaderboards?: boolean } = {},
  ): void {
    this.windowController.refreshAroundIfNeededOrFromCache(centerCoordinates, options);
  }

  private refreshChunkWindowIfNeeded(centerCoordinates: RoomCoordinates): void {
    this.windowController.refreshChunkWindowIfNeeded(centerCoordinates);
  }

  private syncPresenceSubscriptions(): void {
    this.presenceController.setSubscribedChunkBounds(this.loadedChunkBounds);
    this.roomChatController.setSubscribedChunkBounds(this.loadedChunkBounds);
  }

  private syncLocalPresence(): void {
    const localPresence =
      this.mode === 'play' && this.player && this.playerBody
        ? {
            mode: this.mode,
            roomCoordinates: { ...this.currentRoomCoordinates },
            x: this.player.x,
            y: this.playerBody.bottom + DEFAULT_PLAYER_VISUAL_FEET_OFFSET,
            velocityX: this.playerBody.velocity.x,
            velocityY: this.playerBody.velocity.y,
            facing: this.playerFacing,
            animationState: this.playerAnimationState,
          }
        : this.mode === 'browse'
          ? {
              mode: this.mode,
              roomCoordinates: { ...this.selectedCoordinates },
              x: this.selectedCoordinates.x * ROOM_PX_WIDTH + ROOM_PX_WIDTH * 0.5,
              y: this.selectedCoordinates.y * ROOM_PX_HEIGHT + ROOM_PX_HEIGHT * 0.5,
              velocityX: 0,
              velocityY: 0,
              facing: 1,
              animationState: 'idle' as const,
            }
          : null;

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
    this.syncActiveCoursePressurePlateLinks([loadedRoom]);
  }

  private destroyLiveObjects(loadedRoom: SceneLoadedFullRoom): void {
    this.liveObjectController.destroyLiveObjects(loadedRoom);
  }

  private updateLiveObjects(delta: number): void {
    if (this.mode !== 'play') {
      return;
    }

    this.syncActiveCoursePressurePlateLinks(this.loadedFullRoomsById.values());
    this.liveObjectController.updateLiveObjects(this.loadedFullRoomsById.values(), delta);
  }

  private syncActiveCoursePressurePlateLinks(
    loadedRooms: Iterable<SceneLoadedFullRoom>,
  ): void {
    const activeCourse = this.activeCourseSnapshot;

    for (const loadedRoom of loadedRooms) {
      for (const liveObject of loadedRoom.liveObjects) {
        const sourceInstanceId = liveObject.placedInstanceId;
        if (liveObject.config.id !== 'floor_trigger' || !sourceInstanceId) {
          continue;
        }

        const placedTrigger =
          loadedRoom.room.placedObjects.find((placed) => placed.instanceId === sourceInstanceId) ??
          null;
        const localTargetInstanceId = placedTrigger?.triggerTargetInstanceId ?? null;
        const courseLink = activeCourse
          ? getCoursePressurePlateLink(activeCourse, loadedRoom.room.id, sourceInstanceId)
          : null;

        if (courseLink) {
          liveObject.linkedTargetRoomId = courseLink.targetRoomId;
          liveObject.linkedTargetInstanceId = courseLink.targetInstanceId;
          continue;
        }

        liveObject.linkedTargetRoomId = localTargetInstanceId ? loadedRoom.room.id : null;
        liveObject.linkedTargetInstanceId = localTargetInstanceId;
      }
    }
  }

  private syncPreviewVisibility(): void {
    this.worldStreamingController.syncPreviewVisibility();
  }

  private syncModeRuntime(): void {
    this.runtimeController.syncModeRuntime();
  }

  private maybeSyncRoomMusicPlayback(): void {
    if (this.mode !== 'play') {
      const signature = `mode:${this.mode}`;
      if (this.lastRoomMusicSyncSignature === signature) {
        return;
      }

      this.lastRoomMusicSyncSignature = signature;
      globalRoomMusicController.stopArrangement({
        transition: 'immediate',
        fadeDurationSec: 0.08,
        mode: 'idle',
        resetTransport: true,
      });
      return;
    }

    const currentRoom = this.getRoomSnapshotForCoordinates(this.currentRoomCoordinates);
    if (!currentRoom) {
      return;
    }

    const roomMusicKey = getRoomMusicKey(currentRoom.music) ?? 'none';
    const signature = `mode:play|room:${currentRoom.id}|music:${roomMusicKey}`;
    if (this.lastRoomMusicSyncSignature === signature) {
      return;
    }

    this.lastRoomMusicSyncSignature = signature;
    if (!currentRoom.music) {
      globalRoomMusicController.stopArrangement({
        transition: 'bar',
        fadeDurationSec: 0.18,
        mode: 'world-play',
      });
      return;
    }

    void globalRoomMusicController.playArrangement(currentRoom.music, {
      mode: 'world-play',
      transition: 'bar',
    });
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

  private syncGoalRunForRoomWithIntro(
    room: RoomSnapshot | null,
    entryContext: 'transition' | 'spawn' | 'respawn' = 'transition',
  ): void {
    if (!this.shouldShowRoomGoalIntro(room, entryContext)) {
      this.objectiveController.syncGoalRunForRoom(room, entryContext);
      return;
    }

    const goalRoom = room;
    const roomGoalIntroModal = getRoomGoalIntroModalController();
    if (!goalRoom?.goal || !roomGoalIntroModal) {
      this.objectiveController.syncGoalRunForRoom(room, entryContext);
      return;
    }

    this.goalRunController.clearCurrentRun();
    this.redrawGoalMarkers();
    this.roomGoalIntroPauseRequested = true;
    this.syncScenePauseState();
    roomGoalIntroModal.open({
      room: goalRoom,
      titleText: goalRoom.title?.trim() ? goalRoom.title : `Room ${goalRoom.coordinates.x},${goalRoom.coordinates.y}`,
      metaText: formatRoomGoalShortText(goalRoom.goal, {
        enemyCount: this.countRoomObjectsByCategory(goalRoom, 'enemy'),
      }),
      bodyText: resolveRoomGoalIntroText(goalRoom.goal, {
        customText: goalRoom.goalIntroText,
        enemyCount: this.countRoomObjectsByCategory(goalRoom, 'enemy'),
      }),
      onStart: () => {
        this.roomGoalIntroPauseRequested = false;
        this.syncScenePauseState();

        if (this.mode !== 'play') {
          return;
        }

        const liveRoom = this.getRoomSnapshotForCoordinates(goalRoom.coordinates) ?? goalRoom;
        this.respawnPlayerToCurrentRoom();
        this.objectiveController.restartGoalRunForRoom(liveRoom, 'spawn');
        void this.refreshLeaderboardForSelection();
        this.renderHud();
      },
    });
  }

  private shouldShowRoomGoalIntro(
    room: RoomSnapshot | null,
    entryContext: 'transition' | 'spawn' | 'respawn',
  ): boolean {
    if (!room || entryContext !== 'spawn' || this.activeCourseRun) {
      return false;
    }

    if (!this.roomGoalIntroFromOverworldPending) {
      return false;
    }
    this.roomGoalIntroFromOverworldPending = false;

    const roomGoalIntroModal = getRoomGoalIntroModalController();
    if (!roomGoalIntroModal || roomGoalIntroModal.isOpen()) {
      return false;
    }

    return roomGoalIntroModal.shouldShowForRoom(room);
  }

  private redrawGoalMarkers(): void {
    this.goalMarkerController.redrawMarkers(this.currentGoalRun, this.activeCourseRun);
    this.syncBackdropCameraIgnores();
  }

  private emitCourseComposerStateChanged(): void {
    window.dispatchEvent(new CustomEvent(COURSE_COMPOSER_STATE_CHANGED_EVENT));
  }

  private syncScenePauseState(): void {
    const shouldPause = this.playfunPauseRequested || this.roomGoalIntroPauseRequested;
    if (shouldPause === this.scenePauseApplied) {
      return;
    }

    this.scenePauseApplied = shouldPause;
    if (shouldPause) {
      this.scene.pause();
      return;
    }

    this.scene.resume();
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

  private getPlayerEntities(): OverworldPlayerEntities | null {
    if (
      !this.player ||
      !this.playerBody ||
      !this.playerPickupSensor ||
      !this.playerPickupSensorBody ||
      !this.playerSprite
    ) {
      return null;
    }

    return {
      player: this.player,
      playerBody: this.playerBody,
      playerPickupSensor: this.playerPickupSensor,
      playerPickupSensorBody: this.playerPickupSensorBody,
      playerSprite: this.playerSprite,
    };
  }

  private destroyPlayer(): void {
    this.combatController.destroyProjectiles();
    this.playerLifecycleController.destroyPlayer(
      this.getPlayerEntities(),
      this.loadedFullRoomsById.values(),
    );

    this.movementController.handlePlayerDestroyed();
    this.combatController.clearAttackAnimation();
    this.playerPresentationController.handlePlayerDestroyed();
    this.externalLaunchGraceUntil = 0;
    this.playerBody = null;
    this.playerPickupSensorBody = null;
    this.playerPickupSensor = null;
    this.playerSprite = null;
    this.player = null;
  }

  private syncLiveObjectInteractions(): void {
    this.runtimeController.syncLiveObjectInteractions();
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
    this.cameraController.updateCameraBounds();
  }

  private toggleCameraMode(): void {
    this.cameraController.toggleCameraMode();
  }

  private applyCameraMode(forceCenter: boolean = false): void {
    this.cameraController.applyCameraMode(forceCenter);
  }

  private centerCameraOnCoordinates(coordinates: RoomCoordinates): void {
    this.cameraController.centerCameraOnCoordinates(coordinates);
  }

  private startFollowCamera(camera: Phaser.Cameras.Scene2D.Camera): void {
    this.cameraController.startFollowCamera(camera);
  }

  private constrainInspectCamera(): void {
    this.cameraController.constrainInspectCamera();
  }

  private getFitZoomForRoom(): number {
    const fitZoom = this.cameraController.getFitZoomForRoom();
    if (!this.shouldApplyMobilePortraitCameraTuning()) {
      return fitZoom;
    }

    return Number(
      Phaser.Math.Clamp(
        fitZoom * this.mobilePortraitCameraZoomMultiplier,
        MIN_ZOOM,
        MAX_ZOOM,
      ).toFixed(3),
    );
  }

  getMobilePortraitCameraTuning(): MobilePortraitCameraTuningSnapshot {
    return this.buildMobilePortraitCameraTuningSnapshot();
  }

  setMobilePortraitCameraTuning(
    input: MobilePortraitCameraTuningInput,
    reason: string = 'set',
  ): MobilePortraitCameraTuningSnapshot {
    this.mobilePortraitCameraTuningEnabled = true;

    if (typeof input.zoomMultiplier === 'number') {
      this.mobilePortraitCameraZoomMultiplier =
        this.normalizeMobilePortraitCameraZoomMultiplier(input.zoomMultiplier);
    }
    if (typeof input.targetY === 'number') {
      this.mobilePortraitCameraTargetY =
        this.normalizeMobilePortraitCameraTargetY(input.targetY);
    }

    this.persistMobilePortraitCameraTuning();
    this.applyMobilePortraitCameraTuning();
    return this.logMobilePortraitCameraTuning(reason);
  }

  adjustMobilePortraitCameraTuning(
    adjustment: MobilePortraitCameraTuningAdjustment,
    reason: string = 'adjust',
  ): MobilePortraitCameraTuningSnapshot {
    return this.setMobilePortraitCameraTuning(
      {
        zoomMultiplier:
          this.mobilePortraitCameraZoomMultiplier + (adjustment.zoomMultiplierDelta ?? 0),
        targetY: this.mobilePortraitCameraTargetY + (adjustment.targetYDelta ?? 0),
      },
      reason,
    );
  }

  resetMobilePortraitCameraTuning(): MobilePortraitCameraTuningSnapshot {
    this.mobilePortraitCameraTuningEnabled = true;
    this.mobilePortraitCameraZoomMultiplier = MOBILE_PORTRAIT_PLAY_CAMERA_ZOOM_MULTIPLIER;
    this.mobilePortraitCameraTargetY = MOBILE_PORTRAIT_PLAY_CAMERA_TARGET_Y;
    this.clearStoredMobilePortraitCameraTuning();
    this.applyMobilePortraitCameraTuning();
    return this.logMobilePortraitCameraTuning('reset');
  }

  logMobilePortraitCameraTuning(reason: string = 'log'): MobilePortraitCameraTuningSnapshot {
    const snapshot = this.buildMobilePortraitCameraTuningSnapshot();
    console.log(`MOBILE_PORTRAIT_CAMERA_TUNING ${JSON.stringify({ reason, ...snapshot })}`);
    return snapshot;
  }

  private initializeMobilePortraitCameraTuning(): void {
    this.removeMobilePortraitCameraTunerApi();

    const params = new URLSearchParams(window.location.search);
    const tunerFlag =
      params.get('cameraTuner')
      ?? params.get('mobileCameraTuner')
      ?? params.get('cameraDebug');
    const hasInlineSettings =
      params.has('mobileCameraZoom') || params.has('mobileCameraTargetY');
    this.mobilePortraitCameraTuningEnabled =
      this.isTruthySearchValue(tunerFlag) || hasInlineSettings;

    if (!this.mobilePortraitCameraTuningEnabled) {
      return;
    }

    const stored = this.readStoredMobilePortraitCameraTuning();
    const zoomMultiplier =
      this.readNumberSearchParam(params, 'mobileCameraZoom') ?? stored?.zoomMultiplier;
    const targetY =
      this.readNumberSearchParam(params, 'mobileCameraTargetY') ?? stored?.targetY;

    if (typeof zoomMultiplier === 'number') {
      this.mobilePortraitCameraZoomMultiplier =
        this.normalizeMobilePortraitCameraZoomMultiplier(zoomMultiplier);
    }
    if (typeof targetY === 'number') {
      this.mobilePortraitCameraTargetY =
        this.normalizeMobilePortraitCameraTargetY(targetY);
    }

    this.installMobilePortraitCameraTunerApi();
    console.log(
      'MOBILE_PORTRAIT_CAMERA_TUNER_READY '
      + 'Use window.wampMobileCameraTuner.set({ zoomMultiplier, targetY }) '
      + 'or tap the on-screen camera tuner controls.',
    );
  }

  private installMobilePortraitCameraTunerApi(): void {
    const api: NonNullable<Window['wampMobileCameraTuner']> = {
      get: () => this.getMobilePortraitCameraTuning(),
      log: (reason) => this.logMobilePortraitCameraTuning(reason ?? 'console-log'),
      set: (input, reason) =>
        this.setMobilePortraitCameraTuning(input, reason ?? 'console-set'),
      adjust: (adjustment, reason) =>
        this.adjustMobilePortraitCameraTuning(adjustment, reason ?? 'console-adjust'),
      reset: () => this.resetMobilePortraitCameraTuning(),
    };

    this.mobilePortraitCameraTunerApi = api;
    window.wampMobileCameraTuner = api;
  }

  private removeMobilePortraitCameraTunerApi(): void {
    if (window.wampMobileCameraTuner === this.mobilePortraitCameraTunerApi) {
      delete window.wampMobileCameraTuner;
    }
    this.mobilePortraitCameraTunerApi = null;
  }

  private shouldApplyMobilePortraitCameraTuning(): boolean {
    const layout = getDeviceLayoutState();
    return (
      this.mode === 'play'
      && layout.deviceClass === 'phone'
      && layout.coarsePointer
      && layout.orientationState === 'portrait'
    );
  }

  private applyMobilePortraitCameraTuning(): void {
    if (this.mode !== 'play') {
      return;
    }

    this.inspectZoom = this.getFitZoomForRoom();
    this.cameras.main.setZoom(this.inspectZoom);
    this.applyCameraMode();
    this.snapMobilePortraitCameraToTuning();
  }

  private snapMobilePortraitCameraToTuning(): void {
    if (!this.player || !this.shouldApplyMobilePortraitCameraTuning()) {
      return;
    }

    const camera = this.cameras.main;
    const scroll = getScrollForScreenAnchor(
      this.player.x,
      this.player.y,
      camera.x + camera.width * 0.5,
      camera.y + camera.height * this.mobilePortraitCameraTargetY,
      camera,
    );
    camera.setScroll(scroll.x, scroll.y);
    camera.preRender();
  }

  private buildMobilePortraitCameraTuningSnapshot(): MobilePortraitCameraTuningSnapshot {
    const camera = this.cameras.main;
    const baseFitZoom = this.cameraController.getFitZoomForRoom();
    const playerScreen = this.player
      ? {
          x: Math.round((this.player.x - camera.worldView.x) * camera.zoom + camera.x),
          y: Math.round((this.player.y - camera.worldView.y) * camera.zoom + camera.y),
        }
      : null;
    const controls = document.getElementById('mobile-play-controls');
    const controlsTop =
      controls instanceof HTMLElement
        ? Math.round(controls.getBoundingClientRect().top)
        : null;

    return {
      enabled: this.mobilePortraitCameraTuningEnabled,
      zoomMultiplier: this.mobilePortraitCameraZoomMultiplier,
      targetY: this.mobilePortraitCameraTargetY,
      fitZoom: Number(baseFitZoom.toFixed(3)),
      cameraZoom: Number(camera.zoom.toFixed(3)),
      playerScreen,
      controlsTop,
      viewport: {
        width: Math.round(window.innerWidth),
        height: Math.round(window.innerHeight),
      },
    };
  }

  private normalizeMobilePortraitCameraZoomMultiplier(value: number): number {
    if (!Number.isFinite(value)) {
      return this.mobilePortraitCameraZoomMultiplier;
    }

    return Number(
      Phaser.Math.Clamp(
        value,
        MOBILE_PORTRAIT_PLAY_CAMERA_MIN_ZOOM_MULTIPLIER,
        MOBILE_PORTRAIT_PLAY_CAMERA_MAX_ZOOM_MULTIPLIER,
      ).toFixed(3),
    );
  }

  private normalizeMobilePortraitCameraTargetY(value: number): number {
    if (!Number.isFinite(value)) {
      return this.mobilePortraitCameraTargetY;
    }

    return Number(
      Phaser.Math.Clamp(
        value,
        MOBILE_PORTRAIT_PLAY_CAMERA_MIN_TARGET_Y,
        MOBILE_PORTRAIT_PLAY_CAMERA_MAX_TARGET_Y,
      ).toFixed(3),
    );
  }

  private isTruthySearchValue(value: string | null): boolean {
    if (value === null) {
      return false;
    }

    const normalized = value.trim().toLowerCase();
    return normalized === '' || ['1', 'true', 'yes', 'on'].includes(normalized);
  }

  private readNumberSearchParam(params: URLSearchParams, name: string): number | null {
    const raw = params.get(name);
    if (raw === null || raw.trim() === '') {
      return null;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private readStoredMobilePortraitCameraTuning():
    | Pick<MobilePortraitCameraTuningSnapshot, 'zoomMultiplier' | 'targetY'>
    | null {
    try {
      const raw = window.localStorage.getItem(MOBILE_PORTRAIT_CAMERA_TUNING_STORAGE_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as Partial<MobilePortraitCameraTuningInput>;
      const zoomMultiplier =
        typeof parsed.zoomMultiplier === 'number'
          ? this.normalizeMobilePortraitCameraZoomMultiplier(parsed.zoomMultiplier)
          : this.mobilePortraitCameraZoomMultiplier;
      const targetY =
        typeof parsed.targetY === 'number'
          ? this.normalizeMobilePortraitCameraTargetY(parsed.targetY)
          : this.mobilePortraitCameraTargetY;
      return { zoomMultiplier, targetY };
    } catch {
      return null;
    }
  }

  private persistMobilePortraitCameraTuning(): void {
    try {
      window.localStorage.setItem(
        MOBILE_PORTRAIT_CAMERA_TUNING_STORAGE_KEY,
        JSON.stringify({
          zoomMultiplier: this.mobilePortraitCameraZoomMultiplier,
          targetY: this.mobilePortraitCameraTargetY,
        }),
      );
    } catch {
      // Safari private browsing and embedded contexts can reject localStorage.
    }
  }

  private clearStoredMobilePortraitCameraTuning(): void {
    try {
      window.localStorage.removeItem(MOBILE_PORTRAIT_CAMERA_TUNING_STORAGE_KEY);
    } catch {
      // Safari private browsing and embedded contexts can reject localStorage.
    }
  }

  private createPlayer(startRoom: RoomSnapshot): void {
    const entities = this.playerLifecycleController.createPlayer(startRoom);
    this.player = entities.player;
    this.playerBody = entities.playerBody;
    this.playerPickupSensor = entities.playerPickupSensor;
    this.playerPickupSensorBody = entities.playerPickupSensorBody;
    this.playerSprite = entities.playerSprite;
    this.externalLaunchGraceUntil = 0;
    this.movementController.handlePlayerCreated();
    this.combatController.clearAttackAnimation();
    this.playerPresentationController.handlePlayerCreated();
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

    this.sessionResetController.handlePlayerDeath('You fell.');
  }

  private respawnPlayerToCurrentRoom(): void {
    const activeCourseRun = this.activeCourseRun;
    const courseStartRoom =
      activeCourseRun
        ? this.coursePlaybackController.getCourseStartRoomRef(activeCourseRun.course)
        : null;

    if (courseStartRoom) {
      this.respawnPlayerToCourseStartRoom(courseStartRoom);
      return;
    }

    const currentRoom = this.getRoomSnapshotForCoordinates(this.currentRoomCoordinates);
    const entities = this.getPlayerEntities();
    if (!currentRoom || !entities) return;

    this.combatController.clearAttackAnimation();
    this.externalLaunchGraceUntil = 0;
    this.movementController.handleRespawnReset();
    this.combatController.destroyProjectiles();
    this.playerLifecycleController.respawnPlayerToRoom(currentRoom, entities);
    this.playerPresentationController.handleRespawned();
    playSfx('respawn');
  }

  private respawnPlayerToCourseStartRoom(courseStartRoom: CourseRoomRef): void {
    const coordinates = courseStartRoom.coordinates;
    const startRoom = this.getRoomSnapshotForCoordinates(coordinates);
    const entities = this.getPlayerEntities();

    this.combatController.clearAttackAnimation();
    this.externalLaunchGraceUntil = 0;
    this.movementController.handleRespawnReset();
    this.combatController.destroyProjectiles();
    this.currentRoomCoordinates = { ...coordinates };
    this.selectedCoordinates = { ...coordinates };
    this.updateSelectedSummary();
    this.shouldCenterCamera = true;
    setFocusedCoordinatesInUrl(coordinates);

    if (startRoom && entities) {
      this.playerLifecycleController.respawnPlayerToRoom(startRoom, entities);
      this.playerPresentationController.handleRespawned();
      this.refreshAroundIfNeededOrFromCache(coordinates, {
        refreshLeaderboards: false,
      });
      playSfx('respawn');
      return;
    }

    this.destroyPlayer();
    this.shouldRespawnPlayer = true;
    void this.refreshAround(coordinates, { forceChunkReload: true });
    playSfx('respawn');
  }

  private startRankedRunTrace(kind: 'room' | 'course', binding: RankedRunTraceBinding): void {
    const initialFrame = this.getCurrentRankedRunTraceFrame();
    this.rankedRunTraceRecorder.start(kind, binding, initialFrame);
  }

  private buildRankedRunVerificationTrace(
    kind: 'room' | 'course',
    elapsedMs: number,
    result: 'completed' | 'failed' | 'abandoned',
  ): RankedRunVerificationTrace | null {
    if (!this.rankedRunTraceRecorder.isActive(kind)) {
      console.warn('Ranked verification trace inactive at finish build', {
        kind,
        result,
        elapsedMs: Math.round(elapsedMs),
        mode: this.mode,
        currentRoomCoordinates: { ...this.currentRoomCoordinates },
        hasPlayerBody: Boolean(this.playerBody),
        roomTraceActive: this.rankedRunTraceRecorder.isActive('room'),
        courseTraceActive: this.rankedRunTraceRecorder.isActive('course'),
      });
      return null;
    }

    return this.rankedRunTraceRecorder.buildTrace(elapsedMs);
  }

  private clearRankedRunTrace(): void {
    this.rankedRunTraceRecorder.clear();
  }

  private recordRankedRunTraceFrame(
    delta: number,
    movement: {
      grounded: boolean;
      horizontalInput: number;
      verticalInput: number;
      jumpPressed: boolean;
    },
  ): void {
    const frame = this.getCurrentRankedRunTraceFrame(movement);
    if (!frame) {
      return;
    }

    this.rankedRunTraceRecorder.recordFrame(delta, frame);
  }

  private getCurrentRankedRunTraceFrame(
    movement?: {
      grounded: boolean;
      horizontalInput: number;
      verticalInput: number;
      jumpPressed: boolean;
    },
  ): RankedRunTraceFrameInput | null {
    if (!this.playerBody) {
      return null;
    }

    const roomCoordinates = { ...this.currentRoomCoordinates };
    const roomOrigin = this.getRoomOrigin(roomCoordinates);
    return {
      roomCoordinates,
      x: this.playerBody.center.x - roomOrigin.x,
      y: this.playerBody.bottom - roomOrigin.y,
      vx: this.playerBody.velocity.x,
      vy: this.playerBody.velocity.y,
      grounded:
        movement?.grounded ??
        Boolean(this.playerBody.blocked.down || this.playerBody.touching.down),
      horizontalInput: movement?.horizontalInput ?? 0,
      verticalInput: movement?.verticalInput ?? 0,
      jumpPressed: movement?.jumpPressed ?? false,
    };
  }

  private recordRankedGoalEvent(event: {
    type: 'collectible' | 'enemy' | 'checkpoint' | 'reach_exit' | 'finish' | 'complete';
    roomId: string | null;
    roomCoordinates: RoomCoordinates;
    x: number;
    y: number;
    instanceId?: string | null;
    checkpointIndex?: number | null;
  }): void {
    if (!this.rankedRunTraceRecorder.isActive()) {
      return;
    }

    this.rankedRunTraceRecorder.recordGoalEvent({
      type: event.type,
      roomId: event.roomId,
      roomX: event.roomCoordinates.x,
      roomY: event.roomCoordinates.y,
      x: event.x,
      y: event.y,
      instanceId: event.instanceId ?? null,
      checkpointIndex: event.checkpointIndex ?? null,
    });
  }

  private handleEnemyDefeated(event: {
    roomId: string;
    roomCoordinates: RoomCoordinates;
    enemyName: string;
    instanceId: string | null;
    x: number;
    y: number;
  }): boolean {
    this.recordRankedGoalEvent({
      type: 'enemy',
      roomId: event.roomId,
      roomCoordinates: event.roomCoordinates,
      x: event.x,
      y: event.y,
      instanceId: event.instanceId,
      checkpointIndex: null,
    });
    return this.objectiveController.handleEnemyDefeated(event.roomId, event.enemyName);
  }

  private handleCollectibleCollected(event: {
    roomId: string;
    roomCoordinates: RoomCoordinates;
    instanceId: string | null;
    x: number;
    y: number;
  }): void {
    this.recordRankedGoalEvent({
      type: 'collectible',
      roomId: event.roomId,
      roomCoordinates: event.roomCoordinates,
      x: event.x,
      y: event.y,
      instanceId: event.instanceId,
      checkpointIndex: null,
    });
    this.objectiveController.handleCollectibleCollected(event.roomId);
  }

  private resetTransientPlayState(): void {
    this.collectedObjectKeys.clear();
    this.heldKeyCount = 0;
    this.score = 0;
    this.clearRankedRunTrace();
    this.movementController.resetTransientPlayState();
    this.combatController.clearAttackAnimation();
    this.externalLaunchGraceUntil = 0;
    this.combatController.destroyProjectiles();
    this.playerPresentationController.resetTransientPlayState();
  }

  private clearTouchGestureState(): void {
    this.inspectInputController.reset();
  }

  private resetRoomChallengeState(room: RoomSnapshot): void {
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

  private syncBrowseWindowToCamera(
    panStartPointer: { x: number; y: number },
    panCurrentPointer: { x: number; y: number },
  ): void {
    this.selectionController.syncBrowseWindowToCamera(panStartPointer, panCurrentPointer);
  }

  private syncCameraBoundsUsage(): void {
    this.cameraController.syncBoundsUsage();
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
    this.hudStateController.refreshSelectedSummary();
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

  async restartCurrentRun(): Promise<void> {
    await this.flowController.restartCurrentRun();
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
    this.courseComposerController.close();
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

  getCourseComposerState(): CourseComposerState | null {
    return this.courseComposerController.getState();
  }

  setCourseTitle(title: string | null): void {
    this.courseComposerController.setCourseTitle(title);
  }

  addSelectedRoomToCourseDraft(): void {
    this.courseComposerController.addSelectedRoomToCourseDraft();
  }

  removeSelectedRoomFromCourseDraft(): void {
    this.courseComposerController.removeSelectedRoomFromCourseDraft();
  }

  selectCourseRoomInComposer(roomId: string): void {
    this.courseComposerController.selectCourseRoomInComposer(roomId);
  }

  editSelectedCourseRoom(): boolean {
    return this.courseComposerController.editSelectedCourseRoom();
  }

  async testDraftCourse(): Promise<void> {
    await this.courseComposerController.testDraftCourse();
  }

  async saveCourseDraft(): Promise<void> {
    await this.courseComposerController.saveCourseDraft();
  }

  async publishCourseDraft(): Promise<void> {
    await this.courseComposerController.publishCourseDraft();
  }

  async unpublishCourse(): Promise<void> {
    await this.courseComposerController.unpublishCourse();
  }

  private async refreshCourseComposerSelectedRoomState(): Promise<void> {
    await this.courseComposerController.refreshSelectedRoomState();
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

  private syncGoalOverlayScale(): void {
    const zoom = this.cameras.main.zoom;
    this.browseOverlayController.syncScale(zoom);
    this.presenceOverlayController.syncOverlayScale();
  }

  private initializeMobilePerformanceProfiler(): void {
    this.mobilePerformanceProfiler?.destroy();
    this.mobilePerformanceProfiler = createMobilePerformanceProfiler({
      getContext: () => this.buildMobilePerformanceContext(),
    });
  }

  private measureMobilePerformance<T>(label: string, callback: () => T): T {
    return this.mobilePerformanceProfiler
      ? this.mobilePerformanceProfiler.measure(label, callback)
      : callback();
  }

  private buildMobilePerformanceContext(): MobilePerformanceContext {
    const layout = getDeviceLayoutState();
    const streamingMetrics = this.worldStreamingController.getDebugMetrics();
    const presenceDebug = this.presenceController.getDebugSnapshot();
    const activeLiveObjects = Array.from(this.loadedFullRoomsById.values()).reduce(
      (total, loadedRoom) =>
        total + loadedRoom.liveObjects.filter((liveObject) => liveObject.sprite.active).length,
      0,
    );
    const activeProjectiles = this.combatController.getProjectileCount();

    return {
      mode: this.mode,
      cameraMode: this.cameraMode,
      deviceClass: layout.deviceClass,
      orientationState: layout.orientationState,
      coarsePointer: layout.coarsePointer,
      performanceProfile: layout.performanceProfile,
      viewport: layout.viewport,
      mobilePortraitPlay: document.body.dataset.mobilePortraitPlay === 'true',
      selected: { ...this.selectedCoordinates },
      currentRoom: { ...this.currentRoomCoordinates },
      loadedFullRooms: this.loadedFullRoomsById.size,
      loadedPreviewRooms: streamingMetrics.loadedPreviewRoomCount,
      visibleRooms: streamingMetrics.visibleRoomCount,
      previewRoomBudget: streamingMetrics.previewRoomBudget,
      fullRoomBudget: streamingMetrics.fullRoomBudget,
      activeLiveObjects,
      activeProjectiles,
      renderedGhosts: presenceDebug.renderedGhostCount,
      visibleGhosts: presenceDebug.visibleGhostCount,
      browseDots: this.presenceOverlayController.getBrowseDotCount(),
    };
  }

  private renderHud(statusOverride?: string): void {
    this.measureMobilePerformance('hud.render', () => {
      this.hudStateController.renderHud(statusOverride);
    });
  }

  private getRoomDisplayTitle(title: string | null, coordinates: RoomCoordinates): string {
    return title?.trim() ? title : `Room ${coordinates.x},${coordinates.y}`;
  }

  private truncateOverlayText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, Math.max(1, maxLength - 1))}\u2026`;
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

  getSelectedRoomContext(): SelectedRoomContext {
    return this.hudStateController.getSelectedRoomContext();
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
      fadeDurationSec: 0.08,
      mode: 'idle',
      resetTransport: true,
    });
    this.presenceController.destroy();
    this.roomChatController.destroy();
    this.roomAudioController.destroy();
    this.lightingController.destroy();
    window.removeEventListener(AUTH_STATE_CHANGED_EVENT, this.handleAuthStateChanged);
    window.removeEventListener(PLAYER_AVATAR_CHANGED_EVENT, this.handlePlayerAvatarChanged);
    window.removeEventListener(PLAYFUN_GAME_PAUSE_EVENT, this.handlePlayfunGamePause);
    window.removeEventListener(PLAYFUN_GAME_RESUME_EVENT, this.handlePlayfunGameResume);
    this.playfunPauseDepth = 0;
    this.playfunPauseRequested = false;
    this.roomGoalIntroFromOverworldPending = false;
    this.roomGoalIntroPauseRequested = false;
    this.scenePauseApplied = false;
    getRoomGoalIntroModalController()?.forceClose();
    this.scale.off('resize', this.handleResize, this);
    this.events.off(Phaser.Scenes.Events.WAKE, this.handleWake, this);
    this.inspectInputController.destroy();
    this.input.removeAllListeners();
    this.input.keyboard?.removeAllListeners();
    this.viewportController.destroy();
    this.hudBridge?.destroy();
    this.hudBridge = null;
    this.fxController?.destroy();
    this.fxController = null;
    this.mobilePerformanceProfiler?.destroy();
    this.mobilePerformanceProfiler = null;
    this.removeMobilePortraitCameraTunerApi();

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
    const roomChatDebug = this.roomChatController.getDebugSnapshot();
    const roomAudioDebug = this.roomAudioController.getDebugSnapshot();
    const lightingDebug = this.lightingController.getDebugState();
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
            sampleTilePositionX: currentRoomParallaxLayer && 'tilePositionX' in currentRoomParallaxLayer.sprite
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
        activeAttackAnimation: this.combatController.getActiveAttackAnimation(),
        crateInteractionMode: this.activeCrateInteractionMode,
        crateInteractionFacing: this.activeCrateInteractionFacing,
        meleeCooldownMs: this.combatController.getMeleeCooldownRemainingMs(this.time.now),
        rangedCooldownMs: this.combatController.getRangedCooldownRemainingMs(this.time.now),
        projectileCount: this.combatController.getProjectileCount(),
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
      roomChat: {
        status: roomChatDebug.snapshot?.status ?? 'disabled',
        subscribedShardCount: roomChatDebug.snapshot?.subscribedShards.length ?? 0,
        connectedShardCount: roomChatDebug.snapshot?.connectedShards.length ?? 0,
        subscribedChunkBounds: roomChatDebug.subscribedChunkBounds,
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
      lighting: lightingDebug,
      mobilePerformance: this.mobilePerformanceProfiler?.getSnapshot('describe-state') ?? null,
      zoom: Number(camera.zoom.toFixed(3)),
      mobilePortraitCamera: this.buildMobilePortraitCameraTuningSnapshot(),
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
            avatarId: resolveActivePlayerAvatarId(),
            x: Math.round(this.player.x),
            y: Math.round(this.player.y),
            velocityX: Math.round(this.playerBody.velocity.x),
            velocityY: Math.round(this.playerBody.velocity.y),
            crouching: this.isCrouching,
            climbing: this.isClimbingLadder,
            jumpBuffered: this.jumpBuffered,
            jumpBufferMs: Math.max(0, Math.round(this.jumpBufferTime)),
            coyoteMs: Math.max(0, Math.round(this.coyoteTime)),
            wallSliding: this.isWallSliding,
            wallContactSide: this.wallContactSide,
            wallContactGraceSide: this.wallContactGraceSide,
            wallContactGraceMs: Math.max(0, Math.round(this.wallContactGraceUntil - this.time.now)),
            wallJumpActive: this.wallJumpActive,
            wallJumpChainActive: this.wallJumpChainActive,
            wallJumpLockMs: Math.max(0, this.wallJumpLockUntil - this.time.now),
            ladderKey: this.activeLadderKey,
            animation: this.playerAnimationState,
            facing: this.playerFacing,
          }
        : null,
      presenceDebug: this.presenceController.getDebugSnapshot(),
      roomChatDebug,
      activeSign: this.signController.getActiveSign(),
      liveObjects,
    };
  }
}
