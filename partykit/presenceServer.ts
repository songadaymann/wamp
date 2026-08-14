import type * as Party from 'partykit/server';
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
  type PartyKitIdentityTokenClaims,
} from '../src/presence/identityToken';
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

const HEARTBEAT_INTERVAL_MS = 15_000;
const INTERNAL_TOKEN_HEADER = 'x-partykit-internal-token';
const PRESENCE_UPSERT_FLUSH_MS = 80;
const POPULATION_BROADCAST_FLUSH_MS = 250;

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

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatAt = 0;
  private readonly previewsByConnectionId = new Map<string, RoomPreviewPayload>();
  private readonly persistedPreviewsByRoomId = new Map<string, SharedRoomPreview>();
  private readonly pendingPresenceUpsertsByConnectionId = new Map<string, WorldGhostPresence>();
  private presenceUpsertFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private populationBroadcastFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private pvpMatchState: PvpMatchState | null = null;
  private pvpStartTimer: ReturnType<typeof setTimeout> | null = null;
  private pvpFinalizeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly room: Party.Room) {}

  async onStart(): Promise<void> {
    if (this.isMetricsRoom() || this.isPvpRoom()) {
      return;
    }

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
      connection.send(
        JSON.stringify({
          type: 'snapshot',
          peers: this.listPeers(connection),
          roomPopulations: this.computeRoomPopulations(),
          roomEditors: this.computeRoomEditors(),
          roomPreviews: this.computeRoomPreviews(),
        })
      );
    }

    this.broadcastPopulations();
    this.syncHeartbeatTimer();
    void this.maybeSendShardHeartbeat(true);
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
      void this.updatePreview(sender, parsed.preview).catch((error) => {
        console.warn('Failed to update construction preview.', error);
      });
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
        void this.maybeSendShardHeartbeat(true);
      }
    }
  }

  onClose(connection: Party.Connection<ConnectionPresenceState>): void {
    if (this.isPvpRoom()) {
      this.handlePvpClose(connection);
      return;
    }

    const presence = connection.state?.presence;
    const preview = this.previewsByConnectionId.get(connection.id) ?? null;
    this.pendingPresenceUpsertsByConnectionId.delete(connection.id);
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
    this.syncHeartbeatTimer();
    void this.maybeSendShardHeartbeat(true);
  }

  private clearPresence(connection: Party.Connection<ConnectionPresenceState>): void {
    const current = connection.state;
    const previousPresence = current?.presence ?? null;
    const previousPreview = this.previewsByConnectionId.get(connection.id) ?? null;
    this.pendingPresenceUpsertsByConnectionId.delete(connection.id);
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
        void this.maybeSendShardHeartbeat(true);
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
      void this.maybeSendShardHeartbeat(true);
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
    this.sendPresenceMessage({
      type: 'populations',
      roomPopulations: this.computeRoomPopulations(),
      roomEditors: this.computeRoomEditors(),
      roomPreviews: this.computeRoomPreviews(),
    });
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

  private async maybeSendShardHeartbeat(force = false): Promise<void> {
    if (this.isMetricsRoom()) {
      return;
    }

    const token = this.getInternalToken();
    if (!token) {
      return;
    }

    const heartbeat = this.computeShardHeartbeat();
    if (!heartbeat) {
      return;
    }

    const now = Date.now();
    if (!force && now - this.lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) {
      return;
    }

    this.lastHeartbeatAt = now;

    try {
      await this.room.context.parties[this.room.name].get(METRICS_ROOM_ID).fetch('/heartbeat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [INTERNAL_TOKEN_HEADER]: token,
        },
        body: JSON.stringify(heartbeat),
      });
    } catch {
      // Metrics are best-effort and should not affect live ghost traffic.
    }
  }

  private computeShardHeartbeat(): PartyKitShardHeartbeat | null {
    return computeShardHeartbeat(
      this.room.id,
      Array.from(this.room.getConnections<ConnectionPresenceState>(), ({ state }) => state),
      Date.now(),
    );
  }

  private syncHeartbeatTimer(): void {
    if (this.isMetricsRoom()) {
      if (this.heartbeatTimer !== null) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      return;
    }

    const hasConnections = this.hasAnyPresenceConnections();
    if (!hasConnections) {
      if (this.heartbeatTimer !== null) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      return;
    }

    if (this.heartbeatTimer === null) {
      this.heartbeatTimer = setInterval(() => {
        void this.maybeSendShardHeartbeat();
      }, HEARTBEAT_INTERVAL_MS);
    }
  }

  private hasAnyPresenceConnections(): boolean {
    for (const connection of this.room.getConnections<ConnectionPresenceState>()) {
      if (connection.state?.channel === 'presence') {
        return true;
      }
    }

    return false;
  }

  private async handleHeartbeat(req: Party.Request): Promise<Response> {
    const heartbeat = normalizeHeartbeatPayload(await req.json().catch(() => null));
    if (!heartbeat) {
      return new Response('Invalid heartbeat payload.', { status: 400 });
    }

    await this.pruneStaleHeartbeats();
    await this.room.storage.put(heartbeatStorageKey(heartbeat.shardId), heartbeat);

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
    if (!state || state.channel !== 'room-chat') {
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

    sender.setState({
      ...state,
      lastRoomChatSentAt: now,
    });

    const roomId = this.getRoomId(presence.roomCoordinates);
    const payload = buildRoomChatBroadcast(
      state, this.room.id, text, now, crypto.randomUUID(), ROOM_CHAT_MESSAGE_LIFETIME_MS,
    );

    this.sendRoomChatMessage(payload, (connection) => {
      const peerPresence = connection.state?.presence;
      return (
        connection.state?.channel === 'room-chat' &&
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
      this.pvpMatchState = createPvpMatchState(message, this.identityFromState(state));
      if (!this.pvpMatchState) return;
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
    if (match && activatePvpMatchIfReady(match, Date.now())) this.schedulePvpStart();
  }

  private schedulePvpStart(): void {
    const match = this.pvpMatchState;
    if (!match || match.status !== 'countdown' || !match.countdownEndsAt) {
      return;
    }
    if (this.pvpStartTimer !== null) {
      return;
    }

    this.pvpStartTimer = setTimeout(() => {
      this.pvpStartTimer = null;
      this.startPvpMatch();
    }, Math.max(0, match.countdownEndsAt - Date.now()));
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
    if (!match || this.pvpFinalizeTimer !== null) {
      return;
    }

    this.pvpFinalizeTimer = setTimeout(() => {
      this.pvpFinalizeTimer = null;
      this.finalizePvpMatch();
    }, getMultiplayerModeDefinition(match.mode).finalizeDrawWindowMs);
  }

  private clearPvpStartTimer(): void {
    if (this.pvpStartTimer === null) {
      return;
    }
    clearTimeout(this.pvpStartTimer);
    this.pvpStartTimer = null;
  }

  private clearPvpFinalizeTimer(): void {
    if (this.pvpFinalizeTimer === null) {
      return;
    }
    clearTimeout(this.pvpFinalizeTimer);
    this.pvpFinalizeTimer = null;
  }

  private finalizePvpForfeit(participant: PvpParticipantSnapshot): void {
    const match = this.pvpMatchState;
    if (!match || match.status === 'complete') {
      return;
    }

    this.clearPvpStartTimer();
    this.clearPvpFinalizeTimer();
    markPvpForfeit(match, participant, Date.now());
    this.finalizePvpMatch();
  }

  private finalizePvpMatch(): void {
    const match = this.pvpMatchState;
    if (!match || match.status === 'complete') {
      return;
    }

    this.clearPvpStartTimer();
    this.clearPvpFinalizeTimer();
    finalizePvpMatchState(match, Date.now());
    this.broadcastPvpSnapshot();
  }

  private broadcastPvpSnapshot(): void {
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

    this.sendPresenceMessage({ type: 'upserts', peers });
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
