import type { RunResult } from '../../../runs/model';
import { HttpError, noContentResponse } from '../core/http';
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
 * outcome rather than a second finalize: 204 when the same result already counted, the original
 * verification 409 when it did not. Rewards were scheduled once, by the request that finalized (F351).
 */
export function replayFinalizedRunFinish(
  request: Request,
  stored: StoredRunOutcome | null,
  requested: RunResult,
  messages: RunFinishMessages,
): Response {
  if (!stored || stored.result === 'active' || stored.result !== requested) {
    throw new HttpError(409, messages.finalized);
  }
  const error = runVerificationError(stored.verificationStatus, stored.verificationReason, messages);
  if (error) throw error;
  return noContentResponse(request);
}
