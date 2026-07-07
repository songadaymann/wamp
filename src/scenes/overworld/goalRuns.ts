import type { GameObjectConfig } from '../../config';
import { cloneRoomGoal, ROOM_GOAL_LABELS, type GoalMarkerPoint } from '../../goals/roomGoals';
import type { RoomCoordinates, RoomSnapshot } from '../../persistence/roomModel';
import {
  isWampLeaderboardEligibleAuth,
  type SurfaceAuthSource,
} from '../../generatedUsers/leaderboardPolicy';
import type {
  GlobalLeaderboardResponse,
  RoomLeaderboardResponse,
  RunFinishRequestBody,
  RunResult,
} from '../../runs/model';
import { isRunApiError, type RunRepository } from '../../runs/runRepository';
import { computeRunScore } from '../../runs/scoring';
import {
  goalRunEntryStartsQualifiedAttempt,
  playerTouchesGoalRunStartPoint,
  resolveGoalRunStartPoint,
  type GoalRunEntryContext,
  type GoalRunStartPoint,
} from './goalRunStartGate';
import { suggestProgressionDifficulty } from '../../progression/autoDifficulty';
import {
  requestPostRunGuestClaim,
  requestPostRunRating,
} from '../../progression/postRunRatingEvents';
import {
  buildLeaderboardRankRewardStings,
  createPostRunClearReward,
  notifyRewardStings,
} from '../../progression/rewardStings';
import type { RankedRunVerificationTrace } from '../../runs/verificationTrace';

export type GoalRunLeaderboardState = 'idle' | 'loading' | 'ready' | 'error';
export type GoalRunMutationEvent = 'start' | 'checkpoint' | 'complete' | 'fail' | 'abandon';
export type GoalRunQualificationState = 'practice' | 'qualified';

export interface GoalRunState {
  roomId: string;
  roomCoordinates: RoomCoordinates;
  roomVersion: number;
  roomStatus: RoomSnapshot['status'];
  goal: NonNullable<RoomSnapshot['goal']>;
  qualificationState: GoalRunQualificationState;
  rankedStartPoint: GoalRunStartPoint;
  elapsedMs: number;
  deaths: number;
  collectiblesCollected: number;
  enemyCollectiblesCollected: number;
  collectibleTarget: number | null;
  enemiesDefeated: number;
  enemyTarget: number | null;
  checkpointsReached: number;
  checkpointTarget: number | null;
  nextCheckpointIndex: number;
  result: 'active' | 'completed' | 'failed';
  completionMessage: string | null;
  attemptId: string | null;
  submissionState: 'waiting' | 'local-only' | 'starting' | 'active' | 'finishing' | 'submitted' | 'error';
  submissionMessage: string | null;
  pendingResult: Exclude<RunResult, 'active'> | null;
  submittedScore: number | null;
  leaderboardEligible: boolean;
  verificationSchemaVersion: number | null;
  verificationNonce: string | null;
  snapshotHash: string | null;
}

export interface GoalRunMutationResult {
  changed: boolean;
  goalMarkersChanged: boolean;
  resetChallengeState: boolean;
  transientStatus: string | null;
  event: GoalRunMutationEvent | null;
}

export interface OverworldGoalRunSnapshot {
  goalRun: GoalRunState | null;
  leaderboards: {
    state: GoalRunLeaderboardState;
    message: string | null;
    room: RoomLeaderboardResponse | null;
    global: GlobalLeaderboardResponse | null;
  };
}

interface OverworldGoalRunControllerOptions {
  playerHeight: number;
  runRepository: RunRepository;
  getScore: () => number;
  getAuthenticated: () => boolean;
  getAuthSource: () => SurfaceAuthSource;
  getAuthDisplayName: () => string | null;
  showTransientStatus?: (message: string) => void;
  countRoomObjectsByCategory: (
    room: RoomSnapshot,
    category: GameObjectConfig['category']
  ) => number;
  getNowIso?: () => string;
  onRankedRunStarted?: (binding: {
    kind: 'room';
    verificationSchemaVersion: number;
    verificationNonce: string;
    snapshotHash: string;
  }) => void;
  buildVerificationTrace?: (
    runState: GoalRunState,
    result: Exclude<RunResult, 'active'>
  ) => RankedRunVerificationTrace | null;
  clearVerificationTrace?: () => void;
}

const NOOP_MUTATION_RESULT: GoalRunMutationResult = {
  changed: false,
  goalMarkersChanged: false,
  resetChallengeState: false,
  transientStatus: null,
  event: null,
};

export class OverworldGoalRunController {
  private currentGoalRun: GoalRunState | null = null;
  private currentRoomLeaderboard: RoomLeaderboardResponse | null = null;
  private globalLeaderboard: GlobalLeaderboardResponse | null = null;
  private leaderboardState: GoalRunLeaderboardState = 'idle';
  private leaderboardMessage: string | null = null;
  private leaderboardRequestKey: string | null = null;
  private readonly promptedPostRunRatingKeys = new Set<string>();

  constructor(private readonly options: OverworldGoalRunControllerOptions) {}

  reset(): void {
    this.currentGoalRun = null;
    this.currentRoomLeaderboard = null;
    this.globalLeaderboard = null;
    this.leaderboardState = 'idle';
    this.leaderboardMessage = null;
    this.leaderboardRequestKey = null;
    this.options.clearVerificationTrace?.();
  }

  clearCurrentRun(): boolean {
    if (!this.currentGoalRun) {
      return false;
    }

    this.currentGoalRun = null;
    this.options.clearVerificationTrace?.();
    return true;
  }

  getCurrentRun(): GoalRunState | null {
    return this.currentGoalRun;
  }

  getCurrentRoomLeaderboard(): RoomLeaderboardResponse | null {
    return this.currentRoomLeaderboard;
  }

  getGlobalLeaderboard(): GlobalLeaderboardResponse | null {
    return this.globalLeaderboard;
  }

  getLeaderboardState(): GoalRunLeaderboardState {
    return this.leaderboardState;
  }

  getLeaderboardMessage(): string | null {
    return this.leaderboardMessage;
  }

  syncRunForRoom(
    room: RoomSnapshot | null,
    entryContext: GoalRunEntryContext = 'transition'
  ): GoalRunMutationResult {
    if (!room || !room.goal) {
      return this.clearRunForRoomExit();
    }

    if (this.currentGoalRun && this.runMatchesRoom(this.currentGoalRun, room)) {
      return NOOP_MUTATION_RESULT;
    }

    this.clearRunForRoomExit();
    const leaderboardEligible =
      room.status === 'published' &&
      isWampLeaderboardEligibleAuth(
        this.options.getAuthenticated(),
        this.options.getAuthSource(),
        this.options.getAuthDisplayName()
      );
    const qualificationState = goalRunEntryStartsQualifiedAttempt(entryContext)
      ? 'qualified'
      : 'practice';

    this.currentGoalRun = {
      roomId: room.id,
      roomCoordinates: { ...room.coordinates },
      roomVersion: room.version,
      roomStatus: room.status,
      goal: cloneRoomGoal(room.goal)!,
      qualificationState,
      rankedStartPoint: resolveGoalRunStartPoint(room, this.options.playerHeight),
      elapsedMs: 0,
      deaths: 0,
      collectiblesCollected: 0,
      enemyCollectiblesCollected: 0,
      collectibleTarget:
        room.goal.type === 'collect_target'
          ? room.goal.requiredCount
          : room.goal.type === 'collect_race'
            ? this.options.countRoomObjectsByCategory(room, 'collectible')
            : null,
      enemiesDefeated: 0,
      enemyTarget:
        room.goal.type === 'defeat_all'
          ? this.options.countRoomObjectsByCategory(room, 'enemy')
          : null,
      checkpointsReached: 0,
      checkpointTarget:
        room.goal.type === 'checkpoint_sprint' ? room.goal.checkpoints.length : null,
      nextCheckpointIndex: 0,
      result: 'active',
      completionMessage: null,
      attemptId: null,
      submissionState:
        qualificationState === 'practice'
          ? 'waiting'
          : leaderboardEligible
            ? 'starting'
            : 'local-only',
      submissionMessage:
        qualificationState === 'practice'
          ? this.getPracticeStatusMessage(room.status, leaderboardEligible)
          : this.getQualifiedSubmissionMessage(room.status, leaderboardEligible),
      pendingResult: null,
      submittedScore: null,
      leaderboardEligible,
      verificationSchemaVersion: null,
      verificationNonce: null,
      snapshotHash: null,
    };

    if (qualificationState === 'practice') {
      return {
        changed: true,
        goalMarkersChanged: true,
        resetChallengeState: false,
        transientStatus: this.currentGoalRun.submissionMessage,
        event: null,
      };
    }

    return this.activateQualifiedRun(this.currentGoalRun, false);
  }

  tick(delta: number): GoalRunMutationResult {
    if (
      !this.currentGoalRun ||
      this.currentGoalRun.result !== 'active' ||
      this.currentGoalRun.qualificationState !== 'qualified'
    ) {
      return NOOP_MUTATION_RESULT;
    }

    this.currentGoalRun.elapsedMs += delta;

    if (
      this.currentGoalRun.goal.type === 'collect_race' &&
      this.currentGoalRun.goal.timeLimitMs !== null &&
      this.currentGoalRun.elapsedMs >= this.currentGoalRun.goal.timeLimitMs
    ) {
      return this.resolveCollectRace('Time up.');
    }

    if (this.goalTimeLimitReached(this.currentGoalRun)) {
      return this.markFailed('Time up.');
    }

    if (
      this.currentGoalRun.goal.type === 'survival' &&
      this.currentGoalRun.elapsedMs >= this.currentGoalRun.goal.durationMs
    ) {
      return this.markCompleted('Survival clear.');
    }

    return NOOP_MUTATION_RESULT;
  }

  recordDeath(): void {
    if (
      this.currentGoalRun &&
      this.currentGoalRun.result === 'active' &&
      this.currentGoalRun.qualificationState === 'qualified'
    ) {
      this.currentGoalRun.deaths += 1;
    }
  }

  restartRunForRoom(
    room: RoomSnapshot | null,
    entryContext: GoalRunEntryContext = 'spawn'
  ): GoalRunMutationResult {
    this.currentGoalRun = null;
    return this.syncRunForRoom(room, entryContext);
  }

  qualifyPracticeRunAt(playerFeet: GoalMarkerPoint): GoalRunMutationResult {
    if (
      !this.currentGoalRun ||
      this.currentGoalRun.result !== 'active' ||
      this.currentGoalRun.qualificationState !== 'practice'
    ) {
      return NOOP_MUTATION_RESULT;
    }

    if (!playerTouchesGoalRunStartPoint(playerFeet, this.currentGoalRun.rankedStartPoint)) {
      return NOOP_MUTATION_RESULT;
    }

    return this.activateQualifiedRun(this.currentGoalRun, true);
  }

  recordEnemyDefeated(roomId: string, enemyName: string): GoalRunMutationResult {
    if (
      !this.currentGoalRun ||
      this.currentGoalRun.result !== 'active' ||
      this.currentGoalRun.qualificationState !== 'qualified' ||
      (this.currentGoalRun.goal.type !== 'defeat_all' &&
        this.currentGoalRun.goal.type !== 'survival') ||
      this.currentGoalRun.roomId !== roomId
    ) {
      return NOOP_MUTATION_RESULT;
    }

    this.currentGoalRun.enemiesDefeated += 1;
    if (
      this.currentGoalRun.enemyTarget !== null &&
      this.currentGoalRun.enemiesDefeated >= this.currentGoalRun.enemyTarget
    ) {
      return this.markCompleted('All enemies defeated.');
    }

    return {
      changed: true,
      goalMarkersChanged: false,
      resetChallengeState: false,
      transientStatus: this.currentGoalRun.goal.type === 'defeat_all'
        ? `${enemyName} defeated.`
        : null,
      event: null,
    };
  }

  recordCollectibleCollected(roomId: string): GoalRunMutationResult {
    if (
      !this.currentGoalRun ||
      this.currentGoalRun.result !== 'active' ||
      this.currentGoalRun.qualificationState !== 'qualified' ||
      (this.currentGoalRun.goal.type !== 'collect_target' &&
        this.currentGoalRun.goal.type !== 'collect_race' &&
        this.currentGoalRun.goal.type !== 'survival') ||
      this.currentGoalRun.roomId !== roomId
    ) {
      return NOOP_MUTATION_RESULT;
    }

    this.currentGoalRun.collectiblesCollected += 1;
    if (
      this.currentGoalRun.goal.type === 'collect_target' &&
      this.currentGoalRun.collectiblesCollected >= this.currentGoalRun.goal.requiredCount
    ) {
      return this.markCompleted('Collection target reached.');
    }

    if (this.currentGoalRun.goal.type === 'collect_race' && this.collectRaceGoalExhausted(this.currentGoalRun)) {
      return this.resolveCollectRace('All collectibles claimed.');
    }

    return {
      changed: true,
      goalMarkersChanged: false,
      resetChallengeState: false,
      transientStatus: null,
      event: null,
    };
  }

  recordEnemyCollectibleCollected(roomId: string): GoalRunMutationResult {
    if (
      !this.currentGoalRun ||
      this.currentGoalRun.result !== 'active' ||
      this.currentGoalRun.qualificationState !== 'qualified' ||
      this.currentGoalRun.goal.type !== 'collect_race' ||
      this.currentGoalRun.roomId !== roomId
    ) {
      return NOOP_MUTATION_RESULT;
    }

    this.currentGoalRun.enemyCollectiblesCollected += 1;
    if (this.collectRaceGoalExhausted(this.currentGoalRun)) {
      return this.resolveCollectRace('All collectibles claimed.');
    }

    return {
      changed: true,
      goalMarkersChanged: false,
      resetChallengeState: false,
      transientStatus: null,
      event: null,
    };
  }

  recordCheckpointReached(): GoalRunMutationResult {
    if (
      !this.currentGoalRun ||
      this.currentGoalRun.result !== 'active' ||
      this.currentGoalRun.qualificationState !== 'qualified' ||
      this.currentGoalRun.goal.type !== 'checkpoint_sprint'
    ) {
      return NOOP_MUTATION_RESULT;
    }

    this.currentGoalRun.nextCheckpointIndex += 1;
    this.currentGoalRun.checkpointsReached = this.currentGoalRun.nextCheckpointIndex;
    return {
      changed: true,
      goalMarkersChanged: true,
      resetChallengeState: false,
      transientStatus: `Checkpoint ${this.currentGoalRun.checkpointsReached} reached.`,
      event: 'checkpoint',
    };
  }

  markCompleted(message: string): GoalRunMutationResult {
    if (
      !this.currentGoalRun ||
      this.currentGoalRun.result !== 'active' ||
      this.currentGoalRun.qualificationState !== 'qualified'
    ) {
      return NOOP_MUTATION_RESULT;
    }

    const runState = this.currentGoalRun;
    runState.result = 'completed';
    runState.completionMessage = message;
    runState.pendingResult = 'completed';
    this.maybeSubmitGoalRunResult(runState);
    this.maybePromptGuestClaimForLocalClear(runState);
    return {
      changed: true,
      goalMarkersChanged: true,
      resetChallengeState: false,
      transientStatus: message,
      event: 'complete',
    };
  }

  markFailed(message: string): GoalRunMutationResult {
    if (
      !this.currentGoalRun ||
      this.currentGoalRun.result !== 'active' ||
      this.currentGoalRun.qualificationState !== 'qualified'
    ) {
      return NOOP_MUTATION_RESULT;
    }

    this.currentGoalRun.result = 'failed';
    this.currentGoalRun.completionMessage = message;
    this.currentGoalRun.pendingResult = 'failed';
    this.maybeSubmitGoalRunResult(this.currentGoalRun);
    return {
      changed: true,
      goalMarkersChanged: true,
      resetChallengeState: false,
      transientStatus: message,
      event: 'fail',
    };
  }

  abandonActiveRun(message: string = 'Run abandoned.'): GoalRunMutationResult {
    if (!this.currentGoalRun || this.currentGoalRun.result !== 'active') {
      return NOOP_MUTATION_RESULT;
    }

    this.currentGoalRun.completionMessage = message;
    this.currentGoalRun.pendingResult = 'abandoned';
    this.maybeSubmitGoalRunResult(this.currentGoalRun);
    return {
      changed: true,
      goalMarkersChanged: true,
      resetChallengeState: false,
      transientStatus: message,
      event: 'abandon',
    };
  }

  async refreshLeaderboardsForRoom(targetRoom: RoomSnapshot | null): Promise<void> {
    if (!targetRoom || targetRoom.status !== 'published' || !targetRoom.goal) {
      this.currentRoomLeaderboard = null;
      this.globalLeaderboard = null;
      this.leaderboardState = 'idle';
      this.leaderboardMessage = targetRoom?.status === 'draft'
        ? 'Draft room runs stay local.'
        : targetRoom?.goal
          ? 'Leaderboard unavailable for this room.'
          : 'No room goal leaderboard here.';
      return;
    }

    const requestKey = `${targetRoom.id}:${targetRoom.version}`;
    if (this.leaderboardState === 'loading' && this.leaderboardRequestKey === requestKey) {
      return;
    }

    this.leaderboardState = 'loading';
    this.leaderboardRequestKey = requestKey;
    this.leaderboardMessage = 'Loading leaderboard...';

    try {
      const [roomLeaderboard, globalLeaderboard] = await Promise.all([
        this.options.runRepository.loadRoomLeaderboard(
          targetRoom.id,
          targetRoom.coordinates,
          targetRoom.version,
          5
        ),
        this.options.runRepository.loadGlobalLeaderboard(5),
      ]);

      if (this.leaderboardRequestKey !== requestKey) {
        return;
      }

      this.currentRoomLeaderboard = roomLeaderboard;
      this.globalLeaderboard = globalLeaderboard;
      this.leaderboardState = 'ready';
      this.leaderboardMessage = roomLeaderboard.entries.length
        ? 'Leaderboard ready.'
        : 'No ranked clears yet.';
    } catch (error) {
      console.error('Failed to load leaderboards', error);
      if (this.leaderboardRequestKey !== requestKey) {
        return;
      }

      this.currentRoomLeaderboard = null;
      this.globalLeaderboard = null;
      this.leaderboardState = 'error';
      this.leaderboardMessage = 'Leaderboard unavailable.';
    }
  }

  getGoalStatusText(): string | null {
    const runState = this.currentGoalRun;
    if (!runState) {
      return null;
    }

    const elapsedSeconds = (runState.elapsedMs / 1000).toFixed(1);
    const countdownText = this.getGoalCountdownText(runState);
    const submissionSuffix = this.getGoalSubmissionStatusText(runState);
    switch (runState.goal.type) {
      case 'reach_exit':
        return `goal ${ROOM_GOAL_LABELS[runState.goal.type]} · ${countdownText ?? `${elapsedSeconds}s`} · deaths ${runState.deaths}${submissionSuffix}`;
      case 'collect_target':
        return `goal ${runState.collectiblesCollected}/${runState.goal.requiredCount} collected · ${countdownText ?? `${elapsedSeconds}s`}${submissionSuffix}`;
      case 'collect_race':
        return `goal race · you ${runState.collectiblesCollected} · hunter ${runState.enemyCollectiblesCollected} · ${countdownText ?? `${elapsedSeconds}s`}${submissionSuffix}`;
      case 'defeat_all':
        return `goal ${runState.enemiesDefeated}/${runState.enemyTarget ?? 0} defeated · ${countdownText ?? `${elapsedSeconds}s`}${submissionSuffix}`;
      case 'checkpoint_sprint':
        return `goal ${runState.checkpointsReached}/${runState.checkpointTarget ?? 0} checkpoints · ${countdownText ?? `${elapsedSeconds}s`}${submissionSuffix}`;
      case 'survival': {
        const remaining = Math.max(0, runState.goal.durationMs - runState.elapsedMs);
        const parts = [`goal survive ${(remaining / 1000).toFixed(1)}s`];
        if (runState.collectiblesCollected > 0) {
          parts.push(
            `${runState.collectiblesCollected} item${runState.collectiblesCollected === 1 ? '' : 's'}`
          );
        }
        if (runState.enemiesDefeated > 0) {
          parts.push(
            `${runState.enemiesDefeated} enem${runState.enemiesDefeated === 1 ? 'y' : 'ies'}`
          );
        }
        if (runState.deaths > 0) {
          parts.push(`deaths ${runState.deaths}`);
        }
        return `${parts.join(' · ')}${submissionSuffix}`;
      }
    }
  }

  private getGoalCountdownText(runState: GoalRunState): string | null {
    if (runState.goal.type === 'survival') {
      return null;
    }

    if (runState.goal.timeLimitMs === null) {
      return null;
    }

    const remainingMs = Math.max(0, runState.goal.timeLimitMs - runState.elapsedMs);
    return `${(remainingMs / 1000).toFixed(1)}s left`;
  }

  getLeaderboardSummaryText(): string | null {
    if (this.currentGoalRun?.qualificationState === 'practice') {
      return this.currentGoalRun.submissionMessage;
    }

    if (this.currentGoalRun?.leaderboardEligible === false && this.currentGoalRun?.submissionState === 'local-only') {
      return this.currentGoalRun.submissionMessage;
    }

    if (this.leaderboardState === 'loading') {
      return this.leaderboardMessage;
    }

    const roomTop = this.currentRoomLeaderboard?.entries[0] ?? null;
    const globalTop = this.globalLeaderboard?.entries[0] ?? null;
    const parts: string[] = [];

    if (roomTop && this.currentRoomLeaderboard) {
      const rankingMode = this.currentRoomLeaderboard.rankingMode;
      const metric =
        rankingMode === 'time'
          ? `${(roomTop.elapsedMs / 1000).toFixed(2)}s`
          : `${roomTop.score} pts`;
      parts.push(`Room top ${roomTop.userDisplayName} ${metric}`);
    }

    if (globalTop) {
      parts.push(`Global top ${globalTop.userDisplayName} ${globalTop.totalPoints} pts`);
    }

    if (parts.length > 0) {
      return parts.join(' · ');
    }

    return this.leaderboardMessage;
  }

  getPersistentStatusText(): string | null {
    if (this.currentGoalRun?.qualificationState === 'practice') {
      return this.currentGoalRun.submissionMessage;
    }

    return null;
  }

  getDebugSnapshot(): OverworldGoalRunSnapshot {
    const roomDifficulty = this.currentRoomLeaderboard?.difficulty ?? {
      consensus: null,
      counts: {
        easy: 0,
        medium: 0,
        hard: 0,
        extreme: 0,
      },
      totalVotes: 0,
      viewerVote: null,
      viewerSignedIn: false,
      viewerCanVote: false,
      viewerNeedsRun: false,
    };

    return {
      goalRun: this.currentGoalRun
        ? {
            roomId: this.currentGoalRun.roomId,
            roomCoordinates: { ...this.currentGoalRun.roomCoordinates },
            roomVersion: this.currentGoalRun.roomVersion,
            roomStatus: this.currentGoalRun.roomStatus,
            goal: cloneRoomGoal(this.currentGoalRun.goal)!,
            qualificationState: this.currentGoalRun.qualificationState,
            rankedStartPoint: { ...this.currentGoalRun.rankedStartPoint },
            elapsedMs: Math.round(this.currentGoalRun.elapsedMs),
            deaths: this.currentGoalRun.deaths,
            collectiblesCollected: this.currentGoalRun.collectiblesCollected,
            enemyCollectiblesCollected: this.currentGoalRun.enemyCollectiblesCollected,
            collectibleTarget: this.currentGoalRun.collectibleTarget,
            enemiesDefeated: this.currentGoalRun.enemiesDefeated,
            enemyTarget: this.currentGoalRun.enemyTarget,
            checkpointsReached: this.currentGoalRun.checkpointsReached,
            checkpointTarget: this.currentGoalRun.checkpointTarget,
            nextCheckpointIndex: this.currentGoalRun.nextCheckpointIndex,
            result: this.currentGoalRun.result,
            completionMessage: this.currentGoalRun.completionMessage,
            attemptId: this.currentGoalRun.attemptId,
            submissionState: this.currentGoalRun.submissionState,
            submissionMessage: this.currentGoalRun.submissionMessage,
            pendingResult: this.currentGoalRun.pendingResult,
            submittedScore: this.currentGoalRun.submittedScore,
            leaderboardEligible: this.currentGoalRun.leaderboardEligible,
            verificationSchemaVersion: this.currentGoalRun.verificationSchemaVersion,
            verificationNonce: this.currentGoalRun.verificationNonce,
            snapshotHash: this.currentGoalRun.snapshotHash,
          }
        : null,
      leaderboards: {
        state: this.leaderboardState,
        message: this.leaderboardMessage,
        room: this.currentRoomLeaderboard
          ? {
              roomId: this.currentRoomLeaderboard.roomId,
              roomCoordinates: { ...this.currentRoomLeaderboard.roomCoordinates },
              roomTitle: this.currentRoomLeaderboard.roomTitle,
              roomVersion: this.currentRoomLeaderboard.roomVersion,
              displayRoomVersion: this.currentRoomLeaderboard.displayRoomVersion,
              equivalentRoomVersions: [...this.currentRoomLeaderboard.equivalentRoomVersions],
              leaderboardFamilyVersions: [...this.currentRoomLeaderboard.leaderboardFamilyVersions],
              leaderboardSourceVersion: this.currentRoomLeaderboard.leaderboardSourceVersion,
              canonicalRoomVersion: this.currentRoomLeaderboard.canonicalRoomVersion,
              goalType: this.currentRoomLeaderboard.goalType,
              rankingMode: this.currentRoomLeaderboard.rankingMode,
              difficulty: {
                consensus: roomDifficulty.consensus,
                counts: { ...roomDifficulty.counts },
                totalVotes: roomDifficulty.totalVotes,
                viewerVote: roomDifficulty.viewerVote,
                viewerSignedIn: roomDifficulty.viewerSignedIn,
                viewerCanVote: roomDifficulty.viewerCanVote,
                viewerNeedsRun: roomDifficulty.viewerNeedsRun,
              },
              quality: {
                ...this.currentRoomLeaderboard.quality,
                counts: { ...this.currentRoomLeaderboard.quality.counts },
              },
              viewerRating: this.currentRoomLeaderboard.viewerRating
                ? { ...this.currentRoomLeaderboard.viewerRating }
                : null,
              trophy: this.currentRoomLeaderboard.trophy
                ? { ...this.currentRoomLeaderboard.trophy }
                : null,
              entries: this.currentRoomLeaderboard.entries.map((entry) => ({ ...entry })),
              viewerBest: this.currentRoomLeaderboard.viewerBest
                ? { ...this.currentRoomLeaderboard.viewerBest }
                : null,
              viewerRank: this.currentRoomLeaderboard.viewerRank,
            }
          : null,
        global: this.globalLeaderboard
          ? {
              entries: this.globalLeaderboard.entries.map((entry) => ({ ...entry })),
              viewerEntry: this.globalLeaderboard.viewerEntry
                ? { ...this.globalLeaderboard.viewerEntry }
                : null,
            }
          : null,
      },
    };
  }

  private clearRunForRoomExit(): GoalRunMutationResult {
    if (!this.currentGoalRun) {
      return NOOP_MUTATION_RESULT;
    }

    const abandoned = this.abandonActiveRun();
    this.currentGoalRun = null;
    return {
      changed: true,
      goalMarkersChanged: true,
      resetChallengeState: false,
      transientStatus: abandoned.transientStatus,
      event: abandoned.event,
    };
  }

  private runMatchesRoom(runState: GoalRunState, room: RoomSnapshot): boolean {
    return (
      runState.roomId === room.id &&
      runState.roomVersion === room.version &&
      JSON.stringify(runState.goal) === JSON.stringify(room.goal)
    );
  }

  private goalTimeLimitReached(runState: GoalRunState): boolean {
    if (runState.goal.type === 'survival') {
      return false;
    }

    return runState.goal.timeLimitMs !== null && runState.elapsedMs >= runState.goal.timeLimitMs;
  }

  private async startRemoteGoalRun(runState: GoalRunState): Promise<void> {
    if (
      runState.qualificationState !== 'qualified' ||
      !runState.leaderboardEligible ||
      runState.submissionState === 'local-only'
    ) {
      return;
    }

    runState.submissionState = 'starting';
    runState.submissionMessage = 'Starting ranked run...';

    try {
      const response = await this.options.runRepository.startRun({
        roomId: runState.roomId,
        roomCoordinates: { ...runState.roomCoordinates },
        roomVersion: runState.roomVersion,
        goal: cloneRoomGoal(runState.goal)!,
        startedAt: this.nowIso(),
      });

      runState.attemptId = response.attemptId;
      runState.verificationSchemaVersion = response.verificationSchemaVersion;
      runState.verificationNonce = response.verificationNonce;
      runState.snapshotHash = response.snapshotHash;
      runState.submissionState = 'active';
      runState.submissionMessage = `Ranked run live as ${response.userDisplayName}.`;
      this.options.onRankedRunStarted?.({
        kind: 'room',
        verificationSchemaVersion: response.verificationSchemaVersion,
        verificationNonce: response.verificationNonce,
        snapshotHash: response.snapshotHash,
      });
      await this.refreshLeaderboardsForRoom({
        id: runState.roomId,
        coordinates: { ...runState.roomCoordinates },
        version: runState.roomVersion,
        goal: cloneRoomGoal(runState.goal),
        status: 'published',
      } as RoomSnapshot);
      this.maybeSubmitGoalRunResult(runState);
    } catch (error) {
      console.error('Failed to start ranked run', error);
      if (isRunApiError(error) && error.status === 401) {
        runState.submissionState = 'local-only';
        runState.submissionMessage = 'Sign in to submit ranked runs.';
      } else if (isRunApiError(error) && error.status === 403) {
        runState.submissionState = 'local-only';
        runState.submissionMessage = error.message;
      } else {
        runState.submissionState = 'error';
        runState.submissionMessage = 'Ranked run start failed.';
      }
    }
  }

  private maybeSubmitGoalRunResult(runState: GoalRunState): void {
    if (runState.pendingResult === null) {
      return;
    }

    if (
      runState.submissionState === 'waiting' ||
      runState.submissionState === 'local-only' ||
      runState.submissionState === 'submitted' ||
      runState.submissionState === 'finishing'
    ) {
      return;
    }

    if (!runState.attemptId) {
      return;
    }

    void this.finishRemoteGoalRun(runState, runState.pendingResult);
  }

  private maybePromptGuestClaimForLocalClear(runState: GoalRunState): void {
    if (!this.shouldPromptGuestClaimForLocalClear(runState)) {
      return;
    }

    const elapsedMs = Math.round(runState.elapsedMs);
    const score = this.options.getScore();
    runState.pendingResult = null;
    runState.submissionState = 'submitted';
    runState.submittedScore = computeRunScore(runState.goal, {
      result: 'completed',
      elapsedMs,
      deaths: runState.deaths,
      collectiblesCollected: runState.collectiblesCollected,
      enemiesDefeated: runState.enemiesDefeated,
      checkpointsReached: runState.checkpointsReached,
      score,
      finishedAt: this.nowIso(),
      enemyCollectiblesCollected: runState.enemyCollectiblesCollected,
      verificationTrace: null,
    });
    runState.submissionMessage = 'Guest clear saved on this browser.';

    requestPostRunGuestClaim({
      contentType: 'room',
      contentId: runState.roomId,
      contentTitle: this.currentRoomLeaderboard?.roomTitle ?? null,
      roomCoordinates: { ...runState.roomCoordinates },
      version: runState.roomVersion,
      previousViewerRank: null,
      elapsedMs,
      deaths: runState.deaths,
      score,
      autoSuggestedDifficulty: suggestProgressionDifficulty({
        elapsedMs,
        deaths: runState.deaths,
        collectiblesCollected: runState.collectiblesCollected,
        enemiesDefeated: runState.enemiesDefeated,
        checkpointsReached: runState.checkpointsReached,
      }),
    });
  }

  private shouldPromptGuestClaimForLocalClear(runState: GoalRunState): boolean {
    return (
      runState.result === 'completed' &&
      runState.roomStatus === 'published' &&
      runState.submissionState === 'local-only' &&
      !runState.leaderboardEligible &&
      !this.options.getAuthenticated()
    );
  }

  private activateQualifiedRun(
    runState: GoalRunState,
    resetChallengeState: boolean
  ): GoalRunMutationResult {
    this.resetRunProgress(runState);
    runState.qualificationState = 'qualified';
    runState.submissionState = runState.leaderboardEligible ? 'starting' : 'local-only';
    runState.submissionMessage = this.getQualifiedSubmissionMessage(
      runState.roomStatus,
      runState.leaderboardEligible
    );

    if (runState.leaderboardEligible) {
      void this.startRemoteGoalRun(runState);
    }

    if (runState.goal.type === 'defeat_all' && runState.enemyTarget === 0) {
      const completed = this.markCompleted('No enemies remain.');
      return {
        ...completed,
        resetChallengeState,
      };
    }

    return {
      changed: true,
      goalMarkersChanged: true,
      resetChallengeState,
      transientStatus: `${ROOM_GOAL_LABELS[runState.goal.type]} started.`,
      event: 'start',
    };
  }

  private async finishRemoteGoalRun(
    runState: GoalRunState,
    result: Exclude<RunResult, 'active'>
  ): Promise<void> {
    if (!runState.attemptId) {
      return;
    }

    runState.submissionState = 'finishing';
    runState.submissionMessage = 'Submitting run...';

    const payload = this.buildRunFinishPayload(runState, result);
    let previousLeaderboard = this.leaderboardMatchesRun(runState, this.currentRoomLeaderboard)
      ? this.currentRoomLeaderboard
      : null;
    if (result === 'completed' && previousLeaderboard === null) {
      previousLeaderboard = await this.loadFreshRoomLeaderboard(runState);
    }
    const previousViewerBest = previousLeaderboard?.viewerBest ?? null;
    const previousViewerRank = previousLeaderboard?.viewerRank ?? null;
    const previousRoomTitle = previousLeaderboard?.roomTitle ?? null;
    const postRunPromptKey = this.buildPostRunRatingPromptKey(runState);

    try {
      await this.options.runRepository.finishRun(runState.attemptId, payload);
      runState.pendingResult = null;
      runState.submissionState = 'submitted';
      runState.submittedScore = computeRunScore(runState.goal, payload);
      this.options.clearVerificationTrace?.();
      runState.submissionMessage =
        result === 'completed'
          ? `Submitted score ${runState.submittedScore}.`
          : result === 'failed'
            ? 'Failed run submitted.'
            : 'Run marked abandoned.';
      if (result === 'completed') {
        const refreshedLeaderboard = await this.loadFreshRoomLeaderboard(runState);
        const currentViewerRank = refreshedLeaderboard?.viewerRank ?? null;
        const contentTitle = refreshedLeaderboard?.roomTitle ?? previousRoomTitle;
        const leaderboardRewards = buildLeaderboardRankRewardStings({
          previousViewerRank,
          currentViewerRank,
          contentTitle,
        });
        const shouldPromptForRating =
          previousViewerBest === null &&
          !this.promptedPostRunRatingKeys.has(postRunPromptKey);
        const rewards = [
          ...(shouldPromptForRating
            ? [
                createPostRunClearReward({
                  contentType: 'room',
                  contentTitle,
                  elapsedMs: payload.elapsedMs,
                  deaths: payload.deaths,
                  score: payload.score ?? null,
                }),
              ]
            : []),
          ...leaderboardRewards,
        ];
        notifyRewardStings(rewards);
        if (shouldPromptForRating) {
          this.promptedPostRunRatingKeys.add(postRunPromptKey);
          requestPostRunRating({
            contentType: 'room',
            contentId: runState.roomId,
            contentTitle,
            roomCoordinates: { ...runState.roomCoordinates },
            version: runState.roomVersion,
            previousViewerRank,
            suppressLeaderboardRewardStings: leaderboardRewards.length > 0,
            elapsedMs: payload.elapsedMs,
            deaths: payload.deaths,
            score: payload.score ?? null,
            autoSuggestedDifficulty: suggestProgressionDifficulty({
              elapsedMs: payload.elapsedMs,
              deaths: payload.deaths,
              collectiblesCollected: payload.collectiblesCollected,
              enemiesDefeated: payload.enemiesDefeated,
              checkpointsReached: payload.checkpointsReached,
            }),
          });
        }
      }
    } catch (error) {
      console.error('Failed to finish ranked run', {
        attemptId: runState.attemptId,
        result,
        payload,
        error,
      });
      const message = formatGoalRunSubmissionErrorMessage(error, result);
      runState.submissionState = 'error';
      runState.submissionMessage = message;
      this.options.clearVerificationTrace?.();
      if (result === 'completed') {
        this.options.showTransientStatus?.(message);
      }
    }
  }

  private buildPostRunRatingPromptKey(runState: GoalRunState): string {
    return `${runState.roomId}:${runState.roomVersion}`;
  }

  private leaderboardMatchesRun(
    runState: GoalRunState,
    leaderboard: RoomLeaderboardResponse | null,
  ): boolean {
    return (
      leaderboard !== null &&
      leaderboard.roomId === runState.roomId &&
      leaderboard.roomVersion === runState.roomVersion
    );
  }

  private async loadFreshRoomLeaderboard(
    runState: GoalRunState,
  ): Promise<RoomLeaderboardResponse | null> {
    try {
      const leaderboard = await this.options.runRepository.loadRoomLeaderboard(
        runState.roomId,
        runState.roomCoordinates,
        runState.roomVersion,
        5,
      );
      this.currentRoomLeaderboard = leaderboard;
      this.leaderboardState = 'ready';
      this.leaderboardMessage = leaderboard.entries.length
        ? 'Leaderboard ready.'
        : 'No ranked clears yet.';
      return leaderboard;
    } catch (error) {
      console.warn('Failed to refresh leaderboard after room clear', error);
      return null;
    }
  }

  private buildRunFinishPayload(
    runState: GoalRunState,
    result: Exclude<RunResult, 'active'>
  ): RunFinishRequestBody {
    const verificationTrace = this.options.buildVerificationTrace?.(runState, result) ?? null;
    if (!verificationTrace) {
      console.warn('Submitting ranked room finish without verification trace', {
        attemptId: runState.attemptId,
        roomId: runState.roomId,
        roomVersion: runState.roomVersion,
        result,
        elapsedMs: Math.round(runState.elapsedMs),
        submissionState: runState.submissionState,
        verificationSchemaVersion: runState.verificationSchemaVersion,
        hasVerificationNonce: Boolean(runState.verificationNonce),
        hasSnapshotHash: Boolean(runState.snapshotHash),
      });
    }

    return {
      result,
      elapsedMs: Math.round(runState.elapsedMs),
      deaths: runState.deaths,
      collectiblesCollected: runState.collectiblesCollected,
      enemiesDefeated: runState.enemiesDefeated,
      checkpointsReached: runState.checkpointsReached,
      score: this.options.getScore(),
      finishedAt: this.nowIso(),
      enemyCollectiblesCollected: runState.enemyCollectiblesCollected,
      verificationTrace,
    };
  }

  private getGoalSubmissionStatusText(_runState: GoalRunState): string {
    return '';
  }

  private getPracticeStatusMessage(
    roomStatus: RoomSnapshot['status'],
    leaderboardEligible: boolean
  ): string {
    if (leaderboardEligible) {
      return 'Practice run. Reach spawn to start ranked attempt.';
    }

    return roomStatus === 'draft'
      ? 'Practice run. Reach spawn to start playtest.'
      : 'Practice run. Reach spawn to start challenge.';
  }

  private getQualifiedSubmissionMessage(
    roomStatus: RoomSnapshot['status'],
    leaderboardEligible: boolean
  ): string {
    if (leaderboardEligible) {
      return 'Starting ranked run...';
    }

    return roomStatus !== 'published'
      ? 'Draft room run stays local.'
      : this.options.getAuthenticated()
        ? 'Ranked submission unavailable.'
        : 'Sign in to submit ranked runs.';
  }

  private resetRunProgress(runState: GoalRunState): void {
    runState.elapsedMs = 0;
    runState.deaths = 0;
    runState.collectiblesCollected = 0;
    runState.enemyCollectiblesCollected = 0;
    runState.enemiesDefeated = 0;
    runState.checkpointsReached = 0;
    runState.nextCheckpointIndex = 0;
    runState.result = 'active';
    runState.completionMessage = null;
    runState.attemptId = null;
    runState.pendingResult = null;
    runState.submittedScore = null;
    runState.verificationSchemaVersion = null;
    runState.verificationNonce = null;
    runState.snapshotHash = null;
  }

  private collectRaceGoalExhausted(runState: GoalRunState): boolean {
    if (runState.goal.type !== 'collect_race' || runState.collectibleTarget === null) {
      return false;
    }

    return (
      runState.collectiblesCollected + runState.enemyCollectiblesCollected >= runState.collectibleTarget
    );
  }

  private resolveCollectRace(_reason: string): GoalRunMutationResult {
    if (!this.currentGoalRun || this.currentGoalRun.goal.type !== 'collect_race') {
      return NOOP_MUTATION_RESULT;
    }

    if (this.currentGoalRun.collectiblesCollected > this.currentGoalRun.enemyCollectiblesCollected) {
      return this.markCompleted(
        `Collect race won ${this.currentGoalRun.collectiblesCollected}-${this.currentGoalRun.enemyCollectiblesCollected}.`,
      );
    }

    if (this.currentGoalRun.collectiblesCollected === this.currentGoalRun.enemyCollectiblesCollected) {
      return this.markFailed(
        `Collect race tied ${this.currentGoalRun.collectiblesCollected}-${this.currentGoalRun.enemyCollectiblesCollected}.`,
      );
    }

    return this.markFailed(
      `Sword Hunter won ${this.currentGoalRun.enemyCollectiblesCollected}-${this.currentGoalRun.collectiblesCollected}.`,
    );
  }

  private nowIso(): string {
    return this.options.getNowIso ? this.options.getNowIso() : new Date().toISOString();
  }
}

function formatGoalRunSubmissionErrorMessage(
  error: unknown,
  result: Exclude<RunResult, 'active'>
): string {
  const detail =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Run submission failed.';

  if (result === 'completed') {
    return `Ranked clear not recorded: ${detail}`;
  }

  if (result === 'failed') {
    return `Ranked failed run not recorded: ${detail}`;
  }

  return `Run abandon did not sync: ${detail}`;
}
