import { describe, expect, it } from 'vitest';
import { cloneRoomSnapshot, createDefaultRoomSnapshot, createRoomVersionRecord, isRoomSnapshotBlank } from './roomModel';
import { buildRoomVersionFingerprint } from './roomVersionLineage';
import { buildRoomLeaderboardLineage, getManualRoomLeaderboardSourceValidationError } from './roomLeaderboardLineage';
import { parseRoomSnapshot } from '../cloudflare/worker/core/http';
import { cloneCourseSnapshot, createDefaultCourseSnapshot, getComparableCourseSnapshot, normalizeCourseSnapshot } from '../courses/model';
import { computeCourseSnapshotVerificationHash, computeRoomSnapshotVerificationHash } from '../cloudflare/worker/runs/verification';
import { type PlayerHearts } from '../player/hearts';

describe('heart settings, persisted versions and ranked compatibility', () => {
  it.each([1, 2, 3] as const)('round-trips %s hearts through writes and published history', async hearts => {
    const room = { ...createDefaultRoomSnapshot(), playerHearts: hearts };
    const parsed = await parseRoomSnapshot(new Request('https://example.test/api/rooms/0,0', {
      method: 'PUT', body: JSON.stringify(room),
    }), room.id);
    expect(parsed.playerHearts).toBe(hearts);
    expect(createRoomVersionRecord(parsed).snapshot.playerHearts).toBe(hearts);
    expect(isRoomSnapshotBlank(parsed)).toBe(hearts === 1);
    const course = { ...createDefaultCourseSnapshot('hearts'), playerHearts: hearts };
    expect(cloneCourseSnapshot(normalizeCourseSnapshot(JSON.parse(JSON.stringify(course)), course.id)).playerHearts).toBe(hearts);
  });

  it.each(['3', 0, 4, -1, 1.5, true, null, {}, []])('uses legacy rules for an invalid %j heart count', async value => {
    const room = createDefaultRoomSnapshot();
    const parsed = await parseRoomSnapshot(new Request('https://example.test', {
      method: 'PUT', body: JSON.stringify({ ...room, playerHearts: value }),
    }), room.id);
    expect(parsed.playerHearts).toBe(1);
    const course = createDefaultCourseSnapshot('hearts');
    expect(normalizeCourseSnapshot({ ...course, playerHearts: value }, course.id).playerHearts).toBe(1);
  });

  it('keeps legacy one-heart fingerprints and ranked hashes, but binds multi-heart challenges separately', async () => {
    const room = createDefaultRoomSnapshot(); const course = createDefaultCourseSnapshot('hearts');
    const oldRoom = { ...room }; delete oldRoom.playerHearts;
    const oldCourse = { ...course }; delete oldCourse.playerHearts;
    expect(cloneRoomSnapshot(oldRoom).playerHearts).toBe(1);
    expect(JSON.parse(buildRoomVersionFingerprint(room))).not.toHaveProperty('playerHearts');
    expect(getComparableCourseSnapshot(course)).not.toHaveProperty('playerHearts');
    expect(buildRoomVersionFingerprint(room)).toBe(buildRoomVersionFingerprint(oldRoom));
    expect(await computeRoomSnapshotVerificationHash(room)).toBe(await computeRoomSnapshotVerificationHash(oldRoom));
    expect(await computeCourseSnapshotVerificationHash(course)).toBe(await computeCourseSnapshotVerificationHash(oldCourse));
    for (const hearts of [2, 3] as const) {
      const changed = { ...room, playerHearts: hearts };
      expect(buildRoomVersionFingerprint(changed)).not.toBe(buildRoomVersionFingerprint(room));
      expect(await computeRoomSnapshotVerificationHash(changed)).not.toBe(await computeRoomSnapshotVerificationHash(room));
      expect(await computeCourseSnapshotVerificationHash({ ...course, playerHearts: hearts })).not.toBe(await computeCourseSnapshotVerificationHash(course));
    }
  });

  it('blocks manual or indirect leaderboard adoption across different heart counts', () => {
    const version = (n: number, hearts: PlayerHearts, source: number | null = null) => createRoomVersionRecord({
      ...createDefaultRoomSnapshot(), version: n, playerHearts: hearts,
      goal: { type: 'reach_exit', exit: { x: 100 + n * 16, y: 256 }, timeLimitMs: null },
    }, { leaderboardSourceVersion: source });
    const one = version(1, 1); const three = version(2, 3, 1); const newerThree = version(3, 3, 2);
    expect(getManualRoomLeaderboardSourceValidationError(three, one)).toContain('heart count');
    expect(getManualRoomLeaderboardSourceValidationError(newerThree, three)).toBeNull();
    const lineage = buildRoomLeaderboardLineage([one, three, newerThree], 3, 3);
    expect(lineage.byVersion.get(1)?.leaderboardFamilyVersions).toEqual([1]);
    expect(lineage.byVersion.get(3)?.leaderboardFamilyVersions).toEqual([2, 3]);
  });
});
