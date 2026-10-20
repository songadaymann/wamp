import { getLostSongService } from '../../../lostSongs/service';
import { roomIdFromCoordinates } from '../../../persistence/roomModel';
import { getActiveWorldId } from '../../../worlds/clientContext';
import { OverworldBrowseOverlayController } from '../browseOverlays';
import { OverworldCameraController } from '../cameraController';
import { OverworldGoalMarkerController } from '../goalMarkers';
import { OverworldGridOverlayController } from '../gridOverlay';
import { OverworldHudStateController } from '../hudState';
import { OverworldInspectInputController } from '../inspectInput';
import { OverworldRoomCellController } from '../roomCells';
import { getBodyVelocityAlongVector, getGravityVector } from '../specialTiles';
import { OverworldViewportController } from '../viewportController';
import type { OverworldCompositionPorts } from './ports';
import {
  BUTTON_ZOOM_FACTOR,
  FOLLOW_CAMERA_LERP,
  MAX_ZOOM,
  MIN_ZOOM,
  MOBILE_PLAY_CAMERA_TARGET_Y,
  PLAY_ROOM_FIT_PADDING,
  WHEEL_ZOOM_SENSITIVITY,
} from './settings';

export function createGridOverlayController(host: Pick<OverworldCompositionPorts, 'scene' | 'worldWindow' | 'cameras' | 'getExpandedRoomIdAt'>): OverworldGridOverlayController {
  return new OverworldGridOverlayController({
    scene: host.scene,
    getWorldWindow: () => host.worldWindow,
    getZoom: () => host.cameras.main.zoom,
    getExpandedRoomIdAt: (coordinates) => host.getExpandedRoomIdAt(coordinates),
  });
}

export function createBrowseOverlayController(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'worldWindow' | 'mode'
    | 'selectedCoordinates' | 'cameras' | 'getRoomOrigin'
    | 'getCellStateAt' | 'roomSummariesById' | 'getRoomEditorCount'
    | 'isWithinLoadedRoomBounds' | 'canWarpToSelectedRoom' | 'playSelectedRoom'
    | 'warpToSelectedRoom' | 'truncateOverlayText'
  >,
): OverworldBrowseOverlayController {
  return new OverworldBrowseOverlayController({
    scene: host.scene,
    getWorldWindow: () => host.worldWindow,
    getMode: () => host.mode,
    getSelectedCoordinates: () => ({ ...host.selectedCoordinates }),
    getZoom: () => host.cameras.main.zoom,
    getRoomOrigin: (coordinates) => host.getRoomOrigin(coordinates),
    getCellStateAt: (coordinates) => host.getCellStateAt(coordinates),
    getRoomSummaryForCoordinates: (coordinates) => host.roomSummariesById.get(roomIdFromCoordinates(coordinates)) ?? null,
    getRoomEditorCount: (coordinates) => host.getRoomEditorCount(coordinates),
    isWithinLoadedRoomBounds: (coordinates) => host.isWithinLoadedRoomBounds(coordinates),
    canWarpToSelectedRoom: () => host.canWarpToSelectedRoom(),
    playSelectedRoom: () => { void host.playSelectedRoom(); },
    warpToSelectedRoom: () => {
      void host.warpToSelectedRoom();
    },
    truncateOverlayText: (value, maxLength) => host.truncateOverlayText(value, maxLength),
  });
}

export function createRoomCellController(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'worldWindow' | 'cameras'
    | 'getRoomOrigin' | 'getCellStateAt' | 'getRoomEditorCount'
    | 'currentRoomCoordinates' | 'selectedCoordinates' | 'mode'
    | 'isRoomInActiveCourse' | 'getExpandedRoomIdAt'
  >,
): OverworldRoomCellController {
  return new OverworldRoomCellController({
    scene: host.scene,
    getWorldWindow: () => host.worldWindow,
    getZoom: () => host.cameras.main.zoom,
    getRoomOrigin: (coordinates) => host.getRoomOrigin(coordinates),
    getCellStateAt: (coordinates) => host.getCellStateAt(coordinates),
    getRoomEditorCount: (coordinates) => host.getRoomEditorCount(coordinates),
    getCurrentRoomCoordinates: () => ({ ...host.currentRoomCoordinates }),
    getSelectedCoordinates: () => ({ ...host.selectedCoordinates }),
    getMode: () => host.mode,
    isRoomInActiveCourse: (coordinates) => host.isRoomInActiveCourse(coordinates),
    getExpandedRoomIdAt: (coordinates) => host.getExpandedRoomIdAt(coordinates),
    hasFoundLostSong: coordinates => !getActiveWorldId() && getLostSongService().hasFound(roomIdFromCoordinates(coordinates)),
  });
}

export function createGoalMarkerController(host: Pick<OverworldCompositionPorts, 'scene' | 'getRoomOrigin' | 'selectedCoordinates' | 'activeCourseSnapshot'>): OverworldGoalMarkerController {
  return new OverworldGoalMarkerController({
    scene: host.scene,
    getRoomOrigin: (coordinates) => host.getRoomOrigin(coordinates),
    getSelectedCoordinates: () => ({ ...host.selectedCoordinates }),
    getActiveCourseSnapshot: () => host.activeCourseSnapshot,
  });
}

export function createCameraController(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'getRoomSnapshotViewForCoordinates' | 'currentRoomCoordinates'
    | 'worldWindow' | 'mode' | 'cameraMode'
    | 'inspectZoom' | 'player' | 'playerBody'
    | 'physicsCadence' | 'specialTilesController' | 'getRoomOrigin'
    | 'renderHud' | 'mobilePortraitCameraTargetY'
  >,
): OverworldCameraController {
  return new OverworldCameraController({
    scene: host.scene,
    getCurrentRoom: () => host.getRoomSnapshotViewForCoordinates(host.currentRoomCoordinates),
    getWorldWindow: () => host.worldWindow,
    getMode: () => host.mode,
    getCameraMode: () => host.cameraMode,
    setCameraMode: (mode) => {
      host.cameraMode = mode;
    },
    getInspectZoom: () => host.inspectZoom,
    getPlayer: () => host.player,
    getPlayerBody: () => host.playerBody,
    isPlayerGrounded: () => Boolean(host.playerBody && host.physicsCadence?.getMovement().grounded
      && getBodyVelocityAlongVector(host.playerBody, getGravityVector(host.specialTilesController.getPlayerEnvironment().gravityDirection)) >= 0),
    getRoomOrigin: (coordinates) => host.getRoomOrigin(coordinates),
    renderHud: () => host.renderHud(),
  }, {
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    playRoomFitPadding: PLAY_ROOM_FIT_PADDING,
    followCameraLerp: FOLLOW_CAMERA_LERP,
    mobilePlayCameraTargetY: MOBILE_PLAY_CAMERA_TARGET_Y,
    getMobilePortraitPlayCameraTargetY: () => host.mobilePortraitCameraTargetY,
  });
}

export function createViewportController(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'cameraController' | 'mode'
    | 'cameraMode' | 'player' | 'inspectZoom'
    | 'browseInspectZoom' | 'getZoomFocusCoordinates' | 'centerCameraOnCoordinates'
    | 'startFollowCamera' | 'constrainInspectCamera' | 'refreshChunkWindowIfNeeded'
    | 'updateBackdrop' | 'roomCellController' | 'gridOverlayController'
    | 'renderHud' | 'selectedCoordinates' | 'currentRoomCoordinates'
    | 'measureMobilePerformance'
  >,
): OverworldViewportController {
  return new OverworldViewportController({
    scene: host.scene,
    isRoomCameraFixed: () => host.cameraController.isRoomCameraFixed(),
    getMode: () => host.mode,
    getCameraMode: () => host.cameraMode,
    getPlayer: () => host.player,
    getInspectZoom: () => host.inspectZoom,
    setInspectZoom: (zoom) => {
      host.inspectZoom = zoom;
    },
    getBrowseInspectZoom: () => host.browseInspectZoom,
    setBrowseInspectZoom: (zoom) => {
      host.browseInspectZoom = zoom;
    },
    getZoomFocusCoordinates: () => host.getZoomFocusCoordinates(),
    centerCameraOnCoordinates: (coordinates) => host.centerCameraOnCoordinates(coordinates),
    startFollowCamera: (camera) => host.startFollowCamera(camera),
    constrainInspectCamera: () => host.constrainInspectCamera(),
    refreshChunkWindowIfNeeded: (centerCoordinates) => host.refreshChunkWindowIfNeeded(centerCoordinates),
    updateBackdrop: () => host.updateBackdrop(),
    redrawWorldCells: () => host.roomCellController.redrawForZoom(),
    redrawGridOverlay: () => host.gridOverlayController.redraw(),
    renderHud: () => host.renderHud(),
    getSelectedCoordinates: () => ({ ...host.selectedCoordinates }),
    getCurrentRoomCoordinates: () => ({ ...host.currentRoomCoordinates }),
  }, {
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    buttonZoomFactor: BUTTON_ZOOM_FACTOR,
    wheelZoomSensitivity: WHEEL_ZOOM_SENSITIVITY,
    measurePerformance: (label, callback) => host.measureMobilePerformance(label, callback),
  });
}

export function createHudStateController(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'editorPlaytestReturnTarget' | 'mode' | 'selectedCoordinates'
    | 'getCellStateAt' | 'roomSummariesById' | 'draftRoomsById'
    | 'getRoomPopulation' | 'getRoomEditorCount' | 'getRoomEditorDisplayNames'
    | 'activeCourseRun' | 'activeRoomRushRun' | 'currentGoalRun'
    | 'getRoomSnapshotViewForCoordinates' | 'currentRoomLeaderboard' | 'getPvpPersistentStatusText'
    | 'goalRunController' | 'presenceController' | 'formatOnlineRosterRoomText'
    | 'isPvpMatchActive' | 'signController' | 'roomRepository'
    | 'profileRepository' | 'loadPublishedCourseSnapshot' | 'countRoomObjectsByCategory'
    | 'score' | 'roomCommentsController' | 'cameras'
    | 'getTransientStatusMessage' | 'hudBridge' | 'syncGoalOverlayScale'
  >,
): OverworldHudStateController {
  return new OverworldHudStateController({
    isActive: () => host.scene.scene.isActive(),
    isEditorPlaytest: () => Boolean(host.editorPlaytestReturnTarget?.clearCheck),
    getMode: () => host.mode,
    getSelectedCoordinates: () => ({ ...host.selectedCoordinates }),
    getCellStateAt: (coordinates) => host.getCellStateAt(coordinates),
    getRoomSummary: (roomId) => host.roomSummariesById.get(roomId),
    getDraftRoom: (roomId) => host.draftRoomsById.get(roomId) ?? null,
    getRoomPopulation: (coordinates) => host.getRoomPopulation(coordinates),
    getRoomEditorCount: (coordinates) => host.getRoomEditorCount(coordinates),
    getRoomEditorDisplayNames: (coordinates) => host.getRoomEditorDisplayNames(coordinates),
    getActiveCourseRun: () => host.activeCourseRun,
    getActiveRoomRushRun: () => host.activeRoomRushRun,
    getCurrentGoalRun: () => host.currentGoalRun,
    getRoomSnapshotForCoordinates: (coordinates) => host.getRoomSnapshotViewForCoordinates(coordinates),
    getCurrentRoomLeaderboard: () => host.currentRoomLeaderboard,
    getGoalPersistentStatusText: () => host.getPvpPersistentStatusText() ?? host.goalRunController.getPersistentStatusText() ?? null,
    getTotalPlayerCount: () => host.presenceController.getTotalPlayerCount(),
    getOnlineRosterEntries: () => {
      const identity = host.presenceController.getIdentity();
      const localGuest = !identity || identity.userId.startsWith('guest-');
      return host.presenceController.getOnlineRoster().map((entry) => ({
        key: entry.key,
        userId: entry.userId,
        displayName: entry.displayName,
        roomText: host.formatOnlineRosterRoomText(entry),
        roomCoordinates: entry.roomCoordinates,
        mode: entry.mode,
        isSelf: entry.isSelf,
        multiplayerInviteDisabled: entry.isSelf ||
          host.isPvpMatchActive() ||
          localGuest ||
          !entry.userId ||
          entry.userId.startsWith('guest-'),
      }));
    },
    getActiveSignState: () => host.signController.getActiveSign(),
    loadRoomOwnershipDetails: async (roomId, coordinates) => {
      const summary = await host.roomRepository.loadRoomSummary(roomId, coordinates);
      return {
        claimerUserId: summary.claimerUserId,
        isMinted: summary.mintedChainId !== null &&
          summary.mintedContractAddress !== null &&
          summary.mintedTokenId !== null,
        mintedOwnerWalletAddress: summary.mintedOwnerWalletAddress,
      };
    },
    loadPublicProfileSummary: async (userId) => {
      const profile = await host.profileRepository.loadProfileSummary(userId);
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
      return host.loadPublishedCourseSnapshot(courseId);
    },
    countRoomEnemies: (room) => host.countRoomObjectsByCategory(room, 'enemy'),
    getScore: () => host.score,
    areRoomCommentsVisible: () => host.roomCommentsController.areCommentsVisible(),
    getZoom: () => host.cameras.main.zoom,
    getTransientStatusMessage: () => host.getTransientStatusMessage(),
    renderHudViewModel: (viewModel) => {
      host.hudBridge?.render(viewModel);
    },
    syncOverlayScale: () => host.syncGoalOverlayScale(),
  });
}

export function createInspectInputController(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'cameraController' | 'mode'
    | 'cameraMode' | 'applyCameraMode' | 'fitLoadedWorld'
    | 'returnToWorld' | 'viewportController' | 'constrainInspectCamera'
    | 'getRoomCoordinatesForPoint' | 'isWithinLoadedRoomBounds' | 'selectRoomCoordinates'
    | 'syncBrowseWindowToCamera'
  >,
): OverworldInspectInputController {
  return new OverworldInspectInputController(host.scene, {
    isRoomCameraFixed: () => host.cameraController.isRoomCameraFixed(),
    getMode: () => host.mode,
    getCameraMode: () => host.cameraMode,
    setCameraMode: (mode) => {
      host.cameraMode = mode;
    },
    applyCameraMode: () => host.applyCameraMode(),
    fitLoadedWorld: () => host.fitLoadedWorld(),
    returnToWorld: () => host.returnToWorld(),
    adjustZoomByFactor: (factor, screenX, screenY) => host.viewportController.adjustZoomByFactor(factor, screenX, screenY),
    constrainInspectCamera: () => host.constrainInspectCamera(),
    getRoomCoordinatesForPoint: (x, y) => host.getRoomCoordinatesForPoint(x, y),
    isWithinLoadedRoomBounds: (coordinates) => host.isWithinLoadedRoomBounds(coordinates),
    onSelectCoordinates: (coordinates) => host.selectRoomCoordinates(coordinates),
    syncBrowseWindowToCamera: (panStartPointer, panCurrentPointer) => host.syncBrowseWindowToCamera(panStartPointer, panCurrentPointer),
  });
}
