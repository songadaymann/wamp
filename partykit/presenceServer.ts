import type * as Party from 'partykit/server';
import type { PartyKitLaunchStats, PartyKitShardHeartbeat } from '../src/admin/model';
import {
  ROOM_CHAT_MESSAGE_LIFETIME_MS,
  ROOM_CHAT_MESSAGE_MAX_LENGTH,
  ROOM_CHAT_SEND_RATE_LIMIT_MS,
  type RoomChatBroadcastMessage,
  type RoomChatSayMessage,
  type RoomChatTransportChannel,
} from '../src/chat/roomChatModel';
import type { RoomCoordinates, RoomSnapshot } from '../src/persistence/roomModel';
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
  getMultiplayerModeDefinition,
  type PvpHitSource,
  type PvpInviteAcceptMessage,
  type PvpInviteDeclineMessage,
  type PvpInviteSendMessage,
  type PvpMatchCombatEvent,
  type PvpMatchCombatEventMessage,
  type PvpMatchClientMessage,
  type PvpMatchConfigureMessage,
  type PvpMatchPlayerState,
  type PvpMatchPlayerStateMessage,
  type PvpMatchSnapshot,
  type PvpMatchStatus,
  type PvpMode,
  type PvpParticipantIdentity,
  type PvpParticipantSnapshot,
  type PvpPresenceServerMessage,
  type PvpRoomStateEvent,
  type PvpRoomStateEventMessage,
} from '../src/pvp/model';

const HEARTBEAT_INTERVAL_MS = 15_000;
const STALE_HEARTBEAT_MS = 120_000;
const INTERNAL_TOKEN_HEADER = 'x-partykit-internal-token';
const METRICS_ROOM_ID = '__launch-stats__';
const METRICS_STORAGE_PREFIX = 'shard:';
const PREVIEW_STORAGE_PREFIX = 'preview:';
const ROOM_PREVIEW_TTL_MS = 120_000;
const PRESENCE_UPSERT_FLUSH_MS = 80;
const POPULATION_BROADCAST_FLUSH_MS = 250;

interface PvpMatchState {
  matchId: string;
  mode: PvpMode;
  roomId: string;
  roomCoordinates: RoomCoordinates;
  status: PvpMatchStatus;
  participants: PvpParticipantSnapshot[];
  startedAt: number | null;
  countdownEndsAt: number | null;
  finishedAt: number | null;
  winnerUserId: string | null;
  loserUserId: string | null;
  draw: boolean;
  lastEvent: string | null;
  appliedHitIds: Set<string>;
  playerStatesByUserId: Map<string, PvpMatchPlayerState>;
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
      prefix: PREVIEW_STORAGE_PREFIX,
    });
    for (const [storageKey, storedPreview] of entries.entries()) {
      const preview = this.normalizeStoredSharedPreview(storedPreview);
      if (!preview || this.isRoomPreviewExpired(preview)) {
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
    const peers: WorldGhostPresence[] = [];
    const excludeConnectionId = viewer?.id ?? null;
    const excludeUserId = viewer?.state?.userId ?? null;

    for (const connection of this.room.getConnections<ConnectionPresenceState>()) {
      if (excludeConnectionId && connection.id === excludeConnectionId) {
        continue;
      }
      if (excludeUserId && connection.state?.userId === excludeUserId) {
        continue;
      }

      const peer = this.toGhostPresence(connection);
      if (peer) {
        peers.push(peer);
      }
    }

    return peers.sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  private computeRoomPopulations(): Record<string, number> {
    const counts = new Map<string, number>();

    for (const connection of this.room.getConnections<ConnectionPresenceState>()) {
      const presence = connection.state?.presence;
      if (
        connection.state?.channel !== 'presence' ||
        !presence ||
        presence.mode !== 'play'
      ) {
        continue;
      }

      const roomId = this.getRoomId(presence.roomCoordinates);
      counts.set(roomId, (counts.get(roomId) ?? 0) + 1);
    }

    return Object.fromEntries(
      Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right))
    );
  }

  private computeRoomEditors(): Record<string, number> {
    const counts = new Map<string, number>();

    for (const connection of this.room.getConnections<ConnectionPresenceState>()) {
      const presence = connection.state?.presence;
      if (connection.state?.channel !== 'presence' || !presence || presence.mode !== 'edit') {
        continue;
      }

      const roomId = `${presence.roomCoordinates.x},${presence.roomCoordinates.y}`;
      counts.set(roomId, (counts.get(roomId) ?? 0) + 1);
    }

    return Object.fromEntries(
      Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right))
    );
  }

  private computeRoomPreviews(): Record<string, SharedRoomPreview> {
    this.pruneExpiredPersistedPreviews();
    const previewsByRoomId = new Map<string, SharedRoomPreview>(this.persistedPreviewsByRoomId);

    for (const connection of this.room.getConnections<ConnectionPresenceState>()) {
      const preview = this.toRoomPreview(connection);
      if (!preview || this.isRoomPreviewExpired(preview)) {
        continue;
      }

      const existing = previewsByRoomId.get(preview.roomId) ?? null;
      if (!existing || preview.timestamp >= existing.timestamp) {
        previewsByRoomId.set(preview.roomId, preview);
      }
    }

    return Object.fromEntries(
      Array.from(previewsByRoomId.entries()).sort(([left], [right]) => left.localeCompare(right))
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
    const state = connection.state;
    if (state?.channel !== 'presence' || !isVisiblePresence(state.presence)) {
      return null;
    }

    return {
      ...state.presence,
      connectionId: connection.id,
      userId: state.userId,
      displayName: state.displayName,
      avatarId: state.avatarId,
      shardId: this.room.id,
      roomId: `${state.presence.roomCoordinates.x},${state.presence.roomCoordinates.y}`,
    };
  }

  private toRoomPreview(
    connection: Party.Connection<ConnectionPresenceState>
  ): SharedRoomPreview | null {
    const state = connection.state;
    const preview = this.previewsByConnectionId.get(connection.id) ?? null;
    if (!state?.presence || state.presence.mode !== 'edit' || !preview) {
      return null;
    }

    const { constructionPreviewToken: _token, ...sharedPreview } = preview;

    return {
      ...sharedPreview,
      roomId: this.getRoomId(preview.roomCoordinates),
      userId: state.userId,
      displayName: state.displayName,
      shardId: this.room.id,
      timestamp: Date.now(),
    };
  }

  private async updatePreview(
    connection: Party.Connection<ConnectionPresenceState>,
    value: unknown,
  ): Promise<void> {
    const current = connection.state;
    if (!current || current.channel !== 'presence') {
      return;
    }

    const preview = this.normalizeRoomPreviewPayload(value);
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
    const previousCountsMode = this.getPopulationMode(previousPresence);
    const nextCountsMode = this.getPopulationMode(nextPresence);
    const previousRoomId = previousPresence ? this.getRoomId(previousPresence.roomCoordinates) : null;
    const nextRoomId = nextPresence ? this.getRoomId(nextPresence.roomCoordinates) : null;

    return previousCountsMode !== nextCountsMode || previousRoomId !== nextRoomId;
  }

  private getPopulationMode(presence: PresencePayload | null): 'play' | 'edit' | null {
    if (!presence || (presence.mode !== 'play' && presence.mode !== 'edit')) {
      return null;
    }

    return presence.mode;
  }

  private getRoomId(roomCoordinates: RoomCoordinates): string {
    return `${roomCoordinates.x},${roomCoordinates.y}`;
  }

  private getRoomIdFromMaybeCoordinates(roomCoordinates: unknown): string | null {
    if (
      !roomCoordinates ||
      typeof roomCoordinates !== 'object' ||
      !Number.isInteger((roomCoordinates as Partial<RoomCoordinates>).x) ||
      !Number.isInteger((roomCoordinates as Partial<RoomCoordinates>).y)
    ) {
      return null;
    }

    return this.getRoomId(roomCoordinates as RoomCoordinates);
  }

  private getPreviewStorageKey(roomId: string): string {
    return `${PREVIEW_STORAGE_PREFIX}${roomId}`;
  }

  private toStoredSharedPreview(
    connection: Party.Connection<ConnectionPresenceState>,
    preview: RoomPreviewPayload,
  ): SharedRoomPreview | null {
    const state = connection.state;
    if (!state) {
      return null;
    }
    const { constructionPreviewToken: _token, ...storedPreview } = preview;

    return {
      ...storedPreview,
      roomId: this.getRoomId(preview.roomCoordinates),
      userId: state.userId,
      displayName: state.displayName,
      shardId: this.room.id,
    };
  }

  private normalizeStoredSharedPreview(value: unknown): SharedRoomPreview | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const preview = value as Partial<SharedRoomPreview>;
    if (
      typeof preview.roomId !== 'string' ||
      typeof preview.userId !== 'string' ||
      typeof preview.displayName !== 'string' ||
      typeof preview.shardId !== 'string'
    ) {
      return null;
    }

    const normalizedPayload = this.normalizeRoomPreviewPayload(preview);
    if (!normalizedPayload) {
      return null;
    }

    return {
      ...normalizedPayload,
      roomId: preview.roomId,
      userId: preview.userId,
      displayName: preview.displayName,
      shardId: preview.shardId,
    };
  }

  private normalizeRoomPreviewPayload(value: unknown): RoomPreviewPayload | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const payload = value as Partial<RoomPreviewPayload>;
    if (
      !payload.roomCoordinates ||
      !Number.isInteger(payload.roomCoordinates.x) ||
      !Number.isInteger(payload.roomCoordinates.y) ||
      typeof payload.timestamp !== 'number' ||
      !Number.isFinite(payload.timestamp) ||
      !payload.snapshot ||
      typeof payload.snapshot !== 'object'
    ) {
      return null;
    }

    const snapshot = payload.snapshot as Partial<RoomSnapshot>;
    if (
      typeof snapshot.id !== 'string' ||
      !snapshot.coordinates ||
      snapshot.coordinates.x !== payload.roomCoordinates.x ||
      snapshot.coordinates.y !== payload.roomCoordinates.y
    ) {
      return null;
    }

    try {
      if (JSON.stringify(payload.snapshot).length > 120_000) {
        return null;
      }
    } catch {
      return null;
    }

    return {
      roomCoordinates: {
        x: payload.roomCoordinates.x,
        y: payload.roomCoordinates.y,
      },
      snapshot: payload.snapshot as RoomSnapshot,
      timestamp: payload.timestamp,
      ...(typeof payload.constructionPreviewToken === 'string' &&
      payload.constructionPreviewToken.trim().length > 0 &&
      payload.constructionPreviewToken.length <= 2048
        ? { constructionPreviewToken: payload.constructionPreviewToken.trim() }
        : {}),
    };
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
      if (!this.isRoomPreviewExpired(preview)) {
        continue;
      }

      this.persistedPreviewsByRoomId.delete(roomId);
      void this.room.storage.delete(this.getPreviewStorageKey(roomId));
      pruned = true;
    }

    return pruned;
  }

  private isRoomPreviewExpired(preview: Pick<RoomPreviewPayload, 'timestamp'>): boolean {
    return Date.now() - preview.timestamp > ROOM_PREVIEW_TTL_MS;
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
    let totalConnections = 0;
    let playConnections = 0;
    let editConnections = 0;

    for (const connection of this.room.getConnections<ConnectionPresenceState>()) {
      if (connection.state?.channel !== 'presence') {
        continue;
      }

      totalConnections += 1;

      const mode = connection.state?.presence?.mode ?? null;
      if (mode === 'play') {
        playConnections += 1;
      } else if (mode === 'edit') {
        editConnections += 1;
      }
    }

    if (totalConnections === 0) {
      return null;
    }

    return {
      shardId: this.room.id,
      totalConnections,
      playConnections,
      editConnections,
      updatedAt: new Date().toISOString(),
    };
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
    const heartbeat = this.normalizeHeartbeatPayload(await req.json().catch(() => null));
    if (!heartbeat) {
      return new Response('Invalid heartbeat payload.', { status: 400 });
    }

    await this.pruneStaleHeartbeats();
    await this.room.storage.put(this.getHeartbeatStorageKey(heartbeat.shardId), heartbeat);

    return this.json({
      ok: true,
    } satisfies HeartbeatMutationResponse);
  }

  private async handleStats(): Promise<Response> {
    const { heartbeats, staleShardCount } = await this.loadActiveHeartbeats();
    const responseBody: PartyKitLaunchStats = {
      fetchedAt: new Date().toISOString(),
      shardCount: heartbeats.length,
      staleShardCount,
      totalConnections: heartbeats.reduce((sum, shard) => sum + shard.totalConnections, 0),
      totalPlayConnections: heartbeats.reduce((sum, shard) => sum + shard.playConnections, 0),
      totalEditConnections: heartbeats.reduce((sum, shard) => sum + shard.editConnections, 0),
      shards: heartbeats,
    };

    return this.json(responseBody);
  }

  private async loadActiveHeartbeats(): Promise<{
    heartbeats: PartyKitShardHeartbeat[];
    staleShardCount: number;
  }> {
    const entries = await this.room.storage.list<PartyKitShardHeartbeat>({
      prefix: METRICS_STORAGE_PREFIX,
    });
    const heartbeats: PartyKitShardHeartbeat[] = [];
    const staleKeys: string[] = [];
    const now = Date.now();

    for (const [key, value] of entries) {
      const heartbeat = this.normalizeHeartbeatPayload(value);
      if (!heartbeat) {
        staleKeys.push(key);
        continue;
      }

      const updatedAtMs = Date.parse(heartbeat.updatedAt);
      if (!Number.isFinite(updatedAtMs) || now - updatedAtMs > STALE_HEARTBEAT_MS) {
        staleKeys.push(key);
        continue;
      }

      heartbeats.push(heartbeat);
    }

    if (staleKeys.length > 0) {
      await Promise.all(staleKeys.map((key) => this.room.storage.delete(key)));
    }

    heartbeats.sort(
      (left, right) =>
        right.totalConnections - left.totalConnections || left.shardId.localeCompare(right.shardId)
    );

    return {
      heartbeats,
      staleShardCount: staleKeys.length,
    };
  }

  private async pruneStaleHeartbeats(): Promise<void> {
    await this.loadActiveHeartbeats();
  }

  private getHeartbeatStorageKey(shardId: string): string {
    return `${METRICS_STORAGE_PREFIX}${shardId}`;
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

    const text = this.normalizeRoomChatText(message.text);
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
    const payload = {
      type: 'room-chat:message',
      message: {
        id: crypto.randomUUID(),
        shardId: this.room.id,
        userId: state.userId,
        displayName: state.displayName,
        avatarId: state.avatarId,
        roomCoordinates: {
          x: presence.roomCoordinates.x,
          y: presence.roomCoordinates.y,
        },
        roomId,
        text,
        createdAt: now,
        expiresAt: now + ROOM_CHAT_MESSAGE_LIFETIME_MS,
      },
    } satisfies RoomChatBroadcastMessage;

    this.sendRoomChatMessage(payload, (connection) => {
      const peerPresence = connection.state?.presence;
      return (
        connection.state?.channel === 'room-chat' &&
        peerPresence?.mode === 'play' &&
        this.getRoomId(peerPresence.roomCoordinates) === roomId
      );
    });
  }

  private normalizeRoomChatText(rawText: unknown): string | null {
    if (typeof rawText !== 'string') {
      return null;
    }

    const text = rawText.trim();
    if (text.length === 0 || text.length > ROOM_CHAT_MESSAGE_MAX_LENGTH) {
      return null;
    }

    return text;
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
    if (now - state.lastPvpInviteSentAt < 3_000) {
      return;
    }

    const invite = this.normalizePvpInviteSend(message);
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

    const payload: PvpPresenceServerMessage = {
      type: 'pvp:invite:offer',
      invite: {
        inviteId: invite.inviteId,
        matchId: invite.matchId,
        mode: invite.mode,
        roomId: invite.roomId,
        roomCoordinates: { ...invite.roomCoordinates },
        shardId: this.room.id,
        inviterConnectionId: sender.id,
        inviter: this.identityFromState(state),
        target: this.identityFromState(target.state),
        createdAt: now,
        expiresAt: invite.expiresAt,
      },
    };
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

    const payload: PvpPresenceServerMessage = {
      type: 'pvp:invite:accepted',
      inviteId: String(message.inviteId ?? '').slice(0, 80),
      matchId: String(message.matchId ?? '').slice(0, 96),
      acceptedBy: this.identityFromState(state),
    };
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

    const payload: PvpPresenceServerMessage = {
      type: 'pvp:invite:declined',
      inviteId: String(message.inviteId ?? '').slice(0, 80),
      matchId: String(message.matchId ?? '').slice(0, 96),
      declinedBy: this.identityFromState(state),
    };
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
    if (!state || message.mode !== 'arena') {
      return;
    }
    const mode = getMultiplayerModeDefinition(message.mode);

    const roomCoordinates = this.normalizeRoomCoordinates(message.roomCoordinates);
    const matchId = this.normalizeShortId(message.matchId, 96);
    const roomId = this.normalizeShortId(message.roomId, 80);
    if (!roomCoordinates || !matchId || !roomId) {
      return;
    }

    if (!this.pvpMatchState) {
      const participants = this.normalizePvpParticipants(message.participants);
      if (!participants.some((participant) => participant.userId === state.userId)) {
        participants.push(this.identityFromState(state));
      }

      this.pvpMatchState = {
        matchId,
        mode: mode.id,
        roomId,
        roomCoordinates,
        status: 'waiting',
        participants: participants.slice(0, mode.maxPlayers).map((participant) => ({
          ...participant,
          hearts: mode.startingLives,
          connected: false,
          invulnerableUntil: 0,
          losses: 0,
          hits: 0,
        })),
        startedAt: null,
        countdownEndsAt: null,
        finishedAt: null,
        winnerUserId: null,
        loserUserId: null,
        draw: false,
        lastEvent: mode.copy.createdEvent,
        appliedHitIds: new Set(),
        playerStatesByUserId: new Map(),
      };
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

    const existing = match.participants.find((candidate) => candidate.userId === state.userId);
    if (existing) {
      existing.displayName = state.displayName;
      existing.avatarId = state.avatarId;
      existing.connected = true;
      return;
    }

    const mode = getMultiplayerModeDefinition(match.mode);
    if (match.participants.length >= mode.maxPlayers) {
      return;
    }

    match.participants.push({
      ...this.identityFromState(state),
      hearts: mode.startingLives,
      connected: true,
      invulnerableUntil: 0,
      losses: 0,
      hits: 0,
    });
  }

  private maybeActivatePvpMatch(): void {
    const match = this.pvpMatchState;
    if (!match || match.status !== 'waiting') {
      return;
    }

    const mode = getMultiplayerModeDefinition(match.mode);
    if (
      match.participants.length < mode.minPlayers ||
      match.participants.some((participant) => !participant.connected)
    ) {
      return;
    }

    match.status = 'countdown';
    match.countdownEndsAt = Date.now() + mode.countdownMs;
    match.lastEvent = mode.copy.startRuleEvent;
    this.schedulePvpStart();
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
    if (!match || match.status !== 'countdown') {
      return;
    }

    match.status = 'active';
    match.startedAt = Date.now();
    match.countdownEndsAt = null;
    match.lastEvent = getMultiplayerModeDefinition(match.mode).copy.goEvent;
    this.broadcastPvpSnapshot();
  }

  private applyPvpLifeLoss(input: {
    hitId: string;
    targetUserId: string;
    attackerUserId: string | null;
    source: PvpHitSource;
  }): void {
    const match = this.pvpMatchState;
    if (!match || (match.status !== 'active' && match.status !== 'finalizing')) {
      return;
    }

    const hitId = this.normalizeShortId(input.hitId, 120);
    if (!hitId || match.appliedHitIds.has(hitId)) {
      return;
    }

    const target = match.participants.find((participant) => participant.userId === input.targetUserId);
    if (!target || target.hearts <= 0) {
      return;
    }

    if (
      input.attackerUserId &&
      !match.participants.some((participant) => participant.userId === input.attackerUserId)
    ) {
      return;
    }

    const now = Date.now();
    if (match.status === 'active' && now < target.invulnerableUntil) {
      return;
    }

    match.appliedHitIds.add(hitId);
    target.hearts = Math.max(0, target.hearts - 1);
    target.losses += 1;
    target.invulnerableUntil = now + getMultiplayerModeDefinition(match.mode).respawnInvulnerableMs;

    const attacker = input.attackerUserId
      ? match.participants.find((participant) => participant.userId === input.attackerUserId) ?? null
      : null;
    if (attacker && attacker.userId !== target.userId) {
      attacker.hits += 1;
    }

    match.lastEvent =
      input.source === 'environment'
        ? `${target.displayName} lost a heart.`
        : `${target.displayName} lost a heart to ${attacker?.displayName ?? 'opponent'}.`;

    if (target.hearts <= 0) {
      match.status = 'finalizing';
      match.lastEvent = `${target.displayName} is out.`;
      this.schedulePvpFinalize();
    }

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

    const normalized = this.normalizePvpPlayerState(message.state, state.userId);
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

    const normalized = this.normalizePvpCombatEvent(message.event, state.userId);
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

    const normalized = this.normalizePvpRoomStateEvent(message.event, state.userId);
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
    match.startedAt ??= Date.now();
    match.countdownEndsAt = null;
    participant.hearts = 0;
    participant.losses = Math.max(
      participant.losses,
      getMultiplayerModeDefinition(match.mode).startingLives,
    );
    participant.invulnerableUntil = 0;
    match.status = 'finalizing';
    match.lastEvent = `${participant.displayName} forfeited.`;
    this.finalizePvpMatch();
  }

  private finalizePvpMatch(): void {
    const match = this.pvpMatchState;
    if (!match || match.status === 'complete') {
      return;
    }

    this.clearPvpStartTimer();
    this.clearPvpFinalizeTimer();
    const eliminated = match.participants.filter((participant) => participant.hearts <= 0);
    const alive = match.participants.filter((participant) => participant.hearts > 0);
    match.status = 'complete';
    match.finishedAt = Date.now();

    if (eliminated.length !== 1 || alive.length !== 1) {
      match.draw = true;
      match.winnerUserId = null;
      match.loserUserId = null;
      match.lastEvent = 'Draw.';
    } else {
      match.draw = false;
      match.winnerUserId = alive[0]?.userId ?? null;
      match.loserUserId = eliminated[0]?.userId ?? null;
      match.lastEvent = `${alive[0]?.displayName ?? 'Player'} wins.`;
    }

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

    return {
      matchId: match.matchId,
      mode: match.mode,
      roomId: match.roomId,
      roomCoordinates: { ...match.roomCoordinates },
      status: match.status,
      participants: match.participants.map((participant) => ({ ...participant })),
      startedAt: match.startedAt,
      countdownEndsAt: match.countdownEndsAt,
      finishedAt: match.finishedAt,
      winnerUserId: match.winnerUserId,
      loserUserId: match.loserUserId,
      draw: match.draw,
      lastEvent: match.lastEvent,
    };
  }

  private normalizePvpInviteSend(message: PvpInviteSendMessage): PvpInviteSendMessage['invite'] | null {
    const invite = message.invite;
    if (!invite || invite.mode !== 'arena') {
      return null;
    }

    const roomCoordinates = this.normalizeRoomCoordinates(invite.roomCoordinates);
    const inviteId = this.normalizeShortId(invite.inviteId, 80);
    const matchId = this.normalizeShortId(invite.matchId, 96);
    const roomId = this.normalizeShortId(invite.roomId, 80);
    const targetConnectionId = this.normalizeShortId(invite.targetConnectionId, 96);
    if (!roomCoordinates || !inviteId || !matchId || !roomId || !targetConnectionId) {
      return null;
    }

    return {
      ...invite,
      inviteId,
      matchId,
      mode: 'arena',
      roomId,
      roomCoordinates,
      targetConnectionId,
      target: this.normalizePvpParticipant(invite.target) ?? {
        userId: '',
        displayName: 'Player',
        avatarId: 'default-player',
      },
      expiresAt: Math.max(Date.now() + 5_000, Number(invite.expiresAt ?? 0)),
    };
  }

  private normalizePvpParticipants(value: unknown): PvpParticipantIdentity[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const participants: PvpParticipantIdentity[] = [];
    const seenUserIds = new Set<string>();
    for (const item of value) {
      const participant = this.normalizePvpParticipant(item);
      if (!participant || seenUserIds.has(participant.userId)) {
        continue;
      }

      seenUserIds.add(participant.userId);
      participants.push(participant);
      if (participants.length >= 2) {
        break;
      }
    }

    return participants;
  }

  private normalizePvpParticipant(value: unknown): PvpParticipantIdentity | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const raw = value as Partial<PvpParticipantIdentity>;
    const userId = this.normalizeShortId(raw.userId, 96);
    if (!userId) {
      return null;
    }

    return {
      userId,
      displayName: (typeof raw.displayName === 'string' && raw.displayName.trim()
        ? raw.displayName.trim()
        : 'Player').slice(0, 32),
      avatarId: (typeof raw.avatarId === 'string' && raw.avatarId.trim()
        ? raw.avatarId.trim()
        : 'default-player').slice(0, 32),
    };
  }

  private normalizeRoomCoordinates(value: unknown): RoomCoordinates | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const raw = value as Partial<RoomCoordinates>;
    const x = raw.x;
    const y = raw.y;
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !Number.isInteger(x) ||
      !Number.isInteger(y)
    ) {
      return null;
    }

    return { x, y };
  }

  private normalizePvpPlayerState(value: unknown, userId: string): PvpMatchPlayerState | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const raw = value as Partial<PvpMatchPlayerState>;
    const matchId = this.normalizeShortId(raw.matchId, 96);
    if (!matchId || !this.isPvpPlayerAnimationState(raw.animationState)) {
      return null;
    }

    const x = this.normalizeFiniteNumber(raw.x, -1_000_000, 1_000_000);
    const y = this.normalizeFiniteNumber(raw.y, -1_000_000, 1_000_000);
    const velocityX = this.normalizeFiniteNumber(raw.velocityX, -2_000, 2_000);
    const velocityY = this.normalizeFiniteNumber(raw.velocityY, -2_000, 2_000);
    const actionUntil = this.normalizeFiniteNumber(raw.actionUntil, 0, Date.now() + 10_000);
    const sequence = this.normalizeFiniteNumber(raw.sequence, 0, Number.MAX_SAFE_INTEGER);
    const sentAt = this.normalizeFiniteNumber(raw.sentAt, 0, Date.now() + 10_000);
    if (
      x === null ||
      y === null ||
      velocityX === null ||
      velocityY === null ||
      actionUntil === null ||
      sequence === null ||
      sentAt === null
    ) {
      return null;
    }

    return {
      matchId,
      userId,
      x,
      y,
      velocityX,
      velocityY,
      facing: raw.facing === -1 ? -1 : 1,
      animationState: raw.animationState,
      action: raw.action === 'sword' || raw.action === 'gun' ? raw.action : null,
      actionUntil,
      sequence: Math.floor(sequence),
      sentAt,
    };
  }

  private normalizePvpCombatEvent(value: unknown, userId: string): PvpMatchCombatEvent | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const raw = value as Partial<PvpMatchCombatEvent>;
    const id = this.normalizeShortId(raw.id, 120);
    const matchId = this.normalizeShortId(raw.matchId, 96);
    if (!id || !matchId || (raw.source !== 'sword' && raw.source !== 'gun')) {
      return null;
    }

    const x = this.normalizeFiniteNumber(raw.x, -1_000_000, 1_000_000);
    const y = this.normalizeFiniteNumber(raw.y, -1_000_000, 1_000_000);
    const startedAt = this.normalizeFiniteNumber(raw.startedAt, 0, Date.now() + 10_000);
    const durationMs = this.normalizeFiniteNumber(raw.durationMs, 16, 2_000);
    if (x === null || y === null || startedAt === null || durationMs === null) {
      return null;
    }

    const rawEffectX = this.normalizeFiniteNumber(raw.effectX, -1_000_000, 1_000_000);
    const rawEffectY = this.normalizeFiniteNumber(raw.effectY, -1_000_000, 1_000_000);
    const effectX = rawEffectX ?? x;
    const effectY = rawEffectY ?? y;
    const projectile = this.normalizePvpProjectile(raw.projectile);
    return {
      id,
      matchId,
      userId,
      source: raw.source,
      x,
      y,
      facing: raw.facing === -1 ? -1 : 1,
      startedAt,
      durationMs,
      effectX,
      effectY,
      downward: raw.downward === true,
      projectile,
    };
  }

  private normalizePvpProjectile(value: unknown): PvpMatchCombatEvent['projectile'] {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const raw = value as NonNullable<PvpMatchCombatEvent['projectile']>;
    const x = this.normalizeFiniteNumber(raw.x, -1_000_000, 1_000_000);
    const y = this.normalizeFiniteNumber(raw.y, -1_000_000, 1_000_000);
    const velocityX = this.normalizeFiniteNumber(raw.velocityX, -2_000, 2_000);
    const lifetimeMs = this.normalizeFiniteNumber(raw.lifetimeMs, 16, 3_000);
    if (x === null || y === null || velocityX === null || lifetimeMs === null) {
      return null;
    }

    return { x, y, velocityX, lifetimeMs };
  }

  private normalizePvpRoomStateEvent(value: unknown, userId: string): PvpRoomStateEvent | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const raw = value as Partial<PvpRoomStateEvent>;
    const id = this.normalizeShortId(raw.id, 120);
    const matchId = this.normalizeShortId(raw.matchId, 96);
    const roomId = this.normalizeShortId(raw.roomId, 80);
    const roomCoordinates = this.normalizeRoomCoordinates(raw.roomCoordinates);
    const sentAt = this.normalizeFiniteNumber(raw.sentAt, 0, Date.now() + 10_000);
    if (!id || !matchId || !roomId || !roomCoordinates || sentAt === null) {
      return null;
    }

    if (raw.kind === 'live-object-removed') {
      const objectKey = this.normalizeShortId(raw.objectKey, 160);
      const objectId = this.normalizeShortId(raw.objectId, 96);
      const instanceId = raw.instanceId === null ? null : this.normalizeShortId(raw.instanceId, 96);
      const x = this.normalizeFiniteNumber(raw.x, -1_000_000, 1_000_000);
      const y = this.normalizeFiniteNumber(raw.y, -1_000_000, 1_000_000);
      const reason =
        raw.reason === 'enemy-defeated' ||
        raw.reason === 'collectible-collected' ||
        raw.reason === 'enemy-collected' ||
        raw.reason === 'object-removed' ||
        raw.reason === 'brick-broken'
          ? raw.reason
          : null;
      if (!objectKey || !objectId || instanceId === undefined || x === null || y === null || !reason) {
        return null;
      }
      return {
        id,
        matchId,
        roomId,
        roomCoordinates,
        kind: 'live-object-removed',
        objectKey,
        objectId,
        instanceId,
        reason,
        x,
        y,
        sentAt,
        userId,
      };
    }

    if (raw.kind === 'room-switch-state') {
      return {
        id,
        matchId,
        roomId,
        roomCoordinates,
        kind: 'room-switch-state',
        active: raw.active === true,
        sentAt,
        userId,
      };
    }

    return null;
  }

  private normalizeFiniteNumber(value: unknown, min: number, max: number): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    return Math.max(min, Math.min(max, value));
  }

  private isPvpPlayerAnimationState(value: unknown): value is PvpMatchPlayerState['animationState'] {
    return (
      value === 'idle' ||
      value === 'run' ||
      value === 'jump-rise' ||
      value === 'jump-fall' ||
      value === 'wall-slide' ||
      value === 'wall-jump' ||
      value === 'land' ||
      value === 'ladder-climb' ||
      value === 'crouch' ||
      value === 'crawl' ||
      value === 'push' ||
      value === 'pull' ||
      value === 'sword-slash' ||
      value === 'air-slash-down' ||
      value === 'gun-fire'
    );
  }

  private normalizeShortId(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim().slice(0, maxLength);
    return normalized.length > 0 ? normalized : null;
  }

  private identityFromState(state: ConnectionPresenceState): PvpParticipantIdentity {
    return {
      userId: state.userId,
      displayName: state.displayName,
      avatarId: state.avatarId,
    };
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

  private normalizeHeartbeatPayload(value: unknown): PartyKitShardHeartbeat | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const payload = value as Partial<PartyKitShardHeartbeat>;
    const updatedAtMs = Date.parse(String(payload.updatedAt ?? ''));
    const totalConnections = payload.totalConnections;
    const playConnections = payload.playConnections;
    const editConnections = payload.editConnections;
    if (
      typeof payload.shardId !== 'string' ||
      !payload.shardId.trim() ||
      payload.shardId === METRICS_ROOM_ID ||
      typeof totalConnections !== 'number' ||
      typeof playConnections !== 'number' ||
      typeof editConnections !== 'number' ||
      !Number.isInteger(totalConnections) ||
      !Number.isInteger(playConnections) ||
      !Number.isInteger(editConnections) ||
      totalConnections < 0 ||
      playConnections < 0 ||
      editConnections < 0 ||
      playConnections + editConnections > totalConnections ||
      !Number.isFinite(updatedAtMs)
    ) {
      return null;
    }

    return {
      shardId: payload.shardId,
      totalConnections,
      playConnections,
      editConnections,
      updatedAt: new Date(updatedAtMs).toISOString(),
    };
  }
}

PresenceServer satisfies Party.Worker;
