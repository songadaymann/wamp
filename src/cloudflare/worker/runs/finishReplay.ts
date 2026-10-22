import type { RunResult } from '../../../runs/model';
import { HttpError } from '../core/http';
import type { Env, WorkerExecutionContextLike } from '../core/types';
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
export function assertReplayableRunFinish(
  stored: StoredRunOutcome | null,
  requested: RunResult,
  messages: RunFinishMessages,
): void {
  if (!stored || stored.result === 'active' || stored.result !== requested) {
    throw new HttpError(409, messages.finalized);
  }
  const error = runVerificationError(stored.verificationStatus, stored.verificationReason, messages);
  if (error) throw error;
}

/** Whether this guarded finalize statement claimed the still-active row (RETURNING rows, or D1's change count). */
export function finalizeStatementWon(result: { results?: unknown[]; meta?: { changes?: number } } | undefined): boolean {
  return (result?.results?.length ?? 0) > 0 || (result?.meta?.changes ?? 0) > 0;
}

/**
 * The finish's deferred rewards write the run_finalized point event last, so its presence means
 * the rewards finished. Without it, a resend runs the settle step again; every award is keyed.
 */
export async function runFinishSettled(env: Env, attemptId: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT 1 AS settled FROM point_events
    WHERE event_type = 'run_finalized' AND source_key = ? LIMIT 1`).bind(attemptId).first<{ settled: number }>();
  return Boolean(row);
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
