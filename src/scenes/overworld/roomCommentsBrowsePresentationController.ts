import type Phaser from 'phaser';
import type { RoomCoordinates } from '../../persistence/roomModel';

export interface BrowseCommentMarkerPresentation {
  container: Phaser.GameObjects.Container;
}

export interface BrowseDanmakuPresentation {
  container: Phaser.GameObjects.Container;
  active: boolean;
  key: string | null;
  commentId: string | null;
  target: { displayCoordinates: RoomCoordinates } | null;
  laneIndex: number;
  screenX: number;
  widthPx: number;
  ageMs: number;
}

interface RoomCommentsBrowsePresentationCallbacks {
  syncMarkers: () => void;
  syncDanmaku: () => void;
}

export class RoomCommentsBrowsePresentationController<
  TMarker extends BrowseCommentMarkerPresentation,
  TDanmaku extends BrowseDanmakuPresentation,
> {
  readonly markersByKey = new Map<string, TMarker>();
  hoveredMarkerKey: string | null = null;
  readonly activeDanmaku = new Set<TDanmaku>();
  readonly idleDanmaku: TDanmaku[] = [];
  readonly danmakuLaneCooldowns: number[] = [];
  lastDanmakuUpdateMs = 0;
  nextDanmakuSpawnAtMs = 0;
  danmakuCandidateCursor = 0;

  constructor(private readonly callbacks: RoomCommentsBrowsePresentationCallbacks) {}

  sync(): void {
    this.callbacks.syncMarkers();
    this.callbacks.syncDanmaku();
  }

  syncMarkers(): void {
    this.callbacks.syncMarkers();
  }

  getIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return [
      ...Array.from(this.markersByKey.values(), ({ container }) => container),
      ...Array.from(this.activeDanmaku, ({ container }) => container),
    ];
  }

  getDebugSnapshot(getScreenY: (stream: TDanmaku) => number): {
    markerCount: number;
    activeCount: number;
    poolCount: number;
    streams: Array<{
      key: string | null;
      commentId: string | null;
      targetCoordinates: RoomCoordinates | null;
      laneIndex: number;
      screenX: number;
      screenY: number;
      widthPx: number;
      alpha: number;
      ageMs: number;
    }>;
  } {
    return {
      markerCount: this.markersByKey.size,
      activeCount: this.activeDanmaku.size,
      poolCount: this.idleDanmaku.length,
      streams: Array.from(this.activeDanmaku, (stream) => ({
        key: stream.key,
        commentId: stream.commentId,
        targetCoordinates: stream.target ? { ...stream.target.displayCoordinates } : null,
        laneIndex: stream.laneIndex,
        screenX: Math.round(stream.screenX),
        screenY: Math.round(getScreenY(stream)),
        widthPx: stream.widthPx,
        alpha: Number(stream.container.alpha.toFixed(2)),
        ageMs: Math.round(stream.ageMs),
      })),
    };
  }

  destroy(): void {
    for (const marker of this.markersByKey.values()) marker.container.destroy(true);
    for (const stream of this.activeDanmaku) stream.container.destroy(true);
    for (const stream of this.idleDanmaku) stream.container.destroy(true);
    this.markersByKey.clear();
    this.hoveredMarkerKey = null;
    this.activeDanmaku.clear();
    this.idleDanmaku.length = 0;
    this.danmakuLaneCooldowns.length = 0;
    this.lastDanmakuUpdateMs = 0;
    this.nextDanmakuSpawnAtMs = 0;
    this.danmakuCandidateCursor = 0;
  }
}
