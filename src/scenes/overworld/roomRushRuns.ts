import {
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../../persistence/roomModel';

export const ROOM_RUSH_NAME = 'Room Rush';

export type RoomRushDifficulty = 'easy' | 'hard';
export type RoomRushStartRule = 'selected' | 'origin';
export type RoomRushResult = 'active' | 'completed' | 'failed' | 'abandoned';

export interface RoomRushRouteStep {
  routeIndex: number;
  roomId: string;
  coordinates: RoomCoordinates;
  uniqueVisitIndex: number;
}

export interface ActiveRoomRushRunState {
  runId: string;
  playerDisplayName?: string | null;
  difficulty: RoomRushDifficulty;
  startRule: RoomRushStartRule;
  startCoordinates: RoomCoordinates;
  returnCoordinates: RoomCoordinates;
  currentCoordinates: RoomCoordinates;
  elapsedMs: number;
  deaths: number;
  visitedRoomIds: string[];
  route: RoomRushRouteStep[];
  result: RoomRushResult;
  completionMessage: string | null;
}

export interface StartRoomRushRunOptions {
  difficulty: RoomRushDifficulty;
  startRule: RoomRushStartRule;
  startCoordinates: RoomCoordinates;
  returnCoordinates: RoomCoordinates;
  startRoom: RoomSnapshot;
}

export interface RoomRushMutationResult {
  changed: boolean;
  transientStatus: string | null;
  terminalResult: RoomRushResult | null;
}

const NOOP_MUTATION_RESULT: RoomRushMutationResult = {
  changed: false,
  transientStatus: null,
  terminalResult: null,
};

export class OverworldRoomRushRunController {
  private currentRun: ActiveRoomRushRunState | null = null;
  private nextRunNumber = 1;

  reset(): void {
    this.currentRun = null;
  }

  getCurrentRun(): ActiveRoomRushRunState | null {
    return this.currentRun;
  }

  startRun(options: StartRoomRushRunOptions): RoomRushMutationResult {
    this.currentRun = {
      runId: `room-rush-${Date.now().toString(36)}-${this.nextRunNumber.toString(36)}`,
      difficulty: options.difficulty,
      startRule: options.startRule,
      startCoordinates: { ...options.startCoordinates },
      returnCoordinates: { ...options.returnCoordinates },
      currentCoordinates: { ...options.startCoordinates },
      elapsedMs: 0,
      deaths: 0,
      visitedRoomIds: [],
      route: [],
      result: 'active',
      completionMessage: null,
    };
    this.nextRunNumber += 1;

    this.recordRoomVisit(options.startRoom);
    return {
      changed: true,
      transientStatus: this.getStartStatusText(this.currentRun),
      terminalResult: null,
    };
  }

  tick(delta: number): RoomRushMutationResult {
    if (!this.currentRun || this.currentRun.result !== 'active') {
      return NOOP_MUTATION_RESULT;
    }

    this.currentRun.elapsedMs += delta;
    return {
      changed: true,
      transientStatus: null,
      terminalResult: null,
    };
  }

  recordRoomVisit(room: RoomSnapshot | null): RoomRushMutationResult {
    if (!this.currentRun || this.currentRun.result !== 'active' || room?.status !== 'published') {
      return NOOP_MUTATION_RESULT;
    }

    this.currentRun.currentCoordinates = { ...room.coordinates };
    const existingUniqueIndex = this.currentRun.visitedRoomIds.indexOf(room.id);
    const uniqueVisitIndex =
      existingUniqueIndex === -1
        ? this.currentRun.visitedRoomIds.length + 1
        : existingUniqueIndex + 1;
    const lastRouteStep = this.currentRun.route[this.currentRun.route.length - 1] ?? null;
    if (!lastRouteStep || lastRouteStep.roomId !== room.id) {
      this.currentRun.route.push({
        routeIndex: this.currentRun.route.length,
        roomId: room.id,
        coordinates: { ...room.coordinates },
        uniqueVisitIndex,
      });
    }

    if (existingUniqueIndex !== -1) {
      return {
        changed: true,
        transientStatus: null,
        terminalResult: null,
      };
    }

    this.currentRun.visitedRoomIds.push(room.id);
    return {
      changed: true,
      transientStatus: `${ROOM_RUSH_NAME}: ${this.currentRun.visitedRoomIds.length} rooms.`,
      terminalResult: null,
    };
  }

  recordDeath(reason: string): RoomRushMutationResult {
    if (!this.currentRun || this.currentRun.result !== 'active') {
      return NOOP_MUTATION_RESULT;
    }

    this.currentRun.deaths += 1;
    if (this.currentRun.difficulty === 'hard') {
      const score = this.currentRun.visitedRoomIds.length;
      this.currentRun.result = 'failed';
      this.currentRun.completionMessage =
        `${ROOM_RUSH_NAME} ended at ${score} ${score === 1 ? 'room' : 'rooms'}.`;
      return {
        changed: true,
        transientStatus: `${reason} ${this.currentRun.completionMessage}`,
        terminalResult: 'failed',
      };
    }

    return {
      changed: true,
      transientStatus: `${reason} ${ROOM_RUSH_NAME} continues.`,
      terminalResult: null,
    };
  }

  completeActiveRun(message: string | null = null): RoomRushMutationResult {
    if (!this.currentRun || this.currentRun.result !== 'active') {
      return NOOP_MUTATION_RESULT;
    }

    const score = this.currentRun.visitedRoomIds.length;
    this.currentRun.result = 'completed';
    this.currentRun.completionMessage =
      message ?? `${ROOM_RUSH_NAME} complete: ${score} ${score === 1 ? 'room' : 'rooms'}.`;
    return {
      changed: true,
      transientStatus: this.currentRun.completionMessage,
      terminalResult: 'completed',
    };
  }

  abandonActiveRun(message: string = `${ROOM_RUSH_NAME} abandoned.`): RoomRushMutationResult {
    if (!this.currentRun || this.currentRun.result !== 'active') {
      return NOOP_MUTATION_RESULT;
    }

    this.currentRun.result = 'abandoned';
    this.currentRun.completionMessage = message;
    return {
      changed: true,
      transientStatus: message,
      terminalResult: 'abandoned',
    };
  }

  getPersistentStatusText(): string | null {
    if (!this.currentRun) {
      return null;
    }

    if (this.currentRun.result !== 'active') {
      return this.currentRun.completionMessage;
    }

    return `${ROOM_RUSH_NAME}: ${this.currentRun.visitedRoomIds.length} rooms · deaths ${this.currentRun.deaths}`;
  }

  getDebugSnapshot(): ActiveRoomRushRunState | null {
    if (!this.currentRun) {
      return null;
    }

    return {
      ...this.currentRun,
      startCoordinates: { ...this.currentRun.startCoordinates },
      returnCoordinates: { ...this.currentRun.returnCoordinates },
      currentCoordinates: { ...this.currentRun.currentCoordinates },
      visitedRoomIds: [...this.currentRun.visitedRoomIds],
      route: this.currentRun.route.map((step) => ({
        ...step,
        coordinates: { ...step.coordinates },
      })),
    };
  }

  private getStartStatusText(runState: ActiveRoomRushRunState): string {
    const startText =
      runState.startRule === 'origin'
        ? `Origin start ${roomIdFromCoordinates(runState.startCoordinates)}`
        : `Start ${roomIdFromCoordinates(runState.startCoordinates)}`;
    const difficultyText = runState.difficulty === 'hard' ? 'Hard' : 'Easy';
    return `${ROOM_RUSH_NAME} started. ${difficultyText} · ${startText}.`;
  }
}

export function getRoomRushGoalBadgeText(runState: ActiveRoomRushRunState): string {
  const difficultyText = runState.difficulty === 'hard' ? 'Hard' : 'Easy';
  const startText = runState.startRule === 'origin' ? 'Origin' : 'Free start';
  return `${difficultyText} · ${startText}`;
}

export function getRoomRushProgressText(runState: ActiveRoomRushRunState): string {
  const roomCount = runState.visitedRoomIds.length;
  const roomText = `${roomCount} ${roomCount === 1 ? 'room' : 'rooms'}`;
  const deathText =
    runState.difficulty === 'hard'
      ? runState.deaths > 0 ? 'death' : 'no deaths'
      : `${runState.deaths} ${runState.deaths === 1 ? 'death' : 'deaths'}`;

  if (runState.result === 'failed') {
    return `${roomText} · ${deathText}`;
  }

  if (runState.result === 'completed' || runState.result === 'abandoned') {
    return `${roomText} final · ${deathText}`;
  }

  return `${roomText} visited · ${deathText}`;
}
