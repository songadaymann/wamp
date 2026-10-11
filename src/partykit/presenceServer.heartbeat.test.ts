import { afterEach, describe, expect, it, vi } from 'vitest';
import { METRICS_ROOM_ID } from './shardMetricsRuntime';
import { presencePayload, PresenceServerHarness, sendPresence } from './presenceServer.testHarness';

let harness: PresenceServerHarness | null = null;
afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe('shard heartbeats (F035)', () => {
  it('sends at most one forced heartbeat per shard every 3 s, then reports the latest state', async () => {
    harness = new PresenceServerHarness({ env: { PARTYKIT_INTERNAL_TOKEN: 'internal' } });
    const alice = await harness.connect('alice');
    expect(harness.room.metricsRequests).toHaveLength(1); // the join

    for (let room = 1; room <= 5; room += 1) {
      sendPresence(harness, alice, presencePayload({ roomX: room, roomY: 0 }));
      await harness.advance(100);
    }
    expect(harness.room.metricsRequests).toHaveLength(1);

    await harness.advance(3_000);
    expect(harness.room.metricsRequests).toHaveLength(2);
    const last = JSON.parse(String(harness.room.metricsRequests[1].init?.body)) as Record<string, unknown>;
    expect(last).toMatchObject({ shardId: harness.room.id });

    await harness.advance(10_000);
    expect(harness.room.metricsRequests).toHaveLength(2); // nothing changed since
  });

  it('prunes stale heartbeats at most once a minute instead of listing storage on every heartbeat', async () => {
    harness = new PresenceServerHarness({ roomId: METRICS_ROOM_ID, env: { PARTYKIT_INTERNAL_TOKEN: 'internal' } });
    const list = vi.spyOn(harness.room.storage, 'list');
    const post = (shardId: string) => harness!.server.onRequest(new Request(`https://presence.example.test/parties/main/${METRICS_ROOM_ID}/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-partykit-internal-token': 'internal' },
      body: JSON.stringify({ shardId, updatedAt: new Date().toISOString(), totalConnections: 1, playConnections: 0, editConnections: 0 }),
    }) as never);
    for (let i = 0; i < 5; i += 1) expect((await post(`world-shard-${i}`)).status).toBe(200);
    expect(list).toHaveBeenCalledTimes(1);
    await harness.advance(60_000);
    await post('world-shard-0');
    expect(list).toHaveBeenCalledTimes(2);
  });
});
