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
import { loadWeeklyRoomRush } from '../../runs/weeklyRoomRushRepository';
import { WEEKLY_ROOM_RUSH_LIMIT_MS, type WeeklyRoomRushResponse } from '../../runs/weeklyRoomRush';
import { getActiveWorldId } from '../../worlds/clientContext';
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
  syncModeRuntime(): void;
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
    const result = this.runController.tick(delta);
    this.setMutationStatus(result, {
      renderHud: false,
    });
    if (result.terminalResult === 'completed') this.showResult(result.transientStatus);
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

    if (options.startRule === 'weekly') return this.startWeekly();

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

    if (runState.startRule === 'weekly') return this.startWeekly(runState.returnCoordinates);

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

  private async startWeekly(returnCoordinates = this.host.getSelectedCoordinates()): Promise<boolean> {
    if (getActiveWorldId()) { this.host.showTransientStatus('Weekly Room Rush takes place in Prime.'); return false; }
    try {
      const weekly = await loadWeeklyRoomRush();
      if (!weekly.pick?.available) { this.host.showTransientStatus(weekly.pick?.unavailableReason ?? 'This week’s Rush room has not been chosen yet.'); return false; }
      const startCoordinates = weekly.pick.coordinates;
      const refreshed = await this.host.refreshAround(startCoordinates, { forceChunkReload: true });
      if (refreshed === 'error') { this.host.showTransientStatus('Could not load the weekly start room. Please retry.'); return false; }
      return await this.startFromPreparedRoom({ difficulty: 'hard', startRule: 'weekly', startCoordinates,
        returnCoordinates, weekly, unavailableMessage: 'The weekly start room is unavailable.',
        afterStart: () => {
          this.host.setBrowseInspectZoom(this.host.getInspectZoom());
          this.host.renderHud();
        },
      });
    } catch (error) {
      this.host.showTransientStatus(error instanceof Error ? error.message : 'Weekly Room Rush could not load. Please retry.');
      return false;
    }
  }

  private async startFromPreparedRoom(options: {
    difficulty: RoomRushDifficulty;
    startRule: RoomRushStartRule;
    startCoordinates: RoomCoordinates;
    returnCoordinates: RoomCoordinates;
    unavailableMessage: string;
    afterStart(): void | Promise<void>;
    weekly?: WeeklyRoomRushResponse;
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

    const requestStartedAt = performance.now();
    const serverStart = await this.startOnServer(options.difficulty, options.startRule, options.startCoordinates,
      options.weekly?.period.weekKey, options.weekly?.pick?.roomVersion);
    if (options.startRule === 'weekly' && getAuthDebugState().authenticated && !serverStart) return false;
    if (options.weekly?.pick && startRoom.version !== options.weekly.pick.roomVersion) {
      this.host.showTransientStatus('The weekly start room changed. Reload this week’s Rush.');
      return false;
    }

    this.host.resetPlaySession();
    this.host.clearTouchGestureState();
    this.host.clearCurrentGoalRun();
    this.host.clearRoomGoalIntroState();
    this.host.syncScenePauseState();

    this.setMutationStatus(
      this.runController.startRun({
        runId: serverStart?.clientRunId ?? null,
        serverStartId: serverStart?.startId ?? null,
        serverStartedAt: serverStart?.startedAt ?? null,
        serverExpiresAt: serverStart?.expiresAt ?? null,
        eventWeek: serverStart?.eventWeek ?? options.weekly?.period.weekKey ?? null,
        timeLimitMs: options.weekly ? WEEKLY_ROOM_RUSH_LIMIT_MS : null,
        elapsedBeforePlayMs: options.weekly ? performance.now() - requestStartedAt : 0,
        difficulty: options.difficulty,
        startRule: options.startRule,
        startCoordinates: options.startCoordinates,
        returnCoordinates: options.returnCoordinates,
        startRoom,
        startExpandedRoomId: this.getRoomRushAreaId(startRoom),
      }),
    );

    this.enterPlayModeAt(options.startCoordinates);
    if (options.weekly) this.host.syncModeRuntime();
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
    eventWeek?: string,
    startRoomVersion?: number,
  ): Promise<RoomRushRunStartResponse | null> {
    if (!getAuthDebugState().authenticated) {
      return null;
    }

    try {
      return await createRunRepository().startRoomRushRun({
        difficulty,
        startRule,
        startCoordinates: { ...startCoordinates },
        ...(startRule === 'weekly' ? { eventWeek, startRoomVersion } : {}),
      });
    } catch (error) {
      console.warn('Failed to start server-backed Room Rush run.', error);
      this.host.showTransientStatus(startRule === 'weekly'
        ? error instanceof Error ? error.message : 'Weekly Rush could not start. Please retry.'
        : `${ROOM_RUSH_NAME} leaderboard save unavailable; starting local run.`);
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
