import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { CollectTargetGoal, NpcQuestGoal, RoomGoal } from '../../goals/roomGoals';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import type { RunRepository } from '../../runs/runRepository';
import type { GuestRunPlaybackController } from './guestRunPlayback';
import { GOAL_LIFECYCLE_RULES, type GoalLifecycleRegistry } from './goalLifecycleRules';
import { OverworldGoalRunController } from './goalRuns';

vi.mock('../../auth/client', () => ({ getAuthDebugState: () => ({ authenticated: false, source: null, user: null }) }));
vi.mock('../../persistence/roomRepository', () => ({ createRoomRepository: () => ({}) }));
vi.mock('../../progression/postRunRatingEvents', () => ({ requestPostRunGuestClaim: vi.fn(), requestPostRunRating: vi.fn() }));
vi.mock('../../progression/rewardStings', async importOriginal => ({ ...await importOriginal<typeof import('../../progression/rewardStings')>(), notifyRewardStings: vi.fn() }));
const base = createDefaultRoomSnapshot();
const npc: NpcQuestGoal = { type: 'npc_quest', questType: 'protect', npcInstanceId: null, durationMs: 3000, requiredCount: 2, destination: null, timeLimitMs: null };
function start(goal: RoomGoal, entry: 'spawn' | 'transition' = 'spawn', guestRuns?: GuestRunPlaybackController) {
  const repository = { startRun: vi.fn(), finishRun: vi.fn(), loadRoomLeaderboard: vi.fn(), loadGlobalLeaderboard: vi.fn() };
  const controller = new OverworldGoalRunController({ playerHeight: 14, runRepository: repository as unknown as RunRepository, guestRuns, getScore: () => 0, getAuthenticated: () => false, getAuthSource: () => 'session', getAuthDisplayName: () => null, countRoomObjectsByCategory: () => 0 });
  const mutation = controller.syncRunForRoom({ ...base, status: 'published', spawnPoint: { x: 64, y: 256 }, goal }, entry);
  return { controller, repository, mutation, run: controller.getCurrentRun()! };
}

describe('goal lifecycle contracts', () => {
  it('requires per-goal lifecycle/status policies with correlated handlers', () => {
    // @ts-expect-error A new goal must explicitly choose a lifecycle policy.
    const missing: GoalLifecycleRegistry = {};
    void missing;
    // @ts-expect-error Presentation cannot be omitted while event handlers compile.
    const incomplete: GoalLifecycleRegistry['collect_target'] = { ...GOAL_LIFECYCLE_RULES.collect_target, status: undefined };
    void incomplete;
    expectTypeOf(GOAL_LIFECYCLE_RULES.collect_target.status).parameter(0).toEqualTypeOf<CollectTargetGoal>();
  });

  it('discovers an NPC during practice, then keeps the first resolved identity', () => {
    const { controller, run } = start(npc, 'transition');
    expect(run.qualificationState).toBe('practice');
    controller.resolveNpcTarget(null);
    controller.resolveNpcTarget('guide');
    controller.resolveNpcTarget('other');
    expect(run.npcTargetInstanceId).toBe('guide');
    expect(controller.recordNpcDefeated(base.id, 'guide', 'Ada').changed).toBe(false);
    expect(run.npcAlive).toBe(true);
  });

  it('accepts a defeat only from the bound room/NPC and ignores late events', () => {
    const { controller, run } = start({ ...npc, npcInstanceId: 'guide' });
    expect(controller.recordNpcDefeated('other-room', 'guide', 'Ada').changed).toBe(false);
    expect(controller.recordNpcDefeated(base.id, 'other', 'Ada').changed).toBe(false);
    expect(controller.recordNpcDefeated(base.id, null, 'Ada').changed).toBe(false);
    expect(controller.recordNpcDefeated(base.id, 'guide', 'Ada')).toMatchObject({ event: 'fail', transientStatus: 'Ada was defeated.' });
    expect(run).toMatchObject({ npcAlive: false, result: 'failed' });
    expect(controller.recordNpcDefeated(base.id, 'guide', 'Later').changed).toBe(false);
    expect(run.completionMessage).toBe('Ada was defeated.');
  });

  it('gates delivery by count and room while escort ignores delivery events', () => {
    const give = start({ ...npc, questType: 'give' });
    give.run.collectiblesCollected = 1;
    expect(give.controller.recordGiveReturned(base.id).changed).toBe(false);
    give.run.collectiblesCollected = 2;
    expect(give.controller.recordGiveReturned('other-room').changed).toBe(false);
    expect(give.controller.recordGiveReturned(base.id)).toMatchObject({ event: 'complete', transientStatus: 'Delivery complete.' });
    const escort = start({ ...npc, questType: 'escort' });
    escort.run.collectiblesCollected = 9;
    expect(escort.controller.recordGiveReturned(base.id).changed).toBe(false);
    expect(escort.controller.recordNpcReachedDestination(base.id)).toMatchObject({ event: 'complete', transientStatus: 'Escort complete.' });
  });

  it('counts checkpoints only in a qualified active checkpoint run', () => {
    const sprint = start({ type: 'checkpoint_sprint', checkpoints: [{ x: 16, y: 32 }], finish: { x: 48, y: 32 }, timeLimitMs: null });
    sprint.run.qualificationState = 'practice';
    expect(sprint.controller.recordCheckpointReached().changed).toBe(false);
    sprint.run.qualificationState = 'qualified';
    expect(sprint.controller.recordCheckpointReached()).toMatchObject({ event: 'checkpoint', transientStatus: 'Checkpoint 1 reached.' });
    expect(sprint.run).toMatchObject({ checkpointsReached: 1, nextCheckpointIndex: 1 });
    sprint.controller.markCompleted('Finished.');
    expect(sprint.controller.recordCheckpointReached().changed).toBe(false);
    expect(start(npc).controller.recordCheckpointReached().changed).toBe(false);
  });

  it('starts guest capture before an empty defeat goal completes', () => {
    const observed: string[] = [];
    const guestRuns = { begin: vi.fn(run => observed.push(run.result)), has: () => false } as unknown as GuestRunPlaybackController;
    const result = start({ type: 'defeat_all', timeLimitMs: null }, 'spawn', guestRuns);
    expect(observed).toEqual(['active']);
    expect(result.mutation).toMatchObject({ event: 'complete', transientStatus: 'No enemies remain.' });
    expect(result.run.result).toBe('completed');
    expect(result.repository.startRun).not.toHaveBeenCalled();
  });
});
