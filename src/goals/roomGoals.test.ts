import { describe, expect, it } from 'vitest';
import {
  cloneRoomGoal,
  createDefaultRoomGoal,
  getRoomGoalPublishValidationError,
  normalizeRoomGoal,
} from './roomGoals';

describe('NPC Quest room goals', () => {
  it('creates a protect quest with first-NPC fallback semantics', () => {
    expect(createDefaultRoomGoal('npc_quest')).toEqual({
      type: 'npc_quest',
      questType: 'protect',
      npcInstanceId: null,
      durationMs: 30_000,
      requiredCount: 3,
      destination: null,
      timeLimitMs: null,
    });
  });

  it('normalizes and clones all NPC Quest fields', () => {
    const normalized = normalizeRoomGoal({
      type: 'npc_quest',
      questType: 'escort',
      npcInstanceId: ' npc-1 ',
      durationMs: 12_000,
      requiredCount: 4,
      destination: { x: 120, y: 240 },
    });

    expect(normalized).toEqual({
      type: 'npc_quest',
      questType: 'escort',
      npcInstanceId: 'npc-1',
      durationMs: 12_000,
      requiredCount: 4,
      destination: { x: 120, y: 240 },
      timeLimitMs: null,
    });
    expect(cloneRoomGoal(normalized)).toEqual(normalized);
    expect(cloneRoomGoal(normalized)).not.toBe(normalized);
  });

  it('validates linked NPCs, escort destinations, and Give inventory', () => {
    const context = {
      collectiblesPlaced: 2,
      collectModeEnemyCount: 0,
      npcInstanceIds: ['npc-1'],
    };

    expect(getRoomGoalPublishValidationError({
      type: 'npc_quest',
      questType: 'escort',
      npcInstanceId: 'npc-1',
      durationMs: 30_000,
      requiredCount: 1,
      destination: null,
      timeLimitMs: null,
    }, context)).toBe('Escort needs a destination marker.');

    expect(getRoomGoalPublishValidationError({
      type: 'npc_quest',
      questType: 'give',
      npcInstanceId: 'npc-1',
      durationMs: 30_000,
      requiredCount: 3,
      destination: null,
      timeLimitMs: null,
    }, context)).toContain('only 2 are placed');
  });
});
