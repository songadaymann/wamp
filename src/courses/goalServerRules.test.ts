import { describe, expect, it } from 'vitest';
import { COURSE_SERVER_RULES, getCourseGoalPublishError, removeCourseGoalRoom, type CourseServerRegistry } from './goalServerRules';
import { createDefaultCourseGoal } from './model';

describe('Expanded Room server goal boundaries', () => {
  it('requires every supported goal and preserves validation error priority', () => {
    // @ts-expect-error A supported goal cannot omit server policy.
    const missing: CourseServerRegistry = {};
    void missing;
    expect(COURSE_SERVER_RULES.defeat_all.countsEnemies).toBe(true);
    expect(getCourseGoalPublishError(createDefaultCourseGoal('defeat_all'), [], 0)).toMatch(/at least one enemy/);
    expect(getCourseGoalPublishError(createDefaultCourseGoal('defeat_all'), [], 1)).toBeNull();
    const sprint = { type: 'checkpoint_sprint' as const, checkpoints: [], finish: null, timeLimitMs: null };
    expect(getCourseGoalPublishError(sprint, [], 0)).toMatch(/at least one checkpoint/);
    const checkpoint = { roomId: 'missing', x: 8, y: 32 };
    expect(getCourseGoalPublishError({ ...sprint, checkpoints: [checkpoint] }, [], 0)).toMatch(/need a finish/);
    expect(getCourseGoalPublishError({ ...sprint, checkpoints: [checkpoint], finish: checkpoint }, [], 0)).toMatch(/must belong/);
  });
  it('removes only a deleted cell and retains the existing copy/reference rules', () => {
    const point = { roomId: 'A', x: 8, y: 32 }, other = { roomId: 'B', x: 24, y: 48 };
    const exit = { type: 'reach_exit' as const, exit: point, timeLimitMs: null };
    expect(removeCourseGoalRoom(exit, 'B')).toBe(exit); expect(removeCourseGoalRoom(exit, 'A')).toEqual({ ...exit, exit: null });
    const sprint = { type: 'checkpoint_sprint' as const, checkpoints: [point, other], finish: other, timeLimitMs: null };
    const after = removeCourseGoalRoom(sprint, 'A'); expect(after).toEqual({ ...sprint, checkpoints: [other] });
    expect(after.finish).toBe(other); expect(after.checkpoints[0]).toBe(other); expect(sprint.checkpoints).toEqual([point, other]);
    expect(removeCourseGoalRoom(sprint, 'absent')).not.toBe(sprint);
    const survival = createDefaultCourseGoal('survival'); expect(removeCourseGoalRoom(survival, 'A')).toBe(survival);
  });
});
