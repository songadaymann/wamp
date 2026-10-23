import { createWorldStreamingHarness } from './worldStreaming.testHarness';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));

import { enqueueGameplayWarmupWork, FrameWorkCoordinator } from './frameWorkCoordinator';

function streamingHarness(mode: 'play' | 'browse', frameWorkCoordinator: unknown, seamUrgent = false) {
  return Object.assign(createWorldStreamingHarness(), {
    destroyed: false,
    roomArtifactCacheProfile: 'normal',
    frameWorkCoordinator,
    transitionPreparationSeamUrgent: seamUrgent,
    getEffectivePerformanceProfile: vi.fn(() => 'reduced'),
    syncRoomArtifactCachePolicy: vi.fn(),
    options: { getMode: () => mode },
  });
}

describe('world streaming gameplay warm-up frames (F302)', () => {
  it('runs only the gameplay queues in Browse frames, for the room kept from the last run', () => {
    const frameWorkCoordinator = new FrameWorkCoordinator();
    const prepare = vi.fn();
    const warm = vi.fn();
    frameWorkCoordinator.enqueue({
      label: 'prepare-room-runtime-shell:-2,0',
      priority: 'portal-current-destination',
      costKind: 'cpu',
      estimatedCostMs: 1,
      execute: prepare,
    });
    enqueueGameplayWarmupWork(frameWorkCoordinator, 'swordsman-edge-warmup', warm);

    expect(streamingHarness('browse', frameWorkCoordinator).runDiscretionaryFrameWork(4)).toBeNull();
    expect(warm).toHaveBeenCalledOnce();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('caps gameplay work by the device profile when a seam-critical transition lifts the frame', () => {
    const frameWorkCoordinator = {
      runFrame: vi.fn(() => ({ executed: [] })),
      hasQueuedWorkAtPriority: vi.fn((priority: string) => priority === 'gameplay-warmup'),
    };
    streamingHarness('play', frameWorkCoordinator, true).runDiscretionaryFrameWork(4);
    expect(frameWorkCoordinator.runFrame).toHaveBeenLastCalledWith(expect.objectContaining({
      profile: 'normal',
      gameplayCpuCapMs: 1,
    }));

    streamingHarness('browse', frameWorkCoordinator, true).runDiscretionaryFrameWork(4);
    expect(frameWorkCoordinator.runFrame).toHaveBeenLastCalledWith(expect.objectContaining({
      profile: 'reduced',
      gameplayCpuCapMs: 1,
      gameplayOnly: true,
    }));
  });

  it('skips Browse frames entirely while the gameplay queues are empty', () => {
    const frameWorkCoordinator = {
      runFrame: vi.fn(),
      hasQueuedWorkAtPriority: vi.fn(() => false),
    };
    const harness = streamingHarness('browse', frameWorkCoordinator);
    const resolvePolicy = vi.spyOn(harness, 'getResolvedPerformancePolicy');
    expect(harness.runDiscretionaryFrameWork(4)).toBeNull();
    expect(frameWorkCoordinator.runFrame).not.toHaveBeenCalled();
    expect(resolvePolicy).not.toHaveBeenCalled();
  });

  it('runs arrival work requested inside a frame-work job right after the frame, uncharged', () => {
    let clock = 0;
    const frameWorkCoordinator = new FrameWorkCoordinator({ now: () => clock });
    const harness = streamingHarness('play', frameWorkCoordinator);
    const order: string[] = [];
    frameWorkCoordinator.enqueue({
      label: 'commit-prepared-room:2,0',
      priority: 'portal-current-destination',
      costKind: 'cpu',
      estimatedCostMs: 1,
      execute: () => {
        clock += 0.5;
        order.push('commit');
        // The commit spawns the player, whose arrival finishes the room's warm-up.
        harness.runOutsideFrameWork(() => {
          clock += 200;
          order.push('arrival');
        });
        order.push('commit-done');
      },
    });

    const result = harness.runDiscretionaryFrameWork(4);
    expect(order).toEqual(['commit', 'commit-done', 'arrival']);
    expect(result.executed[0].actualDurationMs).toBe(0.5);
    expect(frameWorkCoordinator.getDiagnostics().jobsOver50Ms).toBe(0);

    harness.runOutsideFrameWork(() => order.push('outside'));
    expect(order.at(-1)).toBe('outside');
  });
});
