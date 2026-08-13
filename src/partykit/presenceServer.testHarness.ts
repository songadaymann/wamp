import type * as Party from 'partykit/server';
import { vi } from 'vitest';
import PresenceServer from '../../partykit/presenceServer';
import {
  createPartykitIdentityToken,
  type PartyKitIdentity,
  type PartyKitIdentityTokenSource,
} from '../presence/identityToken';

const DEFAULT_NOW_MS = Date.UTC(2026, 7, 13, 16, 0, 0);
const DEFAULT_IDENTITY_SECRET = 'presence-server-test-secret';

type ServerConnection = Parameters<PresenceServer['onConnect']>[0];
type ServerConnectionState = ServerConnection['state'];
type ServerRoom = ConstructorParameters<typeof PresenceServer>[0];

export interface FakeConnectionClose {
  code: number | undefined;
  reason: string | undefined;
}

export class FakePresenceStorage {
  private readonly values = new Map<string, unknown>();

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async list<T>(options: { prefix?: string } = {}): Promise<Map<string, T>> {
    const prefix = options.prefix ?? '';
    return new Map(
      Array.from(this.values.entries()).filter(([key]) => key.startsWith(prefix))
    ) as Map<string, T>;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
}

export class FakePresenceConnection {
  readonly sent: string[] = [];
  readonly closes: FakeConnectionClose[] = [];
  private currentState: ServerConnectionState = null;

  constructor(
    readonly id: string,
    readonly uri: string
  ) {}

  get state(): ServerConnectionState {
    return this.currentState;
  }

  send(message: string | ArrayBuffer | ArrayBufferView): void {
    this.sent.push(String(message));
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
  }

  setState(
    next:
      | Exclude<ServerConnectionState, null>
      | ((previous: ServerConnectionState) => Exclude<ServerConnectionState, null>)
      | null
  ): ServerConnectionState {
    this.currentState =
      typeof next === 'function'
        ? (next as (previous: ServerConnectionState) => Exclude<ServerConnectionState, null>)(
            this.currentState
          )
        : next;
    return this.currentState;
  }

  messages<T = Record<string, unknown>>(): T[] {
    return this.sent.map((message) => JSON.parse(message) as T);
  }

  clearMessages(): void {
    this.sent.length = 0;
  }

  asPartyConnection(): ServerConnection {
    return this as unknown as ServerConnection;
  }
}

export class FakePresenceRoom {
  readonly storage = new FakePresenceStorage();
  readonly connections = new Map<string, ServerConnection>();
  readonly metricsRequests: Array<{ path: string; init: RequestInit | undefined }> = [];
  readonly env: Record<string, unknown>;

  constructor(
    readonly id = 'world-shard-1',
    readonly name = 'main',
    env: Record<string, unknown> = {}
  ) {
    this.env = {
      PARTYKIT_IDENTITY_TOKEN_SECRET: DEFAULT_IDENTITY_SECRET,
      ...env,
    };
  }

  addConnection(connection: FakePresenceConnection): void {
    this.connections.set(connection.id, connection.asPartyConnection());
  }

  removeConnection(connection: FakePresenceConnection): void {
    this.connections.delete(connection.id);
  }

  getConnection<TState = unknown>(id: string): Party.Connection<TState> | undefined {
    return this.connections.get(id) as Party.Connection<TState> | undefined;
  }

  getConnections<TState = unknown>(): Iterable<Party.Connection<TState>> {
    return this.connections.values() as Iterable<Party.Connection<TState>>;
  }

  asPartyRoom(): ServerRoom {
    const room = {
      id: this.id,
      internalID: `internal-${this.id}`,
      name: this.name,
      env: this.env,
      storage: this.storage,
      blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback(),
      context: {
        parties: {
          [this.name]: {
            get: () => ({
              fetch: async (path: string, init?: RequestInit) => {
                this.metricsRequests.push({ path, init });
                return new Response(null, { status: 204 });
              },
            }),
          },
        },
        ai: {},
        vectorize: {},
        assets: {
          fetch: async () => null,
        },
        bindings: {
          r2: {},
          kv: {},
        },
      },
      parties: {},
      connections: this.connections,
      broadcast: () => undefined,
      getConnection: <TState = unknown>(connectionId: string) =>
        this.getConnection<TState>(connectionId),
      getConnections: <TState = unknown>() => this.getConnections<TState>(),
      analytics: {},
    };

    return room as unknown as ServerRoom;
  }
}

export interface ConnectOptions {
  channel?: string;
  identity?: PartyKitIdentity;
  source?: PartyKitIdentityTokenSource;
  token?: string;
}

export class PresenceServerHarness {
  readonly room: FakePresenceRoom;
  readonly server: PresenceServer;

  constructor(options: { roomId?: string; env?: Record<string, unknown>; nowMs?: number } = {}) {
    vi.useFakeTimers();
    vi.setSystemTime(options.nowMs ?? DEFAULT_NOW_MS);
    this.room = new FakePresenceRoom(options.roomId, 'main', options.env);
    this.server = new PresenceServer(this.room.asPartyRoom());
  }

  async connect(id: string, options: ConnectOptions = {}): Promise<FakePresenceConnection> {
    const identity = options.identity ?? testIdentity(id);
    const token =
      options.token ??
      (await createTestIdentityToken(identity, options.source ?? 'auth', this.identitySecret));
    const url = new URL(`https://presence.example.test/parties/main/${this.room.id}`);
    url.searchParams.set('identityToken', token);
    if (options.channel !== undefined) {
      url.searchParams.set('channel', options.channel);
    }

    const connection = new FakePresenceConnection(id, url.toString());
    this.room.addConnection(connection);
    await this.server.onConnect(connection.asPartyConnection(), {
      request: new Request(url) as unknown as Party.Request,
    });
    return connection;
  }

  async advance(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
  }

  close(connection: FakePresenceConnection): void {
    // PartyKit removes closed sockets from getConnections() before invoking onClose.
    this.room.removeConnection(connection);
    this.server.onClose(connection.asPartyConnection());
  }

  dispose(): void {
    vi.clearAllTimers();
    vi.useRealTimers();
  }

  private get identitySecret(): string {
    return String(this.room.env.PARTYKIT_IDENTITY_TOKEN_SECRET ?? DEFAULT_IDENTITY_SECRET);
  }
}

export function testIdentity(id: string): PartyKitIdentity {
  return {
    userId: `user-${id}`,
    displayName: `Player ${id}`,
    avatarId: `avatar-${id}`,
  };
}

export async function createTestIdentityToken(
  identity: PartyKitIdentity,
  source: PartyKitIdentityTokenSource = 'auth',
  secret = DEFAULT_IDENTITY_SECRET
): Promise<string> {
  const { token } = await createPartykitIdentityToken(identity, source, secret, {
    nowMs: Date.now(),
    nonce: `nonce-${identity.userId}`,
  });
  return token;
}

export function presencePayload(input: {
  roomX?: number;
  roomY?: number;
  x?: number;
  y?: number;
  mode?: 'browse' | 'play' | 'edit';
  timestamp?: number;
  pvp?: { matchId: string; action: 'sword' | 'gun' | null; actionUntil: number } | null;
} = {}): Record<string, unknown> {
  return {
    roomCoordinates: {
      x: input.roomX ?? 1,
      y: input.roomY ?? 2,
    },
    x: input.x ?? 10,
    y: input.y ?? 20,
    velocityX: 0,
    velocityY: 0,
    facing: 1,
    animationState: 'idle',
    mode: input.mode ?? 'play',
    pvp: input.pvp ?? null,
    timestamp: input.timestamp ?? Date.now(),
  };
}

export function sendPresence(
  harness: PresenceServerHarness,
  connection: FakePresenceConnection,
  presence: Record<string, unknown>
): void {
  harness.server.onMessage(
    JSON.stringify({
      type: 'presence:update',
      presence,
    }),
    connection.asPartyConnection()
  );
}

export function messageTypes(connection: FakePresenceConnection): string[] {
  return connection.messages<{ type?: string }>().map((message) => message.type ?? '');
}
