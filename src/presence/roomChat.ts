import PartySocket from 'partysocket';
import { getAuthDebugState } from '../auth/client';
import {
  ROOM_CHAT_MESSAGE_LIFETIME_MS,
  ROOM_CHAT_MESSAGE_MAX_LENGTH,
  ROOM_CHAT_SEND_RATE_LIMIT_MS,
  type RoomChatBroadcastMessage,
  type RoomChatMessageRecord,
  type RoomChatSayMessage,
} from '../chat/roomChatModel';
import {
  chunkIdFromCoordinates,
  roomToChunkCoordinates,
  type WorldChunkCoordinates,
} from '../persistence/worldModel';
import {
  roomIdFromCoordinates,
} from '../persistence/roomModel';
import type {
  WorldPresenceIdentity,
  WorldPresencePayload,
} from './worldPresence';

const CONTEXT_PUBLISH_INTERVAL_MS = 200;

interface PartySocketRecord {
  shardId: string;
  socket: PartySocket;
}

export interface WorldRoomChatSnapshot {
  enabled: boolean;
  status: 'disabled' | 'connecting' | 'connected';
  subscribedShards: string[];
  connectedShards: string[];
  publishedShard: string | null;
  messages: RoomChatMessageRecord[];
  latestMessage: RoomChatMessageRecord | null;
}

interface PresencePublishMessage {
  type: 'presence:update';
  presence: WorldPresencePayload;
}

interface PresenceLeaveMessage {
  type: 'presence:leave';
}

interface WorldRoomChatClientOptions {
  host: string;
  protocol: 'ws' | 'wss';
  party: string;
  identity: WorldPresenceIdentity;
  onSnapshot: (snapshot: WorldRoomChatSnapshot) => void;
}

export type RoomChatSendResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'unauthenticated'
        | 'not-playing'
        | 'connecting'
        | 'empty'
        | 'too-long'
        | 'rate-limited';
    };

export class WorldRoomChatClient {
  private readonly socketsByShardId = new Map<string, PartySocketRecord>();
  private readonly connectedShards = new Set<string>();
  private readonly messagesByUserId = new Map<string, RoomChatMessageRecord>();
  private desiredShardIds = new Set<string>();
  private localPresence: WorldPresencePayload | null = null;
  private publishedShardId: string | null = null;
  private lastPublishedPayloadJson: string | null = null;
  private lastPublishedAt = 0;
  private lastSentAt = 0;

  constructor(private readonly options: WorldRoomChatClientOptions) {
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
    const previousRoomId = this.localPresence
      ? roomIdFromCoordinates(this.localPresence.roomCoordinates)
      : null;
    const nextRoomId = nextPresence ? roomIdFromCoordinates(nextPresence.roomCoordinates) : null;
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
      this.clearMessages();
      this.emitSnapshot();
      return;
    }

    const clearedMessages = previousRoomId !== nextRoomId ? this.clearMessages() : false;
    if (clearedMessages) {
      this.emitSnapshot();
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
    const enoughTimeElapsed = now - this.lastPublishedAt >= CONTEXT_PUBLISH_INTERVAL_MS;
    if (!isInitialPublish && (!changed || !enoughTimeElapsed)) {
      return;
    }

    shardSocket.send(payload);
    this.publishedShardId = nextShardId;
    this.lastPublishedPayloadJson = payload;
    this.lastPublishedAt = now;
    this.emitSnapshot();
  }

  send(text: string): RoomChatSendResult {
    const authState = getAuthDebugState();
    if (!authState.authenticated || !authState.user) {
      return { ok: false, reason: 'unauthenticated' };
    }

    if (!this.localPresence || this.localPresence.mode !== 'play') {
      return { ok: false, reason: 'not-playing' };
    }

    const normalized = text.trim();
    if (normalized.length === 0) {
      return { ok: false, reason: 'empty' };
    }
    if (normalized.length > ROOM_CHAT_MESSAGE_MAX_LENGTH) {
      return { ok: false, reason: 'too-long' };
    }

    const now = Date.now();
    if (now - this.lastSentAt < ROOM_CHAT_SEND_RATE_LIMIT_MS) {
      return { ok: false, reason: 'rate-limited' };
    }

    const shardId = this.resolveLocalShardId();
    const socket = shardId ? this.socketsByShardId.get(shardId)?.socket ?? null : null;
    if (!socket || socket.readyState !== PartySocket.OPEN) {
      return { ok: false, reason: 'connecting' };
    }

    socket.send(
      JSON.stringify({
        type: 'room-chat:say',
        text: normalized,
      } satisfies RoomChatSayMessage)
    );
    this.lastSentAt = now;

    return { ok: true };
  }

  tick(now = Date.now()): void {
    if (this.pruneExpiredMessages(now)) {
      this.emitSnapshot(now);
    }
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
    this.desiredShardIds.clear();
    this.messagesByUserId.clear();
    this.localPresence = null;
    this.publishedShardId = null;
    this.lastPublishedPayloadJson = null;
    this.lastPublishedAt = 0;
    this.lastSentAt = 0;
    this.emitSnapshot();
  }

  private openShardSocket(shardId: string): void {
    const socket = new PartySocket({
      host: this.options.host,
      protocol: this.options.protocol,
      party: this.options.party,
      room: shardId,
      query: {
        channel: 'room-chat',
        userId: this.options.identity.userId,
        displayName: this.options.identity.displayName,
        avatarId: this.options.identity.avatarId,
      },
    });

    socket.addEventListener('open', () => {
      this.connectedShards.add(shardId);
      if (
        this.localPresence &&
        this.localPresence.mode === 'play' &&
        this.resolveLocalShardId() === shardId
      ) {
        this.lastPublishedPayloadJson = null;
        this.updateLocalPresence(this.localPresence);
      } else {
        this.emitSnapshot();
      }
    });

    socket.addEventListener('close', () => {
      this.connectedShards.delete(shardId);
      if (this.publishedShardId === shardId) {
        this.lastPublishedPayloadJson = null;
      }
      this.emitSnapshot();
    });

    socket.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') {
        return;
      }

      this.handleSocketMessage(event.data);
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
  }

  private sendLeaveToShard(shardId: string): void {
    const socket = this.socketsByShardId.get(shardId)?.socket ?? null;
    if (!socket || socket.readyState !== PartySocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify({ type: 'presence:leave' } satisfies PresenceLeaveMessage));
  }

  private handleSocketMessage(rawMessage: string): void {
    let message: RoomChatBroadcastMessage | null = null;

    try {
      message = JSON.parse(rawMessage) as RoomChatBroadcastMessage;
    } catch {
      return;
    }

    if (message?.type !== 'room-chat:message') {
      return;
    }

    const normalized = this.normalizeMessageRecord(message.message);
    if (!normalized) {
      return;
    }

    this.messagesByUserId.set(normalized.userId, normalized);
    this.emitSnapshot();
  }

  private normalizeMessageRecord(value: unknown): RoomChatMessageRecord | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const message = value as Partial<RoomChatMessageRecord>;
    if (
      typeof message.id !== 'string' ||
      typeof message.shardId !== 'string' ||
      typeof message.userId !== 'string' ||
      typeof message.displayName !== 'string' ||
      typeof message.avatarId !== 'string' ||
      typeof message.roomId !== 'string' ||
      typeof message.text !== 'string' ||
      typeof message.createdAt !== 'number' ||
      typeof message.expiresAt !== 'number' ||
      !message.roomCoordinates ||
      !Number.isInteger(message.roomCoordinates.x) ||
      !Number.isInteger(message.roomCoordinates.y)
    ) {
      return null;
    }

    const text = message.text.trim();
    if (text.length === 0 || text.length > ROOM_CHAT_MESSAGE_MAX_LENGTH) {
      return null;
    }

    return {
      id: message.id,
      shardId: message.shardId,
      userId: message.userId,
      displayName: message.displayName,
      avatarId: message.avatarId,
      roomCoordinates: {
        x: message.roomCoordinates.x,
        y: message.roomCoordinates.y,
      },
      roomId: message.roomId,
      text,
      createdAt: message.createdAt,
      expiresAt: Math.min(
        message.expiresAt,
        message.createdAt + ROOM_CHAT_MESSAGE_LIFETIME_MS
      ),
    };
  }

  private clearMessages(): boolean {
    if (this.messagesByUserId.size === 0) {
      return false;
    }

    this.messagesByUserId.clear();
    return true;
  }

  private pruneExpiredMessages(now = Date.now()): boolean {
    let changed = false;

    for (const [userId, message] of this.messagesByUserId.entries()) {
      if (message.expiresAt > now) {
        continue;
      }

      this.messagesByUserId.delete(userId);
      changed = true;
    }

    return changed;
  }

  private resolveLocalShardId(): string | null {
    if (!this.localPresence) {
      return null;
    }

    return chunkIdFromCoordinates(roomToChunkCoordinates(this.localPresence.roomCoordinates));
  }

  private emitSnapshot(now = Date.now()): void {
    this.pruneExpiredMessages(now);

    const connectedShards = Array.from(this.connectedShards).sort();
    const subscribedShards = Array.from(this.desiredShardIds).sort();
    const messages = Array.from(this.messagesByUserId.values()).sort(
      (left, right) => left.createdAt - right.createdAt || left.userId.localeCompare(right.userId)
    );

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
      latestMessage: messages[messages.length - 1] ?? null,
      messages,
    });
  }
}
