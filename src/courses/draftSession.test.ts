import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultCourseRecord, cloneCourseRecord } from './model';
import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import { isRoomEditConflict, ROOM_EDIT_CONFLICT_MESSAGE } from '../persistence/roomEditConflict';
import {
  acknowledgeActiveCourseDraftSessionSave,
  clearActiveCourseDraftSession,
  clearActiveCourseDraftSessionRoomOverride,
  dropStaleActiveCourseDraftSessionRoomOverride,
  getActiveCourseDraftSessionRoomOverride,
  getActiveCourseDraftSessionRoomOverrideBase,
  setActiveCourseDraftSessionRoomOverride,
  hasActiveCourseDraftSessionUnsavedRooms,
  isActiveCourseDraftSessionRoomUnsaved,
  setActiveCourseDraftSessionRoomUnsaved,
  getActiveCourseDraftSessionRecord,
  getActiveCourseDraftSessionPersistedDraft,
  isActiveCourseDraftSessionDirty,
  setActiveCourseDraftSessionRecord,
  updateActiveCourseDraftSession,
} from './draftSession';

beforeEach(() => clearActiveCourseDraftSession());

describe('expanded-room session persistence baseline', () => {
  it('keeps the actual baseline and dirty state across composer/editor wakes', () => {
    const record = createDefaultCourseRecord();
    setActiveCourseDraftSessionRecord(record);
    updateActiveCourseDraftSession((draft) => { draft.title = 'Unsaved'; });
    setActiveCourseDraftSessionRecord(getActiveCourseDraftSessionRecord(), { preserveBaseline: true });
    expect(isActiveCourseDraftSessionDirty()).toBe(true);
    expect(getActiveCourseDraftSessionPersistedDraft()?.title).toBeNull();
  });

  it('advances the baseline after Save while retaining edits made in flight as dirty', () => {
    const record = createDefaultCourseRecord();
    setActiveCourseDraftSessionRecord(record);
    updateActiveCourseDraftSession((draft) => { draft.title = 'Sent'; });
    const sent = getActiveCourseDraftSessionRecord()!.draft;
    updateActiveCourseDraftSession((draft) => { draft.title = 'New edit'; });
    const saved = cloneCourseRecord(record);
    saved.draft = { ...sent, updatedAt: '2099-01-01T00:00:00.000Z' };
    const current = acknowledgeActiveCourseDraftSessionSave(sent, saved);
    expect(current?.draft.title).toBe('New edit');
    expect(isActiveCourseDraftSessionDirty()).toBe(true);
    expect(getActiveCourseDraftSessionPersistedDraft()?.title).toBe('Sent');
    acknowledgeActiveCourseDraftSessionSave(current!.draft, { ...saved, draft: current!.draft });
    expect(isActiveCourseDraftSessionDirty()).toBe(false);
  });

  it('does not apply an old Save response to a different active expanded room', () => {
    const old = createDefaultCourseRecord();
    const next = createDefaultCourseRecord();
    next.draft.title = 'Different room';
    setActiveCourseDraftSessionRecord(next);
    acknowledgeActiveCourseDraftSessionSave(old.draft, old);
    expect(getActiveCourseDraftSessionRecord()?.draft.id).toBe(next.draft.id);
    expect(getActiveCourseDraftSessionRecord()?.draft.title).toBe('Different room');
  });
  it('keeps cell unsaved warnings across editor/composer handoff and removes them only for saved or removed cells', () => {
    const record = createDefaultCourseRecord();
    record.draft.roomRefs = [{ roomId: '1,2', coordinates: { x: 1, y: 2 }, roomVersion: 1, roomTitle: null }];
    setActiveCourseDraftSessionRecord(record);
    setActiveCourseDraftSessionRoomUnsaved('1,2', true);
    expect(isActiveCourseDraftSessionDirty()).toBe(false);
    expect(hasActiveCourseDraftSessionUnsavedRooms()).toBe(true);
    setActiveCourseDraftSessionRecord(getActiveCourseDraftSessionRecord(), { preserveBaseline: true });
    expect(isActiveCourseDraftSessionRoomUnsaved('1,2')).toBe(true);
    setActiveCourseDraftSessionRoomUnsaved('1,2', false);
    expect(hasActiveCourseDraftSessionUnsavedRooms()).toBe(false);
    setActiveCourseDraftSessionRoomUnsaved('1,2', true);
    updateActiveCourseDraftSession((draft) => { draft.roomRefs = []; });
    expect(hasActiveCourseDraftSessionUnsavedRooms()).toBe(false);
  });

});

describe('expanded-room cell overrides remember their server version (F379)', () => {
  it('keeps the base only with the override it was recorded for', () => {
    const record = createDefaultCourseRecord();
    record.draft.roomRefs = [{ roomId: '3,4', coordinates: { x: 3, y: 4 }, roomVersion: 1, roomTitle: null }];
    setActiveCourseDraftSessionRecord(record);
    const room = createDefaultRoomSnapshot('3,4', { x: 3, y: 4 });
    setActiveCourseDraftSessionRoomOverride(room, '2026-10-22T10:00:00.000Z');
    expect(getActiveCourseDraftSessionRoomOverrideBase('3,4')).toBe('2026-10-22T10:00:00.000Z');
    setActiveCourseDraftSessionRoomOverride(room);
    expect(getActiveCourseDraftSessionRoomOverrideBase('3,4')).toBeNull();
    setActiveCourseDraftSessionRoomOverride(room, '2026-10-22T11:00:00.000Z');
    clearActiveCourseDraftSessionRoomOverride('3,4');
    expect(getActiveCourseDraftSessionRoomOverrideBase('3,4')).toBeNull();
  });

  it('drops a clean copy once the cell was saved elsewhere, but never an edited one', () => {
    const record = createDefaultCourseRecord();
    record.draft.roomRefs = [
      { roomId: '1,2', coordinates: { x: 1, y: 2 }, roomVersion: 1, roomTitle: null },
      { roomId: '3,4', coordinates: { x: 3, y: 4 }, roomVersion: 1, roomTitle: null },
      { roomId: '5,6', coordinates: { x: 5, y: 6 }, roomVersion: 1, roomTitle: null },
    ];
    setActiveCourseDraftSessionRecord(record);
    const base = '2026-10-22T10:00:00.000Z';
    const newer = '2026-10-22T11:00:00.000Z';
    setActiveCourseDraftSessionRoomOverride(createDefaultRoomSnapshot('1,2', { x: 1, y: 2 }), base);
    setActiveCourseDraftSessionRoomOverride(createDefaultRoomSnapshot('3,4', { x: 3, y: 4 }), base);
    setActiveCourseDraftSessionRoomUnsaved('3,4', true);
    setActiveCourseDraftSessionRoomOverride(createDefaultRoomSnapshot('5,6', { x: 5, y: 6 }));

    expect(dropStaleActiveCourseDraftSessionRoomOverride('1,2', { updatedAt: base, stored: true })).toBe(false);
    // Nothing stored on the server yet: its timestamp is new on every load, so the copy is kept.
    expect(dropStaleActiveCourseDraftSessionRoomOverride('1,2', { updatedAt: newer, stored: false })).toBe(false);
    expect(getActiveCourseDraftSessionRoomOverride('1,2')).not.toBeNull();
    expect(dropStaleActiveCourseDraftSessionRoomOverride('1,2', { updatedAt: newer, stored: true })).toBe(true);
    expect(getActiveCourseDraftSessionRoomOverride('1,2')).toBeNull();
    expect(getActiveCourseDraftSessionRoomOverrideBase('1,2')).toBeNull();
    // Edited: kept, so the save is refused and the conflict offered instead of losing the edit.
    expect(dropStaleActiveCourseDraftSessionRoomOverride('3,4', { updatedAt: newer, stored: true })).toBe(false);
    expect(getActiveCourseDraftSessionRoomOverride('3,4')).not.toBeNull();
    // No recorded base (made by the single-room editor): nothing to compare, so kept.
    expect(dropStaleActiveCourseDraftSessionRoomOverride('5,6', { updatedAt: newer, stored: true })).toBe(false);
    expect(getActiveCourseDraftSessionRoomOverride('5,6')).not.toBeNull();
  });

  it('recognises only the server conflict refusal', () => {
    expect(isRoomEditConflict(Object.assign(new Error(ROOM_EDIT_CONFLICT_MESSAGE), { status: 409 }))).toBe(true);
    expect(isRoomEditConflict(Object.assign(new Error('Room is locked.'), { status: 409 }))).toBe(false);
    expect(isRoomEditConflict(Object.assign(new Error(ROOM_EDIT_CONFLICT_MESSAGE), { status: 500 }))).toBe(false);
    expect(isRoomEditConflict(null)).toBe(false);
  });
});
