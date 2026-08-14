import { describe, expect, it, vi } from 'vitest';
import type {
  BrowseRoomCommentSummaryResponse,
  RoomCommentListResponse,
  RoomCommentRecord,
} from '../../roomComments/model';
import type { RoomSnapshot } from '../../persistence/roomModel';
import {
  RoomCommentsDataController,
  type BrowseCommentTarget,
} from './roomCommentsDataController';

describe('RoomCommentsDataController', () => {
  it('rejects an obsolete current-room response after the selected room changes', async () => {
    const roomA = deferred<RoomCommentListResponse>();
    const roomB = deferred<RoomCommentListResponse>();
    const onCurrentCommentsChanged = vi.fn();
    const fetchCurrent = vi.fn()
      .mockReturnValueOnce(roomA.promise)
      .mockReturnValueOnce(roomB.promise);
    const { controller } = createController({ fetchRoomComments: fetchCurrent, onCurrentCommentsChanged });

    controller.observeCurrentRoom(room('0,0', 1));
    controller.observeCurrentRoom(room('1,0', 2));
    roomA.resolve(commentResponse('old'));
    await flushMicrotasks();

    expect(controller.getCurrentComments()).toEqual([]);
    expect(onCurrentCommentsChanged).not.toHaveBeenCalled();

    roomB.resolve(commentResponse('current'));
    await flushMicrotasks();
    expect(controller.getCurrentComments().map(({ id }) => id)).toEqual(['current']);
    expect(onCurrentCommentsChanged).toHaveBeenCalledOnce();
  });

  it('allows two full reads and coalesces rapid queued selections to the latest pin', async () => {
    const responses = [
      deferred<RoomCommentListResponse>(),
      deferred<RoomCommentListResponse>(),
      deferred<RoomCommentListResponse>(),
    ];
    const fetchCurrent = vi.fn()
      .mockReturnValueOnce(responses[0].promise)
      .mockReturnValueOnce(responses[1].promise)
      .mockReturnValueOnce(responses[2].promise);
    const { controller } = createController({ fetchRoomComments: fetchCurrent });
    const targets = Array.from({ length: 4 }, (_, x) => target(x));

    for (const nextTarget of targets) {
      controller.setPinnedBrowseMarkerKey(nextTarget.signature);
      controller.loadBrowseComments(nextTarget, true);
    }
    expect(fetchCurrent).toHaveBeenCalledTimes(2);

    responses[0].resolve({ comments: [], commentArea: null });
    await flushMicrotasks();
    expect(fetchCurrent).toHaveBeenCalledTimes(3);
    expect(fetchCurrent.mock.calls[2][0]).toBe('3,0');
    expect(fetchCurrent.mock.calls.some((call) => call[0] === '2,0')).toBe(false);
    expect(controller.getPinnedBrowseMarkerKey()).toBe('3,0:v1');

    responses[1].resolve({ comments: [], commentArea: null });
    responses[2].resolve({ comments: [], commentArea: null });
    await flushMicrotasks();
  });

  it('invalidates full-comment responses across reset and mode changes', async () => {
    const pending = deferred<RoomCommentListResponse>();
    let mode: 'browse' | 'play' = 'browse';
    const { controller } = createController({
      getMode: () => mode,
      fetchRoomComments: vi.fn().mockReturnValue(pending.promise),
    });

    const selected = target(0);
    controller.setPinnedBrowseMarkerKey(selected.signature);
    controller.loadBrowseComments(selected, true);
    mode = 'play';
    controller.syncObservedMode();
    pending.resolve(commentResponse('stale'));
    await flushMicrotasks();
    expect(controller.getDebugSnapshot().browseCacheEntryCount).toBe(0);

    controller.reset();
    expect(controller.getDebugSnapshot()).toMatchObject({
      browseCacheEntryCount: 0,
      browseLoadingCount: 0,
      pinnedBrowseMarkerKey: null,
    });
  });

  it('bounds summary discovery to 128 rooms and preserves newer full entries', async () => {
    const summaryResponse = deferred<BrowseRoomCommentSummaryResponse>();
    const fetchSummaries = vi.fn().mockReturnValue(summaryResponse.promise);
    const onBrowseDataChanged = vi.fn();
    const { controller } = createController({
      fetchBrowseRoomCommentSummaries: fetchSummaries,
      onBrowseDataChanged,
    });
    const targets = Array.from({ length: 140 }, (_, x) => target(x));
    controller.getBrowseCommentCacheForCompatibility().set(targets[0].signature, {
      comments: [{
        id: 'full',
        body: 'full',
        authorDisplayName: 'Player',
        createdAt: '2026-08-13T00:00:00.000Z',
      }],
      commentCount: 1,
      full: true,
    });

    controller.queueBrowseSummaryLoad(targets);
    expect(fetchSummaries).toHaveBeenCalledOnce();
    expect(fetchSummaries.mock.calls[0][0]).toHaveLength(128);

    summaryResponse.resolve({
      rooms: targets.slice(0, 128).map((nextTarget) => ({
        roomId: nextTarget.roomId,
        roomVersion: nextTarget.version,
        commentCount: 0,
        comments: [],
      })),
    });
    await flushMicrotasks();
    expect(controller.getBrowseCacheEntry(targets[0].signature)).toMatchObject({ full: true });
    expect(onBrowseDataChanged).toHaveBeenCalledOnce();
  });

  it('aborts discovery readiness on reset and retries a false result after 500 ms', async () => {
    let now = 1_000;
    const readinessCalls: AbortSignal[] = [];
    const readiness = [deferred<boolean>(), deferred<boolean>(), deferred<boolean>()];
    const { controller } = createController({
      now: () => now,
      waitForBrowseDiscoveryReady: (signal) => {
        readinessCalls.push(signal);
        return readiness[readinessCalls.length - 1].promise;
      },
    });

    expect(controller.ensureBrowseDiscoveryReady()).toBe(false);
    controller.reset();
    expect(readinessCalls[0].aborted).toBe(true);

    expect(controller.ensureBrowseDiscoveryReady()).toBe(false);
    readiness[1].resolve(false);
    await flushMicrotasks();
    now += 499;
    expect(controller.ensureBrowseDiscoveryReady()).toBe(false);
    expect(readinessCalls).toHaveLength(2);
    now += 1;
    expect(controller.ensureBrowseDiscoveryReady()).toBe(false);
    expect(readinessCalls).toHaveLength(3);
  });
});

function createController(options: {
  getMode?: () => 'browse' | 'play';
  waitForBrowseDiscoveryReady?: (signal: AbortSignal) => Promise<boolean>;
  fetchRoomComments?: (...args: never[]) => Promise<RoomCommentListResponse>;
  fetchBrowseRoomCommentSummaries?: (...args: never[]) => Promise<BrowseRoomCommentSummaryResponse>;
  now?: () => number;
  onCurrentCommentsChanged?: () => void;
  onBrowseDataChanged?: () => void;
} = {}) {
  const controller = new RoomCommentsDataController({
    getMode: options.getMode ?? (() => 'browse'),
    waitForBrowseDiscoveryReady: options.waitForBrowseDiscoveryReady,
    onCurrentCommentsChanged: options.onCurrentCommentsChanged ?? vi.fn(),
    onBrowseDataChanged: options.onBrowseDataChanged ?? vi.fn(),
  }, {
    ...(options.fetchRoomComments
      ? { fetchRoomComments: options.fetchRoomComments as never }
      : {}),
    ...(options.fetchBrowseRoomCommentSummaries
      ? { fetchBrowseRoomCommentSummaries: options.fetchBrowseRoomCommentSummaries as never }
      : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  return { controller };
}

function room(id: string, version: number): RoomSnapshot {
  const [x, y] = id.split(',').map(Number);
  return { id, version, coordinates: { x, y } } as RoomSnapshot;
}

function target(x: number): BrowseCommentTarget {
  return {
    signature: `${x},0:v1`,
    groupKey: `${x},0:v1`,
    roomId: `${x},0`,
    version: 1,
    coordinates: { x, y: 0 },
    displayCoordinates: { x, y: 0 },
    title: `Room ${x}`,
  };
}

function commentResponse(id: string): RoomCommentListResponse {
  return { comments: [comment(id)], commentArea: null };
}

function comment(id: string): RoomCommentRecord {
  return {
    id,
    roomId: '0,0',
    roomVersion: 1,
    roomCoordinates: { x: 0, y: 0 },
    position: { x: 10, y: 10 },
    body: id,
    authorUserId: 'user-a',
    authorDisplayName: 'Player A',
    createdAt: '2026-08-13T00:00:00.000Z',
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
