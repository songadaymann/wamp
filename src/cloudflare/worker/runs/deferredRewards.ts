import type { WorkerExecutionContextLike } from '../core/types';

/**
 * Points, XP, the creator's rewards, stats, badges and activity emails for a finished
 * run. With an execution context they run after the response, so the player waits only
 * for the run to be recorded and ranked (that used to take over 100 sequential D1 reads
 * and writes). A failure is logged with the attempt id instead of failing a finish that
 * is already saved. Without a context (tests, scripts) the work runs inline.
 */
export async function scheduleRunRewards(
  context: WorkerExecutionContextLike | undefined,
  attemptId: string,
  work: () => Promise<void>,
): Promise<void> {
  if (!context) {
    await work();
    return;
  }

  context.waitUntil(work().catch((error: unknown) => {
    console.error(JSON.stringify({
      event: 'run-rewards-failed',
      attemptId,
      message: error instanceof Error ? error.message : String(error),
    }));
  }));
}
