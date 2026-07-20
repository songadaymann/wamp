import { describe, expect, it } from 'vitest';
import { dedupeResolvedProfilePublishedRoomEntries } from './store';

describe('profile expanded-room deduplication', () => {
  it('keeps one representative and prefers the expanded-room anchor', () => {
    const expandedRoom = {
      expandedRoomId: 'expanded-a',
      expandedRoomVersion: 3,
      title: 'Expanded',
      source: 'native_expanded_room' as const,
      legacyCourseId: null,
      cellCount: 2,
      anchorCoordinates: { x: 4, y: 5 },
      focusedCoordinates: { x: 5, y: 5 },
    };
    const rows = dedupeResolvedProfilePublishedRoomEntries([
      { roomId: '5,5', roomCoordinates: { x: 5, y: 5 }, roomTitle: 'Other', roomVersion: 7, goalType: 'reach_exit', publishedAt: '2026-07-17T00:00:00.000Z', expandedRoom },
      { roomId: '4,5', roomCoordinates: { x: 4, y: 5 }, roomTitle: 'Anchor', roomVersion: 8, goalType: 'reach_exit', publishedAt: '2026-07-16T00:00:00.000Z', expandedRoom: { ...expandedRoom, focusedCoordinates: { x: 4, y: 5 } } },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.roomId).toBe('4,5');
  });
});
