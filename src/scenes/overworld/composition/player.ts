import { playSfx } from '../../../audio/sfx';
import { getAuthDebugState } from '../../../auth/client';
import { goalEndsOnDeath } from '../../../goals/goalSafety';
import { setFocusedCoordinatesInUrl } from '../../../navigation/worldNavigation';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import { parseRoomId, roomIdFromCoordinates } from '../../../persistence/roomModel';
import type { DefaultPlayerAnimationState } from '../../../player/defaultPlayer';
import { DEFAULT_PLAYER_VISUAL_FEET_OFFSET } from '../../../player/defaultPlayer';
import { getPlayableMaximumHearts } from '../../../player/hearts';
import { createRunRepository } from '../../../runs/runRepository';
import { prefersReducedMotion } from '../../../ui/deviceLayout';
import { recordEditorDraftClear } from '../../editor/clearCheck';
import { OverworldCombatController } from '../combatController';
import { OverworldCombatPresentationController } from '../combatPresentation';
import { OverworldCoursePlaybackController } from '../coursePlayback';
import { recordExpandedRoomRunDeath } from '../expandedRoomRuns';
import { OverworldGameFeelController } from '../gameFeel';
import { gameplayNow } from '../gameplayClock';
import { OverworldGhostRaceController } from '../ghostRace';
import { OverworldGoalRunController } from '../goalRuns';
import { GuestRunPlaybackController } from '../guestRunPlayback';
import type { LoadedRoomObject } from '../liveObjects';
import { createLostSongContext } from '../lostSongContext';
import { OverworldLostSongController } from '../lostSongs';
import { OverworldMovementController } from '../movementController';
import { OverworldObjectiveController } from '../objectiveController';
import { OverworldPlayerDeathPresentation } from '../playerDeathPresentation';
import { OverworldPlayerHealthController } from '../playerHealth';
import { OverworldPlayerLifecycleController } from '../playerLifecycle';
import type { OverworldPlayerPresentationControllerState } from '../playerPresentation';
import { OverworldPlayerPresentationController } from '../playerPresentation';
import { OverworldQuicksandController } from '../quicksandController';
import { OverworldRespawnCheckpointController } from '../respawnCheckpoints';
import { OverworldRespawnController } from '../respawnController';
import { OverworldSessionResetController } from '../sessionReset';
import type { OverworldCompositionPorts } from './ports';
import { finishRoomWarmupForArrival } from './roomArrival';

export function createQuicksandController(host: Pick<OverworldCompositionPorts, 'scene' | 'showTransientStatus'>): OverworldQuicksandController {
  return new OverworldQuicksandController({
    getCurrentTime: () => gameplayNow(host.scene),
    showTransientStatus: (message) => host.showTransientStatus(message),
  });
}

export function createPlayerDeathPresentation(host: Pick<OverworldCompositionPorts, 'scene' | 'playerSprite'>): OverworldPlayerDeathPresentation {
  return new OverworldPlayerDeathPresentation(host.scene, () => host.playerSprite);
}

export function createGameFeelController(
  host: Pick<OverworldCompositionPorts,
    | 'mode' | 'playerBody' | 'isPvpMatchActive'
    | 'physics' | 'playerDeathPresentation'
  >,
): OverworldGameFeelController {
  return new OverworldGameFeelController({
    canApplyFeedback: () => host.mode === 'play' && host.playerBody !== null,
    isPvpActive: () => host.isPvpMatchActive(),
    isPhysicsPaused: () => host.physics.world.isPaused,
    pausePhysics: () => host.physics.world.pause(),
    resumePhysics: () => host.physics.world.resume(),
    hidePlayer: () => host.playerDeathPresentation.hide(),
    restorePlayerVisual: () => host.playerDeathPresentation.restore(),
    fadeInPlayer: duration => host.playerDeathPresentation.fadeIn(duration),
  });
}

export function createGhostRaceController(
  host: Pick<OverworldCompositionPorts,
    | 'runtimeContext' | 'scene' | 'goalRunController'
    | 'getRoomOrigin' | 'hudBridge' | 'showTransientStatus'
  >,
): OverworldGhostRaceController {
  return new OverworldGhostRaceController({
    runtime: host.runtimeContext,
    scene: host.scene, getRun: () => host.goalRunController?.getCurrentRun() ?? null,
    getUserId: () => getAuthDebugState().authenticated ? getAuthDebugState().user?.id ?? null : null,
    getRoomOrigin: coordinates => host.getRoomOrigin(coordinates),
    onRaceInfoChanged: info => host.hudBridge?.setGhostRaceInfo(info),
    showStatus: message => host.showTransientStatus(message),
  });
}

export function createPlayerHealthController(
  host: Pick<OverworldCompositionPorts,
    | 'runtimeContext' | 'scene' | 'activeCourseSnapshot'
    | 'roomSummariesById' | 'currentRoomCoordinates' | 'getRoomSnapshotViewForCoordinates'
    | 'mode' | 'activeRoomRushRun' | 'isPvpArenaActive'
    | 'gameFeelController' | 'combatController' | 'movementController'
    | 'playerFacing' | 'showTransientStatus'
  >,
): OverworldPlayerHealthController {
  return new OverworldPlayerHealthController({
    runtime: host.runtimeContext,
    scene: host.scene,
    getMaximumHearts: () => getPlayableMaximumHearts({
      course: host.activeCourseSnapshot,
      expandedRoom: host.roomSummariesById.get(roomIdFromCoordinates(host.currentRoomCoordinates))?.expandedRoom ?? null,
      room: host.getRoomSnapshotViewForCoordinates(host.currentRoomCoordinates),
    }),
    isActive: () => host.mode === 'play' && !host.activeRoomRushRun && !host.isPvpArenaActive(),
    isPvpActive: () => host.isPvpArenaActive(),
    isDeathPending: () => host.gameFeelController.isDeathPending(),
    getCurrentTime: () => gameplayNow(host.scene),
    onHurt: () => {
      host.combatController.clearAttackAnimation();
      host.movementController.applyHurtKnockback(host.playerFacing as -1 | 1);
      playSfx('player-hurt');
      host.showTransientStatus('You lost a heart.');
    },
  });
}

export function createGuestRunPlaybackController(
  host: Pick<OverworldCompositionPorts,
    | 'goalRunController' | 'activeCourseRun' | 'startRankedRunTrace'
    | 'clearRankedRunTrace' | 'renderHud' | 'ghostRaceController'
  >,
): GuestRunPlaybackController {
  return new GuestRunPlaybackController({
    getCurrentRun: kind => kind === 'room' ? host.goalRunController?.getCurrentRun() ?? null : host.activeCourseRun,
    startTrace: (kind, binding) => host.startRankedRunTrace(kind, binding),
    clearTrace: () => host.clearRankedRunTrace(),
    renderHud: () => host.renderHud(),
    onSaved: run => host.ghostRaceController.confirmGuest(run),
  });
}

export function createGoalRunController(
  host: Pick<OverworldCompositionPorts,
    | 'PLAYER_HEIGHT' | 'assist' | 'score'
    | 'showTransientStatus' | 'countRoomObjectsByCategory' | 'prepareRankedRunTrace'
    | 'startRankedRunTrace' | 'buildRankedRunVerificationTrace' | 'clearRankedRunTrace'
    | 'editorPlaytestReturnTarget'
  >,
  guestRuns: GuestRunPlaybackController,
): OverworldGoalRunController {
  return new OverworldGoalRunController({
    playerHeight: host.PLAYER_HEIGHT,
    isAssistActive: () => host.assist?.requestedForRun() ?? false,
    runRepository: createRunRepository(),
    guestRuns,
    getScore: () => host.score,
    getAuthenticated: () => getAuthDebugState().authenticated,
    getAuthSource: () => getAuthDebugState().source ?? null,
    getAuthDisplayName: () => getAuthDebugState().user?.displayName ?? null,
    showTransientStatus: (message) => host.showTransientStatus(message),
    countRoomObjectsByCategory: (room, category) => host.countRoomObjectsByCategory(room, category),
    onRankedRunPreparing: kind => host.prepareRankedRunTrace(kind),
    onRankedRunStarted: (binding) => {
      host.startRankedRunTrace(binding.kind, binding);
    },
    buildVerificationTrace: (runState, result) => host.buildRankedRunVerificationTrace('room', runState.elapsedMs, result),
    clearVerificationTrace: () => {
      host.clearRankedRunTrace();
    },
    onDraftGoalCompleted: run => { recordEditorDraftClear(host.editorPlaytestReturnTarget?.clearCheck, run); },
  });
}

export function createRespawnCheckpointController(
  host: Pick<OverworldCompositionPorts,
    | 'mode' | 'activeRoomRushRun' | 'isPvpArenaActive'
    | 'activeCourseRun' | 'currentRoomCoordinates' | 'currentGoalRun'
    | 'recordRankedGoalEvent' | 'getRoomOrigin' | 'fxController'
    | 'showTransientStatus' | 'liveObjectController'
  >,
): OverworldRespawnCheckpointController {
  return new OverworldRespawnCheckpointController({
    getScope: () => {
      if (host.mode !== 'play' || host.activeRoomRushRun || host.isPvpArenaActive())
        return null;
      if (host.activeCourseRun)
        return goalEndsOnDeath(host.activeCourseRun.course.goal) ? null
          : { owner: host.activeCourseRun, roomIds: host.activeCourseRun.course.roomRefs.map(ref => ref.roomId) };
      const roomId = roomIdFromCoordinates(host.currentRoomCoordinates);
      const run = host.currentGoalRun?.roomId === roomId ? host.currentGoalRun : null;
      if (goalEndsOnDeath(run?.goal))
        return null;
      return { owner: run ?? `room:${roomId}`, phase: run?.qualificationState, roomIds: [roomId] };
    },
    onActivated: checkpoint => {
      if (checkpoint.kind !== 'object')
        return;
      host.recordRankedGoalEvent({ type: 'respawn_checkpoint', ...checkpoint });
      const origin = host.getRoomOrigin(checkpoint.roomCoordinates);
      host.fxController?.playGoalFx('checkpoint', origin.x + checkpoint.x, origin.y + checkpoint.y);
      host.showTransientStatus('Checkpoint reached.');
    },
    onChanged: () => {
      host.liveObjectController?.syncRespawnCheckpointPresentation();
    },
  });
}

export function createLostSongController(
  host: Pick<OverworldCompositionPorts,
    | 'mode' | 'playerBody' | 'gameFeelController'
    | 'currentRoomCoordinates' | 'getRoomSnapshotViewForCoordinates' | 'activeCourseRun'
    | 'assist' | 'roomSummariesById' | 'getRoomOrigin'
    | 'showTransientStatus' | 'liveObjectController' | 'roomCellController'
  >,
): OverworldLostSongController {
  return new OverworldLostSongController({
    getContext: createLostSongContext({
      canPlay: () => host.mode === 'play' && Boolean(host.playerBody) && !host.gameFeelController.isDeathPending(),
      getCoordinates: () => host.currentRoomCoordinates, getRoom: coordinates => host.getRoomSnapshotViewForCoordinates(coordinates),
      getCourse: () => host.activeCourseRun, isAssisted: () => host.assist?.isPracticeFind() ?? false,
      getCreator: id => host.roomSummariesById.get(id)?.creatorUserId ?? null, getOrigin: coordinates => host.getRoomOrigin(coordinates),
      getPosition: () => host.playerBody!.center,
    }),
    showStatus: message => host.showTransientStatus(message),
    onFoundChanged: () => {
      host.liveObjectController?.syncLostSongPresentation();
      host.roomCellController?.redraw();
    },
  });
}

export function createCombatPresentationController(host: Pick<OverworldCompositionPorts, 'scene' | 'fxController'>): OverworldCombatPresentationController {
  return new OverworldCombatPresentationController({
    scene: host.scene,
    getLocalTime: () => gameplayNow(host.scene),
    playSwordSlashFx: (x, y, facing, downward) => host.fxController?.playSwordSlashFx(x, y, facing, downward),
    playMuzzleFlashFx: (x, y, facing) => host.fxController?.playMuzzleFlashFx(x, y, facing),
  });
}

export function createCoursePlaybackController(
  host: Pick<OverworldCompositionPorts,
    | 'assist' | 'selectedCoordinates' | 'activeCourseRun'
    | 'setActiveCourseRun' | 'worldStreamingController' | 'getRoomSnapshotForCoordinates'
    | 'countRoomObjectsByCategory' | 'showTransientStatus' | 'renderHud'
    | 'prepareRankedRunTrace' | 'startRankedRunTrace' | 'buildRankedRunVerificationTrace'
    | 'clearRankedRunTrace'
  >,
  guestRuns: GuestRunPlaybackController,
): OverworldCoursePlaybackController {
  return new OverworldCoursePlaybackController({
    isAssistActive: () => host.assist?.requestedForRun() ?? false,
    guestRuns,
    getSelectedCoordinates: () => ({ ...host.selectedCoordinates }),
    getActiveCourseRun: () => host.activeCourseRun,
    setActiveCourseRun: (runState) => {
      host.setActiveCourseRun(runState);
    },
    clearTransientRoomOverride: (roomId) => {
      host.worldStreamingController.clearTransientRoomOverride(roomId);
    },
    clearTransientRoomOverrides: (roomIds) => {
      host.worldStreamingController.clearTransientRoomOverrides(roomIds);
    },
    setTransientRoomOverride: (snapshot) => {
      host.worldStreamingController.setTransientRoomOverride(snapshot);
    },
    setTransientRoomOverrides: (snapshots) => {
      host.worldStreamingController.setTransientRoomOverrides(snapshots);
    },
    getRoomSnapshotForCoordinates: (coordinates) => host.getRoomSnapshotForCoordinates(coordinates),
    countRoomObjectsByCategory: (room, category) => host.countRoomObjectsByCategory(room, category),
    showTransientStatus: (message) => host.showTransientStatus(message),
    renderHud: () => host.renderHud(),
    onRankedRunPreparing: kind => host.prepareRankedRunTrace(kind),
    onRankedRunStarted: (binding) => {
      host.startRankedRunTrace(binding.kind, binding);
    },
    buildVerificationTrace: (runState, result) => host.buildRankedRunVerificationTrace('course', runState.elapsedMs, result),
    clearVerificationTrace: () => {
      host.clearRankedRunTrace();
    },
  });
}

export function createObjectiveController(
  host: Pick<OverworldCompositionPorts,
    | 'goalRunController' | 'activeCourseRun' | 'player'
    | 'playerBody' | 'currentRoomCoordinates' | 'getPlayerEffectOrigin'
    | 'toWorldGoalPoint' | 'toWorldCoursePoint' | 'sessionResetController'
    | 'liveObjectController' | 'showTransientStatus' | 'redrawGoalMarkers'
    | 'fxController' | 'respawnCheckpointController' | 'coursePlaybackController'
    | 'recordRankedGoalEvent'
  >,
): OverworldObjectiveController {
  return new OverworldObjectiveController({
    goalRunController: host.goalRunController,
    getActiveCourseRun: () => host.activeCourseRun,
    getPlayer: () => host.player,
    getPlayerBody: () => host.playerBody,
    getCurrentRoomCoordinates: () => host.currentRoomCoordinates,
    getPlayerEffectOrigin: () => host.getPlayerEffectOrigin(),
    toWorldGoalPoint: (roomCoordinates, point) => host.toWorldGoalPoint(roomCoordinates, point),
    toWorldCoursePoint: (point) => host.toWorldCoursePoint(point),
    resetChallengeStateForCurrentRun: () => host.sessionResetController.resetChallengeStateForCurrentRun(),
    getRoomNpcState: (roomId, requestedInstanceId) => host.liveObjectController.getRoomNpcState(roomId, requestedInstanceId),
    setRoomNpcsVictorious: (roomId, victorious) => host.liveObjectController.setRoomNpcsVictorious(roomId, victorious),
    showTransientStatus: (message) => host.showTransientStatus(message),
    redrawGoalMarkers: () => host.redrawGoalMarkers(),
    playGoalFx: (effect, x, y, cue) => host.fxController?.playGoalFx(effect, x, y, cue),
    activateRespawnCheckpoint: (point, checkpointIndex) => {
      const roomCoordinates = parseRoomId(point.roomId);
      if (roomCoordinates)
        host.respawnCheckpointController.activate({
          ...point, roomCoordinates,
          kind: 'goal', instanceId: null, checkpointIndex
        });
    },
    finalizeActiveCourseRun: (result) => {
      void host.coursePlaybackController.finalizeActiveCourseRun(result);
    },
    recordRankedGoalEvent: (event) => {
      host.recordRankedGoalEvent(event);
    },
  }, {
    goalTouchRadius: 18,
  });
}

export function createPlayerLifecycleController(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'assist' | 'respawnCheckpointController'
    | 'activeCourseSnapshot' | 'getRoomOrigin' | 'liveObjectController'
    | 'destroyEdgeWalls' | 'PLAYER_WIDTH' | 'PLAYER_HEIGHT'
    | 'PLAYER_STANDING_HEIGHT' | 'PLAYER_PICKUP_SENSOR_EXTRA_HEIGHT'
  >,
): OverworldPlayerLifecycleController<LoadedRoomObject> {
  return new OverworldPlayerLifecycleController({
    scene: host.scene,
    getRespawnCheckpointForRoom: room => {
      const checkpoint = host.assist?.safe.getCheckpoint() ?? host.respawnCheckpointController.getCheckpoint();
      return checkpoint?.roomId === room.id ? checkpoint : null;
    },
    getActiveCourseSnapshot: () => host.activeCourseSnapshot,
    getRoomOrigin: (coordinates) => host.getRoomOrigin(coordinates),
    clearRoomInteractions: (loadedRoom) => host.liveObjectController.clearRoomInteractions(loadedRoom),
    destroyRoomEdgeWalls: (loadedRoom) => host.destroyEdgeWalls(loadedRoom),
  }, {
    playerWidth: host.PLAYER_WIDTH,
    playerHeight: host.PLAYER_HEIGHT,
    playerBodyAnchorHeight: host.PLAYER_STANDING_HEIGHT,
    playerPickupSensorExtraHeight: host.PLAYER_PICKUP_SENSOR_EXTRA_HEIGHT,
  });
}

export function createRespawnController(
  host: Pick<OverworldCompositionPorts,
    | 'assist' | 'respawnCheckpointController' | 'activeCourseRun'
    | 'coursePlaybackController' | 'currentRoomCoordinates' | 'getRoomSnapshotForCoordinates'
    | 'getPlayerEntities' | 'combatController' | 'externalLaunchGraceUntil'
    | 'physicsCadence' | 'movementController' | 'selectedCoordinates'
    | 'updateSelectedSummary' | 'shouldCenterCamera' | 'playerLifecycleController'
    | 'cameraController' | 'playerPresentationController' | 'playerHealthController'
    | 'gameFeelController' | 'getCurrentRankedRunTraceFrame' | 'rankedRunTraceRecorder'
    | 'refreshAroundIfNeededOrFromCache' | 'destroyPlayer' | 'shouldRespawnPlayer'
    | 'refreshAround' | 'liveObjectController' | 'worldStreamingController'
  >,
): OverworldRespawnController {
  return new OverworldRespawnController({
    getCheckpoint: () => host.assist?.safe.getCheckpoint() ?? host.respawnCheckpointController.getCheckpoint(),
    getCourseStartRoom: () => host.activeCourseRun
      ? host.coursePlaybackController.getCourseStartRoomRef(host.activeCourseRun.course, host.activeCourseRun.startRoomId) : null,
    getCurrentRoomCoordinates: () => host.currentRoomCoordinates,
    getRoomSnapshot: coordinates => host.getRoomSnapshotForCoordinates(coordinates),
    getPlayerEntities: () => host.getPlayerEntities(),
    clearTransientPlayerState: () => {
      host.combatController.clearAttackAnimation();
      host.externalLaunchGraceUntil = 0;
      host.physicsCadence?.reset();
      host.movementController.handleRespawnReset();
      host.combatController.destroyProjectiles();
    },
    focusRoom: coordinates => {
      host.currentRoomCoordinates = { ...coordinates };
      host.selectedCoordinates = { ...coordinates };
      host.updateSelectedSummary();
      host.shouldCenterCamera = true;
      setFocusedCoordinatesInUrl(coordinates);
    },
    prepareRoomArrival: (roomId) => finishRoomWarmupForArrival(host, roomId, 'spawn'),
    respawnPlayerToRoom: (room, entities) => host.playerLifecycleController.respawnPlayerToRoom(room, entities),
    presentRespawn: () => {
      host.cameraController.resetFollowAnchor();
      host.playerPresentationController.handleRespawned();
      host.playerHealthController.refillForSpawn();
      host.assist?.safe.grantProtection();
      host.gameFeelController.playerAvailable();
    },
    recordRespawn: reference => {
      const frame = host.getCurrentRankedRunTraceFrame();
      if (frame)
        host.rankedRunTraceRecorder.recordRespawn(frame, reference);
    },
    refreshAroundFromCache: coordinates => host.refreshAroundIfNeededOrFromCache(coordinates, { refreshLeaderboards: false }),
    destroyPlayer: () => host.destroyPlayer(),
    requestPlayerCreation: () => { host.shouldRespawnPlayer = true; },
    refreshAround: coordinates => host.refreshAround(coordinates, { forceChunkReload: true }),
    playRespawnSound: () => {
      if (host.gameFeelController.shouldPlayRespawnCue())
        playSfx('respawn');
    },
  });
}

export function createPlayerPresentationController(
  host: Pick<OverworldCompositionPorts,
    | 'playerAnimationState' | 'playerFacing' | 'playerWasGrounded'
    | 'playerLandAnimationUntil' | 'runtimeContext' | 'scene'
    | 'specialTilesController' | 'lastMovementInput' | 'quicksandController'
    | 'movementController' | 'playerPresentationGroundedOverride' | 'combatController'
    | 'fxController' | 'PLAYER_PICKUP_SENSOR_EXTRA_HEIGHT'
  >,
): OverworldPlayerPresentationController {
  const playerPresentationState: OverworldPlayerPresentationControllerState = {
    get animationState() {
      return host.playerAnimationState;
    },
    set animationState(value: DefaultPlayerAnimationState) {
      host.playerAnimationState = value;
    },
    get facing() {
      return host.playerFacing as -1 | 1;
    },
    set facing(value: -1 | 1) {
      host.playerFacing = value;
    },
    get wasGrounded() {
      return host.playerWasGrounded;
    },
    set wasGrounded(value: boolean) {
      host.playerWasGrounded = value;
    },
    get landAnimationUntil() {
      return host.playerLandAnimationUntil;
    },
    set landAnimationUntil(value: number) {
      host.playerLandAnimationUntil = value;
    },
  };
  return new OverworldPlayerPresentationController({
    runtime: host.runtimeContext,
    state: playerPresentationState,
    getCurrentTime: () => gameplayNow(host.scene),
    getSpecialTileEnvironment: () => host.specialTilesController.getPlayerEnvironment(),
    getLastMovementInput: () => host.lastMovementInput,
    getQuicksandVisualSink: () => host.quicksandController.getVisualSink(),
    getMovementPresentationState: () => host.movementController.getPresentationState(),
    getGroundedOverride: () => host.playerPresentationGroundedOverride,
    getCurrentAttackAnimation: (now) => host.combatController.getCurrentAttackAnimation(now),
    playLandingDustFx: (x, y, facing) => host.fxController?.playLandingDustFx(x, y, facing),
  }, {
    playerPickupSensorExtraHeight: host.PLAYER_PICKUP_SENSOR_EXTRA_HEIGHT,
    playerVisualFeetOffset: DEFAULT_PLAYER_VISUAL_FEET_OFFSET,
    landingAnimationMs: 120,
    facingVelocityThreshold: 8,
    jumpRiseVelocityThreshold: -10,
    crouchMoveVelocityThreshold: 8,
    runVelocityThreshold: 12,
  });
}

export function createMovementController(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'player' | 'playerBody'
    | 'specialTilesController' | 'playerFacing' | 'currentRoomCoordinates'
    | 'getRoomOrigin' | 'getRoomSnapshotViewForCoordinates' | 'isSolidTerrainAtWorldPoint'
    | 'externalLaunchGraceUntil' | 'isPvpArenaActive' | 'liveObjectController'
    | 'getArcadeBodyBounds' | 'gameplayKeyboard' | 'gamepadInput'
    | 'findOverlappingLadder' | 'fxController' | 'playerPresentationController'
    | 'PLAYER_WIDTH' | 'PLAYER_HEIGHT' | 'PLAYER_STANDING_HEIGHT'
    | 'PLAYER_CROUCH_HEIGHT' | 'PLAYER_PUSH_HEIGHT' | 'PLAYER_SPEED'
    | 'CRAWL_SPEED' | 'CRATE_PUSH_SPEED' | 'CRATE_PULL_SPEED'
    | 'CRATE_INTERACTION_MAX_GAP' | 'COYOTE_MS' | 'JUMP_BUFFER_MS'
    | 'WALL_JUMP_BUFFER_MS' | 'WALL_CONTACT_GRACE_MS' | 'JUMP_VELOCITY'
    | 'WALL_SLIDE_MAX_FALL_SPEED' | 'WALL_JUMP_VELOCITY_X' | 'WALL_JUMP_VELOCITY_Y'
    | 'WALL_JUMP_INPUT_LOCK_MS' | 'LADDER_CLIMB_SPEED' | 'QUICKSAND_MOVE_FACTOR'
    | 'QUICKSAND_JUMP_FACTOR' | 'WEAPON_KNOCKBACK_MS'
  >,
): OverworldMovementController {
  return new OverworldMovementController({
    getCurrentTime: () => gameplayNow(host.scene),
    getPlayer: () => host.player,
    getPlayerBody: () => host.playerBody,
    getSpecialTileEnvironment: () => host.specialTilesController.getPlayerEnvironment(),
    getPlayerFacing: () => host.playerFacing as -1 | 1,
    getCurrentRoomCoordinates: () => host.currentRoomCoordinates,
    getRoomOrigin: (coordinates) => host.getRoomOrigin(coordinates),
    getRoomSnapshotForCoordinates: (coordinates) => host.getRoomSnapshotViewForCoordinates(coordinates) as RoomSnapshot | null,
    isSolidTerrainAtWorldPoint: (room, worldX, worldY) => host.isSolidTerrainAtWorldPoint(room, worldX, worldY),
    getExternalLaunchGraceUntil: () => host.externalLaunchGraceUntil,
    getExternalGrounded: () => host.liveObjectController.isPlayerOnTriangle(),
    shouldForceFullBodyHitbox: () => host.isPvpArenaActive(),
    getPushableLiveObjectsInBounds: (bounds, paddingX, paddingY) => host.liveObjectController.getPushableLiveObjectsInBounds(bounds, paddingX, paddingY),
    getRuntimeSolidLiveObjectsInBounds: (bounds, paddingX, paddingY) => host.liveObjectController.getRuntimeSolidLiveObjectsInBounds(bounds, paddingX, paddingY),
    getArcadeBodyBounds: (body) => host.getArcadeBodyBounds(body),
    getKeyboardInput: () => host.gameplayKeyboard,
    getGamepadInput: () => host.gamepadInput,
    findOverlappingLadder: () => host.findOverlappingLadder(),
    playJumpDustFx: (x, y, facing) => host.fxController?.playJumpDustFx(x, y, facing),
    syncPlayerPickupSensor: () => host.playerPresentationController.syncPlayerPickupSensor(),
  }, {
    playerWidth: host.PLAYER_WIDTH,
    playerHeight: host.PLAYER_HEIGHT,
    playerStandingHeight: host.PLAYER_STANDING_HEIGHT,
    playerCrouchHeight: host.PLAYER_CROUCH_HEIGHT,
    playerPushHeight: host.PLAYER_PUSH_HEIGHT,
    playerSpeed: host.PLAYER_SPEED,
    crawlSpeed: host.CRAWL_SPEED,
    cratePushSpeed: host.CRATE_PUSH_SPEED,
    cratePullSpeed: host.CRATE_PULL_SPEED,
    crateInteractionMaxGap: host.CRATE_INTERACTION_MAX_GAP,
    coyoteMs: host.COYOTE_MS,
    jumpBufferMs: host.JUMP_BUFFER_MS,
    wallJumpBufferMs: host.WALL_JUMP_BUFFER_MS,
    wallContactGraceMs: host.WALL_CONTACT_GRACE_MS,
    jumpVelocity: host.JUMP_VELOCITY,
    wallSlideMaxFallSpeed: host.WALL_SLIDE_MAX_FALL_SPEED,
    wallJumpVelocityX: host.WALL_JUMP_VELOCITY_X,
    wallJumpVelocityY: host.WALL_JUMP_VELOCITY_Y,
    wallJumpInputLockMs: host.WALL_JUMP_INPUT_LOCK_MS,
    ladderClimbSpeed: host.LADDER_CLIMB_SPEED,
    quicksandMoveFactor: host.QUICKSAND_MOVE_FACTOR,
    quicksandJumpFactor: host.QUICKSAND_JUMP_FACTOR,
    weaponKnockbackMs: host.WEAPON_KNOCKBACK_MS,
  });
}

export function createCombatController(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'player' | 'playerBody'
    | 'playerFacing' | 'movementController' | 'liveObjectController'
    | 'loadedFullRoomsById' | 'attackPvpPeerInRect' | 'attackPvpPeerAtPoint'
    | 'isProjectileBlocked' | 'combatPresentationController' | 'fxController'
    | 'cameras' | 'publishPvpCombatAction' | 'PLAYER_STANDING_HEIGHT'
    | 'SWORD_COOLDOWN_MS' | 'SWORD_ATTACK_MS' | 'SWORD_ACTIVE_MS'
    | 'SWORD_HIT_LUNGE_VELOCITY' | 'DOWNWARD_SLASH_BOUNCE_VELOCITY' | 'GUN_COOLDOWN_MS'
    | 'GUN_ATTACK_MS' | 'GUN_RECOIL_VELOCITY' | 'PROJECTILE_SPEED'
    | 'PROJECTILE_LIFETIME_MS' | 'PLAYER_SPEED'
  >,
): OverworldCombatController {
  return new OverworldCombatController({
    getCurrentTime: () => gameplayNow(host.scene),
    getPlayer: () => host.player,
    getPlayerBody: () => host.playerBody,
    getPlayerFacing: () => host.playerFacing as -1 | 1,
    isPlayerCrouching: () => host.movementController.isCrouching(),
    attackEnemiesInRect: (attackRect, maxHits, hitKeys) => host.liveObjectController.attackEnemiesInRect(host.loadedFullRoomsById.values(), attackRect, maxHits, hitKeys),
    attackEnemyAtPoint: (worldX, worldY, radius) => host.liveObjectController.attackEnemyAtPoint(host.loadedFullRoomsById.values(), worldX, worldY, radius),
    attackPeerInRect: (attackRect, source) => host.attackPvpPeerInRect(attackRect, source),
    attackPeerAtPoint: (worldX, worldY, source) => host.attackPvpPeerAtPoint(worldX, worldY, source),
    isProjectileBlocked: (worldX, worldY) => host.isProjectileBlocked(worldX, worldY),
    applyWeaponKnockback: (velocityX) => host.movementController.applyWeaponKnockback(velocityX),
    presentCombatEvent: (event, options) => host.combatPresentationController.present(event, options),
    destroyPresentedProjectile: (projectile) => host.combatPresentationController.destroyProjectile(projectile),
    playBulletImpactFx: (x, y) => host.fxController?.playBulletImpactFx(x, y),
    playPeerHitFx: (x, y) => host.fxController?.playEnemyKillFx(x, y),
    shakeCamera: (durationMs, intensity) => {
      if (!prefersReducedMotion())
        host.cameras.main.shake(durationMs, intensity);
    },
    publishCombatAction: (event) => host.publishPvpCombatAction(event),
  }, {
    playerStandingHeight: host.PLAYER_STANDING_HEIGHT,
    swordCooldownMs: host.SWORD_COOLDOWN_MS,
    swordAttackMs: host.SWORD_ATTACK_MS,
    swordActiveMs: host.SWORD_ACTIVE_MS,
    swordMaxHitsPerSwing: 3,
    swordHitLungeVelocity: host.SWORD_HIT_LUNGE_VELOCITY,
    downwardSlashBounceVelocity: host.DOWNWARD_SLASH_BOUNCE_VELOCITY,
    gunCooldownMs: host.GUN_COOLDOWN_MS,
    gunAttackMs: host.GUN_ATTACK_MS,
    gunHitRadius: 5,
    gunRecoilVelocity: host.GUN_RECOIL_VELOCITY,
    projectileSpeed: host.PROJECTILE_SPEED,
    projectileLifetimeMs: host.PROJECTILE_LIFETIME_MS,
    playerSpeed: host.PLAYER_SPEED,
  });
}

export function createSessionResetController(
  host: Pick<OverworldCompositionPorts,
    | 'currentGoalRun' | 'activeCourseRun' | 'activeRoomRushRun'
    | 'isPvpMatchActive' | 'isPvpDamageActive' | 'assist'
    | 'playerHealthController' | 'combatController' | 'setActiveCourseRun'
    | 'goalRunController' | 'getCurrentRankedRunTraceFrame' | 'rankedRunTraceRecorder'
    | 'recordRoomRushDeath' | 'recordPvpSelfDeath' | 'player'
    | 'playerBody' | 'fxController' | 'gameFeelController'
    | 'respawnPlayerToCurrentRoom' | 'respawnCheckpointController' | 'respawnController'
    | 'objectiveController' | 'showTransientStatus' | 'getRoomSnapshotForCoordinates'
    | 'refreshLeaderboardForSelection' | 'roomRushModeController' | 'coursePlaybackController'
    | 'resetRoomChallengeState' | 'liveObjectController' | 'resetTransientPlayState'
    | 'redrawGoalMarkers'
  >,
): OverworldSessionResetController {
  return new OverworldSessionResetController({
    getCurrentGoalRun: () => host.currentGoalRun,
    getActiveCourseRun: () => host.activeCourseRun,
    getActiveRoomRushRun: () => host.activeRoomRushRun,
    hasActivePvpMatch: () => host.isPvpMatchActive(),
    isPvpDamageActive: () => host.isPvpDamageActive(),
    isAssistProtected: () => host.assist?.safe.isProtected() ?? false,
    tryAbsorbPlayerDamage: () => host.playerHealthController.absorbDamage(),
    onPlayerDeath: () => host.playerHealthController.die(),
    cancelPlayerAttack: () => host.combatController.clearAttackAnimation(),
    setActiveCourseRun: (runState) => {
      host.setActiveCourseRun(runState);
    },
    recordRunDeathLocation: () => {
      const run = host.goalRunController.getCurrentRun();
      if (host.activeCourseRun && host.activeCourseRun.result !== 'active')
        return;
      if (!host.activeCourseRun && (run?.result !== 'active' || run.qualificationState !== 'qualified'))
        return;
      const frame = host.getCurrentRankedRunTraceFrame();
      if (frame)
        host.rankedRunTraceRecorder.recordDeath(frame);
    },
    recordGoalRunDeath: () => {
      host.goalRunController.recordDeath();
    },
    recordExpandedRoomRunDeath: () => {
      recordExpandedRoomRunDeath(host.activeCourseRun);
    },
    recordRoomRushDeath: (reason) => host.recordRoomRushDeath(reason),
    recordPvpSelfDeath: (reason) => host.recordPvpSelfDeath(reason),
    playPlayerFailFx: () => {
      if (host.player && host.playerBody) {
        host.fxController?.playPlayerDeathFx(host.player.x, host.playerBody.bottom - 10);
      }
    },
    isPlayerDeathPending: () => host.gameFeelController.isDeathPending(),
    runDeathBeat: respawn => host.gameFeelController.deathBeat(respawn),
    respawnPlayerToCurrentRoom: () => host.respawnPlayerToCurrentRoom(),
    clearRespawnCheckpoints: () => {
      host.respawnCheckpointController.clear();
      host.respawnController.reset();
    },
    failCourseRun: (message) => host.objectiveController.failCourseRun(message),
    failGoalRun: (message) => host.objectiveController.failGoalRun(message),
    showTransientStatus: (message) => host.showTransientStatus(message),
    getRoomSnapshotForCoordinates: (coordinates) => host.getRoomSnapshotForCoordinates(coordinates),
    restartGoalRunForRoom: (room) => {
      host.objectiveController.restartGoalRunForRoom(room, 'respawn');
    },
    refreshLeaderboardForSelection: () => {
      void host.refreshLeaderboardForSelection();
    },
    abandonGoalRun: () => {
      host.goalRunController.abandonActiveRun();
    },
    abandonRoomRushRun: () => {
      host.roomRushModeController.abandonActiveRun();
    },
    finalizeActiveCourseRun: (result) => {
      void host.coursePlaybackController.finalizeActiveCourseRun(result);
    },
    clearActiveCourseRoomOverrides: () => {
      host.coursePlaybackController.clearActiveCourseRoomOverrides();
    },
    resetRoomChallengeState: (room) => host.resetRoomChallengeState(room),
    resetBossChallenges: alreadyResetRoomId => host.liveObjectController.resetBossChallenges(room => host.resetRoomChallengeState(room), alreadyResetRoomId),
    resetTransientPlayState: () => host.resetTransientPlayState(),
    resetGoalRunController: () => {
      host.goalRunController.reset();
    },
    resetRoomRushController: () => {
      host.roomRushModeController.resetRun();
    },
    redrawGoalMarkers: () => host.redrawGoalMarkers(),
  });
}
