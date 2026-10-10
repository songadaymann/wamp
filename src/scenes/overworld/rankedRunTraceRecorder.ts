import { ROOM_WIDTH, ROOM_HEIGHT, TILE_SIZE } from '../../config/room';
import type { RoomCoordinates } from '../../persistence/roomModel';
import type { RespawnCheckpointReference } from '../../goals/respawnCheckpoints';
import {
  MAX_RUN_DEATH_LOCATIONS,
  RANKED_RUN_BREADCRUMB_INTERVAL_MS,
  type RankedRunTraceDeathEvent,
  type RankedRunTraceRespawnEvent,
  RANKED_RUN_TRACE_SCHEMA_VERSION,
  type RankedRunTraceBreadcrumb,
  type RankedRunTraceGoalEvent,
  type RankedRunTraceInputEvent,
  type RankedRunTraceRoomTransition,
  type RankedRunVerificationTrace,
} from '../../runs/verificationTrace';


export interface RankedRunTraceBinding {
  verificationSchemaVersion: number;
  verificationNonce: string;
  snapshotHash: string;
}

export interface RankedRunTraceFrameInput {
  roomCoordinates: RoomCoordinates;
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  horizontalInput: number;
  verticalInput: number;
  jumpPressed: boolean;
}

type TraceKind = 'room' | 'course';

interface ActiveTraceState {
  kind: TraceKind;
  binding: RankedRunTraceBinding;
  elapsedMs: number;
  inputEvents: RankedRunTraceInputEvent[];
  breadcrumbs: RankedRunTraceBreadcrumb[];
  roomTransitions: RankedRunTraceRoomTransition[];
  goalEvents: RankedRunTraceGoalEvent[];
  deathEvents: RankedRunTraceDeathEvent[];
  respawnEvents: RankedRunTraceRespawnEvent[];
  pendingDeath: { frame: RankedRunTraceFrameInput; goalEventCount: number } | null;
  lastBreadcrumbAtMs: number;
  lastRoomCoordinates: RoomCoordinates | null;
  lastHorizontalInput: number | null;
  lastVerticalInput: number | null;
}

export class RankedRunTraceRecorder {
  private active: ActiveTraceState | null = null;

  prepare(kind: TraceKind, initialFrame: RankedRunTraceFrameInput | null): void {
    this.start(kind, { verificationSchemaVersion: RANKED_RUN_TRACE_SCHEMA_VERSION,
      verificationNonce: '', snapshotHash: '' }, initialFrame);
  }

  bindPrepared(kind: TraceKind, binding: RankedRunTraceBinding): boolean {
    if (!this.active || this.active.kind !== kind || this.active.binding.verificationNonce) return false;
    this.active.binding = { ...binding };
    return true;
  }

  start(kind: TraceKind, binding: RankedRunTraceBinding, initialFrame: RankedRunTraceFrameInput | null): void {
    this.active = {
      kind,
      binding: {
        verificationSchemaVersion:
          binding.verificationSchemaVersion || RANKED_RUN_TRACE_SCHEMA_VERSION,
        verificationNonce: binding.verificationNonce,
        snapshotHash: binding.snapshotHash,
      },
      elapsedMs: 0,
      inputEvents: [],
      breadcrumbs: [],
      roomTransitions: [],
      goalEvents: [],
      deathEvents: [],
      respawnEvents: [],
      pendingDeath: null,
      lastBreadcrumbAtMs: 0,
      lastRoomCoordinates: initialFrame ? { ...initialFrame.roomCoordinates } : null,
      lastHorizontalInput: null,
      lastVerticalInput: null,
    };

    if (initialFrame) {
      this.recordFrame(0, initialFrame);
    }
  }

  clear(): void {
    this.active = null;
  }

  isActive(kind?: TraceKind): boolean {
    return this.active !== null && (kind ? this.active.kind === kind : true);
  }

  recordFrame(deltaMs: number, frame: RankedRunTraceFrameInput): void {
    if (!this.active) {
      return;
    }

    this.active.elapsedMs = Math.max(0, this.active.elapsedMs + Math.max(0, deltaMs));
    this.recordInputChange('moveX', frame.horizontalInput, this.active.lastHorizontalInput);
    this.recordInputChange('moveY', frame.verticalInput, this.active.lastVerticalInput);
    this.active.lastHorizontalInput = frame.horizontalInput;
    this.active.lastVerticalInput = frame.verticalInput;

    if (frame.jumpPressed) {
      this.active.inputEvents.push({
        atMs: Math.round(this.active.elapsedMs),
        control: 'jump',
        value: true,
      });
    }

    const lastRoom = this.active.lastRoomCoordinates;
    if (
      lastRoom &&
      (lastRoom.x !== frame.roomCoordinates.x || lastRoom.y !== frame.roomCoordinates.y)
    ) {
      this.active.roomTransitions.push({
        atMs: Math.round(this.active.elapsedMs),
        fromRoomX: lastRoom.x,
        fromRoomY: lastRoom.y,
        toRoomX: frame.roomCoordinates.x,
        toRoomY: frame.roomCoordinates.y,
        x: frame.x,
        y: frame.y,
      });
    }
    this.active.lastRoomCoordinates = { ...frame.roomCoordinates };

    if (
      this.active.breadcrumbs.length === 0 ||
      this.active.elapsedMs - this.active.lastBreadcrumbAtMs >= RANKED_RUN_BREADCRUMB_INTERVAL_MS
    ) {
      this.active.breadcrumbs.push({
        atMs: Math.round(this.active.elapsedMs),
        roomX: frame.roomCoordinates.x,
        roomY: frame.roomCoordinates.y,
        x: frame.x,
        y: frame.y,
        vx: frame.vx,
        vy: frame.vy,
        grounded: frame.grounded,
      });
      this.active.lastBreadcrumbAtMs = this.active.elapsedMs;
    }
  }

  recordGoalEvent(
    event: Omit<RankedRunTraceGoalEvent, 'atMs'>,
  ): void {
    if (!this.active) {
      return;
    }

    this.active.goalEvents.push({
      ...event,
      actor: event.actor ?? 'player',
      atMs: Math.round(this.active.elapsedMs),
    });
  }

  recordDeath(frame: RankedRunTraceFrameInput): void {
    if (!this.active) return;
    if (!this.active.breadcrumbs.length) this.recordFrame(0, frame);
    this.active.pendingDeath = { frame: { ...frame, roomCoordinates: { ...frame.roomCoordinates } },
      goalEventCount: this.active.goalEvents.length };
    if (this.active.deathEvents.length >= MAX_RUN_DEATH_LOCATIONS) return;
    this.active.deathEvents.push({ atMs: Math.round(this.active.elapsedMs),
      roomX: frame.roomCoordinates.x, roomY: frame.roomCoordinates.y,
      tileX: Math.max(0, Math.min(ROOM_WIDTH - 1, Math.floor(frame.x / TILE_SIZE))),
      tileY: Math.max(0, Math.min(ROOM_HEIGHT - 1, Math.floor(frame.y / TILE_SIZE))),
    });
  }

  recordRespawn(frame: RankedRunTraceFrameInput, reference: RespawnCheckpointReference): void {
    if (!this.active?.pendingDeath) return;
    const { frame: from, goalEventCount } = this.active.pendingDeath;
    this.active.pendingDeath = null;
    const atMs = Math.round(this.active.elapsedMs);
    this.active.respawnEvents.push({ ...reference, atMs,
      breadcrumbIndex: this.active.breadcrumbs.length, goalEventCount,
      fromRoomX: from.roomCoordinates.x, fromRoomY: from.roomCoordinates.y, fromX: from.x, fromY: from.y });
    this.active.breadcrumbs.push({ atMs, roomX: frame.roomCoordinates.x, roomY: frame.roomCoordinates.y,
      x: frame.x, y: frame.y, vx: frame.vx, vy: frame.vy, grounded: frame.grounded });
    this.active.lastBreadcrumbAtMs = this.active.elapsedMs;
    // A respawn is recorded above; the next normal frame must not invent a room transition.
    this.active.lastRoomCoordinates = { ...frame.roomCoordinates };
  }

  buildTrace(traceDurationMs: number): RankedRunVerificationTrace | null {
    if (!this.active) {
      return null;
    }

    return {
      schemaVersion: this.active.binding.verificationSchemaVersion,
      verificationNonce: this.active.binding.verificationNonce,
      snapshotHash: this.active.binding.snapshotHash,
      traceDurationMs: Math.max(0, Math.round(traceDurationMs)),
      inputEvents: [...this.active.inputEvents],
      breadcrumbs: [...this.active.breadcrumbs],
      roomTransitions: [...this.active.roomTransitions],
      goalEvents: [...this.active.goalEvents],
      deathEvents: [...this.active.deathEvents],
      ...(this.active.respawnEvents.length ? { respawnEvents: [...this.active.respawnEvents] } : {}),
    };
  }

  private recordInputChange(
    control: 'moveX' | 'moveY',
    nextValue: number,
    previousValue: number | null,
  ): void {
    if (!this.active || previousValue === nextValue) {
      return;
    }

    this.active.inputEvents.push({
      atMs: Math.round(this.active.elapsedMs),
      control,
      value: nextValue,
    });
  }
}
