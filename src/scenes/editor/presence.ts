import {
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
} from '../../config';
import type { RoomCoordinates, RoomSnapshot } from '../../persistence/roomRepository';
import { roomToChunkCoordinates } from '../../persistence/worldModel';
import {
  resolveWorldPresenceConfig,
  resolveWorldPresenceIdentity,
  WorldPresenceClient,
  type WorldPresenceIdentity,
} from '../../presence/worldPresence';

const SHARED_PREVIEW_PUBLISH_INTERVAL_MS = 1_200;

interface EditorPresenceHost {
  getRoomCoordinates(): RoomCoordinates;
  getEntrySource(): 'world' | 'direct';
  getPublishedVersion(): number;
  exportRoomSnapshot(): RoomSnapshot;
  isPlaying(): boolean;
  isSceneActive(): boolean;
}

export class EditorPresenceController {
  private client: WorldPresenceClient | null = null;
  private identity: WorldPresenceIdentity | null = null;
  private sharedConstructionPreviewDirty = true;
  private lastSharedConstructionPreviewPublishAt = 0;
  private lastSharedConstructionPreviewStateKey: string | null = null;

  constructor(private readonly host: EditorPresenceHost) {}

  initialize(): void {
    this.client?.destroy();
    this.client = null;
    this.identity = null;
    this.resetSharedConstructionPreviewState();

    const config = resolveWorldPresenceConfig();
    if (!config) {
      return;
    }

    this.identity = resolveWorldPresenceIdentity();
    this.client = new WorldPresenceClient({
      ...config,
      identity: this.identity,
      onSnapshot: () => {
        // Editor presence only publishes activity to the overworld.
      },
    });
    this.client.setSubscribedShards([
      roomToChunkCoordinates(this.host.getRoomCoordinates()),
    ]);
    this.sync();
  }

  refreshIdentity(): void {
    const config = resolveWorldPresenceConfig();
    const nextIdentity = config ? resolveWorldPresenceIdentity() : null;
    const currentIdentity = this.identity;
    if (!config) {
      if (!this.client && !currentIdentity) {
        return;
      }

      this.initialize();
      return;
    }

    if (
      currentIdentity &&
      nextIdentity &&
      currentIdentity.userId === nextIdentity.userId &&
      currentIdentity.displayName === nextIdentity.displayName &&
      currentIdentity.avatarId === nextIdentity.avatarId
    ) {
      return;
    }

    this.initialize();
  }

  sync(): void {
    if (!this.client || !this.host.isSceneActive() || this.host.isPlaying()) {
      this.client?.updateLocalPresence(null);
      return;
    }

    this.client.updateLocalPresence({
      roomCoordinates: { ...this.host.getRoomCoordinates() },
      x: ROOM_PX_WIDTH * 0.5,
      y: ROOM_PX_HEIGHT * 0.5,
      velocityX: 0,
      velocityY: 0,
      facing: 1,
      animationState: 'idle',
      mode: 'edit',
      timestamp: Date.now(),
    });
    this.syncSharedConstructionPreview();
  }

  clear(): void {
    this.syncSharedConstructionPreview({ force: true });
    this.client?.updateLocalPresence(null);
  }

  markConstructionPreviewDirty(): void {
    this.sharedConstructionPreviewDirty = true;
  }

  destroy(): void {
    this.syncSharedConstructionPreview({ force: true });
    this.client?.destroy();
    this.client = null;
    this.identity = null;
    this.resetSharedConstructionPreviewState();
  }

  private syncSharedConstructionPreview(options?: { force?: boolean }): void {
    if (!this.client) {
      return;
    }

    const force = options?.force === true;
    const roomCoordinates = this.host.getRoomCoordinates();
    const stateKey = this.shouldPublishSharedConstructionPreview()
      ? `${roomCoordinates.x},${roomCoordinates.y}:${this.host.getPublishedVersion()}`
      : null;
    if (!stateKey) {
      this.clearSharedConstructionPreview();
      return;
    }

    const now = performance.now();
    const stateChanged = this.lastSharedConstructionPreviewStateKey !== stateKey;
    if (
      !force &&
      !stateChanged &&
      !this.sharedConstructionPreviewDirty &&
      this.lastSharedConstructionPreviewStateKey !== null
    ) {
      return;
    }

    if (
      !force &&
      !stateChanged &&
      now - this.lastSharedConstructionPreviewPublishAt < SHARED_PREVIEW_PUBLISH_INTERVAL_MS
    ) {
      return;
    }

    this.client.updateLocalRoomPreview({
      roomCoordinates,
      snapshot: this.buildSharedConstructionPreviewSnapshot(),
    });
    this.sharedConstructionPreviewDirty = false;
    this.lastSharedConstructionPreviewPublishAt = now;
    this.lastSharedConstructionPreviewStateKey = stateKey;
  }

  private clearSharedConstructionPreview(): void {
    if (!this.client || this.lastSharedConstructionPreviewStateKey === null) {
      return;
    }

    this.client.updateLocalRoomPreview(null);
    this.lastSharedConstructionPreviewStateKey = null;
  }

  private shouldPublishSharedConstructionPreview(): boolean {
    return this.host.getEntrySource() === 'world' && this.host.getPublishedVersion() === 0;
  }

  private buildSharedConstructionPreviewSnapshot(): RoomSnapshot {
    const snapshot = this.host.exportRoomSnapshot();
    snapshot.status = 'draft';
    snapshot.updatedAt = new Date().toISOString();
    snapshot.publishedAt = null;
    return snapshot;
  }

  private resetSharedConstructionPreviewState(): void {
    this.sharedConstructionPreviewDirty = true;
    this.lastSharedConstructionPreviewPublishAt = 0;
    this.lastSharedConstructionPreviewStateKey = null;
  }
}
