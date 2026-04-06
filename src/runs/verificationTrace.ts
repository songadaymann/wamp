export const RANKED_RUN_TRACE_SCHEMA_VERSION = 1;

export type RankedRunTraceControl = 'moveX' | 'moveY' | 'jump';

export interface RankedRunTraceInputEvent {
  atMs: number;
  control: RankedRunTraceControl;
  value: number | boolean;
}

export interface RankedRunTraceBreadcrumb {
  atMs: number;
  roomX: number;
  roomY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
}

export interface RankedRunTraceRoomTransition {
  atMs: number;
  fromRoomX: number;
  fromRoomY: number;
  toRoomX: number;
  toRoomY: number;
  x: number;
  y: number;
}

export type RankedRunTraceGoalEventType =
  | 'collectible'
  | 'enemy'
  | 'checkpoint'
  | 'reach_exit'
  | 'finish'
  | 'complete';

export interface RankedRunTraceGoalEvent {
  atMs: number;
  type: RankedRunTraceGoalEventType;
  roomId: string | null;
  roomX: number;
  roomY: number;
  x: number;
  y: number;
  instanceId: string | null;
  checkpointIndex: number | null;
}

export interface RankedRunVerificationTrace {
  schemaVersion: number;
  verificationNonce: string;
  snapshotHash: string;
  traceDurationMs: number;
  inputEvents: RankedRunTraceInputEvent[];
  breadcrumbs: RankedRunTraceBreadcrumb[];
  roomTransitions: RankedRunTraceRoomTransition[];
  goalEvents: RankedRunTraceGoalEvent[];
}

export function normalizeRankedRunVerificationTrace(
  value: unknown
): RankedRunVerificationTrace | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<RankedRunVerificationTrace>;
  const verificationNonce =
    typeof candidate.verificationNonce === 'string' ? candidate.verificationNonce.trim() : '';
  const snapshotHash =
    typeof candidate.snapshotHash === 'string' ? candidate.snapshotHash.trim() : '';
  const schemaVersion = normalizeInteger(candidate.schemaVersion);
  const traceDurationMs = normalizeInteger(candidate.traceDurationMs);

  if (!verificationNonce || !snapshotHash || schemaVersion === null || traceDurationMs === null) {
    return null;
  }

  const inputEvents = normalizeInputEvents(candidate.inputEvents);
  const breadcrumbs = normalizeBreadcrumbs(candidate.breadcrumbs);
  const roomTransitions = normalizeRoomTransitions(candidate.roomTransitions);
  const goalEvents = normalizeGoalEvents(candidate.goalEvents);

  if (!inputEvents || !breadcrumbs || !roomTransitions || !goalEvents) {
    return null;
  }

  return {
    schemaVersion,
    verificationNonce,
    snapshotHash,
    traceDurationMs,
    inputEvents,
    breadcrumbs,
    roomTransitions,
    goalEvents,
  };
}

function normalizeInputEvents(value: unknown): RankedRunTraceInputEvent[] | null {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: RankedRunTraceInputEvent[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    const candidate = entry as Partial<RankedRunTraceInputEvent>;
    if (
      candidate.control !== 'moveX' &&
      candidate.control !== 'moveY' &&
      candidate.control !== 'jump'
    ) {
      return null;
    }
    const atMs = normalizeInteger(candidate.atMs);
    const valueNormalized = normalizeTraceValue(candidate.value);
    if (atMs === null || valueNormalized === null) {
      return null;
    }
    normalized.push({
      atMs,
      control: candidate.control,
      value: valueNormalized,
    });
  }

  return normalized;
}

function normalizeBreadcrumbs(value: unknown): RankedRunTraceBreadcrumb[] | null {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: RankedRunTraceBreadcrumb[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    const candidate = entry as Partial<RankedRunTraceBreadcrumb>;
    const atMs = normalizeInteger(candidate.atMs);
    const roomX = normalizeInteger(candidate.roomX);
    const roomY = normalizeInteger(candidate.roomY);
    const x = normalizeNumber(candidate.x);
    const y = normalizeNumber(candidate.y);
    const vx = normalizeNumber(candidate.vx);
    const vy = normalizeNumber(candidate.vy);
    if (
      atMs === null ||
      roomX === null ||
      roomY === null ||
      x === null ||
      y === null ||
      vx === null ||
      vy === null ||
      typeof candidate.grounded !== 'boolean'
    ) {
      return null;
    }
    normalized.push({
      atMs,
      roomX,
      roomY,
      x,
      y,
      vx,
      vy,
      grounded: candidate.grounded,
    });
  }

  return normalized;
}

function normalizeRoomTransitions(value: unknown): RankedRunTraceRoomTransition[] | null {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: RankedRunTraceRoomTransition[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    const candidate = entry as Partial<RankedRunTraceRoomTransition>;
    const atMs = normalizeInteger(candidate.atMs);
    const fromRoomX = normalizeInteger(candidate.fromRoomX);
    const fromRoomY = normalizeInteger(candidate.fromRoomY);
    const toRoomX = normalizeInteger(candidate.toRoomX);
    const toRoomY = normalizeInteger(candidate.toRoomY);
    const x = normalizeNumber(candidate.x);
    const y = normalizeNumber(candidate.y);
    if (
      atMs === null ||
      fromRoomX === null ||
      fromRoomY === null ||
      toRoomX === null ||
      toRoomY === null ||
      x === null ||
      y === null
    ) {
      return null;
    }
    normalized.push({
      atMs,
      fromRoomX,
      fromRoomY,
      toRoomX,
      toRoomY,
      x,
      y,
    });
  }

  return normalized;
}

function normalizeGoalEvents(value: unknown): RankedRunTraceGoalEvent[] | null {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: RankedRunTraceGoalEvent[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    const candidate = entry as Partial<RankedRunTraceGoalEvent>;
    if (
      candidate.type !== 'collectible' &&
      candidate.type !== 'enemy' &&
      candidate.type !== 'checkpoint' &&
      candidate.type !== 'reach_exit' &&
      candidate.type !== 'finish' &&
      candidate.type !== 'complete'
    ) {
      return null;
    }
    const atMs = normalizeInteger(candidate.atMs);
    const roomX = normalizeInteger(candidate.roomX);
    const roomY = normalizeInteger(candidate.roomY);
    const x = normalizeNumber(candidate.x);
    const y = normalizeNumber(candidate.y);
    if (
      atMs === null ||
      roomX === null ||
      roomY === null ||
      x === null ||
      y === null
    ) {
      return null;
    }
    normalized.push({
      atMs,
      type: candidate.type,
      roomId: typeof candidate.roomId === 'string' && candidate.roomId.trim() ? candidate.roomId : null,
      roomX,
      roomY,
      x,
      y,
      instanceId:
        typeof candidate.instanceId === 'string' && candidate.instanceId.trim()
          ? candidate.instanceId
          : null,
      checkpointIndex: normalizeInteger(candidate.checkpointIndex),
    });
  }

  return normalized;
}

function normalizeInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value);
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function normalizeTraceValue(value: unknown): number | boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  return normalizeNumber(value);
}
