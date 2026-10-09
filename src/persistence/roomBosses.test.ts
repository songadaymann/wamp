import { describe, expect, it } from 'vitest';
import { cloneRoomSnapshot, createDefaultRoomSnapshot, createRoomVersionRecord } from './roomModel';
import { buildRoomVersionFingerprint } from './roomVersionLineage';
import { buildRoomLeaderboardLineage, getManualRoomLeaderboardSourceValidationError } from './roomLeaderboardLineage';
import { parseRoomSnapshot } from '../cloudflare/worker/core/http';
import { computeRoomSnapshotVerificationHash } from '../cloudflare/worker/runs/verification';

const enemy = { id: 'swordsman_ai', x: 80, y: 256, instanceId: 'boss' };
const room = () => ({ ...createDefaultRoomSnapshot(), placedObjects: [enemy] });

describe('boss persistence and ranked compatibility', () => {
  it.each(['swordsman_ai', 'police_patrolman', 'policewoman'])('persists %s boss health through writes, clones and history', async id => {
    const original = { ...room(), placedObjects: [{ ...enemy, id, bossHitPoints: 7 }] };
    const parsed = await parseRoomSnapshot(new Request('https://example.test', { method: 'PUT', body: JSON.stringify(original) }), original.id);
    expect(parsed.placedObjects[0].bossHitPoints).toBe(7);
    expect(cloneRoomSnapshot(parsed).placedObjects[0].bossHitPoints).toBe(7);
    expect(createRoomVersionRecord(parsed).snapshot.placedObjects[0].bossHitPoints).toBe(7);
  });
  it('strips invalid, unsupported and invincible bosses and leaves legacy hashes unchanged', async () => {
    const legacy = room();
    for (const bossHitPoints of [null, undefined, '5', 2, 11, 3.5, true]) {
      const candidate = { ...legacy, placedObjects: [{ ...enemy, bossHitPoints }] } as never;
      expect(cloneRoomSnapshot(candidate).placedObjects[0].bossHitPoints).toBeNull();
      expect(buildRoomVersionFingerprint(candidate)).toBe(buildRoomVersionFingerprint(legacy));
      expect(await computeRoomSnapshotVerificationHash(candidate)).toBe(await computeRoomSnapshotVerificationHash(legacy));
    }
    expect(cloneRoomSnapshot({ ...legacy, placedObjects: [{ ...enemy, id: 'coin_gold', bossHitPoints: 5 }] }).placedObjects[0].bossHitPoints).toBeNull();
    expect(cloneRoomSnapshot({ ...legacy, placedObjects: [{ ...enemy, swordsmanDefeatMode: 'invincible', bossHitPoints: 5 }] }).placedObjects[0].bossHitPoints).toBeNull();
    for (const bossHitPoints of [3, 10]) {
      const boss = { ...legacy, placedObjects: [{ ...enemy, bossHitPoints }] };
      expect(buildRoomVersionFingerprint(boss)).not.toBe(buildRoomVersionFingerprint(legacy));
      expect(await computeRoomSnapshotVerificationHash(boss)).not.toBe(await computeRoomSnapshotVerificationHash(legacy));
    }
  });
  it('prevents direct and indirect leaderboard adoption across boss health changes', () => {
    const version = (n: number, hits: number | null, source: number | null = null) => createRoomVersionRecord({
      ...room(), version: n, placedObjects: [{ ...enemy, bossHitPoints: hits }],
      goal: { type: 'reach_exit', exit: { x: 100 + n * 16, y: 256 }, timeLimitMs: null },
    }, { leaderboardSourceVersion: source });
    const one = version(1, null); const three = version(2, 3, 1); const ten = version(3, 10, 2); const laterTen = version(4, 10, 3);
    expect(getManualRoomLeaderboardSourceValidationError(three, one)).toContain('boss configuration');
    expect(getManualRoomLeaderboardSourceValidationError(ten, three)).toContain('boss configuration');
    expect(getManualRoomLeaderboardSourceValidationError(laterTen, ten)).toBeNull();
    const lineage = buildRoomLeaderboardLineage([one, three, ten, laterTen], 4, 4);
    expect(lineage.byVersion.get(1)?.leaderboardFamilyVersions).toEqual([1]);
    expect(lineage.byVersion.get(2)?.leaderboardFamilyVersions).toEqual([2]);
    expect(lineage.byVersion.get(4)?.leaderboardFamilyVersions).toEqual([3, 4]);
  });
});
