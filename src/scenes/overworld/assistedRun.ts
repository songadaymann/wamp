export const ASSIST_RUN_MESSAGE = 'Assist practice. No records, XP or saved clears.';
interface AssistRun {
  assisted?: boolean;
  result: string;
  leaderboardEligible: boolean;
  attemptId: string | null;
  submissionState: string;
  submissionMessage: string | null;
  pendingResult: string | null;
  verificationSchemaVersion: number | null;
  verificationNonce: string | null;
  snapshotHash: string | null;
  guestProgress?: unknown;
}
/** Assistance taints the whole attempt, even if it is switched off before the finish. */
export function markRunAssisted(run: AssistRun | null): boolean {
  if (!run || run.assisted || run.result !== 'active') return false;
  run.assisted = true;
  run.leaderboardEligible = false;
  run.attemptId = null;
  run.submissionState = 'local-only';
  run.submissionMessage = ASSIST_RUN_MESSAGE;
  run.pendingResult = null;
  run.verificationSchemaVersion = null;
  run.verificationNonce = null;
  run.snapshotHash = null;
  delete run.guestProgress;
  return true;
}
