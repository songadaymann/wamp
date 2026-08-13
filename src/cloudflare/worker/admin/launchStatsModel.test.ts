import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_RANGES,
  buildLaunchStatsActorKey,
  compareIsoDesc,
  DEFAULT_ACTIVITY_RANGE_KEY,
  hoursAgoIso,
  inferSignupSource,
  maxIso,
  minutesAgoIso,
  parseOptionalInteger,
  stripRoomReferenceAccumulator,
} from './launchStatsModel';

describe('launch statistics model', () => {
  it('preserves range vocabulary and time boundaries', () => {
    const now = new Date('2026-08-13T16:00:00.000Z');
    expect(DEFAULT_ACTIVITY_RANGE_KEY).toBe('last24h');
    expect(ACTIVITY_RANGES.map(({ key, hours }) => [key, hours])).toEqual([
      ['last12h', 12],
      ['last24h', 24],
      ['last3d', 72],
      ['last7d', 168],
      ['last30d', 720],
    ]);
    expect(minutesAgoIso(now, 5)).toBe('2026-08-13T15:55:00.000Z');
    expect(hoursAgoIso(now, 24)).toBe('2026-08-12T16:00:00.000Z');
  });

  it('preserves actor, signup, numeric, and ordering normalization', () => {
    expect(inferSignupSource({ email: 'mail@example.test', wallet_address: ' 0xabc ' })).toBe('wallet');
    expect(inferSignupSource({ email: 'mail@example.test', wallet_address: null })).toBe('email');
    expect(inferSignupSource({ email: null, wallet_address: null })).toBe('unknown');
    expect(buildLaunchStatsActorKey('user-1', 'Ignored')).toBe('user:user-1');
    expect(buildLaunchStatsActorKey(null, ' Fixture User ')).toBe('name:fixture user');
    expect(parseOptionalInteger('12.6')).toBe(13);
    expect(parseOptionalInteger('not-a-number')).toBeNull();
    expect(['2026-01-01', '2026-03-01', '2026-02-01'].sort(compareIsoDesc)).toEqual([
      '2026-03-01',
      '2026-02-01',
      '2026-01-01',
    ]);
    expect(maxIso('2026-01-01', '2026-02-01')).toBe('2026-02-01');
  });

  it('removes only the internal room-reference timestamp', () => {
    expect(stripRoomReferenceAccumulator({
      roomId: '1,2',
      roomTitle: 'Fixture',
      roomX: 1,
      roomY: 2,
      attemptCount: null,
      claimCount: 1,
      publishCount: 2,
      lastAt: '2026-08-13T16:00:00.000Z',
    })).toEqual({
      roomId: '1,2',
      roomTitle: 'Fixture',
      roomX: 1,
      roomY: 2,
      attemptCount: null,
      claimCount: 1,
      publishCount: 2,
    });
  });
});
