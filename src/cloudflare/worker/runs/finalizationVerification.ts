import type { TrustTier } from '../../../progression/model';
import { HttpError } from '../core/http';
import {
  relaxVerificationTriggerForTrustTier,
  type RunVerificationAuditInput,
  type RunVerificationDerivedMetrics,
  type RunVerificationResult,
  type RunVerificationTriggerResult,
} from './verification';

type FinalizationAudit = Pick<RunVerificationAuditInput,
  'status' | 'triggerReason' | 'verificationReason' | 'summary'>;

/** Shared ranked-run policy. Snapshot loading and trace validation stay inside
 * verify so their HttpErrors retain the existing missing-trace classification.
 * Persistence and audit writes remain ordered by the content-specific route. */
export async function evaluateRunFinalizationVerification(
  baseTrigger: RunVerificationTriggerResult | null,
  trustTier: TrustTier,
  verify: () => Promise<RunVerificationResult>,
  expandedRoomId?: string,
) {
  const trigger = baseTrigger === null ? null : relaxVerificationTriggerForTrustTier(baseTrigger, trustTier);
  const context = expandedRoomId === undefined ? {} : { expandedRoomId };
  if (!trigger?.required) {
    const audit: FinalizationAudit | null = trustTier === 'T1' && baseTrigger?.required
      ? {
          status: 'skipped',
          triggerReason: baseTrigger.reason ?? 'record_gap',
          verificationReason: null,
          summary: { trigger: baseTrigger, ...context, policy: 't1_audit_only', trustTier, verifier: null },
        }
      : null;
    return { status: 'not_required' as const, reason: null, result: null, audit };
  }

  let result: RunVerificationResult;
  try {
    result = await verify();
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    result = {
      status: 'failed',
      reason: 'missing_trace',
      derivedMetrics: { collectiblesCollected: 0, enemyCollectiblesCollected: 0, enemiesDefeated: 0, checkpointsReached: 0 },
      summary: { issue: 'missing_trace' },
    };
  }
  const audit: FinalizationAudit = {
    status: result.status,
    triggerReason: trigger.reason ?? 'record_gap',
    verificationReason: result.reason,
    summary: { trigger, verifier: result.summary, ...context },
  };
  return { status: result.status, reason: result.reason, result, audit };
}

/** Only metrics common to room and course bodies. Room enemy collectibles and
 * goal normalization deliberately remain with the room finalizer. */
export function applyVerifiedRunMetrics<T>(body: T, metrics: RunVerificationDerivedMetrics): T & {
  collectiblesCollected: number;
  enemiesDefeated: number;
  checkpointsReached: number;
} {
  return {
    ...body,
    collectiblesCollected: metrics.collectiblesCollected,
    enemiesDefeated: metrics.enemiesDefeated,
    checkpointsReached: metrics.checkpointsReached,
  };
}
