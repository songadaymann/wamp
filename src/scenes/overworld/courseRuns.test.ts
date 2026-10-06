import { describe, expect, it, vi } from 'vitest';
import { createDefaultCourseSnapshot, type CourseGoal } from '../../courses/model';
import { createActiveCourseRunState, tickActiveCourseRun } from './courseRuns';

describe('course death feedback clock', () => {
  it.each<CourseGoal>([
    { type: 'reach_exit', exit: { roomId: '0,0', x: 64, y: 256 }, timeLimitMs: null },
    { type: 'checkpoint_sprint', checkpoints: [{ roomId: '0,0', x: 64, y: 256 }],
      finish: { roomId: '0,0', x: 96, y: 256 }, timeLimitMs: null },
    { type: 'survival', durationMs: 1000 },
  ])('counts the death beat without completing a %s goal or touching markers', goal => {
    const run = createActiveCourseRunState({ course: { ...createDefaultCourseSnapshot('test'), goal },
      returnCoordinates: { x: 0, y: 0 }, leaderboardEligible: false, enemyTarget: null });
    run.elapsedMs = 950; run.deaths = 1;
    const touchesCoursePoint = vi.fn(() => true);
    const result = tickActiveCourseRun(run, { delta: 180, suspendGoalResolution: true,
      touchesCoursePoint, getPlayerEffectOrigin: () => ({ x: 64, y: 256 }) });
    expect(run.elapsedMs).toBe(1130); expect(run.deaths).toBe(1);
    expect(run.checkpointsReached).toBe(0); expect(touchesCoursePoint).not.toHaveBeenCalled();
    expect(result.terminalResult).toBeNull(); expect(result.verificationGoalEvent).toBeNull();
  });

  it('applies an expired time limit after the brief hold without losing those milliseconds', () => {
    const run = createActiveCourseRunState({ course: { ...createDefaultCourseSnapshot('test'),
      goal: { type: 'reach_exit', exit: { roomId: '0,0', x: 64, y: 256 }, timeLimitMs: 1000 } },
      returnCoordinates: { x: 0, y: 0 }, leaderboardEligible: false, enemyTarget: null });
    run.elapsedMs = 950;
    const options = { touchesCoursePoint: () => true, getPlayerEffectOrigin: () => null };
    tickActiveCourseRun(run, { ...options, delta: 180, suspendGoalResolution: true });
    expect(tickActiveCourseRun(run, { ...options, delta: 1 }).terminalResult).toBe('failed');
    expect(run.elapsedMs).toBe(1131);
  });
});
