import { describe, expect, it, vi } from 'vitest';
import { createDefaultCourseSnapshot, type CourseGoal } from '../../courses/model';
import { createActiveExpandedRoomRunState, tickActiveExpandedRoomRun } from './expandedRoomRuns';
import { getExpandedRoomGoalBadgeText, isExpandedRoomDraftPreviewReady, recordExpandedRoomRunCollectibleCollected, recordExpandedRoomRunEnemyDefeated } from './expandedRoomRuns';
import { EXPANDED_ROOM_GOAL_RULES, type ExpandedRoomGoalRuleRegistry } from './expandedRoomGoalRules';

describe('course death feedback clock', () => {
  it.each<CourseGoal>([
    { type: 'reach_exit', exit: { roomId: '0,0', x: 64, y: 256 }, timeLimitMs: null },
    { type: 'checkpoint_sprint', checkpoints: [{ roomId: '0,0', x: 64, y: 256 }],
      finish: { roomId: '0,0', x: 96, y: 256 }, timeLimitMs: null },
    { type: 'survival', durationMs: 1000 },
  ])('counts the death beat without completing a %s goal or touching markers', goal => {
    const run = createActiveExpandedRoomRunState({ course: { ...createDefaultCourseSnapshot('test'), goal },
      returnCoordinates: { x: 0, y: 0 }, leaderboardEligible: false, enemyTarget: null });
    run.elapsedMs = 950; run.deaths = 1;
    const touchesCoursePoint = vi.fn(() => true);
    const result = tickActiveExpandedRoomRun(run, { delta: 180, suspendGoalResolution: true,
      touchesCoursePoint, getPlayerEffectOrigin: () => ({ x: 64, y: 256 }) });
    expect(run.elapsedMs).toBe(1130); expect(run.deaths).toBe(1);
    expect(run.checkpointsReached).toBe(0); expect(touchesCoursePoint).not.toHaveBeenCalled();
    expect(result.terminalResult).toBeNull(); expect(result.verificationGoalEvent).toBeNull();
  });

  it('applies an expired time limit after the brief hold without losing those milliseconds', () => {
    const run = createActiveExpandedRoomRunState({ course: { ...createDefaultCourseSnapshot('test'),
      goal: { type: 'reach_exit', exit: { roomId: '0,0', x: 64, y: 256 }, timeLimitMs: 1000 } },
      returnCoordinates: { x: 0, y: 0 }, leaderboardEligible: false, enemyTarget: null });
    run.elapsedMs = 950;
    const options = { touchesCoursePoint: () => true, getPlayerEffectOrigin: () => null };
    tickActiveExpandedRoomRun(run, { ...options, delta: 180, suspendGoalResolution: true });
    expect(tickActiveExpandedRoomRun(run, { ...options, delta: 1 }).terminalResult).toBe('failed');
    expect(run.elapsedMs).toBe(1131);
  });
});

describe('expanded-room run rules', () => {
  const point = { roomId: '0,0', x: 64, y: 256 };
  const createRun = (goal: CourseGoal | null, enemyTarget: number | null = null) => createActiveExpandedRoomRunState({
    course: { ...createDefaultCourseSnapshot('test'), goal },
    returnCoordinates: { x: 0, y: 0 }, leaderboardEligible: false, enemyTarget,
  });

  it('requires every supported goal rule, including explicit event-driven goals', () => {
    expect(Object.keys(EXPANDED_ROOM_GOAL_RULES).sort()).toEqual(['checkpoint_sprint', 'collect_target', 'defeat_all', 'reach_exit', 'survival']);
    // @ts-expect-error Every supported goal must have a rule.
    const missingRules: ExpandedRoomGoalRuleRegistry = {};
    void missingRules;
    expect(getExpandedRoomGoalBadgeText(null)).toBe('Expanded Room');
  });

  it('records one checkpoint per frame and finishes only on a later tick', () => {
    const run = createRun({ type: 'checkpoint_sprint', checkpoints: [point, point], finish: point, timeLimitMs: null });
    const getPlayerEffectOrigin = vi.fn(() => ({ x: 64, y: 256 }));
    const options = { delta: 1, touchesCoursePoint: () => true, getPlayerEffectOrigin };
    const first = tickActiveExpandedRoomRun(run, options);
    expect(first.verificationGoalEvent).toEqual({ type: 'checkpoint', marker: point, checkpointIndex: 0 });
    expect(first.verificationGoalEvent?.marker).toBe(point);
    expect(first.terminalResult).toBeNull();
    expect(run.checkpointsReached).toBe(1);
    const second = tickActiveExpandedRoomRun(run, options);
    expect(second.verificationGoalEvent?.checkpointIndex).toBe(1);
    expect(second.terminalResult).toBeNull();
    expect(tickActiveExpandedRoomRun(run, options)).toMatchObject({ terminalResult: 'completed', terminalMessage: 'Sprint clear.', verificationGoalEvent: { type: 'finish' } });
    expect(getPlayerEffectOrigin).toHaveBeenCalledTimes(2);
    expect(run.result).toBe('active'); // The host owns finalization and side effects.
  });

  it('checks timeouts before marker contact and leaves counters unchanged', () => {
    const run = createRun({ type: 'reach_exit', exit: point, timeLimitMs: 1000 });
    run.elapsedMs = 999;
    const touchesCoursePoint = vi.fn(() => true);
    expect(tickActiveExpandedRoomRun(run, { delta: 1, touchesCoursePoint, getPlayerEffectOrigin: () => null })).toMatchObject({ terminalResult: 'failed', terminalMessage: 'Time up.', verificationGoalEvent: null });
    expect(touchesCoursePoint).not.toHaveBeenCalled();
    expect(run.elapsedMs).toBe(1000);
  });

  it('keeps events driven by caller targets even with no goal, and stops counting after host finalization', () => {
    const run = createRun(null, 2);
    run.collectibleTarget = 1;
    expect(recordExpandedRoomRunEnemyDefeated(run)).toMatchObject({ changed: true, terminalResult: null });
    expect(recordExpandedRoomRunEnemyDefeated(run)).toMatchObject({ terminalResult: 'completed', terminalMessage: 'All enemies defeated.' });
    expect(recordExpandedRoomRunCollectibleCollected(run)).toMatchObject({ terminalResult: 'completed', terminalMessage: 'Collection target reached.' });
    run.result = 'completed';
    expect(recordExpandedRoomRunEnemyDefeated(run).changed).toBe(false);
    expect(recordExpandedRoomRunCollectibleCollected(run).changed).toBe(false);
    expect([run.enemiesDefeated, run.collectiblesCollected]).toEqual([2, 1]);
    expect(recordExpandedRoomRunEnemyDefeated(null).changed).toBe(false);
  });

  it('keeps marker-less goals playable and checks cell membership and required start markers', () => {
    const run = createRun({ type: 'collect_target', requiredCount: 5, timeLimitMs: null });
    run.course.roomRefs = [{ roomId: '0,0', coordinates: { x: 0, y: 0 }, roomVersion: 1, roomTitle: null }];
    expect(isExpandedRoomDraftPreviewReady(run.course, '0,0')).toBe(true);
    expect(isExpandedRoomDraftPreviewReady(run.course, '1,0')).toBe(false);
    run.course.goal = { type: 'reach_exit', exit: point, timeLimitMs: null };
    expect(isExpandedRoomDraftPreviewReady(run.course, '0,0')).toBe(false);
    run.course.startPoint = point;
    expect(isExpandedRoomDraftPreviewReady(run.course, '0,0')).toBe(true);
    run.course.goal.exit = null;
    expect(isExpandedRoomDraftPreviewReady(run.course, '0,0')).toBe(false);
  });
});
