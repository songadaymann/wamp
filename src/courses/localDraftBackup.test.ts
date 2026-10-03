import { describe, expect, it } from 'vitest';
import { createDefaultCourseSnapshot } from './model';
import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import { draftBackupRevision, ExpandedRoomDraftBackup } from './localDraftBackup';

function storageFixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } as Storage;
  return { values, storage, backup: new ExpandedRoomDraftBackup('user:alice', () => storage) };
}

const room = () => createDefaultRoomSnapshot('7,8', { x: 7, y: 8 });

describe('expanded draft backup persistence and recovery', () => {
  it('recovers course metadata and cells independently without changing the snapshots or baseline', () => {
    const { backup } = storageFixture();
    const base = createDefaultCourseSnapshot('course:one');
    const draft = { ...base, title: 'New title' };
    const remoteRoom = room();
    const localRoom = { ...remoteRoom, title: 'Cell edit' };
    expect(backup.writeCourse(draft, base)).toBe(true);
    expect(backup.writeRoom(base.id, localRoom, remoteRoom)).toBe(true);
    expect(backup.recoverCourse(base)).toEqual({ status: 'recovered', snapshot: draft });
    expect(backup.recoverRoom(base.id, remoteRoom)).toEqual({ status: 'recovered', snapshot: localRoom });
    backup.discardCourse(draft);
    expect(backup.recoverCourse(base).status).toBe('none');
    expect(backup.recoverRoom(base.id, remoteRoom).status).toBe('recovered');
    expect(base.title).toBeNull();
    expect(remoteRoom.title).toBeNull();
  });

  it('requires matching account, expanded-room ID, room ID and coordinates', () => {
    const { storage, backup } = storageFixture();
    const remote = room();
    backup.writeRoom('course:one', { ...remote, title: 'Local' }, remote);
    expect(new ExpandedRoomDraftBackup('user:bob', () => storage).recoverRoom('course:one', remote).status).toBe('none');
    expect(backup.recoverRoom('course:two', remote).status).toBe('none');
    expect(backup.recoverRoom('course:one', createDefaultRoomSnapshot('8,8', { x: 8, y: 8 })).status).toBe('none');
    expect(backup.recoverRoom('course:one', { ...remote, coordinates: { x: 0, y: 0 } }).status).toBe('none');
  });

  it('retains divergent remote backups for an explicit choice, even if the local clock is newer', () => {
    const { backup, values } = storageFixture();
    const remote = room();
    const local = { ...remote, title: 'Device edit', updatedAt: '2099-01-01T00:00:00.000Z' };
    backup.writeRoom('course:one', local, remote);
    const newerRemote = { ...remote, title: 'Another device edit', updatedAt: '2098-01-01T00:00:00.000Z' };
    expect(backup.recoverRoom('course:one', newerRemote)).toEqual({ status: 'conflict', snapshot: local });
    expect(values.size).toBe(1);
  });

  it('recovers intentional blank erases and preserves newer edits when an older save completes', () => {
    const { backup } = storageFixture();
    const remote = room();
    remote.tileData.terrain[4][4] = 1;
    const erased = room();
    erased.createdAt = remote.createdAt;
    erased.updatedAt = remote.updatedAt;
    backup.writeRoom('course:one', erased, remote);
    expect(backup.recoverRoom('course:one', remote).status).toBe('recovered');
    const sent = { ...erased, title: 'Sent' };
    const newerEdit = { ...erased, title: 'Still editing' };
    backup.writeRoom('course:one', newerEdit, remote);
    expect(backup.discardRoom('course:one', sent)).toBe(false);
    expect(backup.recoverRoom('course:one', remote)).toEqual({ status: 'recovered', snapshot: newerEdit });
    expect(backup.discardRoom('course:one', newerEdit)).toBe(true);
    expect(backup.recoverRoom('course:one', remote).status).toBe('none');
  });

  it('handles inaccessible storage, quota failures and malformed backups without throwing', () => {
    const denied = new ExpandedRoomDraftBackup('alice', () => { throw new Error('Denied'); });
    const remote = room();
    expect(denied.writeRoom('course:one', remote, remote)).toBe(false);
    expect(denied.recoverRoom('course:one', remote).status).toBe('none');
    const { backup, values } = storageFixture();
    backup.writeRoom('course:one', { ...remote, title: 'Local' }, remote);
    const key = [...values.keys()][0];
    for (const malformed of ['{', 'null', '{}', JSON.stringify({ schema: 1, snapshot: { id: remote.id }, baseUpdatedAt: remote.updatedAt, baseVersion: 1, savedAt: remote.updatedAt })]) {
      values.set(key, malformed);
      expect(backup.recoverRoom('course:one', remote).status).toBe('none');
    }
    const full = new ExpandedRoomDraftBackup('alice', () => ({ setItem: () => { throw new Error('Quota'); } }) as unknown as Storage);
    expect(full.writeRoom('course:one', remote, remote)).toBe(false);
  });

  it('uses editable content revisions independent of field ordering and server timestamps', () => {
    const first = room();
    const second = { ...Object.fromEntries(Object.entries(first).reverse()), id: first.id, updatedAt: '2099-01-01T00:00:00.000Z', version: 100 };
    expect(draftBackupRevision(first)).toBe(draftBackupRevision(second));
  });
});
