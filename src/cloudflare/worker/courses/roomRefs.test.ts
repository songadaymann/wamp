import { describe, expect, it, vi } from 'vitest';
import type { CourseRoomRef } from '../../../courses/model';
import { resolveCourseRoomRefsForActor } from './roomRefs';

const STALE_REFS: CourseRoomRef[] = [
  {
    roomId: '-14,-3',
    coordinates: { x: -14, y: -3 },
    roomVersion: 2,
    roomTitle: 'Old upper cell',
  },
  {
    roomId: '-14,-4',
    coordinates: { x: -14, y: -4 },
    roomVersion: 2,
    roomTitle: 'Old lower cell',
  },
];

describe('expanded-room cell version resolution', () => {
  it('refreshes every cell to its latest published version for a new publish', async () => {
    const loadPublishedVersion = vi.fn(async (roomId: string, requestedVersion: number | null) => ({
      version: roomId === '-14,-4' ? 3 : 4,
      title: roomId === '-14,-4' ? 'Cyber lower cell' : 'Cyber upper cell',
      publishedByUserId: 'builder-1',
      requestedVersion,
    }));

    const resolved = await resolveCourseRoomRefsForActor(
      STALE_REFS,
      'builder-1',
      'latest_published',
      loadPublishedVersion,
    );

    expect(loadPublishedVersion.mock.calls).toEqual([
      ['-14,-3', null],
      ['-14,-4', null],
    ]);
    expect(resolved.map((roomRef) => [roomRef.roomId, roomRef.roomVersion])).toEqual([
      ['-14,-4', 3],
      ['-14,-3', 4],
    ]);
    expect(STALE_REFS.map((roomRef) => roomRef.roomVersion)).toEqual([2, 2]);
  });

  it('keeps pinned versions while saving a draft or loading historical content', async () => {
    const loadPublishedVersion = vi.fn(async (_roomId: string, requestedVersion: number | null) => ({
      version: requestedVersion ?? 99,
      title: null,
      publishedByUserId: 'builder-1',
    }));

    const resolved = await resolveCourseRoomRefsForActor(
      STALE_REFS,
      'builder-1',
      'pinned',
      loadPublishedVersion,
    );

    expect(loadPublishedVersion.mock.calls.map((call) => call[1])).toEqual([2, 2]);
    expect(resolved.map((roomRef) => roomRef.roomVersion)).toEqual([2, 2]);
  });

  it('still rejects a latest cell version published by another creator', async () => {
    await expect(resolveCourseRoomRefsForActor(
      STALE_REFS.slice(0, 1),
      'builder-1',
      'latest_published',
      async () => ({ version: 3, title: null, publishedByUserId: 'builder-2' }),
    )).rejects.toMatchObject({
      status: 403,
      message: 'All expanded room cells must be published by the same creator.',
    });
  });
});
