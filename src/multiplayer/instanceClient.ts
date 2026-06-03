import PartySocket from 'partysocket';
import { PartyKitIdentityTokenProvider } from '../presence/identityTokenClient';
import { resolveWorldPresenceConfig } from '../presence/worldPresence';
import type {
  MultiplayerHitSource,
  MultiplayerInstanceClientMessage,
  MultiplayerInstanceCombatEvent,
  MultiplayerInstancePlayerState,
  MultiplayerInstanceServerMessage,
  MultiplayerInstanceSnapshot,
  MultiplayerModeId,
  MultiplayerParticipantIdentity,
  MultiplayerRoomStateEvent,
  MultiplayerRoomStateEventPayload,
} from './model';

export interface MultiplayerInstanceClientOptions {
  matchId: string;
  mode: MultiplayerModeId;
  roomId: string;
  roomCoordinates: { x: number; y: number };
  localIdentity: MultiplayerParticipantIdentity;
  opponentIdentity: MultiplayerParticipantIdentity;
  onSnapshot: (snapshot: MultiplayerInstanceSnapshot) => void;
  onPeerState?: (state: MultiplayerInstancePlayerState) => void;
  onPeerCombatEvent?: (event: MultiplayerInstanceCombatEvent) => void;
  onPeerRoomStateEvent?: (event: MultiplayerRoomStateEvent) => void;
  onStatus?: (message: string) => void;
}

export class MultiplayerInstanceClient {
  private socket: PartySocket | null = null;
  private lastSnapshot: MultiplayerInstanceSnapshot | null = null;
  private pendingMessages: MultiplayerInstanceClientMessage[] = [];
  private readonly closingSockets = new WeakSet<PartySocket>();
  private connectAttemptId = 0;

  constructor(private readonly options: MultiplayerInstanceClientOptions) {}

  connect(): boolean {
    const config = resolveWorldPresenceConfig();
    if (!config) {
      this.options.onStatus?.('PVP is unavailable right now.');
      return false;
    }

    this.disconnect();
    const attemptId = this.connectAttemptId + 1;
    this.connectAttemptId = attemptId;
    this.pendingMessages = [];
    void this.openSocket(config, attemptId);

    return true;
  }

  private async openSocket(
    config: NonNullable<ReturnType<typeof resolveWorldPresenceConfig>>,
    attemptId: number
  ): Promise<void> {
    const tokenProvider = new PartyKitIdentityTokenProvider(() => this.options.localIdentity);
    let identityToken: string;
    try {
      identityToken = await tokenProvider.getToken();
    } catch (error) {
      if (this.connectAttemptId === attemptId) {
        this.options.onStatus?.('PVP identity token unavailable.');
      }
      console.warn('Failed to issue PartyKit PVP identity token.', error);
      return;
    }

    if (this.connectAttemptId !== attemptId) {
      return;
    }

    const socket = new PartySocket({
      host: config.host,
      protocol: config.protocol,
      party: config.party,
      room: `pvp:${this.options.matchId}`,
      query: {
        identityToken,
      },
    });
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        return;
      }

      this.send({
        type: 'pvp:match:configure',
        matchId: this.options.matchId,
        mode: this.options.mode,
        roomId: this.options.roomId,
        roomCoordinates: { ...this.options.roomCoordinates },
        participants: [
          this.options.localIdentity,
          this.options.opponentIdentity,
        ],
      });
      this.flushPendingMessages();
    });

    socket.addEventListener('message', (event: MessageEvent) => {
      if (this.socket !== socket) {
        return;
      }

      if (typeof event.data !== 'string') {
        return;
      }

      this.handleMessage(event.data);
    });

    socket.addEventListener('close', () => {
      const wasClosing = this.closingSockets.has(socket);
      const wasActiveSocket = this.socket === socket;
      this.closingSockets.delete(socket);
      if (wasActiveSocket) {
        this.socket = null;
      }
      if (!wasClosing) {
        this.options.onStatus?.('PVP match disconnected.');
      }
    });
  }

  disconnect(): void {
    this.connectAttemptId += 1;
    const socket = this.socket;
    if (!socket) {
      this.pendingMessages = [];
      return;
    }

    if (socket.readyState === PartySocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: 'pvp:match:leave' } satisfies MultiplayerInstanceClientMessage));
      } catch {
        // Closing an already-failing socket should still let local cleanup continue.
      }
    }
    this.closingSockets.add(socket);
    this.socket = null;
    this.pendingMessages = [];

    const closeSocket = () => {
      if (socket.readyState === PartySocket.CLOSED || socket.readyState === PartySocket.CLOSING) {
        return;
      }
      socket.close(1000, 'pvp-client-disconnect');
    };

    if (socket.readyState === PartySocket.OPEN) {
      setTimeout(closeSocket, 75);
      return;
    }

    closeSocket();
  }

  reportHit(
    targetUserId: string,
    source: Exclude<MultiplayerHitSource, 'environment'>,
    hitId: string,
  ): boolean {
    return this.send({
      type: 'pvp:match:hit',
      targetUserId,
      source,
      hitId,
    });
  }

  reportSelfDeath(source: MultiplayerHitSource, hitId: string): boolean {
    return this.send({
      type: 'pvp:match:self-death',
      source,
      hitId,
    });
  }

  reportReceivedHit(
    attackerUserId: string,
    source: Exclude<MultiplayerHitSource, 'environment'>,
    hitId: string,
  ): boolean {
    return this.send({
      type: 'pvp:match:received-hit',
      attackerUserId,
      source,
      hitId,
    });
  }

  sendPlayerState(state: Omit<MultiplayerInstancePlayerState, 'userId'>): boolean {
    return this.send({
      type: 'pvp:match:player-state',
      state,
    });
  }

  sendCombatEvent(event: Omit<MultiplayerInstanceCombatEvent, 'userId'>): boolean {
    return this.send({
      type: 'pvp:match:combat-event',
      event,
    });
  }

  sendRoomStateEvent(event: MultiplayerRoomStateEventPayload): boolean {
    return this.send({
      type: 'pvp:match:room-state-event',
      event,
    });
  }

  getSnapshot(): MultiplayerInstanceSnapshot | null {
    return this.lastSnapshot;
  }

  getDebugState(): Record<string, unknown> {
    return {
      matchId: this.options.matchId,
      readyState: this.socket?.readyState ?? null,
      pendingMessageCount: this.pendingMessages.length,
      hasSnapshot: Boolean(this.lastSnapshot),
      lastSnapshotStatus: this.lastSnapshot?.status ?? null,
    };
  }

  private send(message: MultiplayerInstanceClientMessage): boolean {
    if (!this.socket) {
      return false;
    }

    if (this.socket.readyState === PartySocket.CONNECTING) {
      this.pendingMessages.push(message);
      if (this.pendingMessages.length > 24) {
        this.pendingMessages.shift();
      }
      return true;
    }

    if (this.socket.readyState !== PartySocket.OPEN) {
      return false;
    }

    this.socket.send(JSON.stringify(message));
    return true;
  }

  private flushPendingMessages(): void {
    if (!this.socket || this.socket.readyState !== PartySocket.OPEN || this.pendingMessages.length === 0) {
      return;
    }

    const messages = this.pendingMessages.splice(0);
    for (const message of messages) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private handleMessage(rawMessage: string): void {
    let message: MultiplayerInstanceServerMessage | null = null;
    try {
      message = JSON.parse(rawMessage) as MultiplayerInstanceServerMessage;
    } catch {
      return;
    }

    if (message?.type === 'pvp:match:snapshot') {
      this.lastSnapshot = message.snapshot;
      this.options.onSnapshot(message.snapshot);
      return;
    }

    if (message?.type === 'pvp:match:peer-state') {
      this.options.onPeerState?.(message.state);
      return;
    }

    if (message?.type === 'pvp:match:peer-combat-event') {
      this.options.onPeerCombatEvent?.(message.event);
      return;
    }

    if (message?.type === 'pvp:match:peer-room-state-event') {
      this.options.onPeerRoomStateEvent?.(message.event);
    }
  }
}
