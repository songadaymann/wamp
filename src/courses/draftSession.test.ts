import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultCourseRecord, cloneCourseRecord } from './model';
import {
  acknowledgeActiveCourseDraftSessionSave,
  clearActiveCourseDraftSession,
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
});
