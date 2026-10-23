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
  it('runs only the gameplay queues in Browse frames, so rooms loaded while browsing warm up', () => {
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
      hasQueuedWorkAtPriority: vi.fn(() => false),
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
});
