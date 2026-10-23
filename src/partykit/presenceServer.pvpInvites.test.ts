import { afterEach, describe, expect, it } from 'vitest';
import { PresenceServerHarness, presencePayload, sendPresence, testIdentity, type FakePresenceConnection } from './presenceServer.testHarness';
import { PVP_INVITE_DECLINE_COOLDOWN_MS, PVP_INVITE_MAX_LIFETIME_MS, PVP_INVITE_TARGET_INTERVAL_MS } from './relayProtocol';

let harness: PresenceServerHarness;
afterEach(() => harness?.dispose());

async function player(id: string, mode: 'browse' | 'play' = 'browse', guest = false) {
  const connection = await harness.connect(id, guest ? { source: 'guest', identity: { ...testIdentity(id), userId: `guest-${id}-0000` } } : {});
  sendPresence(harness, connection, presencePayload({ mode }));
  return connection;
}

let inviteCount = 0;
function challenge(from: FakePresenceConnection, to: FakePresenceConnection, expiresAt = Date.now() + 20_000): void {
  inviteCount += 1;
  harness.server.onMessage(JSON.stringify({ type: 'pvp:invite', invite: {
    inviteId: `invite-${inviteCount}`, matchId: `match-${inviteCount}`, mode: 'arena', roomId: '1,2', roomCoordinates: { x: 1, y: 2 },
    targetConnectionId: to.id, target: testIdentity(to.id), expiresAt,
  } }), from.asPartyConnection());
}

function decline(by: FakePresenceConnection, inviter: FakePresenceConnection): void {
  harness.server.onMessage(JSON.stringify({ type: 'pvp:invite:decline', inviteId: 'invite', matchId: 'match', inviterConnectionId: inviter.id }), by.asPartyConnection());
}

const offers = (connection: FakePresenceConnection) =>
  connection.messages<{ type: string; invite: { expiresAt: number } }>().filter((message) => message.type === 'pvp:invite:offer');

describe('PvP challenges can not be used to interrupt or spam a player', () => {
  it('relays a challenge between runs, with its lifetime capped', async () => {
    harness = new PresenceServerHarness();
    const alice = await player('alice');
    const bob = await player('bob');
    challenge(alice, bob, Date.now() + 10 * 60_000);
    expect(offers(bob)).toHaveLength(1);
    expect(offers(bob)[0].invite.expiresAt).toBe(Date.now() + PVP_INVITE_MAX_LIFETIME_MS);
  });

  it('does not relay from or to guests, or to someone in the middle of a run', async () => {
    harness = new PresenceServerHarness();
    const guest = await player('guest', 'browse', true);
    const runner = await player('runner', 'play');
    const alice = await player('alice');
    challenge(guest, alice);
    await harness.advance(PVP_INVITE_TARGET_INTERVAL_MS);
    challenge(alice, guest);
    await harness.advance(PVP_INVITE_TARGET_INTERVAL_MS);
    challenge(alice, runner);
    expect([...offers(alice), ...offers(guest), ...offers(runner)]).toHaveLength(0);
  });

  it('holds back the same sender after a decline, and limits how often anyone can challenge one player', async () => {
    harness = new PresenceServerHarness();
    const alice = await player('alice');
    const carol = await player('carol');
    const bob = await player('bob');
    challenge(alice, bob);
    decline(bob, alice);
    expect(alice.messages().some((message) => (message as { type: string }).type === 'pvp:invite:declined')).toBe(true);

    // Another sender right away: one challenge per receiver per interval.
    challenge(carol, bob);
    expect(offers(bob)).toHaveLength(1);
    await harness.advance(PVP_INVITE_TARGET_INTERVAL_MS);
    challenge(carol, bob);
    expect(offers(bob)).toHaveLength(2);

    // The declined sender stays held back until the cooldown ends.
    await harness.advance(PVP_INVITE_TARGET_INTERVAL_MS);
    challenge(alice, bob);
    expect(offers(bob)).toHaveLength(2);
    await harness.advance(PVP_INVITE_DECLINE_COOLDOWN_MS - 2 * PVP_INVITE_TARGET_INTERVAL_MS);
    challenge(alice, bob);
    expect(offers(bob)).toHaveLength(3);
  });
});
