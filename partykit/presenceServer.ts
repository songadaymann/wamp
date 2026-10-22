import { ShardHeartbeatScheduler } from '../src/partykit/shardHeartbeatScheduler';
import type * as Party from 'partykit/server';
import { RoomPreviewBroadcast } from '../src/partykit/roomPreviewBroadcast';
import { normalizeInterestRoom, PresenceInterestBroadcast, PRESENCE_FAR_FLUSH_MS } from '../src/partykit/presenceInterest';
import type { PartyKitShardHeartbeat } from '../src/admin/model';
import {
  ROOM_CHAT_MESSAGE_LIFETIME_MS,
  ROOM_CHAT_SEND_RATE_LIMIT_MS,
  type RoomChatBroadcastMessage,
  type RoomChatSayMessage,
  type RoomChatTransportChannel,
} from '../src/chat/roomChatModel';
import type { RoomCoordinates } from '../src/persistence/roomModel';
import {
  collectLatestRoomPreviews,
  isRoomPreviewExpired,
  normalizeRoomPreviewPayload,
  normalizeStoredSharedPreview,
  ROOM_PREVIEW_STORAGE_PREFIX,
  roomPreviewStorageKey,
  toSharedRoomPreview,
} from '../src/partykit/constructionPreviewRuntime';
import {
  resolvePartykitIdentitySigningSecret,
  verifyPartykitIdentityToken,
  canReceiveRoomChat,
  canSendRoomChat,
  type PartyKitIdentityTokenClaims,
} from '../src/presence/identityToken';
import {
  isRoomChatSenderMuted,
  resolveRoomChatModerationDatabase,
  ROOM_CHAT_PERMISSION_RECHECK_MS,
  type RoomChatModerationDatabase,
} from '../src/partykit/roomChatModeration';
import {
  resolveConstructionPreviewTokenSigningSecret,
  verifyConstructionPreviewToken,
} from '../src/presence/constructionPreviewToken';
import {
  isVisiblePresence,
  normalizePresencePayload,
  parseIncomingMessage,
  type ConnectionPresenceState,
  type PresencePayload,
  type RoomPreviewPayload,
  type SharedRoomPreview,
  type WorldGhostPresence,
} from '../src/partykit/presenceProtocol';
import {
  computePresenceRoomCounts,
  listWorldGhostPeers,
  roomIdFromPresenceCoordinates,
  roomIdFromUnknownCoordinates,
  shouldBroadcastPresencePopulations,
  toWorldGhostPresence,
} from '../src/partykit/presencePopulation';
import {
  buildLaunchStats,
  computeShardHeartbeat,
  heartbeatStorageKey,
  METRICS_ROOM_ID,
  METRICS_STORAGE_PREFIX,
  normalizeHeartbeatPayload,
  partitionActiveHeartbeats,
} from '../src/partykit/shardMetricsRuntime';
import {
  buildPvpInviteAccepted,
  buildPvpInviteDeclined,
  buildPvpInviteOffer,
  buildRoomChatBroadcast,
  identityFromPresenceState,
  normalizePvpInviteSend,
  normalizeRoomChatText,
  PVP_INVITE_SEND_RATE_LIMIT_MS,
} from '../src/partykit/relayProtocol';
import {
  activatePvpMatchIfReady,
  applyPvpLifeLoss as applyPvpLifeLossToState,
  createPvpMatchState,
  finalizePvpMatch as finalizePvpMatchState,
  getPvpSnapshot as buildPvpSnapshot,
  isValidPvpMatchConfiguration,
  markPvpForfeit,
  normalizePvpCombatEvent,
  normalizePvpPlayerState,
  normalizePvpRoomStateEvent,
  startPvpMatch as startPvpMatchState,
  upsertPvpParticipant as upsertPvpParticipantState,
  type PvpMatchState,
} from '../src/partykit/pvpMatchRuntime';
import {
  getMultiplayerModeDefinition,
  type PvpHitSource,
  type PvpInviteAcceptMessage,
  type PvpInviteDeclineMessage,
  type PvpInviteSendMessage,
  type PvpMatchCombatEventMessage,
  type PvpMatchClientMessage,
  type PvpMatchConfigureMessage,
  type PvpMatchPlayerStateMessage,
  type PvpMatchSnapshot,
  type PvpParticipantIdentity,
  type PvpParticipantSnapshot,
  type PvpRoomStateEventMessage,
} from '../src/pvp/model';

/** The metrics room prunes stale shard heartbeats at most this often, not on every heartbeat. */
const HEARTBEAT_PRUNE_INTERVAL_MS = 60_000;
const INTERNAL_TOKEN_HEADER = 'x-partykit-internal-token';
const PRESENCE_UPSERT_FLUSH_MS = 80;
const POPULATION_BROADCAST_FLUSH_MS = 250;
const PVP_STORAGE_KEY = 'pvp:match';
interface StoredPvpMatch { match: PvpMatchState; finalizeAt: number | null }
interface PresenceServerRuntime {
  waitUntil?: (work: Promise<void>) => void;
  /** Saves a finished PvP match from this room's own state (the Cloudflare host wires it to D1). */
  recordPvpResult?: (snapshot: PvpMatchSnapshot) => Promise<void>;
}

interface HeartbeatMutationResponse {
  ok: true;
}

export default class PresenceServer implements Party.Server {
  static async onBeforeConnect(req: Party.Request, lobby: Party.Lobby): Promise<Party.Request | Response> {
    const url = new URL(req.url);
    if (url.pathname.includes(`/${METRICS_ROOM_ID}`)) {
      return new Response('Metrics room does not accept WebSocket connections.', {
        status: 400,
      });
    }

    const token = url.searchParams.get('identityToken')?.trim() ?? '';
    if (!token) {
      return new Response('Missing signed presence identity.', { status: 401 });
    }

    const signingSecret = resolvePartykitIdentitySigningSecret(lobby.env);
    if (!signingSecret) {
      return new Response('PartyKit identity token secret is not configured.', { status: 503 });
    }

    const identity = await verifyPartykitIdentityToken(token, signingSecret.secret);
    if (!identity) {
      return new Response('Invalid signed presence identity.', { status: 401 });
    }

    return req;
  }

  readonly options = {
    hibernate: true,
  } satisfies Party.ServerOptions;

  private readonly heartbeat: ShardHeartbeatScheduler;
  private lastHeartbeatPruneAt = 0;
  private readonly previewsByConnectionId = new Map<string, RoomPreviewPayload>();
  private readonly persistedPreviewsByRoomId = new Map<string, SharedRoomPreview>();
  private readonly previewBroadcast = new RoomPreviewBroadcast();
  private readonly pendingPresenceUpsertsByConnectionId = new Map<string, WorldGhostPresence>();
  private presenceUpsertFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly presenceInterest = new PresenceInterestBroadcast();
  private farPresenceFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private populationBroadcastFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private pvpMatchState: PvpMatchState | null = null;
  private pvpFinalizeAt: number | null = null;
  private pvpStorageWork: Promise<void> = Promise.resolve();
  private pvpResultWork: Promise<void> = Promise.resolve();

  constructor(readonly room: Party.Room, private readonly runtime: PresenceServerRuntime = {}) {
    this.heartbeat = new ShardHeartbeatScheduler({
      storage: room.storage,
      enabled: () => !this.isMetricsRoom() && !this.isPvpRoom() && this.getInternalToken() !== null,
      snapshot: () => this.computeShardHeartbeat() ?? {
        shardId: this.room.id, totalConnections: 0, playConnections: 0, editConnections: 0,
        updatedAt: new Date().toISOString(),
      },
      send: async (heartbeat) => {
        const response = await this.room.context.parties[this.room.name].get(METRICS_ROOM_ID).fetch('/heartbeat', {
          method: 'POST',
          headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: this.getInternalToken() ?? '' },
          body: JSON.stringify(heartbeat),
        });
        // Drain this bounded internal response so no unfinished body keeps the object awake.
        await response.text();
      },
    });
  }

  async onAlarm(): Promise<void> {
    if (this.isPvpRoom()) {
      const match = this.pvpMatchState;
      if (match?.status === 'countdown' && match.countdownEndsAt !== null && match.countdownEndsAt <= Date.now()) this.startPvpMatch();
      if (match?.status === 'finalizing' && this.pvpFinalizeAt !== null && this.pvpFinalizeAt <= Date.now()) this.finalizePvpMatch();
      await this.pvpStorageWork;
      await this.pvpResultWork;
      return;
    }
    await this.heartbeat.alarm();
  }

  private runBackground(work: Promise<void>): void {
    const handled = work.catch((error) => { console.warn('Presence background work failed.', error); });
    if (this.runtime.waitUntil) this.runtime.waitUntil(handled);
    else void handled;
  }

  private reportShardChange(): void {
    this.runBackground(this.heartbeat.changed());
  }

  async onStart(): Promise<void> {
    if (this.isPvpRoom()) {
      const stored = await this.room.storage.get<StoredPvpMatch>(PVP_STORAGE_KEY);
      if (stored) {
        this.pvpMatchState = stored.match;
        this.pvpFinalizeAt = stored.finalizeAt;
      }
      return;
    }
    if (this.isMetricsRoom()) return;

    const entries = await this.room.storage.list<SharedRoomPreview>({
      prefix: ROOM_PREVIEW_STORAGE_PREFIX,
    });
    for (const [storageKey, storedPreview] of entries.entries()) {
      const preview = normalizeStoredSharedPreview(storedPreview);
      if (!preview || isRoomPreviewExpired(preview, Date.now())) {
        void this.room.storage.delete(storageKey);
        continue;
      }

      this.persistedPreviewsByRoomId.set(preview.roomId, preview);
    }
  }

  async onRequest(req: Party.Request): Promise<Response> {
    if (!this.isMetricsRoom()) {
      return new Response('Not found.', { status: 404 });
    }

    const url = new URL(req.url);
    const isHeartbeatPost = req.method === 'POST' && url.pathname.endsWith('/heartbeat');
    if (!this.hasValidInternalToken(req)) {
      if (isHeartbeatPost) {
        await req.text().catch(() => null);
      }
      return new Response('Forbidden.', { status: 403 });
    }

    if (req.method === 'POST' && url.pathname.endsWith('/heartbeat')) {
      return this.handleHeartbeat(req);
    }
    if (req.method === 'GET' && url.pathname.endsWith('/stats')) {
      return this.handleStats();
    }

    return new Response('Not found.', { status: 404 });
  }

  async onConnect(
    connection: Party.Connection<ConnectionPresenceState>,
    ctx: Party.ConnectionContext
  ): Promise<void> {
    const identity = await this.parseIdentity(ctx.request.url);
    if (!identity) {
      connection.close(1008, 'invalid-presence-identity');
      return;
    }
    // Classroom accounts do not play PvP, matching the invite rule in handlePvpInvite.
    if (this.isPvpRoom() && identity.school) {
      connection.close(1008, 'pvp-unavailable');
      return;
    }

    connection.setState({
      ...identity,
      presence: null,
      lastRoomChatSentAt: 0,
      lastPvpInviteSentAt: 0,
    });

    if (this.isPvpRoom()) {
      this.handlePvpConnect(connection);
      return;
    }

    if (identity.channel === 'presence') {
      const previews = this.computeRoomPreviews();
      // Reconcile other viewers before establishing this connection's full baseline.
      for (const delta of this.previewBroadcast.reconcile(previews)) {
        this.sendToConnections(delta,
          (peer) => peer.state?.channel === 'presence' && peer.state.previewDeltas === true,
          [connection.id]);
      }
      connection.send(
        JSON.stringify({
          type: 'snapshot',
          roomChat: identity.roomChat === true,
          ...(identity.presenceInterest ? { presenceInterest: true } : {}),
          peers: this.listPeers(connection),
          roomPopulations: this.computeRoomPopulations(),
          roomEditors: this.computeRoomEditors(),
          roomPreviews: connection.state?.previewDeltas
            ? this.previewBroadcast.snapshot(previews) : previews,
        })
      );
    }

    this.broadcastPopulations();
    await this.heartbeat.changed().catch((error) => { console.warn('Presence metrics unavailable.', error); });
  }

  onMessage(message: string, sender: Party.Connection<ConnectionPresenceState>): void {
    const parsed = parseIncomingMessage(message);
    if (!parsed) {
      return;
    }

    if (this.isPvpRoom()) {
      this.handlePvpMessage(parsed as unknown as PvpMatchClientMessage, sender);
      return;
    }

    if (parsed.type === 'presence:interest') {
      const current = sender.state;
      if (current?.channel !== 'presence' || !current.presenceInterest) return;
      const interestRoom = normalizeInterestRoom(parsed.roomCoordinates);
      if (parsed.roomCoordinates !== null && !interestRoom) return;
      if (current.interestRoom?.x === interestRoom?.x && current.interestRoom?.y === interestRoom?.y) return;
      sender.setState({ ...current, interestRoom });
      this.presenceInterest.sendFocusBaseline(sender, this.listPeers(null));
      return;
    }

    if (parsed.type === 'presence:leave') {
      this.clearPresence(sender);
      return;
    }

    if (parsed.type === 'room-chat:say') {
      this.handleRoomChatSay(sender, parsed);
      return;
    }

    if (parsed.type === 'pvp:invite') {
      this.handlePvpInvite(sender, parsed);
      return;
    }

    if (parsed.type === 'pvp:invite:accept') {
      this.handlePvpInviteAccept(sender, parsed);
      return;
    }

    if (parsed.type === 'pvp:invite:decline') {
      this.handlePvpInviteDecline(sender, parsed);
      return;
    }

    if (parsed.type === 'presence:preview:clear') {
      this.clearPreview(sender, parsed);
      return;
    }

    if (parsed.type === 'presence:preview:update') {
      this.runBackground(this.updatePreview(sender, parsed.preview));
      return;
    }

    if (parsed.type !== 'presence:update') {
      return;
    }

    const current = sender.state;
    if (!current) {
      return;
    }

    const previousPresence = current.presence ?? null;
    const previousPreview = this.previewsByConnectionId.get(sender.id) ?? null;
    const presence = normalizePresencePayload(parsed.presence);
    if (!presence) {
      return;
    }

    const nextPreview =
      previousPreview &&
      presence.mode === 'edit' &&
      this.getRoomId(previousPreview.roomCoordinates) === this.getRoomId(presence.roomCoordinates)
        ? previousPreview
        : null;
    const previewChanged = nextPreview !== previousPreview;
    if (nextPreview) {
      this.previewsByConnectionId.set(sender.id, nextPreview);
    } else {
      this.previewsByConnectionId.delete(sender.id);
      this.clearStoredPreviewForPayload(previousPreview);
    }

    sender.setState({
      ...current,
      presence,
    });

    if (current.channel === 'presence') {
      if (isVisiblePresence(previousPresence) && !isVisiblePresence(presence)) {
        this.pendingPresenceUpsertsByConnectionId.delete(sender.id);
        this.presenceInterest.forget(sender.id);
        this.sendPresenceMessage(
          {
            type: 'remove',
            connectionId: sender.id,
          },
          { excludeConnectionIds: [sender.id] }
        );
      }

      const peer = this.toGhostPresence(sender);
      if (peer) {
        this.queuePresenceUpsert(peer);
      }

      const shouldBroadcast = this.shouldBroadcastPopulations(previousPresence, presence);
      if (shouldBroadcast || previewChanged) {
        this.broadcastPopulations();
        this.reportShardChange();
      }
    }
  }

  onClose(connection: Party.Connection<ConnectionPresenceState>): void {
    // March 2026 compatibility requires a reciprocal Close frame; PartyKit 0.0.115 does not send it.
    if (connection.readyState === WebSocket.CLOSING) connection.close(1000, 'peer-disconnected');
    if (this.isPvpRoom()) {
      this.handlePvpClose(connection);
      if (![...this.room.getConnections()].length) {
        this.pvpMatchState = null;
        this.pvpFinalizeAt = null;
        this.persistPvpMatch();
      }
      return;
    }

    const presence = connection.state?.presence;
    const preview = this.previewsByConnectionId.get(connection.id) ?? null;
    this.pendingPresenceUpsertsByConnectionId.delete(connection.id);
    this.presenceInterest.forget(connection.id);
    this.previewsByConnectionId.delete(connection.id);
    this.clearStoredPreviewForPayload(preview);
    if (connection.state?.channel === 'presence' && isVisiblePresence(presence)) {
      this.sendPresenceMessage({
        type: 'remove',
        connectionId: connection.id,
      });
    }

    if (connection.state?.channel === 'presence') {
      this.broadcastPopulations();
    }
    this.reportShardChange();
  }

  private clearPresence(connection: Party.Connection<ConnectionPresenceState>): void {
    const current = connection.state;
    const previousPresence = current?.presence ?? null;
    const previousPreview = this.previewsByConnectionId.get(connection.id) ?? null;
    this.pendingPresenceUpsertsByConnectionId.delete(connection.id);
    this.presenceInterest.forget(connection.id);
    this.previewsByConnectionId.delete(connection.id);
    this.clearStoredPreviewForPayload(previousPreview);
    if (!previousPresence) {
      connection.setState(
        current
          ? {
              ...current,
              presence: null,
            }
          : null
      );
      if (current?.channel === 'presence' && previousPreview !== null) {
        this.broadcastPopulations();
        this.reportShardChange();
      }
      return;
    }

    if (!current) {
      return;
    }

    connection.setState({
      ...current,
      presence: null,
    });

    if (current?.channel === 'presence' && isVisiblePresence(previousPresence)) {
      this.sendPresenceMessage(
        {
          type: 'remove',
          connectionId: connection.id,
        },
        { excludeConnectionIds: [connection.id] }
      );
    }

    if (
      current?.channel === 'presence' &&
      (this.shouldBroadcastPopulations(previousPresence, null) || previousPreview !== null)
    ) {
      this.broadcastPopulations();
      this.reportShardChange();
    }
  }

  private listPeers(
    viewer: Party.Connection<ConnectionPresenceState> | null,
  ): WorldGhostPresence[] {
    return listWorldGhostPeers(
      this.room.getConnections<ConnectionPresenceState>(),
      viewer,
      this.room.id,
    );
  }

  private computeRoomPopulations(): Record<string, number> {
    return computePresenceRoomCounts(
      this.room.getConnections<ConnectionPresenceState>(),
      'play',
    );
  }

  private computeRoomEditors(): Record<string, number> {
    return computePresenceRoomCounts(
      this.room.getConnections<ConnectionPresenceState>(),
      'edit',
    );
  }

  private computeRoomPreviews(): Record<string, SharedRoomPreview> {
    this.pruneExpiredPersistedPreviews();
    const activePreviews: SharedRoomPreview[] = [];
    for (const connection of this.room.getConnections<ConnectionPresenceState>()) {
      const preview = this.toRoomPreview(connection);
      if (preview) activePreviews.push(preview);
    }
    return collectLatestRoomPreviews(
      this.persistedPreviewsByRoomId.values(),
      activePreviews,
      Date.now(),
    );
  }

  private broadcastPopulations(): void {
    if (this.populationBroadcastFlushTimer !== null) return;
    this.populationBroadcastFlushTimer = setTimeout(() => {
      this.populationBroadcastFlushTimer = null;
      this.flushPopulationBroadcast();
    }, POPULATION_BROADCAST_FLUSH_MS);
  }

  private flushPopulationBroadcast(): void {
    const connections = Array.from(this.room.getConnections<ConnectionPresenceState>());
    const capable = (connection: Party.Connection<ConnectionPresenceState>) =>
      connection.state?.channel === 'presence' && connection.state.previewDeltas === true;
    const previews = this.computeRoomPreviews();
    const deltas = this.previewBroadcast.reconcile(previews);
    const populations = { type: 'populations', roomPopulations: this.computeRoomPopulations(),
      roomEditors: this.computeRoomEditors() };
    if (connections.some(capable)) {
      for (const delta of deltas) this.sendToConnections(delta, capable);
      this.sendToConnections(populations, capable);
    }
    const legacy = (connection: Party.Connection<ConnectionPresenceState>) =>
      connection.state?.channel === 'presence' && !connection.state.previewDeltas;
    if (connections.some(legacy)) this.sendToConnections({ ...populations, roomPreviews: previews }, legacy);
  }

  private toGhostPresence(
    connection: Party.Connection<ConnectionPresenceState>
  ): WorldGhostPresence | null {
    return toWorldGhostPresence(connection, this.room.id);
  }

  private toRoomPreview(
    connection: Party.Connection<ConnectionPresenceState>
  ): SharedRoomPreview | null {
    const state = connection.state;
    const preview = this.previewsByConnectionId.get(connection.id) ?? null;
    if (!state?.presence || state.presence.mode !== 'edit' || !preview) {
      return null;
    }

    return toSharedRoomPreview(preview, state, this.room.id, Date.now());
  }

  private async updatePreview(
    connection: Party.Connection<ConnectionPresenceState>,
    value: unknown,
  ): Promise<void> {
    const current = connection.state;
    if (!current || current.channel !== 'presence') {
      return;
    }

    const preview = normalizeRoomPreviewPayload(value);
    if (!preview) {
      return;
    }
    const authorized = await this.isAuthorizedConstructionPreview(connection, preview);
    if (!authorized) {
      return;
    }

    const previousPreview = this.previewsByConnectionId.get(connection.id) ?? null;
    if (
      previousPreview &&
      this.getRoomId(previousPreview.roomCoordinates) !== this.getRoomId(preview.roomCoordinates)
    ) {
      this.clearStoredPreviewForPayload(previousPreview);
    }
    this.previewsByConnectionId.set(connection.id, preview);
    const sharedPreview = this.toStoredSharedPreview(connection, preview);
    if (sharedPreview) {
      this.persistedPreviewsByRoomId.set(sharedPreview.roomId, sharedPreview);
      void this.room.storage.put(this.getPreviewStorageKey(sharedPreview.roomId), sharedPreview);
    }
    this.broadcastPopulations();
  }

  private async isAuthorizedConstructionPreview(
    connection: Party.Connection<ConnectionPresenceState>,
    preview: RoomPreviewPayload,
  ): Promise<boolean> {
    const state = connection.state;
    const token = preview.constructionPreviewToken?.trim() ?? '';
    if (!state || !token) {
      return false;
    }

    const signingSecret = resolveConstructionPreviewTokenSigningSecret(this.room.env);
    if (!signingSecret) {
      return false;
    }

    const claims = await verifyConstructionPreviewToken(token, signingSecret.secret);
    if (!claims || claims.userId !== state.userId) {
      return false;
    }

    const roomId = this.getRoomId(preview.roomCoordinates);
    return (
      claims.roomId === roomId &&
      claims.roomCoordinates.x === preview.roomCoordinates.x &&
      claims.roomCoordinates.y === preview.roomCoordinates.y &&
      preview.snapshot.id === roomId &&
      preview.snapshot.status === 'draft' &&
      preview.snapshot.publishedAt === null
    );
  }

  private clearPreview(
    connection: Party.Connection<ConnectionPresenceState>,
    message?: { roomCoordinates?: RoomCoordinates; timestamp?: number },
  ): void {
    if (connection.state?.channel !== 'presence') {
      return;
    }

    const preview = this.previewsByConnectionId.get(connection.id) ?? null;
    const roomId = preview
      ? this.getRoomId(preview.roomCoordinates)
      : this.getRoomIdFromMaybeCoordinates(message?.roomCoordinates);
    if (!roomId) {
      return;
    }

    this.previewsByConnectionId.delete(connection.id);
    if (preview) {
      this.clearStoredPreviewForPayload(preview);
    } else {
      const messageTimestamp =
        typeof message?.timestamp === 'number' && Number.isFinite(message.timestamp)
          ? message.timestamp
          : null;
      const persisted = this.persistedPreviewsByRoomId.get(roomId) ?? null;
      if (persisted && messageTimestamp !== null && persisted.timestamp > messageTimestamp) {
        return;
      }
      this.persistedPreviewsByRoomId.delete(roomId);
      void this.room.storage.delete(this.getPreviewStorageKey(roomId));
    }
    this.broadcastPopulations();
  }

  private shouldBroadcastPopulations(
    previousPresence: PresencePayload | null,
    nextPresence: PresencePayload | null
  ): boolean {
    return shouldBroadcastPresencePopulations(previousPresence, nextPresence);
  }

  private getRoomId(roomCoordinates: RoomCoordinates): string {
    return roomIdFromPresenceCoordinates(roomCoordinates);
  }

  private getRoomIdFromMaybeCoordinates(roomCoordinates: unknown): string | null {
    return roomIdFromUnknownCoordinates(roomCoordinates);
  }

  private getPreviewStorageKey(roomId: string): string {
    return roomPreviewStorageKey(roomId);
  }

  private toStoredSharedPreview(
    connection: Party.Connection<ConnectionPresenceState>,
    preview: RoomPreviewPayload,
  ): SharedRoomPreview | null {
    const state = connection.state;
    if (!state) {
      return null;
    }
    return toSharedRoomPreview(preview, state, this.room.id);
  }

  private clearStoredPreviewForPayload(preview: RoomPreviewPayload | null): boolean {
    if (!preview) {
      return false;
    }

    const roomId = this.getRoomId(preview.roomCoordinates);
    const persisted = this.persistedPreviewsByRoomId.get(roomId) ?? null;
    if (persisted && persisted.timestamp > preview.timestamp) {
      return false;
    }

    this.persistedPreviewsByRoomId.delete(roomId);
    void this.room.storage.delete(this.getPreviewStorageKey(roomId));
    return Boolean(persisted);
  }

  private pruneExpiredPersistedPreviews(): boolean {
    let pruned = false;
    for (const [roomId, preview] of this.persistedPreviewsByRoomId.entries()) {
      if (!isRoomPreviewExpired(preview, Date.now())) {
        continue;
      }

      this.persistedPreviewsByRoomId.delete(roomId);
      void this.room.storage.delete(this.getPreviewStorageKey(roomId));
      pruned = true;
    }

    return pruned;
  }

  private computeShardHeartbeat(): PartyKitShardHeartbeat | null {
    return computeShardHeartbeat(
      this.room.id,
      Array.from(this.room.getConnections<ConnectionPresenceState>(), ({ state }) => state),
      Date.now(),
    );
  }

  private async handleHeartbeat(req: Party.Request): Promise<Response> {
    const heartbeat = normalizeHeartbeatPayload(await req.json().catch(() => null));
    if (!heartbeat) {
      return new Response('Invalid heartbeat payload.', { status: 400 });
    }

    const now = Date.now();
    if (now - this.lastHeartbeatPruneAt >= HEARTBEAT_PRUNE_INTERVAL_MS) {
      this.lastHeartbeatPruneAt = now;
      await this.pruneStaleHeartbeats();
    }
    if (heartbeat.totalConnections === 0) await this.room.storage.delete(heartbeatStorageKey(heartbeat.shardId));
    else await this.room.storage.put(heartbeatStorageKey(heartbeat.shardId), heartbeat);

    return this.json({
      ok: true,
    } satisfies HeartbeatMutationResponse);
  }

  private async handleStats(): Promise<Response> {
    const { heartbeats, staleShardCount } = await this.loadActiveHeartbeats();
    return this.json(buildLaunchStats(heartbeats, staleShardCount, Date.now()));
  }

  private async loadActiveHeartbeats(): Promise<{
    heartbeats: PartyKitShardHeartbeat[];
    staleShardCount: number;
  }> {
    const entries = await this.room.storage.list<PartyKitShardHeartbeat>({
      prefix: METRICS_STORAGE_PREFIX,
    });
    const { heartbeats, staleKeys } = partitionActiveHeartbeats(entries, Date.now());

    if (staleKeys.length > 0) {
      await Promise.all(staleKeys.map((key) => this.room.storage.delete(key)));
    }

    return {
      heartbeats,
      staleShardCount: staleKeys.length,
    };
  }

  private async pruneStaleHeartbeats(): Promise<void> {
    await this.loadActiveHeartbeats();
  }

  private hasValidInternalToken(req: Party.Request): boolean {
    const expected = this.getInternalToken();
    if (!expected) {
      return false;
    }

    return req.headers.get(INTERNAL_TOKEN_HEADER) === expected;
  }

  private getInternalToken(): string | null {
    const value = String(this.room.env.PARTYKIT_INTERNAL_TOKEN ?? '').trim();
    return value || null;
  }

  private isMetricsRoom(): boolean {
    return this.room.id === METRICS_ROOM_ID;
  }

  private isPvpRoom(): boolean {
    return this.room.id.startsWith('pvp:');
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'content-type': 'application/json',
      },
    });
  }

  private async parseIdentity(
    urlString: string
  ): Promise<Omit<ConnectionPresenceState, 'presence' | 'lastRoomChatSentAt' | 'lastPvpInviteSentAt'> | null> {
    const url = new URL(urlString);
    const claims = await this.verifyIdentityToken(url.searchParams.get('identityToken'));
    if (!claims) {
      return null;
    }

    const channel = this.parseChannel(url.searchParams.get('channel'));

    return {
      channel,
      previewDeltas: url.searchParams.get('previewDeltas') === '1',
      roomChat: channel === 'presence' && url.searchParams.get('roomChat') === '1',
      presenceInterest: channel === 'presence' && url.searchParams.get('presenceInterest') === '1',
      canSendRoomChat: canSendRoomChat(claims),
      canReceiveRoomChat: canReceiveRoomChat(claims),
      roomChatCheckedAt: claims.iat,
      school: claims.roomChat === 'school',
      userId: claims.userId,
      displayName: claims.displayName,
      avatarId: claims.avatarId,
    };
  }

  private async verifyIdentityToken(rawToken: string | null): Promise<PartyKitIdentityTokenClaims | null> {
    const token = rawToken?.trim() ?? '';
    if (!token) {
      return null;
    }

    const signingSecret = resolvePartykitIdentitySigningSecret(this.room.env);
    if (!signingSecret) {
      return null;
    }

    return verifyPartykitIdentityToken(token, signingSecret.secret);
  }

  private parseChannel(rawChannel: string | null): RoomChatTransportChannel {
    return rawChannel === 'room-chat' ? 'room-chat' : 'presence';
  }

  private handleRoomChatSay(
    sender: Party.Connection<ConnectionPresenceState>,
    message: RoomChatSayMessage
  ): void {
    const state = sender.state;
    // Guests, chat-banned players and classroom accounts cannot send bubbles, whatever the client does.
    if (!state || !(state.channel === 'room-chat' || state.roomChat === true) || !state.canSendRoomChat) {
      return;
    }

    const presence = state.presence;
    if (!presence || presence.mode !== 'play') {
      return;
    }

    const text = normalizeRoomChatText(message.text);
    if (!text) {
      return;
    }

    const now = Date.now();
    if (now - state.lastRoomChatSentAt < ROOM_CHAT_SEND_RATE_LIMIT_MS) {
      return;
    }

    // Taken before any database read so a burst cannot slip past the rate limit.
    sender.setState({
      ...state,
      lastRoomChatSentAt: now,
    });

    // A ban or suspension made after connecting applies here, re-read at most once a minute.
    const db = resolveRoomChatModerationDatabase(this.room.env);
    if (db && now - (state.roomChatCheckedAt ?? 0) >= ROOM_CHAT_PERMISSION_RECHECK_MS) {
      this.runBackground(this.recheckRoomChatSender(db, sender, now).then((allowed) => {
        if (allowed) this.broadcastRoomChat(state, presence, text, now);
      }));
      return;
    }
    this.broadcastRoomChat(state, presence, text, now);
  }

  /** Resolves false when the sender may no longer post bubbles; a failed read keeps the earlier decision. */
  private async recheckRoomChatSender(
    db: RoomChatModerationDatabase,
    sender: Party.Connection<ConnectionPresenceState>,
    checkedAt: number,
  ): Promise<boolean> {
    let muted: boolean;
    try {
      muted = await isRoomChatSenderMuted(db, sender.state?.userId ?? '');
    } catch (error) {
      console.warn('Room chat permission check unavailable.', error);
      return true;
    }
    const current = sender.state;
    if (!current) return false;
    sender.setState({ ...current, roomChatCheckedAt: checkedAt, canSendRoomChat: current.canSendRoomChat && !muted });
    return !muted;
  }

  private broadcastRoomChat(
    state: ConnectionPresenceState,
    presence: PresencePayload,
    text: string,
    now: number,
  ): void {
    const roomId = this.getRoomId(presence.roomCoordinates);
    const payload = buildRoomChatBroadcast(
      state, this.room.id, text, now, crypto.randomUUID(), ROOM_CHAT_MESSAGE_LIFETIME_MS,
    );

    this.sendRoomChatMessage(payload, (connection) => {
      const peerPresence = connection.state?.presence;
      return (
        (connection.state?.channel === 'room-chat' || connection.state?.roomChat === true) &&
        connection.state.canReceiveRoomChat &&
        peerPresence?.mode === 'play' &&
        this.getRoomId(peerPresence.roomCoordinates) === roomId
      );
    });
  }

  private handlePvpInvite(
    sender: Party.Connection<ConnectionPresenceState>,
    message: PvpInviteSendMessage,
  ): void {
    const state = sender.state;
    if (!state || state.channel !== 'presence') {
      return;
    }

    const now = Date.now();
    if (now - state.lastPvpInviteSentAt < PVP_INVITE_SEND_RATE_LIMIT_MS) {
      return;
    }

    const invite = normalizePvpInviteSend(message, now);
    if (!invite) {
      return;
    }

    const target = this.findConnectionById(invite.targetConnectionId);
    if (!target?.state || target.state.channel !== 'presence') {
      return;
    }
    // Strangers cannot pull classroom accounts into matches, and students cannot invite strangers.
    if (state.school || target.state.school) {
      return;
    }

    sender.setState({
      ...state,
      lastPvpInviteSentAt: now,
    });

    const payload = buildPvpInviteOffer(
      invite, sender.id, this.identityFromState(state), this.identityFromState(target.state), this.room.id, now,
    );
    target.send(JSON.stringify(payload));
  }

  private handlePvpInviteAccept(
    sender: Party.Connection<ConnectionPresenceState>,
    message: PvpInviteAcceptMessage,
  ): void {
    const state = sender.state;
    if (!state || state.channel !== 'presence') {
      return;
    }

    const target = this.findConnectionById(message.inviterConnectionId);
    if (!target?.state || target.state.channel !== 'presence') {
      return;
    }

    const payload = buildPvpInviteAccepted(message, this.identityFromState(state));
    target.send(JSON.stringify(payload));
  }

  private handlePvpInviteDecline(
    sender: Party.Connection<ConnectionPresenceState>,
    message: PvpInviteDeclineMessage,
  ): void {
    const state = sender.state;
    if (!state || state.channel !== 'presence') {
      return;
    }

    const target = this.findConnectionById(message.inviterConnectionId);
    if (!target?.state || target.state.channel !== 'presence') {
      return;
    }

    const payload = buildPvpInviteDeclined(message, this.identityFromState(state));
    target.send(JSON.stringify(payload));
  }

  private handlePvpConnect(connection: Party.Connection<ConnectionPresenceState>): void {
    this.upsertPvpParticipant(connection);
    this.maybeActivatePvpMatch();
    this.broadcastPvpSnapshot();
  }

  private handlePvpClose(connection: Party.Connection<ConnectionPresenceState>): void {
    const state = this.pvpMatchState;
    const userId = connection.state?.userId ?? null;
    if (!state || !userId) {
      return;
    }

    const participant = state.participants.find((candidate) => candidate.userId === userId);
    if (!participant) {
      return;
    }

    participant.connected = false;

    if (state.status === 'complete') {
      this.broadcastPvpSnapshot();
      return;
    }

    if (state.status === 'countdown' || state.status === 'active') {
      this.finalizePvpForfeit(participant);
      return;
    }

    if (state.status === 'finalizing') {
      if (!state.participants.some((candidate) => candidate.hearts <= 0) && participant.hearts > 0) {
        this.finalizePvpForfeit(participant);
        return;
      }
      this.finalizePvpMatch();
      return;
    }

    state.lastEvent = `${participant.displayName} disconnected.`;
    this.broadcastPvpSnapshot();
  }

  private handlePvpMessage(
    message: PvpMatchClientMessage,
    sender: Party.Connection<ConnectionPresenceState>,
  ): void {
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
      return;
    }

    if (message.type === 'pvp:match:configure') {
      this.configurePvpMatch(sender, message);
      return;
    }

    if (message.type === 'pvp:match:hit') {
      this.applyPvpLifeLoss({
        hitId: String(message.hitId ?? ''),
        targetUserId: String(message.targetUserId ?? ''),
        attackerUserId: sender.state?.userId ?? null,
        source: message.source,
      });
      return;
    }

    if (message.type === 'pvp:match:self-death') {
      const userId = sender.state?.userId ?? '';
      this.applyPvpLifeLoss({
        hitId: String(message.hitId ?? ''),
        targetUserId: userId,
        attackerUserId: null,
        source: message.source,
      });
      return;
    }

    if (message.type === 'pvp:match:received-hit') {
      const userId = sender.state?.userId ?? '';
      this.applyPvpLifeLoss({
        hitId: String(message.hitId ?? ''),
        targetUserId: userId,
        attackerUserId: String(message.attackerUserId ?? ''),
        source: message.source,
      });
      return;
    }

    if (message.type === 'pvp:match:player-state') {
      this.handlePvpPlayerState(sender, message);
      return;
    }

    if (message.type === 'pvp:match:combat-event') {
      this.handlePvpCombatEvent(sender, message);
      return;
    }

    if (message.type === 'pvp:match:room-state-event') {
      this.handlePvpRoomStateEvent(sender, message);
      return;
    }

    if (message.type === 'pvp:match:leave') {
      this.handlePvpClose(sender);
    }
  }

  private configurePvpMatch(
    sender: Party.Connection<ConnectionPresenceState>,
    message: PvpMatchConfigureMessage,
  ): void {
    const state = sender.state;
    if (!state || !isValidPvpMatchConfiguration(message)) {
      return;
    }
    if (!this.pvpMatchState) {
      const match = createPvpMatchState(message, this.identityFromState(state));
      // A match id names exactly one room, so each match finishes in one place with one result.
      if (!match || `pvp:${match.matchId}` !== this.room.id) return;
      this.pvpMatchState = match;
    }

    this.upsertPvpParticipant(sender);
    this.maybeActivatePvpMatch();
    this.broadcastPvpSnapshot();
  }

  private upsertPvpParticipant(connection: Party.Connection<ConnectionPresenceState>): void {
    const state = connection.state;
    const match = this.pvpMatchState;
    if (!state || !match) {
      return;
    }

    upsertPvpParticipantState(match, this.identityFromState(state));
  }

  private maybeActivatePvpMatch(): void {
    const match = this.pvpMatchState;
    if (match) activatePvpMatchIfReady(match, Date.now());
  }

  private startPvpMatch(): void {
    const match = this.pvpMatchState;
    if (match && startPvpMatchState(match, Date.now())) this.broadcastPvpSnapshot();
  }

  private applyPvpLifeLoss(input: {
    hitId: string;
    targetUserId: string;
    attackerUserId: string | null;
    source: PvpHitSource;
  }): void {
    const match = this.pvpMatchState;
    if (!match) return;
    const result = applyPvpLifeLossToState(match, input, Date.now());
    if (!result.changed) return;
    if (result.requiresFinalizeSchedule) this.schedulePvpFinalize();
    this.broadcastPvpSnapshot();
  }

  private handlePvpPlayerState(
    sender: Party.Connection<ConnectionPresenceState>,
    message: PvpMatchPlayerStateMessage,
  ): void {
    const state = sender.state;
    const match = this.pvpMatchState;
    if (!state || !match || match.status === 'complete') {
      return;
    }

    const participant = match.participants.find((candidate) => candidate.userId === state.userId);
    if (!participant) {
      return;
    }

    const normalized = normalizePvpPlayerState(message.state, state.userId, Date.now());
    if (!normalized || normalized.matchId !== match.matchId) {
      return;
    }

    match.playerStatesByUserId.set(state.userId, normalized);
    this.sendToConnections(
      {
        type: 'pvp:match:peer-state',
        state: normalized,
      },
      (connection) => connection.state?.userId !== state.userId,
      [sender.id],
    );
  }

  private handlePvpCombatEvent(
    sender: Party.Connection<ConnectionPresenceState>,
    message: PvpMatchCombatEventMessage,
  ): void {
    const state = sender.state;
    const match = this.pvpMatchState;
    if (!state || !match || match.status === 'complete') {
      return;
    }

    if (!match.participants.some((participant) => participant.userId === state.userId)) {
      return;
    }

    const normalized = normalizePvpCombatEvent(message.event, state.userId, Date.now());
    if (!normalized || normalized.matchId !== match.matchId) {
      return;
    }

    this.sendToConnections(
      {
        type: 'pvp:match:peer-combat-event',
        event: normalized,
      },
      (connection) => connection.state?.userId !== state.userId,
      [sender.id],
    );
  }

  private handlePvpRoomStateEvent(
    sender: Party.Connection<ConnectionPresenceState>,
    message: PvpRoomStateEventMessage,
  ): void {
    const state = sender.state;
    const match = this.pvpMatchState;
    if (!state || !match || match.status === 'complete') {
      return;
    }

    if (!match.participants.some((participant) => participant.userId === state.userId)) {
      return;
    }

    const normalized = normalizePvpRoomStateEvent(message.event, state.userId, Date.now());
    if (!normalized || normalized.matchId !== match.matchId) {
      return;
    }

    this.sendToConnections(
      {
        type: 'pvp:match:peer-room-state-event',
        event: normalized,
      },
      (connection) => connection.state?.userId !== state.userId,
      [sender.id],
    );
  }

  private schedulePvpFinalize(): void {
    const match = this.pvpMatchState;
    if (match && this.pvpFinalizeAt === null) {
      this.pvpFinalizeAt = Date.now() + getMultiplayerModeDefinition(match.mode).finalizeDrawWindowMs;
    }
  }

  /** Persist score/phase changes only; high-frequency movement and relays do not write storage. */
  private persistPvpMatch(): void {
    const stored = this.pvpMatchState
      ? structuredClone({ match: this.pvpMatchState, finalizeAt: this.pvpFinalizeAt }) : null;
    const deadline = stored?.match.status === 'countdown' ? stored.match.countdownEndsAt
      : stored?.match.status === 'finalizing' ? stored.finalizeAt : null;
    const work = this.pvpStorageWork.catch(() => undefined).then(async () => {
      // Issue both mutations without yielding so native storage commits phase and deadline together.
      await Promise.all([
        stored ? this.room.storage.put(PVP_STORAGE_KEY, stored) : this.room.storage.delete(PVP_STORAGE_KEY),
        deadline !== null ? this.room.storage.setAlarm(deadline) : this.room.storage.deleteAlarm(),
      ]);
    });
    this.pvpStorageWork = work;
    this.runBackground(work);
  }

  private finalizePvpForfeit(participant: PvpParticipantSnapshot): void {
    const match = this.pvpMatchState;
    if (!match || match.status === 'complete') {
      return;
    }

    this.pvpFinalizeAt = null;
    markPvpForfeit(match, participant, Date.now());
    this.finalizePvpMatch();
  }

  private finalizePvpMatch(): void {
    const match = this.pvpMatchState;
    if (!match || match.status === 'complete') {
      return;
    }

    this.pvpFinalizeAt = null;
    finalizePvpMatchState(match, Date.now());
    this.broadcastPvpSnapshot();
    this.recordPvpResult(buildPvpSnapshot(match));
  }

  private recordPvpResult(snapshot: PvpMatchSnapshot): void {
    const record = this.runtime.recordPvpResult;
    if (!record) {
      return;
    }

    // Alarms wait for this too, so a match finalized by its deadline is saved before the alarm ends.
    const work = record(snapshot).catch((error) => { console.warn('PvP match result was not saved.', error); });
    this.pvpResultWork = work;
    this.runBackground(work);
  }

  private broadcastPvpSnapshot(): void {
    this.persistPvpMatch();
    const snapshot = this.getPvpSnapshot();
    if (!snapshot) {
      return;
    }

    this.sendToConnections(
      {
        type: 'pvp:match:snapshot',
        snapshot,
      },
      () => true,
    );
  }

  private getPvpSnapshot(): PvpMatchSnapshot | null {
    const match = this.pvpMatchState;
    if (!match) {
      return null;
    }

    return buildPvpSnapshot(match);
  }

  private identityFromState(state: ConnectionPresenceState): PvpParticipantIdentity {
    return identityFromPresenceState(state);
  }

  private findConnectionById(
    connectionId: string,
  ): Party.Connection<ConnectionPresenceState> | null {
    for (const connection of this.room.getConnections<ConnectionPresenceState>()) {
      if (connection.id === connectionId) {
        return connection;
      }
    }

    return null;
  }

  private queuePresenceUpsert(peer: WorldGhostPresence): void {
    this.pendingPresenceUpsertsByConnectionId.set(peer.connectionId, peer);
    if (peer.pvp?.matchId) {
      if (this.presenceUpsertFlushTimer !== null) {
        clearTimeout(this.presenceUpsertFlushTimer);
        this.presenceUpsertFlushTimer = null;
      }
      this.flushPresenceUpserts();
      return;
    }

    if (this.presenceUpsertFlushTimer !== null) {
      return;
    }

    this.presenceUpsertFlushTimer = setTimeout(() => {
      this.presenceUpsertFlushTimer = null;
      this.flushPresenceUpserts();
    }, PRESENCE_UPSERT_FLUSH_MS);
  }

  private flushPresenceUpserts(): void {
    if (this.pendingPresenceUpsertsByConnectionId.size === 0) {
      return;
    }

    const presenceConnections = Array.from(this.room.getConnections<ConnectionPresenceState>()).filter(
      (connection) => connection.state?.channel === 'presence'
    );
    const liveConnectionIds = new Set(presenceConnections.map((connection) => connection.id));
    const peers = Array.from(this.pendingPresenceUpsertsByConnectionId.values()).filter((peer) =>
      liveConnectionIds.has(peer.connectionId)
    );
    this.pendingPresenceUpsertsByConnectionId.clear();
    if (peers.length === 0) {
      return;
    }

    this.presenceInterest.sendFast(presenceConnections, peers, this.listPeers(null));
    if (this.farPresenceFlushTimer === null && this.presenceInterest.hasPending) {
      this.farPresenceFlushTimer = setTimeout(() => {
        this.farPresenceFlushTimer = null;
        this.presenceInterest.flushFar(
          Array.from(this.room.getConnections<ConnectionPresenceState>()).filter(c => c.state?.channel === 'presence'),
          this.listPeers(null)
        );
      }, PRESENCE_FAR_FLUSH_MS);
    }
  }

  private sendPresenceMessage(
    payload: unknown,
    options: { excludeConnectionIds?: string[] } = {}
  ): void {
    this.sendToConnections(
      payload,
      (connection) => connection.state?.channel === 'presence',
      options.excludeConnectionIds
    );
  }

  private sendRoomChatMessage(
    payload: RoomChatBroadcastMessage,
    predicate: (connection: Party.Connection<ConnectionPresenceState>) => boolean
  ): void {
    this.sendToConnections(payload, predicate);
  }

  private sendToConnections(
    payload: unknown,
    predicate: (connection: Party.Connection<ConnectionPresenceState>) => boolean,
    excludeConnectionIds: string[] = []
  ): void {
    const excluded = new Set(excludeConnectionIds);
    const serialized = JSON.stringify(payload);

    for (const connection of this.room.getConnections<ConnectionPresenceState>()) {
      if (excluded.has(connection.id) || !predicate(connection)) {
        continue;
      }

      connection.send(serialized);
    }
  }

}

PresenceServer satisfies Party.Worker;
