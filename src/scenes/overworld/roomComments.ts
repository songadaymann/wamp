import Phaser from 'phaser';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import {
  ROOM_COMMENT_BROWSE_MAX_ROOM_IDS,
  type BrowseRoomCommentPreview,
  type RoomCommentRecord,
} from '../../roomComments/model';
import {
  fetchBrowseRoomCommentSummaries,
  fetchRoomComments,
} from '../../roomComments/client';
import { type RoomCoordinates, type RoomSnapshot } from '../../persistence/roomModel';
import { type WorldRoomSummary, type WorldWindow } from '../../persistence/worldModel';
import {
  getGameSettings,
  subscribeGameSettings,
  updateGameSettings,
  type GameSettings,
} from '../../settings/userSettings';
import { getDeviceLayoutState } from '../../ui/deviceLayout';
import { getResolvedPerformancePolicy } from '../../performance/performancePolicy';
import type { OverworldMode } from '../sceneData';
import {
  syncBadgePlacements,
  type OverworldBadgePlacement,
  type RoomBadgeScaleConfig,
} from './badgeOverlays';
import { RoomCommentsComposerController } from './roomCommentsComposerController';

interface RenderedRoomComment {
  comment: RoomCommentRecord;
  container: Phaser.GameObjects.Container;
  pin: Phaser.GameObjects.Image;
  panel: Phaser.GameObjects.Graphics;
  authorText: Phaser.GameObjects.Text;
  bodyText: Phaser.GameObjects.Text;
  timeText: Phaser.GameObjects.Text;
  pinned: boolean;
}

interface BrowseCommentTarget {
  signature: string;
  groupKey: string;
  roomId: string;
  version: number;
  coordinates: RoomCoordinates;
  displayCoordinates: RoomCoordinates;
  title: string | null;
}

interface BrowseCommentCacheEntry {
  comments: BrowseRoomCommentPreview[];
  commentCount: number;
  full: boolean;
}

interface RenderedBrowseCommentMarker extends OverworldBadgePlacement {
  key: string;
  target: BrowseCommentTarget;
  comments: BrowseRoomCommentPreview[];
  commentCount: number;
  commentSignature: string;
  accentColor: number;
  dotContainer: Phaser.GameObjects.Container;
  compactContainer: Phaser.GameObjects.Container;
  textContainer: Phaser.GameObjects.Container;
  compactCountText: Phaser.GameObjects.Text;
  textPanel: Phaser.GameObjects.Graphics;
  textHeaderText: Phaser.GameObjects.Text;
  textBodyText: Phaser.GameObjects.Text;
  textMetaText: Phaser.GameObjects.Text;
  jiggleOffsetMs: number;
}

interface BrowseDanmakuCandidate {
  key: string;
  target: BrowseCommentTarget;
  comment: BrowseRoomCommentPreview;
  accentColor: number;
}

interface RenderedBrowseDanmakuComment {
  container: Phaser.GameObjects.Container;
  shell: Phaser.GameObjects.Rectangle;
  accent: Phaser.GameObjects.Rectangle;
  bodyText: Phaser.GameObjects.Text;
  metaText: Phaser.GameObjects.Text;
  active: boolean;
  key: string | null;
  commentId: string | null;
  target: BrowseCommentTarget | null;
  laneIndex: number;
  screenX: number;
  trackOffsetX: number;
  ageMs: number;
  widthPx: number;
  speedPxPerSecond: number;
}

interface BrowseDanmakuTrack {
  centerX: number;
  startX: number;
  exitX: number;
  screenY: number;
}

interface PendingBrowseFullCommentLoad {
  target: BrowseCommentTarget;
  pinWhenLoaded: boolean;
  pinGeneration: number;
  loadGeneration: number;
}

interface OverworldRoomCommentsControllerOptions {
  scene: Phaser.Scene;
  getMode: () => OverworldMode;
  getCurrentRoomSnapshot: () => RoomSnapshot | null;
  isCurrentRoomPublished: () => boolean;
  getWorldWindow?: () => WorldWindow | null;
  getSelectedCoordinates?: () => RoomCoordinates;
  getRoomOrigin: (coordinates: RoomSnapshot['coordinates']) => { x: number; y: number };
  getPlayerCommentPosition: () => { x: number; y: number } | null;
  getZoom?: () => number;
  selectRoomCoordinates?: (coordinates: RoomCoordinates) => void;
  jumpToRoomCoordinates?: (coordinates: RoomCoordinates) => void | Promise<void>;
  showTransientStatus?: (message: string) => void;
  onDisplayObjectsChanged?: () => void;
  waitForBrowseDiscoveryReady?: (signal: AbortSignal) => Promise<boolean>;
  document?: Document;
}

const COMMENT_PIN_DEPTH = 262;
const COMMENT_PIN_TEXTURE_KEY = 'room_comment_icon';
const COMMENT_PANEL_FILL = 0x050505;
const COMMENT_PANEL_STROKE = 0xffd65a;
const COMMENT_TEXT_COLOR = '#fff3dc';
const COMMENT_MUTED_COLOR = '#d0b98c';
const COMMENT_PANEL_WIDTH = 236;
const COMMENT_PANEL_PADDING = 9;
const BROWSE_COMMENT_DEPTH = 58;
const BROWSE_COMMENT_HIDE_ZOOM = 0.11;
const BROWSE_COMMENT_FADE_START_ZOOM = 0.145;
const BROWSE_COMMENT_SCALE_FULL_ZOOM = 0.52;
const BROWSE_COMMENT_LAYOUT_FULL_ZOOM = 0.34;
const BROWSE_COMMENT_MIN_SCREEN_SCALE = 0.82;
const BROWSE_COMMENT_MAX_SCREEN_SCALE = 1.38;
const BROWSE_COMMENT_DOT_TIER_MAX_ZOOM = 0.28;
const BROWSE_COMMENT_COMPACT_TIER_MAX_ZOOM = 0.92;
const BROWSE_COMMENT_TIER_FADE_SPAN = 0.04;
const BROWSE_COMMENT_PANEL_WIDTH = 172;
const BROWSE_COMMENT_PANEL_HEIGHT = 72;
const BROWSE_COMMENT_DOT_SIZE = 9;
const BROWSE_COMMENT_COMPACT_WIDTH = 31;
const BROWSE_COMMENT_COMPACT_HEIGHT = 21;
const BROWSE_COMMENT_INK = 0x18161c;
const BROWSE_COMMENT_PANEL_FILL = 0xfff3db;
const BROWSE_COMMENT_PANEL_LIGHT = 0xfffaf0;
const BROWSE_COMMENT_MUTED = '#6d5a34';
const BROWSE_COMMENT_BODY = '#18161c';
const BROWSE_COMMENT_JIGGLE_PERIOD_MS = 5600;
const BROWSE_COMMENT_JIGGLE_DURATION_MS = 460;
const BROWSE_COMMENT_COLORS = [
  0x7de5ff,
  0xffd65a,
  0xff7a7a,
  0x7ee081,
  0xc297ff,
  0xff9f68,
  0x58d39b,
];
const BROWSE_DANMAKU_DEPTH = BROWSE_COMMENT_DEPTH + 3;
const BROWSE_DANMAKU_MIN_ZOOM = 0.105;
const BROWSE_DANMAKU_MAX_ZOOM = 3.4;
const BROWSE_DANMAKU_FONT_SIZE = 13;
const BROWSE_DANMAKU_HEIGHT = 28;
const BROWSE_DANMAKU_TOP_PADDING = 88;
const BROWSE_DANMAKU_BOTTOM_PADDING = 118;
const BROWSE_DANMAKU_MIN_LANES = 3;
const BROWSE_DANMAKU_MAX_LANES = 10;
const BROWSE_DANMAKU_DESKTOP_MAX_ACTIVE = 18;
const BROWSE_DANMAKU_REDUCED_MAX_ACTIVE = 9;
const BROWSE_DANMAKU_PHONE_MAX_ACTIVE = 6;
const BROWSE_DANMAKU_CYCLE_MS = 10000;
const BROWSE_DANMAKU_RETRY_MS = 500;
const BROWSE_DANMAKU_DESKTOP_MIN_SPAWN_GAP_MS = 520;
const BROWSE_DANMAKU_REDUCED_MIN_SPAWN_GAP_MS = 900;
const BROWSE_DANMAKU_PHONE_MIN_SPAWN_GAP_MS = 1250;
const BROWSE_DANMAKU_LANE_COOLDOWN_MS = 720;
const BROWSE_DANMAKU_FADE_IN_MS = 520;
const BROWSE_DANMAKU_FADE_OUT_MS = 780;
const BROWSE_DANMAKU_MAX_ALPHA = 0.96;
const BROWSE_DANMAKU_MIN_SPEED = 52;
const BROWSE_DANMAKU_MAX_SPEED = 82;
const BROWSE_DANMAKU_MAX_COMMENT_LENGTH = 72;
const BROWSE_DANMAKU_MAX_COMMENT_PER_TARGET = 12;
const BROWSE_DANMAKU_SIDE_MARGIN = 28;
const BROWSE_DANMAKU_ROOM_TRACK_MIN_HALF_WIDTH = 170;
const BROWSE_DANMAKU_ROOM_TRACK_MAX_HALF_WIDTH = 520;
const BROWSE_DANMAKU_ROOM_TRACK_VIEWPORT_MAX_FRACTION = 0.46;
const BROWSE_DANMAKU_ROOM_TRACK_VERTICAL_RATIO = 0.36;
const BROWSE_DANMAKU_ROOM_TRACK_LANE_SPACING_MIN = 20;
const BROWSE_DANMAKU_ROOM_TRACK_LANE_SPACING_MAX = 38;
const BROWSE_COMMENT_VIEWPORT_GUARD_FRACTION = 0.25;
const BROWSE_COMMENT_READINESS_RETRY_MS = 500;
const BROWSE_FULL_COMMENT_FETCH_CONCURRENCY = 2;

export class OverworldRoomCommentsController {
  private nextVisualSyncAt = 0;
  private readonly browseMarkerScaleConfig: RoomBadgeScaleConfig = {
    hideZoom: BROWSE_COMMENT_HIDE_ZOOM,
    fadeStartZoom: BROWSE_COMMENT_FADE_START_ZOOM,
    scaleFullZoom: BROWSE_COMMENT_SCALE_FULL_ZOOM,
    layoutFullZoom: BROWSE_COMMENT_LAYOUT_FULL_ZOOM,
    minScreenScale: BROWSE_COMMENT_MIN_SCREEN_SCALE,
    maxScreenScale: BROWSE_COMMENT_MAX_SCREEN_SCALE,
    dotTierMaxZoom: BROWSE_COMMENT_DOT_TIER_MAX_ZOOM,
    compactTierMaxZoom: BROWSE_COMMENT_COMPACT_TIER_MAX_ZOOM,
    tierFadeSpan: BROWSE_COMMENT_TIER_FADE_SPAN,
  };
  private readonly composerController: RoomCommentsComposerController;
  private comments: RoomCommentRecord[] = [];
  private activeRoomSignature: string | null = null;
  private loadingRoomSignature: string | null = null;
  private commentsVisible = getGameSettings().roomCommentsVisible;
  private unsubscribeSettings: (() => void) | null = null;
  private readonly renderedCommentsById = new Map<string, RenderedRoomComment>();
  private readonly browseCommentCache = new Map<string, BrowseCommentCacheEntry>();
  private readonly browseCommentMarkersByKey = new Map<string, RenderedBrowseCommentMarker>();
  private readonly loadingBrowseRoomSignatures = new Map<string, PendingBrowseFullCommentLoad>();
  private readonly pendingBrowseFullCommentLoads = new Map<string, PendingBrowseFullCommentLoad>();
  private activeBrowseFullCommentLoadCount = 0;
  private browseFullCommentLoadGeneration = 0;
  private pinnedBrowseRequestGeneration = 0;
  private observedMode: OverworldMode;
  private readonly loadingBrowseSummarySignatures = new Set<string>();
  private readonly failedBrowseRoomSignaturesUntil = new Map<string, number>();
  private browseSummaryRequestInFlight = false;
  private browseSummaryGeneration = 0;
  private browseDiscoveryReady = false;
  private browseDiscoveryReadinessInFlight = false;
  private browseDiscoveryReadinessRetryAt = 0;
  private browseDiscoveryAbortController: AbortController | null = null;
  private hoveredBrowseMarkerKey: string | null = null;
  private pinnedBrowseMarkerKey: string | null = null;
  private readonly activeBrowseDanmaku = new Set<RenderedBrowseDanmakuComment>();
  private readonly idleBrowseDanmaku: RenderedBrowseDanmakuComment[] = [];
  private readonly browseDanmakuLaneCooldowns: number[] = [];
  private lastBrowseDanmakuUpdateMs = 0;
  private nextBrowseDanmakuSpawnAtMs = 0;
  private browseDanmakuCandidateCursor = 0;

  constructor(private readonly options: OverworldRoomCommentsControllerOptions) {
    this.observedMode = options.getMode();
    this.composerController = new RoomCommentsComposerController({
      document: options.document,
      getHost: () => options.scene.game.canvas.parentElement ?? (options.document ?? document).body,
      focusCanvas: () => options.scene.game.canvas.focus(),
      getRenderableRoom: () => this.getRenderableRoom(),
      getPlayerCommentPosition: options.getPlayerCommentPosition,
      showTransientStatus: options.showTransientStatus,
    });
  }

  initialize(): void {
    this.composerController.initialize();
    this.unsubscribeSettings = subscribeGameSettings(this.handleSettingsChanged);
    this.composerController.refresh();
  }

  reset(): void {
    this.composerController.close(false);
    this.comments = [];
    this.activeRoomSignature = null;
    this.loadingRoomSignature = null;
    this.invalidateBrowseFullCommentLoads();
    this.loadingBrowseSummarySignatures.clear();
    this.failedBrowseRoomSignaturesUntil.clear();
    this.browseSummaryRequestInFlight = false;
    this.browseSummaryGeneration += 1;
    this.browseDiscoveryReady = false;
    this.browseDiscoveryReadinessInFlight = false;
    this.browseDiscoveryReadinessRetryAt = 0;
    this.browseDiscoveryAbortController?.abort();
    this.browseDiscoveryAbortController = null;
    this.browseCommentCache.clear();
    this.hoveredBrowseMarkerKey = null;
    this.pinnedBrowseMarkerKey = null;
    this.destroyRenderedComments();
    this.destroyBrowseCommentMarkers();
    this.destroyBrowseDanmakuStreams();
  }

  destroy(): void {
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    this.reset();
    this.composerController.destroy();
  }

  update(): void {
    this.syncObservedMode();
    const room = this.getRenderableRoom();
    const nextSignature = room ? this.getRoomSignature(room) : null;
    if (nextSignature !== this.activeRoomSignature) {
      this.activeRoomSignature = nextSignature;
      this.nextVisualSyncAt = 0;
      this.comments = [];
      this.destroyRenderedComments();
      if (room) {
        void this.loadComments(room, this.getRoomSignature(room));
      }
    }

    this.composerController.update();

    const now = performance.now();
    if (now < this.nextVisualSyncAt) return;
    this.nextVisualSyncAt = now + 50;

    this.syncRenderedComments(room);
    this.syncBrowseCommentMarkers();
    this.syncBrowseDanmakuStreams();
    this.composerController.refresh();
  }

  openComposer(): boolean {
    return this.composerController.open();
  }

  openSelectedBrowseComments(): boolean {
    this.syncObservedMode();
    if (this.options.getMode() !== 'browse') {
      return this.openComposer();
    }

    this.setCommentsVisible(true);
    const selectedCoordinates = this.options.getSelectedCoordinates?.();
    const target = selectedCoordinates ? this.getBrowseCommentTargetForCoordinates(selectedCoordinates) : null;
    if (!target) {
      this.options.showTransientStatus?.('Select a published room to view comments.');
      return false;
    }

    this.setPinnedBrowseMarkerKey(target.signature);
    const cached = this.browseCommentCache.get(target.signature);
    if (cached?.full) {
      this.syncBrowseCommentMarkers();
      this.options.showTransientStatus?.(
        cached.comments.length > 0 ? 'Room comments opened.' : 'No comments here yet.',
      );
      return cached.comments.length > 0;
    }

    // A viewport summary is deliberately not treated as the full selected
    // room payload. Preserve the marker while promoting the selected room to
    // the existing exact/full comments endpoint.
    void this.loadBrowseComments(target, true);
    this.syncBrowseCommentMarkers();
    this.options.showTransientStatus?.('Loading room comments...');
    return true;
  }

  closeComposer(focusCanvas = true): void {
    this.composerController.close(focusCanvas);
  }

  isComposerOpen(): boolean {
    return this.composerController.isOpen();
  }

  areCommentsVisible(): boolean {
    return this.commentsVisible;
  }

  setCommentsVisible(visible: boolean): void {
    if (this.commentsVisible === visible) {
      return;
    }

    this.commentsVisible = visible;
    updateGameSettings({ roomCommentsVisible: visible });
    this.syncRenderedComments(this.getRenderableRoom());
    this.syncBrowseCommentMarkers();
    this.syncBrowseDanmakuStreams();
    this.composerController.refresh();
  }

  toggleCommentsVisible(): boolean {
    this.setCommentsVisible(!this.commentsVisible);
    return this.commentsVisible;
  }

  handleEscapeKey(): boolean {
    return this.composerController.handleEscapeKey();
  }

  refreshAuthState(): void {
    this.composerController.refresh();
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return [
      ...Array.from(this.renderedCommentsById.values(), (rendered) => rendered.container),
      ...Array.from(this.browseCommentMarkersByKey.values(), (rendered) => rendered.container),
      ...Array.from(this.activeBrowseDanmaku.values(), (rendered) => rendered.container),
    ];
  }

  getDebugSnapshot(): {
    activeRoomSignature: string | null;
    loadingRoomSignature: string | null;
    commentCount: number;
    renderedCommentCount: number;
    commentsVisible: boolean;
    currentRoomPublished: boolean;
    currentRoomSnapshot: {
      roomId: string;
      status: string;
      version: number;
      coordinates: RoomSnapshot['coordinates'];
    } | null;
    composerOpen: boolean;
    submitting: boolean;
    browseMarkerCount: number;
    browseCacheEntryCount: number;
    browseLoadingCount: number;
    pinnedBrowseMarkerKey: string | null;
    browseDanmakuActiveCount: number;
    browseDanmakuPoolCount: number;
    browseDanmakuStreams: Array<{
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
    const currentRoom = this.options.getCurrentRoomSnapshot();
    const composerDebug = this.composerController.getDebugSnapshot();
    return {
      activeRoomSignature: this.activeRoomSignature,
      loadingRoomSignature: this.loadingRoomSignature,
      commentCount: this.comments.length,
      renderedCommentCount: this.renderedCommentsById.size,
      commentsVisible: this.commentsVisible,
      currentRoomPublished: this.options.isCurrentRoomPublished(),
      currentRoomSnapshot: currentRoom
        ? {
            roomId: currentRoom.id,
            status: currentRoom.status,
            version: currentRoom.version,
            coordinates: { ...currentRoom.coordinates },
          }
        : null,
      composerOpen: composerDebug.composerOpen,
      submitting: composerDebug.submitting,
      browseMarkerCount: this.browseCommentMarkersByKey.size,
      browseCacheEntryCount: this.browseCommentCache.size,
      browseLoadingCount:
        this.loadingBrowseRoomSignatures.size + this.pendingBrowseFullCommentLoads.size,
      pinnedBrowseMarkerKey: this.pinnedBrowseMarkerKey,
      browseDanmakuActiveCount: this.activeBrowseDanmaku.size,
      browseDanmakuPoolCount: this.idleBrowseDanmaku.length,
      browseDanmakuStreams: Array.from(this.activeBrowseDanmaku, (stream) => ({
        key: stream.key,
        commentId: stream.commentId,
        targetCoordinates: stream.target ? { ...stream.target.displayCoordinates } : null,
        laneIndex: stream.laneIndex,
        screenX: Math.round(stream.screenX),
        screenY: Math.round(this.getBrowseDanmakuDebugScreenY(stream)),
        widthPx: stream.widthPx,
        alpha: Number(stream.container.alpha.toFixed(2)),
        ageMs: Math.round(stream.ageMs),
      })),
    };
  }

  private readonly handleSettingsChanged = (settings: GameSettings): void => {
    if (this.commentsVisible === settings.roomCommentsVisible) {
      return;
    }

    this.commentsVisible = settings.roomCommentsVisible;
    this.syncRenderedComments(this.getRenderableRoom());
    this.syncBrowseCommentMarkers();
    this.syncBrowseDanmakuStreams();
    this.composerController.refresh();
  };

  private async loadComments(room: RoomSnapshot, signature: string): Promise<void> {
    if (this.loadingRoomSignature === signature) {
      return;
    }

    this.loadingRoomSignature = signature;
    try {
      const response = await fetchRoomComments(room.id, room.coordinates, room.version);
      if (this.activeRoomSignature !== signature) {
        return;
      }
      this.comments = response.comments;
      this.syncRenderedComments(room);
    } catch (error) {
      console.warn('Failed to load room comments', error);
    } finally {
      if (this.loadingRoomSignature === signature) {
        this.loadingRoomSignature = null;
      }
    }
  }

  private loadBrowseComments(target: BrowseCommentTarget, pinWhenLoaded = false): void {
    if (pinWhenLoaded) {
      // Retain only the newest queued selection. Already active reads may
      // finish into the cache, but generation checks prevent stale re-pins.
      this.pendingBrowseFullCommentLoads.clear();
    }
    const active = this.loadingBrowseRoomSignatures.get(target.signature);
    if (active) {
      if (pinWhenLoaded) {
        active.pinWhenLoaded = true;
        active.pinGeneration = this.pinnedBrowseRequestGeneration;
      }
      return;
    }
    const existing = this.pendingBrowseFullCommentLoads.get(target.signature);
    if (existing) {
      if (pinWhenLoaded) {
        existing.pinWhenLoaded = true;
        existing.pinGeneration = this.pinnedBrowseRequestGeneration;
      }
      return;
    }

    this.pendingBrowseFullCommentLoads.set(target.signature, {
      target,
      pinWhenLoaded,
      pinGeneration: this.pinnedBrowseRequestGeneration,
      loadGeneration: this.browseFullCommentLoadGeneration,
    });
    this.drainBrowseFullCommentLoads();
  }

  private drainBrowseFullCommentLoads(): void {
    while (
      this.activeBrowseFullCommentLoadCount < BROWSE_FULL_COMMENT_FETCH_CONCURRENCY
      && this.pendingBrowseFullCommentLoads.size > 0
    ) {
      const nextEntry = this.pendingBrowseFullCommentLoads.entries().next().value as
        | [string, PendingBrowseFullCommentLoad]
        | undefined;
      if (!nextEntry) return;
      const [signature, load] = nextEntry;
      this.pendingBrowseFullCommentLoads.delete(signature);
      if (load.loadGeneration !== this.browseFullCommentLoadGeneration) continue;

      this.activeBrowseFullCommentLoadCount += 1;
      this.loadingBrowseRoomSignatures.set(signature, load);
      void this.performBrowseFullCommentLoad(load).finally(() => {
        this.activeBrowseFullCommentLoadCount = Math.max(
          0,
          this.activeBrowseFullCommentLoadCount - 1,
        );
        if (this.loadingBrowseRoomSignatures.get(signature) === load) {
          this.loadingBrowseRoomSignatures.delete(signature);
        }
        this.drainBrowseFullCommentLoads();
      });
    }
  }

  private async performBrowseFullCommentLoad(load: PendingBrowseFullCommentLoad): Promise<void> {
    const { target, loadGeneration } = load;
    try {
      const response = await fetchRoomComments(target.roomId, target.coordinates, target.version);
      if (
        loadGeneration !== this.browseFullCommentLoadGeneration
        || this.options.getMode() !== 'browse'
      ) return;
      const comments = [...response.comments].sort(compareCommentsNewestFirst);
      this.browseCommentCache.set(target.signature, {
        comments,
        commentCount: comments.length,
        full: true,
      });
      this.failedBrowseRoomSignaturesUntil.delete(target.signature);
      if (
        load.pinWhenLoaded
        && load.pinGeneration === this.pinnedBrowseRequestGeneration
        && this.pinnedBrowseMarkerKey === target.signature
      ) {
        this.options.showTransientStatus?.(
          comments.length > 0 ? 'Room comments opened.' : 'No comments here yet.',
        );
      }
      this.syncBrowseCommentMarkers();
    } catch (error) {
      if (
        loadGeneration !== this.browseFullCommentLoadGeneration
        || this.options.getMode() !== 'browse'
      ) return;
      console.warn('Failed to load browse room comments', error);
      this.failedBrowseRoomSignaturesUntil.set(target.signature, Date.now() + 15000);
      if (
        load.pinWhenLoaded
        && load.pinGeneration === this.pinnedBrowseRequestGeneration
        && this.pinnedBrowseMarkerKey === target.signature
      ) {
        this.options.showTransientStatus?.('Could not load comments for this room.');
      }
    }
  }

  private invalidateBrowseFullCommentLoads(): void {
    this.browseFullCommentLoadGeneration += 1;
    this.pinnedBrowseRequestGeneration += 1;
    this.pendingBrowseFullCommentLoads.clear();
    this.loadingBrowseRoomSignatures.clear();
  }

  private syncObservedMode(): void {
    const mode = this.options.getMode();
    if (mode === this.observedMode) return;
    this.observedMode = mode;
    this.invalidateBrowseFullCommentLoads();
  }

  private setPinnedBrowseMarkerKey(key: string | null): void {
    if (this.pinnedBrowseMarkerKey === key) return;
    this.pinnedBrowseMarkerKey = key;
    this.pinnedBrowseRequestGeneration += 1;
    if (key === null) this.pendingBrowseFullCommentLoads.clear();
  }

  private syncBrowseCommentMarkers(): void {
    this.syncObservedMode();
    if (this.options.getMode() !== 'browse' || !this.commentsVisible) {
      this.hoveredBrowseMarkerKey = null;
      this.setPinnedBrowseMarkerKey(null);
      this.destroyBrowseCommentMarkers();
      return;
    }

    if (!this.ensureBrowseDiscoveryReady()) {
      return;
    }

    const targets = this.getBrowseCommentTargetsForViewport();
    if (targets.length === 0) {
      this.hoveredBrowseMarkerKey = null;
      this.setPinnedBrowseMarkerKey(null);
      this.destroyBrowseCommentMarkers();
      return;
    }

    const targetSignatures = new Set<string>();
    const desiredMarkerKeys = new Set<string>();
    let structureChanged = false;
    this.queueBrowseSummaryLoad(targets);
    for (const target of targets) {
      targetSignatures.add(target.signature);
      const cached = this.browseCommentCache.get(target.signature);
      if (!cached || cached.comments.length === 0) {
        continue;
      }

      desiredMarkerKeys.add(target.signature);
      const origin = this.options.getRoomOrigin(target.displayCoordinates);
      const markerPosition = this.getBrowseMarkerPosition(origin);
      const commentSignature = getCommentsSignature(cached.comments, cached.commentCount);
      const existing = this.browseCommentMarkersByKey.get(target.signature);
      if (!existing) {
        const marker = this.createBrowseCommentMarker(
          target,
          cached.comments,
          cached.commentCount,
          commentSignature,
        );
        marker.zoomedInPosition = markerPosition.zoomedIn;
        marker.zoomedOutPosition = markerPosition.zoomedOut;
        this.browseCommentMarkersByKey.set(target.signature, marker);
        structureChanged = true;
        continue;
      }

      existing.target = target;
      existing.zoomedInPosition = markerPosition.zoomedIn;
      existing.zoomedOutPosition = markerPosition.zoomedOut;
      if (existing.commentSignature !== commentSignature) {
        existing.comments = cached.comments;
        existing.commentCount = cached.commentCount;
        existing.commentSignature = commentSignature;
        this.redrawBrowseCommentMarker(existing);
      }
    }

    for (const [key, marker] of this.browseCommentMarkersByKey.entries()) {
      if (desiredMarkerKeys.has(key)) {
        continue;
      }
      this.destroyBrowseCommentMarker(marker);
      this.browseCommentMarkersByKey.delete(key);
      structureChanged = true;
    }

    if (
      this.pinnedBrowseMarkerKey &&
      !targetSignatures.has(this.pinnedBrowseMarkerKey)
    ) {
      this.setPinnedBrowseMarkerKey(null);
    }
    if (
      this.hoveredBrowseMarkerKey &&
      !targetSignatures.has(this.hoveredBrowseMarkerKey)
    ) {
      this.hoveredBrowseMarkerKey = null;
    }

    this.syncBrowseCommentMarkerPresentation();
    if (structureChanged) {
      this.options.onDisplayObjectsChanged?.();
    }
  }

  private ensureBrowseDiscoveryReady(): boolean {
    if (this.browseDiscoveryReady) return true;
    if (!this.options.waitForBrowseDiscoveryReady) {
      this.browseDiscoveryReady = true;
      return true;
    }
    if (
      this.browseDiscoveryReadinessInFlight
      || Date.now() < this.browseDiscoveryReadinessRetryAt
    ) return false;

    this.browseDiscoveryReadinessInFlight = true;
    const abortController = new AbortController();
    this.browseDiscoveryAbortController?.abort();
    this.browseDiscoveryAbortController = abortController;
    void this.options.waitForBrowseDiscoveryReady(abortController.signal)
      .then((ready) => {
        if (abortController.signal.aborted || this.browseDiscoveryAbortController !== abortController) {
          return;
        }
        this.browseDiscoveryReady = ready;
        if (!ready) this.browseDiscoveryReadinessRetryAt = Date.now() + BROWSE_COMMENT_READINESS_RETRY_MS;
      })
      .catch((error) => {
        if (!abortController.signal.aborted) {
          console.warn('Failed to await browse comment discovery readiness', error);
          this.browseDiscoveryReadinessRetryAt = Date.now() + BROWSE_COMMENT_READINESS_RETRY_MS;
        }
      })
      .finally(() => {
        if (this.browseDiscoveryAbortController !== abortController) return;
        this.browseDiscoveryReadinessInFlight = false;
        this.browseDiscoveryAbortController = null;
        if (this.browseDiscoveryReady) this.syncBrowseCommentMarkers();
      });
    return false;
  }

  private queueBrowseSummaryLoad(targets: readonly BrowseCommentTarget[]): void {
    if (this.browseSummaryRequestInFlight) return;
    const now = Date.now();
    const pendingTargets = targets
      .filter((target) => (
        !this.browseCommentCache.has(target.signature)
        && !this.loadingBrowseSummarySignatures.has(target.signature)
        && now >= (this.failedBrowseRoomSignaturesUntil.get(target.signature) ?? 0)
      ))
      .slice(0, ROOM_COMMENT_BROWSE_MAX_ROOM_IDS);
    if (pendingTargets.length === 0) return;

    this.browseSummaryRequestInFlight = true;
    const generation = this.browseSummaryGeneration;
    for (const target of pendingTargets) this.loadingBrowseSummarySignatures.add(target.signature);
    void fetchBrowseRoomCommentSummaries(pendingTargets.map((target) => target.roomId))
      .then((response) => {
        if (generation !== this.browseSummaryGeneration) return;
        const summariesByRoomId = new Map(response.rooms.map((summary) => [summary.roomId, summary]));
        for (const target of pendingTargets) {
          const summary = summariesByRoomId.get(target.roomId);
          if (!summary || summary.roomVersion !== target.version) {
            this.failedBrowseRoomSignaturesUntil.set(target.signature, Date.now() + 15000);
            continue;
          }
          const existing = this.browseCommentCache.get(target.signature);
          if (!existing?.full) {
            this.browseCommentCache.set(target.signature, {
              comments: [...summary.comments].sort(compareCommentsNewestFirst),
              commentCount: summary.commentCount,
              full: false,
            });
          }
          this.failedBrowseRoomSignaturesUntil.delete(target.signature);
        }
      })
      .catch((error) => {
        if (generation !== this.browseSummaryGeneration) return;
        console.warn('Failed to load browse comment summaries', error);
        const retryAt = Date.now() + 15000;
        for (const target of pendingTargets) {
          this.failedBrowseRoomSignaturesUntil.set(target.signature, retryAt);
        }
      })
      .finally(() => {
        if (generation !== this.browseSummaryGeneration) return;
        for (const target of pendingTargets) this.loadingBrowseSummarySignatures.delete(target.signature);
        this.browseSummaryRequestInFlight = false;
        this.syncBrowseCommentMarkers();
      });
  }

  private getBrowseCommentTargets(): BrowseCommentTarget[] {
    const worldWindow = this.options.getWorldWindow?.();
    if (!worldWindow) {
      return [];
    }

    const selectedCoordinates = this.options.getSelectedCoordinates?.() ?? null;
    const targetsByGroup = new Map<string, WorldRoomSummary>();
    for (const summary of worldWindow.rooms) {
      if (summary.state !== 'published' || summary.version === null) {
        continue;
      }

      const groupKey = this.getBrowseCommentGroupKey(summary);
      const existing = targetsByGroup.get(groupKey);
      if (!existing) {
        targetsByGroup.set(groupKey, summary);
        continue;
      }

      if (
        selectedCoordinates &&
        coordinatesEqual(summary.coordinates, selectedCoordinates) &&
        !coordinatesEqual(existing.coordinates, selectedCoordinates)
      ) {
        targetsByGroup.set(groupKey, summary);
        continue;
      }

      if (compareCoordinates(summary.coordinates, existing.coordinates) < 0) {
        targetsByGroup.set(groupKey, summary);
      }
    }

    return Array.from(targetsByGroup.values(), (summary) => this.createBrowseTarget(summary));
  }

  private getBrowseCommentTargetsForViewport(): BrowseCommentTarget[] {
    const targets = this.getBrowseCommentTargets();
    const camera = this.options.scene.cameras.main;
    const view = camera.worldView;
    const guardX = view.width * BROWSE_COMMENT_VIEWPORT_GUARD_FRACTION;
    const guardY = view.height * BROWSE_COMMENT_VIEWPORT_GUARD_FRACTION;
    const minX = view.x - guardX;
    const maxX = view.right + guardX;
    const minY = view.y - guardY;
    const maxY = view.bottom + guardY;
    const selectedCoordinates = this.options.getSelectedCoordinates?.() ?? null;
    const centerX = view.centerX;
    const centerY = view.centerY;

    return targets
      .filter((target) => {
        if (selectedCoordinates && coordinatesEqual(target.displayCoordinates, selectedCoordinates)) {
          return true;
        }
        const origin = this.options.getRoomOrigin(target.displayCoordinates);
        return (
          origin.x + ROOM_PX_WIDTH >= minX
          && origin.x <= maxX
          && origin.y + ROOM_PX_HEIGHT >= minY
          && origin.y <= maxY
        );
      })
      .sort((left, right) => {
        const leftSelected = selectedCoordinates && coordinatesEqual(left.displayCoordinates, selectedCoordinates);
        const rightSelected = selectedCoordinates && coordinatesEqual(right.displayCoordinates, selectedCoordinates);
        if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
        if (left.signature === this.pinnedBrowseMarkerKey) return -1;
        if (right.signature === this.pinnedBrowseMarkerKey) return 1;
        const leftOrigin = this.options.getRoomOrigin(left.displayCoordinates);
        const rightOrigin = this.options.getRoomOrigin(right.displayCoordinates);
        const leftDistance = Math.hypot(
          leftOrigin.x + ROOM_PX_WIDTH * 0.5 - centerX,
          leftOrigin.y + ROOM_PX_HEIGHT * 0.5 - centerY,
        );
        const rightDistance = Math.hypot(
          rightOrigin.x + ROOM_PX_WIDTH * 0.5 - centerX,
          rightOrigin.y + ROOM_PX_HEIGHT * 0.5 - centerY,
        );
        return leftDistance - rightDistance || left.signature.localeCompare(right.signature);
      });
  }

  private getBrowseCommentTargetForCoordinates(
    coordinates: RoomCoordinates,
  ): BrowseCommentTarget | null {
    const worldWindow = this.options.getWorldWindow?.();
    if (!worldWindow) {
      return null;
    }

    const selectedSummary = worldWindow.rooms.find((summary) =>
      coordinatesEqual(summary.coordinates, coordinates)
    );
    if (!selectedSummary || selectedSummary.state !== 'published' || selectedSummary.version === null) {
      return null;
    }

    const groupKey = this.getBrowseCommentGroupKey(selectedSummary);
    const targetSummary =
      this.getBrowseCommentTargets().find((target) => target.groupKey === groupKey)
      ?? this.createBrowseTarget(selectedSummary);
    return targetSummary;
  }

  private createBrowseTarget(summary: WorldRoomSummary): BrowseCommentTarget {
    const groupKey = this.getBrowseCommentGroupKey(summary);
    const version = summary.version ?? 0;
    return {
      signature: `${groupKey}:v${version}`,
      groupKey,
      roomId: summary.id,
      version,
      coordinates: { ...summary.coordinates },
      displayCoordinates: { ...summary.coordinates },
      title: summary.expandedRoom?.title?.trim() || summary.title?.trim() || null,
    };
  }

  private getBrowseCommentGroupKey(summary: WorldRoomSummary): string {
    return summary.expandedRoom?.expandedRoomId ?? summary.id;
  }

  private getBrowseMarkerPosition(origin: { x: number; y: number }): {
    zoomedIn: { x: number; y: number };
    zoomedOut: { x: number; y: number };
  } {
    return {
      zoomedIn: {
        x: origin.x + ROOM_PX_WIDTH * 0.5 - BROWSE_COMMENT_COMPACT_WIDTH * 0.5,
        y: origin.y + ROOM_PX_HEIGHT * 0.3,
      },
      zoomedOut: {
        x: origin.x + ROOM_PX_WIDTH * 0.5 - BROWSE_COMMENT_COMPACT_WIDTH * 0.5,
        y: origin.y + ROOM_PX_HEIGHT * 0.5 - BROWSE_COMMENT_COMPACT_HEIGHT * 0.5,
      },
    };
  }

  private createBrowseCommentMarker(
    target: BrowseCommentTarget,
    comments: BrowseRoomCommentPreview[],
    commentCount: number,
    commentSignature: string,
  ): RenderedBrowseCommentMarker {
    const accentColor = getBrowseCommentAccentColor(target.signature);
    const dotContainer = this.createBrowseCommentDot(accentColor);
    const compactContainer = this.createBrowseCommentCompact(accentColor, commentCount);
    const compactCountText = compactContainer.getByName('count') as Phaser.GameObjects.Text;
    const textMarker = this.createBrowseCommentTextMarker(accentColor);
    const container = this.options.scene.add.container(0, 0, [
      dotContainer,
      compactContainer,
      textMarker.container,
    ]);
    container.setDepth(BROWSE_COMMENT_DEPTH);
    container.setSize(BROWSE_COMMENT_COMPACT_WIDTH, BROWSE_COMMENT_COMPACT_HEIGHT);
    container.setInteractive(
      new Phaser.Geom.Rectangle(-7, -7, 45, 35),
      Phaser.Geom.Rectangle.Contains,
    );
    if (container.input) {
      container.input.cursor = 'pointer';
    }

    const marker: RenderedBrowseCommentMarker = {
      key: target.signature,
      target,
      comments,
      commentCount,
      commentSignature,
      accentColor,
      container,
      dotContainer,
      compactContainer,
      textContainer: textMarker.container,
      compactCountText,
      textPanel: textMarker.panel,
      textHeaderText: textMarker.headerText,
      textBodyText: textMarker.bodyText,
      textMetaText: textMarker.metaText,
      jiggleOffsetMs: hashStringToPositiveNumber(target.signature) % BROWSE_COMMENT_JIGGLE_PERIOD_MS,
      zoomedInPosition: { x: 0, y: 0 },
      zoomedOutPosition: { x: 0, y: 0 },
      tierDisplays: [
        { tier: 'dot', container: dotContainer, scaleMultiplier: 1 },
        { tier: 'compact', container: compactContainer, scaleMultiplier: 1 },
        { tier: 'text', container: textMarker.container, scaleMultiplier: 1 },
      ],
    };

    this.redrawBrowseCommentMarker(marker);
    container.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => {
      this.hoveredBrowseMarkerKey = marker.key;
      this.syncBrowseCommentMarkerPresentation();
    });
    container.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => {
      if (this.hoveredBrowseMarkerKey === marker.key) {
        this.hoveredBrowseMarkerKey = null;
        this.syncBrowseCommentMarkerPresentation();
      }
    });
    container.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event.stopPropagation();
        this.options.selectRoomCoordinates?.(marker.target.displayCoordinates);
        this.setPinnedBrowseMarkerKey(this.pinnedBrowseMarkerKey === marker.key ? null : marker.key);
        if (this.pinnedBrowseMarkerKey === marker.key) {
          const cached = this.browseCommentCache.get(marker.key);
          if (!cached?.full) void this.loadBrowseComments(marker.target, true);
        }
        this.syncBrowseCommentMarkerPresentation();
      },
    );

    return marker;
  }

  private createBrowseCommentDot(accentColor: number): Phaser.GameObjects.Container {
    const shadow = this.options.scene.add.rectangle(
      2,
      2,
      BROWSE_COMMENT_DOT_SIZE,
      BROWSE_COMMENT_DOT_SIZE,
      BROWSE_COMMENT_INK,
      0.82,
    );
    shadow.setOrigin(0, 0);
    const dot = this.options.scene.add.rectangle(
      0,
      0,
      BROWSE_COMMENT_DOT_SIZE,
      BROWSE_COMMENT_DOT_SIZE,
      accentColor,
      1,
    );
    dot.setOrigin(0, 0);
    dot.setStrokeStyle(1, BROWSE_COMMENT_INK, 1);
    return this.options.scene.add.container(0, 0, [shadow, dot]);
  }

  private createBrowseCommentCompact(
    accentColor: number,
    count: number,
  ): Phaser.GameObjects.Container {
    const panel = this.options.scene.add.graphics();
    drawBrowseCompactPanel(panel, accentColor);
    const countText = this.options.scene.add.text(0, 0, String(count), {
      fontFamily: 'IBM Plex Mono, Courier New, monospace',
      fontSize: '11px',
      color: '#18161c',
      fontStyle: '700',
      align: 'center',
      fixedWidth: BROWSE_COMMENT_COMPACT_WIDTH,
      fixedHeight: BROWSE_COMMENT_COMPACT_HEIGHT,
    });
    countText.setName('count');
    countText.setPosition(0, 3);
    return this.options.scene.add.container(0, 0, [panel, countText]);
  }

  private createBrowseCommentTextMarker(accentColor: number): {
    container: Phaser.GameObjects.Container;
    panel: Phaser.GameObjects.Graphics;
    headerText: Phaser.GameObjects.Text;
    bodyText: Phaser.GameObjects.Text;
    metaText: Phaser.GameObjects.Text;
  } {
    const panel = this.options.scene.add.graphics();
    const headerText = this.options.scene.add.text(12, 8, '', {
      fontFamily: 'IBM Plex Mono, Courier New, monospace',
      fontSize: '10px',
      color: BROWSE_COMMENT_MUTED,
      fontStyle: '700',
    });
    const bodyText = this.options.scene.add.text(12, 24, '', {
      fontFamily: 'IBM Plex Mono, Courier New, monospace',
      fontSize: '11px',
      color: BROWSE_COMMENT_BODY,
      wordWrap: { width: BROWSE_COMMENT_PANEL_WIDTH - 24 },
      maxLines: 2,
      lineSpacing: 2,
    });
    const metaText = this.options.scene.add.text(12, 56, '', {
      fontFamily: 'IBM Plex Mono, Courier New, monospace',
      fontSize: '9px',
      color: BROWSE_COMMENT_MUTED,
    });
    const container = this.options.scene.add.container(0, 0, [
      panel,
      headerText,
      bodyText,
      metaText,
    ]);
    drawBrowseTextPanel(panel, accentColor);
    return { container, panel, headerText, bodyText, metaText };
  }

  private redrawBrowseCommentMarker(marker: RenderedBrowseCommentMarker): void {
    const latestComment = marker.comments[0];
    const count = marker.commentCount;
    marker.compactCountText.setText(count > 99 ? '99+' : String(count));
    if (!latestComment) {
      marker.textHeaderText.setText('No comments');
      marker.textBodyText.setText('');
      marker.textMetaText.setText(marker.target.title ?? '');
      drawBrowseTextPanel(marker.textPanel, marker.accentColor);
      return;
    }

    marker.textHeaderText.setText(formatCommentCount(count));
    marker.textBodyText.setText(truncateCommentBody(latestComment.body, 82));
    marker.textMetaText.setText(
      `${truncateCommentBody(latestComment.authorDisplayName, 18)} - ${formatCommentTime(latestComment.createdAt)}`,
    );
    drawBrowseTextPanel(marker.textPanel, marker.accentColor);
  }

  private syncBrowseCommentMarkerPresentation(): void {
    if (this.browseCommentMarkersByKey.size === 0) {
      return;
    }

    const zoom = this.options.getZoom?.() ?? this.options.scene.cameras.main.zoom;
    syncBadgePlacements(
      this.browseCommentMarkersByKey.values(),
      zoom,
      this.browseMarkerScaleConfig,
    );
    const reduceMotion = prefersReducedMotion();
    const now = this.options.scene.time.now;
    for (const marker of this.browseCommentMarkersByKey.values()) {
      const popoverVisible =
        marker.key === this.hoveredBrowseMarkerKey ||
        marker.key === this.pinnedBrowseMarkerKey;
      if (popoverVisible) {
        marker.container.setVisible(true);
        marker.container.setAlpha(1);
        marker.textContainer.setVisible(true);
        marker.textContainer.setAlpha(1);
        marker.compactContainer.setAlpha(0);
        marker.dotContainer.setAlpha(0);
      }

      marker.container.setRotation(
        this.getBrowseMarkerJiggleRotation(marker, zoom, now, reduceMotion, popoverVisible),
      );
    }
  }

  private getBrowseMarkerJiggleRotation(
    marker: RenderedBrowseCommentMarker,
    zoom: number,
    now: number,
    reduceMotion: boolean,
    popoverVisible: boolean,
  ): number {
    if (reduceMotion || popoverVisible || zoom >= BROWSE_COMMENT_COMPACT_TIER_MAX_ZOOM) {
      return 0;
    }

    const localTime =
      (now + marker.jiggleOffsetMs) % BROWSE_COMMENT_JIGGLE_PERIOD_MS;
    if (localTime > BROWSE_COMMENT_JIGGLE_DURATION_MS) {
      return 0;
    }

    const wave = Math.sin((localTime / BROWSE_COMMENT_JIGGLE_DURATION_MS) * Math.PI * 5);
    return wave * 0.085;
  }

  private destroyBrowseCommentMarkers(): void {
    for (const marker of this.browseCommentMarkersByKey.values()) {
      this.destroyBrowseCommentMarker(marker);
    }
    this.browseCommentMarkersByKey.clear();
  }

  private destroyBrowseCommentMarker(marker: RenderedBrowseCommentMarker): void {
    marker.container.destroy(true);
  }

  private syncBrowseDanmakuStreams(): void {
    const now = this.options.scene.time.now;
    const lastUpdate = this.lastBrowseDanmakuUpdateMs || now;
    const deltaMs = Phaser.Math.Clamp(now - lastUpdate, 0, 80);
    this.lastBrowseDanmakuUpdateMs = now;

    const camera = this.options.scene.cameras.main;
    const zoom = this.options.getZoom?.() ?? camera.zoom;
    if (!this.shouldRenderBrowseDanmaku(zoom)) {
      this.deactivateAllBrowseDanmakuStreams();
      this.nextBrowseDanmakuSpawnAtMs = now + BROWSE_DANMAKU_RETRY_MS;
      return;
    }

    const candidates = this.getBrowseDanmakuCandidates(camera, zoom);
    if (candidates.length === 0) {
      this.deactivateAllBrowseDanmakuStreams();
      this.nextBrowseDanmakuSpawnAtMs = now + BROWSE_DANMAKU_RETRY_MS;
      return;
    }

    const validKeys = new Set(candidates.map((candidate) => candidate.key));
    this.updateActiveBrowseDanmakuStreams(camera, zoom, deltaMs, validKeys);

    const maxActive = this.getBrowseDanmakuMaxActive();
    if (this.activeBrowseDanmaku.size >= maxActive || now < this.nextBrowseDanmakuSpawnAtMs) {
      return;
    }

    const spawnIntervalMs = this.getBrowseDanmakuSpawnIntervalMs(candidates.length);
    const laneCount = this.getBrowseDanmakuLaneCount();
    const laneIndex = this.getAvailableBrowseDanmakuLane(now, laneCount);
    if (laneIndex < 0) {
      this.nextBrowseDanmakuSpawnAtMs = now + Math.min(BROWSE_DANMAKU_RETRY_MS, spawnIntervalMs);
      return;
    }

    const candidate = this.pickBrowseDanmakuCandidate(candidates);
    if (!candidate) {
      this.nextBrowseDanmakuSpawnAtMs = now + Math.min(BROWSE_DANMAKU_RETRY_MS, spawnIntervalMs);
      return;
    }

    if (!this.activateBrowseDanmakuStream(candidate, laneIndex, camera, zoom)) {
      this.nextBrowseDanmakuSpawnAtMs = now + Math.min(BROWSE_DANMAKU_RETRY_MS, spawnIntervalMs);
      return;
    }

    this.nextBrowseDanmakuSpawnAtMs = now + spawnIntervalMs;
    this.browseDanmakuLaneCooldowns[laneIndex] =
      now + Math.min(BROWSE_DANMAKU_LANE_COOLDOWN_MS, Math.max(360, spawnIntervalMs * 0.8));
  }

  private shouldRenderBrowseDanmaku(zoom: number): boolean {
    return (
      this.options.getMode() === 'browse'
      && this.commentsVisible
      && zoom >= BROWSE_DANMAKU_MIN_ZOOM
      && zoom <= BROWSE_DANMAKU_MAX_ZOOM
      && !prefersReducedMotion()
      && !this.hasBlockingModalOpen()
    );
  }

  private getBrowseDanmakuCandidates(
    camera: Phaser.Cameras.Scene2D.Camera,
    zoom: number,
  ): BrowseDanmakuCandidate[] {
    const candidates: BrowseDanmakuCandidate[] = [];
    const markers = Array.from(this.browseCommentMarkersByKey.values()).sort((left, right) =>
      left.key.localeCompare(right.key)
    );
    for (const marker of markers) {
      if (!this.isBrowseDanmakuTargetNearViewport(marker.target, camera, zoom)) {
        continue;
      }

      const comments = marker.comments.slice(0, BROWSE_DANMAKU_MAX_COMMENT_PER_TARGET);
      for (const comment of comments) {
        candidates.push({
          key: marker.key,
          target: marker.target,
          comment,
          accentColor: marker.accentColor,
        });
      }
    }

    return candidates;
  }

  private updateActiveBrowseDanmakuStreams(
    camera: Phaser.Cameras.Scene2D.Camera,
    zoom: number,
    deltaMs: number,
    validKeys: Set<string>,
  ): void {
    for (const stream of Array.from(this.activeBrowseDanmaku)) {
      if (!stream.key || !validKeys.has(stream.key)) {
        this.deactivateBrowseDanmakuStream(stream);
        continue;
      }

      if (!stream.target) {
        this.deactivateBrowseDanmakuStream(stream);
        continue;
      }

      const track = this.getBrowseDanmakuTrack(
        stream.target,
        stream.laneIndex,
        camera,
        zoom,
        stream.widthPx,
      );
      if (!track) {
        this.deactivateBrowseDanmakuStream(stream);
        continue;
      }

      stream.ageMs += deltaMs;
      stream.trackOffsetX -= stream.speedPxPerSecond * (deltaMs / 1000);
      stream.screenX = track.centerX + stream.trackOffsetX;
      if (stream.screenX < track.exitX) {
        this.deactivateBrowseDanmakuStream(stream);
        continue;
      }

      stream.container.setAlpha(this.getBrowseDanmakuStreamAlpha(stream, track));
      this.placeBrowseDanmakuStream(stream, camera, zoom, track);
    }
  }

  private activateBrowseDanmakuStream(
    candidate: BrowseDanmakuCandidate,
    laneIndex: number,
    camera: Phaser.Cameras.Scene2D.Camera,
    zoom: number,
  ): boolean {
    const stream = this.idleBrowseDanmaku.pop() ?? this.createBrowseDanmakuStream();
    const maxBodyLength = camera.width < 760
      ? Math.min(48, BROWSE_DANMAKU_MAX_COMMENT_LENGTH)
      : BROWSE_DANMAKU_MAX_COMMENT_LENGTH;
    const body = truncateCommentBody(candidate.comment.body, maxBodyLength);
    const author = truncateCommentBody(candidate.comment.authorDisplayName || 'Player', 18);
    const title = candidate.target.title
      ? truncateCommentBody(candidate.target.title, 24)
      : `${candidate.target.displayCoordinates.x},${candidate.target.displayCoordinates.y}`;

    stream.bodyText.setText(body);
    stream.metaText.setText(`${author} / ${title}`);
    stream.accent.setFillStyle(candidate.accentColor, 0.98);
    const width = Math.ceil(
      Math.max(stream.bodyText.width, stream.metaText.width) + 28,
    );
    const track = this.getBrowseDanmakuTrack(
      candidate.target,
      laneIndex,
      camera,
      zoom,
      width,
    );
    if (!track) {
      this.idleBrowseDanmaku.push(stream);
      return false;
    }

    stream.shell.setSize(width, BROWSE_DANMAKU_HEIGHT);
    stream.accent.setSize(5, BROWSE_DANMAKU_HEIGHT);
    stream.container.setSize(width, BROWSE_DANMAKU_HEIGHT);
    stream.container.setAlpha(0);
    stream.container.setDepth(BROWSE_DANMAKU_DEPTH);
    stream.widthPx = width;
    stream.screenX = track.startX;
    stream.trackOffsetX = track.startX - track.centerX;
    stream.ageMs = 0;
    stream.speedPxPerSecond = Phaser.Math.Between(
      BROWSE_DANMAKU_MIN_SPEED,
      BROWSE_DANMAKU_MAX_SPEED,
    );
    stream.laneIndex = laneIndex;
    stream.key = candidate.key;
    stream.commentId = candidate.comment.id;
    stream.target = candidate.target;
    stream.active = true;
    stream.container.removeInteractive();
    stream.container.setInteractive(
      new Phaser.Geom.Rectangle(
        0,
        0,
        width,
        BROWSE_DANMAKU_HEIGHT,
      ),
      Phaser.Geom.Rectangle.Contains,
    );
    if (stream.container.input) {
      stream.container.input.cursor = 'pointer';
    }
    stream.container.setVisible(true);
    this.activeBrowseDanmaku.add(stream);
    this.placeBrowseDanmakuStream(stream, camera, zoom, track);
    stream.container.setAlpha(this.getBrowseDanmakuStreamAlpha(stream, track));
    this.options.onDisplayObjectsChanged?.();
    return true;
  }

  private createBrowseDanmakuStream(): RenderedBrowseDanmakuComment {
    const shell = this.options.scene.add.rectangle(
      0,
      0,
      96,
      BROWSE_DANMAKU_HEIGHT,
      0x050505,
      0.62,
    );
    shell.setOrigin(0, 0);
    shell.setStrokeStyle(1, 0xfff3db, 0.36);
    const accent = this.options.scene.add.rectangle(
      0,
      0,
      5,
      BROWSE_DANMAKU_HEIGHT,
      BROWSE_COMMENT_COLORS[0],
      0.98,
    );
    accent.setOrigin(0, 0);
    const bodyText = this.options.scene.add.text(12, 3, '', {
      fontFamily: 'IBM Plex Mono, Courier New, monospace',
      fontSize: `${BROWSE_DANMAKU_FONT_SIZE}px`,
      color: '#fff6df',
      fontStyle: '700',
      stroke: '#050505',
      strokeThickness: 4,
    });
    bodyText.setShadow(2, 2, '#050505', 0, true, true);
    const metaText = this.options.scene.add.text(13, 18, '', {
      fontFamily: 'IBM Plex Mono, Courier New, monospace',
      fontSize: '8px',
      color: '#7de5ff',
      fontStyle: '700',
      stroke: '#050505',
      strokeThickness: 3,
    });
    metaText.setShadow(1, 1, '#050505', 0, true, true);
    const container = this.options.scene.add.container(0, 0, [
      shell,
      accent,
      bodyText,
      metaText,
    ]);
    container.setDepth(BROWSE_DANMAKU_DEPTH);
    container.setVisible(false);

    const stream: RenderedBrowseDanmakuComment = {
      container,
      shell,
      accent,
      bodyText,
      metaText,
      active: false,
      key: null,
      commentId: null,
      target: null,
      laneIndex: 0,
      screenX: 0,
      trackOffsetX: 0,
      ageMs: 0,
      widthPx: 96,
      speedPxPerSecond: BROWSE_DANMAKU_MIN_SPEED,
    };

    container.setName('browse-danmaku-comment');
    container.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event.stopPropagation();
        this.handleBrowseDanmakuClick(stream);
      },
    );

    return stream;
  }

  private placeBrowseDanmakuStream(
    stream: RenderedBrowseDanmakuComment,
    camera: Phaser.Cameras.Scene2D.Camera,
    zoom: number,
    track?: BrowseDanmakuTrack,
  ): void {
    const safeZoom = Math.max(zoom, 0.001);
    const screenScale = 1 / safeZoom;
    const localTrack =
      track
      ?? (stream.target
        ? this.getBrowseDanmakuTrack(stream.target, stream.laneIndex, camera, zoom, stream.widthPx)
        : null);
    if (localTrack) {
      stream.screenX = localTrack.centerX + stream.trackOffsetX;
    }
    const screenY =
      localTrack?.screenY
      ?? this.getBrowseDanmakuFallbackLaneScreenY(stream.laneIndex, camera);
    stream.container.setPosition(
      camera.worldView.x + stream.screenX / safeZoom,
      camera.worldView.y + screenY / safeZoom,
    );
    stream.container.setScale(screenScale);
  }

  private getBrowseDanmakuStreamAlpha(
    stream: RenderedBrowseDanmakuComment,
    track: BrowseDanmakuTrack,
  ): number {
    const fadeIn = Phaser.Math.Clamp(stream.ageMs / BROWSE_DANMAKU_FADE_IN_MS, 0, 1);
    const fadeOutDistancePx = Math.max(
      1,
      stream.speedPxPerSecond * (BROWSE_DANMAKU_FADE_OUT_MS / 1000),
    );
    const distanceToExit = Math.max(0, stream.screenX - track.exitX);
    const fadeOut = Phaser.Math.Clamp(distanceToExit / fadeOutDistancePx, 0, 1);
    return BROWSE_DANMAKU_MAX_ALPHA * Math.min(fadeIn, fadeOut);
  }

  private pickBrowseDanmakuCandidate(
    candidates: BrowseDanmakuCandidate[],
  ): BrowseDanmakuCandidate | null {
    if (candidates.length === 0) {
      return null;
    }

    for (let attempt = 0; attempt < candidates.length; attempt += 1) {
      const candidate = candidates[this.browseDanmakuCandidateCursor % candidates.length];
      this.browseDanmakuCandidateCursor =
        (this.browseDanmakuCandidateCursor + 1) % candidates.length;
      if (!this.isBrowseDanmakuCandidateActive(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private isBrowseDanmakuCandidateActive(candidate: BrowseDanmakuCandidate): boolean {
    for (const stream of this.activeBrowseDanmaku) {
      if (stream.key === candidate.key && stream.commentId === candidate.comment.id) {
        return true;
      }
    }

    return false;
  }

  private getBrowseDanmakuSpawnIntervalMs(candidateCount: number): number {
    if (candidateCount <= 0) {
      return BROWSE_DANMAKU_CYCLE_MS;
    }

    return Phaser.Math.Clamp(
      BROWSE_DANMAKU_CYCLE_MS / candidateCount,
      this.getBrowseDanmakuMinSpawnGapMs(),
      BROWSE_DANMAKU_CYCLE_MS,
    );
  }

  private getBrowseDanmakuMinSpawnGapMs(): number {
    const layout = getDeviceLayoutState();
    if (layout.deviceClass === 'phone') {
      return BROWSE_DANMAKU_PHONE_MIN_SPAWN_GAP_MS;
    }

    return getResolvedPerformancePolicy(layout.performanceProfile).visualDataProfile === 'reduced'
      ? BROWSE_DANMAKU_REDUCED_MIN_SPAWN_GAP_MS
      : BROWSE_DANMAKU_DESKTOP_MIN_SPAWN_GAP_MS;
  }

  private getBrowseDanmakuDebugScreenY(stream: RenderedBrowseDanmakuComment): number {
    const camera = this.options.scene.cameras.main;
    const zoom = this.options.getZoom?.() ?? camera.zoom;
    const track = stream.target
      ? this.getBrowseDanmakuTrack(stream.target, stream.laneIndex, camera, zoom, stream.widthPx)
      : null;
    return track?.screenY ?? this.getBrowseDanmakuFallbackLaneScreenY(stream.laneIndex, camera);
  }

  private handleBrowseDanmakuClick(stream: RenderedBrowseDanmakuComment): void {
    if (!stream.active || !stream.target) {
      return;
    }

    const target = stream.target;
    this.setPinnedBrowseMarkerKey(target.signature);
    const pinGeneration = this.pinnedBrowseRequestGeneration;
    this.hoveredBrowseMarkerKey = null;
    const cached = this.browseCommentCache.get(target.signature);
    if (!cached?.full) this.loadBrowseComments(target, true);
    this.syncBrowseCommentMarkerPresentation();
    this.options.showTransientStatus?.('Opening comment room...');

    if (this.options.jumpToRoomCoordinates) {
      void Promise.resolve(this.options.jumpToRoomCoordinates(target.displayCoordinates))
        .then(() => {
          if (
            pinGeneration !== this.pinnedBrowseRequestGeneration
            || this.options.getMode() !== 'browse'
          ) return;
          this.setPinnedBrowseMarkerKey(target.signature);
          this.syncBrowseCommentMarkers();
          this.syncBrowseCommentMarkerPresentation();
        })
        .catch((error) => {
          console.warn('Failed to jump to comment room.', error);
          this.options.showTransientStatus?.('Could not open comment room.');
        });
      return;
    }

    this.options.selectRoomCoordinates?.(target.displayCoordinates);
  }

  private getAvailableBrowseDanmakuLane(now: number, laneCount: number): number {
    this.browseDanmakuLaneCooldowns.length = laneCount;
    let bestLane = -1;
    let bestActiveCount = Number.POSITIVE_INFINITY;
    for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
      const cooldownUntil = this.browseDanmakuLaneCooldowns[laneIndex] ?? 0;
      if (cooldownUntil > now) {
        continue;
      }

      const activeCount = this.countActiveBrowseDanmakuInLane(laneIndex);
      if (activeCount < bestActiveCount) {
        bestLane = laneIndex;
        bestActiveCount = activeCount;
      }
    }

    return bestLane;
  }

  private countActiveBrowseDanmakuInLane(laneIndex: number): number {
    let count = 0;
    for (const stream of this.activeBrowseDanmaku) {
      if (stream.laneIndex === laneIndex) {
        count += 1;
      }
    }

    return count;
  }

  private getBrowseDanmakuLaneCount(): number {
    const layout = getDeviceLayoutState();
    if (layout.deviceClass === 'phone') {
      return BROWSE_DANMAKU_MIN_LANES;
    }

    return getResolvedPerformancePolicy(layout.performanceProfile).visualDataProfile === 'reduced'
      ? 4
      : 5;
  }

  private getBrowseDanmakuFallbackLaneScreenY(
    laneIndex: number,
    camera: Phaser.Cameras.Scene2D.Camera,
  ): number {
    const laneCount = Math.min(BROWSE_DANMAKU_MAX_LANES, this.getBrowseDanmakuLaneCount());
    const topPadding = camera.height > 520 ? BROWSE_DANMAKU_TOP_PADDING : 52;
    const bottomPadding = camera.height > 520 ? BROWSE_DANMAKU_BOTTOM_PADDING : 72;
    const bottom = Math.max(topPadding + BROWSE_DANMAKU_HEIGHT, camera.height - bottomPadding);
    if (laneCount <= 1) {
      return topPadding;
    }

    const spacing = (bottom - topPadding - BROWSE_DANMAKU_HEIGHT) / (laneCount - 1);
    const clampedLaneIndex = Phaser.Math.Clamp(laneIndex, 0, laneCount - 1);
    return topPadding + spacing * clampedLaneIndex;
  }

  private isBrowseDanmakuTargetNearViewport(
    target: BrowseCommentTarget,
    camera: Phaser.Cameras.Scene2D.Camera,
    zoom: number,
  ): boolean {
    return Boolean(this.getBrowseDanmakuTrack(target, 0, camera, zoom, 96));
  }

  private getBrowseDanmakuTrack(
    target: BrowseCommentTarget,
    laneIndex: number,
    camera: Phaser.Cameras.Scene2D.Camera,
    zoom: number,
    widthPx: number,
  ): BrowseDanmakuTrack | null {
    const safeZoom = Math.max(zoom, 0.001);
    const origin = this.options.getRoomOrigin(target.displayCoordinates);
    const roomScreenWidth = ROOM_PX_WIDTH * safeZoom;
    const roomScreenHeight = ROOM_PX_HEIGHT * safeZoom;
    const roomLeft = (origin.x - camera.worldView.x) * safeZoom;
    const roomTop = (origin.y - camera.worldView.y) * safeZoom;
    const roomRight = roomLeft + roomScreenWidth;
    const roomBottom = roomTop + roomScreenHeight;
    const topPadding = camera.height > 520 ? BROWSE_DANMAKU_TOP_PADDING : 52;
    const bottomPadding = camera.height > 520 ? BROWSE_DANMAKU_BOTTOM_PADDING : 72;
    const safeBottom = camera.height - bottomPadding;

    if (
      roomRight < -BROWSE_DANMAKU_ROOM_TRACK_MAX_HALF_WIDTH ||
      roomLeft > camera.width + BROWSE_DANMAKU_ROOM_TRACK_MAX_HALF_WIDTH ||
      roomBottom < topPadding - BROWSE_DANMAKU_HEIGHT ||
      roomTop > safeBottom + BROWSE_DANMAKU_HEIGHT
    ) {
      return null;
    }

    const laneCount = this.getBrowseDanmakuLaneCount();
    const localLaneIndex = Phaser.Math.Wrap(laneIndex, 0, laneCount);
    const centeredLaneIndex = localLaneIndex - (laneCount - 1) * 0.5;
    const laneSpacing = Phaser.Math.Clamp(
      roomScreenHeight * 0.16,
      BROWSE_DANMAKU_ROOM_TRACK_LANE_SPACING_MIN,
      BROWSE_DANMAKU_ROOM_TRACK_LANE_SPACING_MAX,
    );
    const unclampedScreenY =
      roomTop
      + roomScreenHeight * BROWSE_DANMAKU_ROOM_TRACK_VERTICAL_RATIO
      + centeredLaneIndex * laneSpacing;
    const screenY = Phaser.Math.Clamp(
      unclampedScreenY,
      topPadding,
      Math.max(topPadding, safeBottom - BROWSE_DANMAKU_HEIGHT),
    );

    const roomCenterX = roomLeft + roomScreenWidth * 0.5;
    const viewportTrackMax = Math.max(
      BROWSE_DANMAKU_ROOM_TRACK_MIN_HALF_WIDTH,
      camera.width * BROWSE_DANMAKU_ROOM_TRACK_VIEWPORT_MAX_FRACTION,
    );
    const trackHalfWidth = Phaser.Math.Clamp(
      roomScreenWidth * 0.58,
      BROWSE_DANMAKU_ROOM_TRACK_MIN_HALF_WIDTH,
      Math.min(BROWSE_DANMAKU_ROOM_TRACK_MAX_HALF_WIDTH, viewportTrackMax),
    );
    const startX = Math.min(
      camera.width + BROWSE_DANMAKU_SIDE_MARGIN,
      roomCenterX + trackHalfWidth + BROWSE_DANMAKU_SIDE_MARGIN,
    );
    const exitX = Math.max(
      -widthPx - BROWSE_DANMAKU_SIDE_MARGIN,
      roomCenterX - trackHalfWidth - widthPx - BROWSE_DANMAKU_SIDE_MARGIN,
    );
    if (startX < -widthPx || exitX > camera.width + BROWSE_DANMAKU_SIDE_MARGIN) {
      return null;
    }

    return {
      centerX: roomCenterX,
      startX,
      exitX,
      screenY,
    };
  }

  private getBrowseDanmakuMaxActive(): number {
    const layout = getDeviceLayoutState();
    if (layout.deviceClass === 'phone') {
      return BROWSE_DANMAKU_PHONE_MAX_ACTIVE;
    }

    return getResolvedPerformancePolicy(layout.performanceProfile).visualDataProfile === 'reduced'
      ? BROWSE_DANMAKU_REDUCED_MAX_ACTIVE
      : BROWSE_DANMAKU_DESKTOP_MAX_ACTIVE;
  }

  private deactivateAllBrowseDanmakuStreams(): void {
    for (const stream of Array.from(this.activeBrowseDanmaku)) {
      this.deactivateBrowseDanmakuStream(stream);
    }
  }

  private deactivateBrowseDanmakuStream(stream: RenderedBrowseDanmakuComment): void {
    if (!this.activeBrowseDanmaku.delete(stream) && !stream.active) {
      return;
    }

    stream.active = false;
    stream.key = null;
    stream.commentId = null;
    stream.target = null;
    stream.trackOffsetX = 0;
    stream.ageMs = 0;
    stream.container.removeInteractive();
    stream.container.setVisible(false);
    stream.container.setAlpha(0);
    this.idleBrowseDanmaku.push(stream);
    this.options.onDisplayObjectsChanged?.();
  }

  private destroyBrowseDanmakuStreams(): void {
    for (const stream of this.activeBrowseDanmaku) {
      stream.container.destroy(true);
    }
    for (const stream of this.idleBrowseDanmaku) {
      stream.container.destroy(true);
    }
    this.activeBrowseDanmaku.clear();
    this.idleBrowseDanmaku.length = 0;
    this.browseDanmakuLaneCooldowns.length = 0;
    this.lastBrowseDanmakuUpdateMs = 0;
    this.nextBrowseDanmakuSpawnAtMs = 0;
  }

  private hasBlockingModalOpen(): boolean {
    const doc = this.options.document ?? document;
    return Array.from(doc.querySelectorAll<HTMLElement>('.history-modal')).some((element) =>
      !element.classList.contains('hidden')
      && element.getAttribute('aria-hidden') !== 'true'
    );
  }

  private syncRenderedComments(room: RoomSnapshot | null): void {
    const visibleComments = room && this.commentsVisible ? this.comments : [];
    const nextIds = new Set<string>();
    let structureChanged = false;

    for (const comment of visibleComments) {
      nextIds.add(comment.id);
      const position = this.getCommentWorldPosition(comment);
      const existing = this.renderedCommentsById.get(comment.id);
      if (!existing) {
        const rendered = this.createRenderedComment(comment);
        rendered.container.setPosition(position.x, position.y);
        this.renderedCommentsById.set(comment.id, rendered);
        structureChanged = true;
        continue;
      }

      existing.comment = comment;
      existing.container.setPosition(position.x, position.y);
    }

    for (const [commentId, rendered] of this.renderedCommentsById.entries()) {
      if (nextIds.has(commentId)) {
        continue;
      }

      this.destroyRenderedComment(rendered);
      this.renderedCommentsById.delete(commentId);
      structureChanged = true;
    }

    if (structureChanged) {
      this.options.onDisplayObjectsChanged?.();
    }
  }

  private getCommentWorldPosition(comment: RoomCommentRecord): { x: number; y: number } {
    const origin = this.options.getRoomOrigin(comment.roomCoordinates);
    return {
      x: origin.x + comment.position.x,
      y: origin.y + comment.position.y - 22,
    };
  }

  private createRenderedComment(comment: RoomCommentRecord): RenderedRoomComment {
    const pin = this.options.scene.add.image(0, 0, COMMENT_PIN_TEXTURE_KEY);
    pin.setOrigin(0.5, 0.5);
    pin.setDisplaySize(20, 20);
    const panel = this.options.scene.add.graphics();
    const authorText = this.options.scene.add.text(0, 0, comment.authorDisplayName, {
      fontFamily: 'IBM Plex Mono, Courier New, monospace',
      fontSize: '11px',
      color: COMMENT_MUTED_COLOR,
    });
    const bodyText = this.options.scene.add.text(0, 0, comment.body, {
      fontFamily: 'IBM Plex Mono, Courier New, monospace',
      fontSize: '12px',
      color: COMMENT_TEXT_COLOR,
      wordWrap: { width: COMMENT_PANEL_WIDTH - COMMENT_PANEL_PADDING * 2 },
      lineSpacing: 3,
    });
    const timeText = this.options.scene.add.text(0, 0, formatCommentTime(comment.createdAt), {
      fontFamily: 'IBM Plex Mono, Courier New, monospace',
      fontSize: '10px',
      color: COMMENT_MUTED_COLOR,
    });
    const container = this.options.scene.add.container(0, 0, [
      pin,
      panel,
      authorText,
      bodyText,
      timeText,
    ]);
    container.setDepth(COMMENT_PIN_DEPTH);
    container.setSize(30, 30);
    container.setInteractive(
      new Phaser.Geom.Rectangle(-15, -15, 30, 30),
      Phaser.Geom.Rectangle.Contains,
    );

    const rendered: RenderedRoomComment = {
      comment,
      container,
      pin,
      panel,
      authorText,
      bodyText,
      timeText,
      pinned: false,
    };

    this.redrawRenderedComment(rendered);
    this.setPopoverVisible(rendered, false);

    container.on('pointerover', () => this.setPopoverVisible(rendered, true));
    container.on('pointerout', () => {
      if (!rendered.pinned) {
        this.setPopoverVisible(rendered, false);
      }
    });
    container.on('pointerdown', () => {
      rendered.pinned = !rendered.pinned;
      this.setPopoverVisible(rendered, rendered.pinned);
    });

    return rendered;
  }

  private redrawRenderedComment(rendered: RenderedRoomComment): void {
    rendered.authorText.setText(rendered.comment.authorDisplayName);
    rendered.bodyText.setText(rendered.comment.body);
    rendered.timeText.setText(formatCommentTime(rendered.comment.createdAt));
    const panelX = 16;
    const panelY = -12;
    const authorY = panelY + COMMENT_PANEL_PADDING;
    const bodyY = authorY + rendered.authorText.height + 4;
    const timeY = bodyY + rendered.bodyText.height + 7;
    const panelHeight = COMMENT_PANEL_PADDING + rendered.authorText.height + 4 + rendered.bodyText.height + 7 + rendered.timeText.height + COMMENT_PANEL_PADDING;

    rendered.panel.clear();
    rendered.panel.fillStyle(COMMENT_PANEL_FILL, 0.94);
    rendered.panel.lineStyle(2, COMMENT_PANEL_STROKE, 1);
    rendered.panel.fillRoundedRect(panelX, panelY, COMMENT_PANEL_WIDTH, panelHeight, 6);
    rendered.panel.strokeRoundedRect(panelX, panelY, COMMENT_PANEL_WIDTH, panelHeight, 6);
    rendered.panel.fillStyle(COMMENT_PANEL_FILL, 0.94);
    rendered.panel.fillTriangle(10, 2, panelX + 2, panelY + 14, panelX + 2, panelY + 26);

    rendered.authorText.setPosition(panelX + COMMENT_PANEL_PADDING, authorY);
    rendered.bodyText.setPosition(panelX + COMMENT_PANEL_PADDING, bodyY);
    rendered.timeText.setPosition(panelX + COMMENT_PANEL_PADDING, timeY);
  }

  private setPopoverVisible(rendered: RenderedRoomComment, visible: boolean): void {
    rendered.panel.setVisible(visible);
    rendered.authorText.setVisible(visible);
    rendered.bodyText.setVisible(visible);
    rendered.timeText.setVisible(visible);
  }

  private destroyRenderedComments(): void {
    for (const rendered of this.renderedCommentsById.values()) {
      this.destroyRenderedComment(rendered);
    }
    this.renderedCommentsById.clear();
  }

  private destroyRenderedComment(rendered: RenderedRoomComment): void {
    rendered.container.destroy(true);
  }

  private getRenderableRoom(): RoomSnapshot | null {
    if (this.options.getMode() !== 'play' || !this.options.isCurrentRoomPublished()) {
      return null;
    }

    return this.options.getCurrentRoomSnapshot();
  }

  private getRoomSignature(room: RoomSnapshot): string {
    return `${room.id}:v${room.version}`;
  }
}

function formatCommentTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatCommentCount(count: number): string {
  return count === 1 ? '1 comment' : `${count} comments`;
}

function truncateCommentBody(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function compareCommentsNewestFirst(
  left: Pick<RoomCommentRecord, 'createdAt'>,
  right: Pick<RoomCommentRecord, 'createdAt'>,
): number {
  return getCommentTimeMs(right.createdAt) - getCommentTimeMs(left.createdAt);
}

function getCommentTimeMs(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getCommentsSignature(
  comments: readonly BrowseRoomCommentPreview[],
  commentCount = comments.length,
): string {
  return `${commentCount}|${comments.map((comment) => `${comment.id}:${comment.createdAt}`).join('|')}`;
}

function coordinatesEqual(left: RoomCoordinates, right: RoomCoordinates): boolean {
  return left.x === right.x && left.y === right.y;
}

function compareCoordinates(left: RoomCoordinates, right: RoomCoordinates): number {
  if (left.y !== right.y) {
    return left.y - right.y;
  }

  return left.x - right.x;
}

function hashStringToPositiveNumber(value: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function getBrowseCommentAccentColor(key: string): number {
  return BROWSE_COMMENT_COLORS[hashStringToPositiveNumber(key) % BROWSE_COMMENT_COLORS.length];
}

function drawBrowseCompactPanel(panel: Phaser.GameObjects.Graphics, accentColor: number): void {
  panel.clear();
  panel.fillStyle(BROWSE_COMMENT_INK, 0.88);
  panel.fillRoundedRect(3, 3, BROWSE_COMMENT_COMPACT_WIDTH, BROWSE_COMMENT_COMPACT_HEIGHT, 5);
  panel.fillStyle(BROWSE_COMMENT_PANEL_FILL, 0.98);
  panel.lineStyle(2, BROWSE_COMMENT_INK, 1);
  panel.fillRoundedRect(0, 0, BROWSE_COMMENT_COMPACT_WIDTH, BROWSE_COMMENT_COMPACT_HEIGHT, 5);
  panel.strokeRoundedRect(0, 0, BROWSE_COMMENT_COMPACT_WIDTH, BROWSE_COMMENT_COMPACT_HEIGHT, 5);
  panel.fillStyle(accentColor, 1);
  panel.fillRoundedRect(2, 2, 7, BROWSE_COMMENT_COMPACT_HEIGHT - 4, 3);
}

function drawBrowseTextPanel(panel: Phaser.GameObjects.Graphics, accentColor: number): void {
  panel.clear();
  panel.fillStyle(BROWSE_COMMENT_INK, 0.88);
  panel.fillRoundedRect(
    4,
    4,
    BROWSE_COMMENT_PANEL_WIDTH,
    BROWSE_COMMENT_PANEL_HEIGHT,
    6,
  );
  panel.fillStyle(BROWSE_COMMENT_PANEL_FILL, 0.99);
  panel.lineStyle(2, BROWSE_COMMENT_INK, 1);
  panel.fillRoundedRect(
    0,
    0,
    BROWSE_COMMENT_PANEL_WIDTH,
    BROWSE_COMMENT_PANEL_HEIGHT,
    6,
  );
  panel.strokeRoundedRect(
    0,
    0,
    BROWSE_COMMENT_PANEL_WIDTH,
    BROWSE_COMMENT_PANEL_HEIGHT,
    6,
  );
  panel.fillStyle(accentColor, 1);
  panel.fillRoundedRect(3, 3, 5, BROWSE_COMMENT_PANEL_HEIGHT - 6, 3);
  panel.fillStyle(BROWSE_COMMENT_PANEL_LIGHT, 0.92);
  panel.fillRoundedRect(10, 20, BROWSE_COMMENT_PANEL_WIDTH - 18, 28, 4);
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
