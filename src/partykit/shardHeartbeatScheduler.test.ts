import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShardHeartbeatScheduler, SHARD_HEARTBEAT_INTERVAL_MS } from './shardHeartbeatScheduler';
import type { PartyKitShardHeartbeat } from '../admin/model';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
afterEach(() => vi.useRealTimers());

function setup() {
  let alarmAt: number | null = null;
  let connections = 1;
  let enabled = true;
  const storage = { getAlarm: async () => alarmAt, setAlarm: vi.fn(async (at: number) => { alarmAt = at; }),
    deleteAlarm: vi.fn(async () => { alarmAt = null; }) };
  const send = vi.fn<(snapshot: PartyKitShardHeartbeat) => Promise<void>>(async () => {});
  const options = { storage, enabled: () => enabled, snapshot: () => ({ shardId: '0,0',
    totalConnections: connections, playConnections: connections, editConnections: 0, updatedAt: new Date().toISOString() }), send };
  const scheduler = new ShardHeartbeatScheduler(options);
  return { scheduler, options, send, storage, alarm: () => alarmAt,
    connections: (n: number) => { connections = n; }, enabled: (value: boolean) => { enabled = value; },
    fire: async (owner = scheduler) => { vi.setSystemTime(alarmAt!); alarmAt = null; await owner.alarm(); } };
}

describe('hibernating shard metrics', () => {
  it('sends the join immediately and keeps no JavaScript timers while idle', async () => {
    const h = setup(); await h.scheduler.changed();
    expect(h.send).toHaveBeenCalledTimes(1); expect(h.alarm()).toBe(Date.now() + SHARD_HEARTBEAT_INTERVAL_MS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('coalesces rapid changes into one earlier alarm containing the latest counts', async () => {
    const h = setup(); await h.scheduler.changed();
    h.connections(2); await h.scheduler.changed(); h.connections(9); await h.scheduler.changed();
    expect(h.alarm()).toBe(103_000); expect(h.send).toHaveBeenCalledTimes(1);
    await h.fire(); expect(h.send.mock.calls.at(-1)?.[0]).toMatchObject({ totalConnections: 9 });
    expect(h.alarm()).toBe(163_000); expect(vi.getTimerCount()).toBe(0);
  });

  it('refreshes counts through repeated cold starts without reviving an interval', async () => {
    const h = setup(); await h.scheduler.changed();
    for (let i = 0; i < 5; i++) {
      const restored = new ShardHeartbeatScheduler(h.options);
      await h.fire(restored);
      expect(h.alarm()).toBe(Date.now() + 60_000); expect(vi.getTimerCount()).toBe(0);
    }
    expect(h.send).toHaveBeenCalledTimes(6);
    expect(h.send.mock.calls.at(-1)?.[0]).toMatchObject({ updatedAt: new Date(400_000).toISOString() });
  });

  it('reports the last disconnect then leaves no recurring alarm', async () => {
    const h = setup(); await h.scheduler.changed(); h.connections(0); await h.scheduler.changed();
    await h.fire(); expect(h.send.mock.calls.at(-1)?.[0]).toMatchObject({ totalConnections: 0 });
    expect(h.alarm()).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels an old alarm if metrics are disabled', async () => {
    const h = setup(); await h.scheduler.changed(); h.enabled(false); await h.scheduler.changed();
    expect(h.alarm()).toBeNull(); expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('retains a future refresh on reporting failure and can recover', async () => {
    const h = setup(); h.send.mockRejectedValueOnce(new Error('metrics temporarily unavailable'));
    await expect(h.scheduler.changed()).rejects.toThrow('temporarily'); expect(h.alarm()).toBe(160_000);
    await h.fire(new ShardHeartbeatScheduler(h.options)); expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.alarm()).toBe(220_000); expect(vi.getTimerCount()).toBe(0);
  });
});
