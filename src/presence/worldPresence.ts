import PartySocket from 'partysocket';
import { getAuthDebugState } from '../auth/client';
import type { DefaultPlayerAnimationState } from '../player/defaultPlayer';
import {
  cloneRoomSnapshot,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../persistence/roomModel';
import {
  chunkIdFromCoordinates,
  roomToChunkCoordinates,
  type WorldChunkCoordinates,
} from '../persistence/worldModel';

export type WorldPresenceMode = 'browse' | 'play' | 'edit';
export type WorldPresenceAnimationState = DefaultPlayerAnimationState;

const PRESENCE_PUBLISH_INTERVAL_MS = 200;

export interface WorldPresenceIdentity {
  userId: string;
  displayName: string;
  avatarId: string;
}

export interface WorldPresencePayload {
  roomCoordinates: RoomCoordinates;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  facing: number;
  animationState: WorldPresenceAnimationState;
  mode: WorldPresenceMode;
  timestamp: number;
}

export interface WorldGhostPresence extends WorldPresencePayload {
  connectionId: string;
  userId: string;
  displayName: string;
  avatarId: string;
  shardId: string;
  roomId: string;
}

export interface WorldPresenceRoomPreview {
  roomId: string;
  roomCoordinates: RoomCoordinates;
  snapshot: RoomSnapshot;
  timestamp: number;
  userId: string;
  displayName: string;
  shardId: string;
}

export interface WorldPresenceSnapshot {
  enabled: boolean;
  status: 'disabled' | 'connecting' | 'connected';
  subscribedShards: string[];
  connectedShards: string[];
  publishedShard: string | null;
  ghosts: WorldGhostPresence[];
  roomPopulations: Record<string, number>;
  roomEditors: Record<string, number>;
  roomPreviews: Record<string, WorldPresenceRoomPreview>;
}

interface PartySocketRecord {
  shardId: string;
  socket: PartySocket;
}

interface PresenceSnapshotMessage {
  type: 'snapshot';
  peers: WorldGhostPresence[];
  roomPopulations: Record<string, number>;
  roomEditors: Record<string, number>;
  roomPreviews: Record<string, WorldPresenceRoomPreview>;
}

interface PresenceUpsertMessage {
  type: 'upsert';
  peer: WorldGhostPresence;
}

interface PresenceRemoveMessage {
  type: 'remove';
  connectionId: string;
}

interface PresencePopulationsMessage {
  type: 'populations';
  roomPopulations: Record<string, number>;
  roomEditors: Record<string, number>;
  roomPreviews: Record<string, WorldPresenceRoomPreview>;
}

type PresenceMessage =
  | PresenceSnapshotMessage
  | PresenceUpsertMessage
  | PresenceRemoveMessage
  | PresencePopulationsMessage;

interface PresencePublishMessage {
  type: 'presence:update';
  presence: WorldPresencePayload;
}

interface PresencePreviewPayload {
  roomCoordinates: RoomCoordinates;
  snapshot: RoomSnapshot;
  timestamp: number;
}

interface PresenceLeaveMessage {
  type: 'presence:leave';
}

interface PresencePreviewUpdateMessage {
  type: 'presence:preview:update';
  preview: PresencePreviewPayload;
}

interface PresencePreviewClearMessage {
  type: 'presence:preview:clear';
}

interface WorldPresenceClientOptions {
  host: string;
  protocol: 'ws' | 'wss';
  party: string;
  identity: WorldPresenceIdentity;
  onSnapshot: (snapshot: WorldPresenceSnapshot) => void;
}

export class WorldPresenceClient {
  private readonly socketsByShardId = new Map<string, PartySocketRecord>();
  private readonly ghostsByConnectionId = new Map<string, WorldGhostPresence>();
  private readonly roomPopulationsByShardId = new Map<string, Map<string, number>>();
  private readonly roomEditorsByShardId = new Map<string, Map<string, number>>();
  private readonly roomPreviewsByShardId = new Map<string, Map<string, WorldPresenceRoomPreview>>();
  private readonly connectedShards = new Set<string>();
  private desiredShardIds = new Set<string>();
  private localPresence: WorldPresencePayload | null = null;
  private localRoomPreview: PresencePreviewPayload | null = null;
  private publishedShardId: string | null = null;
  private previewShardId: string | null = null;
  private lastPublishedPayloadJson: string | null = null;
  private lastPublishedPreviewJson: string | null = null;
  private lastPublishedAt = 0;

  constructor(private readonly options: WorldPresenceClientOptions) {
    this.emitSnapshot();
  }

  setSubscribedShards(chunks: WorldChunkCoordinates[]): void {
    const desired = new Set(chunks.map((chunk) => chunkIdFromCoordinates(chunk)));

    for (const chunk of chunks) {
      const shardId = chunkIdFromCoordinates(chunk);
      if (this.socketsByShardId.has(shardId)) {
        continue;
      }

      this.openShardSocket(shardId);
    }

    for (const shardId of Array.from(this.socketsByShardId.keys())) {
      if (desired.has(shardId)) {
        continue;
      }

      this.closeShardSocket(shardId);
    }

    this.desiredShardIds = desired;
    this.emitSnapshot();
  }

  updateLocalPresence(nextPresence: WorldPresencePayload | null): void {
    const nextShardId = nextPresence
      ? chunkIdFromCoordinates(roomToChunkCoordinates(nextPresence.roomCoordinates))
      : null;

    if (this.publishedShardId && this.publishedShardId !== nextShardId) {
      this.sendLeaveToShard(this.publishedShardId);
      this.publishedShardId = null;
      this.lastPublishedPayloadJson = null;
    }

    this.localPresence = nextPresence;
    if (!nextPresence || nextPresence.mode === 'browse' || !nextShardId) {
      this.emitSnapshot();
      return;
    }

    const shardSocket = this.socketsByShardId.get(nextShardId)?.socket ?? null;
    if (!shardSocket || shardSocket.readyState !== PartySocket.OPEN) {
      this.publishedShardId = nextShardId;
      this.emitSnapshot();
      return;
    }

    const payload = JSON.stringify({
      type: 'presence:update',
      presence: nextPresence,
    } satisfies PresencePublishMessage);
    const changed = payload !== this.lastPublishedPayloadJson;
    const isInitialPublish = this.lastPublishedPayloadJson === null;
    const now = Date.now();
    const enoughTimeElapsed = now - this.lastPublishedAt >= PRESENCE_PUBLISH_INTERVAL_MS;
    if (!isInitialPublish && (!changed || !enoughTimeElapsed)) {
      return;
    }

    shardSocket.send(payload);
    this.publishedShardId = nextShardId;
    this.lastPublishedPayloadJson = payload;
    this.lastPublishedAt = now;
    this.emitSnapshot();
  }

  updateLocalRoomPreview(nextPreview: {
    roomCoordinates: RoomCoordinates;
    snapshot: RoomSnapshot;
  } | null): void {
    const normalizedPreview = nextPreview
      ? {
          roomCoordinates: { ...nextPreview.roomCoordinates },
          snapshot: cloneRoomSnapshot(nextPreview.snapshot),
          timestamp: Date.now(),
        }
      : null;
    const nextShardId = normalizedPreview
      ? chunkIdFromCoordinates(roomToChunkCoordinates(normalizedPreview.roomCoordinates))
      : null;

    this.localRoomPreview = normalizedPreview;
    if (!normalizedPreview || !nextShardId) {
      if (this.previewShardId) {
        this.sendPreviewClearToShard(this.previewShardId);
      }
      this.previewShardId = null;
      this.lastPublishedPreviewJson = null;
      this.emitSnapshot();
      return;
    }

    const shardSocket = this.socketsByShardId.get(nextShardId)?.socket ?? null;
    this.previewShardId = nextShardId;
    if (!shardSocket || shardSocket.readyState !== PartySocket.OPEN) {
      this.emitSnapshot();
      return;
    }

    const payload = JSON.stringify({
      type: 'presence:preview:update',
      preview: normalizedPreview,
    } satisfies PresencePreviewUpdateMessage);
    if (payload === this.lastPublishedPreviewJson) {
      return;
    }

    shardSocket.send(payload);
    this.lastPublishedPreviewJson = payload;
    this.emitSnapshot();
  }

  destroy(): void {
    if (this.publishedShardId) {
      this.sendLeaveToShard(this.publishedShardId);
    }

    for (const shardId of Array.from(this.socketsByShardId.keys())) {
      this.closeShardSocket(shardId);
    }

    this.socketsByShardId.clear();
    this.connectedShards.clear();
    this.ghostsByConnectionId.clear();
    this.roomPopulationsByShardId.clear();
    this.roomEditorsByShardId.clear();
    this.roomPreviewsByShardId.clear();
    this.localPresence = null;
    this.localRoomPreview = null;
    this.publishedShardId = null;
    this.previewShardId = null;
    this.lastPublishedPayloadJson = null;
    this.lastPublishedPreviewJson = null;
    this.emitSnapshot();
  }

  private openShardSocket(shardId: string): void {
    const socket = new PartySocket({
      host: this.options.host,
      protocol: this.options.protocol,
      party: this.options.party,
      room: shardId,
      query: {
        userId: this.options.identity.userId,
        displayName: this.options.identity.displayName,
        avatarId: this.options.identity.avatarId,
      },
    });

    socket.addEventListener('open', () => {
      this.connectedShards.add(shardId);
      if (
        this.localPresence &&
        this.localPresence.mode !== 'browse' &&
        this.resolveLocalShardId() === shardId
      ) {
        this.lastPublishedPayloadJson = null;
        this.updateLocalPresence(this.localPresence);
      }

      if (this.localRoomPreview && this.resolveLocalPreviewShardId() === shardId) {
        this.lastPublishedPreviewJson = null;
        this.updateLocalRoomPreview(this.localRoomPreview);
      } else {
        this.emitSnapshot();
      }
    });

    socket.addEventListener('close', () => {
      this.connectedShards.delete(shardId);
      this.removeGhostsForShard(shardId);
      this.roomPopulationsByShardId.delete(shardId);
      this.roomEditorsByShardId.delete(shardId);
      this.roomPreviewsByShardId.delete(shardId);
      if (this.publishedShardId === shardId) {
        this.lastPublishedPayloadJson = null;
      }
      if (this.previewShardId === shardId) {
        this.lastPublishedPreviewJson = null;
      }
      this.emitSnapshot();
    });

    socket.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') {
        return;
      }

      this.handlePresenceMessage(shardId, event.data);
    });

    this.socketsByShardId.set(shardId, {
      shardId,
      socket,
    });
  }

  private closeShardSocket(shardId: string): void {
    const record = this.socketsByShardId.get(shardId);
    if (!record) {
      return;
    }

    if (this.publishedShardId === shardId) {
      this.sendLeaveToShard(shardId);
      this.publishedShardId = null;
      this.lastPublishedPayloadJson = null;
    }
    if (this.previewShardId === shardId) {
      this.previewShardId = null;
      this.lastPublishedPreviewJson = null;
    }

    record.socket.close(1000, 'shard-unsubscribe');
    this.connectedShards.delete(shardId);
    this.socketsByShardId.delete(shardId);
    this.removeGhostsForShard(shardId);
    this.roomPreviewsByShardId.delete(shardId);
  }

  private sendLeaveToShard(shardId: string): void {
    const socket = this.socketsByShardId.get(shardId)?.socket ?? null;
    if (!socket || socket.readyState !== PartySocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify({ type: 'presence:leave' } satisfies PresenceLeaveMessage));
  }

  private sendPreviewClearToShard(shardId: string): void {
    const socket = this.socketsByShardId.get(shardId)?.socket ?? null;
    if (!socket || socket.readyState !== PartySocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify({ type: 'presence:preview:clear' } satisfies PresencePreviewClearMessage));
  }

  private handlePresenceMessage(shardId: string, rawMessage: string): void {
    let message: PresenceMessage | null = null;

    try {
      message = JSON.parse(rawMessage) as PresenceMessage;
    } catch {
      return;
    }

    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
      return;
    }

    switch (message.type) {
      case 'snapshot':
        this.removeGhostsForShard(shardId);
        for (const peer of message.peers) {
          this.ghostsByConnectionId.set(peer.connectionId, {
            ...peer,
            shardId,
            roomId: roomIdFromCoordinates(peer.roomCoordinates),
          });
        }
        this.replaceRoomPopulations(shardId, message.roomPopulations);
        this.replaceRoomEditors(shardId, message.roomEditors);
        this.replaceRoomPreviews(shardId, message.roomPreviews);
        break;
      case 'upsert':
        this.ghostsByConnectionId.set(message.peer.connectionId, {
          ...message.peer,
          shardId,
          roomId: roomIdFromCoordinates(message.peer.roomCoordinates),
        });
        break;
      case 'remove':
        this.ghostsByConnectionId.delete(message.connectionId);
        break;
      case 'populations':
        this.replaceRoomPopulations(shardId, message.roomPopulations);
        this.replaceRoomEditors(shardId, message.roomEditors);
        this.replaceRoomPreviews(shardId, message.roomPreviews);
        break;
      default:
        return;
    }

    this.emitSnapshot();
  }

  private replaceRoomPopulations(
    shardId: string,
    next: Record<string, number> | null | undefined
  ): void {
    const shardPopulations = new Map<string, number>();
    for (const [roomId, count] of Object.entries(next ?? {})) {
      if (count > 0) {
        shardPopulations.set(roomId, count);
      }
    }

    this.roomPopulationsByShardId.set(shardId, shardPopulations);
  }

  private replaceRoomEditors(
    shardId: string,
    next: Record<string, number> | null | undefined
  ): void {
    const shardEditors = new Map<string, number>();
    for (const [roomId, count] of Object.entries(next ?? {})) {
      if (count > 0) {
        shardEditors.set(roomId, count);
      }
    }

    this.roomEditorsByShardId.set(shardId, shardEditors);
  }

  private replaceRoomPreviews(
    shardId: string,
    next: Record<string, WorldPresenceRoomPreview> | null | undefined,
  ): void {
    const shardPreviews = new Map<string, WorldPresenceRoomPreview>();
    for (const [roomId, preview] of Object.entries(next ?? {})) {
      if (!preview || typeof preview !== 'object' || typeof preview.timestamp !== 'number') {
        continue;
      }

      shardPreviews.set(roomId, {
        ...preview,
        roomId,
        shardId,
        roomCoordinates: { ...preview.roomCoordinates },
        snapshot: cloneRoomSnapshot(preview.snapshot),
      });
    }

    this.roomPreviewsByShardId.set(shardId, shardPreviews);
  }

  private removeGhostsForShard(shardId: string): void {
    for (const [connectionId, ghost] of this.ghostsByConnectionId.entries()) {
      if (ghost.shardId === shardId) {
        this.ghostsByConnectionId.delete(connectionId);
      }
    }
  }

  private resolveLocalShardId(): string | null {
    if (!this.localPresence) {
      return null;
    }

    return chunkIdFromCoordinates(roomToChunkCoordinates(this.localPresence.roomCoordinates));
  }

  private resolveLocalPreviewShardId(): string | null {
    if (!this.localRoomPreview) {
      return null;
    }

    return chunkIdFromCoordinates(roomToChunkCoordinates(this.localRoomPreview.roomCoordinates));
  }

  private emitSnapshot(): void {
    const connectedShards = Array.from(this.connectedShards).sort();
    const subscribedShards = Array.from(this.desiredShardIds).sort();
    const mergedRoomPopulations = new Map<string, number>();
    for (const shardPopulations of this.roomPopulationsByShardId.values()) {
      for (const [roomId, count] of shardPopulations.entries()) {
        mergedRoomPopulations.set(roomId, (mergedRoomPopulations.get(roomId) ?? 0) + count);
      }
    }
    const mergedRoomEditors = new Map<string, number>();
    for (const shardEditors of this.roomEditorsByShardId.values()) {
      for (const [roomId, count] of shardEditors.entries()) {
        mergedRoomEditors.set(roomId, (mergedRoomEditors.get(roomId) ?? 0) + count);
      }
    }
    const mergedRoomPreviews = new Map<string, WorldPresenceRoomPreview>();
    for (const shardPreviews of this.roomPreviewsByShardId.values()) {
      for (const [roomId, preview] of shardPreviews.entries()) {
        const existing = mergedRoomPreviews.get(roomId) ?? null;
        if (!existing || preview.timestamp >= existing.timestamp) {
          mergedRoomPreviews.set(roomId, preview);
        }
      }
    }
    const roomPopulations: Record<string, number> = {};
    for (const [roomId, count] of Array.from(mergedRoomPopulations.entries()).sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      roomPopulations[roomId] = count;
    }
    const roomEditors: Record<string, number> = {};
    for (const [roomId, count] of Array.from(mergedRoomEditors.entries()).sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      roomEditors[roomId] = count;
    }
    const roomPreviews: Record<string, WorldPresenceRoomPreview> = {};
    for (const [roomId, preview] of Array.from(mergedRoomPreviews.entries()).sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      roomPreviews[roomId] = {
        ...preview,
        roomCoordinates: { ...preview.roomCoordinates },
        snapshot: cloneRoomSnapshot(preview.snapshot),
      };
    }

    this.options.onSnapshot({
      enabled: true,
      status:
        subscribedShards.length === 0
          ? 'disabled'
          : connectedShards.length > 0
            ? 'connected'
            : 'connecting',
      subscribedShards,
      connectedShards,
      publishedShard: this.resolveLocalShardId(),
      ghosts: Array.from(this.ghostsByConnectionId.values()).sort((left, right) =>
        left.displayName.localeCompare(right.displayName)
      ),
      roomPopulations,
      roomEditors,
      roomPreviews,
    });
  }
}

export function resolveWorldPresenceIdentity(): WorldPresenceIdentity {
  const authState = getAuthDebugState();
  if (authState.authenticated && authState.user) {
    return {
      userId: authState.user.id,
      displayName: authState.user.displayName,
      avatarId: 'default-player',
    };
  }

  const storageKey = 'ep_presence_guest_identity_v1';
  try {
    const existingRaw = window.localStorage.getItem(storageKey);
    if (existingRaw) {
      const existing = JSON.parse(existingRaw) as Partial<WorldPresenceIdentity>;
      if (typeof existing.userId === 'string' && typeof existing.displayName === 'string') {
        return {
          userId: existing.userId,
          displayName: existing.displayName,
          avatarId: typeof existing.avatarId === 'string' ? existing.avatarId : 'default-player',
        };
      }
    }
  } catch {
    // Fall through to a new guest identity.
  }

  const guestIdentity: WorldPresenceIdentity = {
    userId: `guest-${crypto.randomUUID()}`,
    displayName: `Guest ${Math.random().toString(36).slice(2, 6)}`,
    avatarId: 'default-player',
  };
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(guestIdentity));
  } catch {
    // Ignore storage failures for guest identities.
  }

  return guestIdentity;
}

export function resolveWorldPresenceConfig(): {
  host: string;
  protocol: 'ws' | 'wss';
  party: string;
} | null {
  const rawHost = import.meta.env.VITE_PARTYKIT_HOST?.trim()
    || (import.meta.env.DEV ? '127.0.0.1:1999' : '');
  if (!rawHost) {
    return null;
  }

  const normalized = rawHost.replace(/\/+$/, '');
  const protocol =
    normalized.startsWith('wss://') || normalized.startsWith('https://')
      ? 'wss'
      : normalized.startsWith('ws://') || normalized.startsWith('http://')
        ? 'ws'
        : window.location.protocol === 'https:'
          ? 'wss'
          : 'ws';
  const host = normalized.replace(/^(https?:\/\/|wss?:\/\/)/, '');

  return {
    host,
    protocol,
    // Single-server PartyKit projects default to the implicit `main` party route.
    party: import.meta.env.VITE_PARTYKIT_PARTY?.trim() || 'main',
  };
}
