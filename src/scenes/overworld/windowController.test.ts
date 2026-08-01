import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {},
}));

vi.mock('../../ui/appFeedback', () => ({
  hideBusyOverlay: vi.fn(),
  isAppReady: vi.fn(() => true),
  isBusyOverlayVisible: vi.fn(() => false),
  markAppReady: vi.fn(),
  setBootProgress: vi.fn(),
  setBootStatus: vi.fn(),
  showBootFailure: vi.fn(),
  showBusyError: vi.fn(),
  showBusyOverlay: vi.fn(),
}));

import { OverworldWindowController } from './windowController';

function createHarness(options: {
  mode?: 'browse' | 'play';
  snapshotAvailable?: boolean;
  overviewAvailable?: boolean;
} = {}) {
  const coordinates = { x: 0, y: 0 };
  let snapshotAvailable = options.snapshotAvailable ?? false;
  const overviewAvailable = options.overviewAvailable ?? snapshotAvailable;
  const worldStreamingController = {
    needsRefreshAround: vi.fn(() => false),
    isWithinLoadedRoomBounds: vi.fn(() => true),
    getRoomSnapshotForCoordinates: vi.fn(() => (
      snapshotAvailable || overviewAvailable
        ? { id: '0,0', coordinates }
        : null
    )),
    getPlayableRoomSnapshotForCoordinates: vi.fn(() => (
      snapshotAvailable
        ? { id: '0,0', coordinates }
        : null
    )),
    refreshVisibleSelectionFromCache: vi.fn(),
    refreshAround: vi.fn(async (): Promise<'success' | 'cancelled' | 'error'> => 'cancelled'),
    refreshLoadedChunksIfChanged: vi.fn(async (): Promise<'updated' | 'unchanged' | 'cancelled' | 'error'> => 'unchanged'),
  };
  const host = {
    worldStreamingController,
    getMode: vi.fn(() => options.mode ?? 'play'),
    getRefreshCenterCoordinates: vi.fn(() => ({ ...coordinates })),
    setWindowCenterCoordinates: vi.fn(),
    updateSelectedSummary: vi.fn(),
    refreshLeaderboardForSelection: vi.fn(async () => undefined),
    updateCameraBounds: vi.fn(),
    syncModeRuntime: vi.fn(),
    syncPreviewVisibility: vi.fn(),
    syncPresenceSubscriptions: vi.fn(),
    syncGhostVisibility: vi.fn(),
    syncRoomComments: vi.fn(),
    redrawWorld: vi.fn(),
    renderHud: vi.fn(),
    hideLoadingText: vi.fn(),
    getTimeNow: vi.fn(() => 0),
    getBrowseRefreshIntervalMs: vi.fn(() => 1_000),
    getPlayRefreshIntervalMs: vi.fn(() => 1_000),
  };
  const scene = {
    scene: {
      isActive: vi.fn(() => true),
      isPaused: vi.fn(() => false),
      key: 'OverworldPlayScene',
    },
  };
  return {
    controller: new OverworldWindowController(scene as never, host as never),
    host,
    setSnapshotAvailable: (value: boolean) => {
      snapshotAvailable = value;
    },
    worldStreamingController,
  };
}

describe('overworld cached-window play hydration', () => {
  it('starts a full refresh when Play has no current room snapshot', async () => {
    const { controller, worldStreamingController } = createHarness();

    controller.refreshAroundIfNeededOrFromCache(
      { x: 0, y: 0 },
      { preferCachedWindow: true },
    );

    await vi.waitFor(() => {
      expect(worldStreamingController.refreshAround).toHaveBeenCalledWith(
        { x: 0, y: 0 },
        {},
      );
    });
  });

  it('does not treat an overview-only preview as a playable snapshot', async () => {
    const { controller, worldStreamingController } = createHarness({
      overviewAvailable: true,
    });

    controller.refreshAroundIfNeededOrFromCache(
      { x: 0, y: 0 },
      { preferCachedWindow: true },
    );

    await vi.waitFor(() => {
      expect(worldStreamingController.refreshAround).toHaveBeenCalledWith(
        { x: 0, y: 0 },
        {},
      );
    });
  });

  it('uses only the current cache when the Play snapshot is already loaded', () => {
    const { controller, worldStreamingController } = createHarness({
      snapshotAvailable: true,
    });

    controller.refreshAroundIfNeededOrFromCache(
      { x: 0, y: 0 },
      { preferCachedWindow: true },
    );

    expect(worldStreamingController.refreshAround).not.toHaveBeenCalled();
  });

  it('does not fetch a missing full snapshot while browsing', () => {
    const { controller, worldStreamingController } = createHarness({ mode: 'browse' });

    controller.refreshAroundIfNeededOrFromCache(
      { x: 0, y: 0 },
      { preferCachedWindow: true },
    );

    expect(worldStreamingController.refreshAround).not.toHaveBeenCalled();
  });

  it('retries a cancelled window recenter until it succeeds', async () => {
    const { controller, host, worldStreamingController } = createHarness({
      snapshotAvailable: true,
    });
    worldStreamingController.needsRefreshAround.mockReturnValue(true);
    worldStreamingController.refreshAround
      .mockResolvedValueOnce('cancelled')
      .mockImplementationOnce(async () => {
        worldStreamingController.needsRefreshAround.mockReturnValue(false);
        return 'success';
      });

    controller.refreshAroundIfNeededOrFromCache(
      { x: -2, y: 0 },
      { preferCachedWindow: true },
    );

    await vi.waitFor(() => {
      expect(worldStreamingController.refreshAround).toHaveBeenCalledTimes(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    host.getTimeNow.mockReturnValue(1_000);
    await vi.waitFor(() => {
      controller.maybeRefreshVisibleChunks();
      expect(worldStreamingController.refreshAround).toHaveBeenCalledTimes(2);
    });

    // Once satisfied, the pending recenter is dropped and no more refreshes run.
    host.getTimeNow.mockReturnValue(10_000);
    controller.maybeRefreshVisibleChunks();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worldStreamingController.refreshAround).toHaveBeenCalledTimes(2);
  });

  it('repairs a stale window from the update loop when no recenter is pending', async () => {
    const { controller, worldStreamingController } = createHarness({
      snapshotAvailable: true,
    });
    worldStreamingController.needsRefreshAround.mockReturnValue(true);
    worldStreamingController.refreshAround.mockImplementationOnce(async () => {
      worldStreamingController.needsRefreshAround.mockReturnValue(false);
      return 'success';
    });

    controller.maybeRefreshVisibleChunks();

    await vi.waitFor(() => {
      expect(worldStreamingController.refreshAround).toHaveBeenCalledTimes(1);
    });
  });

  it('drops a pending recenter when another refresh already covered it', async () => {
    const { controller, worldStreamingController } = createHarness({
      snapshotAvailable: true,
    });
    worldStreamingController.needsRefreshAround.mockReturnValue(true);
    worldStreamingController.refreshAround.mockResolvedValueOnce('cancelled');

    controller.refreshAroundIfNeededOrFromCache(
      { x: -2, y: 0 },
      { preferCachedWindow: true },
    );
    await vi.waitFor(() => {
      expect(worldStreamingController.refreshAround).toHaveBeenCalledTimes(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    worldStreamingController.needsRefreshAround.mockReturnValue(false);
    controller.maybeRefreshVisibleChunks();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worldStreamingController.refreshAround).toHaveBeenCalledTimes(1);
  });

  it('retries missing Play hydration after an in-flight refresh cancels it', async () => {
    const {
      controller,
      host,
      setSnapshotAvailable,
      worldStreamingController,
    } = createHarness();
    worldStreamingController.refreshAround
      .mockResolvedValueOnce('cancelled')
      .mockImplementationOnce(async () => {
        setSnapshotAvailable(true);
        return 'success';
      });

    controller.refreshAroundIfNeededOrFromCache(
      { x: 0, y: 0 },
      { preferCachedWindow: true },
    );

    await vi.waitFor(() => {
      expect(worldStreamingController.refreshAround).toHaveBeenCalledTimes(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    host.getTimeNow.mockReturnValue(100);
    await vi.waitFor(() => {
      controller.maybeRefreshVisibleChunks();
      expect(worldStreamingController.refreshAround).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(host.syncModeRuntime).toHaveBeenCalledTimes(2);
    });
  });
});
