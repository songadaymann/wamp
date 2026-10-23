import { playSfx } from '../../../audio/sfx';
import { RoomLightingController } from '../../../lighting/controller';
import { globalRoomMusicController } from '../../../music/controller';
import { setFocusedCoordinatesInUrl } from '../../../navigation/worldNavigation';
import { getDevicePerformanceMode } from '../../../performance/devicePerformanceMode';
import { performanceAdvisorRuntime } from '../../../performance/performanceAdvisorRuntime';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import { parseRoomId, roomIdFromCoordinates } from '../../../persistence/roomModel';
import { createWorldRepository } from '../../../persistence/worldRepository';
import { DEFAULT_PLAYER_VISUAL_FEET_OFFSET } from '../../../player/defaultPlayer';
import { getDeviceLayoutState, prefersReducedMotion } from '../../../ui/deviceLayout';
import { getTouchInputState } from '../../../ui/mobile/touchControls';
import { RoomWeatherController } from '../../../weather/controller';
import { getActiveWorldId } from '../../../worlds/clientContext';
import type { OverworldMode } from '../../sceneData';
import { OverworldBackdropController } from '../backdropController';
import type { CameraMode } from '../camera';
import { OverworldSceneFlowController } from '../flow';
import type { OverworldHudStateController } from '../hudState';
import { prepareRoomOwnershipEdit } from '../roomOwnershipEdit';
import { getAuthDebugState } from '../../../auth/client';
import { gameplayNow } from '../gameplayClock';
import type { LoadedRoomObject } from '../liveObjects';
import { OverworldLiveObjectController } from '../liveObjects';
import { createPortalTargetRoomPreparationAdapter, OverworldPortalObjectController } from '../portalObjects';
import { OverworldRoomAudioController } from '../roomAudio';
import { OverworldRoomMusicPlaybackController } from '../roomMusicPlaybackController';
import { OverworldRoomTransitionController } from '../roomTransition';
import { OverworldRuntimeContext } from '../runtimeContext';
import type { OverworldRoomEdgeWall } from '../runtimeController';
import { OverworldRuntimeController } from '../runtimeController';
import { OverworldSelectionController } from '../selection';
import { OverworldSignController } from '../signPosts';
import { createSpecialTileCallbacks } from '../specialTileCallbacks';
import { OverworldSpecialTilesController } from '../specialTiles';
import { OverworldWindowController } from '../windowController';
import { OverworldWorldStreamingController } from '../worldStreaming';
import type { OverworldCompositionPorts } from './ports';
import { BROWSE_VISIBLE_CHUNK_REFRESH_INTERVAL_MS, EDGE_WALL_THICKNESS, PLAY_VISIBLE_CHUNK_REFRESH_INTERVAL_MS, RESPAWN_FALL_DISTANCE } from './settings';
type RoomEdgeWall = OverworldRoomEdgeWall;

export function createBackdropController(host: Pick<OverworldCompositionPorts, 'scene' | 'worldStreamingController'>): OverworldBackdropController {
  return new OverworldBackdropController({
    scene: host.scene,
    updateWorldBackgrounds: (camera) => host.worldStreamingController.updateFullRoomBackgrounds(camera),
  });
}

export function createRuntimeContext(
  host: Pick<OverworldCompositionPorts,
    | 'player' | 'playerBody' | 'playerSprite'
    | 'playerPickupSensor' | 'playerPickupSensorBody' | 'mode'
    | 'cameraMode' | 'selectedCoordinates' | 'currentRoomCoordinates'
    | 'pvpArenaController' | 'roomRushModeController' | 'backdropController'
  >,
): OverworldRuntimeContext<OverworldMode, CameraMode> {
  return new OverworldRuntimeContext({
    getPlayer: () => host.player,
    getPlayerBody: () => host.playerBody,
    getPlayerSprite: () => host.playerSprite,
    getPlayerPickupSensor: () => host.playerPickupSensor,
    getPlayerPickupSensorBody: () => host.playerPickupSensorBody,
    getMode: () => host.mode,
    setMode: (mode) => { host.mode = mode; },
    getCameraMode: () => host.cameraMode,
    setCameraMode: (mode) => { host.cameraMode = mode; },
    getSelectedCoordinates: () => host.selectedCoordinates,
    getCurrentRoomCoordinates: () => host.currentRoomCoordinates,
    isPvpArenaActive: () => host.pvpArenaController?.isArenaActive() ?? false,
    isPvpMatchActive: () => host.pvpArenaController?.isMatchActive() ?? false,
    isRoomRushActive: () => Boolean(host.roomRushModeController?.getCurrentRun()),
    isBackdropCameraActive: () => host.backdropController.isCameraActive(),
    getBackdropLayerCount: () => host.backdropController.getLayerCount(),
    isLightingActive: () => host.mode === 'play',
  });
}

export function createRoomAudioController(host: Pick<OverworldCompositionPorts, 'runtimeContext' | 'scene'>): OverworldRoomAudioController {
  return new OverworldRoomAudioController({
    runtime: host.runtimeContext,
    scene: host.scene,
  });
}

export function createLightingController(host: Pick<OverworldCompositionPorts, 'scene'>): RoomLightingController {
  return new RoomLightingController({
    scene: host.scene,
    overlayDepth: 35,
  });
}

export function createWeatherController(host: Pick<OverworldCompositionPorts, 'scene'>): RoomWeatherController {
  return new RoomWeatherController({
    scene: host.scene,
    depth: 34,
  });
}

export function createLiveObjectController(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'BOUNCE_PAD_VELOCITY' | 'BOUNCE_PAD_COOLDOWN_MS'
    | 'BOUNCE_PAD_ACTIVE_MS' | 'BAT_SPEED' | 'BAT_WAVE_AMPLITUDE'
    | 'BAT_WAVE_SPEED' | 'BIRD_SPEED' | 'BIRD_WAVE_AMPLITUDE'
    | 'BIRD_WAVE_SPEED' | 'CRAB_SPEED' | 'SNAKE_SPEED'
    | 'SLIME_SPEED' | 'PENGUIN_SPEED' | 'FROG_HOP_SPEED'
    | 'FROG_HOP_VELOCITY' | 'FROG_HOP_DELAY_MS' | 'CANNON_FIRE_DELAY_MS'
    | 'CANNON_BULLET_SPEED' | 'CANNON_BULLET_LIFETIME_MS' | 'TORNADO_LIFT_VELOCITY'
    | 'TORNADO_SIDE_VELOCITY' | 'TORNADO_COOLDOWN_MS' | 'JUMP_VELOCITY'
    | 'getCollisionReadyLoadedFullRooms' | 'getRoomOrigin' | 'getPlacedObjectRuntimeKey'
    | 'collectedObjectKeys' | 'multiplayerRemovedObjectKeys' | 'gameFeelController'
    | 'player' | 'playerPickupSensor' | 'playerBody'
    | 'roomRushModeController' | 'activePvpMatch' | 'presenceController'
    | 'gameplayKeyboard' | 'gamepadInput' | 'cameras'
    | 'specialTilesController' | 'getSwordsmanTraversalPlannerMode' | 'movementController'
    | 'isLadderDropRequested' | 'score' | 'heldKeyCount'
    | 'playerHealthController' | 'lostSongController' | 'respawnCheckpointController'
    | 'quicksandController' | 'externalLaunchGraceUntil' | 'showTransientStatus'
    | 'sessionResetController' | 'handleEnemyDefeated' | 'handleNpcDefeated'
    | 'handleCollectibleCollected' | 'handleEnemyCollectibleCollected' | 'handleLiveObjectRemovedForMultiplayer'
    | 'handleRoomSwitchStateChangedForMultiplayer' | 'roomAudioController' | 'fxController'
    | 'worldStreamingController'
  >,
): OverworldLiveObjectController<RoomEdgeWall> {
  return new OverworldLiveObjectController({
    scene: host.scene,
    settings: {
      bouncePadVelocity: host.BOUNCE_PAD_VELOCITY,
      bouncePadCooldownMs: host.BOUNCE_PAD_COOLDOWN_MS,
      bouncePadActiveMs: host.BOUNCE_PAD_ACTIVE_MS,
      batSpeed: host.BAT_SPEED,
      batWaveAmplitude: host.BAT_WAVE_AMPLITUDE,
      batWaveSpeed: host.BAT_WAVE_SPEED,
      birdSpeed: host.BIRD_SPEED,
      birdWaveAmplitude: host.BIRD_WAVE_AMPLITUDE,
      birdWaveSpeed: host.BIRD_WAVE_SPEED,
      crabSpeed: host.CRAB_SPEED,
      snakeSpeed: host.SNAKE_SPEED,
      slimeSpeed: host.SLIME_SPEED,
      penguinSpeed: host.PENGUIN_SPEED,
      frogHopSpeed: host.FROG_HOP_SPEED,
      frogHopVelocity: host.FROG_HOP_VELOCITY,
      frogHopDelayMs: host.FROG_HOP_DELAY_MS,
      cannonFireDelayMs: host.CANNON_FIRE_DELAY_MS,
      cannonBulletSpeed: host.CANNON_BULLET_SPEED,
      cannonBulletLifetimeMs: host.CANNON_BULLET_LIFETIME_MS,
      tornadoLiftVelocity: host.TORNADO_LIFT_VELOCITY,
      tornadoSideVelocity: host.TORNADO_SIDE_VELOCITY,
      tornadoCooldownMs: host.TORNADO_COOLDOWN_MS,
      respawnFallDistance: RESPAWN_FALL_DISTANCE,
      enemyStompBounceVelocity: host.JUMP_VELOCITY * 0.58,
    },
    getLoadedFullRooms: () => host.getCollisionReadyLoadedFullRooms(),
    getRoomOrigin: (coordinates) => host.getRoomOrigin(coordinates),
    getPlacedObjectRuntimeKey: (roomId, placedObject, placedIndex) => host.getPlacedObjectRuntimeKey(roomId, placedObject, placedIndex),
    isCollectedObjectKey: (key) => host.collectedObjectKeys.has(key) || host.multiplayerRemovedObjectKeys.has(key),
    markCollectedObjectKey: (key) => {
      host.collectedObjectKeys.add(key);
    },
    getPlayer: () => host.gameFeelController.isDeathPending() ? null : host.player,
    getPlayerPickupSensor: () => host.gameFeelController.isDeathPending() ? null : host.playerPickupSensor,
    getPlayerBody: () => host.gameFeelController.isDeathPending() ? null : host.playerBody,
    getCoopPlateActors: () => Boolean(getActiveWorldId()) || host.roomRushModeController.isActive()
      || (host.activePvpMatch && host.activePvpMatch.status !== 'complete') ? []
      : host.presenceController.getCoopPlatePlayers().map(ghost => ({
        roomId: ghost.roomId, x: ghost.x, feetY: ghost.y - DEFAULT_PLAYER_VISUAL_FEET_OFFSET,
      })),
    getEnemyStompBounceVelocity: () => {
      const jumpHeld = host.gameplayKeyboard.held('up') || host.gameplayKeyboard.held('jump') || getTouchInputState().jumpHeld
        || host.gamepadInput.held('jump') || host.gamepadInput.held('up');
      return host.JUMP_VELOCITY * (jumpHeld ? 1 : 0.58);
    },
    playEnemyStompImpact: () => {
      if (!prefersReducedMotion())
        host.cameras.main.shake(50, 0.002);
    },
    ...createSpecialTileCallbacks(() => host.specialTilesController),
    swordsmanTraversalPlannerMode: host.getSwordsmanTraversalPlannerMode(),
    isPlayerClimbingLadder: () => host.movementController.isClimbingLadder(),
    isLadderDropRequested: () => host.isLadderDropRequested(),
    isPlayerButtStomping: () => host.movementController.isButtStompImpactActive(),
    handlePlayerButtStompImpact: (bounceVelocity) => host.movementController.handleButtStompImpact(bounceVelocity),
    getCurrentTime: () => gameplayNow(host.scene),
    addScore: (delta) => {
      host.score += delta;
    },
    onKeyCollected: () => {
      host.heldKeyCount += 1;
    },
    onHealingCollected: () => host.playerHealthController.heal(),
    onLostSongCollected: roomId => host.lostSongController.collect(roomId),
    isLostSongGhosted: roomId => host.lostSongController.isGhosted(roomId),
    onRespawnCheckpointTouched: checkpoint => { host.respawnCheckpointController.activate(checkpoint); },
    isRespawnCheckpointReached: (roomId, instanceId) => host.respawnCheckpointController.isObjectReached(roomId, instanceId),
    tryConsumeHeldKey: () => {
      if (host.heldKeyCount <= 0) {
        return false;
      }
      host.heldKeyCount -= 1;
      return true;
    },
    touchQuicksand: () => {
      host.quicksandController.touch();
    },
    grantExternalLaunchGrace: (durationMs) => {
      host.externalLaunchGraceUntil = Math.max(host.externalLaunchGraceUntil, gameplayNow(host.scene) + durationMs);
    },
    // Streaming is created after this controller; jobs are only queued once rooms load.
    enqueueBackgroundCpuWork: (label, execute, onCancelled) =>
      host.worldStreamingController?.enqueueBackgroundCpuWork(label, execute, onCancelled) ?? null,
    getPlayerGravityDirection: () => host.specialTilesController.getPlayerEnvironment().gravityDirection,
    launchPlayerFromSpring: (x, y, durationMs) => host.movementController.launchFromSpring(x, y, durationMs),
    grantPlayerAirJump: () => host.movementController.grantAirJump(),
    showTransientStatus: (message) => host.showTransientStatus(message),
    handlePlayerDeath: (reason) => host.sessionResetController.handlePlayerDeath(reason),
    onEnemyDefeated: (event) => host.handleEnemyDefeated(event),
    onNpcDefeated: (event) => host.handleNpcDefeated(event),
    onCollectibleCollected: (event) => host.handleCollectibleCollected(event),
    onEnemyCollectibleCollected: (event) => host.handleEnemyCollectibleCollected(event),
    onLiveObjectRemoved: (event) => host.handleLiveObjectRemovedForMultiplayer(event),
    onRoomSwitchStateChanged: (event) => host.handleRoomSwitchStateChangedForMultiplayer(event),
    playRoomSfx: (cue, roomCoordinates) => host.roomAudioController.playRoomSfx(cue, roomCoordinates),
    playEnemyKillFx: (x, y, roomCoordinates) => {
      host.fxController?.playEnemyKillFx(x, y, host.roomAudioController.getPlaybackOptionsForRoom(roomCoordinates));
      host.gameFeelController.hitstop();
    },
    playCollectFx: (x, y, scoreDelta, roomCoordinates, cue) => host.fxController?.playCollectFx(x, y, scoreDelta, cue, host.roomAudioController.getPlaybackOptionsForRoom(roomCoordinates)),
    playBounceFx: (x, y, roomCoordinates, cue) => host.fxController?.playBounceFx(x, y, host.roomAudioController.getPlaybackOptionsForRoom(roomCoordinates), cue),
    playBombExplosionFx: (x, y, roomCoordinates) => host.fxController?.playBombExplosionFx(x, y, host.roomAudioController.getPlaybackOptionsForRoom(roomCoordinates)),
  });
}

export function createSignController(host: Pick<OverworldCompositionPorts, 'mode' | 'playerBody' | 'getCollisionReadyLoadedFullRooms'>): OverworldSignController<RoomEdgeWall> {
  return new OverworldSignController({
    getMode: () => host.mode,
    getPlayerBody: () => host.playerBody,
    getLoadedFullRooms: () => host.getCollisionReadyLoadedFullRooms(),
  });
}

export function createPortalObjectController(
  host: Pick<OverworldCompositionPorts,
    | 'worldStreamingController' | 'mode' | 'scene'
    | 'playerBody' | 'getCollisionReadyLoadedFullRooms' | 'getCollisionReadyLoadedFullRoomById'
    | 'roomTransitionController' | 'teleportPlayerToPortalObject'
  >,
): OverworldPortalObjectController<RoomEdgeWall> {
  const portalTargetRoomPreparation = createPortalTargetRoomPreparationAdapter({
    resolveRoomCoordinates: parseRoomId,
    preparePortalTargetRoomForTransition: (coordinates) => host.worldStreamingController.preparePortalTargetRoomForTransition(coordinates),
    clearPortalTargetRoomPreparation: (roomId) => host.worldStreamingController.clearPortalTargetRoomPreparation(roomId),
  });
  return new OverworldPortalObjectController({
    getMode: () => host.mode,
    getCurrentTime: () => gameplayNow(host.scene),
    getPlayerBody: () => host.playerBody,
    getLoadedFullRooms: () => host.getCollisionReadyLoadedFullRooms(),
    getLoadedFullRoomById: (roomId) => host.getCollisionReadyLoadedFullRoomById(roomId),
    requestPortalTargetRoomPreparation: (roomId) => portalTargetRoomPreparation.request(roomId),
    clearPortalTargetRoomPreparation: (roomId) => portalTargetRoomPreparation.clear(roomId),
    authorizeRoomTransition: (coordinates) => host.roomTransitionController.authorizeTeleportTransition(coordinates),
    teleportPlayerTo: (x, y, velocity) => host.teleportPlayerToPortalObject(x, y, velocity),
    playPortalFx: () => {
      playSfx('warp');
    },
  });
}

export function createSpecialTilesController(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'mode' | 'playerBody'
    | 'liveObjectController' | 'getCollisionReadyLoadedFullRooms' | 'getCollisionReadyLoadedFullRoomById'
    | 'getRoomCoordinatesForPoint' | 'getRoomOrigin' | 'externalLaunchGraceUntil'
    | 'movementController' | 'sessionResetController' | 'fxController'
    | 'roomAudioController'
  >,
): OverworldSpecialTilesController<LoadedRoomObject, RoomEdgeWall> {
  return new OverworldSpecialTilesController(host.scene, {
    getMode: () => host.mode,
    getCurrentTime: () => gameplayNow(host.scene),
    getPlayerBody: () => host.playerBody,
    isBodyInSwimmableWater: (body) => host.liveObjectController.isBodyInSwimmableWater(body),
    getLoadedFullRooms: () => host.getCollisionReadyLoadedFullRooms(),
    getLoadedFullRoomById: (roomId) => host.getCollisionReadyLoadedFullRoomById(roomId),
    getRoomCoordinatesForPoint: (x, y) => host.getRoomCoordinatesForPoint(x, y),
    getRoomOrigin: (coordinates) => host.getRoomOrigin(coordinates),
    grantExternalLaunchGrace: (durationMs) => {
      host.externalLaunchGraceUntil = Math.max(host.externalLaunchGraceUntil, gameplayNow(host.scene) + durationMs);
    },
    isPlayerButtStomping: () => host.movementController.isButtStompImpactActive(),
    handlePlayerButtStompImpact: (bounceVelocity) => host.movementController.handleButtStompImpact(bounceVelocity),
    handlePlayerDeath: (reason) => host.sessionResetController.handlePlayerDeath(reason),
    playBounceFx: (x, y, roomCoordinates, cue) => host.fxController?.playBounceFx(x, y, host.roomAudioController.getPlaybackOptionsForRoom(roomCoordinates), cue),
  });
}

export function createWorldStreamingController(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'mode' | 'selectedCoordinates'
    | 'currentRoomCoordinates' | 'refreshAround' | 'getRoomOrigin'
    | 'player' | 'specialTilesController' | 'createLiveObjects'
    | 'liveObjectController' | 'syncActiveCourseObjectLinks' | 'destroyLiveObjects'
    | 'destroyEdgeWalls' | 'getProtectedMovingPlatformSourceRoomIds' | 'syncGhostVisibility'
    | 'runtimeController' | 'shouldRespawnPlayer' | 'portalObjectController'
    | 'handleFullRoomReplaced' | 'updateSelectedSummary' | 'refreshLeaderboardForSelection'
    | 'renderHud' | 'measureMobilePerformance'
  >,
): OverworldWorldStreamingController<
  LoadedRoomObject,
  RoomEdgeWall
> {
  return new OverworldWorldStreamingController({
    scene: host.scene,
    worldRepository: createWorldRepository(),
    getMode: () => host.mode,
    getPerformanceProfile: () => getDeviceLayoutState().performanceProfile,
    getDevicePerformanceMode: () => getDevicePerformanceMode(),
    getSelectedCoordinates: () => host.selectedCoordinates,
    getCurrentRoomCoordinates: () => host.currentRoomCoordinates,
    refreshRoomSummariesForTransition: (centerCoordinates) => host.refreshAround(centerCoordinates, { forceChunkReload: true }),
    getRoomOrigin: (coordinates) => host.getRoomOrigin(coordinates),
    getPlayer: () => host.player,
    shouldCollidePlayerWithTerrainTile: (tile) => host.specialTilesController.shouldCollidePlayerWithTerrainTile(tile),
    createLiveObjects: (loadedRoom) => host.createLiveObjects(loadedRoom),
    createLiveObjectsBatch: (loadedRoom, startIndex, endIndex, dormant) => host.liveObjectController.createLiveObjectsBatch(loadedRoom, startIndex, endIndex, dormant),
    finalizeLiveObjectCreation: (loadedRoom, dormant) => host.liveObjectController.finalizeLiveObjectCreation(loadedRoom, dormant),
    onPreparedLiveObjectsReady: (loadedRoom) => host.syncActiveCourseObjectLinks([loadedRoom]),
    setLiveObjectsDormant: (loadedRoom, dormant) => host.liveObjectController.setLoadedRoomLiveObjectsDormant(loadedRoom, dormant),
    destroyLiveObjects: (loadedRoom, options) => host.destroyLiveObjects(loadedRoom, options),
    destroyLiveObjectsBatch: (loadedRoom, maxObjectCount, options) => host.liveObjectController.destroyLiveObjectsBatch(loadedRoom, maxObjectCount, options),
    destroyEdgeWalls: (loadedRoom) => host.destroyEdgeWalls(loadedRoom),
    syncLiveObjectWorldColliders: (loadedRooms) => host.liveObjectController.syncLoadedWorldColliders(loadedRooms),
    setLiveObjectWorldCollisionTargetDormant: (loadedRoom, dormant) => host.liveObjectController.setLoadedRoomWorldCollisionTargetDormant(loadedRoom, dormant),
    getLiveObjectPhysicsReconciliationGeneration: () => host.liveObjectController.getPhysicsReconciliationGeneration(),
    syncLiveObjectInteractions: (loadedRooms) => host.liveObjectController.syncLiveObjectInteractions(loadedRooms),
    getProtectedFullRoomIds: (targetFullRoomIds) => host.getProtectedMovingPlatformSourceRoomIds(targetFullRoomIds),
    onFullRoomVisibilityChanged: () => host.syncGhostVisibility(),
    onFullRoomSetChanged: (coordinates) => {
      host.syncGhostVisibility();
      host.runtimeController?.syncEdgeWallsForCoordinates(coordinates);
    },
    onFullRoomCollisionReady: (loadedRoom) => {
      if (host.mode === 'play'
        && loadedRoom.room.id === roomIdFromCoordinates(host.currentRoomCoordinates)
        && (!host.player || host.shouldRespawnPlayer)) {
        host.runtimeController?.syncModeRuntime();
      }
    },
    onFullRoomDestroyed: (loadedRoom) => {
      host.specialTilesController.handleFullRoomDestroyed(loadedRoom.room.id);
      host.portalObjectController.handleFullRoomDestroyed(loadedRoom.room.id);
    },
    onFullRoomReplaced: (loadedRoom) => host.handleFullRoomReplaced(loadedRoom),
    onSelectedExactRoomSnapshotReady: () => {
      host.updateSelectedSummary();
      void host.refreshLeaderboardForSelection();
      host.renderHud();
    },
    onPerformanceAdvisorExactSnapshotEvent: (event) => {
      performanceAdvisorRuntime.advisor.recordExactSnapshot(event);
    },
    onPerformanceAdvisorDestinationProgress: (roomId, generation, progressRevision, atMs) => {
      performanceAdvisorRuntime.advisor.recordDestinationProgress(roomId, generation, progressRevision, atMs);
    },
    measurePerformance: (label, callback) => host.measureMobilePerformance(label, callback),
  });
}

export function createRoomMusicPlaybackController(
  host: Pick<OverworldCompositionPorts,
    | 'getRoomSnapshotViewForCoordinates' | 'roomSummariesById' | 'worldStreamingController'
    | 'getExpandedRoomIdAt' | 'coursePlaybackController'
  >,
): OverworldRoomMusicPlaybackController {
  return new OverworldRoomMusicPlaybackController({
    getRoomSnapshotViewForCoordinates: (coordinates) => host.getRoomSnapshotViewForCoordinates(coordinates),
    getRoomSummaryById: (roomId) => host.roomSummariesById.get(roomId) ?? null,
    getRoomSummaries: () => host.roomSummariesById.values(),
    getRoomSummariesRevision: () => host.worldStreamingController.getRoomSummariesRevision(),
    getExpandedRoomIdAt: (coordinates) => host.getExpandedRoomIdAt(coordinates),
    getCourseStartRoomRef: (course, lockedStartRoomId) => host.coursePlaybackController.getCourseStartRoomRef(course, lockedStartRoomId),
  }, globalRoomMusicController);
}

export function createWindowController(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'worldStreamingController' | 'mode'
    | 'cameraMode' | 'inspectZoom' | 'browseInspectZoom'
    | 'getFitZoomForRoom' | 'getZoomFocusCoordinates' | 'windowCenterCoordinates'
    | 'selectedCoordinates' | 'currentRoomCoordinates' | 'shouldCenterCamera'
    | 'shouldRespawnPlayer' | 'syncAppMode' | 'sessionResetController'
    | 'showTransientStatus' | 'courseEditorReturnTarget' | 'editorPlaytestReturnTarget'
    | 'coursePlaybackController' | 'flowController' | 'updateSelectedSummary'
    | 'refreshLeaderboardForSelection' | 'updateCameraBounds' | 'syncModeRuntime'
    | 'runtimeController' | 'syncFocusedRoomVisuals' | 'syncPreviewVisibility'
    | 'syncPresenceSubscriptions' | 'syncGhostVisibility' | 'roomCommentsController'
    | 'redrawWorld' | 'renderHud' | 'loadingText'
  >,
): OverworldWindowController {
  return new OverworldWindowController(host.scene, {
    worldStreamingController: host.worldStreamingController,
    getMode: () => host.mode,
    setMode: (mode) => {
      host.mode = mode;
    },
    setCameraMode: (mode) => {
      host.cameraMode = mode;
    },
    getInspectZoom: () => host.inspectZoom,
    setInspectZoom: (zoom) => {
      host.inspectZoom = zoom;
    },
    getBrowseInspectZoom: () => host.browseInspectZoom,
    setBrowseInspectZoom: (zoom) => {
      host.browseInspectZoom = zoom;
    },
    getFitZoomForRoom: () => host.getFitZoomForRoom(),
    getRefreshCenterCoordinates: () => host.getZoomFocusCoordinates(),
    getWindowCenterCoordinates: () => ({ ...host.windowCenterCoordinates }),
    setWindowCenterCoordinates: (coordinates) => {
      host.windowCenterCoordinates = { ...coordinates };
    },
    setSelectedCoordinates: (coordinates) => {
      host.selectedCoordinates = { ...coordinates };
    },
    setCurrentRoomCoordinates: (coordinates) => {
      host.currentRoomCoordinates = { ...coordinates };
    },
    getCurrentRoomCoordinates: () => ({ ...host.currentRoomCoordinates }),
    setShouldCenterCamera: (value) => {
      host.shouldCenterCamera = value;
    },
    setShouldRespawnPlayer: (value) => {
      host.shouldRespawnPlayer = value;
    },
    syncAppMode: () => host.syncAppMode(),
    resetPlaySession: () => {
      host.sessionResetController.resetPlaySession();
    },
    showTransientStatus: (message) => host.showTransientStatus(message),
    setCourseEditorReturnTarget: (target) => {
      host.courseEditorReturnTarget = target;
    },
    setEditorPlaytestReturnTarget: (target) => {
      host.editorPlaytestReturnTarget = target
        ? { ...target, roomCoordinates: { ...target.roomCoordinates }, clearCheck: target.clearCheck ? { ...target.clearCheck } : undefined }
        : null;
    },
    activateDraftCoursePreview: (snapshot, draftRoom) => host.coursePlaybackController.activateDraftCoursePreview(snapshot, draftRoom),
    startPublishedCoursePlayback: snapshot => host.flowController.startCoursePlayback(snapshot, 'published'),
    updateSelectedSummary: () => host.updateSelectedSummary(),
    refreshLeaderboardForSelection: () => host.refreshLeaderboardForSelection(),
    updateCameraBounds: () => host.updateCameraBounds(),
    syncModeRuntime: () => host.syncModeRuntime(),
    syncFocusedRoomRuntime: (previousCoordinates, currentCoordinates) => host.runtimeController.syncFocusedRoomRuntime(previousCoordinates, currentCoordinates),
    syncFocusedRoomVisuals: () => host.syncFocusedRoomVisuals(),
    syncPreviewVisibility: () => host.syncPreviewVisibility(),
    syncPresenceSubscriptions: () => host.syncPresenceSubscriptions(),
    syncGhostVisibility: () => host.syncGhostVisibility(),
    syncRoomComments: () => host.roomCommentsController.update(),
    redrawWorld: () => host.redrawWorld(),
    renderHud: (statusOverride) => host.renderHud(statusOverride),
    hideLoadingText: () => {
      host.loadingText.setVisible(false);
    },
    getTimeNow: () => gameplayNow(host.scene),
    getBrowseRefreshIntervalMs: () => BROWSE_VISIBLE_CHUNK_REFRESH_INTERVAL_MS,
    getPlayRefreshIntervalMs: () => PLAY_VISIBLE_CHUNK_REFRESH_INTERVAL_MS,
  });
}

export function createRuntimeController(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'getCollisionReadyLoadedFullRooms' | 'mode'
    | 'selectedCoordinates' | 'currentRoomCoordinates' | 'worldStreamingController'
    | 'activeCourseSnapshot' | 'activeCourseRun' | 'activeRoomRushRun'
    | 'isPvpArenaActive' | 'shouldRespawnPlayer' | 'player'
    | 'playerBody' | 'specialTilesController' | 'createPlayer'
    | 'coursePlaybackController' | 'destroyPlayer' | 'syncAppMode'
    | 'cameraMode' | 'goalRunController' | 'syncGoalRunForRoomWithIntro'
    | 'redrawGoalMarkers' | 'syncCameraBoundsUsage' | 'syncGhostVisibility'
    | 'shouldCenterCamera' | 'centerCameraOnCoordinates' | 'constrainInspectCamera'
    | 'applyCameraMode' | 'liveObjectController' | 'destroyEdgeWalls'
    | 'getRoomOrigin' | 'getCellStateAt' | 'requestWindowRefreshForUnknownNeighbor'
    | 'getExpandedRoomIdAt' | 'roomSummariesById'
  >,
): OverworldRuntimeController<LoadedRoomObject> {
  return new OverworldRuntimeController({
    scene: host.scene,
    getLoadedFullRooms: () => host.getCollisionReadyLoadedFullRooms(),
    getMode: () => host.mode,
    setMode: (mode) => {
      host.mode = mode;
    },
    getSelectedCoordinates: () => ({ ...host.selectedCoordinates }),
    getCurrentRoomCoordinates: () => ({ ...host.currentRoomCoordinates }),
    getCurrentRoomSnapshot: () => host.worldStreamingController.getPlayableRoomSnapshotViewForCoordinates(host.currentRoomCoordinates) as RoomSnapshot | null,
    getActiveCourseSnapshot: () => host.activeCourseSnapshot,
    getActiveCourseRun: () => host.activeCourseRun,
    getActiveRoomRushRun: () => host.activeRoomRushRun,
    isRoomTransitionLocked: () => host.isPvpArenaActive(),
    getShouldRespawnPlayer: () => host.shouldRespawnPlayer,
    setShouldRespawnPlayer: (value) => {
      host.shouldRespawnPlayer = value;
    },
    getPlayer: () => host.player,
    getPlayerBody: () => host.playerBody,
    shouldCollidePlayerWithTerrainTile: (tile) => host.specialTilesController.shouldCollidePlayerWithTerrainTile(tile),
    createPlayer: (room) => host.createPlayer(room),
    afterCoursePlayerSpawn: () => host.coursePlaybackController.startRunAfterSpawn(),
    destroyPlayer: () => host.destroyPlayer(),
    syncAppMode: () => host.syncAppMode(),
    setCameraMode: (mode) => {
      host.cameraMode = mode;
    },
    clearCurrentGoalRun: () => {
      host.goalRunController.clearCurrentRun();
    },
    syncGoalRunForRoom: (room, entryContext) => {
      host.syncGoalRunForRoomWithIntro(room, entryContext);
    },
    redrawGoalMarkers: () => host.redrawGoalMarkers(),
    syncCameraBoundsUsage: () => host.syncCameraBoundsUsage(),
    syncGhostVisibility: () => host.syncGhostVisibility(),
    getShouldCenterCamera: () => host.shouldCenterCamera,
    setShouldCenterCamera: (value) => {
      host.shouldCenterCamera = value;
    },
    centerCameraOnCoordinates: (coordinates) => host.centerCameraOnCoordinates(coordinates),
    constrainInspectCamera: () => host.constrainInspectCamera(),
    applyCameraMode: (forceCenter) => host.applyCameraMode(forceCenter),
    syncLiveObjectWorldColliders: (loadedRooms) => host.liveObjectController.syncLoadedWorldColliders(loadedRooms),
    syncLiveObjectInteractions: (loadedRooms) => host.liveObjectController.syncLiveObjectInteractions(loadedRooms),
    clearRoomInteractions: (loadedRoom) => host.liveObjectController.clearRoomInteractions(loadedRoom),
    destroyRoomEdgeWalls: (loadedRoom) => host.destroyEdgeWalls(loadedRoom),
    getRoomOrigin: (coordinates) => host.getRoomOrigin(coordinates),
    getCellStateAt: (coordinates) => host.getCellStateAt(coordinates),
    isWithinLoadedRoomBounds: (coordinates) => host.worldStreamingController.isWithinLoadedRoomBounds(coordinates),
    requestWindowRefreshForUnknownNeighbor: (roomCoordinates, neighborCoordinates) => host.requestWindowRefreshForUnknownNeighbor(roomCoordinates, neighborCoordinates),
    getExpandedRoomIdAt: (coordinates) => host.getExpandedRoomIdAt(coordinates),
    getExpandedRoomMembershipAt: (coordinates) => host.roomSummariesById.get(roomIdFromCoordinates(coordinates))?.expandedRoom ?? null,
    isPlayableRoomCollisionReady: (coordinates) => host.worldStreamingController.isPlayableRoomCollisionReady(coordinates),
  }, {
    edgeWallThickness: EDGE_WALL_THICKNESS,
  });
}

export function createSelectionController(
  host: Pick<OverworldCompositionPorts,
    | 'mode' | 'cameraMode' | 'getFitZoomForRoom'
    | 'inspectZoom' | 'browseInspectZoom' | 'syncAppMode'
    | 'selectedCoordinates' | 'currentRoomCoordinates' | 'windowCenterCoordinates'
    | 'shouldCenterCamera' | 'shouldRespawnPlayer' | 'updateSelectedSummary'
    | 'refreshLeaderboardForSelection' | 'redrawWorld' | 'renderHud'
    | 'refreshAround' | 'roomSummariesById' | 'draftRoomsById'
    | 'coursePlaybackController' | 'activeCourseSnapshot' | 'worldStreamingController'
    | 'cameras' | 'refreshChunkWindowIfNeeded'
  >,
): OverworldSelectionController {
  return new OverworldSelectionController({
    getMode: () => host.mode,
    setMode: (mode) => {
      host.mode = mode;
    },
    setCameraMode: (mode) => {
      host.cameraMode = mode;
    },
    getFitZoomForRoom: () => host.getFitZoomForRoom(),
    setInspectZoom: (zoom) => {
      host.inspectZoom = zoom;
    },
    setBrowseInspectZoom: (zoom) => {
      host.browseInspectZoom = zoom;
    },
    syncAppMode: () => host.syncAppMode(),
    setSelectedCoordinates: (coordinates) => {
      host.selectedCoordinates = { ...coordinates };
    },
    setCurrentRoomCoordinates: (coordinates) => {
      host.currentRoomCoordinates = { ...coordinates };
    },
    setWindowCenterCoordinates: (coordinates) => {
      host.windowCenterCoordinates = { ...coordinates };
    },
    setShouldCenterCamera: (value) => {
      host.shouldCenterCamera = value;
    },
    setShouldRespawnPlayer: (value) => {
      host.shouldRespawnPlayer = value;
    },
    updateSelectedSummary: () => host.updateSelectedSummary(),
    refreshLeaderboardForSelection: () => host.refreshLeaderboardForSelection(),
    redrawWorld: () => host.redrawWorld(),
    renderHud: () => host.renderHud(),
    refreshAround: (coordinates, options) => host.refreshAround(coordinates, options),
    getRoomSummary: (roomId) => host.roomSummariesById.get(roomId),
    hasDraftRoom: (roomId) => host.draftRoomsById.has(roomId),
    hasActiveCourseRoomOverride: (roomId) => host.coursePlaybackController.hasActiveCourseRoomOverride(roomId),
    isRoomInActiveCourse: (coordinates) => Boolean(host.activeCourseSnapshot?.roomRefs.some((roomRef) => roomRef.roomId === roomIdFromCoordinates(coordinates))),
    getRoomSnapshotForCoordinates: (coordinates) => host.worldStreamingController.getRoomSnapshotForCoordinates(coordinates),
    isWithinLoadedRoomBounds: (coordinates) => host.worldStreamingController.isWithinLoadedRoomBounds(coordinates),
    getMainCamera: () => host.cameras.main,
    getWindowCenterCoordinates: () => ({ ...host.windowCenterCoordinates }),
    refreshChunkWindowIfNeeded: (coordinates) => host.refreshChunkWindowIfNeeded(coordinates),
  });
}

export function createRoomTransitionController(
  host: Pick<OverworldCompositionPorts,
    | 'mode' | 'player' | 'playerBody'
    | 'playerFacing' | 'currentRoomCoordinates' | 'selectedCoordinates'
    | 'windowCenterCoordinates' | 'getRoomCoordinatesForPoint' | 'runtimeController'
    | 'worldStreamingController' | 'recordPerformanceTransitionGate' | 'handlePerformanceRoomTransitionCompleted'
    | 'connectionNoticeController'
    | 'isPvpArenaActive' | 'sessionResetController' | 'updateSelectedSummary'
    | 'activeCourseRun' | 'activeCourseSnapshot' | 'roomSummariesById'
    | 'activeRoomRushRun' | 'recordRoomRushVisit' | 'syncGoalRunForRoomWithIntro'
    | 'getRoomSnapshotViewForCoordinates' | 'refreshLeaderboardForSelection' | 'refreshAround'
    | 'refreshAroundIfNeededOrFromCache' | 'redrawWorld' | 'renderHud'
    | 'getRoomOrigin' | 'movementController' | 'playerPresentationController'
    | 'getCellStateAt' | 'specialTilesController' | 'isSolidTerrainAtWorldPoint'
  >,
): OverworldRoomTransitionController {
  return new OverworldRoomTransitionController({
    getMode: () => host.mode,
    getPlayer: () => host.player,
    getPlayerBody: () => host.playerBody,
    getPlayerFacing: () => host.playerFacing < 0 ? -1 : 1,
    getPlayerGravityEnvironment: () => host.specialTilesController.getPlayerEnvironment(),
    isSolidTerrainAt: (x, y) => {
      const room = host.getRoomSnapshotViewForCoordinates(host.currentRoomCoordinates);
      return !room || host.isSolidTerrainAtWorldPoint(room, x, y);
    },
    getCurrentRoomCoordinates: () => ({ ...host.currentRoomCoordinates }),
    setCurrentRoomCoordinates: (coordinates) => {
      host.currentRoomCoordinates = { ...coordinates };
    },
    setSelectedCoordinates: (coordinates) => {
      host.selectedCoordinates = { ...coordinates };
    },
    getWindowCenterCoordinates: () => ({ ...host.windowCenterCoordinates }),
    getRoomCoordinatesForPoint: (x, y) => host.getRoomCoordinatesForPoint(x, y),
    isNeighborReachable: (roomCoordinates, neighborCoordinates) => host.runtimeController.isNeighborReachable(roomCoordinates, neighborCoordinates),
    prefetchPlayableRoomForTransition: (coordinates) => host.worldStreamingController.prefetchPlayableRoomForTransition(coordinates),
    clearPredictedPlayableRoomForTransition: () => host.worldStreamingController.clearPredictedPlayableRoomForTransition(),
    preparePlayableRoomForTransition: (coordinates, portalDestination) => host.worldStreamingController.preparePlayableRoomForTransition(coordinates, portalDestination),
    setTransitionPreparationSeamUrgent: (urgent) => host.worldStreamingController.setTransitionPreparationSeamUrgent(urgent),
    recordPerformanceTransitionGate: (reason, currentCoordinates, nextCoordinates) => host.recordPerformanceTransitionGate(reason, currentCoordinates, nextCoordinates),
    clearPerformanceTransitionGate: () => {
      performanceAdvisorRuntime.advisor.clearTransitionGate(performance.now());
    },
    onRoomTransitionCompleted: () => host.handlePerformanceRoomTransitionCompleted(),
    onSeamWaitChanged: (waiting) => host.connectionNoticeController.setSeamWaiting(waiting),
    isRoomTransitionLocked: () => host.isPvpArenaActive(),
    resetChallengeStateForRoomExit: (nextRoomCoordinates) => {
      host.sessionResetController.resetChallengeStateForRoomExit(nextRoomCoordinates);
    },
    updateSelectedSummary: () => host.updateSelectedSummary(),
    getActiveCourseRun: () => host.activeCourseRun,
    getActiveCourseSnapshot: () => host.activeCourseSnapshot,
    getExpandedRoomMembershipAt: (coordinates) => host.roomSummariesById.get(roomIdFromCoordinates(coordinates))?.expandedRoom ?? null,
    handlePlayerDeath: (reason, bypassHealth) => host.sessionResetController.handlePlayerDeath(reason, bypassHealth),
    getActiveRoomRushRun: () => host.activeRoomRushRun,
    recordRoomRushVisit: (room) => host.recordRoomRushVisit(room),
    syncGoalRunForRoom: (room, entryContext) => {
      host.syncGoalRunForRoomWithIntro(room, entryContext);
    },
    getRoomSnapshotForCoordinates: (coordinates) => host.getRoomSnapshotViewForCoordinates(coordinates) as RoomSnapshot | null,
    refreshLeaderboardForSelection: () => host.refreshLeaderboardForSelection(),
    setFocusedCoordinates: (coordinates) => {
      setFocusedCoordinatesInUrl(coordinates);
    },
    refreshAround: (coordinates) => host.refreshAround(coordinates),
    refreshAroundIfNeededOrFromCache: (coordinates, options) => host.refreshAroundIfNeededOrFromCache(coordinates, options),
    redrawWorld: () => host.redrawWorld(),
    renderHud: () => host.renderHud(),
    getRoomOrigin: (coordinates) => host.getRoomOrigin(coordinates),
    clearLadderState: () => {
      host.movementController.clearLadderState();
    },
    syncPlayerPickupSensor: () => host.playerPresentationController.syncPlayerPickupSensor(),
    getTransitionDebugContext: (coordinates) => ({
      cellState: host.getCellStateAt(coordinates),
      summaryLoaded: host.worldStreamingController
        .getRoomSummariesById()
        .has(roomIdFromCoordinates(coordinates)),
      withinLoadedBounds: host.worldStreamingController.isWithinLoadedRoomBounds(coordinates),
      collisionReady: host.worldStreamingController.isPlayableRoomCollisionReady(coordinates),
      windowCenter: { ...host.windowCenterCoordinates },
      needsWindowRefresh: host.worldStreamingController.needsRefreshAround(host.currentRoomCoordinates),
    }),
  });
}

export function createFlowController(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'mode' | 'cameraMode'
    | 'selectedCoordinates' | 'currentRoomCoordinates' | 'getSelectedCourseContext'
    | 'loadPublishedCourseSnapshot' | 'courseEditorReturnTarget' | 'editorPlaytestReturnTarget'
    | 'getCellStateAt' | 'isFrontierBuildBlockedByClaimLimit' | 'getRoomSnapshotForCoordinates'
    | 'getActiveCourseDraftSessionContextForRoom' | 'sessionResetController' | 'clearTouchGestureState'
    | 'roomGoalIntroFromOverworldPending' | 'forceRoomGoalIntroFromOverworldPending' | 'goalRunController'
    | 'inspectZoom' | 'browseInspectZoom' | 'getFitZoomForRoom'
    | 'syncAppMode' | 'syncModeRuntime' | 'shouldCenterCamera'
    | 'shouldRespawnPlayer' | 'pendingWarpSpawnRoomCoordinates' | 'refreshAround'
    | 'refreshAroundIfNeededOrFromCache' | 'coursePlaybackController' | 'activeCourseRun'
    | 'activeRoomRushRun' | 'setActiveCourseRun' | 'emitCourseComposerStateChanged'
    | 'renderHud' | 'roomRepository'
  >,
  hud: OverworldHudStateController,
): OverworldSceneFlowController {
  return new OverworldSceneFlowController(host.scene, {
    prepareRoomEdit: (roomId, coordinates) => prepareRoomOwnershipEdit({
      repository: host.roomRepository,
      captureContext: () => hud.captureOwnershipEditContext(),
      subscribeInvalidation: callback => {
        const stop = hud.onOwnershipEditInvalidation(callback);
        host.scene.events.on('sleep', callback);
        host.scene.events.on('shutdown', callback);
        host.scene.events.on('destroy', callback);
        return () => { stop(); for (const event of ['sleep', 'shutdown', 'destroy']) host.scene.events.off(event, callback); };
      },
      getUserId: () => { const auth = getAuthDebugState(); return auth.authenticated ? auth.user?.id ?? null : null; },
      canCheckWallet: () => document.documentElement.dataset.wallet === 'yes',
      getWalletAddress: () => { const auth = getAuthDebugState(); return auth.authenticated ? auth.user?.walletAddress ?? null : null; },
      acceptOwnership: (id, summary) => hud.setRoomOwnershipDetails(id, {
        claimerUserId: summary.claimerUserId,
        isMinted: summary.mintedChainId !== null || summary.mintedContractAddress !== null || summary.mintedTokenId !== null,
        mintedOwnerWalletAddress: summary.mintedOwnerWalletAddress,
      }),
    }, roomId, coordinates),
    getMode: () => host.mode,
    setMode: (mode) => {
      host.mode = mode;
    },
    setCameraMode: (mode) => {
      host.cameraMode = mode;
    },
    getSelectedCoordinates: () => ({ ...host.selectedCoordinates }),
    setSelectedCoordinates: (coordinates) => {
      host.selectedCoordinates = { ...coordinates };
    },
    getCurrentRoomCoordinates: () => ({ ...host.currentRoomCoordinates }),
    setCurrentRoomCoordinates: (coordinates) => {
      host.currentRoomCoordinates = { ...coordinates };
    },
    getSelectedPublishedCourseId: () => host.getSelectedCourseContext()?.courseId ?? null,
    loadPublishedCourseSnapshot: (courseId) => host.loadPublishedCourseSnapshot(courseId),
    getCourseEditorReturnTarget: () => host.courseEditorReturnTarget ?? null,
    setCourseEditorReturnTarget: (target) => {
      host.courseEditorReturnTarget = target;
    },
    getEditorPlaytestReturnTarget: () => host.editorPlaytestReturnTarget
      ? { ...host.editorPlaytestReturnTarget, roomCoordinates: { ...host.editorPlaytestReturnTarget.roomCoordinates }, clearCheck: host.editorPlaytestReturnTarget.clearCheck ? { ...host.editorPlaytestReturnTarget.clearCheck } : undefined }
      : null,
    setEditorPlaytestReturnTarget: (target) => {
      host.editorPlaytestReturnTarget = target
        ? { ...target, roomCoordinates: { ...target.roomCoordinates }, clearCheck: target.clearCheck ? { ...target.clearCheck } : undefined }
        : null;
    },
    getCellStateAt: (coordinates) => host.getCellStateAt(coordinates),
    isFrontierBuildBlockedByClaimLimit: () => host.isFrontierBuildBlockedByClaimLimit(),
    getSelectedRoomSnapshot: (coordinates) => host.getRoomSnapshotForCoordinates(coordinates),
    getActiveCourseEditContext: (roomId) => host.getActiveCourseDraftSessionContextForRoom(roomId),
    resetPlaySession: () => host.sessionResetController.resetPlaySession(),
    clearTouchGestureState: () => host.clearTouchGestureState(),
    requestRoomGoalIntroForNextOverworldEntry: (options) => {
      host.roomGoalIntroFromOverworldPending = true;
      host.forceRoomGoalIntroFromOverworldPending = options?.force === true;
    },
    clearGoalRun: () => {
      host.goalRunController.clearCurrentRun();
    },
    getInspectZoom: () => host.inspectZoom,
    setInspectZoom: (zoom) => {
      host.inspectZoom = zoom;
    },
    getBrowseInspectZoom: () => host.browseInspectZoom,
    setBrowseInspectZoom: (zoom) => {
      host.browseInspectZoom = zoom;
    },
    getFitZoomForRoom: () => host.getFitZoomForRoom(),
    syncAppMode: () => host.syncAppMode(),
    syncModeRuntime: () => host.syncModeRuntime(),
    setShouldCenterCamera: (value) => {
      host.shouldCenterCamera = value;
    },
    setShouldRespawnPlayer: (value) => {
      host.shouldRespawnPlayer = value;
    },
    setPendingWarpSpawnCoordinates: (coordinates) => {
      host.pendingWarpSpawnRoomCoordinates = coordinates ? { ...coordinates } : null;
    },
    refreshAround: (coordinates, options) => host.refreshAround(coordinates, options),
    refreshAroundIfNeededOrFromCache: (coordinates, options) => host.refreshAroundIfNeededOrFromCache(coordinates, options),
    prepareActiveCourseRoomOverrides: (snapshot, options) => host.coursePlaybackController.prepareActiveCourseRoomOverrides(snapshot, options),
    createCourseRunState: (snapshot, options) => host.coursePlaybackController.createCourseRunState(snapshot, options),
    getCourseStartRoomRef: (course, lockedStartRoomId) => host.coursePlaybackController.getCourseStartRoomRef(course, lockedStartRoomId),
    getActiveCourseRun: () => host.activeCourseRun,
    getActiveRoomRushRun: () => host.activeRoomRushRun,
    setActiveCourseRun: (runState) => {
      host.setActiveCourseRun(runState);
    },
    emitCourseComposerStateChanged: () => host.emitCourseComposerStateChanged(),
    renderHud: () => host.renderHud(),
  });
}
