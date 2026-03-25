import type * as Party from 'partykit/server';
import type { PartyKitLaunchStats, PartyKitShardHeartbeat } from '../src/admin/model';
import {
  isPresenceClientMessage,
  isWorldPresencePayload,
  type PresenceClientMessage as IncomingMessage,
  type PresencePopulationsMessage,
  type PresenceRemoveMessage,
  type PresenceSnapshotMessage,
  type PresenceUpsertMessage,
  type WorldGhostPresence,
  type WorldPresencePayload as PresencePayload,
} from '../src/presence/protocol';

const HEARTBEAT_INTERVAL_MS = 15_000;
const STALE_HEARTBEAT_MS = 120_000;
const INTERNAL_TOKEN_HEADER = 'x-partykit-internal-token';
const METRICS_ROOM_ID = '__launch-stats__';
const METRICS_STORAGE_PREFIX = 'shard:';

interface ConnectionPresenceState {
  userId: string;
  displayName: string;
  avatarId: string;
  presence: PresencePayload | null;
}

interface HeartbeatMutationResponse {
  ok: true;
}

export default class PresenceServer implements Party.Server {
  static onBeforeConnect(req: Party.Request): Party.Request | Response {
    const url = new URL(req.url);
    if (url.pathname.includes(`/${METRICS_ROOM_ID}`)) {
      return new Response('Metrics room does not accept WebSocket connections.', {
        status: 400,
      });
    }

    if (!url.searchParams.get('userId') || !url.searchParams.get('displayName')) {
      return new Response('Missing presence identity.', { status: 400 });
    }

    return req;
  }

  readonly options = {
    hibernate: true,
  } satisfies Party.ServerOptions;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatAt = 0;

  constructor(readonly room: Party.Room) {
    this.syncHeartbeatTimer();
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

  onConnect(
    connection: Party.Connection<ConnectionPresenceState>,
    ctx: Party.ConnectionContext
  ): void {
    const identity = this.parseIdentity(ctx.request.url);
    connection.setState({
      ...identity,
      presence: null,
    });

    connection.send(
      JSON.stringify({
        type: 'snapshot',
        peers: this.listPeers(connection.id),
        roomPopulations: this.computeRoomPopulations(),
        roomEditors: this.computeRoomEditors(),
      } satisfies PresenceSnapshotMessage)
    );

    this.broadcastPopulations();
    this.syncHeartbeatTimer();
    void this.maybeSendShardHeartbeat(true);
  }

  onMessage(message: string, sender: Party.Connection<ConnectionPresenceState>): void {
    let parsed: IncomingMessage | null = null;

    try {
      const candidate = JSON.parse(message) as unknown;
      if (!isPresenceClientMessage(candidate)) {
        return;
      }
      parsed = candidate;
    } catch {
      return;
    }

    if (parsed.type === 'presence:leave') {
      this.clearPresence(sender);
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
    const presence = this.normalizePresencePayload(parsed.presence);
    if (!presence) {
      return;
    }

    sender.setState({
      ...current,
      presence,
    });

    if (previousPresence?.mode === 'play' && presence.mode !== 'play') {
      this.room.broadcast(
        JSON.stringify({
          type: 'remove',
          connectionId: sender.id,
        } satisfies PresenceRemoveMessage),
        [sender.id]
      );
    }

    const peer = this.toGhostPresence(sender);
    if (peer) {
      this.room.broadcast(
        JSON.stringify({
          type: 'upsert',
          peer,
        } satisfies PresenceUpsertMessage),
        [sender.id]
      );
    }

    const shouldBroadcast = this.shouldBroadcastPopulations(previousPresence, presence);
    if (shouldBroadcast) {
      this.broadcastPopulations();
      void this.maybeSendShardHeartbeat(true);
    }
  }

  onClose(connection: Party.Connection<ConnectionPresenceState>): void {
    const presence = connection.state?.presence;
    if (presence?.mode === 'play') {
      this.room.broadcast(
        JSON.stringify({
          type: 'remove',
          connectionId: connection.id,
        } satisfies PresenceRemoveMessage)
      );
    }

    this.broadcastPopulations();
    this.syncHeartbeatTimer();
    void this.maybeSendShardHeartbeat(true);
  }

  private clearPresence(connection: Party.Connection<ConnectionPresenceState>): void {
    const current = connection.state;
    const previousPresence = current?.presence ?? null;
    if (!previousPresence) {
      connection.setState(
        current
          ? {
              ...current,
              presence: null,
            }
          : null
      );
      return;
    }

    if (!current) {
      return;
    }

    connection.setState({
      ...current,
      presence: null,
    });

    if (previousPresence.mode === 'play') {
      this.room.broadcast(
        JSON.stringify({
          type: 'remove',
          connectionId: connection.id,
        } satisfies PresenceRemoveMessage),
        [connection.id]
      );
    }

    if (this.shouldBroadcastPopulations(previousPresence, null)) {
      this.broadcastPopulations();
      void this.maybeSendShardHeartbeat(true);
    }
  }

  private listPeers(excludeConnectionId: string | null): WorldGhostPresence[] {
    const peers: WorldGhostPresence[] = [];

    for (const connection of this.room.getConnections<ConnectionPresenceState>()) {
      if (excludeConnectionId && connection.id === excludeConnectionId) {
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
      const peer = this.toGhostPresence(connection);
      if (!peer) {
        continue;
      }

      counts.set(peer.roomId, (counts.get(peer.roomId) ?? 0) + 1);
    }

    return Object.fromEntries(
      Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right))
    );
  }

  private computeRoomEditors(): Record<string, number> {
    const counts = new Map<string, number>();

    for (const connection of this.room.getConnections<ConnectionPresenceState>()) {
      const presence = connection.state?.presence;
      if (!presence || presence.mode !== 'edit') {
        continue;
      }

      const roomId = `${presence.roomCoordinates.x},${presence.roomCoordinates.y}`;
      counts.set(roomId, (counts.get(roomId) ?? 0) + 1);
    }

    return Object.fromEntries(
      Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right))
    );
  }

  private broadcastPopulations(): void {
    this.room.broadcast(
      JSON.stringify({
        type: 'populations',
        roomPopulations: this.computeRoomPopulations(),
        roomEditors: this.computeRoomEditors(),
      } satisfies PresencePopulationsMessage)
    );
  }

  private toGhostPresence(
    connection: Party.Connection<ConnectionPresenceState>
  ): WorldGhostPresence | null {
    const state = connection.state;
    if (!state?.presence || state.presence.mode !== 'play') {
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

  private getRoomId(roomCoordinates: PresencePayload['roomCoordinates']): string {
    return `${roomCoordinates.x},${roomCoordinates.y}`;
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

    const hasConnections = this.hasAnyConnections();
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

  private hasAnyConnections(): boolean {
    return this.room.getConnections<ConnectionPresenceState>()[Symbol.iterator]().next().done === false;
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

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'content-type': 'application/json',
      },
    });
  }

  private parseIdentity(urlString: string): Omit<ConnectionPresenceState, 'presence'> {
    const url = new URL(urlString);
    const userId = (url.searchParams.get('userId') ?? '').trim() || crypto.randomUUID();
    const displayName = (url.searchParams.get('displayName') ?? '').trim() || 'Guest';
    const avatarId = (url.searchParams.get('avatarId') ?? '').trim() || 'default-player';

    return {
      userId,
      displayName: displayName.slice(0, 32),
      avatarId: avatarId.slice(0, 32),
    };
  }

  private normalizePresencePayload(value: unknown): PresencePayload | null {
    if (!isWorldPresencePayload(value)) {
      return null;
    }

    return {
      roomCoordinates: {
        x: value.roomCoordinates.x,
        y: value.roomCoordinates.y,
      },
      x: value.x,
      y: value.y,
      velocityX: value.velocityX,
      velocityY: value.velocityY,
      facing: value.facing < 0 ? -1 : 1,
      animationState: value.animationState,
      mode: value.mode,
      timestamp: value.timestamp,
    };
  }

  private normalizeHeartbeatPayload(value: unknown): PartyKitShardHeartbeat | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const payload = value as Partial<PartyKitShardHeartbeat>;
    const totalConnections = payload.totalConnections;
    const playConnections = payload.playConnections;
    const editConnections = payload.editConnections;
    const updatedAtMs = Date.parse(String(payload.updatedAt ?? ''));
    if (
      typeof totalConnections !== 'number' ||
      typeof playConnections !== 'number' ||
      typeof editConnections !== 'number'
    ) {
      return null;
    }

    if (
      typeof payload.shardId !== 'string' ||
      !payload.shardId.trim() ||
      payload.shardId === METRICS_ROOM_ID ||
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

    const normalizedTotalConnections = totalConnections as number;
    const normalizedPlayConnections = playConnections as number;
    const normalizedEditConnections = editConnections as number;

    return {
      shardId: payload.shardId,
      totalConnections: normalizedTotalConnections,
      playConnections: normalizedPlayConnections,
      editConnections: normalizedEditConnections,
      updatedAt: new Date(updatedAtMs).toISOString(),
    };
  }
}

PresenceServer satisfies Party.Worker;
