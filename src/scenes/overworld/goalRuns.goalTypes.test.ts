// Characterization of how each room goal type completes, fails or ignores events on the
// client (F064). Runs are signed out, so they stay local and make no network calls.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomGoal } from '../../goals/roomGoals';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import type { RunRepository } from '../../runs/runRepository';
import { OverworldGoalRunController } from './goalRuns';

vi.mock('../../auth/client', () => ({ getAuthDebugState: () => ({ authenticated: false, source: null, user: null }) }));
vi.mock('../../persistence/roomRepository', () => ({ createRoomRepository: () => ({}) }));
vi.mock('../../progression/postRunRatingEvents', () => ({ requestPostRunGuestClaim: vi.fn(), requestPostRunRating: vi.fn() }));
vi.mock('../../progression/rewardStings', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../progression/rewardStings')>(), notifyRewardStings: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

const ROOM_ID = createDefaultRoomSnapshot().id;

function startRun(goal: RoomGoal, counts: { collectible?: number; enemy?: number } = {}, entry: 'spawn' | 'transition' = 'spawn') {
  const runRepository = {
    startRun: vi.fn(), finishRun: vi.fn(),
    loadRoomLeaderboard: vi.fn().mockResolvedValue(null), loadGlobalLeaderboard: vi.fn().mockResolvedValue(null),
  };
  const goals = new OverworldGoalRunController({
    playerHeight: 14,
    runRepository: runRepository as unknown as RunRepository,
    getScore: () => 0,
    getAuthenticated: () => false,
    getAuthSource: () => 'session',
    getAuthDisplayName: () => null,
    countRoomObjectsByCategory: (_room, category) => (category === 'collectible' ? counts.collectible ?? 0 : category === 'enemy' ? counts.enemy ?? 0 : 0),
  });
  const room = { ...createDefaultRoomSnapshot(), status: 'published' as const, spawnPoint: { x: 64, y: 256 }, goal };
  goals.syncRunForRoom(room, entry);
  return { goals, runRepository, run: () => goals.getCurrentRun()! };
}

describe('room goal runs by goal type (F064)', () => {
  it('starts a signed-out spawn entry as a qualified local-only run', () => {
    const { run, runRepository } = startRun({ type: 'reach_exit', exit: { x: 300, y: 256 }, timeLimitMs: null });
    expect(run()).toMatchObject({ qualificationState: 'qualified', submissionState: 'local-only', leaderboardEligible: false, result: 'active' });
    expect(runRepository.startRun).not.toHaveBeenCalled();
  });

  it('reach_exit: fails at its time limit, and ignores collectibles and enemies', () => {
    const { goals, run } = startRun({ type: 'reach_exit', exit: { x: 300, y: 256 }, timeLimitMs: 5000 });
    expect(goals.recordCollectibleCollected(ROOM_ID).changed).toBe(false);
    expect(goals.recordEnemyDefeated(ROOM_ID, 'Slime').changed).toBe(false);
    goals.tick(4999);
    expect(run().result).toBe('active');
    expect(goals.tick(1)).toMatchObject({ event: 'fail', transientStatus: 'Time up.' });
    expect(run()).toMatchObject({ result: 'failed', pendingResult: 'failed' });
  });

  it('collect_target: completes on the required count, counting only its own room', () => {
    const { goals, run } = startRun({ type: 'collect_target', requiredCount: 3, timeLimitMs: null });
    expect(run().collectibleTarget).toBe(3);
    expect(goals.recordCollectibleCollected('9,9').changed).toBe(false);
    goals.recordCollectibleCollected(ROOM_ID);
    goals.recordCollectibleCollected(ROOM_ID);
    expect(run().result).toBe('active');
    expect(goals.recordCollectibleCollected(ROOM_ID)).toMatchObject({ event: 'complete', transientStatus: 'Collection target reached.' });
    expect(run()).toMatchObject({ result: 'completed', collectiblesCollected: 3 });
  });

  it('collect_race: the player wins with more, ties fail, and time up settles the score', () => {
    const won = startRun({ type: 'collect_race', timeLimitMs: null }, { collectible: 4 });
    expect(won.run().collectibleTarget).toBe(4);
    won.goals.recordCollectibleCollected(ROOM_ID);
    won.goals.recordEnemyCollectibleCollected(ROOM_ID);
    won.goals.recordCollectibleCollected(ROOM_ID);
    expect(won.goals.recordCollectibleCollected(ROOM_ID)).toMatchObject({ event: 'complete', transientStatus: 'Collect race won 3-1.' });

    const tied = startRun({ type: 'collect_race', timeLimitMs: null }, { collectible: 2 });
    tied.goals.recordEnemyCollectibleCollected(ROOM_ID);
    expect(tied.goals.recordCollectibleCollected(ROOM_ID)).toMatchObject({ event: 'fail', transientStatus: 'Collect race tied 1-1.' });

    const timed = startRun({ type: 'collect_race', timeLimitMs: 10_000 }, { collectible: 6 });
    timed.goals.recordCollectibleCollected(ROOM_ID);
    expect(timed.goals.tick(10_000)).toMatchObject({ event: 'complete', transientStatus: 'Collect race won 1-0.' });
  });

  it('defeat_all: completes when every enemy in the room is defeated', () => {
    const { goals, run } = startRun({ type: 'defeat_all', timeLimitMs: null }, { enemy: 2 });
    expect(goals.recordEnemyDefeated(ROOM_ID, 'Slime')).toMatchObject({ changed: true, transientStatus: 'Slime defeated.', event: null });
    expect(goals.recordEnemyDefeated(ROOM_ID, 'Bat')).toMatchObject({ event: 'complete', transientStatus: 'All enemies defeated.' });
    expect(run().enemiesDefeated).toBe(2);
  });

  it('checkpoint_sprint: counts checkpoints in order; finishing is the caller\'s markCompleted', () => {
    const { goals, run } = startRun({
      type: 'checkpoint_sprint', checkpoints: [{ x: 100, y: 256 }, { x: 200, y: 256 }], finish: { x: 300, y: 256 }, timeLimitMs: null,
    });
    expect(run().checkpointTarget).toBe(2);
    expect(goals.recordCheckpointReached()).toMatchObject({ event: 'checkpoint', transientStatus: 'Checkpoint 1 reached.' });
    goals.recordCheckpointReached();
    expect(run()).toMatchObject({ checkpointsReached: 2, nextCheckpointIndex: 2, result: 'active' });
    expect(goals.markCompleted('Finish reached.').event).toBe('complete');
  });

  it('survival: completes at its duration and has no time-up failure', () => {
    const { goals, run } = startRun({ type: 'survival', durationMs: 5000 });
    goals.tick(4999);
    expect(run().result).toBe('active');
    expect(goals.tick(1)).toMatchObject({ event: 'complete', transientStatus: 'Survival clear.' });
  });

  it('npc_quest protect: completes after the duration, fails if the NPC is defeated', () => {
    const goal = { type: 'npc_quest', questType: 'protect', npcInstanceId: 'npc-1', durationMs: 3000, requiredCount: 0, destination: null, timeLimitMs: null } as const;
    const kept = startRun(goal);
    expect(kept.goals.tick(3000)).toMatchObject({ event: 'complete', transientStatus: 'NPC protected.' });

    const lost = startRun(goal);
    expect(lost.goals.recordNpcDefeated(ROOM_ID, 'someone-else', 'Other').changed).toBe(false);
    expect(lost.goals.recordNpcDefeated(ROOM_ID, 'npc-1', 'Mira')).toMatchObject({ event: 'fail', transientStatus: 'Mira was defeated.' });
    expect(lost.run().npcAlive).toBe(false);
  });

  it('npc_quest give: returning only counts once the required items are collected', () => {
    const { goals } = startRun({ type: 'npc_quest', questType: 'give', npcInstanceId: 'npc-1', durationMs: 0, requiredCount: 2, destination: null, timeLimitMs: null });
    expect(goals.recordGiveReturned(ROOM_ID).changed).toBe(false);
    goals.recordCollectibleCollected(ROOM_ID);
    expect(goals.recordCollectibleCollected(ROOM_ID).transientStatus).toBe('Return to the NPC.');
    expect(goals.recordGiveReturned(ROOM_ID)).toMatchObject({ event: 'complete', transientStatus: 'Delivery complete.' });
  });

  it('npc_quest escort: completes when the NPC reaches its destination', () => {
    const { goals } = startRun({ type: 'npc_quest', questType: 'escort', npcInstanceId: 'npc-1', durationMs: 0, requiredCount: 0, destination: { x: 300, y: 256 }, timeLimitMs: null });
    expect(goals.recordNpcReachedDestination(ROOM_ID)).toMatchObject({ event: 'complete', transientStatus: 'Escort complete.' });
  });

  it('practice runs (entered by walking in) ignore goal events and the clock', () => {
    const { goals, run } = startRun({ type: 'collect_target', requiredCount: 1, timeLimitMs: 1000 }, {}, 'transition');
    expect(run().qualificationState).toBe('practice');
    expect(goals.recordCollectibleCollected(ROOM_ID).changed).toBe(false);
    goals.tick(5000);
    expect(run()).toMatchObject({ elapsedMs: 0, result: 'active' });
  });

  it('counts deaths in a qualified run, and finished runs ignore further events', () => {
    const { goals, run } = startRun({ type: 'collect_target', requiredCount: 1, timeLimitMs: null });
    goals.recordDeath();
    goals.recordDeath();
    expect(run().deaths).toBe(2);
    goals.recordCollectibleCollected(ROOM_ID);
    expect(run().result).toBe('completed');
    expect(goals.markFailed('late').changed).toBe(false);
    expect(goals.abandonActiveRun().changed).toBe(false);
  });

  it('abandoning an active run records an abandoned result', () => {
    const { goals, run } = startRun({ type: 'survival', durationMs: 60_000 });
    expect(goals.abandonActiveRun()).toMatchObject({ event: 'abandon', transientStatus: 'Run abandoned.' });
    expect(run().pendingResult).toBe('abandoned');
  });
});
