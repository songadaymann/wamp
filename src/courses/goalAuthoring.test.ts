import { describe, expect, expectTypeOf, it } from 'vitest';
import { buildExpandedEditorMarkers, clearExpandedGoalMarkers, EXPANDED_GOAL_AUTHORING_RULES, expandedGoalRoomRemovalReason, expandedGoalSetupError, getExpandedGoalAuthoringFields, moveExpandedGoalCheckpoint, placeExpandedGoalMarker, removeExpandedGoalCheckpoint, removeExpandedGoalMarker, setExpandedGoalDuration, setExpandedGoalRequiredCount, setExpandedGoalTimeLimit, type ExpandedGoalAuthoringRegistry } from './goalAuthoring';
import { cloneCourseSnapshot, createDefaultCourseSnapshot, type CourseGoal, type CourseMarkerPoint } from './model';

const point = (roomId: string, x: number, y = 32): CourseMarkerPoint => ({ roomId, x, y });
const sprint = (): Extract<CourseGoal, {type: 'checkpoint_sprint'}> => ({ type: 'checkpoint_sprint', checkpoints: [point('0,0',10), point('0,0',14), point('1,0',12)], finish: point('0,0',12), timeLimitMs: null });

describe('Expanded Room authoring contracts', () => {
  it('requires all supported goal policies and correlates their data', () => {
    // @ts-expect-error New supported goals need an authoring policy.
    const missing: ExpandedGoalAuthoringRegistry = {};
    void missing;
    // @ts-expect-error A view cannot silently omit setup readiness.
    const incomplete: ExpandedGoalAuthoringRegistry['checkpoint_sprint'] = { ...EXPANDED_GOAL_AUTHORING_RULES.checkpoint_sprint, setupError: undefined };
    void incomplete;
    expectTypeOf(EXPANDED_GOAL_AUTHORING_RULES.checkpoint_sprint.placeMarker).parameter(0).toEqualTypeOf<Extract<CourseGoal, {type:'checkpoint_sprint'}>>();
  });

  it('preserves owned fractional values and ignores fields unsupported by the goal', () => {
    const collect: CourseGoal = { type: 'collect_target', requiredCount: 3, timeLimitMs: null };
    expect(setExpandedGoalRequiredCount(collect,1.6)).toBe(true);
    expect(setExpandedGoalTimeLimit(collect,1234)).toBe(true);
    expect(setExpandedGoalDuration(collect,9000)).toBe(false);
    expect(collect).toEqual({ type: 'collect_target', requiredCount: 1.6, timeLimitMs: 1234 });
    const survival: CourseGoal = { type:'survival', durationMs:30000 };
    expect(setExpandedGoalTimeLimit(survival,1000)).toBe(false);
    expect(setExpandedGoalRequiredCount(survival,7)).toBe(false);
    expect(setExpandedGoalDuration(survival,1600)).toBe(true);
    expect(getExpandedGoalAuthoringFields(survival)).toMatchObject({ durationEditable:true, requiredCountEditable:false, timeLimitEditable:false, durationMs:1600 });
  });

  it('removes the finish first, then the first nearby checkpoint within the same cell', () => {
    const goal = sprint();
    expect(removeExpandedGoalMarker(goal,'0,0',13,32)).toBe(true);
    expect(goal.finish).toBeNull();
    expect(removeExpandedGoalMarker(goal,'0,0',13,32)).toBe(true);
    expect(goal.checkpoints).toEqual([point('0,0',14),point('1,0',12)]);
    expect(removeExpandedGoalMarker(goal,'0,0',30,32)).toBe(false);
    expect(removeExpandedGoalMarker(goal,'missing',12,32)).toBe(false);
    expect(goal.checkpoints).toHaveLength(2);
  });

  it('retains marker references and each surface label while cloning drafts independently', () => {
    const draft=createDefaultCourseSnapshot('test');draft.goal={type:'reach_exit',exit:point('1,0',20),timeLimitMs:null};draft.startPoint=point('0,0',10);
    const canvas=buildExpandedEditorMarkers(draft,'canvas'),cell=buildExpandedEditorMarkers(draft,'cell');
    expect(canvas.map(m=>m.label)).toEqual(['START','EXIT']);
    expect(cell.map(m=>m.label)).toEqual(['START',null]);
    expect(canvas[0].point).toBe(draft.startPoint);
    expect(canvas[1].point).toBe(draft.goal.exit);
    const clone=cloneCourseSnapshot(draft);clearExpandedGoalMarkers(clone.goal);
    expect(draft.goal.exit).toEqual(point('1,0',20));
    expect(clone.goal).toMatchObject({exit:null});
  });

  it('reorders/removes checkpoints without changing cell identity, and protects their cells', () => {
    const goal=sprint();const first=goal.checkpoints[0];
    moveExpandedGoalCheckpoint(goal,0,1);
    expect(goal.checkpoints.map(p=>p.x)).toEqual([14,10,12]);
    expect(goal.checkpoints[1]).toBe(first);
    expect(expandedGoalRoomRemovalReason(goal,'0,0')).toBe('Remove the finish marker first.');
    removeExpandedGoalCheckpoint(goal,0);
    expect(goal.checkpoints).toEqual([point('0,0',10),point('1,0',12)]);
    goal.finish=null;
    expect(expandedGoalRoomRemovalReason(goal,'1,0')).toBe('Remove checkpoints in this room first.');
  });

  it('keeps marker modes and setup error priority explicit', () => {
    const goal=sprint();clearExpandedGoalMarkers(goal);
    expect(expandedGoalSetupError(goal)).toContain('add at least one checkpoint');
    const marker=point('1,0',48);
    expect(placeExpandedGoalMarker(goal,'exit',marker)).toBe(false);
    expect(placeExpandedGoalMarker(goal,'checkpoint',marker)).toBe(true);
    expect(goal.checkpoints[0]).toBe(marker);
    expect(expandedGoalSetupError(goal)).toContain('place a finish marker');
    expect(placeExpandedGoalMarker(goal,'finish',marker)).toBe(true);
    expect(expandedGoalSetupError(goal)).toBeNull();
  });
});
