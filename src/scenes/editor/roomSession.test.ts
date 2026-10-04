import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneRoomSnapshot, createDefaultRoomRecord, createRoomSummaryFromRecord, RoomApiError, type RoomRecord, type RoomRepository, type RoomSnapshot } from '../../persistence/roomRepository';
import { ROOM_STORAGE_PREFIX } from '../../persistence/browserStorage';
import { EditorRoomSession } from './roomSession';
import { showBusyError } from '../../ui/appFeedback';
import { ROOM_EDIT_CONFLICT_MESSAGE } from '../../persistence/roomEditConflict';
import { writeRoomDraftBackup } from '../../persistence/localDraftBackup';
import { refreshAuthSession } from '../../auth/client';
import { createStarterRoomSnapshot } from '../../ui/setup/firstSteps';

const authState = vi.hoisted(() => ({ authenticated: false }));
vi.mock('../../auth/client', () => ({
  getAuthDebugState: () => ({ authenticated: authState.authenticated }),
  refreshAuthSession: vi.fn(async () => {}),
}));
vi.mock('../../ui/appFeedback', () => ({ showBusyError: vi.fn(), showBusyOverlay: vi.fn(), hideBusyOverlay: vi.fn(), updateBusyOverlay: vi.fn() }));
vi.mock('../../mint/roomMetadataRender', () => ({ renderRoomSnapshotToPngDataUrl: vi.fn() }));

const coordinates = { x: 0, y: 1 };
const roomId = '0,1';
const savedAt = '2026-09-08T12:00:00.000Z';
const openedAt = '2026-09-08T13:00:00.000Z';

describe('room lifecycle backup recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('recovers an intentional empty edit over nonblank initial/published terrain and keeps it dirty', async () => {
    vi.setSystemTime(savedAt);
    const remote = createDefaultRoomRecord(roomId, coordinates);
    remote.claimerUserId = 'builder';
    remote.claimedAt = savedAt;
    remote.draft.tileData.terrain[9][9] = 17;
    remote.published = { ...remote.draft, status: 'published' };
    const erased = createDefaultRoomRecord(roomId, coordinates).draft;
    vi.setSystemTime(openedAt);
    writeRoomDraftBackup(erased, { userId: null, baseUpdatedAt: remote.draft.updatedAt });
    const { session, applyRoomSnapshot } = reopen(remote);
    await session.loadPersistedRoom(remote.draft);
    expect(applyRoomSnapshot).toHaveBeenCalledWith(expect.objectContaining({ tileData: erased.tileData }));
    expect(session.statusText).toContain('Recovered local');
    expect(session.hasPendingEditConflict).toBe(false);
  });

  it('does not restore a backup made by a different signed-in user', async () => {
    vi.setSystemTime(savedAt);
    const remote = createDefaultRoomRecord(roomId, coordinates);
    const local = createDefaultRoomRecord(roomId, coordinates).draft;
    local.tileData.terrain[9][9] = 17;
    vi.setSystemTime(openedAt);
    writeRoomDraftBackup(local, { userId: 'different-account', baseUpdatedAt: remote.draft.updatedAt });
    const { session, applyRoomSnapshot } = reopen(remote);
    await session.loadPersistedRoom(null);
    expect(applyRoomSnapshot).toHaveBeenCalledWith(expect.objectContaining({ tileData: remote.draft.tileData }));
  });

  it('keeps newer server edits instead of restoring an older remote baseline', async () => {
    vi.setSystemTime(savedAt);
    const local = createDefaultRoomRecord(roomId, coordinates).draft;
    local.tileData.terrain[9][9] = 17;
    const base = local.updatedAt;
    vi.setSystemTime(openedAt);
    writeRoomDraftBackup(local, { userId: null, baseUpdatedAt: base });
    const remote = createDefaultRoomRecord(roomId, coordinates);
    remote.claimerUserId = 'builder';
    remote.claimedAt = savedAt;
    remote.draft.tileData.terrain[9][9] = 33;
    const { session, applyRoomSnapshot } = reopen(remote);
    await session.loadPersistedRoom(null);
    expect(applyRoomSnapshot).toHaveBeenCalledWith(expect.objectContaining({ tileData: remote.draft.tileData }));
    expect(session.hasPendingEditConflict).toBe(true);
    expect(vi.mocked(showBusyError).mock.calls.at(-1)?.[1]).toMatchObject({ retryLabel: 'Restore Local' });
    // This also covers a Save committing after the tab closes: newer unsaved
    // local edits have the old baseline, but remain recoverable by choice.
    await vi.mocked(showBusyError).mock.calls.at(-1)?.[1]?.retryHandler?.();
    expect(applyRoomSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ tileData: local.tileData }));
    expect(session.hasPendingEditConflict).toBe(false);
  });
});

function makeStoredDraft(blank = false): RoomRecord {
  vi.setSystemTime(savedAt);
  const record = createDefaultRoomRecord(roomId, coordinates);
  record.claimerUserId = 'local-user';
  record.claimedAt = savedAt;
  if (!blank) record.draft.tileData.terrain[9][9] = 17;
  return record;
}

function reopen(remote: RoomRecord) {
  const applyRoomSnapshot = vi.fn();
  const setRoomDirty = vi.fn();
  const repository = {
    loadRoomCurrent: vi.fn(async () => ({ summary: createRoomSummaryFromRecord(remote), draft: remote.draft, published: remote.published })),
  } as unknown as RoomRepository;
  const session = new EditorRoomSession(repository, {
    applyRoomSnapshot, exportRoomSnapshot: () => remote.draft,
    getPublishValidationError: () => null, getRoomDirty: () => false,
    setRoomDirty, getLastDirtyAt: () => 0, refreshUi: vi.fn(),
    refreshSurroundingRoomPreviews: vi.fn(),
  });
  session.currentRoomId = roomId;
  session.currentRoomCoordinates = coordinates;
  return { session, applyRoomSnapshot, setRoomDirty };
}

describe('guest draft recovery when reopening the editor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('restores saved tiles when a missing remote room returns a newer blank placeholder', async () => {
    const saved = makeStoredDraft();
    localStorage.setItem(`${ROOM_STORAGE_PREFIX}${roomId}`, JSON.stringify(saved));
    vi.setSystemTime(openedAt);
    const remote = createDefaultRoomRecord(roomId, coordinates);
    const { session, applyRoomSnapshot } = reopen(remote);
    expect(await session.loadPersistedRoom(null)).toBe(true);
    expect(applyRoomSnapshot).toHaveBeenCalledWith(expect.objectContaining({ tileData: saved.draft.tileData }));
  });

  it('keeps a newer actual account draft even when it is blank', async () => {
    localStorage.setItem(`${ROOM_STORAGE_PREFIX}${roomId}`, JSON.stringify(makeStoredDraft()));
    vi.setSystemTime(openedAt);
    const remote = createDefaultRoomRecord(roomId, coordinates);
    remote.claimerUserId = 'account-owner';
    remote.claimedAt = openedAt;
    const { session, applyRoomSnapshot } = reopen(remote);
    await session.loadPersistedRoom(null);
    expect(applyRoomSnapshot).toHaveBeenCalledWith(expect.objectContaining({ tileData: remote.draft.tileData }));
  });

  it('does not resurrect an older local draft over a newer published room', async () => {
    localStorage.setItem(`${ROOM_STORAGE_PREFIX}${roomId}`, JSON.stringify(makeStoredDraft()));
    vi.setSystemTime(openedAt);
    const remote = createDefaultRoomRecord(roomId, coordinates);
    remote.draft.tileData.terrain[9][9] = 33;
    remote.published = { ...remote.draft, status: 'published' };
    const { session, applyRoomSnapshot } = reopen(remote);
    await session.loadPersistedRoom(null);
    expect(applyRoomSnapshot).toHaveBeenCalledWith(expect.objectContaining({ tileData: remote.draft.tileData }));
  });

  it('opens the remote snapshot when this browser has no saved draft', async () => {
    vi.setSystemTime(savedAt);
    const remote = createDefaultRoomRecord(roomId, coordinates);
    remote.draft.tileData.terrain[9][9] = 33;
    vi.setSystemTime(openedAt);
    const { session, applyRoomSnapshot } = reopen(remote);
    await session.loadPersistedRoom(null);
    expect(applyRoomSnapshot).toHaveBeenCalledWith(expect.objectContaining({ tileData: remote.draft.tileData }));
  });

  it('backs up an unsaved starter through the normal dirty-draft path', async () => {
    const remote = createDefaultRoomRecord(roomId, coordinates);
    const { session, applyRoomSnapshot, setRoomDirty } = reopen(remote);
    await session.loadPersistedRoom(createStarterRoomSnapshot(roomId, coordinates));
    expect(applyRoomSnapshot).toHaveBeenCalledWith(expect.objectContaining({ title: 'My First Room' }));
    expect(setRoomDirty).toHaveBeenCalledWith(true);
  });

  it('preserves a remote edit that arrived while a starter was opening', async () => {
    const remote = createDefaultRoomRecord(roomId, coordinates); remote.draft.title = 'New server draft';
    const { session, applyRoomSnapshot, setRoomDirty } = reopen(remote);
    await session.loadPersistedRoom(createStarterRoomSnapshot(roomId, coordinates));
    expect(applyRoomSnapshot).toHaveBeenCalledWith(expect.objectContaining({ title: 'New server draft' }));
    expect(setRoomDirty).not.toHaveBeenCalled();
  });

  it('keeps a forced guest snapshot title through the first account save and skips unrelated local recovery', async () => {
    const saved = makeStoredDraft(); saved.draft.title = 'Original guest room';
    const local = makeStoredDraft(); local.draft.title = 'Old local backup';
    localStorage.setItem(`${ROOM_STORAGE_PREFIX}${roomId}`, JSON.stringify(local));
    vi.setSystemTime(openedAt);
    const remote = createDefaultRoomRecord(roomId, coordinates);
    const { session, applyRoomSnapshot } = reopen(remote);
    await session.loadPersistedRoom(saved.draft, { forceInitialRoomSnapshot: true });
    expect(applyRoomSnapshot).toHaveBeenCalledWith(expect.objectContaining({ title: 'Original guest room', tileData: saved.draft.tileData }));
    expect(session.currentRoomTitle).toBe('Original guest room');
    expect(session.statusText).not.toContain('Recovered local');
  });

  it('keeps newer nonblank remote content even without ownership metadata', async () => {
    localStorage.setItem(`${ROOM_STORAGE_PREFIX}${roomId}`, JSON.stringify(makeStoredDraft()));
    vi.setSystemTime(openedAt);
    const remote = createDefaultRoomRecord(roomId, coordinates);
    remote.draft.tileData.terrain[9][9] = 33;
    const { session, applyRoomSnapshot } = reopen(remote);
    await session.loadPersistedRoom(null);
    expect(applyRoomSnapshot).toHaveBeenCalledWith(expect.objectContaining({ tileData: remote.draft.tileData }));
  });

  it('still recovers a local edit that is newer than a persisted remote draft', async () => {
    vi.setSystemTime(savedAt);
    const remote = createDefaultRoomRecord(roomId, coordinates);
    remote.claimerUserId = 'account-owner';
    remote.claimedAt = savedAt;
    const saved = makeStoredDraft();
    saved.draft.updatedAt = openedAt;
    localStorage.setItem(`${ROOM_STORAGE_PREFIX}${roomId}`, JSON.stringify(saved));
    const { session, applyRoomSnapshot } = reopen(remote);
    await session.loadPersistedRoom(null);
    expect(applyRoomSnapshot).toHaveBeenCalledWith(expect.objectContaining({ tileData: saved.draft.tileData }));
  });
});

describe('signed-in autosave after a failed save', () => {
  let now = 0;
  let values: Map<string, string>;

  beforeEach(() => {
    authState.authenticated = true;
    now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.stubGlobal('window', { localStorage });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    authState.authenticated = false;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function editingSession(saveDraft: () => Promise<RoomRecord>) {
    const room = createDefaultRoomRecord(roomId, coordinates);
    room.draft.tileData.terrain[9][9] = 17;
    let dirty = true;
    const repository = {
      saveDraft: vi.fn(saveDraft),
      getLastPersistenceTarget: () => 'remote',
    } as unknown as RoomRepository;
    const session = new EditorRoomSession(repository, {
      applyRoomSnapshot: vi.fn(), exportRoomSnapshot: () => room.draft,
      getPublishValidationError: () => null, getRoomDirty: () => dirty,
      setRoomDirty: (value: boolean) => { dirty = value; }, getLastDirtyAt: () => 100, refreshUi: vi.fn(),
      refreshSurroundingRoomPreviews: vi.fn(),
    });
    session.currentRoomId = roomId;
    session.currentRoomCoordinates = coordinates;
    return { session, repository, room, isDirty: () => dirty };
  }

  async function runFrames(session: EditorRoomSession, ms: number): Promise<void> {
    const end = now + ms;
    while (now < end) {
      session.maybeAutoSave(false);
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      now += 16;
    }
  }

  const backupKey = `${ROOM_STORAGE_PREFIX}${roomId}`;

  it('backs off instead of retrying every frame, and keeps a copy on this device', async () => {
    const { session, repository, room, isDirty } = editingSession(async () => { throw new TypeError('Failed to fetch'); });
    await runFrames(session, 5_000);

    // Attempts at ~1s, ~3s (2s later) and then not again until ~7s.
    expect(vi.mocked(repository.saveDraft).mock.calls.length).toBe(2);
    expect(isDirty()).toBe(true);
    expect(session.statusDetails.text).toBe('Draft save failed. Retrying soon. Your changes are kept on this device.');
    const backup = JSON.parse(values.get(backupKey) ?? 'null') as RoomRecord;
    expect(backup.draft.tileData.terrain[9][9]).toBe(room.draft.tileData.terrain[9][9]);
  });

  it('stops retrying errors that retrying cannot fix and says why', async () => {
    const { session, repository } = editingSession(async () => {
      throw new RoomApiError('Only the room claimer can save drafts for this unpublished room.', 403);
    });
    await runFrames(session, 60_000);

    expect(vi.mocked(repository.saveDraft).mock.calls.length).toBe(1);
    expect(session.statusDetails.text).toBe(
      'Draft save failed. Only the room claimer can save drafts for this unpublished room. Your changes are kept on this device.'
    );
    expect(values.has(backupKey)).toBe(true);
  });

  it('clears the device copy and resumes normal autosave once a save succeeds', async () => {
    let online = false;
    const { session, repository, room, isDirty } = editingSession(async () => {
      if (!online) throw new TypeError('Failed to fetch');
      return room;
    });
    await runFrames(session, 1_000);
    expect(values.has(backupKey)).toBe(true);

    online = true;
    await runFrames(session, 3_000);
    expect(vi.mocked(repository.saveDraft).mock.calls.length).toBe(2);
    expect(isDirty()).toBe(false);
    expect(values.has(backupKey)).toBe(false);
  });
});

describe('edits made while a room save or publish is pending', () => {
  const baselineAt = '2026-10-03T12:00:00.000Z';
  const responseAt = '2026-10-03T12:01:00.000Z';
  let values: Map<string, string>;

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  }

  beforeEach(() => {
    authState.authenticated = true;
    vi.mocked(refreshAuthSession).mockReset().mockResolvedValue(undefined);
    values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.stubGlobal('window', { localStorage });
  });
  afterEach(() => {
    authState.authenticated = false;
    vi.mocked(refreshAuthSession).mockReset().mockResolvedValue(undefined);
    vi.unstubAllGlobals();
  });

  async function openedEditor() {
    const record = createDefaultRoomRecord(roomId, coordinates);
    record.draft.updatedAt = baselineAt;
    record.draft.title = 'Original title';
    record.draft.tileData.terrain[9][9] = 17;
    record.claimerUserId = 'builder';
    record.claimedAt = baselineAt;
    let snapshot = cloneRoomSnapshot(record.draft);
    let dirty = false;
    let lastDirtyAt = 100;
    const response = deferred<RoomRecord>();
    const saveDraft = vi.fn().mockReturnValue(response.promise);
    const publish = vi.fn().mockReturnValue(response.promise);
    const repository = {
      loadRoomCurrent: vi.fn(async () => ({ summary: createRoomSummaryFromRecord(record), draft: record.draft, published: null })),
      saveDraft, publish, getLastPersistenceTarget: () => 'remote',
    } as unknown as RoomRepository;
    const session: EditorRoomSession = new EditorRoomSession(repository, {
      applyRoomSnapshot: (room) => { snapshot = cloneRoomSnapshot(room); },
      exportRoomSnapshot: () => ({ ...cloneRoomSnapshot(snapshot), title: session.currentRoomTitle }),
      getPublishValidationError: () => null, getRoomDirty: () => dirty,
      setRoomDirty: (value) => { dirty = value; }, getLastDirtyAt: () => lastDirtyAt,
      refreshUi: vi.fn(), refreshSurroundingRoomPreviews: vi.fn(),
    });
    session.currentRoomId = roomId;
    session.currentRoomCoordinates = coordinates;
    await session.loadPersistedRoom(null);
    dirty = true;
    const saved = { ...record, draft: { ...cloneRoomSnapshot(record.draft), updatedAt: responseAt } };
    return {
      session, response, saved, publish, isDirty: () => dirty,
      editLater: () => {
        session.currentRoomTitle = 'Later title';
        snapshot.tileData.terrain[9][9] = 33;
        dirty = true;
        lastDirtyAt = 200;
      },
    };
  }

  function expectLaterBackup(session: EditorRoomSession) {
    const stored = JSON.parse(values.get(`${ROOM_STORAGE_PREFIX}${roomId}`) ?? 'null');
    expect(session.currentRoomTitle).toBe('Later title');
    expect(stored.draft.title).toBe('Later title');
    expect(stored.draft.tileData.terrain[9][9]).toBe(33);
    expect(stored.localBackup).toEqual({ userId: null, baseUpdatedAt: responseAt });
  }

  it.each(['save', 'publish'] as const)('preserves later title and terrain edits after a delayed %s response', async (operation) => {
    const { session, response, saved, editLater, isDirty, publish } = await openedEditor();
    const pending = operation === 'save' ? session.saveDraft() : session.publishRoom();
    if (operation === 'publish') {
      await Promise.resolve();
      expect(publish).toHaveBeenCalledTimes(1);
      saved.published = { ...cloneRoomSnapshot(saved.draft), status: 'published' };
    }
    editLater();
    session.backupDraftForPageExit();
    response.resolve(saved);
    expect(await pending).toBe(saved);
    expect(isDirty()).toBe(true);
    expectLaterBackup(session);
  });

  it('preserves edits made during the auth refresh after publishing', async () => {
    const { session, response, saved, editLater, isDirty } = await openedEditor();
    const authRefresh = deferred<void>();
    vi.mocked(refreshAuthSession).mockResolvedValueOnce(undefined).mockReturnValueOnce(authRefresh.promise);
    const pending = session.publishRoom();
    await Promise.resolve();
    response.resolve(saved);
    await Promise.resolve();
    expect(refreshAuthSession).toHaveBeenCalledTimes(2);
    editLater();
    authRefresh.resolve();
    await pending;
    expect(isDirty()).toBe(true);
    expectLaterBackup(session);
  });
});

describe('results that arrive after the editor switched rooms', () => {
  const roomA = { id: '0,1', coordinates: { x: 0, y: 1 } };
  const roomB = { id: '5,5', coordinates: { x: 5, y: 5 } };

  beforeEach(() => {
    authState.authenticated = true;
    vi.spyOn(performance, 'now').mockImplementation(() => 10_000);
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.stubGlobal('window', { localStorage });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    authState.authenticated = false;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  }

  function sessionFor(repository: Partial<RoomRepository>) {
    let dirty = true;
    const setRoomDirty = vi.fn((value: boolean) => { dirty = value; });
    const applyRoomSnapshot = vi.fn();
    const session: EditorRoomSession = new EditorRoomSession({ getLastPersistenceTarget: () => 'remote', ...repository } as RoomRepository, {
      applyRoomSnapshot, exportRoomSnapshot: (): RoomSnapshot => createDefaultRoomRecord(session.currentRoomId, session.currentRoomCoordinates).draft,
      getPublishValidationError: () => null, getRoomDirty: () => dirty,
      setRoomDirty, getLastDirtyAt: () => 100, refreshUi: vi.fn(),
      refreshSurroundingRoomPreviews: vi.fn(),
    });
    session.currentRoomId = roomA.id;
    session.currentRoomCoordinates = roomA.coordinates;
    return { session, setRoomDirty, applyRoomSnapshot };
  }

  function openRoomB(session: EditorRoomSession) {
    session.reset();
    session.currentRoomId = roomB.id;
    session.currentRoomCoordinates = roomB.coordinates;
  }

  it('ignores a slow save for the previous room instead of pointing the editor back at it', async () => {
    const slowSaveA = deferred<RoomRecord>();
    const saveB = deferred<RoomRecord>();
    const saveDraft = vi.fn()
      .mockReturnValueOnce(slowSaveA.promise)
      .mockReturnValueOnce(saveB.promise);
    const { session, setRoomDirty } = sessionFor({ saveDraft });

    const staleSave = session.saveDraft(true);
    openRoomB(session);
    void session.saveDraft(true);
    expect(saveDraft).toHaveBeenCalledTimes(2);

    slowSaveA.resolve(createDefaultRoomRecord(roomA.id, roomA.coordinates));
    expect(await staleSave).toBeNull();

    expect(session.currentRoomId).toBe(roomB.id);
    expect(session.currentRoomCoordinates).toEqual(roomB.coordinates);
    expect(setRoomDirty).not.toHaveBeenCalled();
    // Room B's own save is still in flight, so autosave must not start a second one.
    session.maybeAutoSave(false);
    expect(saveDraft).toHaveBeenCalledTimes(2);
  });

  it('does not load the previous room into the editor when its load finishes late', async () => {
    const slowLoadA = deferred<ReturnType<RoomRepository['loadRoomCurrent']> extends Promise<infer T> ? T : never>();
    const loadRoomCurrent = vi.fn().mockReturnValueOnce(slowLoadA.promise);
    const { session, applyRoomSnapshot } = sessionFor({ loadRoomCurrent });

    const staleLoad = session.loadPersistedRoom(null);
    openRoomB(session);
    const recordA = createDefaultRoomRecord(roomA.id, roomA.coordinates);
    slowLoadA.resolve({ summary: createRoomSummaryFromRecord(recordA), draft: recordA.draft, published: null });

    expect(await staleLoad).toBe(false);
    expect(applyRoomSnapshot).not.toHaveBeenCalled();
    expect(session.currentRoomId).toBe(roomB.id);
  });
});

describe('the same room saved from another tab or device', () => {
  const loadedAt = '2026-10-03T12:00:00.000Z';
  const theirsAt = '2026-10-03T12:30:00.000Z';
  let values: Map<string, string>;

  beforeEach(() => {
    authState.authenticated = true;
    vi.spyOn(performance, 'now').mockImplementation(() => 10_000);
    values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.stubGlobal('window', { localStorage });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(showBusyError).mockClear();
  });
  afterEach(() => {
    authState.authenticated = false;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function serverRecord(updatedAt: string, tile: number): RoomRecord {
    const record = createDefaultRoomRecord(roomId, coordinates);
    record.claimerUserId = 'builder';
    record.claimedAt = loadedAt;
    record.draft.updatedAt = updatedAt;
    record.draft.tileData.terrain[9][9] = tile;
    return record;
  }

  async function openedEditor(saveDraft: RoomRepository['saveDraft'], latest: RoomRecord) {
    let dirty = false;
    const mine = serverRecord(loadedAt, 1);
    mine.draft.tileData.terrain[9][9] = 77;
    const applyRoomSnapshot = vi.fn();
    const loadRoomCurrent = vi.fn()
      .mockResolvedValueOnce({ summary: createRoomSummaryFromRecord(serverRecord(loadedAt, 1)), draft: serverRecord(loadedAt, 1).draft, published: null })
      .mockResolvedValue({ summary: createRoomSummaryFromRecord(latest), draft: latest.draft, published: null });
    const repository = { saveDraft: vi.fn(saveDraft), loadRoomCurrent, getLastPersistenceTarget: () => 'remote' } as unknown as RoomRepository;
    const session = new EditorRoomSession(repository, {
      applyRoomSnapshot, exportRoomSnapshot: () => mine.draft,
      getPublishValidationError: () => null, getRoomDirty: () => dirty,
      setRoomDirty: (value: boolean) => { dirty = value; }, getLastDirtyAt: () => 100, refreshUi: vi.fn(),
      refreshSurroundingRoomPreviews: vi.fn(),
    });
    session.currentRoomId = roomId;
    session.currentRoomCoordinates = coordinates;
    await session.loadPersistedRoom(null);
    dirty = true;
    return { session, repository, applyRoomSnapshot, isDirty: () => dirty };
  }

  const conflict = () => new RoomApiError(ROOM_EDIT_CONFLICT_MESSAGE, 409);
  const dialogOptions = () => vi.mocked(showBusyError).mock.calls.at(-1)?.[1];

  it('tells the server which save it is based on', async () => {
    const theirs = serverRecord(theirsAt, 5);
    const { session, repository } = await openedEditor(async () => serverRecord(theirsAt, 77), theirs);
    await session.saveDraft(true);
    expect(repository.saveDraft).toHaveBeenCalledWith(expect.anything(), { baseUpdatedAt: loadedAt });
    await session.saveDraft(true);
    expect(repository.saveDraft).toHaveBeenLastCalledWith(expect.anything(), { baseUpdatedAt: theirsAt });
  });

  it('stops autosave, keeps a copy here, and asks which version to keep', async () => {
    const theirs = serverRecord(theirsAt, 5);
    const { session, repository } = await openedEditor(async () => { throw conflict(); }, theirs);
    await session.saveDraft(true);

    expect(session.hasPendingEditConflict).toBe(true);
    expect(values.has(`${ROOM_STORAGE_PREFIX}${roomId}`)).toBe(true);
    expect(dialogOptions()).toMatchObject({ retryLabel: 'Load Latest', closeLabel: 'Keep Mine' });
    session.maybeAutoSave(false);
    expect(repository.saveDraft).toHaveBeenCalledTimes(1);
  });

  it('Keep Mine saves this version over the other one', async () => {
    const theirs = serverRecord(theirsAt, 5);
    const saveDraft = vi.fn<RoomRepository['saveDraft']>()
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce(serverRecord('2026-10-03T12:31:00.000Z', 77));
    const { session, repository, isDirty } = await openedEditor(saveDraft, theirs);
    await session.saveDraft(true);

    await dialogOptions()!.closeHandler!();
    expect(repository.saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({ id: roomId }), { baseUpdatedAt: null });
    expect(isDirty()).toBe(false);
    expect(session.hasPendingEditConflict).toBe(false);
  });

  it('Load Latest opens the other version and drops the copy here', async () => {
    const theirs = serverRecord(theirsAt, 5);
    const { session, applyRoomSnapshot, isDirty } = await openedEditor(async () => { throw conflict(); }, theirs);
    await session.saveDraft(true);

    await dialogOptions()!.retryHandler!();
    expect(applyRoomSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ tileData: theirs.draft.tileData }));
    expect(values.has(`${ROOM_STORAGE_PREFIX}${roomId}`)).toBe(false);
    expect(isDirty()).toBe(false);
  });
});
