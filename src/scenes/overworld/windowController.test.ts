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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

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
    getPlayableRoomSnapshotViewForCoordinates: vi.fn(() => (
      snapshotAvailable
        ? { id: '0,0', coordinates }
        : null
    )),
    refreshVisibleSelectionFromCache: vi.fn(),
    refreshAround: vi.fn(async (
      _centerCoordinates: { x: number; y: number },
      _refreshOptions: { forceChunkReload?: boolean } = {},
    ): Promise<'success' | 'cancelled' | 'error'> => 'cancelled'),
    refreshLoadedChunksIfChanged: vi.fn(
      async (): Promise<'updated' | 'unchanged' | 'cancelled' | 'error'> => 'unchanged',
    ),
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
    syncFocusedRoomRuntime: vi.fn(),
    syncFocusedRoomVisuals: vi.fn(),
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

  it('uses targeted room runtime work for an ordinary cached focus change', () => {
    const { controller, host, worldStreamingController } = createHarness({
      snapshotAvailable: true,
    });

    controller.refreshAroundIfNeededOrFromCache(
      { x: 0, y: 0 },
      {
        preferCachedWindow: true,
        focusChangeFrom: { x: -1, y: 0 },
      },
    );

    expect(host.syncFocusedRoomRuntime).toHaveBeenCalledWith(
      { x: -1, y: 0 },
      { x: 0, y: 0 },
    );
    expect(host.syncModeRuntime).not.toHaveBeenCalled();
    expect(worldStreamingController.refreshVisibleSelectionFromCache).toHaveBeenCalledTimes(1);
    expect(host.updateCameraBounds).toHaveBeenCalledTimes(1);
    expect(host.syncPreviewVisibility).toHaveBeenCalledTimes(1);
    expect(host.syncGhostVisibility).toHaveBeenCalledTimes(1);
    expect(host.syncFocusedRoomVisuals).toHaveBeenCalledTimes(1);
    expect(host.redrawWorld).not.toHaveBeenCalled();
    expect(host.renderHud).toHaveBeenCalledTimes(1);
  });

  it('keeps full runtime synchronization for non-transition cache refreshes', () => {
    const { controller, host } = createHarness({ snapshotAvailable: true });

    controller.refreshAroundIfNeededOrFromCache(
      { x: 0, y: 0 },
      { preferCachedWindow: true },
    );

    expect(host.syncModeRuntime).toHaveBeenCalledTimes(1);
    expect(host.syncFocusedRoomRuntime).not.toHaveBeenCalled();
    expect(host.syncFocusedRoomVisuals).not.toHaveBeenCalled();
    expect(host.redrawWorld).toHaveBeenCalledTimes(1);
  });

  it('falls back to full runtime synchronization when a focus change reloads the window', async () => {
    const { controller, host, worldStreamingController } = createHarness({
      snapshotAvailable: true,
    });
    worldStreamingController.isWithinLoadedRoomBounds.mockReturnValue(false);
    worldStreamingController.needsRefreshAround.mockReturnValue(true);
    worldStreamingController.refreshAround.mockResolvedValue('success');

    controller.refreshAroundIfNeededOrFromCache(
      { x: 0, y: 0 },
      {
        preferCachedWindow: true,
        focusChangeFrom: { x: -1, y: 0 },
      },
    );

    await vi.waitFor(() => {
      expect(host.syncModeRuntime).toHaveBeenCalledTimes(1);
    });
    expect(host.syncFocusedRoomRuntime).not.toHaveBeenCalled();
    expect(host.syncFocusedRoomVisuals).not.toHaveBeenCalled();
    expect(host.redrawWorld).toHaveBeenCalledTimes(1);
  });

  it('does not fetch a missing full snapshot while browsing', () => {
    const { controller, worldStreamingController } = createHarness({ mode: 'browse' });

    controller.refreshAroundIfNeededOrFromCache(
      { x: 0, y: 0 },
      { preferCachedWindow: true },
    );

    expect(worldStreamingController.refreshAround).not.toHaveBeenCalled();
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
    host.getTimeNow.mockReturnValue(49);
    controller.maybeRefreshVisibleChunks();
    expect(worldStreamingController.refreshAround).toHaveBeenCalledTimes(1);

    host.getTimeNow.mockReturnValue(50);
    await vi.waitFor(() => {
      controller.maybeRefreshVisibleChunks();
      expect(worldStreamingController.refreshAround).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(host.syncModeRuntime).toHaveBeenCalledTimes(2);
    });
  });

  it('does not drop a required recenter behind a periodic chunk refresh', async () => {
    const { controller, worldStreamingController } = createHarness({
      snapshotAvailable: true,
    });
    const periodicRefresh = createDeferred<'unchanged'>();
    worldStreamingController.refreshLoadedChunksIfChanged.mockReturnValueOnce(
      periodicRefresh.promise,
    );
    worldStreamingController.refreshAround.mockResolvedValue('success');

    controller.maybeRefreshVisibleChunks();
    expect(worldStreamingController.refreshLoadedChunksIfChanged).toHaveBeenCalledTimes(1);

    worldStreamingController.needsRefreshAround.mockReturnValue(true);
    controller.refreshAroundIfNeededOrFromCache(
      { x: 1, y: 0 },
      { preferCachedWindow: true },
    );
    expect(worldStreamingController.refreshAround).not.toHaveBeenCalled();

    periodicRefresh.resolve('unchanged');
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.maybeRefreshVisibleChunks();

    await vi.waitFor(() => {
      expect(worldStreamingController.refreshAround).toHaveBeenCalledWith(
        { x: 1, y: 0 },
        {},
      );
    });
  });

  it('uses a full refresh to repair stale window coverage', async () => {
    const { controller, host, worldStreamingController } = createHarness({
      snapshotAvailable: true,
    });
    host.getRefreshCenterCoordinates.mockReturnValue({ x: 4, y: -2 });
    worldStreamingController.needsRefreshAround.mockReturnValue(true);
    worldStreamingController.refreshAround.mockResolvedValue('success');

    controller.maybeRefreshVisibleChunks();

    await vi.waitFor(() => {
      expect(worldStreamingController.refreshAround).toHaveBeenCalledWith(
        { x: 4, y: -2 },
        {},
      );
    });
    expect(worldStreamingController.refreshLoadedChunksIfChanged).not.toHaveBeenCalled();
  });

  it('coalesces rapid recenters to the latest coordinates', async () => {
    const { controller, worldStreamingController } = createHarness({
      snapshotAvailable: true,
    });
    const firstRefresh = createDeferred<'cancelled'>();
    worldStreamingController.needsRefreshAround.mockReturnValue(true);
    worldStreamingController.refreshAround
      .mockReturnValueOnce(firstRefresh.promise)
      .mockResolvedValueOnce('success');

    controller.refreshAroundIfNeededOrFromCache(
      { x: 1, y: 0 },
      { preferCachedWindow: true },
    );
    controller.refreshAroundIfNeededOrFromCache(
      { x: 2, y: 0 },
      { preferCachedWindow: true },
    );
    controller.refreshAroundIfNeededOrFromCache(
      { x: 3, y: 0 },
      { preferCachedWindow: true },
    );

    expect(worldStreamingController.refreshAround).toHaveBeenCalledTimes(1);
    firstRefresh.resolve('cancelled');
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.maybeRefreshVisibleChunks();

    await vi.waitFor(() => {
      expect(worldStreamingController.refreshAround).toHaveBeenCalledTimes(2);
    });
    expect(worldStreamingController.refreshAround.mock.calls[1]?.[0]).toEqual({ x: 3, y: 0 });
  });

  it('deduplicates identical recenter requests while one is running', () => {
    const { controller, worldStreamingController } = createHarness({
      snapshotAvailable: true,
    });
    const refresh = createDeferred<'success'>();
    worldStreamingController.needsRefreshAround.mockReturnValue(true);
    worldStreamingController.refreshAround.mockReturnValueOnce(refresh.promise);

    controller.refreshAroundIfNeededOrFromCache(
      { x: 1, y: 0 },
      { preferCachedWindow: true },
    );
    controller.refreshAroundIfNeededOrFromCache(
      { x: 1, y: 0 },
      { preferCachedWindow: true },
    );

    expect(worldStreamingController.refreshAround).toHaveBeenCalledTimes(1);
    refresh.resolve('success');
  });

  it('keeps a same-center requirement that is strengthened while running', async () => {
    const {
      controller,
      host,
      setSnapshotAvailable,
      worldStreamingController,
    } = createHarness({ snapshotAvailable: true });
    const firstRefresh = createDeferred<'success'>();
    worldStreamingController.needsRefreshAround.mockReturnValue(true);
    worldStreamingController.refreshAround
      .mockReturnValueOnce(firstRefresh.promise)
      .mockResolvedValueOnce('success');

    controller.refreshAroundIfNeededOrFromCache(
      { x: 1, y: 0 },
      { preferCachedWindow: true },
    );
    setSnapshotAvailable(false);
    controller.refreshAroundIfNeededOrFromCache(
      { x: 1, y: 0 },
      { preferCachedWindow: true },
    );

    firstRefresh.resolve('success');
    await new Promise((resolve) => setTimeout(resolve, 0));
    host.getTimeNow.mockReturnValue(49);
    controller.maybeRefreshVisibleChunks();
    expect(worldStreamingController.refreshAround).toHaveBeenCalledTimes(1);

    host.getTimeNow.mockReturnValue(50);
    controller.maybeRefreshVisibleChunks();
    await vi.waitFor(() => {
      expect(worldStreamingController.refreshAround).toHaveBeenCalledTimes(2);
    });
  });

  it('preserves a forced reload that strengthens an active recenter', async () => {
    const { controller, worldStreamingController } = createHarness({
      snapshotAvailable: true,
    });
    const firstRefresh = createDeferred<'success'>();
    worldStreamingController.needsRefreshAround.mockReturnValue(true);
    worldStreamingController.refreshAround
      .mockReturnValueOnce(firstRefresh.promise)
      .mockResolvedValueOnce('success');

    controller.refreshAroundIfNeededOrFromCache(
      { x: 1, y: 0 },
      { preferCachedWindow: true },
    );
    controller.refreshAroundIfNeededOrFromCache(
      { x: 1, y: 0 },
      { forceChunkReload: true },
    );

    expect(worldStreamingController.refreshAround).toHaveBeenCalledTimes(1);
    firstRefresh.resolve('success');
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.maybeRefreshVisibleChunks();

    await vi.waitFor(() => {
      expect(worldStreamingController.refreshAround).toHaveBeenCalledTimes(2);
    });
    expect(worldStreamingController.refreshAround.mock.calls[1]).toEqual([
      { x: 1, y: 0 },
      { forceChunkReload: true },
    ]);
  });

  it('invalidates a cancelled refresh retry when reset', async () => {
    const { controller, worldStreamingController } = createHarness({
      snapshotAvailable: true,
    });
    const refresh = createDeferred<'cancelled'>();
    worldStreamingController.needsRefreshAround.mockReturnValue(true);
    worldStreamingController.refreshAround.mockReturnValueOnce(refresh.promise);

    controller.refreshAroundIfNeededOrFromCache(
      { x: 1, y: 0 },
      { preferCachedWindow: true },
    );
    controller.reset();
    worldStreamingController.needsRefreshAround.mockReturnValue(false);
    refresh.resolve('cancelled');
    await new Promise((resolve) => setTimeout(resolve, 0));

    controller.maybeRefreshVisibleChunks();
    expect(worldStreamingController.refreshAround).toHaveBeenCalledTimes(1);
  });
});
