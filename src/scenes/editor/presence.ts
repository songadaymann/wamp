import {
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
} from '../../config';
import type { RoomCoordinates } from '../../persistence/roomRepository';
import { roomToChunkCoordinates } from '../../persistence/worldModel';
import {
  resolveWorldPresenceConfig,
  resolveWorldPresenceIdentity,
  WorldPresenceClient,
  type WorldPresenceIdentity,
} from '../../presence/worldPresence';

interface EditorPresenceHost {
  getRoomCoordinates(): RoomCoordinates;
  isPlaying(): boolean;
  isSceneActive(): boolean;
}

export class EditorPresenceController {
  private client: WorldPresenceClient | null = null;
  private identity: WorldPresenceIdentity | null = null;

  constructor(private readonly host: EditorPresenceHost) {}

  initialize(): void {
    this.client?.destroy();
    this.client = null;
    this.identity = null;

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
  }

  clear(): void {
    this.client?.updateLocalPresence(null);
  }

  destroy(): void {
    this.client?.destroy();
    this.client = null;
    this.identity = null;
  }
}
