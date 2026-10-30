import type * as Party from '../../partykit/presenceTypes';
import type { DurableObjectState, DurableObjectNamespace, Request as WorkerRequest, WebSocket as WorkerWebSocket } from '@cloudflare/workers-types';
import PresenceServer from '../../../partykit/presenceServer';
import type { ConnectionPresenceState } from '../../partykit/presenceProtocol';
import { METRICS_ROOM_ID } from '../../partykit/shardMetricsRuntime';
import type { Env } from '../worker/core/types';
import { recordPvpMatchResult } from '../worker/pvp/store';

declare const WebSocketPair: new () => { 0: WorkerWebSocket; 1: WorkerWebSocket };
const NAME_KEY = '__wamp_presence_room';
const MAX_MESSAGE_BYTES = 1_048_576;
interface Attachment { id: string; uri: string; state: ConnectionPresenceState | null }

/** Only the socket surface used by the existing, independently tested presence server. */
class PresenceConnection {
  private attachment: Attachment;
  constructor(private readonly socket: WorkerWebSocket) {
    this.attachment = socket.deserializeAttachment() as Attachment;
  }
  get id(): string { return this.attachment.id; }
  get uri(): string { return this.attachment.uri; }
  get state(): ConnectionPresenceState | null { return this.attachment.state; }
  get readyState(): number { return this.socket.readyState; }
  send(message: string | ArrayBuffer | ArrayBufferView): void { this.socket.send(message); }
  close(code?: number, reason?: string): void { this.socket.close(code, reason); }
  setState(next: ConnectionPresenceState | null | ((previous: ConnectionPresenceState | null) => ConnectionPresenceState | null)): ConnectionPresenceState | null {
    const state = typeof next === 'function' ? next(this.state) : next;
    this.attachment = { ...this.attachment, state };
    this.socket.serializeAttachment(this.attachment);
    return state;
  }
  asConnection(): Party.Connection<ConnectionPresenceState> {
    // Party.Connection (src/partykit/presenceTypes.ts) declares only the surface above.
    return this as unknown as Party.Connection<ConnectionPresenceState>;
  }
}

export function presenceRoomFromUrl(url: URL): string | null {
  const match = /^\/parties\/main\/([^/]+)(?:\/.*)?$/.exec(url.pathname);
  if (!match) return null;
  try {
    const name = decodeURIComponent(match[1]);
    return name.length > 0 && name.length <= 160 && !/[\/\u0000-\u001f]/.test(name) ? name : null;
  } catch { return null; }
}

export async function handleCloudflarePresence(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url), name = presenceRoomFromUrl(url);
  if (!name) return new Response('Not found.', { status: 404 });
  const upgrade = request.method === 'GET' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
  if (upgrade) {
    const checked = await PresenceServer.onBeforeConnect(request as unknown as Party.Request, { env } as unknown as Party.Lobby);
    if (checked instanceof Response) return checked;
  } else if (name !== METRICS_ROOM_ID) {
    return new Response('Not found.', { status: 404 });
  } else {
    const token = env.PARTYKIT_INTERNAL_TOKEN?.trim();
    if (!token || request.headers.get('x-partykit-internal-token') !== token) return new Response('Forbidden.', { status: 403 });
  }
  if (!env.PRESENCE_ROOMS) return new Response('Presence is not configured.', { status: 503 });
  return env.PRESENCE_ROOMS.get(env.PRESENCE_ROOMS.idFromName(name)).fetch(request as unknown as WorkerRequest) as unknown as Promise<Response>;
}

/** PartyKit-compatible lifecycle backed directly by Cloudflare's hibernating WebSocket API.
 * Canonical rooms/runs stay in D1; this namespace holds only short-lived previews and metrics.
 */
export class PresenceDurableObject {
  private roomName = '';
  private readonly core: PresenceServer;
  private readonly ready: Promise<void>;
  private readonly connections = new WeakMap<WorkerWebSocket, PresenceConnection>();
  private readonly closed = new WeakSet<WorkerWebSocket>();

  constructor(private readonly ctx: DurableObjectState, private readonly env: Env) {
    const owner = this;
    const room = {
      get id() { return owner.roomName; },
      name: 'main', env,
      storage: ctx.storage,
      getConnections: () => owner.liveConnections(),
      getConnection: (id: string) => owner.liveConnections().find(connection => connection.id === id),
      context: { parties: { main: { get: (id: string) => ({ fetch: (path: string, init?: RequestInit) => {
        const namespace = env.PRESENCE_ROOMS as DurableObjectNamespace;
        return namespace.get(namespace.idFromName(id)).fetch(
          new Request(`https://presence.internal/parties/main/${encodeURIComponent(id)}${path}`, init) as never
        );
      } }) } } },
    };
    // This explicit compatibility boundary reuses the full auth/chat/preview/PvP implementation.
    this.core = new PresenceServer(room as unknown as Party.Room, {
      waitUntil: (work) => ctx.waitUntil(work),
      // PvP results are saved from the room's finished match, never from what a browser reports.
      recordPvpResult: async (snapshot) => { if (env.DB) await recordPvpMatchResult(env, snapshot); },
    });
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.roomName = await ctx.storage.get<string>(NAME_KEY) ?? '';
      if (this.roomName) await this.core.onStart();
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const name = presenceRoomFromUrl(new URL(request.url));
    if (!name || (this.roomName && name !== this.roomName)) return new Response('Not found.', { status: 404 });
    if (!this.roomName) {
      await this.ctx.storage.put(NAME_KEY, name);
      this.roomName = name;
      await this.core.onStart();
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return this.core.onRequest(request as unknown as Party.Request);
    // Recheck before accepting: direct namespace calls must obey the same signed-identity gate.
    const checked = await PresenceServer.onBeforeConnect(request as unknown as Party.Request, { env: this.env } as unknown as Party.Lobby);
    if (checked instanceof Response) return checked;
    const pair = new WebSocketPair(), client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID(), uri: request.url, state: null } satisfies Attachment);
    await this.core.onConnect(this.connection(server), { request: request as unknown as Party.Request });
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  async alarm(): Promise<void> {
    await this.ready;
    await this.core.onAlarm();
  }

  async webSocketMessage(socket: WorkerWebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ready;
    if (typeof message !== 'string' || this.closed.has(socket)) return;
    if (message.length > MAX_MESSAGE_BYTES || new TextEncoder().encode(message).byteLength > MAX_MESSAGE_BYTES) {
      socket.close(1009, 'presence-message-too-large');
      return;
    }
    this.core.onMessage(message, this.connection(socket));
  }

  async webSocketClose(socket: WorkerWebSocket): Promise<void> {
    await this.ready;
    if (this.closed.has(socket)) return;
    this.closed.add(socket);
    this.core.onClose(this.connection(socket));
  }

  async webSocketError(socket: WorkerWebSocket): Promise<void> {
    socket.close(1011, 'presence-socket-error');
    await this.webSocketClose(socket);
  }

  private connection(socket: WorkerWebSocket): Party.Connection<ConnectionPresenceState> {
    let connection = this.connections.get(socket);
    if (!connection) { connection = new PresenceConnection(socket); this.connections.set(socket, connection); }
    return connection.asConnection();
  }

  private liveConnections(): Party.Connection<ConnectionPresenceState>[] {
    return this.ctx.getWebSockets().filter(socket => socket.readyState === 1 && !this.closed.has(socket)).map(socket => this.connection(socket));
  }
}
