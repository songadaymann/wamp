import { getAuthDebugState } from '../../auth/client';
import { expandedRoomIdFromStandaloneRoomId } from '../../expandedRooms/model';
import { setFocusedCoordinatesInUrl } from '../../navigation/worldNavigation';
import {
  DEFAULT_ROOM_COORDINATES,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../../persistence/roomModel';
import type { RoomRushRunStartResponse } from '../../runs/model';
import { createRunRepository } from '../../runs/runRepository';
import type { RoomRushOverworldCapture } from '../../social/roomRushShare';
import type { OverworldMode } from '../sceneData';
import type { CameraMode } from './camera';
import {
  OverworldRoomRushResultController,
} from './roomRushResults';
import {
  OverworldRoomRushRunController,
  ROOM_RUSH_NAME,
  type ActiveRoomRushRunState,
  type RoomRushDifficulty,
  type RoomRushMutationResult,
  type RoomRushStartRule,
} from './roomRushRuns';

type RoomRushRefreshOptions = {
  forceChunkReload?: boolean;
  preferCachedWindow?: boolean;
  refreshLeaderboards?: boolean;
};

export interface StartOverworldRoomRushRunOptions {
  difficulty: RoomRushDifficulty;
  startRule: RoomRushStartRule;
}

interface OverworldRoomRushModeHost {
  getMode(): OverworldMode;
  setMode(mode: OverworldMode): void;
  setCameraMode(mode: CameraMode): void;
  getSelectedCoordinates(): RoomCoordinates;
  setSelectedCoordinates(coordinates: RoomCoordinates): void;
  setCurrentRoomCoordinates(coordinates: RoomCoordinates): void;
  getInspectZoom(): number;
  setInspectZoom(zoom: number): void;
  setBrowseInspectZoom(zoom: number): void;
  getFitZoomForRoom(): number;
  setShouldCenterCamera(value: boolean): void;
  setShouldRespawnPlayer(value: boolean): void;
  isWithinLoadedRoomBounds(coordinates: RoomCoordinates): boolean;
  refreshAround(
    coordinates: RoomCoordinates,
    options?: RoomRushRefreshOptions,
  ): Promise<unknown>;
  refreshAroundIfNeededOrFromCache(
    coordinates: RoomCoordinates,
    options?: RoomRushRefreshOptions,
  ): void;
  getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null;
  getExpandedRoomIdAt(coordinates: RoomCoordinates): string | null;
  isMultiCellExpandedRoomAt(coordinates: RoomCoordinates): boolean;
  resetPlaySession(): void;
  clearTouchGestureState(): void;
  clearCurrentGoalRun(): void;
  clearRoomGoalIntroState(): void;
  syncScenePauseState(): void;
  syncAppMode(): void;
  showTransientStatus(message: string): void;
  renderHud(): void;
}

export class OverworldRoomRushModeController {
  private readonly runController = new OverworldRoomRushRunController();

  constructor(
    private readonly host: OverworldRoomRushModeHost,
    private readonly resultController: OverworldRoomRushResultController,
  ) {}

  reset(): void {
    this.runController.reset();
    this.resultController.reset();
  }

  resetRun(): void {
    this.runController.reset();
  }

  abandonActiveRun(): void {
    this.runController.abandonActiveRun();
  }

  getCurrentRun(): ActiveRoomRushRunState | null {
    return this.runController.getCurrentRun();
  }

  getDebugSnapshot(): ActiveRoomRushRunState | null {
    return this.runController.getDebugSnapshot();
  }

  getShareOverworldCapture(runState: ActiveRoomRushRunState): RoomRushOverworldCapture | null {
    return this.resultController.getOverworldCapture(runState);
  }

  tick(delta: number): void {
    this.setMutationStatus(this.runController.tick(delta), {
      renderHud: false,
    });
  }

  recordVisit(room: RoomSnapshot | null): void {
    this.setMutationStatus(
      this.runController.recordRoomVisit(room, this.getRoomRushAreaId(room)),
    );
  }

  recordDeath(reason: string): boolean {
    const result = this.runController.recordDeath(reason);
    this.setMutationStatus(result);
    if (result.terminalResult === 'failed') {
      this.showResult(result.transientStatus);
    }
    return result.terminalResult === 'failed';
  }

  async start(options: StartOverworldRoomRushRunOptions): Promise<boolean> {
    if (this.getCurrentRun()) {
      this.end();
      return true;
    }

    if (this.host.getMode() === 'play') {
      this.host.showTransientStatus(`${ROOM_RUSH_NAME} starts from the overworld.`);
      return false;
    }

    const startCoordinates =
      options.startRule === 'origin'
        ? { ...DEFAULT_ROOM_COORDINATES }
        : this.host.getSelectedCoordinates();
    const returnCoordinates = this.host.getSelectedCoordinates();

    if (
      options.startRule === 'origin' &&
      !this.host.isWithinLoadedRoomBounds(startCoordinates)
    ) {
      const refreshed = await this.host.refreshAround(startCoordinates);
      if (!refreshed) {
        this.host.showTransientStatus(`Could not load origin room for ${ROOM_RUSH_NAME}.`);
        return false;
      }
    }

    return this.startFromPreparedRoom({
      difficulty: options.difficulty,
      startRule: options.startRule,
      startCoordinates,
      returnCoordinates,
      unavailableMessage: `${ROOM_RUSH_NAME} starts on available rooms only.`,
      afterStart: () => {
        this.host.setBrowseInspectZoom(this.host.getInspectZoom());
        this.host.refreshAroundIfNeededOrFromCache(startCoordinates, {
          preferCachedWindow: true,
          refreshLeaderboards: false,
        });
      },
    });
  }

  async restart(): Promise<boolean> {
    const runState = this.getDebugSnapshot();
    if (!runState || runState.result !== 'active' || this.host.getMode() !== 'play') {
      return false;
    }

    const startCoordinates = { ...runState.startCoordinates };
    const returnCoordinates = { ...runState.returnCoordinates };
    if (!this.host.isWithinLoadedRoomBounds(startCoordinates)) {
      const refreshed = await this.host.refreshAround(startCoordinates);
      if (!refreshed) {
        this.host.showTransientStatus(`Could not reload ${ROOM_RUSH_NAME} start room.`);
        return false;
      }
    }

    return this.startFromPreparedRoom({
      difficulty: runState.difficulty,
      startRule: runState.startRule,
      startCoordinates,
      returnCoordinates,
      unavailableMessage: `${ROOM_RUSH_NAME} start room is unavailable.`,
      afterStart: async () => {
        await this.host.refreshAround(startCoordinates, { forceChunkReload: true });
        this.host.renderHud();
      },
    });
  }

  end(): void {
    if (!this.getCurrentRun()) {
      return;
    }

    const result = this.runController.completeActiveRun();
    const finalStatus = result.transientStatus;
    this.setMutationStatus(result);
    this.showResult(finalStatus);
  }

  isActive(): boolean {
    return Boolean(this.getCurrentRun());
  }

  private async startFromPreparedRoom(options: {
    difficulty: RoomRushDifficulty;
    startRule: RoomRushStartRule;
    startCoordinates: RoomCoordinates;
    returnCoordinates: RoomCoordinates;
    unavailableMessage: string;
    afterStart(): void | Promise<void>;
  }): Promise<boolean> {
    const startRoom = this.host.getRoomSnapshotForCoordinates(options.startCoordinates);
    if (!startRoom || startRoom.status !== 'published') {
      this.host.showTransientStatus(options.unavailableMessage);
      return false;
    }
    if (this.host.isMultiCellExpandedRoomAt(options.startCoordinates)) {
      this.host.showTransientStatus(`${ROOM_RUSH_NAME} starts from standalone rooms only.`);
      return false;
    }

    this.host.resetPlaySession();
    this.host.clearTouchGestureState();
    this.host.clearCurrentGoalRun();
    this.host.clearRoomGoalIntroState();
    this.host.syncScenePauseState();

    const serverStart = await this.startOnServer(
      options.difficulty,
      options.startRule,
      options.startCoordinates,
    );
    this.setMutationStatus(
      this.runController.startRun({
        runId: serverStart?.clientRunId ?? null,
        serverStartId: serverStart?.startId ?? null,
        serverStartedAt: serverStart?.startedAt ?? null,
        serverExpiresAt: serverStart?.expiresAt ?? null,
        difficulty: options.difficulty,
        startRule: options.startRule,
        startCoordinates: options.startCoordinates,
        returnCoordinates: options.returnCoordinates,
        startRoom,
        startExpandedRoomId: this.getRoomRushAreaId(startRoom),
      }),
    );

    this.enterPlayModeAt(options.startCoordinates);
    await options.afterStart();
    return true;
  }

  private enterPlayModeAt(startCoordinates: RoomCoordinates): void {
    this.host.setMode('play');
    this.host.setCameraMode('follow');
    this.host.setInspectZoom(this.host.getFitZoomForRoom());
    this.host.syncAppMode();
    this.host.setCurrentRoomCoordinates(startCoordinates);
    this.host.setSelectedCoordinates(startCoordinates);
    this.host.setShouldCenterCamera(true);
    this.host.setShouldRespawnPlayer(true);
    setFocusedCoordinatesInUrl(startCoordinates);
  }

  private async startOnServer(
    difficulty: RoomRushDifficulty,
    startRule: RoomRushStartRule,
    startCoordinates: RoomCoordinates,
  ): Promise<RoomRushRunStartResponse | null> {
    if (!getAuthDebugState().authenticated) {
      return null;
    }

    try {
      return await createRunRepository().startRoomRushRun({
        difficulty,
        startRule,
        startCoordinates: { ...startCoordinates },
      });
    } catch (error) {
      console.warn('Failed to start server-backed Room Rush run.', error);
      this.host.showTransientStatus(`${ROOM_RUSH_NAME} leaderboard save unavailable; starting local run.`);
      return null;
    }
  }

  private setMutationStatus(
    result: RoomRushMutationResult,
    options: { renderHud?: boolean } = {},
  ): void {
    if (!result.changed) {
      return;
    }

    if (result.transientStatus) {
      this.host.showTransientStatus(result.transientStatus);
    }

    if (options.renderHud !== false) {
      this.host.renderHud();
    }
  }

  private showResult(finalStatus: string | null): void {
    this.resultController.showResult(
      this.runController.getDebugSnapshot(),
      finalStatus,
    );
  }

  private getRoomRushAreaId(room: RoomSnapshot | null): string | null {
    if (!room) {
      return null;
    }

    return (
      this.host.getExpandedRoomIdAt(room.coordinates) ??
      expandedRoomIdFromStandaloneRoomId(room.id)
    );
  }
}
