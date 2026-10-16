import { describe, expect, expectTypeOf, it } from 'vitest';
import { createDefaultRoomGoal } from './roomGoals';
import { GOAL_SAFETY_RULES, goalCheckpoints, goalEndsOnDeath, goalIsTimed, goalValidationMarkers, type GoalSafetyRegistry } from './goalSafety';
import type { CourseMarkerPoint } from '../courses/model';
import { buildRoomTemplate } from '../templates/roomTemplates';
import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import { buildReadyToPublishChecklist } from '../scenes/editor/clearCheck';

describe('shared goal safety boundaries', () => {
  it('requires each goal to choose its safety behavior and preserves Expanded Room marker identity', () => {
    // @ts-expect-error Every goal type requires an explicit safety policy.
    const missing: GoalSafetyRegistry = {};
    void missing;
    // @ts-expect-error A goal cannot silently omit its death policy.
    const incomplete: GoalSafetyRegistry['survival'] = { ...GOAL_SAFETY_RULES.survival, endsOnDeath: undefined };
    void incomplete;
    const point = { roomId: '1,2', x: 8, y: 32 };
    const markers = goalValidationMarkers<CourseMarkerPoint>({ type: 'reach_exit', exit: point, timeLimitMs: null });
    expectTypeOf(markers[0].point).toEqualTypeOf<CourseMarkerPoint | null>();
    expect(markers).toEqual([{ point, label: 'Exit' }]); expect(markers[0].point).toBe(point);
  });
  it('keeps death resets distinct from timers, especially NPC protect and limited exits', () => {
    const protect = createDefaultRoomGoal('npc_quest');
    if (protect.type !== 'npc_quest') throw new Error('Expected NPC Quest');
    expect(goalIsTimed(protect)).toBe(true); expect(goalEndsOnDeath(protect)).toBe(false);
    expect(goalIsTimed({ ...protect, type: 'npc_quest', questType: 'escort' })).toBe(false);
    expect(goalIsTimed({ type: 'reach_exit', exit: null, timeLimitMs: 0 })).toBe(true);
    expect(goalIsTimed(createDefaultRoomGoal('survival'))).toBe(true);
    expect(goalEndsOnDeath(createDefaultRoomGoal('survival'))).toBe(true); expect(goalEndsOnDeath(null)).toBe(false);
  });
  it('checks only escort destinations, never starts or inactive NPC destinations, and stays advisory', () => {
    const room = buildRoomTemplate(createDefaultRoomSnapshot(), 'flat_run', 'forest');
    room.tileData.terrain[19][36] = 13;
    room.placedObjects.push({ id: 'jimothy', instanceId: 'guide', x: 120, y: 320 });
    const goal = { type: 'npc_quest' as const, questType: 'escort' as const, npcInstanceId: 'guide', durationMs: 30000, requiredCount: 1, destination: { x: 584, y: 320 }, timeLimitMs: null };
    room.goal = goal;
    const row = () => buildReadyToPublishChecklist(room).rows.find(row => row.id === 'goal');
    expect(row()?.detail).toBe('A goal marker is inside terrain. Move it or test its reach.');
    expect(buildReadyToPublishChecklist(room).publishError).toBeNull();
    for (const questType of ['protect', 'give'] as const) {
      room.goal = { ...goal, questType }; expect(goalValidationMarkers(room.goal)).toEqual([]);
      expect(row()?.detail).not.toContain('inside terrain');
    }
    room.goal = { type: 'reach_exit', exit: { x: 120, y: 320 }, timeLimitMs: null };
    room.spawnPoint = goal.destination;
    expect(row()?.state).toBe('ready');
    expect(buildReadyToPublishChecklist(room).rows.find(row => row.id === 'start')?.state).toBe('warning');
    const checkpoints = [{ x: 10, y: 20 }];
    expect(goalCheckpoints({ type: 'checkpoint_sprint', checkpoints, finish: null, timeLimitMs: null })).toBe(checkpoints);
  });
});
