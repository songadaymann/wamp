import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomRecord } from './roomModel';
import { ROOM_STORAGE_PREFIX } from './browserStorage';
import { readRoomDraftBackupMetadata, writeRoomDraftBackup } from './localDraftBackup';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('synchronous room draft lifecycle backups', () => {
  it('writes edited terrain immediately without changing the runtime snapshot or history', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-10-03T12:00:00Z');
    const record = createDefaultRoomRecord('2,3', { x: 2, y: 3 });
    const storage = memoryStorage();
    storage.setItem(`${ROOM_STORAGE_PREFIX}2,3`, JSON.stringify(record));
    const before = JSON.stringify(record.draft);
    record.draft.tileData.terrain[5][5] = 17;
    const metadata = { userId: 'builder', baseUpdatedAt: record.draft.updatedAt };
    vi.setSystemTime('2026-10-03T12:00:01Z');
    expect(writeRoomDraftBackup(record.draft, metadata, storage)).toBe(true);
    const stored = JSON.parse(storage.getItem(`${ROOM_STORAGE_PREFIX}2,3`)!);
    expect(stored.draft.tileData.terrain[5][5]).toBe(17);
    expect(stored.draft.updatedAt).toBe('2026-10-03T12:00:01.000Z');
    expect(stored.versions).toEqual(record.versions);
    expect(record.draft.updatedAt).toBe(JSON.parse(before).updatedAt);
    expect(readRoomDraftBackupMetadata('2,3', storage)).toEqual(metadata);
  });

  it('can back up a deliberate erase to an empty room', () => {
    const storage = memoryStorage();
    const record = createDefaultRoomRecord('2,3', { x: 2, y: 3 });
    expect(writeRoomDraftBackup(record.draft, { userId: null, baseUpdatedAt: null }, storage)).toBe(true);
    expect(readRoomDraftBackupMetadata('2,3', storage)).toEqual({ userId: null, baseUpdatedAt: null });
  });

  it('keeps the previous backup when quota or storage access fails', () => {
    const storage = memoryStorage();
    storage.setItem(`${ROOM_STORAGE_PREFIX}2,3`, 'previous backup');
    const snapshot = createDefaultRoomRecord('2,3', { x: 2, y: 3 }).draft;
    expect(writeRoomDraftBackup(snapshot, { userId: null, baseUpdatedAt: null }, {
      getItem: storage.getItem,
      setItem: () => { throw new Error('QuotaExceededError'); },
    })).toBe(false);
    expect(storage.getItem(`${ROOM_STORAGE_PREFIX}2,3`)).toBe('previous backup');
    expect(writeRoomDraftBackup(snapshot, { userId: null, baseUpdatedAt: null }, {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: storage.setItem,
    })).toBe(false);
  });

  it('replaces an unreadable older copy and ignores invalid metadata', () => {
    const storage = memoryStorage();
    storage.setItem(`${ROOM_STORAGE_PREFIX}2,3`, '{broken json');
    expect(readRoomDraftBackupMetadata('2,3', storage)).toBeNull();
    const snapshot = createDefaultRoomRecord('2,3', { x: 2, y: 3 }).draft;
    expect(writeRoomDraftBackup(snapshot, { userId: null, baseUpdatedAt: null }, storage)).toBe(true);
    storage.setItem(`${ROOM_STORAGE_PREFIX}2,3`, JSON.stringify({ localBackup: { userId: 42, baseUpdatedAt: null } }));
    expect(readRoomDraftBackupMetadata('2,3', storage)).toBeNull();
  });
});
