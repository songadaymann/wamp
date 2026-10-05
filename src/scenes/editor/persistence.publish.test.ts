import { prepareBuildPromptEntry, completeBuildPromptEntry } from '../../buildPrompts/publishing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneRoomSnapshot, createDefaultRoomRecord } from '../../persistence/roomRepository';
import { requestRoomPublishName } from '../../publishing/events';
import { capturePublishProgression, reportPublishProgression } from '../../publishing/feedback';
import type { EditorRoomSession } from './roomSession';
import { EditorPersistenceController } from './persistence';

const state = vi.hoisted(() => ({ userId: 'builder' as string | null }));
vi.mock('../../buildPrompts/publishing', () => ({ prepareBuildPromptEntry: vi.fn(async () => ({ slug: null })), completeBuildPromptEntry: vi.fn(async () => {}) }));
vi.mock('../../auth/client', () => ({ getAuthDebugState: () => ({ authenticated: !!state.userId, user: { id: state.userId } }) }));
vi.mock('../../publishing/events', () => ({ requestRoomPublishName: vi.fn(async () => 'Treasure Hunt'), suggestRoomTitle: () => 'A suggested name' }));
vi.mock('../../publishing/feedback', () => ({ capturePublishProgression: vi.fn(async () => null), reportPublishProgression: vi.fn(async () => {}) }));
vi.mock('../../ui/appFeedback', () => ({ getAppFeedbackDebugState: () => ({}), showBusyOverlay: vi.fn(), hideBusyOverlay: vi.fn(), showBusyError: vi.fn() }));
vi.mock('../../analytics/replay/editorEvents', () => ({ recordReplayEditorAction: vi.fn() }));

function fixture(title: string | null = null, version = 0) {
  const record = createDefaultRoomRecord('1,2', { x: 1, y: 2 }); record.draft.title = title;
  const publishRoom = vi.fn(async () => {
    record.published = { ...cloneRoomSnapshot(record.draft), status: 'published', version: 7 };
    record.lastPublishedByUserId = state.userId; return record;
  });
  const session = { currentRoomId: '1,2', currentPublishedVersion: version, getPublishValidationError: () => null, publishRoom, setStatusText: vi.fn(), maybeAutoSave: vi.fn() };
  const host = { getRoomPermissions: () => record.permissions, getRoomTitle: () => record.draft.title, setRoomTitle: (title: string | null) => { record.draft.title = title; },
    getRoomDirty: () => false, setRoomDirty: vi.fn(), getLastDirtyAt: () => 1, setLastDirtyAt: vi.fn(), getInitialRoomSnapshot: () => record.draft,
    syncActiveCourseRoomSessionSnapshot: vi.fn(), onRoomMarkedDirty: vi.fn(), onRoomPublished: vi.fn() };
  const controller = new EditorPersistenceController(session as unknown as EditorRoomSession, host);
  return { controller, record, session, host, publishRoom };
}
beforeEach(() => { vi.clearAllMocks(); state.userId = 'builder'; vi.mocked(requestRoomPublishName).mockResolvedValue('Treasure Hunt'); vi.mocked(prepareBuildPromptEntry).mockResolvedValue({ slug: null }); });
afterEach(() => vi.restoreAllMocks());

describe('explicit first publication', () => {
  it('includes the chosen title in the first actual publish and recognizes a first version above 1', async () => {
    const f = fixture(); await f.controller.publishRoom();
    expect(requestRoomPublishName).toHaveBeenCalledOnce(); expect(f.record.published?.title).toBe('Treasure Hunt');
    expect(f.host.onRoomPublished).toHaveBeenCalledWith(f.record.published, true, 'builder');
    expect(reportPublishProgression).toHaveBeenCalledWith(expect.objectContaining({ title: 'Treasure Hunt' }));
  });
  it('enters only the actual saved publication after an explicit checkbox choice', async () => {
    vi.mocked(prepareBuildPromptEntry).mockResolvedValue({ slug: 'fixture-week' });
    const f = fixture('Already named', 6); await f.controller.publishRoom();
    expect(completeBuildPromptEntry).toHaveBeenCalledExactlyOnceWith({ slug: 'fixture-week' }, 'builder', 'room:1,2', 7, 'Already named');
    f.publishRoom.mockResolvedValueOnce(null!); await f.controller.publishRoom(); expect(completeBuildPromptEntry).toHaveBeenCalledOnce();
  });
  it('cancelling or changing account during the prompt choice stops the publication', async () => {
    vi.mocked(prepareBuildPromptEntry).mockResolvedValue(null); const f = fixture('Named');
    expect(await f.controller.publishRoom()).toBeNull(); expect(f.publishRoom).not.toHaveBeenCalled();
    let resolve!: (choice: { slug: string | null }) => void; vi.mocked(prepareBuildPromptEntry).mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = f.controller.publishRoom(); state.userId = 'other'; resolve({ slug: 'fixture-week' }); await pending; expect(f.publishRoom).not.toHaveBeenCalled();
  });
  it('cancellation makes no title change or publish request', async () => {
    vi.mocked(requestRoomPublishName).mockResolvedValue(null); const f = fixture();
    expect(await f.controller.publishRoom()).toBeNull(); expect(f.record.draft.title).toBeNull();
    expect(f.publishRoom).not.toHaveBeenCalled(); expect(capturePublishProgression).not.toHaveBeenCalled();
  });
  it('keeps later versions quiet and never celebrates a failed publish', async () => {
    const f = fixture('Already named', 6); await f.controller.publishRoom();
    expect(requestRoomPublishName).not.toHaveBeenCalled(); expect(f.host.onRoomPublished).toHaveBeenCalledWith(f.record.published, false, 'builder');
    f.host.onRoomPublished.mockClear(); f.publishRoom.mockResolvedValueOnce(null!);
    await f.controller.publishRoom(); expect(f.host.onRoomPublished).not.toHaveBeenCalled();
  });
  it('discards a pending name after changing room/account and rejects duplicate publish clicks', async () => {
    let resolve!: (title: string | null) => void;
    vi.mocked(requestRoomPublishName).mockImplementation(() => new Promise(done => { resolve = done; }));
    const f = fixture(), pending = f.controller.publishRoom();
    f.controller.maybeAutoSave(false); expect(f.session.maybeAutoSave).not.toHaveBeenCalled();
    expect(await f.controller.publishRoom()).toBeNull(); f.session.currentRoomId = '3,4'; state.userId = 'other'; resolve('A name');
    expect(await pending).toBeNull(); expect(f.publishRoom).not.toHaveBeenCalled(); expect(f.record.draft.title).toBeNull();
    f.controller.maybeAutoSave(false); expect(f.session.maybeAutoSave).toHaveBeenCalledOnce();
  });
  it('leaves the guest save/sign-in path intact without claiming a publication', async () => {
    state.userId = null; const f = fixture(); f.publishRoom.mockResolvedValueOnce(null!);
    await f.controller.publishRoom(); expect(requestRoomPublishName).not.toHaveBeenCalled();
    expect(f.publishRoom).toHaveBeenCalledOnce(); expect(f.host.onRoomPublished).not.toHaveBeenCalled();
  });
  it('does not announce private World or local-only records as public rooms', async () => {
    const f = fixture('World room'); f.record.world = { worldId: 'private' } as NonNullable<typeof f.record.world>;
    await f.controller.publishRoom(); expect(f.host.onRoomPublished).not.toHaveBeenCalled();
  });
});
