import type { RunResult } from '../../../runs/model';
import { HttpError } from '../core/http';
import type { Env, WorkerExecutionContextLike } from '../core/types';
import type { RunFinishOrder } from './points';
import type { RunVerificationStatus } from './verification';

export interface RunFinishMessages {
  missingTrace: string;
  unverified: string;
  timedOut: string;
  finalized: string;
}

interface StoredRunOutcome {
  result: RunResult;
  verificationStatus?: RunVerificationStatus | null;
  verificationReason?: string | null;
}

/** The 409 for a finish whose verification failed or timed out. Its row is already final. */
export function runVerificationError(
  status: RunVerificationStatus | null | undefined,
  reason: string | null | undefined,
  messages: RunFinishMessages,
): HttpError | null {
  if (status === 'failed') {
    return new HttpError(409, reason === 'missing_trace'
      ? messages.missingTrace
      : reason === 'trace_client_outdated'
        ? 'Client update required for ranked verification.'
        : messages.unverified);
  }
  return status === 'timeout' ? new HttpError(409, messages.timedOut) : null;
}

/**
 * A resent finish (lost reply, client timeout, or a resend racing the original) gets the stored
 * outcome instead of a second finalize. This throws the original verification 409, or "already
 * finalized" for a different result, and returns when the same result already counted (F351).
 */
export function assertReplayableRunFinish<T extends StoredRunOutcome>(
  stored: T | null,
  requested: RunResult,
  messages: RunFinishMessages,
): asserts stored is T {
  if (!stored || stored.result === 'active' || stored.result !== requested) {
    throw new HttpError(409, messages.finalized);
  }
  const error = runVerificationError(stored.verificationStatus, stored.verificationReason, messages);
  if (error) throw error;
}

/**
 * Whether a guarded finalize statement (UPDATE ... RETURNING) claimed the still-active row. Its
 * RETURNING rows are the answer; D1's change count is read only when a result carries no rows array.
 */
export function finalizeStatementWon(result: { results?: unknown[]; meta?: { changes?: number } } | undefined): boolean {
  return Array.isArray(result?.results) ? result.results.length > 0 : (result?.meta?.changes ?? 0) > 0;
}

export type RunFinishKind = 'room' | 'course' | 'expanded_room';

/** A resend re-runs the reward step only for a finish this recent; older ones just replay (F351). */
export const RUN_RESETTLE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Whether this finish's reward step wrote its run_settlements row (its last step). */
export async function runFinishSettled(env: Env, kind: RunFinishKind, attemptId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS settled FROM run_settlements WHERE attempt_kind = ? AND attempt_id = ? LIMIT 1')
    .bind(kind, attemptId).first<{ settled: number }>();
  return Boolean(row);
}

/**
 * Whether a resend should re-run the reward step: the finish is recent and its reward step never
 * finished. Every award is keyed and adds to the totals with its own event, so a re-run only fills
 * in what is missing. Older finishes (including every one before this table) replay their outcome:
 * re-judging rank XP against today's board would reward the wrong thing.
 */
export async function runNeedsResettle(
  env: Env,
  kind: RunFinishKind,
  attemptId: string,
  finishedAt: string | null,
): Promise<boolean> {
  const finished = finishedAt ? Date.parse(finishedAt) : Number.NaN;
  if (!Number.isFinite(finished) || Date.now() - finished > RUN_RESETTLE_WINDOW_MS) return false;
  return !(await runFinishSettled(env, kind, attemptId));
}

/** The reward step's last write: every award above it finished. */
export async function recordRunSettlement(env: Env, kind: RunFinishKind, attemptId: string): Promise<void> {
  await env.DB.batch([env.DB.prepare(`INSERT OR IGNORE INTO run_settlements (attempt_kind, attempt_id, settled_at)
    VALUES (?, ?, ?)`).bind(kind, attemptId, new Date().toISOString())]);
}

/**
 * This run's place in commit order, for first-clear and personal-best checks. finalize_seq is
 * numbered inside the finalize batch; the stored finish time is taken before verification, so a
 * resend keeps the original clear's place. It reads only this, so it can load beside the run (F333).
 */
export async function loadRunFinishOrder(
  env: Env,
  table: 'room_runs' | 'course_runs' | 'expanded_room_runs',
  attemptId: string,
): Promise<RunFinishOrder> {
  const row = await env.DB.prepare(`SELECT finalize_seq, finished_at FROM ${table} WHERE attempt_id = ? LIMIT 1`)
    .bind(attemptId).first<{ finalize_seq: number | null; finished_at: string | null }>();
  return { finalizeSeq: row?.finalize_seq ?? null, finishedAt: row?.finished_at ?? new Date().toISOString(), attemptId };
}

/**
 * Waits on independent finish steps together, so they cost one database wait instead of one each
 * (F333). Unlike Promise.all, every step finishes before this returns or throws (none keeps running
 * past the reply), and the failure thrown is the first in argument order, as when they ran in turn.
 */
export async function awaitInOrder<T extends readonly unknown[] | []>(
  steps: T,
): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
  const settled = await Promise.allSettled(steps);
  for (const step of settled) if (step.status === 'rejected') throw step.reason;
  return settled.map((step) => (step as PromiseFulfilledResult<unknown>).value) as { -readonly [P in keyof T]: Awaited<T[P]> };
}

/**
 * Starts a read the finish needs later, so it shares a wait with earlier steps (F333). A failure
 * surfaces where the read is awaited; if an earlier step throws first, it is dropped, not unhandled.
 */
export function readAhead<T>(read: Promise<T>): Promise<T> {
  read.catch(() => {});
  return read;
}

/** SET clause numbering a finalize in commit order (writes to one D1 database are serialized). */
export function nextFinalizeSeqSql(table: 'room_runs' | 'course_runs' | 'expanded_room_runs'): string {
  // The WHERE matches the partial unique index, so this reads one index entry, not the table.
  return `finalize_seq = (SELECT COALESCE(MAX(finalize_seq), 0) + 1 FROM ${table} WHERE finalize_seq IS NOT NULL)`;
}

/**
 * Work after the finalize commit. The reply still waits for it, but a client that disconnects
 * (Workers cancel the handler, not waitUntil work) cannot cut it off halfway.
 */
export async function runPastDisconnect(
  context: WorkerExecutionContextLike | undefined,
  attemptId: string,
  work: Promise<void>,
): Promise<void> {
  context?.waitUntil(work.catch((error: unknown) => {
    console.error(JSON.stringify({ event: 'run-finish-settle-failed', attemptId,
      message: error instanceof Error ? error.message : String(error) }));
  }));
  await work;
}
