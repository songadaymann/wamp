import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomRecord, createRoomSummaryFromRecord, RoomApiError, type RoomRecord, type RoomRepository, type RoomSnapshot } from '../../persistence/roomRepository';
import { ROOM_STORAGE_PREFIX } from '../../persistence/browserStorage';
import { EditorRoomSession } from './roomSession';

const authState = vi.hoisted(() => ({ authenticated: false }));
vi.mock('../../auth/client', () => ({ getAuthDebugState: () => ({ authenticated: authState.authenticated }) }));
vi.mock('../../ui/appFeedback', () => ({ showBusyError: vi.fn(), showBusyOverlay: vi.fn(), hideBusyOverlay: vi.fn(), updateBusyOverlay: vi.fn() }));
vi.mock('../../mint/roomMetadataRender', () => ({ renderRoomSnapshotToPngDataUrl: vi.fn() }));

const coordinates = { x: 0, y: 1 };
const roomId = '0,1';
const savedAt = '2026-09-08T12:00:00.000Z';
const openedAt = '2026-09-08T13:00:00.000Z';

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
  const repository = {
    loadRoomCurrent: vi.fn(async () => ({ summary: createRoomSummaryFromRecord(remote), draft: remote.draft, published: remote.published })),
  } as unknown as RoomRepository;
  const session = new EditorRoomSession(repository, {
    applyRoomSnapshot, exportRoomSnapshot: () => remote.draft,
    getPublishValidationError: () => null, getRoomDirty: () => false,
    setRoomDirty: vi.fn(), getLastDirtyAt: () => 0, refreshUi: vi.fn(),
    refreshSurroundingRoomPreviews: vi.fn(),
  });
  session.currentRoomId = roomId;
  session.currentRoomCoordinates = coordinates;
  return { session, applyRoomSnapshot };
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
