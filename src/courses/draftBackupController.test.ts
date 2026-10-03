import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ userId: 'alice' as string | null, choice: vi.fn(async () => true) }));
vi.mock('../auth/client', () => ({ getAuthDebugState: () => ({ user: mock.userId ? { id: mock.userId } : null }) }));
vi.mock('../presence/worldPresence', () => ({ resolveWorldPresenceGuestIdentity: () => ({ userId: 'guest-one' }) }));
vi.mock('../scenes/editor/localRecoveryPrompt', () => ({ chooseLocalDraftRecovery: mock.choice }));
import { CourseDraftBackupController, RECOVERED_EXPANDED_DRAFT_TEXT } from './draftBackupController';
import { ExpandedRoomDraftBackup } from './localDraftBackup';
import { createDefaultCourseRecord } from './model';
import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import {
  clearActiveCourseDraftSession,
  getActiveCourseDraftSessionRecord,
  getActiveCourseDraftSessionPersistedDraft,
  isActiveCourseDraftSessionDirty,
  updateActiveCourseDraftSession,
} from './draftSession';

let storage: Storage;
beforeEach(() => {
  clearActiveCourseDraftSession();
  mock.userId = 'alice';
  mock.choice.mockReset().mockResolvedValue(true);
  const values = new Map<string, string>();
  storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } as Storage;
  vi.stubGlobal('window', { localStorage: storage });
});
afterEach(() => vi.unstubAllGlobals());

function recordFixture() {
  const record = createDefaultCourseRecord();
  record.permissions.canSaveDraft = true;
  record.ownerUserId = 'alice';
  return record;
}

describe('expanded draft backup scene controller', () => {
  it('restores metadata as dirty, preserves the remote baseline and reports recovery', async () => {
    const remote = recordFixture();
    const backup = new ExpandedRoomDraftBackup('user:alice', () => storage);
    backup.writeCourse({ ...remote.draft, title: 'Recovered title' }, remote.draft);
    const controller = new CourseDraftBackupController();
    const current = await controller.open(remote, false);
    expect(current.draft.title).toBe('Recovered title');
    expect(isActiveCourseDraftSessionDirty()).toBe(true);
    expect(getActiveCourseDraftSessionPersistedDraft()?.title).toBeNull();
    expect(controller.recoveryStatus).toBe(RECOVERED_EXPANDED_DRAFT_TEXT);
    expect(mock.choice).not.toHaveBeenCalled();
    await controller.open(current, true);
    expect(isActiveCourseDraftSessionDirty()).toBe(true);
  });

  it('offers divergent metadata for review and rebases explicitly restored edits against the newer remote', async () => {
    const remote = recordFixture();
    const backup = new ExpandedRoomDraftBackup('user:alice', () => storage);
    backup.writeCourse({ ...remote.draft, title: 'Local' }, remote.draft);
    const newer = { ...remote, draft: { ...remote.draft, title: 'Account', updatedAt: '2099-01-01T00:00:00.000Z' } };
    const controller = new CourseDraftBackupController();
    const restored = await controller.open(newer, false);
    expect(mock.choice).toHaveBeenCalledTimes(1);
    expect(restored.draft.title).toBe('Local');
    expect(getActiveCourseDraftSessionPersistedDraft()?.title).toBe('Account');
    expect(backup.recoverCourse(newer.draft).status).toBe('recovered');
  });

  it('uses the account draft when chosen and discards only the rejected metadata backup', async () => {
    const remote = recordFixture();
    const backup = new ExpandedRoomDraftBackup('user:alice', () => storage);
    backup.writeCourse({ ...remote.draft, title: 'Local' }, remote.draft);
    const room = createDefaultRoomSnapshot('1,2', { x: 1, y: 2 });
    backup.writeRoom(remote.draft.id, { ...room, title: 'Unsaved cell' }, room);
    mock.choice.mockResolvedValue(false);
    const newer = { ...remote, draft: { ...remote.draft, title: 'Account', updatedAt: '2099-01-01T00:00:00.000Z' } };
    const controller = new CourseDraftBackupController();
    expect((await controller.open(newer, false)).draft.title).toBe('Account');
    expect(isActiveCourseDraftSessionDirty()).toBe(false);
    expect(backup.recoverCourse(newer.draft).status).toBe('none');
    expect(backup.recoverRoom(remote.draft.id, room).status).toBe('recovered');
  });

  it('preserves and rebases in-flight metadata edits after the account save and clears only the final saved revision', async () => {
    const remote = recordFixture();
    const controller = new CourseDraftBackupController();
    await controller.open(remote, false);
    updateActiveCourseDraftSession((draft) => { draft.title = 'Sent'; });
    const sent = getActiveCourseDraftSessionRecord()!.draft;
    controller.flushCourse();
    updateActiveCourseDraftSession((draft) => { draft.title = 'New edit'; });
    controller.flushCourse();
    const saved = { ...remote, draft: { ...sent, updatedAt: '2099-01-01T00:00:00.000Z' } };
    expect(controller.savedCourse(sent, saved).draft.title).toBe('New edit');
    const backup = new ExpandedRoomDraftBackup('user:alice', () => storage);
    expect(backup.recoverCourse(saved.draft).status).toBe('recovered');
    const final = getActiveCourseDraftSessionRecord()!;
    controller.savedCourse(final.draft, final);
    expect(backup.recoverCourse(final.draft).status).toBe('none');
    expect(isActiveCourseDraftSessionDirty()).toBe(false);
  });

  it('does not write a previous account draft after the signed-in identity changes', async () => {
    const controller = new CourseDraftBackupController();
    await controller.open(recordFixture(), false);
    updateActiveCourseDraftSession((draft) => { draft.title = 'Alice private edit'; });
    mock.userId = 'bob';
    expect(controller.flushCourse()).toBe(false);
    const record = getActiveCourseDraftSessionRecord()!;
    expect(new ExpandedRoomDraftBackup('user:bob', () => storage).recoverCourse(record.draft).status).toBe('none');
  });
});
