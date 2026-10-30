import { OverworldRoomRushModeController } from '../roomRushMode';
import { OverworldRoomRushResultController } from '../roomRushResults';
import type { OverworldCompositionPorts } from './ports';
import { MAX_ZOOM, MIN_ZOOM } from './settings';

export function createRoomRushResultController(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'mode' | 'returnToWorld'
    | 'showTransientStatus' | 'applyRoomRushResultOverviewCameraState' | 'worldStreamingController'
    | 'windowCenterCoordinates' | 'syncPresenceSubscriptions' | 'updateCameraBounds'
    | 'syncPreviewVisibility' | 'updateBackdrop' | 'redrawWorld'
    | 'renderHud' | 'getRoomOrigin'
  >,
): OverworldRoomRushResultController {
  return new OverworldRoomRushResultController(host.scene, {
    getMode: () => host.mode,
    returnToWorld: () => host.returnToWorld(),
    showTransientStatus: (message) => host.showTransientStatus(message),
    applyOverviewCameraState: (state) => host.applyRoomRushResultOverviewCameraState(state),
    refreshAround: (coordinates) => host.worldStreamingController.refreshAround(coordinates),
    setWindowCenterCoordinates: (coordinates) => {
      host.windowCenterCoordinates = { ...coordinates };
    },
    syncPresenceSubscriptions: () => host.syncPresenceSubscriptions(),
    updateCameraBounds: () => host.updateCameraBounds(),
    flushPendingPreviewTextureBuilds: () => host.worldStreamingController.flushPendingPreviewTextureBuilds(),
    syncPreviewVisibility: () => host.syncPreviewVisibility(),
    updateBackdrop: () => host.updateBackdrop(),
    redrawWorld: () => host.redrawWorld(),
    renderHud: () => host.renderHud(),
    getRoomOrigin: (coordinates) => host.getRoomOrigin(coordinates),
  }, {
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
  });
}

export function createRoomRushModeController(
  host: Pick<OverworldCompositionPorts,
    | 'mode' | 'cameraMode' | 'selectedCoordinates'
    | 'currentRoomCoordinates' | 'inspectZoom' | 'browseInspectZoom'
    | 'getFitZoomForRoom' | 'shouldCenterCamera' | 'shouldRespawnPlayer'
    | 'worldStreamingController' | 'refreshAround' | 'refreshAroundIfNeededOrFromCache'
    | 'getRoomSnapshotForCoordinates' | 'getExpandedRoomIdAt' | 'isMultiCellExpandedRoomAt'
    | 'sessionResetController' | 'clearTouchGestureState' | 'goalRunController'
    | 'clearRoomGoalIntroState' | 'syncScenePauseState' | 'runtimeController'
    | 'syncAppMode' | 'showTransientStatus' | 'renderHud'
    | 'roomRushResultController' | 'gameFeelController'
  >,
): OverworldRoomRushModeController {
  return new OverworldRoomRushModeController({
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
    setCurrentRoomCoordinates: (coordinates) => {
      host.currentRoomCoordinates = { ...coordinates };
    },
    getInspectZoom: () => host.inspectZoom,
    setInspectZoom: (zoom) => {
      host.inspectZoom = zoom;
    },
    setBrowseInspectZoom: (zoom) => {
      host.browseInspectZoom = zoom;
    },
    getFitZoomForRoom: () => host.getFitZoomForRoom(),
    setShouldCenterCamera: (value) => {
      host.shouldCenterCamera = value;
    },
    setShouldRespawnPlayer: (value) => {
      host.shouldRespawnPlayer = value;
    },
    isWithinLoadedRoomBounds: (coordinates) => host.worldStreamingController.isWithinLoadedRoomBounds(coordinates),
    refreshAround: (coordinates, options) => host.refreshAround(coordinates, options),
    refreshAroundIfNeededOrFromCache: (coordinates, options) => host.refreshAroundIfNeededOrFromCache(coordinates, options),
    getRoomSnapshotForCoordinates: (coordinates) => host.getRoomSnapshotForCoordinates(coordinates),
    getExpandedRoomIdAt: (coordinates) => host.getExpandedRoomIdAt(coordinates),
    isMultiCellExpandedRoomAt: (coordinates) => host.isMultiCellExpandedRoomAt(coordinates),
    resetPlaySession: () => {
      host.sessionResetController.resetPlaySession();
    },
    clearTouchGestureState: () => host.clearTouchGestureState(),
    clearCurrentGoalRun: () => {
      host.goalRunController.clearCurrentRun();
    },
    clearRoomGoalIntroState: () => host.clearRoomGoalIntroState(),
    syncScenePauseState: () => host.syncScenePauseState(),
    syncModeRuntime: () => host.runtimeController.syncModeRuntime(),
    syncAppMode: () => host.syncAppMode(),
    showTransientStatus: (message) => host.showTransientStatus(message),
    renderHud: () => host.renderHud(),
    isDeathPending: () => host.gameFeelController.isDeathPending(),
  }, host.roomRushResultController);
}
