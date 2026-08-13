import type {
  LaunchStatsActivityRangeKey,
  LaunchStatsRecentRoomReference,
  LaunchStatsSignupSource,
} from '../../../admin/model';

export const DEFAULT_ACTIVITY_RANGE_KEY: LaunchStatsActivityRangeKey = 'last24h';
export const ACTIVITY_RANGES: Array<{
  key: LaunchStatsActivityRangeKey;
  label: string;
  description: string;
  hours: number;
}> = [
  { key: 'last12h', label: 'Last 12h', description: 'the last 12 hours', hours: 12 },
  { key: 'last24h', label: 'Last 24h', description: 'the last 24 hours', hours: 24 },
  { key: 'last3d', label: 'Last 3d', description: 'the last 3 days', hours: 72 },
  { key: 'last7d', label: 'Last 7d', description: 'the last 7 days', hours: 168 },
  { key: 'last30d', label: 'Last 30d', description: 'the last 30 days', hours: 720 },
];

export interface LaunchStatsRoomReferenceAccumulator
  extends LaunchStatsRecentRoomReference {
  lastAt: string;
}

export function minutesAgoIso(base: Date, minutes: number): string {
  return new Date(base.getTime() - minutes * 60 * 1000).toISOString();
}

export function hoursAgoIso(base: Date, hours: number): string {
  return new Date(base.getTime() - hours * 60 * 60 * 1000).toISOString();
}

export function inferSignupSource(row: {
  email: string | null;
  wallet_address: string | null;
}): LaunchStatsSignupSource {
  if (row.wallet_address?.trim()) return 'wallet';
  if (row.email?.trim()) return 'email';
  return 'unknown';
}

export function buildLaunchStatsActorKey(
  actorUserId: string | null,
  actorDisplayName: string,
): string {
  return actorUserId?.trim()
    ? `user:${actorUserId}`
    : `name:${actorDisplayName.trim().toLowerCase()}`;
}

export function stripRoomReferenceAccumulator(
  value: LaunchStatsRoomReferenceAccumulator,
): LaunchStatsRecentRoomReference {
  return {
    roomId: value.roomId,
    roomTitle: value.roomTitle,
    roomX: value.roomX,
    roomY: value.roomY,
    attemptCount: value.attemptCount,
    claimCount: value.claimCount,
    publishCount: value.publishCount,
  };
}

export function compareIsoDesc(left: string, right: string): number {
  return right.localeCompare(left);
}

export function maxIso(current: string, candidate: string): string {
  return candidate > current ? candidate : current;
}

export function parseOptionalInteger(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}
