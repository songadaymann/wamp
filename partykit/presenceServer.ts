import type * as Party from 'partykit/server';

type PresenceMode = 'browse' | 'play' | 'edit';
type PresenceAnimationState =
  | 'idle'
  | 'run'
  | 'jump-rise'
  | 'jump-fall'
  | 'land'
  | 'ladder-climb';

interface RoomCoordinates {
  x: number;
  y: number;
}

interface PresencePayload {
  roomCoordinates: RoomCoordinates;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  facing: number;
  animationState: PresenceAnimationState;
  mode: PresenceMode;
  timestamp: number;
}

interface ConnectionPresenceState {
  userId: string;
  displayName: string;
  avatarId: string;
  presence: PresencePayload | null;
}

interface WorldGhostPresence extends PresencePayload {
  connectionId: string;
  userId: string;
  displayName: string;
  avatarId: string;
  shardId: string;
  roomId: string;
}

type IncomingMessage =
  | {
      type: 'presence:update';
      presence: PresencePayload;
    }
  | {
      type: 'presence:leave';
    };

export default class PresenceServer implements Party.Server {
  static onBeforeConnect(req: Party.Request): Party.Request | Response {
    const url = new URL(req.url);
    if (!url.searchParams.get('userId') || !url.searchParams.get('displayName')) {
      return new Response('Missing presence identity.', { status: 400 });
    }

    return req;
  }

  readonly options = {
    hibernate: true,
  } satisfies Party.ServerOptions;

  constructor(readonly room: Party.Room) {}

  onConnect(connection: Party.Connection<ConnectionPresenceState>, ctx: Party.ConnectionContext): void {
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
      })
    );
  }

  onMessage(message: string, sender: Party.Connection<ConnectionPresenceState>): void {
    let parsed: IncomingMessage | null = null;

    try {
      parsed = JSON.parse(message) as IncomingMessage;
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
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

    const previousMode = current.presence?.mode ?? null;
    const presence = this.normalizePresencePayload(parsed.presence);
    if (!presence) {
      return;
    }

    sender.setState({
      ...current,
      presence,
    });

    if (previousMode === 'play' && presence.mode !== 'play') {
      this.room.broadcast(
        JSON.stringify({
          type: 'remove',
          connectionId: sender.id,
        }),
        [sender.id]
      );
    }

    const peer = this.toGhostPresence(sender);
    if (peer) {
      this.room.broadcast(
        JSON.stringify({
          type: 'upsert',
          peer,
        }),
        [sender.id]
      );
    }

    this.broadcastPopulations();
  }

  onClose(connection: Party.Connection<ConnectionPresenceState>): void {
    const presence = connection.state?.presence;
    if (!presence) {
      return;
    }

    if (presence.mode === 'play') {
      this.room.broadcast(
        JSON.stringify({
          type: 'remove',
          connectionId: connection.id,
        })
      );
    }
    this.broadcastPopulations();
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

    connection.setState({
      ...current,
      presence: null,
    });

    if (previousPresence.mode === 'play') {
      this.room.broadcast(
        JSON.stringify({
          type: 'remove',
          connectionId: connection.id,
        }),
        [connection.id]
      );
    }
    this.broadcastPopulations();
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
      })
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
    if (!value || typeof value !== 'object') {
      return null;
    }

    const payload = value as Partial<PresencePayload>;
    if (
      !payload.roomCoordinates ||
      !Number.isInteger(payload.roomCoordinates.x) ||
      !Number.isInteger(payload.roomCoordinates.y) ||
      typeof payload.x !== 'number' ||
      typeof payload.y !== 'number' ||
      typeof payload.velocityX !== 'number' ||
      typeof payload.velocityY !== 'number' ||
      typeof payload.facing !== 'number' ||
      typeof payload.timestamp !== 'number'
    ) {
      return null;
    }

    const animationState = payload.animationState;
    if (
      animationState !== 'idle' &&
      animationState !== 'run' &&
      animationState !== 'jump-rise' &&
      animationState !== 'jump-fall' &&
      animationState !== 'land' &&
      animationState !== 'ladder-climb'
    ) {
      return null;
    }

    if (payload.mode !== 'browse' && payload.mode !== 'play' && payload.mode !== 'edit') {
      return null;
    }

    return {
      roomCoordinates: {
        x: payload.roomCoordinates.x,
        y: payload.roomCoordinates.y,
      },
      x: payload.x,
      y: payload.y,
      velocityX: payload.velocityX,
      velocityY: payload.velocityY,
      facing: payload.facing < 0 ? -1 : 1,
      animationState,
      mode: payload.mode,
      timestamp: payload.timestamp,
    };
  }
}

PresenceServer satisfies Party.Worker;
