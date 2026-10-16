import { describe, expect, expectTypeOf, it } from 'vitest';
import { createDefaultRoomGoal, type CollectTargetGoal, type RoomGoal } from '../../goals/roomGoals';
import { GOAL_AUTHORING_RULES, type GoalAuthoringRegistry } from './goalAuthoringRules';
import { getRoomGoalAuthoringControls, placeRoomGoalMarker, removeRoomGoalMarkerAt, withNpcQuestType, withRoomGoalRequiredCount, withRoomGoalSurvivalSeconds, withRoomGoalTimeLimitSeconds } from './goalDocument';

describe('goal authoring contracts', () => {
  it('requires all goal types and their authoring policies with correlated field types', () => {
    // @ts-expect-error Every new goal needs an explicit editor rule.
    const missing: GoalAuthoringRegistry = {};
    void missing;
    // @ts-expect-error Field and mutation policy omissions cannot silently use a default.
    const incomplete: GoalAuthoringRegistry['collect_target'] = { ...GOAL_AUTHORING_RULES.collect_target, fields: undefined };
    void incomplete;
    expectTypeOf(GOAL_AUTHORING_RULES.collect_target.requiredCount).parameter(0).toEqualTypeOf<CollectTargetGoal>();
    expectTypeOf(GOAL_AUTHORING_RULES.checkpoint_sprint.placeMarker).parameter(0).toEqualTypeOf<Extract<RoomGoal, {type: 'checkpoint_sprint'}>>();
  });

  it('keeps NPC quest controls and edits aligned while preserving inactive fields', () => {
    const protect = withNpcQuestType(createDefaultRoomGoal('npc_quest'), 'protect');
    expect(getRoomGoalAuthoringControls(protect)).toMatchObject({ survivalHidden: false, requiredCountHidden: true, timeLimitHidden: true, placeNpcDestinationHidden: true });
    expect(withRoomGoalRequiredCount(protect, 9)).toEqual(protect);
    const give = withNpcQuestType(withRoomGoalSurvivalSeconds(protect, 12), 'give');
    expect(getRoomGoalAuthoringControls(give)).toMatchObject({ survivalHidden: true, requiredCountHidden: false, requiredCountValue: '3', placeNpcDestinationHidden: true });
    expect(withRoomGoalSurvivalSeconds(give, 99)).toEqual(give);
    const escort = withNpcQuestType(withRoomGoalRequiredCount(give, 7), 'escort');
    expect(getRoomGoalAuthoringControls(escort)).toMatchObject({ survivalHidden: true, requiredCountHidden: true, placeNpcDestinationHidden: false });
    expect(escort).toMatchObject({ durationMs: 12000, requiredCount: 7 });
    expect(withRoomGoalTimeLimitSeconds(escort, 2)).toEqual(escort);
    expect(protect).toMatchObject({ durationMs: 30000, requiredCount: 3 });
  });

  it('keeps marker removal strictly within 16px, with first-checkpoint ties and finish priority', () => {
    const goal: RoomGoal = { type: 'checkpoint_sprint', checkpoints: [{ x: 0, y: 0 }, { x: 2, y: 0 }], finish: null, timeLimitMs: null };
    expect(removeRoomGoalMarkerAt(goal, 1, 0)).toMatchObject({ checkpoints: [{ x: 2, y: 0 }] });
    expect(removeRoomGoalMarkerAt(goal, 18, 0)).toBeNull();
    expect(removeRoomGoalMarkerAt(goal, 17.999, 0)).toMatchObject({ checkpoints: [{ x: 0, y: 0 }] });
    const overlap = { ...goal, finish: { x: 15, y: 0 } };
    expect(removeRoomGoalMarkerAt(overlap, 0, 0)).toEqual({ ...goal, finish: null });
    expect(goal.checkpoints).toHaveLength(2);
  });

  it('clones owned markers and snapshots even for unsupported field edits', () => {
    const point = { x: 12, y: 16 };
    const goal = createDefaultRoomGoal('checkpoint_sprint');
    const placed = placeRoomGoalMarker(goal, 'checkpoint', point)!;
    point.x = 99;
    expect(placed).toMatchObject({ goal: { checkpoints: [{ x: 12, y: 16 }] }, placementComplete: false });
    const next = withRoomGoalRequiredCount(placed.goal, 7);
    expect(next).toEqual(placed.goal);
    expect(next).not.toBe(placed.goal);
    if (next.type !== 'checkpoint_sprint' || placed.goal.type !== 'checkpoint_sprint') throw new Error('Wrong goal');
    expect(next.checkpoints).not.toBe(placed.goal.checkpoints);
    expect(next.checkpoints[0]).not.toBe(placed.goal.checkpoints[0]);
    next.checkpoints[0].x = 55;
    expect(placed.goal.checkpoints[0].x).toBe(12);
    expect(placeRoomGoalMarker(goal, 'npc', point, 'npc-1')).toBeNull();
  });

  it('removes only an NPC destination, preserving its linked NPC and quest settings', () => {
    const goal: RoomGoal = { ...createDefaultRoomGoal('npc_quest'), type: 'npc_quest', questType: 'escort', npcInstanceId: 'guide', durationMs: 1000, requiredCount: 4, destination: { x: 12, y: 16 }, timeLimitMs: null };
    expect(removeRoomGoalMarkerAt(goal, 12, 16)).toEqual({ ...goal, destination: null });
    expect(goal.destination).toEqual({ x: 12, y: 16 });
    expect(getRoomGoalAuthoringControls(null)).toMatchObject({ timeLimitHidden: true, requiredCountHidden: true, survivalHidden: true, linkNpcHidden: true, placeExitNeeded: false, placeFinishNeeded: false });
  });
});
