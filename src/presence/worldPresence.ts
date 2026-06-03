import PartySocket from 'partysocket';
import { getAuthDebugState, getResolvedPartykitConfig } from '../auth/client';
import { PartyKitIdentityTokenProvider } from './identityTokenClient';
import { resolveActivePlayerAvatarId } from '../player/avatar/runtime';
import type { DefaultPlayerAnimationState } from '../player/defaultPlayer';
import {
  cloneRoomSnapshot,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../persistence/roomModel';
import type {
  PvpInviteAcceptMessage,
  PvpInviteDeclineMessage,
  PvpInviteOffer,
  PvpInviteSendMessage,
  PvpPresenceServerMessage,
} from '../pvp/model';
import {
  chunkIdFromCoordinates,
  roomToChunkCoordinates,
  type WorldChunkCoordinates,
} from '../persistence/worldModel';
import { createRandomUuid } from '../utils/randomId';

export type WorldPresenceMode = 'browse' | 'play' | 'edit';
export type WorldPresenceAnimationState = DefaultPlayerAnimationState;

const PRESENCE_MOVING_PUBLISH_INTERVAL_MS = 200;
const PVP_PRESENCE_MOVING_PUBLISH_INTERVAL_MS = 25;
const PRESENCE_IDLE_KEEPALIVE_MS = 5_000;
const REMOTE_PRESENCE_SNAPSHOT_FLUSH_INTERVAL_MS = 140;
const PRESENCE_GUEST_IDENTITY_STORAGE_KEY = 'ep_presence_guest_identity_v1';

export interface WorldPresenceIdentity {
  userId: string;
  displayName: string;
  avatarId: string;
}

export type WorldPresencePvpAction = 'sword' | 'gun';

export interface WorldPresencePvpState {
  matchId: string;
  action: WorldPresencePvpAction | null;
  actionUntil: number;
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
  pvp?: WorldPresencePvpState | null;
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

interface PresenceUpsertsMessage {
  type: 'upserts';
  peers: WorldGhostPresence[];
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
  | PresenceUpsertsMessage
  | PresenceRemoveMessage
  | PresencePopulationsMessage
  | PvpPresenceServerMessage;

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
  onPvpInvite?: (invite: PvpInviteOffer) => void;
  onPvpInviteAccepted?: (message: Extract<PvpPresenceServerMessage, { type: 'pvp:invite:accepted' }>) => void;
  onPvpInviteDeclined?: (message: Extract<PvpPresenceServerMessage, { type: 'pvp:invite:declined' }>) => void;
}

export class WorldPresenceClient {
  private readonly socketsByShardId = new Map<string, PartySocketRecord>();
  private readonly ghostsByConnectionId = new Map<string, WorldGhostPresence>();
  private readonly roomPopulationsByShardId = new Map<string, Map<string, number>>();
  private readonly roomEditorsByShardId = new Map<string, Map<string, number>>();
  private readonly roomPreviewsByShardId = new Map<string, Map<string, WorldPresenceRoomPreview>>();
  private readonly connectedShards = new Set<string>();
  private readonly pendingSocketShardIds = new Set<string>();
  private readonly identityTokenProvider: PartyKitIdentityTokenProvider;
  private desiredShardIds = new Set<string>();
  private localPresence: WorldPresencePayload | null = null;
  private localRoomPreview: PresencePreviewPayload | null = null;
  private publishedShardId: string | null = null;
  private previewShardId: string | null = null;
  private lastPublishedPayloadJson: string | null = null;
  private lastPublishedPresenceSignature: string | null = null;
  private lastPublishedPreviewJson: string | null = null;
  private lastPublishedAt = 0;
  private pendingSnapshotEmit = false;
  private snapshotEmitTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSnapshotEmittedAt = 0;

  constructor(private readonly options: WorldPresenceClientOptions) {
    this.identityTokenProvider = new PartyKitIdentityTokenProvider(() => this.options.identity);
    this.emitSnapshot();
  }

  setSubscribedShards(chunks: WorldChunkCoordinates[]): void {
    const desired = new Set(chunks.map((chunk) => chunkIdFromCoordinates(chunk)));
    this.desiredShardIds = desired;

    for (const chunk of chunks) {
      const shardId = chunkIdFromCoordinates(chunk);
      if (this.socketsByShardId.has(shardId) || this.pendingSocketShardIds.has(shardId)) {
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
      this.lastPublishedPresenceSignature = null;
    }

    this.localPresence = nextPresence;
    if (!nextPresence || !nextShardId) {
      this.emitSnapshot();
      return;
    }

    const shardSocket = this.socketsByShardId.get(nextShardId)?.socket ?? null;
    if (!shardSocket || shardSocket.readyState !== PartySocket.OPEN) {
      this.publishedShardId = nextShardId;
      this.emitSnapshot();
      return;
    }

    const now = Date.now();
    const presenceSignature = getPresencePublishSignature(nextPresence);
    const changed = presenceSignature !== this.lastPublishedPresenceSignature;
    const isInitialPublish = this.lastPublishedPayloadJson === null;
    const publishInterval = changed
      ? nextPresence.pvp?.matchId
        ? PVP_PRESENCE_MOVING_PUBLISH_INTERVAL_MS
        : PRESENCE_MOVING_PUBLISH_INTERVAL_MS
      : PRESENCE_IDLE_KEEPALIVE_MS;
    const enoughTimeElapsed = now - this.lastPublishedAt >= publishInterval;
    if (!isInitialPublish && !enoughTimeElapsed) {
      return;
    }

    const payload = JSON.stringify({
      type: 'presence:update',
      presence: {
        ...nextPresence,
        timestamp: now,
      },
    } satisfies PresencePublishMessage);
    shardSocket.send(payload);
    this.publishedShardId = nextShardId;
    this.lastPublishedPayloadJson = payload;
    this.lastPublishedPresenceSignature = presenceSignature;
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

  sendPvpInvite(target: WorldGhostPresence, invite: Omit<PvpInviteSendMessage['invite'], 'targetConnectionId' | 'target'>): boolean {
    const socket = this.socketsByShardId.get(target.shardId)?.socket ?? null;
    if (!socket || socket.readyState !== PartySocket.OPEN) {
      return false;
    }

    const payload: PvpInviteSendMessage = {
      type: 'pvp:invite',
      invite: {
        ...invite,
        targetConnectionId: target.connectionId,
        target: {
          userId: target.userId,
          displayName: target.displayName,
          avatarId: target.avatarId,
        },
      },
    };
    socket.send(JSON.stringify(payload));
    return true;
  }

  sendPvpInviteAccept(invite: PvpInviteOffer): boolean {
    const socket = this.socketsByShardId.get(invite.shardId)?.socket ?? null;
    if (!socket || socket.readyState !== PartySocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify({
      type: 'pvp:invite:accept',
      inviteId: invite.inviteId,
      matchId: invite.matchId,
      inviterConnectionId: invite.inviterConnectionId,
    } satisfies PvpInviteAcceptMessage));
    return true;
  }

  sendPvpInviteDecline(invite: PvpInviteOffer): boolean {
    const socket = this.socketsByShardId.get(invite.shardId)?.socket ?? null;
    if (!socket || socket.readyState !== PartySocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify({
      type: 'pvp:invite:decline',
      inviteId: invite.inviteId,
      matchId: invite.matchId,
      inviterConnectionId: invite.inviterConnectionId,
    } satisfies PvpInviteDeclineMessage));
    return true;
  }

  destroy(): void {
    this.clearQueuedSnapshotEmit();
    this.desiredShardIds.clear();
    this.pendingSocketShardIds.clear();
    this.identityTokenProvider.clear();
    if (this.publishedShardId) {
      this.sendLeaveToShard(this.publishedShardId);
    }
    if (this.previewShardId) {
      this.sendPreviewClearToShard(this.previewShardId);
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
    this.lastPublishedPresenceSignature = null;
    this.lastPublishedPreviewJson = null;
    this.emitSnapshot();
  }

  private openShardSocket(shardId: string): void {
    this.pendingSocketShardIds.add(shardId);
    void this.openShardSocketWithToken(shardId);
  }

  private async openShardSocketWithToken(shardId: string): Promise<void> {
    let identityToken: string;
    try {
      identityToken = await this.identityTokenProvider.getToken();
    } catch (error) {
      this.pendingSocketShardIds.delete(shardId);
      console.warn('Failed to issue PartyKit presence identity token.', error);
      this.emitSnapshot();
      return;
    }

    this.pendingSocketShardIds.delete(shardId);
    if (!this.desiredShardIds.has(shardId) || this.socketsByShardId.has(shardId)) {
      return;
    }

    const socket = new PartySocket({
      host: this.options.host,
      protocol: this.options.protocol,
      party: this.options.party,
      room: shardId,
      query: {
        identityToken,
      },
    });

    socket.addEventListener('open', () => {
      this.connectedShards.add(shardId);
      if (this.localPresence && this.resolveLocalShardId() === shardId) {
        this.lastPublishedPayloadJson = null;
        this.lastPublishedPresenceSignature = null;
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
      if (this.socketsByShardId.get(shardId)?.socket !== socket) {
        return;
      }

      this.connectedShards.delete(shardId);
      this.socketsByShardId.delete(shardId);
      this.removeGhostsForShard(shardId);
      this.roomPopulationsByShardId.delete(shardId);
      this.roomEditorsByShardId.delete(shardId);
      this.roomPreviewsByShardId.delete(shardId);
      if (this.publishedShardId === shardId) {
        this.lastPublishedPayloadJson = null;
        this.lastPublishedPresenceSignature = null;
      }
      if (this.previewShardId === shardId) {
        this.lastPublishedPreviewJson = null;
      }
      if (this.desiredShardIds.has(shardId) && !this.pendingSocketShardIds.has(shardId)) {
        this.openShardSocket(shardId);
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
    this.pendingSocketShardIds.delete(shardId);
    const record = this.socketsByShardId.get(shardId);
    if (!record) {
      return;
    }

    if (this.publishedShardId === shardId) {
      this.sendLeaveToShard(shardId);
      this.publishedShardId = null;
      this.lastPublishedPayloadJson = null;
      this.lastPublishedPresenceSignature = null;
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

    let urgentSnapshot = false;
    switch (message.type) {
      case 'pvp:invite:offer':
        this.options.onPvpInvite?.(message.invite);
        return;
      case 'pvp:invite:accepted':
        this.options.onPvpInviteAccepted?.(message);
        return;
      case 'pvp:invite:declined':
        this.options.onPvpInviteDeclined?.(message);
        return;
      case 'snapshot':
        this.removeGhostsForShard(shardId);
        for (const peer of message.peers) {
          this.storeRemoteGhost(shardId, peer);
        }
        this.replaceRoomPopulations(shardId, message.roomPopulations);
        this.replaceRoomEditors(shardId, message.roomEditors);
        this.replaceRoomPreviews(shardId, message.roomPreviews);
        break;
      case 'upsert':
        this.storeRemoteGhost(shardId, message.peer);
        urgentSnapshot = Boolean(message.peer.pvp?.matchId);
        break;
      case 'upserts':
        if (!Array.isArray(message.peers)) {
          return;
        }
        for (const peer of message.peers) {
          this.storeRemoteGhost(shardId, peer);
          urgentSnapshot ||= Boolean(peer.pvp?.matchId);
        }
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

    this.queueSnapshotEmit(urgentSnapshot);
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
    this.clearQueuedSnapshotEmit();
    this.lastSnapshotEmittedAt = getNowMs();
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
      ghosts: Array.from(this.ghostsByConnectionId.values())
        .filter((ghost) => !this.isLocalIdentityPeer(ghost))
        .sort((left, right) => left.displayName.localeCompare(right.displayName)),
      roomPopulations,
      roomEditors,
      roomPreviews,
    });
  }

  private storeRemoteGhost(shardId: string, peer: WorldGhostPresence): void {
    if (this.isLocalIdentityPeer(peer)) {
      this.ghostsByConnectionId.delete(peer.connectionId);
      return;
    }

    this.ghostsByConnectionId.set(peer.connectionId, {
      ...peer,
      shardId,
      roomId: roomIdFromCoordinates(peer.roomCoordinates),
    });
  }

  private isLocalIdentityPeer(peer: Pick<WorldGhostPresence, 'userId'>): boolean {
    return peer.userId === this.options.identity.userId;
  }

  private queueSnapshotEmit(urgent = false): void {
    this.pendingSnapshotEmit = true;
    if (urgent) {
      this.clearQueuedSnapshotEmit();
      this.emitSnapshot();
      return;
    }

    if (this.snapshotEmitTimer !== null) {
      return;
    }

    const elapsed = getNowMs() - this.lastSnapshotEmittedAt;
    const delay = Math.max(0, REMOTE_PRESENCE_SNAPSHOT_FLUSH_INTERVAL_MS - elapsed);
    this.snapshotEmitTimer = setTimeout(() => {
      this.snapshotEmitTimer = null;
      if (!this.pendingSnapshotEmit) {
        return;
      }

      this.pendingSnapshotEmit = false;
      this.emitSnapshot();
    }, delay);
  }

  private clearQueuedSnapshotEmit(): void {
    this.pendingSnapshotEmit = false;
    if (this.snapshotEmitTimer === null) {
      return;
    }

    clearTimeout(this.snapshotEmitTimer);
    this.snapshotEmitTimer = null;
  }
}

function getNowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function getPresencePublishSignature(presence: WorldPresencePayload): string {
  return JSON.stringify([
    presence.mode,
    presence.roomCoordinates.x,
    presence.roomCoordinates.y,
    Math.round(presence.x),
    Math.round(presence.y),
    Math.round(presence.velocityX),
    Math.round(presence.velocityY),
    presence.facing,
    presence.animationState,
    presence.pvp?.matchId ?? '',
    presence.pvp?.action ?? '',
    Math.round((presence.pvp?.actionUntil ?? 0) / 50),
  ]);
}

export function resolveWorldPresenceIdentity(): WorldPresenceIdentity {
  const authState = getAuthDebugState();
  const avatarId = resolveActivePlayerAvatarId();
  if (authState.authenticated && authState.user) {
    return {
      userId: authState.user.id,
      displayName: authState.user.displayName,
      avatarId,
    };
  }

  return resolveWorldPresenceGuestIdentity();
}

export function resolveWorldPresenceGuestIdentity(): WorldPresenceIdentity {
  const avatarId = resolveActivePlayerAvatarId();
  try {
    const existingRaw = window.localStorage.getItem(PRESENCE_GUEST_IDENTITY_STORAGE_KEY);
    if (existingRaw) {
      const existing = JSON.parse(existingRaw) as Partial<WorldPresenceIdentity>;
      if (typeof existing.userId === 'string' && typeof existing.displayName === 'string') {
        return {
          userId: existing.userId,
          displayName: existing.displayName,
          avatarId,
        };
      }
    }
  } catch {
    // Fall through to a new guest identity.
  }

  const guestIdentity: WorldPresenceIdentity = {
    userId: `guest-${createRandomUuid()}`,
    displayName: `Guest ${Math.random().toString(36).slice(2, 6)}`,
    avatarId,
  };
  try {
    window.localStorage.setItem(PRESENCE_GUEST_IDENTITY_STORAGE_KEY, JSON.stringify(guestIdentity));
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
  const runtimeConfig = getResolvedPartykitConfig();
  const rawHost = runtimeConfig?.host || (import.meta.env.DEV ? '127.0.0.1:1999' : '');
  if (!rawHost) {
    return null;
  }

  const normalized = rawHost.replace(/\/+$/, '');
  const host = normalized.replace(/^(https?:\/\/|wss?:\/\/)/, '');
  const protocol =
    normalized.startsWith('wss://') || normalized.startsWith('https://')
      ? 'wss'
      : normalized.startsWith('ws://') || normalized.startsWith('http://')
        ? 'ws'
        : window.location.protocol === 'https:' || !isLocalPartyKitHost(host)
          ? 'wss'
          : 'ws';

  return {
    host,
    protocol,
    // Single-server PartyKit projects default to the implicit `main` party route.
    party: runtimeConfig?.party || 'main',
  };
}

function isLocalPartyKitHost(host: string): boolean {
  const hostname = host.split(':')[0]?.replace(/^\[|\]$/g, '').toLowerCase() ?? '';
  return (
    hostname === 'localhost'
    || hostname === '0.0.0.0'
    || hostname === '::1'
    || hostname.startsWith('127.')
    || hostname.startsWith('10.')
    || hostname.startsWith('192.168.')
    || /^172\\.(1[6-9]|2\\d|3[0-1])\\./.test(hostname)
    || hostname.endsWith('.local')
  );
}
