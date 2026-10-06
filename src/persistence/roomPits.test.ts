import { describe, expect, it } from 'vitest';
import { cloneRoomSnapshot, createDefaultRoomSnapshot, createRoomVersionRecord, isRoomSnapshotBlank } from './roomModel';
import { buildRoomVersionFingerprint } from './roomVersionLineage';
import { parseRoomSnapshot } from '../cloudflare/worker/core/http';
import { cloneCourseSnapshot, createDefaultCourseSnapshot, getComparableCourseSnapshot, normalizeCourseSnapshot } from '../courses/model';
import { computeCourseSnapshotVerificationHash, computeRoomSnapshotVerificationHash } from '../cloudflare/worker/runs/verification';

describe('opt-in pit settings across snapshot boundaries', () => {
  it('defaults all new and legacy rooms and expanded rooms to off', () => {
    const room = createDefaultRoomSnapshot();
    const course = createDefaultCourseSnapshot('pits');
    expect(room.pitsAreDeadly).toBe(false);
    expect(course.pitsAreDeadly).toBe(false);
    delete room.pitsAreDeadly;
    delete course.pitsAreDeadly;
    expect(cloneRoomSnapshot(room).pitsAreDeadly).toBe(false);
    expect(normalizeCourseSnapshot(course, course.id).pitsAreDeadly).toBe(false);
  });

  it.each([true, false])('round-trips %s through the room write API and published history', async enabled => {
    const room = { ...createDefaultRoomSnapshot(), pitsAreDeadly: enabled };
    const parsed = await parseRoomSnapshot(new Request('https://example.test/api/rooms/0,0', {
      method: 'PUT', body: JSON.stringify(room),
    }), room.id);
    expect(parsed.pitsAreDeadly).toBe(enabled);
    expect(createRoomVersionRecord(parsed).snapshot.pitsAreDeadly).toBe(enabled);
    expect(isRoomSnapshotBlank(parsed)).toBe(!enabled);
    const course = { ...createDefaultCourseSnapshot('pits'), pitsAreDeadly: enabled };
    expect(cloneCourseSnapshot(normalizeCourseSnapshot(JSON.parse(JSON.stringify(course)), course.id)).pitsAreDeadly).toBe(enabled);
  });

  it.each(['true', 1, null, {}, []])('requires an explicit boolean true, ignoring %j', async value => {
    const room = createDefaultRoomSnapshot();
    const parsed = await parseRoomSnapshot(new Request('https://example.test', {
      method: 'PUT', body: JSON.stringify({ ...room, pitsAreDeadly: value }),
    }), room.id);
    expect(parsed.pitsAreDeadly).toBe(false);
    const course = createDefaultCourseSnapshot('pits');
    expect(normalizeCourseSnapshot({ ...course, pitsAreDeadly: value }, course.id).pitsAreDeadly).toBe(false);
  });

  it('keeps old off fingerprints and ranked bindings, while enabled pits change both', async () => {
    const room = createDefaultRoomSnapshot();
    const course = createDefaultCourseSnapshot('pits');
    const oldRoom = { ...room }; delete oldRoom.pitsAreDeadly;
    const oldCourse = { ...course }; delete oldCourse.pitsAreDeadly;
    expect(buildRoomVersionFingerprint(room)).toBe(buildRoomVersionFingerprint(oldRoom));
    expect(getComparableCourseSnapshot(course)).toEqual(getComparableCourseSnapshot(oldCourse));
    expect(await computeRoomSnapshotVerificationHash(room)).toBe(await computeRoomSnapshotVerificationHash(oldRoom));
    expect(await computeCourseSnapshotVerificationHash(course)).toBe(await computeCourseSnapshotVerificationHash(oldCourse));
    const deadlyRoom = { ...room, pitsAreDeadly: true };
    const deadlyCourse = { ...course, pitsAreDeadly: true };
    expect(buildRoomVersionFingerprint(deadlyRoom)).not.toBe(buildRoomVersionFingerprint(room));
    expect(getComparableCourseSnapshot(deadlyCourse)).not.toEqual(getComparableCourseSnapshot(course));
    expect(await computeRoomSnapshotVerificationHash(deadlyRoom)).not.toBe(await computeRoomSnapshotVerificationHash(room));
    expect(await computeCourseSnapshotVerificationHash(deadlyCourse)).not.toBe(await computeCourseSnapshotVerificationHash(course));
  });
});
