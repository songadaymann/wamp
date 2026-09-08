import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomRecord, createRoomSummaryFromRecord, type RoomRecord, type RoomRepository } from '../../persistence/roomRepository';
import { ROOM_STORAGE_PREFIX } from '../../persistence/browserStorage';
import { EditorRoomSession } from './roomSession';

vi.mock('../../auth/client', () => ({ getAuthDebugState: () => ({ authenticated: false }) }));
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
