import { describe, expect, it, vi } from 'vitest';
import {
  RoomCommentsBrowsePresentationController,
  type BrowseCommentMarkerPresentation,
  type BrowseDanmakuPresentation,
} from './roomCommentsBrowsePresentationController';

describe('RoomCommentsBrowsePresentationController', () => {
  it('coordinates sync and owns marker, active-stream, pooled-stream, debug, and teardown state', () => {
    const syncMarkers = vi.fn();
    const syncDanmaku = vi.fn();
    const marker = displayEntry();
    const active = danmakuEntry('active', { x: 4, y: 2 });
    const idle = danmakuEntry('idle', null);
    const controller = new RoomCommentsBrowsePresentationController({ syncMarkers, syncDanmaku });
    controller.markersByKey.set('4,2:v3', marker as unknown as BrowseCommentMarkerPresentation);
    controller.activeDanmaku.add(active as unknown as BrowseDanmakuPresentation);
    controller.idleDanmaku.push(idle as unknown as BrowseDanmakuPresentation);
    controller.hoveredMarkerKey = '4,2:v3';
    controller.danmakuLaneCooldowns.push(123);
    controller.lastDanmakuUpdateMs = 40;
    controller.nextDanmakuSpawnAtMs = 80;
    controller.danmakuCandidateCursor = 2;

    controller.sync();
    controller.syncMarkers();
    expect(syncMarkers).toHaveBeenCalledTimes(2);
    expect(syncDanmaku).toHaveBeenCalledOnce();
    expect(controller.getIgnoredObjects()).toEqual([marker.container, active.container]);
    expect(controller.getDebugSnapshot(() => 27)).toEqual({
      markerCount: 1,
      activeCount: 1,
      poolCount: 1,
      streams: [{
        key: 'active',
        commentId: 'comment-active',
        targetCoordinates: { x: 4, y: 2 },
        laneIndex: 1,
        screenX: 42,
        screenY: 27,
        widthPx: 88,
        alpha: 0.76,
        ageMs: 17,
      }],
    });

    controller.destroy();
    expect(marker.container.destroy).toHaveBeenCalledWith(true);
    expect(active.container.destroy).toHaveBeenCalledWith(true);
    expect(idle.container.destroy).toHaveBeenCalledWith(true);
    expect(controller.getIgnoredObjects()).toEqual([]);
    expect(controller.hoveredMarkerKey).toBeNull();
    expect(controller.danmakuLaneCooldowns).toEqual([]);
    expect(controller.lastDanmakuUpdateMs).toBe(0);
    expect(controller.nextDanmakuSpawnAtMs).toBe(0);
    expect(controller.danmakuCandidateCursor).toBe(0);
  });
});

function displayEntry() {
  return { container: displayObject() };
}

function danmakuEntry(key: string, coordinates: { x: number; y: number } | null) {
  return {
    container: displayObject(),
    active: key === 'active',
    key,
    commentId: `comment-${key}`,
    target: coordinates ? { displayCoordinates: coordinates } : null,
    laneIndex: 1,
    screenX: 41.6,
    widthPx: 88,
    ageMs: 17.2,
  };
}

function displayObject() {
  return {
    alpha: 0.756,
    destroy: vi.fn(),
  };
}
