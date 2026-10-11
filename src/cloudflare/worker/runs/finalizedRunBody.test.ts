// What the server accepts as a completed room run, per goal type (F064). The client's goal
// controller is not the judge; this is.
import { describe, expect, it } from 'vitest';
import type { RoomGoal } from '../../../goals/roomGoals';
import type { RunFinishRequestBody } from '../../../runs/model';
import { normalizeFinalizedRunBody } from './requestBodies';

const caps = { maxCollectibles: 4, maxEnemies: 3, maxCheckpoints: 2 };
function body(overrides: Partial<RunFinishRequestBody> = {}): RunFinishRequestBody {
  return {
    result: 'completed', elapsedMs: 20_000, deaths: 0, collectiblesCollected: 0,
    enemyCollectiblesCollected: 0, enemiesDefeated: 0, checkpointsReached: 0, ...overrides,
  };
}
function check(goal: RoomGoal, overrides: Partial<RunFinishRequestBody> = {}, reportedElapsedMs = overrides.elapsedMs ?? 20_000) {
  return () => normalizeFinalizedRunBody(goal, body(overrides), caps, reportedElapsedMs);
}
const rejected = (fn: () => unknown, message: RegExp) => expect(fn).toThrow(message);

describe('completed room runs the server accepts (F064)', () => {
  it('zeroes the counters of failed and abandoned runs instead of judging them', () => {
    for (const result of ['failed', 'abandoned'] as const) {
      expect(normalizeFinalizedRunBody({ type: 'defeat_all', timeLimitMs: null },
        body({ result, collectiblesCollected: 9, enemyCollectiblesCollected: 9, enemiesDefeated: 9, checkpointsReached: 9 }), caps, 1000))
        .toMatchObject({ result, collectiblesCollected: 0, enemyCollectiblesCollected: 0, enemiesDefeated: 0, checkpointsReached: 0 });
    }
  });

  it('rejects any timed goal finished after its published limit', () => {
    rejected(check({ type: 'reach_exit', exit: { x: 1, y: 1 }, timeLimitMs: 10_000 }, {}, 10_001), /within the published time limit/);
    expect(check({ type: 'reach_exit', exit: { x: 1, y: 1 }, timeLimitMs: 10_000 }, {}, 10_000)).not.toThrow();
  });

  it('reach_exit: has no further requirement', () => {
    expect(check({ type: 'reach_exit', exit: { x: 1, y: 1 }, timeLimitMs: null })).not.toThrow();
  });

  it('collect_target: needs the required count', () => {
    const goal: RoomGoal = { type: 'collect_target', requiredCount: 3, timeLimitMs: null };
    rejected(check(goal, { collectiblesCollected: 2 }), /collect-target runs must meet/);
    expect(check(goal, { collectiblesCollected: 3 })).not.toThrow();
  });

  it('collect_race: must end by time or exhaustion, and the player must be ahead', () => {
    const untimed: RoomGoal = { type: 'collect_race', timeLimitMs: null };
    rejected(check(untimed, { collectiblesCollected: 2, enemyCollectiblesCollected: 1 }), /must end when time expires or all collectibles are claimed/);
    expect(check(untimed, { collectiblesCollected: 3, enemyCollectiblesCollected: 1 })).not.toThrow();
    rejected(check(untimed, { collectiblesCollected: 2, enemyCollectiblesCollected: 2 }), /must beat the Sword Hunter/);
    const timed: RoomGoal = { type: 'collect_race', timeLimitMs: 30_000 };
    expect(check(timed, { collectiblesCollected: 1 }, 30_000)).not.toThrow();
    rejected(check(timed, { collectiblesCollected: 1 }, 29_999), /must end when time expires/);
  });

  it('defeat_all: needs every published enemy', () => {
    const goal: RoomGoal = { type: 'defeat_all', timeLimitMs: null };
    rejected(check(goal, { enemiesDefeated: 2 }), /must clear every published enemy/);
    expect(check(goal, { enemiesDefeated: 3 })).not.toThrow();
  });

  it('checkpoint_sprint: needs every checkpoint', () => {
    const goal: RoomGoal = { type: 'checkpoint_sprint', checkpoints: [{ x: 1, y: 1 }, { x: 2, y: 2 }], finish: { x: 3, y: 3 }, timeLimitMs: null };
    rejected(check(goal, { checkpointsReached: 1 }), /must hit every checkpoint/);
    expect(check(goal, { checkpointsReached: 2 })).not.toThrow();
  });

  it('survival: needs the full duration', () => {
    const goal = { type: 'survival', durationMs: 30_000 } as RoomGoal;
    rejected(check(goal, { elapsedMs: 29_999 }), /must last the full published duration/);
    expect(check(goal, { elapsedMs: 30_000 })).not.toThrow();
  });

  it('npc_quest: protect needs the duration, give needs the items, escort has no counter', () => {
    const npc = { type: 'npc_quest', npcInstanceId: 'npc-1', durationMs: 15_000, requiredCount: 2, destination: null, timeLimitMs: null } as const;
    rejected(check({ ...npc, questType: 'protect' }, { elapsedMs: 14_999 }), /protect runs must last/);
    expect(check({ ...npc, questType: 'protect' }, { elapsedMs: 15_000 })).not.toThrow();
    rejected(check({ ...npc, questType: 'give' }, { collectiblesCollected: 1 }), /give runs must collect/);
    expect(check({ ...npc, questType: 'give' }, { collectiblesCollected: 2 })).not.toThrow();
    expect(check({ ...npc, questType: 'escort' })).not.toThrow();
  });
});
