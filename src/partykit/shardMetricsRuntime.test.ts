import { describe, expect, it } from 'vitest';
import {
  buildLaunchStats,
  computeShardHeartbeat,
  heartbeatStorageKey,
  normalizeHeartbeatPayload,
  partitionActiveHeartbeats,
  STALE_HEARTBEAT_MS,
} from './shardMetricsRuntime';

describe('PartyKit shard metrics runtime', () => {
  it('normalizes exact integer heartbeat contracts', () => {
    const heartbeat = { shardId: 'world-1', totalConnections: 3, playConnections: 1, editConnections: 1, updatedAt: '2026-08-13T12:00:00-04:00' };
    expect(normalizeHeartbeatPayload(heartbeat)).toEqual({ ...heartbeat, updatedAt: '2026-08-13T16:00:00.000Z' });
    expect(normalizeHeartbeatPayload({ ...heartbeat, shardId: '__launch-stats__' })).toBeNull();
    expect(normalizeHeartbeatPayload({ ...heartbeat, totalConnections: 1.5 })).toBeNull();
    expect(normalizeHeartbeatPayload({ ...heartbeat, playConnections: 2, editConnections: 2 })).toBeNull();
    expect(heartbeatStorageKey('world-1')).toBe('shard:world-1');
  });

  it('counts presence sockets by mode while retaining browse in the total', () => {
    const state = (channel: 'presence' | 'room-chat', mode: 'browse' | 'play' | 'edit') => ({ channel, presence: { mode } }) as never;
    expect(computeShardHeartbeat('world', [state('presence', 'browse'), state('presence', 'play'), state('presence', 'edit'), state('room-chat', 'play')], 0)).toEqual({
      shardId: 'world', totalConnections: 3, playConnections: 1, editConnections: 1, updatedAt: '1970-01-01T00:00:00.000Z',
    });
    expect(computeShardHeartbeat('world', [state('room-chat', 'play')], 0)).toBeNull();
  });

  it('keeps the exact stale boundary, records invalid keys, and sorts active shards', () => {
    const now = Date.UTC(2026, 7, 13, 16);
    const item = (shardId: string, totalConnections: number, updatedAt: string) => ({ shardId, totalConnections, playConnections: 0, editConnections: 0, updatedAt });
    const result = partitionActiveHeartbeats([
      ['shard:b', item('b', 2, new Date(now - STALE_HEARTBEAT_MS).toISOString())],
      ['shard:a', item('a', 2, new Date(now - 1).toISOString())],
      ['shard:old', item('old', 4, new Date(now - STALE_HEARTBEAT_MS - 1).toISOString())],
      ['shard:bad', {}],
    ], now);
    expect(result.heartbeats.map(({ shardId }) => shardId)).toEqual(['a', 'b']);
    expect(result.staleKeys).toEqual(['shard:old', 'shard:bad']);
    expect(buildLaunchStats(result.heartbeats, result.staleKeys.length, now)).toMatchObject({
      fetchedAt: new Date(now).toISOString(), shardCount: 2, staleShardCount: 2, totalConnections: 4,
    });
  });
});
