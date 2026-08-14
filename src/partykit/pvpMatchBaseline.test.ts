import { afterEach, describe, expect, it } from 'vitest';
import type { PvpMatchSnapshot } from '../pvp/model';
import {
  messageTypes,
  PresenceServerHarness,
  testIdentity,
  type FakePresenceConnection,
} from './presenceServer.testHarness';

let harness: PresenceServerHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

function send(connection: FakePresenceConnection, message: Record<string, unknown>): void {
  harness?.server.onMessage(JSON.stringify(message), connection.asPartyConnection());
}

function latestSnapshot(connection: FakePresenceConnection): PvpMatchSnapshot | null {
  const snapshots = connection.messages<{
    type: string;
    snapshot?: PvpMatchSnapshot;
  }>().filter((message) => message.type === 'pvp:match:snapshot');
  return snapshots.at(-1)?.snapshot ?? null;
}

async function configureTwoClients() {
  if (!harness) {
    throw new Error('Harness is not initialized.');
  }
  const aliceIdentity = testIdentity('alice');
  const bobIdentity = testIdentity('bob');
  const alice = await harness.connect('alice');
  const bob = await harness.connect('bob');
  alice.clearMessages();
  bob.clearMessages();
  const configure = {
    type: 'pvp:match:configure',
    matchId: 'match-two-client',
    mode: 'arena',
    roomId: '0,0',
    roomCoordinates: { x: 0, y: 0 },
    participants: [aliceIdentity, bobIdentity],
  };
  send(alice, configure);
  send(bob, configure);
  return { alice, bob, aliceIdentity, bobIdentity };
}

describe('PvP two-client protocol baseline', () => {
  it('synchronizes countdown, relays combat, deduplicates hits, and completes death flow', async () => {
    harness = new PresenceServerHarness({ roomId: 'pvp:match-two-client' });
    const { alice, bob, aliceIdentity, bobIdentity } = await configureTwoClients();

    expect(latestSnapshot(alice)).toMatchObject({
      matchId: 'match-two-client',
      status: 'countdown',
      participants: [
        { userId: aliceIdentity.userId, hearts: 5, connected: true },
        { userId: bobIdentity.userId, hearts: 5, connected: true },
      ],
    });
    expect(latestSnapshot(bob)?.countdownEndsAt).toBe(latestSnapshot(alice)?.countdownEndsAt);

    alice.clearMessages();
    bob.clearMessages();
    await harness.advance(4_200);
    expect(latestSnapshot(alice)).toMatchObject({ status: 'active' });
    expect(latestSnapshot(bob)).toMatchObject({ status: 'active' });

    alice.clearMessages();
    bob.clearMessages();
    send(alice, {
      type: 'pvp:match:combat-event',
      event: {
        id: 'sword-event-1',
        matchId: 'match-two-client',
        source: 'sword',
        x: 20,
        y: 40,
        facing: 1,
        startedAt: Date.now(),
        durationMs: 180,
        effectX: 28,
        effectY: 41,
        downward: false,
        projectile: null,
      },
    });
    expect(messageTypes(alice)).not.toContain('pvp:match:peer-combat-event');
    expect(messageTypes(bob)).toEqual(['pvp:match:peer-combat-event']);

    alice.clearMessages();
    bob.clearMessages();
    send(alice, {
      type: 'pvp:match:hit',
      hitId: 'shared-hit-id',
      targetUserId: bobIdentity.userId,
      source: 'sword',
    });
    expect(latestSnapshot(bob)?.participants.find(
      (participant) => participant.userId === bobIdentity.userId,
    )?.hearts).toBe(4);
    send(alice, {
      type: 'pvp:match:hit',
      hitId: 'shared-hit-id',
      targetUserId: bobIdentity.userId,
      source: 'sword',
    });
    expect(latestSnapshot(bob)?.participants.find(
      (participant) => participant.userId === bobIdentity.userId,
    )?.hearts).toBe(4);

    for (let loss = 0; loss < 4; loss += 1) {
      await harness.advance(1_800);
      send(bob, {
        type: 'pvp:match:self-death',
        hitId: `bob-death-${loss}`,
        source: 'environment',
      });
    }
    expect(latestSnapshot(alice)).toMatchObject({
      status: 'finalizing',
      loserUserId: null,
      winnerUserId: null,
    });
    await harness.advance(350);
    expect(latestSnapshot(alice)).toMatchObject({
      status: 'complete',
      loserUserId: bobIdentity.userId,
      winnerUserId: aliceIdentity.userId,
      draw: false,
    });
    expect(latestSnapshot(bob)).toMatchObject({ status: 'complete' });
  });
});
