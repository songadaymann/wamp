import type { RoomCoordinates } from '../../persistence/roomModel';
import {
  RANKED_RUN_TRACE_SCHEMA_VERSION,
  type RankedRunTraceBreadcrumb,
  type RankedRunTraceGoalEvent,
  type RankedRunTraceInputEvent,
  type RankedRunTraceRoomTransition,
  type RankedRunVerificationTrace,
} from '../../runs/verificationTrace';

const BREADCRUMB_INTERVAL_MS = 250;

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
  lastBreadcrumbAtMs: number;
  lastRoomCoordinates: RoomCoordinates | null;
  lastHorizontalInput: number | null;
  lastVerticalInput: number | null;
}

export class RankedRunTraceRecorder {
  private active: ActiveTraceState | null = null;

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
      this.active.elapsedMs - this.active.lastBreadcrumbAtMs >= BREADCRUMB_INTERVAL_MS
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
