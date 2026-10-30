import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  sockets: [] as Array<{
    room: string; readyState: number; closed: boolean; sent: string[];
    options: { query: () => Promise<Record<string, string>> };
    open(): void; message(value: unknown): void; disconnect(): void;
  }>,
  apiRequest: vi.fn(),
  auth: { authenticated: true, user: { id: 'alice' }, schoolManaged: false, chatModeration: { banned: false } },
}));
vi.mock('../auth/client', () => ({ getAuthDebugState: () => fixtures.auth, getResolvedPartykitConfig: vi.fn() }));
vi.mock('../api/request', () => ({ apiRequest: fixtures.apiRequest }));
vi.mock('partysocket', () => {
  class FakeSocket extends EventTarget {
    static OPEN = 1;
    readyState = 0; closed = false; sent: string[] = []; room: string;
    constructor(readonly options: { room: string; query: () => Promise<Record<string, string>> }) {
      super();this.room = options.room;fixtures.sockets.push(this);
    }
    open(): void { this.readyState = 1;this.dispatchEvent(new Event('open')); }
    message(value: unknown): void { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
    send(value: string): void { this.sent.push(value); }
    disconnect(): void { this.readyState = 0;this.dispatchEvent(new Event('close')); }
    close(): void { this.closed = true;this.readyState = 3;this.dispatchEvent(new Event('close')); }
  }
  return { default: FakeSocket };
});
import { WorldPresenceClient } from './worldPresence';
import { WorldRoomChatClient, type WorldRoomChatSnapshot } from './roomChat';

const clients: Array<{ destroy(): void }> = [];
beforeEach(() => {
  vi.useFakeTimers();vi.setSystemTime(100_000);
  fixtures.auth.authenticated = true;fixtures.auth.schoolManaged = false;fixtures.auth.chatModeration.banned = false;
  fixtures.apiRequest.mockReset().mockResolvedValue({ token: 'signed-token', expiresAt: new Date(Date.now() + 300_000).toISOString() });
});
afterEach(() => { for (const client of clients.reverse()) client.destroy();clients.length = 0;fixtures.sockets.length = 0;vi.useRealTimers(); });
const presence = () => ({ roomCoordinates: { x: 1, y: 2 }, x: 1100, y: 1200,
  velocityX: 0, velocityY: 0, facing: 1, animationState: 'idle' as const, mode: 'play' as const, timestamp: Date.now() });
const baseline = (roomChat?: boolean) => ({ type: 'snapshot', peers: [], roomPopulations: {}, roomEditors: {}, roomPreviews: {}, roomChat });
function setup(chunks = [{ x: 0, y: 0 }]) {
  const options = { host: 'h', protocol: 'wss' as const, party: 'main', identity: { userId: 'alice', displayName: 'Alice', avatarId: 'default-player' } };
  const world = new WorldPresenceClient({ ...options, onSnapshot: vi.fn() });
  const snapshots: WorldRoomChatSnapshot[] = [];
  const chat = new WorldRoomChatClient({ ...options, sharedTransport: world.roomChatTransport, onSnapshot: (s) => snapshots.push(s) });
  clients.push(world, chat);world.setSubscribedShards(chunks);chat.setSubscribedShards(chunks);
  return { world, chat, snapshots };
}
function openShared(): void { for (const socket of [...fixtures.sockets]) { socket.open();socket.message(baseline(true)); } }

describe('chat leases the presence transport', () => {
  it.each(['guest', 'student', 'signed-in'])('sends fixed emotes as %s, sharing the text cooldown', (kind) => {
    const { world, chat } = setup(); openShared();
    world.updateLocalPresence(presence()); chat.updateLocalPresence(presence());
    fixtures.auth.authenticated = kind !== 'guest';
    fixtures.auth.schoolManaged = kind === 'student';
    expect(chat.sendEmote('wave')).toEqual({ ok: true });
    expect(JSON.parse(fixtures.sockets[0]!.sent.at(-1)!)).toEqual({ type: 'room-chat:emote', emote: 'wave' });
    expect(chat.sendEmote('heart')).toEqual({ ok: false, reason: 'rate-limited' });
    expect(chat.send('text')).toEqual({ ok: false,
      reason: kind === 'guest' ? 'unauthenticated' : kind === 'student' ? 'restricted' : 'rate-limited' });
    vi.advanceTimersByTime(1000);
    fixtures.auth.chatModeration.banned = true;
    expect(chat.sendEmote('gg')).toEqual({ ok: false, reason: 'restricted' });
  });

  it('publishes room, mode and PvP action changes immediately during an idle window', async () => {
    const { world } = setup(); openShared(); const socket = fixtures.sockets[0]!;
    const updates = () => socket.sent.map(raw => JSON.parse(raw)).filter(m => m.type === 'presence:update');
    world.updateLocalPresence(presence()); await vi.advanceTimersByTimeAsync(1);
    world.updateLocalPresence({ ...presence(), roomCoordinates: { x: 2, y: 2 } }); expect(updates()).toHaveLength(2);
    world.updateLocalPresence({ ...presence(), mode: 'edit' }); expect(updates()).toHaveLength(3);
    world.updateLocalPresence({ ...presence(), pvp: { matchId: 'arena', action: 'sword', actionUntil: Date.now() + 200 } });
    expect(updates()).toHaveLength(4);
  });

  it.each([false, true])('keeps movement throttling with PvP=%s while suppressing timestamp-only updates', async (pvp) => {
    const { world } = setup(); openShared(); const socket = fixtures.sockets[0]!;
    const payload = { ...presence(), ...(pvp ? { pvp: { matchId: 'arena', action: null, actionUntil: 0 } } : {}) };
    const updates = () => socket.sent.filter(raw => JSON.parse(raw).type === 'presence:update');
    world.updateLocalPresence(payload); await vi.advanceTimersByTimeAsync(25);
    world.updateLocalPresence({ ...payload, x: 1101 }); expect(updates()).toHaveLength(pvp ? 2 : 1);
    await vi.advanceTimersByTimeAsync(175);
    world.updateLocalPresence({ ...payload, x: 1102 }); expect(updates()).toHaveLength(pvp ? 3 : 2);
    await vi.advanceTimersByTimeAsync(1_000);
    world.updateLocalPresence({ ...payload, x: 1102, timestamp: Date.now() }); expect(updates()).toHaveLength(pvp ? 3 : 2);
  });

  it('coalesces idle refreshes while retaining movement and reconnect baselines', async () => {
    vi.setSystemTime(120_000);
    const { world } = setup(); openShared(); const socket = fixtures.sockets[0]!;
    world.updateLocalPresence(presence());
    const updates = () => socket.sent.map(raw => JSON.parse(raw)).filter(m => m.type === 'presence:update');
    for (let i = 0; i < 23; i++) {
      await vi.advanceTimersByTimeAsync(500); world.updateLocalPresence(presence());
    }
    expect(updates()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500); world.updateLocalPresence(presence()); expect(updates()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(200);
    world.updateLocalPresence({ ...presence(), x: 1101 }); expect(updates()).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(200);
    world.updateLocalPresence({ ...presence(), facing: -1 }); expect(updates()).toHaveLength(4);
    socket.disconnect(); socket.open(); expect(updates()).toHaveLength(5);
    expect(updates().at(-1).presence).toMatchObject({ facing: -1, x: 1100 });
  });

  it('uses nine physical connections and one token request with no speculative chat sockets', async () => {
    const chunks = Array.from({ length: 9 }, (_, i) => ({ x: i % 3 - 1, y: Math.floor(i / 3) - 1 }));
    const { snapshots } = setup(chunks);
    expect(fixtures.sockets).toHaveLength(9);
    const queries = await Promise.all(fixtures.sockets.map((s) => s.options.query()));
    expect(fixtures.apiRequest).toHaveBeenCalledTimes(1);
    expect(queries.every((q) => q.roomChat === '1' && q.previewDeltas === '1' && q.identityToken === 'signed-token')).toBe(true);
    openShared();expect(fixtures.sockets).toHaveLength(9);
    expect(snapshots.at(-1)?.connectedShards).toHaveLength(9);
  });

  it('sends focus to every shard only on room changes and restores it on reconnect', async () => {
    const { world } = setup([{ x: 0, y: 0 }, { x: 1, y: 0 }]);openShared();
    expect((await Promise.all(fixtures.sockets.map(s => s.options.query()))).every(q => q.presenceInterest === '1')).toBe(true);
    world.updateLocalPresence(presence());
    for (const socket of fixtures.sockets) {
      expect(socket.sent.map(raw => JSON.parse(raw)).filter(m => m.type === 'presence:interest').at(-1))
        .toEqual({ type: 'presence:interest', roomCoordinates: { x: 1, y: 2 } });
    }
    const before = fixtures.sockets.map(s => s.sent.filter(raw => JSON.parse(raw).type === 'presence:interest').length);
    for (let i = 0; i < 30; i++) world.updateLocalPresence({ ...presence(), x: 1100 + i });
    expect(fixtures.sockets.map(s => s.sent.filter(raw => JSON.parse(raw).type === 'presence:interest').length)).toEqual(before);
    world.updateLocalPresence({ ...presence(), roomCoordinates: { x: 8, y: 2 } });
    const socket = fixtures.sockets[0]!;socket.disconnect();socket.open();
    expect(socket.sent.map(raw => JSON.parse(raw)).at(-1)).toEqual({ type: 'presence:interest', roomCoordinates: { x: 8, y: 2 } });
    world.pauseForHiddenTab();world.updateLocalPresence({ ...presence(), roomCoordinates: { x: 9, y: 2 } });world.resumeAfterHiddenTab();
    for (const fresh of fixtures.sockets.filter(s => !s.closed)) {
      fresh.open();expect(fresh.sent.map(raw => JSON.parse(raw)).find(m => m.type === 'presence:interest'))
        .toEqual({ type: 'presence:interest', roomCoordinates: { x: 9, y: 2 } });
    }
    world.updateLocalPresence(null);
    for (const fresh of fixtures.sockets.filter(s => !s.closed)) expect(fresh.sent.map(raw => JSON.parse(raw)).at(-1))
      .toEqual({ type: 'presence:interest', roomCoordinates: null });
  });

  it('publishes one presence context, receives bubbles, and chat teardown leaves presence alive', () => {
    const { world, chat, snapshots } = setup();openShared();
    world.updateLocalPresence(presence());chat.updateLocalPresence(presence());
    const socket = fixtures.sockets[0]!;
    expect(socket.sent.filter((raw) => JSON.parse(raw).type === 'presence:update')).toHaveLength(1);
    const beforeRepeatedPresence = snapshots.length;
    for (let i = 0; i < 30; i++) chat.updateLocalPresence({ ...presence(), x: 1100 + i });
    expect(snapshots).toHaveLength(beforeRepeatedPresence);
    expect(chat.send('hello')).toEqual({ ok: true });
    expect(socket.sent.map((raw) => JSON.parse(raw)).at(-1)).toEqual({ type: 'room-chat:say', text: 'hello' });
    socket.message({ type: 'room-chat:message', message: { id: 'bubble', shardId: '0,0', userId: 'bob', displayName: 'Bob', avatarId: 'default-player',
      roomCoordinates: { x: 1, y: 2 }, roomId: '1,2', text: 'hi', createdAt: Date.now(), expiresAt: Date.now() + 6000 } });
    expect(snapshots.at(-1)?.latestMessage?.text).toBe('hi');
    chat.destroy();expect(socket.closed).toBe(false);
    expect(socket.sent.filter((raw) => JSON.parse(raw).type === 'presence:leave')).toHaveLength(0);
  });

  it('falls back only after an old server baseline and removes fallback after shared reconnect', () => {
    const { chat, snapshots } = setup();
    const socket = fixtures.sockets[0]!;socket.open();expect(fixtures.sockets).toHaveLength(1);
    socket.message(baseline());expect(fixtures.sockets).toHaveLength(2);
    const fallback = fixtures.sockets[1]!;fallback.open();chat.updateLocalPresence(presence());
    expect(chat.send('legacy')).toEqual({ ok: true });
    expect(fallback.sent.some((raw) => JSON.parse(raw).type === 'room-chat:say')).toBe(true);
    socket.disconnect();socket.open();socket.message(baseline(true));
    expect(fallback.closed).toBe(true);expect(snapshots.at(-1)?.connectedShards).toEqual(['0,0']);
    expect(fixtures.sockets.filter((s) => !s.closed)).toHaveLength(1);
  });

  it('pauses shared connections once, applies latest hidden subscriptions and renegotiates on return', () => {
    const { world, chat, snapshots } = setup();openShared();
    world.pauseForHiddenTab();chat.pauseForHiddenTab();
    expect(fixtures.sockets.every((s) => s.closed)).toBe(true);
    world.setSubscribedShards([{ x: 1, y: 0 }]);chat.setSubscribedShards([{ x: 1, y: 0 }]);
    expect(fixtures.sockets.filter((s) => !s.closed)).toHaveLength(0);
    world.resumeAfterHiddenTab();chat.resumeAfterHiddenTab();
    const socket = fixtures.sockets.at(-1)!;expect(socket.room).toBe('1,0');socket.open();socket.message(baseline(true));
    expect(snapshots.at(-1)?.connectedShards).toEqual(['1,0']);
    expect(fixtures.sockets.filter((s) => !s.closed)).toHaveLength(1);
  });

  it('retains client permission guards and rate limits with a shared socket', () => {
    const { chat } = setup();openShared();chat.updateLocalPresence(presence());
    fixtures.auth.authenticated = false;expect(chat.send('hi')).toEqual({ ok: false, reason: 'unauthenticated' });
    fixtures.auth.authenticated = true;fixtures.auth.schoolManaged = true;expect(chat.send('hi')).toEqual({ ok: false, reason: 'restricted' });
    fixtures.auth.schoolManaged = false;fixtures.auth.chatModeration.banned = true;expect(chat.send('hi')).toEqual({ ok: false, reason: 'restricted' });
    fixtures.auth.chatModeration.banned = false;expect(chat.send('hi')).toEqual({ ok: true });
    expect(chat.send('again')).toEqual({ ok: false, reason: 'rate-limited' });
    chat.updateLocalPresence(null);expect(chat.send('left')).toEqual({ ok: false, reason: 'not-playing' });
  });
});
