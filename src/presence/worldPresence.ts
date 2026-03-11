import PartySocket from 'partysocket';
import type { DefaultPlayerAnimationState } from '../player/defaultPlayer';
import { roomIdFromCoordinates, type RoomCoordinates } from '../persistence/roomModel';
import {
  chunkIdFromCoordinates,
  roomToChunkCoordinates,
  type WorldChunkCoordinates,
} from '../persistence/worldModel';

export type WorldPresenceMode = 'browse' | 'play';
export type WorldPresenceAnimationState = DefaultPlayerAnimationState;

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

export interface WorldPresenceSnapshot {
  enabled: boolean;
  status: 'disabled' | 'connecting' | 'connected';
  subscribedShards: string[];
  connectedShards: string[];
  publishedShard: string | null;
  ghosts: WorldGhostPresence[];
  roomPopulations: Record<string, number>;
}

interface PartySocketRecord {
  shardId: string;
  socket: PartySocket;
}

interface PresenceSnapshotMessage {
  type: 'snapshot';
  peers: WorldGhostPresence[];
  roomPopulations: Record<string, number>;
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

interface PresenceLeaveMessage {
  type: 'presence:leave';
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
  private readonly connectedShards = new Set<string>();
  private desiredShardIds = new Set<string>();
  private localPresence: WorldPresencePayload | null = null;
  private publishedShardId: string | null = null;
  private lastPublishedPayloadJson: string | null = null;
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
    if (!nextPresence || nextPresence.mode !== 'play' || !nextShardId) {
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
    const enoughTimeElapsed = Date.now() - this.lastPublishedAt >= 100;
    if (!changed && !enoughTimeElapsed) {
      return;
    }

    shardSocket.send(payload);
    this.publishedShardId = nextShardId;
    this.lastPublishedPayloadJson = payload;
    this.lastPublishedAt = Date.now();
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
    this.localPresence = null;
    this.publishedShardId = null;
    this.lastPublishedPayloadJson = null;
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
      if (this.localPresence && this.localPresence.mode === 'play' && this.resolveLocalShardId() === shardId) {
        this.lastPublishedPayloadJson = null;
        this.updateLocalPresence(this.localPresence);
      } else {
        this.emitSnapshot();
      }
    });

    socket.addEventListener('close', () => {
      this.connectedShards.delete(shardId);
      this.removeGhostsForShard(shardId);
      this.roomPopulationsByShardId.delete(shardId);
      if (this.publishedShardId === shardId) {
        this.lastPublishedPayloadJson = null;
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

    record.socket.close(1000, 'shard-unsubscribe');
    this.connectedShards.delete(shardId);
    this.socketsByShardId.delete(shardId);
    this.removeGhostsForShard(shardId);
  }

  private sendLeaveToShard(shardId: string): void {
    const socket = this.socketsByShardId.get(shardId)?.socket ?? null;
    if (!socket || socket.readyState !== PartySocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify({ type: 'presence:leave' } satisfies PresenceLeaveMessage));
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
        break;
      default:
        return;
    }

    this.emitSnapshot();
  }

  private replaceRoomPopulations(shardId: string, next: Record<string, number>): void {
    const shardPopulations = new Map<string, number>();
    for (const [roomId, count] of Object.entries(next)) {
      if (count > 0) {
        shardPopulations.set(roomId, count);
      }
    }

    this.roomPopulationsByShardId.set(shardId, shardPopulations);
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

  private emitSnapshot(): void {
    const connectedShards = Array.from(this.connectedShards).sort();
    const subscribedShards = Array.from(this.desiredShardIds).sort();
    const mergedRoomPopulations = new Map<string, number>();
    for (const shardPopulations of this.roomPopulationsByShardId.values()) {
      for (const [roomId, count] of shardPopulations.entries()) {
        mergedRoomPopulations.set(roomId, (mergedRoomPopulations.get(roomId) ?? 0) + count);
      }
    }
    const roomPopulations: Record<string, number> = {};
    for (const [roomId, count] of Array.from(mergedRoomPopulations.entries()).sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      roomPopulations[roomId] = count;
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
    });
  }
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
