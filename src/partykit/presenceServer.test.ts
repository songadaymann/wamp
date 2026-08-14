import { afterEach, describe, expect, it } from 'vitest';
import PresenceServer from '../../partykit/presenceServer';
import {
  createTestIdentityToken,
  FakePresenceRoom,
  messageTypes,
  presencePayload,
  PresenceServerHarness,
  sendPresence,
  testIdentity,
} from './presenceServer.testHarness';

let harness: PresenceServerHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe('PresenceServer protocol baseline', () => {
  it('authenticates signed connections and selects only the explicit chat channel', async () => {
    harness = new PresenceServerHarness();
    const identity = testIdentity('alice');
    const token = await createTestIdentityToken(identity);
    const signedRequest = new Request(
      `https://presence.example.test/parties/main/world?identityToken=${encodeURIComponent(token)}`
    );

    await expect(
      PresenceServer.onBeforeConnect(
        signedRequest as never,
        { env: harness.room.env } as never
      )
    ).resolves.toBe(signedRequest);

    const missingToken = await PresenceServer.onBeforeConnect(
      new Request('https://presence.example.test/parties/main/world') as never,
      { env: harness.room.env } as never
    );
    expect(missingToken).toBeInstanceOf(Response);
    expect((missingToken as Response).status).toBe(401);

    const presence = await harness.connect('alice', { token, channel: 'unexpected' });
    expect(presence.state).toMatchObject({
      channel: 'presence',
      userId: identity.userId,
      displayName: identity.displayName,
      avatarId: identity.avatarId,
      presence: null,
    });
    expect(messageTypes(presence)).toEqual(['snapshot']);

    const chat = await harness.connect('chat', { channel: 'room-chat' });
    expect(chat.state).toMatchObject({ channel: 'room-chat' });
    expect(chat.sent).toEqual([]);
  });

  it('closes an invalid identity without initializing connection state', async () => {
    harness = new PresenceServerHarness();
    const connection = await harness.connect('invalid', { token: 'not-a-signed-token' });

    expect(connection.state).toBeNull();
    expect(connection.closes).toEqual([
      { code: 1008, reason: 'invalid-presence-identity' },
    ]);
    expect(connection.sent).toEqual([]);
  });

  it('ignores malformed messages and sends a sorted direct snapshot before populations', async () => {
    harness = new PresenceServerHarness();
    const zoe = await harness.connect('zoe', {
      identity: { userId: 'user-zoe', displayName: 'Zoe', avatarId: 'avatar-z' },
    });
    const amy = await harness.connect('amy', {
      identity: { userId: 'user-amy', displayName: 'Amy', avatarId: 'avatar-a' },
    });
    sendPresence(harness, zoe, presencePayload({ roomX: 4, roomY: 2 }));
    sendPresence(harness, amy, presencePayload({ roomX: 3, roomY: 2 }));
    await harness.advance(250);
    zoe.clearMessages();
    amy.clearMessages();

    const viewer = await harness.connect('viewer');
    const initialMessages = viewer.messages<{
      type: string;
      peers?: Array<{ displayName: string }>;
    }>();
    expect(initialMessages).toHaveLength(1);
    expect(initialMessages[0]).toMatchObject({ type: 'snapshot' });
    expect(initialMessages[0]?.peers?.map((peer) => peer.displayName)).toEqual(['Amy', 'Zoe']);

    harness.server.onMessage('{', viewer.asPartyConnection());
    harness.server.onMessage('null', viewer.asPartyConnection());
    harness.server.onMessage(JSON.stringify({ nope: true }), viewer.asPartyConnection());
    harness.server.onMessage(
      JSON.stringify({ type: 'presence:update', presence: { mode: 'play' } }),
      viewer.asPartyConnection()
    );
    expect(messageTypes(viewer)).toEqual(['snapshot']);

    await harness.advance(249);
    expect(messageTypes(viewer)).toEqual(['snapshot']);
    await harness.advance(1);
    expect(messageTypes(viewer)).toEqual(['snapshot', 'populations']);
  });

  it('batches ordinary presence for 80 ms, keeps the latest update, and flushes PvP immediately', async () => {
    harness = new PresenceServerHarness();
    const sender = await harness.connect('sender');
    const receiver = await harness.connect('receiver');
    await harness.advance(250);
    sender.clearMessages();
    receiver.clearMessages();

    sendPresence(harness, sender, presencePayload({ x: 11, timestamp: 1 }));
    await harness.advance(79);
    expect(messageTypes(receiver)).toEqual([]);

    sendPresence(harness, sender, presencePayload({ x: 22, timestamp: 2 }));
    expect(messageTypes(receiver)).toEqual([]);
    await harness.advance(1);

    const batched = receiver.messages<{
      type: string;
      peers: Array<{ x: number; timestamp: number }>;
    }>();
    expect(batched).toHaveLength(1);
    expect(batched[0]).toMatchObject({ type: 'upserts' });
    expect(batched[0]?.peers).toHaveLength(1);
    expect(batched[0]?.peers[0]).toMatchObject({ x: 22, timestamp: 2 });

    receiver.clearMessages();
    sendPresence(
      harness,
      sender,
      presencePayload({
        x: 33,
        timestamp: 3,
        pvp: { matchId: 'match-1', action: 'sword', actionUntil: Date.now() + 100 },
      })
    );
    const immediate = receiver.messages<{
      type: string;
      peers: Array<{ x: number; pvp: { matchId: string } }>;
    }>();
    expect(immediate).toHaveLength(1);
    expect(immediate[0]).toMatchObject({ type: 'upserts' });
    expect(immediate[0]?.peers[0]).toMatchObject({
      x: 33,
      pvp: { matchId: 'match-1' },
    });
  });

  it('batches room population changes for exactly 250 ms', async () => {
    harness = new PresenceServerHarness();
    const player = await harness.connect('player');
    const observer = await harness.connect('observer');
    await harness.advance(250);
    player.clearMessages();
    observer.clearMessages();

    sendPresence(harness, player, presencePayload({ roomX: 8, roomY: 9, mode: 'play' }));
    await harness.advance(249);
    expect(messageTypes(observer)).not.toContain('populations');

    await harness.advance(1);
    const populations = observer
      .messages<{
        type: string;
        roomPopulations?: Record<string, number>;
        roomEditors?: Record<string, number>;
      }>()
      .find((message) => message.type === 'populations');
    expect(populations).toMatchObject({
      roomPopulations: { '8,9': 1 },
      roomEditors: {},
    });
  });

  it('omits every connection owned by the snapshot viewer user', async () => {
    harness = new PresenceServerHarness();
    const sharedIdentity = {
      userId: 'same-user',
      displayName: 'Same User',
      avatarId: 'same-avatar',
    };
    const first = await harness.connect('same-user-first', { identity: sharedIdentity });
    const other = await harness.connect('other', {
      identity: { userId: 'other-user', displayName: 'Other User', avatarId: 'other-avatar' },
    });
    sendPresence(harness, first, presencePayload({ x: 1 }));
    sendPresence(harness, other, presencePayload({ x: 2 }));
    await harness.advance(250);

    const second = await harness.connect('same-user-second', { identity: sharedIdentity });
    const snapshot = second.messages<{
      type: string;
      peers: Array<{ connectionId: string; userId: string }>;
    }>()[0];
    expect(snapshot?.type).toBe('snapshot');
    expect(snapshot?.peers).toEqual([
      expect.objectContaining({ connectionId: 'other', userId: 'other-user' }),
    ]);
  });

  it('cancels queued upserts and clears populations on leave and close', async () => {
    harness = new PresenceServerHarness();
    const player = await harness.connect('player');
    const observer = await harness.connect('observer');
    await harness.advance(250);
    player.clearMessages();
    observer.clearMessages();

    sendPresence(harness, player, presencePayload({ roomX: 5, roomY: 6, x: 1 }));
    harness.server.onMessage(
      JSON.stringify({ type: 'presence:leave' }),
      player.asPartyConnection()
    );
    expect(messageTypes(observer)).toEqual(['remove']);

    await harness.advance(80);
    expect(messageTypes(observer)).toEqual(['remove']);
    await harness.advance(170);
    expect(observer.messages()).toContainEqual(
      expect.objectContaining({ type: 'populations', roomPopulations: {} })
    );

    observer.clearMessages();
    sendPresence(harness, player, presencePayload({ roomX: 5, roomY: 6, x: 2 }));
    await harness.advance(80);
    observer.clearMessages();

    harness.close(player);
    expect(messageTypes(observer)).toEqual(['remove']);
    await harness.advance(250);
    expect(observer.messages()).toContainEqual(
      expect.objectContaining({ type: 'populations', roomPopulations: {} })
    );
  });
});

describe('PresenceServer test harness', () => {
  it('removes a connection from room iteration before onClose', async () => {
    harness = new PresenceServerHarness();
    const player = await harness.connect('player');
    expect(Array.from(harness.room.getConnections())).toHaveLength(1);

    harness.close(player);

    expect(Array.from(harness.room.getConnections())).toHaveLength(0);
  });

  it('provides isolated in-memory PartyKit storage', async () => {
    const room = new FakePresenceRoom();
    await room.storage.put('preview:1,2', { roomId: '1,2' });
    await room.storage.put('shard:one', { shardId: 'one' });

    await expect(room.storage.list({ prefix: 'preview:' })).resolves.toEqual(
      new Map([['preview:1,2', { roomId: '1,2' }]])
    );
    await expect(room.storage.delete('preview:1,2')).resolves.toBe(true);
    await expect(room.storage.list({ prefix: 'preview:' })).resolves.toEqual(new Map());
  });
});
