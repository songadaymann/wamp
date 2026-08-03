import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { MultiplayerInstanceClientOptions } from '../../multiplayer/instanceClient';
import type {
  PvpInviteSendMessage,
  PvpMatchSnapshot,
  PvpParticipantIdentity,
} from '../../pvp/model';
import type { RoomSnapshot } from '../../persistence/roomModel';

const clientHarness = vi.hoisted(() => ({
  connectResult: true,
  instances: [] as Array<{
    options: MultiplayerInstanceClientOptions;
    disconnect: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('../../multiplayer/instanceClient', () => ({
  MultiplayerInstanceClient: class {
    readonly disconnect = vi.fn();

    constructor(readonly options: MultiplayerInstanceClientOptions) {
      clientHarness.instances.push({ options, disconnect: this.disconnect });
    }

    connect(): boolean {
      return clientHarness.connectResult;
    }
  },
}));

vi.mock('../../pvp/repository', () => ({
  createPvpRepository: () => ({ submitMatch: vi.fn() }),
}));

vi.mock('../../ui/setup/pvpModal', () => ({
  hidePvpCountdownOverlay: vi.fn(),
  showPvpCountdownOverlay: vi.fn(),
  showPvpGoOverlay: vi.fn(),
  showPvpInvitePrompt: vi.fn(),
  showPvpResultModal: vi.fn(),
}));

import { OverworldPvpArenaController } from './pvpArenaController';

const LOCAL_IDENTITY: PvpParticipantIdentity = {
  userId: 'local-user',
  displayName: 'Local',
  avatarId: 'default-player',
};

const OPPONENT_IDENTITY: PvpParticipantIdentity = {
  userId: 'opponent-user',
  displayName: 'Opponent',
  avatarId: 'default-player',
};

const ROOM = {
  id: '0,0',
  status: 'published',
  coordinates: { x: 0, y: 0 },
} as RoomSnapshot;

type PvpInvitePayload = Omit<
  PvpInviteSendMessage['invite'],
  'targetConnectionId' | 'target'
>;
type SendPvpInvite = (targetConnectionId: string, invite: PvpInvitePayload) => boolean;

function createHarness(options: {
  isWithinLoadedRoomBounds?: () => boolean;
  refreshAround?: () => Promise<unknown>;
} = {}) {
  const onSetupStateChanged = vi.fn();
  const sendPvpInvite = vi.fn<SendPvpInvite>(() => true);
  const host = {
    getIdentity: vi.fn(() => LOCAL_IDENTITY),
    getSelectedCoordinates: vi.fn(() => ({ x: 0, y: 0 })),
    getSelectedRoom: vi.fn(() => ROOM),
    getRoomSnapshotForCoordinates: vi.fn(() => ROOM),
    getPvpOpponentIdentity: vi.fn(() => OPPONENT_IDENTITY),
    sendPvpInvite,
    acceptPvpInvite: vi.fn(() => true),
    declinePvpInvite: vi.fn(),
    isWithinLoadedRoomBounds: vi.fn(options.isWithinLoadedRoomBounds ?? (() => true)),
    refreshAround: vi.fn(options.refreshAround ?? (async () => true)),
    prepareArenaDuel: vi.fn(),
    refreshPlayerHitbox: vi.fn(),
    syncPresenceMatchSnapshot: vi.fn(),
    syncInstanceMatchSnapshot: vi.fn(),
    handlePeerState: vi.fn(),
    handlePeerCombatEvent: vi.fn(),
    handlePeerRoomStateEvent: vi.fn(),
    destroyCombatProjectiles: vi.fn(),
    maybeApplyStartingPosition: vi.fn(),
    applyCameraLock: vi.fn(),
    syncLocalHeartLabel: vi.fn(),
    playLocalDamageFeedback: vi.fn(),
    clearSceneRuntime: vi.fn(),
    returnToWorld: vi.fn(),
    renderHud: vi.fn(),
    showTransientStatus: vi.fn(),
    onSetupStateChanged,
  };
  const controller = new OverworldPvpArenaController(host);
  return { controller, host, onSetupStateChanged, sendPvpInvite };
}

async function startAcceptedSameRoomInvite(
  controller: OverworldPvpArenaController,
  sendPvpInvite: Mock<SendPvpInvite>,
): Promise<MultiplayerInstanceClientOptions> {
  await controller.invitePlayerToMode('arena', {
    key: 'opponent-connection',
    userId: OPPONENT_IDENTITY.userId,
    displayName: OPPONENT_IDENTITY.displayName,
  });
  const invite = sendPvpInvite.mock.calls.at(-1)?.[1];
  expect(invite).toBeDefined();
  await controller.handleInviteAccepted(invite!.matchId, OPPONENT_IDENTITY);
  const client = clientHarness.instances.at(-1);
  expect(client).toBeDefined();
  return client!.options;
}

function makeWaitingSnapshot(matchId: string): PvpMatchSnapshot {
  return {
    matchId,
    mode: 'arena',
    roomId: ROOM.id,
    roomCoordinates: { ...ROOM.coordinates },
    status: 'waiting',
    participants: [
      {
        ...LOCAL_IDENTITY,
        hearts: 5,
        connected: true,
        invulnerableUntil: 0,
        losses: 0,
        hits: 0,
      },
      {
        ...OPPONENT_IDENTITY,
        hearts: 5,
        connected: false,
        invulnerableUntil: 0,
        losses: 0,
        hits: 0,
      },
    ],
    startedAt: null,
    countdownEndsAt: null,
    finishedAt: null,
    winnerUserId: null,
    loserUserId: null,
    draw: false,
    lastEvent: null,
  };
}

describe('OverworldPvpArenaController performance setup gate', () => {
  beforeEach(() => {
    clientHarness.connectResult = true;
    clientHarness.instances.length = 0;
  });

  it('stays active after same-room acceptance until the first match snapshot', async () => {
    const { controller, onSetupStateChanged, sendPvpInvite } = createHarness();
    const clientOptions = await startAcceptedSameRoomInvite(controller, sendPvpInvite);

    expect(controller.isSetupInProgress()).toBe(true);
    expect(onSetupStateChanged.mock.calls).toEqual([[true]]);

    clientOptions.onSnapshot(makeWaitingSnapshot(clientOptions.matchId));

    expect(controller.isSetupInProgress()).toBe(false);
    expect(onSetupStateChanged.mock.calls).toEqual([[true], [false]]);
  });

  it('releases the gate when the connection fails before a snapshot', async () => {
    const { controller, onSetupStateChanged, sendPvpInvite } = createHarness();
    const clientOptions = await startAcceptedSameRoomInvite(controller, sendPvpInvite);
    expect(controller.isSetupInProgress()).toBe(true);

    clientOptions.onConnectionFailure?.();

    expect(controller.isSetupInProgress()).toBe(false);
    expect(onSetupStateChanged.mock.calls).toEqual([[true], [false]]);
  });

  it('does not let stale callbacks finish a newer setup generation', async () => {
    const { controller, host, onSetupStateChanged, sendPvpInvite } = createHarness();
    const firstClientOptions = await startAcceptedSameRoomInvite(controller, sendPvpInvite);
    const secondClientOptions = await startAcceptedSameRoomInvite(controller, sendPvpInvite);

    expect(controller.isSetupInProgress()).toBe(true);
    expect(onSetupStateChanged.mock.calls).toEqual([[true]]);

    firstClientOptions.onConnectionFailure?.();
    firstClientOptions.onSnapshot(makeWaitingSnapshot(firstClientOptions.matchId));

    expect(controller.isSetupInProgress()).toBe(true);
    expect(host.syncPresenceMatchSnapshot).not.toHaveBeenCalledWith(
      expect.objectContaining({ matchId: firstClientOptions.matchId }),
      expect.anything(),
      expect.anything(),
    );
    expect(onSetupStateChanged.mock.calls).toEqual([[true]]);

    secondClientOptions.onSnapshot(makeWaitingSnapshot(secondClientOptions.matchId));

    expect(controller.isSetupInProgress()).toBe(false);
    expect(onSetupStateChanged.mock.calls).toEqual([[true], [false]]);
  });

  it('cancels an in-flight room refresh without restarting setup when it resolves', async () => {
    let resolveRefresh!: (value: unknown) => void;
    const refreshPromise = new Promise<unknown>((resolve) => {
      resolveRefresh = resolve;
    });
    const { controller, host, onSetupStateChanged, sendPvpInvite } = createHarness({
      isWithinLoadedRoomBounds: () => false,
      refreshAround: () => refreshPromise,
    });

    await controller.invitePlayerToMode('arena', {
      key: 'opponent-connection',
      userId: OPPONENT_IDENTITY.userId,
      displayName: OPPONENT_IDENTITY.displayName,
    });
    const invite = sendPvpInvite.mock.calls.at(-1)?.[1];
    expect(invite).toBeDefined();
    const startPromise = controller.handleInviteAccepted(invite!.matchId, OPPONENT_IDENTITY);
    await Promise.resolve();

    expect(controller.isSetupInProgress()).toBe(true);
    controller.clearActiveMatch();
    expect(controller.isSetupInProgress()).toBe(false);
    expect(onSetupStateChanged.mock.calls).toEqual([[true], [false]]);

    resolveRefresh(true);
    await startPromise;

    expect(host.prepareArenaDuel).not.toHaveBeenCalled();
    expect(clientHarness.instances).toHaveLength(0);
    expect(onSetupStateChanged.mock.calls).toEqual([[true], [false]]);
  });

  it('releases the gate when asynchronous room preparation fails', async () => {
    const setupFailure = new Error('refresh failed');
    const { controller, onSetupStateChanged, sendPvpInvite } = createHarness({
      isWithinLoadedRoomBounds: () => false,
      refreshAround: async () => {
        throw setupFailure;
      },
    });

    await controller.invitePlayerToMode('arena', {
      key: 'opponent-connection',
      userId: OPPONENT_IDENTITY.userId,
      displayName: OPPONENT_IDENTITY.displayName,
    });
    const invite = sendPvpInvite.mock.calls.at(-1)?.[1];
    expect(invite).toBeDefined();

    await expect(
      controller.handleInviteAccepted(invite!.matchId, OPPONENT_IDENTITY),
    ).rejects.toBe(setupFailure);

    expect(controller.isSetupInProgress()).toBe(false);
    expect(onSetupStateChanged.mock.calls).toEqual([[true], [false]]);
  });
});
