import type { PartyKitLaunchStats, PartyKitShardHeartbeat } from '../admin/model';
import type { ConnectionPresenceState } from './presenceProtocol';

export const METRICS_ROOM_ID = '__launch-stats__';
export const METRICS_STORAGE_PREFIX = 'shard:';
export const STALE_HEARTBEAT_MS = 120_000;

export function heartbeatStorageKey(shardId: string): string {
  return `${METRICS_STORAGE_PREFIX}${shardId}`;
}

export function normalizeHeartbeatPayload(value: unknown): PartyKitShardHeartbeat | null {
  if (!value || typeof value !== 'object') return null;

  const payload = value as Partial<PartyKitShardHeartbeat>;
  const updatedAtMs = Date.parse(String(payload.updatedAt ?? ''));
  const totalConnections = payload.totalConnections;
  const playConnections = payload.playConnections;
  const editConnections = payload.editConnections;
  if (
    typeof payload.shardId !== 'string' ||
    !payload.shardId.trim() ||
    payload.shardId === METRICS_ROOM_ID ||
    typeof totalConnections !== 'number' ||
    typeof playConnections !== 'number' ||
    typeof editConnections !== 'number' ||
    !Number.isInteger(totalConnections) ||
    !Number.isInteger(playConnections) ||
    !Number.isInteger(editConnections) ||
    totalConnections < 0 ||
    playConnections < 0 ||
    editConnections < 0 ||
    playConnections + editConnections > totalConnections ||
    !Number.isFinite(updatedAtMs)
  ) {
    return null;
  }
  return {
    shardId: payload.shardId,
    totalConnections,
    playConnections,
    editConnections,
    updatedAt: new Date(updatedAtMs).toISOString(),
  };
}

export function computeShardHeartbeat(
  shardId: string,
  states: Iterable<ConnectionPresenceState | null>,
  now: number,
): PartyKitShardHeartbeat | null {
  let totalConnections = 0;
  let playConnections = 0;
  let editConnections = 0;
  for (const state of states) {
    if (state?.channel !== 'presence') continue;
    totalConnections += 1;
    if (state.presence?.mode === 'play') playConnections += 1;
    else if (state.presence?.mode === 'edit') editConnections += 1;
  }
  if (totalConnections === 0) return null;
  return {
    shardId,
    totalConnections,
    playConnections,
    editConnections,
    updatedAt: new Date(now).toISOString(),
  };
}

export function partitionActiveHeartbeats(
  entries: Iterable<readonly [string, unknown]>,
  now: number,
): { heartbeats: PartyKitShardHeartbeat[]; staleKeys: string[] } {
  const heartbeats: PartyKitShardHeartbeat[] = [];
  const staleKeys: string[] = [];
  for (const [key, value] of entries) {
    const heartbeat = normalizeHeartbeatPayload(value);
    const updatedAtMs = heartbeat ? Date.parse(heartbeat.updatedAt) : Number.NaN;
    if (!heartbeat || !Number.isFinite(updatedAtMs) || now - updatedAtMs > STALE_HEARTBEAT_MS) {
      staleKeys.push(key);
    } else {
      heartbeats.push(heartbeat);
    }
  }
  heartbeats.sort(
    (left, right) =>
      right.totalConnections - left.totalConnections || left.shardId.localeCompare(right.shardId),
  );
  return { heartbeats, staleKeys };
}

export function buildLaunchStats(
  heartbeats: PartyKitShardHeartbeat[],
  staleShardCount: number,
  now: number,
): PartyKitLaunchStats {
  return {
    fetchedAt: new Date(now).toISOString(),
    shardCount: heartbeats.length,
    staleShardCount,
    totalConnections: heartbeats.reduce((sum, shard) => sum + shard.totalConnections, 0),
    totalPlayConnections: heartbeats.reduce((sum, shard) => sum + shard.playConnections, 0),
    totalEditConnections: heartbeats.reduce((sum, shard) => sum + shard.editConnections, 0),
    shards: heartbeats,
  };
}
