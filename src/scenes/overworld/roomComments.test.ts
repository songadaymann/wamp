import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomCommentRecord } from '../../roomComments/model';
import { OverworldRoomCommentsController } from './roomComments';
import type { RoomCommentsDataController } from './roomCommentsDataController';

const { fetchBrowseRoomCommentSummaries, fetchRoomComments } = vi.hoisted(() => ({
  fetchBrowseRoomCommentSummaries: vi.fn(),
  fetchRoomComments: vi.fn(),
}));

vi.mock('phaser', () => ({
  default: {
    Input: { Events: {} },
    Geom: { Rectangle: class Rectangle {} },
    Math: { Clamp: (value: number) => value },
  },
}));

vi.mock('../../roomComments/client', () => ({
  fetchBrowseRoomCommentSummaries,
  fetchRoomComments,
  submitRoomComment: vi.fn(),
}));

describe('overworld browse comment loading', () => {
  beforeEach(() => {
    fetchBrowseRoomCommentSummaries.mockReset();
    fetchBrowseRoomCommentSummaries.mockResolvedValue({ rooms: [] });
    fetchRoomComments.mockReset();
  });

  it('waits for sharp tiled readiness and keeps viewport discovery to one bounded batch', async () => {
    const readiness = deferred<boolean>();
    const summaryRequest = deferred<{ rooms: never[] }>();
    fetchBrowseRoomCommentSummaries.mockReturnValue(summaryRequest.promise);
    const controller = createController({
      roomCount: 160,
      selectedX: 159,
      waitForBrowseDiscoveryReady: () => readiness.promise,
    });
    const harness = controller as unknown as { syncBrowseCommentMarkers(): void; reset(): void };

    harness.syncBrowseCommentMarkers();
    harness.syncBrowseCommentMarkers();
    expect(fetchBrowseRoomCommentSummaries).not.toHaveBeenCalled();

    readiness.resolve(true);
    await flushMicrotasks();
    expect(fetchBrowseRoomCommentSummaries).toHaveBeenCalledTimes(1);
    const requestedRoomIds = fetchBrowseRoomCommentSummaries.mock.calls[0][0] as string[];
    expect(requestedRoomIds).toHaveLength(128);
    expect(requestedRoomIds[0]).toBe('159,0');

    harness.syncBrowseCommentMarkers();
    harness.syncBrowseCommentMarkers();
    expect(fetchBrowseRoomCommentSummaries).toHaveBeenCalledTimes(1);
    harness.reset();
  });

  it('promotes a selected summary to the unchanged full-comments endpoint', async () => {
    fetchRoomComments.mockResolvedValue({ comments: [], commentArea: null });
    const controller = createController({ roomCount: 1, selectedX: 0 });
    const harness = controller as unknown as {
      dataController: RoomCommentsDataController;
    };
    harness.dataController.getBrowseCommentCacheForCompatibility().set('0,0:v1', {
      comments: [],
      commentCount: 4,
      full: false,
    });

    expect(controller.openSelectedBrowseComments()).toBe(true);
    expect(fetchRoomComments).toHaveBeenCalledTimes(1);
    expect(fetchRoomComments).toHaveBeenCalledWith('0,0', { x: 0, y: 0 }, 1);
    await flushMicrotasks();
    expect(harness.dataController.getBrowseCacheEntry('0,0:v1')).toMatchObject({
      comments: [],
      commentCount: 0,
      full: true,
    });
  });

  it('limits rapid selected full reads to two and coalesces queued work to the latest pin', async () => {
    const responses = [
      deferred<{ comments: RoomCommentRecord[]; commentArea: null }>(),
      deferred<{ comments: RoomCommentRecord[]; commentArea: null }>(),
      deferred<{ comments: RoomCommentRecord[]; commentArea: null }>(),
    ];
    let responseIndex = 0;
    fetchRoomComments.mockImplementation(() => responses[responseIndex++].promise);
    const controller = createController({ roomCount: 4, selectedX: 0 });
    const harness = controller as unknown as {
      getBrowseCommentTargets(): TestBrowseTarget[];
      dataController: RoomCommentsDataController;
    };
    const targets = harness.getBrowseCommentTargets();

    for (const target of targets) {
      harness.dataController.setPinnedBrowseMarkerKey(target.signature);
      harness.dataController.loadBrowseComments(target as never, true);
    }
    expect(fetchRoomComments).toHaveBeenCalledTimes(2);

    responses[0].resolve({ comments: [], commentArea: null });
    await flushMicrotasks();
    expect(fetchRoomComments).toHaveBeenCalledTimes(3);
    expect(fetchRoomComments.mock.calls[2][0]).toBe('3,0');
    expect(fetchRoomComments.mock.calls.some((call) => call[0] === '2,0')).toBe(false);
    expect(harness.dataController.getPinnedBrowseMarkerKey()).toBe('3,0:v1');

    responses[1].resolve({ comments: [], commentArea: null });
    responses[2].resolve({ comments: [], commentArea: null });
    await flushMicrotasks();
  });

  it('drops full-comment responses from an earlier reset or mode generation', async () => {
    const resetResponse = deferred<{ comments: RoomCommentRecord[]; commentArea: null }>();
    fetchRoomComments.mockReturnValueOnce(resetResponse.promise);
    const resetController = createController({ roomCount: 1, selectedX: 0 });
    const resetHarness = resetController as unknown as {
      dataController: RoomCommentsDataController;
    };
    resetController.openSelectedBrowseComments();
    resetController.reset();
    resetResponse.resolve({ comments: [fullComment('reset-comment')], commentArea: null });
    await flushMicrotasks();
    expect(resetHarness.dataController.getDebugSnapshot().browseCacheEntryCount).toBe(0);

    let mode: 'browse' | 'play' = 'browse';
    const modeResponse = deferred<{ comments: RoomCommentRecord[]; commentArea: null }>();
    fetchRoomComments.mockReturnValueOnce(modeResponse.promise);
    const modeController = createController({
      roomCount: 1,
      selectedX: 0,
      getMode: () => mode,
    });
    const modeHarness = modeController as unknown as {
      dataController: RoomCommentsDataController;
    };
    modeController.openSelectedBrowseComments();
    mode = 'play';
    modeController.update();
    modeResponse.resolve({ comments: [fullComment('mode-comment')], commentArea: null });
    await flushMicrotasks();
    expect(modeHarness.dataController.getDebugSnapshot().browseCacheEntryCount).toBe(0);
  });
});

interface TestBrowseTarget {
  signature: string;
  roomId: string;
  version: number;
  coordinates: { x: number; y: number };
}

function createController(input: {
  roomCount: number;
  selectedX: number;
  waitForBrowseDiscoveryReady?: (signal: AbortSignal) => Promise<boolean>;
  getMode?: () => 'browse' | 'play';
}): OverworldRoomCommentsController {
  const worldWindow = {
    center: { x: 0, y: 0 },
    radius: input.roomCount,
    rooms: Array.from({ length: input.roomCount }, (_, x) => ({
      id: `${x},0`,
      coordinates: { x, y: 0 },
      title: `Room ${x}`,
      state: 'published' as const,
      background: null,
      goalType: null,
      version: 1,
      publishedAt: '2026-07-19T00:00:00.000Z',
      previewUpdatedAt: '2026-07-19T00:00:00.000Z',
      creatorUserId: null,
      creatorDisplayName: null,
      publishedByUserId: null,
      publishedByDisplayName: null,
      course: null,
      expandedRoom: null,
    })),
  };
  const camera = {
    zoom: 0.18,
    worldView: {
      x: 0,
      y: 0,
      width: input.roomCount * 640,
      height: 352,
      right: input.roomCount * 640,
      bottom: 352,
      centerX: input.roomCount * 320,
      centerY: 176,
    },
  };
  return new OverworldRoomCommentsController({
    scene: {
      cameras: { main: camera },
      time: { now: 0 },
      game: { canvas: { focus() {} } },
    } as never,
    getMode: input.getMode ?? (() => 'browse'),
    getCurrentRoomSnapshot: () => null,
    isCurrentRoomPublished: () => false,
    getWorldWindow: () => worldWindow,
    getSelectedCoordinates: () => ({ x: input.selectedX, y: 0 }),
    getRoomOrigin: ({ x, y }) => ({ x: x * 640, y: y * 352 }),
    getPlayerCommentPosition: () => null,
    waitForBrowseDiscoveryReady: input.waitForBrowseDiscoveryReady,
  });
}

function fullComment(id: string): RoomCommentRecord {
  return {
    id,
    roomId: '0,0',
    roomVersion: 1,
    roomCoordinates: { x: 0, y: 0 },
    position: { x: 10, y: 10 },
    body: id,
    authorUserId: 'user-a',
    authorDisplayName: 'Player A',
    createdAt: '2026-07-19T00:00:00.000Z',
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
}
