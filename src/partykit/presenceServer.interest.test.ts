import { afterEach, describe, expect, it } from 'vitest';
import type { WorldGhostPresence } from './presenceProtocol';
import { PRESENCE_NEAR_LIMIT, normalizeInterestRoom } from './presenceInterest';
import { FakePresenceConnection, PresenceServerHarness, presencePayload, sendPresence } from './presenceServer.testHarness';
let h: PresenceServerHarness;
afterEach(() => h?.dispose());
function focus(c: FakePresenceConnection, x: number | null, y = 0): void {
  h.server.onMessage(JSON.stringify({ type: 'presence:interest', roomCoordinates: x === null ? null : { x, y } }), c.asPartyConnection());
}
function updates(c: FakePresenceConnection): WorldGhostPresence[] {
  return c.messages<{ type: string; peers?: WorldGhostPresence[] }>().filter(m => m.type === 'upserts').flatMap(m => m.peers ?? []);
}
async function viewer() { h = new PresenceServerHarness(); const c = await h.connect('viewer', { presenceInterest: true }); focus(c, 0); c.clearMessages(); return c; }
function publish(c: FakePresenceConnection, roomX = 0, x = roomX * 640 + 10, mode: 'play' | 'browse' = 'play') {
  sendPresence(h, c, presencePayload({ roomX, roomY: 0, x, mode }));
}
describe('F037 negotiated movement interest', () => {
  it('reads the current position when a far deadline overlaps the next fast batch', async () => {
    const v = await viewer(), far = await h.connect('far');publish(far, 6, 3900);await h.advance(80);
    await h.advance(990);publish(far, 6, 3901);await h.advance(10);
    expect(updates(v).filter(p => p.connectionId === 'far').map(p => p.x)).toEqual([3901]);
  });
  it('retains full snapshots and legacy full-rate updates; nearby remains fast and far gets the latest final update', async () => {
    const v = await viewer(), near = await h.connect('near'), far = await h.connect('far'), legacy = await h.connect('legacy');
    for (const c of [v, legacy]) c.clearMessages();
    publish(near); publish(far, 6); await h.advance(80);
    expect(updates(v).map(p => p.connectionId)).toEqual(['near']);
    expect(updates(legacy).map(p => p.connectionId)).toEqual(['near', 'far']);
    publish(far, 6, 4000); await h.advance(80); publish(far, 6, 4010); await h.advance(80);
    expect(updates(v).some(p => p.connectionId === 'far')).toBe(false);
    await h.advance(840);
    expect(updates(v).filter(p => p.connectionId === 'far').map(p => p.x)).toEqual([4010]);
    const joined = await h.connect('joined', { presenceInterest: true });
    const snapshot = joined.messages<{ type: string; presenceInterest?: boolean; peers: WorldGhostPresence[] }>().find(m => m.type === 'snapshot');
    expect(snapshot?.presenceInterest).toBe(true); expect(snapshot?.peers.map(p => p.connectionId).sort()).toEqual(['far', 'near']);
  });
  it.each(['close', 'leave', 'queued-leave'] as const)('never resurrects a removed peer after %s', async kind => {
    const v = await viewer(), far = await h.connect('far'); publish(far, 6);
    if (kind !== 'queued-leave') await h.advance(80);
    if (kind === 'close') h.close(far);
    else h.server.onMessage('{"type":"presence:leave"}', far.asPartyConnection());
    v.clearMessages(); await h.advance(1500); expect(updates(v)).toEqual([]);
  });
  it('refreshes newly relevant stationary peers on focus change and restores focus after reactivation', async () => {
    const v = await viewer(), far = await h.connect('far'); publish(far, 6, 3901); await h.advance(80); v.clearMessages();
    focus(v, 6); expect(updates(v)[0]?.x).toBe(3901);
    await h.advance(1000); v.clearMessages(); await h.reactivate(); publish(far, 6, 3902); await h.advance(80);
    expect(updates(v)[0]?.x).toBe(3902);
    v.clearMessages(); focus(v, null); publish(far, 6, 3903); await h.advance(80); expect(updates(v)).toEqual([]);
    await h.advance(1000); expect(updates(v)[0]?.x).toBe(3903);
  });
  it('uses world positions across negative chunk boundaries and includes all eight adjacent rooms', async () => {
    const v = await viewer(); focus(v, -1, -1);
    const expected: string[] = [];
    for (let x = -2; x <= 0; x++) for (let y = -2; y <= 0; y++) {
      const c = await h.connect(`${x},${y}`);expected.push(c.id);
      sendPresence(h, c, presencePayload({ roomX: x, roomY: y, x: x * 640 + 320, y: y * 352 + 176 }));
    }
    await h.advance(80); expect(updates(v).map(p => p.connectionId).sort()).toEqual(expected.sort());
  });
  it('keeps only the nearest 24 at full rate in a 300-peer room, with everyone retained at low rate', async () => {
    const v = await viewer(); const peers: FakePresenceConnection[] = [];
    for (let i = 0; i < 300; i++) { const c = await h.connect(`p${String(i).padStart(3, '0')}`);peers.push(c);publish(c, 0, 320 + i); }
    await h.advance(80); expect(updates(v)).toHaveLength(PRESENCE_NEAR_LIMIT);
    expect(updates(v).map(p => p.connectionId)).toEqual(peers.slice(0, 24).map(c => c.id));
    v.clearMessages();publish(peers[299]!, 0, 620);await h.advance(80);expect(updates(v)).toEqual([]);
    await h.advance(920);expect(updates(v)).toHaveLength(276);
    expect(new Set(updates(v).map(p => p.connectionId)).size).toBe(276);
    v.clearMessages();publish(v, 0, 619);await h.advance(80);
    expect(updates(v).some(p => p.connectionId === peers[299]!.id)).toBe(true);
    expect(updates(v)).toHaveLength(24);
  });
  it('keeps matching PvP movement immediate even outside the neighborhood', async () => {
    const v = await viewer(), opponent = await h.connect('opponent');
    const pvp = { matchId: 'match', action: null, actionUntil: 0 } as const;
    sendPresence(h, v, presencePayload({ roomX: 0, roomY: 0, pvp }));v.clearMessages();
    sendPresence(h, opponent, presencePayload({ roomX: 6, roomY: 0, pvp }));
    expect(updates(v).map(p => p.connectionId)).toEqual(['opponent']);
  });
  it('requires opt-in and a presence channel; malformed focus does not alter identity or local presence', async () => {
    const v = await viewer(), legacy = await h.connect('legacy'), chat = await h.connect('chat', { channel: 'room-chat', presenceInterest: true });
    for (const c of [v, legacy, chat]) {
      const before = structuredClone(c.state);
      for (const roomCoordinates of [{ x: 0.5, y: 0 }, { x: '0', y: 0 }, { x: 1e100, y: 0 }, undefined]) {
        h.server.onMessage(JSON.stringify({ type: 'presence:interest', roomCoordinates }), c.asPartyConnection());
      }
      expect(c.state).toEqual(before);
    }
    focus(legacy, 7);focus(chat, 7);expect(legacy.state?.interestRoom).toBeUndefined();expect(chat.state?.interestRoom).toBeUndefined();
    expect(normalizeInterestRoom({ x: -1, y: 8 })).toEqual({ x: -1, y: 8 });
  });
});
