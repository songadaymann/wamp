import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectState, WebSocket as WorkerWebSocket } from '@cloudflare/workers-types';
import { handleCloudflarePresence, PresenceDurableObject, presenceRoomFromUrl } from './durableObject';
import type { Env } from '../worker/core/types';
import { createTestIdentityToken, presencePayload, testIdentity } from '../../partykit/presenceServer.testHarness';
import type { ConnectionPresenceState } from '../../partykit/presenceProtocol';

const secret = 'cloudflare-presence-local-test';
class Socket {
  readyState = 1; sent: string[] = []; closes: number[] = [];
  attachment: { id: string; uri: string; state: ConnectionPresenceState };
  constructor(id: string) { this.attachment = { id, uri: 'https://presence.test/parties/main/0,0', state: {
    channel: 'presence', presenceInterest: true, interestRoom: { x: 0, y: 0 }, canSendRoomChat: true,
    canReceiveRoomChat: true, school: false, userId: 'user-'+id, displayName: id, avatarId: 'default-player',
    presence: null, lastRoomChatSentAt: 0, lastPvpInviteSentAt: 0,
  } }; }
  serializeAttachment(a: Socket['attachment']) { this.attachment = structuredClone(a); }
  deserializeAttachment() { return structuredClone(this.attachment); }
  send(m: string) { this.sent.push(m); }
  close(code: number) { this.closes.push(code); this.readyState = 3; }
  messages() { return this.sent.map(m => JSON.parse(m)); }
  worker() { return this as unknown as WorkerWebSocket; }
}
function context(sockets: Socket[]) {
  const data = new Map<string, unknown>([['__wamp_presence_room', '0,0']]);
  const ctx = { storage: {
    get: async (key: string) => data.get(key), put: async (key: string, value: unknown) => { data.set(key, value); },
    list: async ({prefix}: {prefix:string}) => new Map([...data.entries()].filter(([key])=>key.startsWith(prefix))),
    delete: async (key:string) => data.delete(key),
    getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {},
  }, waitUntil: (work: Promise<void>) => { void work; }, getWebSockets: () => sockets.map(s => s.worker()), blockConcurrencyWhile: async (fn:()=>Promise<void>) => fn() };
  return ctx as unknown as DurableObjectState;
}
afterEach(() => vi.useRealTimers());
describe('Cloudflare presence routing and hibernation adapter', () => {
  it.each(['0,0','-2,-1','pvp:match-uuid','__launch-stats__','world:uuid:1,2'])('preserves room identity %s', name => {
    expect(presenceRoomFromUrl(new URL('https://api.wamp.land/parties/main/'+encodeURIComponent(name)))).toBe(name);
  });
  it.each(['/parties/main/','/parties/other/0,0','/parties/main/%ZZ','/parties/main/a%2Fb','/parties/main/%00','/parties/main/'+ 'a'.repeat(161)])('rejects invalid room path %s',path => {
    expect(presenceRoomFromUrl(new URL('https://api.wamp.land'+path))).toBeNull();
  });
  it('rejects missing/invalid identities and metrics access before creating a Durable Object', async () => {
    const get = vi.fn();const env = { PARTYKIT_IDENTITY_TOKEN_SECRET: secret, PARTYKIT_INTERNAL_TOKEN:'metrics',PRESENCE_ROOMS:{idFromName:get,get} } as unknown as Env;
    for(const token of ['', 'bad']) expect((await handleCloudflarePresence(new Request('https://api.wamp.land/parties/main/0,0?identityToken='+token,{headers:{Upgrade:'websocket'}}),env)).status).toBe(401);
    expect((await handleCloudflarePresence(new Request('https://api.wamp.land/parties/main/__launch-stats__/stats'),env)).status).toBe(403);
    expect((await handleCloudflarePresence(new Request('https://api.wamp.land/parties/main/0,0'),env)).status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });
  it('routes verified identities and protected metrics through deterministic room IDs', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('forwarded'));const idFromName=vi.fn(name=>name),get=vi.fn(()=>({fetch}));
    const env={PARTYKIT_IDENTITY_TOKEN_SECRET:secret,PARTYKIT_INTERNAL_TOKEN:'metrics',PRESENCE_ROOMS:{idFromName,get}} as unknown as Env;
    const token=await createTestIdentityToken(testIdentity('viewer'),'auth',secret);
    expect((await handleCloudflarePresence(new Request('https://api.wamp.land/parties/main/0,0?identityToken='+token,{headers:{Upgrade:'websocket'}}),env)).status).toBe(200);
    expect(idFromName).toHaveBeenLastCalledWith('0,0');
    expect((await handleCloudflarePresence(new Request('https://api.wamp.land/parties/main/__launch-stats__/stats',{headers:{'x-partykit-internal-token':'metrics'}}),env)).status).toBe(200);
    expect(idFromName).toHaveBeenLastCalledWith('__launch-stats__');expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('restores attachments/focus after hibernation and removes a closing connection before broadcasts', async () => {
    vi.useFakeTimers();const viewer=new Socket('viewer'),peer=new Socket('peer'),ctx=context([viewer,peer]);
    let room=new PresenceDurableObject(ctx,{PARTYKIT_IDENTITY_TOKEN_SECRET:secret} as Env);
    await room.webSocketMessage(peer.worker(),JSON.stringify({type:'presence:update',presence:presencePayload({roomX:0,roomY:0,x:320})}));
    await vi.advanceTimersByTimeAsync(1100);expect(viewer.messages().some(m=>m.type==='upserts'&&m.peers[0]?.x===320)).toBe(true);
    expect(peer.attachment.state.presence?.x).toBe(320);viewer.sent=[];
    room=new PresenceDurableObject(ctx,{PARTYKIT_IDENTITY_TOKEN_SECRET:secret} as Env);
    await room.webSocketMessage(peer.worker(),JSON.stringify({type:'presence:update',presence:presencePayload({roomX:0,roomY:0,x:321})}));
    await vi.advanceTimersByTimeAsync(80);expect(viewer.messages().find(m=>m.type==='upserts')?.peers[0].x).toBe(321);
    peer.readyState=2;await room.webSocketClose(peer.worker());expect(peer.closes).toEqual([1000]);
    expect(viewer.messages().some(m=>m.type==='remove'&&m.connectionId==='peer')).toBe(true);
    viewer.sent=[];await vi.advanceTimersByTimeAsync(1200);expect(viewer.messages().filter(m=>m.type==='upserts')).toEqual([]);
    await room.webSocketClose(peer.worker());expect(peer.closes).toEqual([1000]);
  });
  it('bounds UTF-8 messages, ignores binary/invalid messages and rejects mismatched direct room routes', async () => {
    vi.useFakeTimers();const peer=new Socket('peer');const room=new PresenceDurableObject(context([peer]),{} as Env);
    await room.webSocketMessage(peer.worker(),new ArrayBuffer(8));await room.webSocketMessage(peer.worker(),'not json');
    expect(peer.attachment.state.presence).toBeNull();expect(peer.closes).toEqual([]);
    await room.webSocketMessage(peer.worker(),'é'.repeat(600000));expect(peer.closes).toEqual([1009]);
    expect((await room.fetch(new Request('https://presence.test/parties/main/1,0'))).status).toBe(404);
  });
});
