import { describe, expect, it } from 'vitest';
import { createDefaultRoomRecord } from '../../../persistence/roomRepository';
import { ROOM_EDIT_CONFLICT_MESSAGE } from '../../../persistence/roomEditConflict';
import { HttpError } from '../core/http';
import { assertDraftUnchangedSince } from './store';

const savedAt = '2026-10-03T12:00:00.000Z';
const savedElsewhereAt = '2026-10-03T12:30:00.000Z';

function claimedRoom(updatedAt: string) {
  const record = createDefaultRoomRecord('4,2', { x: 4, y: 2 });
  record.claimerUserId = 'builder';
  record.claimedAt = savedAt;
  record.draft.updatedAt = updatedAt;
  return record;
}

function conflictStatus(run: () => void): number | null {
  try {
    run();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).message).toBe(ROOM_EDIT_CONFLICT_MESSAGE);
    return (error as HttpError).status;
  }
}

describe('room edit conflicts', () => {
  it('refuses a write based on an older save than the one stored', () => {
    expect(conflictStatus(() => assertDraftUnchangedSince(claimedRoom(savedElsewhereAt), savedAt))).toBe(409);
  });

  it('refuses for published rooms too', () => {
    const record = createDefaultRoomRecord('4,2', { x: 4, y: 2 });
    record.draft.updatedAt = savedElsewhereAt;
    record.published = { ...record.draft, status: 'published' };
    expect(conflictStatus(() => assertDraftUnchangedSince(record, savedAt))).toBe(409);
  });

  it('allows a write based on the stored save', () => {
    expect(conflictStatus(() => assertDraftUnchangedSince(claimedRoom(savedAt), savedAt))).toBeNull();
  });

  it('allows writes that do not ask for the check (agents, other editors, Keep Mine)', () => {
    expect(conflictStatus(() => assertDraftUnchangedSince(claimedRoom(savedElsewhereAt), null))).toBeNull();
    expect(conflictStatus(() => assertDraftUnchangedSince(claimedRoom(savedElsewhereAt), undefined))).toBeNull();
  });

  it('allows the first save of a room that was never saved', () => {
    const placeholder = createDefaultRoomRecord('4,2', { x: 4, y: 2 });
    placeholder.draft.updatedAt = savedElsewhereAt;
    expect(conflictStatus(() => assertDraftUnchangedSince(placeholder, savedAt))).toBeNull();
  });
});
