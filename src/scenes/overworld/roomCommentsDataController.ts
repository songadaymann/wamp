import {
  ROOM_COMMENT_BROWSE_MAX_ROOM_IDS,
  type BrowseRoomCommentPreview,
  type RoomCommentRecord,
} from '../../roomComments/model';
import {
  fetchBrowseRoomCommentSummaries,
  fetchRoomComments,
} from '../../roomComments/client';
import type { RoomCoordinates, RoomSnapshot } from '../../persistence/roomModel';
import type { OverworldMode } from '../sceneData';

export interface BrowseCommentTarget {
  signature: string;
  groupKey: string;
  roomId: string;
  version: number;
  coordinates: RoomCoordinates;
  displayCoordinates: RoomCoordinates;
  title: string | null;
}

export interface BrowseCommentCacheEntry {
  comments: BrowseRoomCommentPreview[];
  commentCount: number;
  full: boolean;
}

interface PendingBrowseFullCommentLoad {
  target: BrowseCommentTarget;
  pinWhenLoaded: boolean;
  pinGeneration: number;
  loadGeneration: number;
}

interface RoomCommentsDataControllerOptions {
  getMode: () => OverworldMode;
  waitForBrowseDiscoveryReady?: (signal: AbortSignal) => Promise<boolean>;
  showTransientStatus?: (message: string) => void;
  onCurrentCommentsChanged: () => void;
  onBrowseDataChanged: () => void;
}

interface RoomCommentsDataDependencies {
  fetchRoomComments: typeof fetchRoomComments;
  fetchBrowseRoomCommentSummaries: typeof fetchBrowseRoomCommentSummaries;
  now: () => number;
}

const BROWSE_COMMENT_READINESS_RETRY_MS = 500;
const BROWSE_FULL_COMMENT_FETCH_CONCURRENCY = 2;
const BROWSE_COMMENT_FAILURE_RETRY_MS = 15_000;

const DEFAULT_DEPENDENCIES: RoomCommentsDataDependencies = {
  fetchRoomComments,
  fetchBrowseRoomCommentSummaries,
  now: Date.now,
};

export class RoomCommentsDataController {
  private comments: RoomCommentRecord[] = [];
  private activeRoomSignature: string | null = null;
  private loadingRoomSignature: string | null = null;
  private readonly browseCommentCache = new Map<string, BrowseCommentCacheEntry>();
  private readonly loadingBrowseRoomSignatures = new Map<string, PendingBrowseFullCommentLoad>();
  private readonly pendingBrowseFullCommentLoads = new Map<string, PendingBrowseFullCommentLoad>();
  private activeBrowseFullCommentLoadCount = 0;
  private browseFullCommentLoadGeneration = 0;
  private pinnedBrowseRequestGeneration = 0;
  private pinnedBrowseMarkerKey: string | null = null;
  private observedMode: OverworldMode;
  private readonly loadingBrowseSummarySignatures = new Set<string>();
  private readonly failedBrowseRoomSignaturesUntil = new Map<string, number>();
  private browseSummaryRequestInFlight = false;
  private browseSummaryGeneration = 0;
  private browseDiscoveryReady = false;
  private browseDiscoveryReadinessInFlight = false;
  private browseDiscoveryReadinessRetryAt = 0;
  private browseDiscoveryAbortController: AbortController | null = null;
  private readonly dependencies: RoomCommentsDataDependencies;

  constructor(
    private readonly options: RoomCommentsDataControllerOptions,
    dependencies: Partial<RoomCommentsDataDependencies> = {},
  ) {
    this.observedMode = options.getMode();
    this.dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  }

  reset(): void {
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
    this.pinnedBrowseMarkerKey = null;
  }

  observeCurrentRoom(room: RoomSnapshot | null): boolean {
    const nextSignature = room ? getRoomSignature(room) : null;
    if (nextSignature === this.activeRoomSignature) return false;

    this.activeRoomSignature = nextSignature;
    this.comments = [];
    if (room && nextSignature) void this.loadComments(room, nextSignature);
    return true;
  }

  syncObservedMode(): void {
    const mode = this.options.getMode();
    if (mode === this.observedMode) return;
    this.observedMode = mode;
    this.invalidateBrowseFullCommentLoads();
  }

  getCurrentComments(): readonly RoomCommentRecord[] {
    return this.comments;
  }

  getActiveRoomSignature(): string | null {
    return this.activeRoomSignature;
  }

  getLoadingRoomSignature(): string | null {
    return this.loadingRoomSignature;
  }

  getBrowseCacheEntry(signature: string): BrowseCommentCacheEntry | undefined {
    return this.browseCommentCache.get(signature);
  }

  getBrowseCommentCacheForCompatibility(): Map<string, BrowseCommentCacheEntry> {
    return this.browseCommentCache;
  }

  getPinnedBrowseMarkerKey(): string | null {
    return this.pinnedBrowseMarkerKey;
  }

  getPinnedBrowseRequestGeneration(): number {
    return this.pinnedBrowseRequestGeneration;
  }

  setPinnedBrowseMarkerKey(key: string | null): void {
    if (this.pinnedBrowseMarkerKey === key) return;
    this.pinnedBrowseMarkerKey = key;
    this.pinnedBrowseRequestGeneration += 1;
    if (key === null) this.pendingBrowseFullCommentLoads.clear();
  }

  loadBrowseComments(target: BrowseCommentTarget, pinWhenLoaded = false): void {
    if (pinWhenLoaded) {
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

  ensureBrowseDiscoveryReady(): boolean {
    if (this.browseDiscoveryReady) return true;
    if (!this.options.waitForBrowseDiscoveryReady) {
      this.browseDiscoveryReady = true;
      return true;
    }
    if (
      this.browseDiscoveryReadinessInFlight
      || this.dependencies.now() < this.browseDiscoveryReadinessRetryAt
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
        if (!ready) {
          this.browseDiscoveryReadinessRetryAt =
            this.dependencies.now() + BROWSE_COMMENT_READINESS_RETRY_MS;
        }
      })
      .catch((error) => {
        if (!abortController.signal.aborted) {
          console.warn('Failed to await browse comment discovery readiness', error);
          this.browseDiscoveryReadinessRetryAt =
            this.dependencies.now() + BROWSE_COMMENT_READINESS_RETRY_MS;
        }
      })
      .finally(() => {
        if (this.browseDiscoveryAbortController !== abortController) return;
        this.browseDiscoveryReadinessInFlight = false;
        this.browseDiscoveryAbortController = null;
        if (this.browseDiscoveryReady) this.options.onBrowseDataChanged();
      });
    return false;
  }

  queueBrowseSummaryLoad(targets: readonly BrowseCommentTarget[]): void {
    if (this.browseSummaryRequestInFlight) return;
    const now = this.dependencies.now();
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
    void this.dependencies.fetchBrowseRoomCommentSummaries(
      pendingTargets.map((target) => target.roomId),
    )
      .then((response) => {
        if (generation !== this.browseSummaryGeneration) return;
        const summariesByRoomId = new Map(response.rooms.map((summary) => [summary.roomId, summary]));
        for (const target of pendingTargets) {
          const summary = summariesByRoomId.get(target.roomId);
          if (!summary || summary.roomVersion !== target.version) {
            this.failedBrowseRoomSignaturesUntil.set(
              target.signature,
              this.dependencies.now() + BROWSE_COMMENT_FAILURE_RETRY_MS,
            );
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
        const retryAt = this.dependencies.now() + BROWSE_COMMENT_FAILURE_RETRY_MS;
        for (const target of pendingTargets) {
          this.failedBrowseRoomSignaturesUntil.set(target.signature, retryAt);
        }
      })
      .finally(() => {
        if (generation !== this.browseSummaryGeneration) return;
        for (const target of pendingTargets) {
          this.loadingBrowseSummarySignatures.delete(target.signature);
        }
        this.browseSummaryRequestInFlight = false;
        this.options.onBrowseDataChanged();
      });
  }

  getDebugSnapshot(): {
    activeRoomSignature: string | null;
    loadingRoomSignature: string | null;
    commentCount: number;
    browseCacheEntryCount: number;
    browseLoadingCount: number;
    pinnedBrowseMarkerKey: string | null;
  } {
    return {
      activeRoomSignature: this.activeRoomSignature,
      loadingRoomSignature: this.loadingRoomSignature,
      commentCount: this.comments.length,
      browseCacheEntryCount: this.browseCommentCache.size,
      browseLoadingCount:
        this.loadingBrowseRoomSignatures.size + this.pendingBrowseFullCommentLoads.size,
      pinnedBrowseMarkerKey: this.pinnedBrowseMarkerKey,
    };
  }

  private async loadComments(room: RoomSnapshot, signature: string): Promise<void> {
    if (this.loadingRoomSignature === signature) return;

    this.loadingRoomSignature = signature;
    try {
      const response = await this.dependencies.fetchRoomComments(
        room.id,
        room.coordinates,
        room.version,
      );
      if (this.activeRoomSignature !== signature) return;
      this.comments = response.comments;
      this.options.onCurrentCommentsChanged();
    } catch (error) {
      console.warn('Failed to load room comments', error);
    } finally {
      if (this.loadingRoomSignature === signature) {
        this.loadingRoomSignature = null;
      }
    }
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
      const response = await this.dependencies.fetchRoomComments(
        target.roomId,
        target.coordinates,
        target.version,
      );
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
      this.options.onBrowseDataChanged();
    } catch (error) {
      if (
        loadGeneration !== this.browseFullCommentLoadGeneration
        || this.options.getMode() !== 'browse'
      ) return;
      console.warn('Failed to load browse room comments', error);
      this.failedBrowseRoomSignaturesUntil.set(
        target.signature,
        this.dependencies.now() + BROWSE_COMMENT_FAILURE_RETRY_MS,
      );
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
}

function getRoomSignature(room: RoomSnapshot): string {
  return `${room.id}:v${room.version}`;
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
