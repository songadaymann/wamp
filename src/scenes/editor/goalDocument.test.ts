import { describe, expect, it } from 'vitest';
import { createDefaultRoomGoal, type RoomGoal } from '../../goals/roomGoals';
import {
  buildRoomGoalMarkerDescriptors,
  clearRoomGoalMarkers,
  getRoomGoalSummaryText,
  placeRoomGoalMarker,
  removeRoomGoalMarkerAt,
  roomGoalUsesMarkers,
  withNpcQuestType,
  withRoomGoalRequiredCount,
  withRoomGoalSurvivalSeconds,
  withRoomGoalTimeLimitSeconds,
} from './goalDocument';

describe('room goal document', () => {
  it('updates numeric and NPC goal settings without mutating input', () => {
    const collect = createDefaultRoomGoal('collect_target');
    const timed = withRoomGoalTimeLimitSeconds(collect, 1.234);
    const required = withRoomGoalRequiredCount(timed, 2.6);
    expect(required).toMatchObject({ requiredCount: 3, timeLimitMs: 1234 });
    expect(collect).toMatchObject({ requiredCount: 3, timeLimitMs: null });
    expect(withRoomGoalTimeLimitSeconds(required, 0)).toMatchObject({ timeLimitMs: null });

    const survival = withRoomGoalSurvivalSeconds(createDefaultRoomGoal('survival'), 1.6);
    expect(survival).toMatchObject({ durationMs: 2000 });
    const quest = withNpcQuestType(createDefaultRoomGoal('npc_quest'), 'give');
    expect(withRoomGoalRequiredCount(quest, 0)).toMatchObject({ questType: 'give', requiredCount: 1 });
    expect(withRoomGoalSurvivalSeconds(withNpcQuestType(quest, 'protect'), 3)).toMatchObject({ durationMs: 3000 });
  });

  it('clears only the marker-bearing fields for each goal type', () => {
    const sprint: RoomGoal = {
      type: 'checkpoint_sprint',
      checkpoints: [{ x: 16, y: 32 }],
      finish: { x: 48, y: 64 },
      timeLimitMs: 5000,
    };
    expect(clearRoomGoalMarkers(sprint)).toEqual({
      type: 'checkpoint_sprint',
      checkpoints: [],
      finish: null,
      timeLimitMs: 5000,
    });
    expect(sprint.checkpoints).toHaveLength(1);

    const quest = {
      ...createDefaultRoomGoal('npc_quest'),
      npcInstanceId: 'npc-1',
      destination: { x: 32, y: 48 },
    } as RoomGoal;
    expect(clearRoomGoalMarkers(quest)).toMatchObject({ npcInstanceId: null, destination: null });
  });

  it('places supported markers and reports whether placement completes', () => {
    const exit = placeRoomGoalMarker(createDefaultRoomGoal('reach_exit'), 'exit', { x: 8, y: 16 });
    expect(exit).toEqual({
      goal: { type: 'reach_exit', exit: { x: 8, y: 16 }, timeLimitMs: null },
      placementComplete: true,
    });

    const checkpoint = placeRoomGoalMarker(
      createDefaultRoomGoal('checkpoint_sprint'),
      'checkpoint',
      { x: 24, y: 32 },
    );
    expect(checkpoint).toMatchObject({ placementComplete: false, goal: { checkpoints: [{ x: 24, y: 32 }] } });
    expect(placeRoomGoalMarker(checkpoint!.goal, 'finish', { x: 40, y: 48 })).toMatchObject({
      placementComplete: true,
      goal: { finish: { x: 40, y: 48 } },
    });
    expect(placeRoomGoalMarker(createDefaultRoomGoal('npc_quest'), 'npc', { x: 0, y: 0 })).toBeNull();
    expect(placeRoomGoalMarker(createDefaultRoomGoal('npc_quest'), 'npc', { x: 0, y: 0 }, 'npc-2')).toMatchObject({
      placementComplete: true,
      goal: { npcInstanceId: 'npc-2' },
    });
  });

  it('removes the finish before checkpoints and chooses the nearest checkpoint under 16px', () => {
    const goal: RoomGoal = {
      type: 'checkpoint_sprint',
      checkpoints: [{ x: 10, y: 10 }, { x: 14, y: 10 }],
      finish: { x: 12, y: 10 },
      timeLimitMs: null,
    };
    expect(removeRoomGoalMarkerAt(goal, 12, 10)).toMatchObject({ finish: null, checkpoints: goal.checkpoints });
    expect(removeRoomGoalMarkerAt({ ...goal, finish: null }, 13, 10)).toMatchObject({
      checkpoints: [{ x: 10, y: 10 }],
    });
    expect(removeRoomGoalMarkerAt(goal, 30, 10)).toBeNull();
  });

  it('derives marker descriptors and exact summaries', () => {
    const sprint: RoomGoal = {
      type: 'checkpoint_sprint',
      checkpoints: [{ x: 16, y: 32 }, { x: 48, y: 64 }],
      finish: { x: 80, y: 96 },
      timeLimitMs: null,
    };
    expect(buildRoomGoalMarkerDescriptors(sprint).map(({ label, variant }) => ({ label, variant }))).toEqual([
      { label: '1', variant: 'checkpoint-pending' },
      { label: '2', variant: 'checkpoint-pending' },
      { label: null, variant: 'finish-pending' },
    ]);
    expect(roomGoalUsesMarkers(sprint)).toBe(true);
    expect(roomGoalUsesMarkers(createDefaultRoomGoal('survival'))).toBe(false);

    const context = {
      collectiblesPlaced: 4,
      enemiesPlaced: 2,
      collectModeEnemyCount: 1,
      linkedNpcLabel: 'Ada',
    };
    expect(getRoomGoalSummaryText(sprint, context)).toBe('Hit 2 checkpoints then reach the finish marker.');
    expect(getRoomGoalSummaryText(createDefaultRoomGoal('collect_race'), context)).toBe(
      'Collect more items than the Sword Hunter (4 collectibles, 1 collector).',
    );
    expect(getRoomGoalSummaryText(withNpcQuestType(createDefaultRoomGoal('npc_quest'), 'escort'), context)).toBe(
      'Escort Ada to a destination you still need to place.',
    );
  });
});
