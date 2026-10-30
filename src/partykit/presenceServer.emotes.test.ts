import { afterEach, describe, expect, it } from 'vitest';
import { createPartykitIdentityToken } from '../presence/identityToken';
import { PresenceServerHarness, presencePayload, sendPresence, testIdentity, type FakePresenceConnection } from './presenceServer.testHarness';

let harness: PresenceServerHarness;
afterEach(() => harness?.dispose());
async function join(id: string, classroomId?: string, guest = false, muted = false) {
  const identity = { ...testIdentity(id), ...(guest ? { userId: 'guest-abcd-0000-0000' } : {}) };
  const { token } = await createPartykitIdentityToken(identity, guest ? 'guest' : 'auth', String(harness.room.env.PARTYKIT_IDENTITY_TOKEN_SECRET ?? harness.room.env.PARTYKIT_INTERNAL_TOKEN), {
    roomChat: classroomId !== undefined ? 'school' : 'ok', classroomId, emotesMuted: muted, nowMs: Date.now(),
  });
  const connection = await harness.connect(id, { token, sharedRoomChat: true });
  sendPresence(harness, connection, presencePayload({ mode: 'play' }));
  return connection;
}
const bubbles = (c: FakePresenceConnection) => c.messages<{ type: string; message: { text: string } }>().filter(m => m.type === 'room-chat:message');
function send(c: FakePresenceConnection, packet: unknown) {
  harness.server.onMessage(JSON.stringify(packet), c.asPartyConnection());
}
describe('server fixed emote delivery', () => {
  it('maps guest IDs on the server, shares the text cooldown and rejects arbitrary emotes', async () => {
    harness = new PresenceServerHarness();
    const guest = await join('guest', undefined, true);
    const peer = await join('peer');
    send(guest, { type: 'room-chat:emote', emote: 'wave', text: 'injected' });
    expect(bubbles(peer).map(m => m.message.text)).toEqual(['👋']);
    send(guest, { type: 'room-chat:emote', emote: 'heart' });
    expect(bubbles(peer)).toHaveLength(1);
    await harness.advance(1000);
    send(guest, { type: 'room-chat:emote', emote: '__proto__' });
    send(guest, { type: 'room-chat:say', text: 'guest free text' });
    expect(bubbles(peer)).toHaveLength(1);
    send(guest, { type: 'room-chat:emote', emote: 'gg' });
    expect(bubbles(peer).map(m => m.message.text)).toEqual(['👋', 'GG']);
  });
  it('isolates signed classroom audiences both ways and ignores client scope claims', async () => {
    harness = new PresenceServerHarness();
    const alice = await join('alice', 'a');
    const bob = await join('bob', 'a');
    const other = await join('other', 'b');
    const publicPeer = await join('public');
    send(alice, { type: 'room-chat:emote', emote: 'heart', classroomId: 'b' });
    expect(bubbles(bob)).toHaveLength(1);
    expect(bubbles(other)).toHaveLength(0);
    expect(bubbles(publicPeer)).toHaveLength(0);
    send(publicPeer, { type: 'room-chat:emote', emote: 'wave', classroomId: 'a' });
    expect(bubbles(alice)).toHaveLength(1); // own emote only
    expect(bubbles(bob)).toHaveLength(1);
    await harness.advance(1000);
    send(alice, { type: 'room-chat:say', text: 'school free text' });
    expect(bubbles(bob)).toHaveLength(1);
    expect(JSON.stringify(bubbles(bob))).not.toContain('classroomId');
  });
  it('blocks muted students and old school tokens, and requires playing in the same room', async () => {
    harness = new PresenceServerHarness();
    const peer = await join('peer', 'a');
    for (const c of [await join('muted', 'a', false, true), await join('legacy', '')]) {
      send(c, { type: 'room-chat:emote', emote: 'wave' });
    }
    const sender = await join('sender', 'a');
    sendPresence(harness, sender, presencePayload({ mode: 'browse' }));
    send(sender, { type: 'room-chat:emote', emote: 'wave' });
    sendPresence(harness, sender, presencePayload({ mode: 'play', roomX: 99, roomY: 99 }));
    send(sender, { type: 'room-chat:emote', emote: 'wave' });
    expect(bubbles(peer)).toHaveLength(0);
  });
});
