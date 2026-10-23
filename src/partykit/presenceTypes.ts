/**
 * The PartyKit-shaped surface the presence core (partykit/presenceServer.ts) is written against.
 * Production runs the core inside PresenceDurableObject (src/cloudflare/presence/durableObject.ts),
 * which builds these objects from Cloudflare's Durable Object and hibernating WebSocket APIs.
 * Names follow the retired `partykit/server` types, narrowed to the members the core uses.
 */

export type Request = globalThis.Request;

/** What the static pre-connect gate sees: the Worker's env. */
export interface Lobby { readonly env: Record<string, unknown> }

/** The Durable Object storage calls the core makes; alarms drive heartbeats and PvP deadlines. */
interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

type Immutable<T> = T extends undefined | null | boolean | string | number ? T
  : T extends Array<infer U> ? ReadonlyArray<Immutable<U>>
  : T extends Map<infer K, infer V> ? ReadonlyMap<Immutable<K>, Immutable<V>>
  : T extends Set<infer M> ? ReadonlySet<Immutable<M>>
  : { readonly [K in keyof T]: Immutable<T[K]> };

/** Read-only so the core can't edit it in place: only setState() survives hibernation. */
type ConnectionState<T> = { readonly [K in keyof T]: Immutable<T[K]> } | null;

export interface Connection<TState = unknown> {
  readonly id: string;
  readonly readyState: number;
  readonly state: ConnectionState<TState>;
  setState(state: TState | ((previous: ConnectionState<TState>) => TState) | null): ConnectionState<TState>;
  send(message: string | ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

export interface ConnectionContext { readonly request: Request }

/** One presence room, addressed as /parties/:name/:id. */
export interface Room {
  readonly id: string;
  readonly name: string;
  readonly env: Record<string, unknown>;
  readonly storage: Storage;
  /** Reaches another room of the same namespace, e.g. a shard posting heartbeats to the metrics room. */
  readonly context: {
    readonly parties: Record<string, { get(id: string): { fetch(path: string, init?: RequestInit): Promise<Response> } }>;
  };
  getConnections<TState = unknown>(): Iterable<Connection<TState>>;
}

/** PartyKit's hibernation flag. PresenceDurableObject always hibernates (acceptWebSocket) and ignores it. */
export interface ServerOptions { hibernate?: boolean }

/** The per-room lifecycle PresenceDurableObject drives. As in PartyKit, every hook is optional. */
export interface Server {
  readonly options?: ServerOptions;
  onStart?(): void | Promise<void>;
  onConnect?(connection: Connection, ctx: ConnectionContext): void | Promise<void>;
  onMessage?(message: string, sender: Connection): void | Promise<void>;
  onClose?(connection: Connection): void | Promise<void>;
  onRequest?(req: Request): Response | Promise<Response>;
  onAlarm?(): void | Promise<void>;
}

/** The server class: one instance per room, plus the static identity gate run before a socket is accepted. */
export interface Worker {
  new (room: Room): Server;
  onBeforeConnect?(req: Request, lobby: Lobby): Promise<Request | Response>;
}
