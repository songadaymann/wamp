import { describe, expect, it } from 'vitest';
import {
  cloneRoomGoal,
  createDefaultRoomGoal,
  getRoomGoalPublishValidationError,
  normalizeRoomGoal,
} from './roomGoals';

describe('room goal publish checks', () => {
  const empty = { collectiblesPlaced: 0, enemyCount: 0, collectModeEnemyCount: 0 };

  it.each([
    ['reach_exit', /Set Exit/],
    ['checkpoint_sprint', /Set Finish/],
    ['defeat_all', /at least one enemy/],
  ] as const)('rejects an unfinished %s goal', (type, message) => {
    expect(getRoomGoalPublishValidationError(createDefaultRoomGoal(type), empty)).toMatch(message);
  });

  it('accepts placed markers, including a finish-only sprint, and retains goal-less rooms', () => {
    expect(getRoomGoalPublishValidationError({ type: 'reach_exit', exit: { x: 0, y: 0 }, timeLimitMs: null }, empty)).toBeNull();
    expect(getRoomGoalPublishValidationError({ type: 'checkpoint_sprint', checkpoints: [], finish: { x: 100, y: 100 }, timeLimitMs: null }, empty)).toBeNull();
    expect(getRoomGoalPublishValidationError(createDefaultRoomGoal('defeat_all'), { ...empty, enemyCount: 1 })).toBeNull();
    expect(getRoomGoalPublishValidationError(null, empty)).toBeNull();
    expect(getRoomGoalPublishValidationError(createDefaultRoomGoal('collect_target'), empty)).toMatch(/only placed 0/);
  });
});

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
      enemyCount: 0,
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
