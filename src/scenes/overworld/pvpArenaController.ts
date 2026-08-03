import {
  type PvpInviteOffer,
  type PvpInviteSendMessage,
  type PvpMatchCombatEvent,
  type PvpMatchPlayerState,
  type PvpMatchSnapshot,
  type PvpParticipantIdentity,
  type PvpRoomStateEvent,
} from '../../pvp/model';
import {
  getMultiplayerModeDefinition,
  type MultiplayerModeDefinition,
  type MultiplayerModeId,
} from '../../multiplayer/model';
import { MultiplayerInstanceClient } from '../../multiplayer/instanceClient';
import { createPvpRepository } from '../../pvp/repository';
import type { RoomCoordinates, RoomSnapshot } from '../../persistence/roomModel';
import {
  hidePvpCountdownOverlay,
  showPvpCountdownOverlay,
  showPvpGoOverlay,
  showPvpInvitePrompt,
  showPvpResultModal,
} from '../../ui/setup/pvpModal';

interface PendingPvpInvite {
  matchId: string;
  roomId: string;
  roomCoordinates: RoomCoordinates;
  opponent: PvpParticipantIdentity;
}

type PvpInvitePayload = Omit<PvpInviteSendMessage['invite'], 'targetConnectionId' | 'target'>;

interface OverworldPvpArenaControllerHost {
  getIdentity: () => PvpParticipantIdentity | null;
  getSelectedCoordinates: () => RoomCoordinates;
  getSelectedRoom: () => RoomSnapshot | null;
  getRoomSnapshotForCoordinates: (coordinates: RoomCoordinates) => RoomSnapshot | null;
  getPvpOpponentIdentity: (connectionId: string) => PvpParticipantIdentity | null;
  sendPvpInvite: (targetConnectionId: string, invite: PvpInvitePayload) => boolean;
  acceptPvpInvite: (invite: PvpInviteOffer) => boolean;
  declinePvpInvite: (invite: PvpInviteOffer) => void;
  isWithinLoadedRoomBounds: (coordinates: RoomCoordinates) => boolean;
  refreshAround: (coordinates: RoomCoordinates) => Promise<unknown>;
  prepareArenaDuel: (
    roomCoordinates: RoomCoordinates,
    opponentUserId: string,
    modeDefinition: MultiplayerModeDefinition,
  ) => void;
  refreshPlayerHitbox: () => void;
  syncPresenceMatchSnapshot: (
    snapshot: PvpMatchSnapshot | null,
    localUserId: string | null,
    opponentUserId: string | null,
  ) => void;
  syncInstanceMatchSnapshot: (snapshot: PvpMatchSnapshot, localUserId: string | null) => void;
  handlePeerState: (state: PvpMatchPlayerState) => void;
  handlePeerCombatEvent: (event: PvpMatchCombatEvent) => void;
  handlePeerRoomStateEvent: (event: PvpRoomStateEvent) => void;
  destroyCombatProjectiles: () => void;
  maybeApplyStartingPosition: (snapshot: PvpMatchSnapshot) => void;
  applyCameraLock: () => void;
  syncLocalHeartLabel: () => void;
  playLocalDamageFeedback: (previousHearts: number, nextHearts: number) => void;
  clearSceneRuntime: () => void;
  returnToWorld: () => void;
  renderHud: () => void;
  showTransientStatus: (message: string) => void;
  onSetupStateChanged?: (inProgress: boolean) => void;
}

export class OverworldPvpArenaController {
  private readonly arenaMode = getMultiplayerModeDefinition('arena');
  private readonly pvpRepository = createPvpRepository();
  private pvpMatchClient: MultiplayerInstanceClient | null = null;
  private activePvpMatch: PvpMatchSnapshot | null = null;
  private activePvpOpponentUserId: string | null = null;
  private activePvpReturnCoordinates: RoomCoordinates | null = null;
  private readonly pendingPvpInvitesByMatchId = new Map<string, PendingPvpInvite>();
  private lastSubmittedPvpMatchId: string | null = null;
  private nextPvpSetupGeneration = 0;
  private activePvpSetupGeneration: number | null = null;

  constructor(private readonly host: OverworldPvpArenaControllerHost) {}

  getActiveMatch(): PvpMatchSnapshot | null {
    return this.activePvpMatch;
  }

  getActiveOpponentUserId(): string | null {
    return this.activePvpOpponentUserId;
  }

  getActiveReturnCoordinates(): RoomCoordinates | null {
    return this.activePvpReturnCoordinates;
  }

  getClient(): MultiplayerInstanceClient | null {
    return this.pvpMatchClient;
  }

  isMatchActive(): boolean {
    return Boolean(this.activePvpMatch && this.activePvpMatch.status !== 'complete');
  }

  isSetupInProgress(): boolean {
    return this.activePvpSetupGeneration !== null;
  }

  isArenaActive(): boolean {
    return this.activePvpMatch?.mode === 'arena' && this.activePvpMatch.status !== 'complete';
  }

  isCountdownActive(): boolean {
    return this.activePvpMatch?.status === 'countdown';
  }

  isDamageActive(): boolean {
    return this.activePvpMatch?.status === 'active' || this.activePvpMatch?.status === 'finalizing';
  }

  getPersistentStatusText(): string | null {
    const snapshot = this.activePvpMatch;
    const identity = this.host.getIdentity();
    if (!snapshot || !identity || snapshot.status === 'complete') {
      return null;
    }

    if (snapshot.status === 'countdown' && snapshot.countdownEndsAt) {
      const remainingMs = Math.max(0, snapshot.countdownEndsAt - Date.now());
      const remainingSeconds = Math.max(1, Math.min(3, Math.ceil((remainingMs - 450) / 1000)));
      return `${this.arenaMode.displayName} starts in ${remainingSeconds}`;
    }

    const local = snapshot.participants.find((participant) => participant.userId === identity.userId);
    const opponent = snapshot.participants.find((participant) => participant.userId !== identity.userId);
    if (!local || !opponent) {
      return this.arenaMode.copy.waitingStatus;
    }

    return this.arenaMode.copy.activeStatus(local.hearts, opponent.hearts, opponent.displayName);
  }

  canOpenLauncher(): boolean {
    const identity = this.host.getIdentity();
    if (!identity || identity.userId.startsWith('guest-')) {
      this.host.showTransientStatus('Sign in to start ranked PVP.');
      return false;
    }
    if (this.isMatchActive()) {
      this.host.showTransientStatus('Finish the current duel first.');
      return false;
    }
    return true;
  }

  async inviteDuel(entry: {
    key: string;
    userId: string | null;
    displayName: string;
  }): Promise<void> {
    await this.invitePlayerToMode('arena', entry);
  }

  async invitePlayerToMode(
    modeId: MultiplayerModeId,
    entry: {
      key: string;
      userId: string | null;
      displayName: string;
    },
  ): Promise<void> {
    if (modeId !== 'arena') {
      this.host.showTransientStatus('That multiplayer mode is not available yet.');
      return;
    }

    const mode = getMultiplayerModeDefinition(modeId);
    const identity = this.host.getIdentity();
    const currentRoom = this.host.getSelectedRoom();
    if (!identity || !entry.userId) {
      this.host.showTransientStatus('PVP needs a visible player.');
      return;
    }
    if (identity.userId.startsWith('guest-')) {
      this.host.showTransientStatus('Sign in to start ranked PVP.');
      return;
    }
    if (entry.userId.startsWith('guest-')) {
      this.host.showTransientStatus(mode.copy.opponentRequiresSignin(entry.displayName));
      return;
    }
    if (this.isMatchActive()) {
      this.host.showTransientStatus('Finish the current duel first.');
      return;
    }
    if (!currentRoom || currentRoom.status !== 'published') {
      this.host.showTransientStatus(`${mode.displayName} starts from a published room.`);
      return;
    }

    const matchId = `${mode.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const inviteId = `invite-${matchId}`;
    const opponent = this.host.getPvpOpponentIdentity(entry.key) ?? {
      userId: entry.userId,
      displayName: entry.displayName,
      avatarId: 'default-player',
    };
    this.pendingPvpInvitesByMatchId.set(matchId, {
      matchId,
      roomId: currentRoom.id,
      roomCoordinates: { ...currentRoom.coordinates },
      opponent,
    });

    const sent = this.host.sendPvpInvite(entry.key, {
      inviteId,
      matchId,
      mode: mode.id,
      roomId: currentRoom.id,
      roomCoordinates: { ...currentRoom.coordinates },
      expiresAt: Date.now() + 20_000,
    });

    this.host.showTransientStatus(
      sent ? mode.copy.inviteSent(opponent.displayName) : 'Could not send duel invite.',
    );
  }

  async handleInvite(invite: PvpInviteOffer): Promise<void> {
    if (this.isMatchActive()) {
      this.host.declinePvpInvite(invite);
      return;
    }
    const identity = this.host.getIdentity();
    if (!identity || identity.userId.startsWith('guest-')) {
      this.host.declinePvpInvite(invite);
      this.host.showTransientStatus('Sign in to accept ranked PVP.');
      return;
    }

    const mode = getMultiplayerModeDefinition(invite.mode);
    const decision = await showPvpInvitePrompt(invite);
    if (decision !== 'accept') {
      this.host.declinePvpInvite(invite);
      return;
    }

    const accepted = this.host.acceptPvpInvite(invite);
    if (!accepted) {
      this.host.showTransientStatus('Could not accept duel invite.');
      return;
    }

    await this.startArenaDuel({
      modeId: mode.id,
      matchId: invite.matchId,
      roomId: invite.roomId,
      roomCoordinates: invite.roomCoordinates,
      opponent: invite.inviter,
    });
  }

  async handleInviteAccepted(
    matchId: string,
    acceptedBy: PvpParticipantIdentity,
  ): Promise<void> {
    const invite = this.pendingPvpInvitesByMatchId.get(matchId);
    this.pendingPvpInvitesByMatchId.delete(matchId);
    if (!invite) {
      return;
    }

    await this.startArenaDuel({
      modeId: this.arenaMode.id,
      matchId,
      roomId: invite.roomId,
      roomCoordinates: invite.roomCoordinates,
      opponent: acceptedBy,
    });
  }

  clearActiveMatch(disconnect = true, preserveSetup = false): void {
    if (disconnect) {
      this.pvpMatchClient?.disconnect();
    }
    this.pvpMatchClient = null;
    this.activePvpMatch = null;
    this.host.refreshPlayerHitbox();
    this.activePvpOpponentUserId = null;
    this.activePvpReturnCoordinates = null;
    this.host.clearSceneRuntime();
    this.host.syncPresenceMatchSnapshot(null, null, null);
    hidePvpCountdownOverlay();
    if (!preserveSetup) {
      this.finishActivePvpSetup();
    }
  }

  private async startArenaDuel(options: {
    modeId: MultiplayerModeId;
    matchId: string;
    roomId: string;
    roomCoordinates: RoomCoordinates;
    opponent: PvpParticipantIdentity;
  }): Promise<boolean> {
    const setupGeneration = this.beginPvpSetup();
    try {
      const identity = this.host.getIdentity();
      if (!identity) {
        this.host.showTransientStatus('PVP identity unavailable.');
        this.finishPvpSetup(setupGeneration);
        return false;
      }

      if (!this.host.isWithinLoadedRoomBounds(options.roomCoordinates)) {
        const refreshed = await this.host.refreshAround(options.roomCoordinates);
        if (!this.isPvpSetupCurrent(setupGeneration)) {
          return false;
        }
        if (!refreshed) {
          this.host.showTransientStatus('Could not load duel room.');
          this.finishPvpSetup(setupGeneration);
          return false;
        }
      }

      const room = this.host.getRoomSnapshotForCoordinates(options.roomCoordinates);
      if (!room || room.status !== 'published') {
        this.host.showTransientStatus('Duel room is no longer available.');
        this.finishPvpSetup(setupGeneration);
        return false;
      }

      const returnCoordinates = { ...this.host.getSelectedCoordinates() };
      const mode = getMultiplayerModeDefinition(options.modeId);
      this.clearActiveMatch(true, true);
      this.host.prepareArenaDuel(options.roomCoordinates, options.opponent.userId, mode);
      this.activePvpOpponentUserId = options.opponent.userId;
      this.activePvpReturnCoordinates = returnCoordinates;
      this.lastSubmittedPvpMatchId = null;

      let client: MultiplayerInstanceClient;
      client = new MultiplayerInstanceClient({
        matchId: options.matchId,
        mode: mode.id,
        roomId: options.roomId,
        roomCoordinates: { ...options.roomCoordinates },
        localIdentity: identity,
        opponentIdentity: options.opponent,
        onSnapshot: (snapshot) => {
          if (this.pvpMatchClient !== client) {
            return;
          }
          try {
            this.handleSnapshot(snapshot);
          } finally {
            this.finishPvpSetup(setupGeneration);
          }
        },
        onPeerState: (state) => this.handlePeerState(state),
        onPeerCombatEvent: (event) => this.handlePeerCombatEvent(event),
        onPeerRoomStateEvent: (event) => this.handlePeerRoomStateEvent(event),
        onStatus: (message) => this.host.showTransientStatus(message),
        onConnectionFailure: () => {
          if (this.activePvpSetupGeneration === setupGeneration) {
            this.clearActiveMatch(false);
          }
        },
      });
      this.pvpMatchClient = client;
      if (!client.connect()) {
        if (this.pvpMatchClient === client) {
          this.clearActiveMatch(false);
        }
        return false;
      }
      this.host.showTransientStatus(`${mode.displayName} with ${options.opponent.displayName}.`);
      return true;
    } catch (error) {
      this.finishPvpSetup(setupGeneration);
      throw error;
    }
  }

  private beginPvpSetup(): number {
    const generation = ++this.nextPvpSetupGeneration;
    const wasInProgress = this.activePvpSetupGeneration !== null;
    this.activePvpSetupGeneration = generation;
    if (!wasInProgress) {
      this.host.onSetupStateChanged?.(true);
    }
    return generation;
  }

  private isPvpSetupCurrent(generation: number): boolean {
    return this.activePvpSetupGeneration === generation;
  }

  private finishPvpSetup(generation: number): void {
    if (!this.isPvpSetupCurrent(generation)) {
      return;
    }
    this.activePvpSetupGeneration = null;
    this.host.onSetupStateChanged?.(false);
  }

  private finishActivePvpSetup(): void {
    const generation = this.activePvpSetupGeneration;
    if (generation !== null) {
      this.finishPvpSetup(generation);
    }
  }

  private handleSnapshot(snapshot: PvpMatchSnapshot): void {
    const previousSnapshot = this.activePvpMatch;
    const previousStatus = previousSnapshot?.status ?? null;
    const identity = this.host.getIdentity();
    const previousLocalHearts =
      previousSnapshot?.matchId === snapshot.matchId && identity
        ? previousSnapshot.participants.find((participant) => participant.userId === identity.userId)?.hearts ?? null
        : null;
    this.activePvpMatch = snapshot;
    this.host.refreshPlayerHitbox();
    this.host.syncPresenceMatchSnapshot(
      snapshot,
      identity?.userId ?? null,
      snapshot.status !== 'complete' ? this.activePvpOpponentUserId : null,
    );
    this.host.syncInstanceMatchSnapshot(snapshot, identity?.userId ?? null);
    if (snapshot.status === 'complete') {
      this.host.destroyCombatProjectiles();
    }
    this.host.maybeApplyStartingPosition(snapshot);
    this.host.applyCameraLock();
    if (snapshot.lastEvent) {
      this.host.showTransientStatus(snapshot.lastEvent);
    }

    if (identity && this.shouldExitAbandonedWaiting(snapshot, identity.userId)) {
      this.host.returnToWorld();
      return;
    }

    if (snapshot.status === 'countdown') {
      showPvpCountdownOverlay(snapshot);
    } else if (previousStatus === 'countdown' && snapshot.status === 'active') {
      showPvpGoOverlay(snapshot.mode);
    } else if (snapshot.status === 'complete') {
      hidePvpCountdownOverlay();
    }

    this.host.syncLocalHeartLabel();
    const nextLocalHearts = identity
      ? snapshot.participants.find((participant) => participant.userId === identity.userId)?.hearts ?? null
      : null;
    if (
      previousLocalHearts !== null &&
      nextLocalHearts !== null &&
      nextLocalHearts < previousLocalHearts
    ) {
      this.host.playLocalDamageFeedback(previousLocalHearts, nextLocalHearts);
    }

    if (snapshot.status === 'complete' && previousStatus !== 'complete') {
      void this.submitMatchResult(snapshot);
      if (identity) {
        showPvpResultModal(snapshot, identity.userId);
      }
      setTimeout(() => {
        if (this.activePvpMatch?.matchId === snapshot.matchId && this.activePvpMatch.status === 'complete') {
          this.host.returnToWorld();
        }
      }, 450);
    }

    this.host.renderHud();
  }

  private shouldExitAbandonedWaiting(snapshot: PvpMatchSnapshot, localUserId: string): boolean {
    if (snapshot.status !== 'waiting' || !snapshot.lastEvent?.endsWith(' disconnected.')) {
      return false;
    }

    const localParticipant = snapshot.participants.find((participant) => participant.userId === localUserId);
    const disconnectedOpponent = snapshot.participants.find(
      (participant) => participant.userId !== localUserId && !participant.connected,
    );
    return Boolean(localParticipant?.connected && disconnectedOpponent);
  }

  private handlePeerState(state: PvpMatchPlayerState): void {
    if (!this.activePvpMatch || state.matchId !== this.activePvpMatch.matchId) {
      return;
    }

    this.host.handlePeerState(state);
  }

  private handlePeerCombatEvent(event: PvpMatchCombatEvent): void {
    if (!this.activePvpMatch || event.matchId !== this.activePvpMatch.matchId) {
      return;
    }

    this.host.handlePeerCombatEvent(event);
  }

  private handlePeerRoomStateEvent(event: PvpRoomStateEvent): void {
    if (!this.activePvpMatch || event.matchId !== this.activePvpMatch.matchId) {
      return;
    }

    this.host.handlePeerRoomStateEvent(event);
  }

  private async submitMatchResult(snapshot: PvpMatchSnapshot): Promise<void> {
    const identity = this.host.getIdentity();
    if (!identity || this.lastSubmittedPvpMatchId === snapshot.matchId || !snapshot.startedAt || !snapshot.finishedAt) {
      return;
    }
    if (!snapshot.participants.some((participant) => participant.userId === identity.userId)) {
      return;
    }

    this.lastSubmittedPvpMatchId = snapshot.matchId;
    try {
      const result = snapshot.draw ? 'draw' : 'win';
      await this.pvpRepository.submitMatch({
        matchId: snapshot.matchId,
        mode: snapshot.mode,
        roomId: snapshot.roomId,
        roomCoordinates: { ...snapshot.roomCoordinates },
        startedAt: new Date(snapshot.startedAt).toISOString(),
        finishedAt: new Date(snapshot.finishedAt).toISOString(),
        durationMs: Math.max(0, snapshot.finishedAt - snapshot.startedAt),
        result,
        winnerUserId: snapshot.winnerUserId,
        loserUserId: snapshot.loserUserId,
        participants: snapshot.participants.map((participant) => ({
          userId: participant.userId,
          userDisplayName: participant.displayName,
          result: snapshot.draw
            ? 'draw'
            : participant.userId === snapshot.winnerUserId
              ? 'win'
              : 'loss',
          heartsRemaining: participant.hearts,
          livesLost: Math.max(0, getMultiplayerModeDefinition(snapshot.mode).startingLives - participant.hearts),
          hits: participant.hits,
        })),
        finalSnapshot: snapshot,
      });
    } catch (error) {
      console.error('Failed to submit PVP match result', error);
      this.lastSubmittedPvpMatchId = null;
    }
  }
}
