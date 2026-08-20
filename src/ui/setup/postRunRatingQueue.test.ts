import { describe, expect, it } from 'vitest';
import type { RoomPostRunRatingRequestDetail } from '../../progression/postRunRatingEvents';
import { PostRunRatingQueue } from './postRunRatingQueue';

function makeRoomPrompt(
  contentId: string,
  contentTitle: string,
  version = 1,
): RoomPostRunRatingRequestDetail {
  return {
    contentType: 'room',
    contentId,
    contentTitle,
    roomCoordinates: { x: 0, y: 0 },
    version,
    previousViewerRank: null,
    elapsedMs: 12_000,
    deaths: 0,
    score: 100,
    autoSuggestedDifficulty: 'medium',
  };
}

describe('PostRunRatingQueue', () => {
  it('holds prompts until a batch is explicitly begun', () => {
    const queue = new PostRunRatingQueue();

    queue.enqueue({ mode: 'rating', detail: makeRoomPrompt('room-a', 'Room A') });

    expect(queue.getCurrent()).toBeNull();
    expect(queue.getSnapshot()).toEqual({ entries: [], currentIndex: -1, total: 0 });
    expect(queue.beginBatch()?.detail.contentId).toBe('room-a');
    expect(queue.getSnapshot()).toMatchObject({ currentIndex: 0, total: 1 });
  });

  it('deduplicates the same published room version while preserving a new version', () => {
    const queue = new PostRunRatingQueue();
    const prompt = makeRoomPrompt('room-a', 'Room A');

    expect(queue.enqueue({ mode: 'rating', detail: prompt })).toBe(true);
    expect(queue.enqueue({ mode: 'rating', detail: { ...prompt } })).toBe(false);
    expect(queue.enqueue({ mode: 'rating', detail: { ...prompt, version: 2 } })).toBe(true);

    queue.beginBatch();
    expect(queue.getSnapshot().total).toBe(2);
  });

  it('keeps a visible multi-room stack while rating and skipping through it', () => {
    const queue = new PostRunRatingQueue();
    queue.enqueue({ mode: 'rating', detail: makeRoomPrompt('room-a', 'Room A') });
    queue.enqueue({ mode: 'rating', detail: makeRoomPrompt('room-b', 'Room B') });
    queue.enqueue({ mode: 'rating', detail: makeRoomPrompt('room-c', 'Room C') });

    expect(queue.beginBatch()?.detail.contentTitle).toBe('Room A');
    queue.markCurrentRated();
    expect(queue.getSnapshot().entries.map((entry) => entry.status)).toEqual([
      'rated',
      'waiting',
      'waiting',
    ]);

    expect(queue.advanceCurrent('rated')?.detail.contentTitle).toBe('Room B');
    expect(queue.advanceCurrent('skipped')?.detail.contentTitle).toBe('Room C');
    expect(queue.getSnapshot().entries.map((entry) => entry.status)).toEqual([
      'rated',
      'skipped',
      'active',
    ]);
    expect(queue.advanceCurrent('rated')).toBeNull();
  });

  it('adds a late prompt to the active batch and dismisses the whole stack on close', () => {
    const queue = new PostRunRatingQueue();
    queue.enqueue({ mode: 'rating', detail: makeRoomPrompt('room-a', 'Room A') });
    queue.beginBatch();

    queue.enqueue({ mode: 'rating', detail: makeRoomPrompt('room-b', 'Room B') });
    expect(queue.getSnapshot().total).toBe(2);

    queue.dismissAll();
    expect(queue.getCurrent()).toBeNull();
    expect(queue.beginBatch()).toBeNull();
  });
});
