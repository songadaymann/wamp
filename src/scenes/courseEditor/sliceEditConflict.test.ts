import { describe, expect, it, vi } from 'vitest';
import { draftBackupRevision } from '../../courses/localDraftBackup';
import { cloneRoomSnapshot, createDefaultRoomRecord, type RoomRecord, type RoomSnapshot } from '../../persistence/roomModel';
import { ROOM_EDIT_CONFLICT_MESSAGE } from '../../persistence/roomEditConflict';
import { describeSliceEditConflicts, writeSliceAgainstBase, type SliceWriteAdapter } from './sliceEditConflict';

const BASE = '2026-10-22T10:00:00.000Z';
const NEWER = '2026-10-22T11:00:00.000Z';
const conflict = () => Object.assign(new Error(ROOM_EDIT_CONFLICT_MESSAGE), { status: 409 });

function room(title: string, updatedAt = BASE): RoomSnapshot {
  const snapshot = cloneRoomSnapshot(createDefaultRoomRecord('3,4', { x: 3, y: 4 }).draft);
  return { ...snapshot, title, updatedAt };
}

function serverRecord(draft: RoomSnapshot, published: RoomSnapshot | null = null): RoomRecord {
  return { ...createDefaultRoomRecord('3,4', { x: 3, y: 4 }), draft, published };
}

function adapter(writes: Array<RoomRecord | Error>, latest: RoomRecord): SliceWriteAdapter & { write: ReturnType<typeof vi.fn> } {
  const write = vi.fn(async () => {
    const next = writes.shift();
    if (!next || next instanceof Error) throw next ?? new Error('unexpected write');
    return next;
  });
  return { write, loadLatest: vi.fn(async () => latest) };
}

describe('writeSliceAgainstBase (F379)', () => {
  it('sends the base and returns the saved record', async () => {
    const saved = serverRecord(room('Mine', NEWER));
    const io = adapter([saved], saved);
    await expect(writeSliceAgainstBase('save', room('Mine'), BASE, io)).resolves.toEqual({ status: 'written', record: saved });
    expect(io.write).toHaveBeenCalledWith(expect.objectContaining({ title: 'Mine' }), { baseUpdatedAt: BASE });
    expect(io.loadLatest).not.toHaveBeenCalled();
  });

  it('reports a real conflict when the server holds different work', async () => {
    const io = adapter([conflict()], serverRecord(room('Theirs', NEWER)));
    await expect(writeSliceAgainstBase('save', room('Mine'), BASE, io)).resolves.toEqual({ status: 'conflict' });
    expect(io.write).toHaveBeenCalledTimes(1);
  });

  it('treats a save as done when the server already holds what was sent (repeat Save or lost reply)', async () => {
    const latest = serverRecord(room('Mine', NEWER));
    const io = adapter([conflict()], latest);
    await expect(writeSliceAgainstBase('save', room('Mine'), BASE, io)).resolves.toEqual({ status: 'written', record: latest });
    expect(io.write).toHaveBeenCalledTimes(1);
  });

  it('retries a publish from the server version when the draft matches but is not yet published', async () => {
    const published = serverRecord(room('Mine', '2026-10-22T12:00:00.000Z'), room('Mine'));
    const io = adapter([conflict(), published], serverRecord(room('Mine', NEWER), room('Older')));
    await expect(writeSliceAgainstBase('publish', room('Mine'), BASE, io)).resolves.toEqual({ status: 'written', record: published });
    expect(io.write).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Mine' }), { baseUpdatedAt: NEWER });
  });

  it('does not publish again when the server already published what was sent', async () => {
    const latest = serverRecord(room('Mine', NEWER), room('Mine', NEWER));
    const io = adapter([conflict()], latest);
    await expect(writeSliceAgainstBase('publish', room('Mine'), BASE, io)).resolves.toEqual({ status: 'written', record: latest });
    expect(io.write).toHaveBeenCalledTimes(1);
  });

  it('retries from the server version when it holds an earlier copy this tab sent without hearing back', async () => {
    const saved = serverRecord(room('Mine, edited further', '2026-10-22T12:00:00.000Z'));
    const io = adapter([conflict(), saved], serverRecord(room('Mine', NEWER)));
    const outcome = await writeSliceAgainstBase('save', room('Mine, edited further'), BASE, io, draftBackupRevision(room('Mine')));
    expect(outcome).toEqual({ status: 'written', record: saved });
    expect(io.write).toHaveBeenLastCalledWith(expect.anything(), { baseUpdatedAt: NEWER });
  });

  it('passes other errors through and omits a missing base', async () => {
    const io = adapter([Object.assign(new Error('Room is locked.'), { status: 409 })], serverRecord(room('Mine')));
    await expect(writeSliceAgainstBase('save', room('Mine'), null, io)).rejects.toThrow('Room is locked.');
    expect(io.write).toHaveBeenCalledWith(expect.anything(), undefined);
    expect(io.loadLatest).not.toHaveBeenCalled();
  });
});

describe('describeSliceEditConflicts (F379)', () => {
  it('claims a local copy only for cells whose backup was written', () => {
    expect(describeSliceEditConflicts([{ label: '3,4', kept: true }], { kind: 'save', written: 0 }))
      .toBe('Cell 3,4 was changed in another tab or device, so it was not saved. Your version is kept on this device: reopen this Expanded Room to choose which to keep.');
    expect(describeSliceEditConflicts([{ label: '3,4', kept: false }], { kind: 'publish', written: 0 }))
      .toBe('Cell 3,4 was changed in another tab or device, so it was not published. Your version could not be kept on this device and is only in this tab.');
  });

  it('reports several cells together, with what still went through', () => {
    const text = describeSliceEditConflicts(
      [{ label: '1,2', kept: true }, { label: '3,4', kept: false }, { label: '5,6', kept: true }],
      { kind: 'save', written: 2, error: 'Network down.' },
    );
    expect(text).toBe('Cells 1,2; 3,4 and 5,6 were changed in another tab or device, so they were not saved. '
      + 'Your versions of cells 1,2 and 5,6 are kept on this device: reopen this Expanded Room to choose which to keep. '
      + 'Your version of cell 3,4 could not be kept on this device and is only in this tab. '
      + 'The other 2 cells were saved. Network down.');
  });
});
