import { roomContentRevision } from '../../courses/localDraftBackup';
import { isRoomEditConflict } from '../../persistence/roomEditConflict';
import type { RoomRecord, RoomSnapshot, RoomWriteOptions } from '../../persistence/roomRepository';

export type SliceWriteKind = 'save' | 'publish';

export type SliceWriteOutcome =
  | { status: 'written'; record: RoomRecord }
  | { status: 'conflict'; latest: RoomRecord };

export interface SliceWriteAdapter {
  write(sent: RoomSnapshot, options: RoomWriteOptions | undefined): Promise<RoomRecord>;
  loadLatest(): Promise<RoomRecord>;
}

/** A cell's editable contents, normalized as the server stores them (roomContentRevision). */
export const sliceContentRevision = roomContentRevision;

/**
 * Whether the server holds a saved copy of this cell. Until then its draft is a fresh default with a
 * new timestamp on every load, and the server skips the version check (assertDraftUnchangedSince).
 */
export function hasStoredRoomDraft(record: Pick<RoomRecord, 'claimedAt' | 'published'>): boolean {
  return record.claimedAt !== null || record.published !== null;
}

/**
 * Saves or publishes one Expanded Room cell against the server version it was edited from (F379).
 * When the server refuses that version, the cell is reloaded. If the server already holds exactly
 * what was sent (a repeated Save, or a reply lost to a timeout), that copy counts as written and its
 * version becomes the new base; a publish of it is retried from that base unless it is already
 * published. If the server holds a copy this tab sent earlier without hearing back
 * (`unconfirmedRevision`, from sliceContentRevision), the write is retried from its version.
 * Anything else is a conflict, returned with the server's copy. Other errors are thrown unchanged.
 */
export async function writeSliceAgainstBase(
  kind: SliceWriteKind,
  sent: RoomSnapshot,
  baseUpdatedAt: string | null | undefined,
  adapter: SliceWriteAdapter,
  unconfirmedRevision: string | null = null,
): Promise<SliceWriteOutcome> {
  try {
    return { status: 'written', record: await adapter.write(sent, baseUpdatedAt ? { baseUpdatedAt } : undefined) };
  } catch (error) {
    if (!isRoomEditConflict(error)) throw error;
  }
  const latest = await adapter.loadLatest();
  const revision = sliceContentRevision(sent);
  const latestRevision = sliceContentRevision(latest.draft);
  if (latestRevision === revision && (kind === 'save' || (latest.published && sliceContentRevision(latest.published) === revision))) {
    return { status: 'written', record: latest };
  }
  if (latestRevision !== revision && latestRevision !== unconfirmedRevision) return { status: 'conflict', latest };
  try {
    return { status: 'written', record: await adapter.write(sent, { baseUpdatedAt: latest.draft.updatedAt }) };
  } catch (error) {
    if (isRoomEditConflict(error)) return { status: 'conflict', latest };
    throw error;
  }
}

interface WritableSlice {
  roomId: string;
  loaded: boolean;
  runtime: { isRoomDirty: boolean };
}

/**
 * The cells a Save (edited ones) or Publish (edited ones, or ones with a session copy) writes. A cell
 * whose server copy has not loaded is never written: its blank editor would overwrite real work.
 */
export function selectSlicesToWrite<T extends WritableSlice>(
  slices: Iterable<T>,
  kind: SliceWriteKind,
  hasSessionCopy: (roomId: string) => boolean,
): T[] {
  return Array.from(slices).filter((slice) => slice.loaded
    && (slice.runtime.isRoomDirty || (kind === 'publish' && hasSessionCopy(slice.roomId))));
}

export interface SliceEditConflict {
  roomId: string;
  label: string;
  /** Whether this cell's version was written to the local backup that reopening offers to restore. */
  kept: boolean;
}

/** One Save or Publish across several cells: a conflicting cell is collected and the rest still written. */
export interface SliceWriteProgress {
  kind: SliceWriteKind;
  written: number;
  conflicts: SliceEditConflict[];
  /** Cells with no edits here that changed elsewhere: the newer version was loaded instead of written. */
  refreshed: string[];
  lastRecord: RoomRecord | null;
}

export function createSliceWriteProgress(kind: SliceWriteKind): SliceWriteProgress {
  return { kind, written: 0, conflicts: [], refreshed: [], lastRecord: null };
}

function listCells(labels: readonly string[]): string {
  const head = labels.slice(0, -1);
  const last = labels[labels.length - 1] ?? '';
  return `${labels.length === 1 ? 'cell' : 'cells'} ${head.length ? `${head.join('; ')} and ${last}` : last}`;
}

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function describeRefreshed(progress: SliceWriteProgress): string | null {
  const count = progress.refreshed.length;
  if (!count) return null;
  return `${capitalize(listCells(progress.refreshed))} ${count === 1 ? 'was' : 'were'} changed in another tab or device and had no edits here, so the newer version was loaded instead.`;
}

/** The status after a Save or Publish that met no conflict. */
export function describeSliceWriteSuccess(progress: SliceWriteProgress): string {
  const done = progress.kind === 'save'
    ? `Saved ${progress.written} room draft${progress.written === 1 ? '' : 's'}.`
    : `Published ${progress.written} room${progress.written === 1 ? '' : 's'}.`;
  const refreshed = describeRefreshed(progress);
  if (!refreshed) return done;
  return progress.written > 0 ? `${done} ${refreshed}` : refreshed;
}

/** One message for every cell a Save or Publish could not write, claiming a local copy only where one was written. */
export function describeSliceEditConflicts(progress: SliceWriteProgress, error?: string): string {
  const { conflicts } = progress;
  const one = conflicts.length === 1;
  const kept = conflicts.filter((conflict) => conflict.kept).map((conflict) => conflict.label);
  const lost = conflicts.filter((conflict) => !conflict.kept).map((conflict) => conflict.label);
  const verb = progress.kind === 'save' ? 'saved' : 'published';
  const parts = [`${capitalize(listCells(conflicts.map((conflict) => conflict.label)))} ${one ? 'was' : 'were'} changed in another tab or device, so ${one ? 'it was' : 'they were'} not ${verb}.`];
  if (kept.length) {
    parts.push(`Your version${kept.length === 1 ? '' : 's'}${lost.length ? ` of ${listCells(kept)}` : ''} ${kept.length === 1 ? 'is' : 'are'} kept on this device: reopen this Expanded Room to choose which to keep.`);
  }
  if (lost.length) {
    parts.push(`Your version${lost.length === 1 ? '' : 's'}${kept.length ? ` of ${listCells(lost)}` : ''} could not be kept on this device and ${lost.length === 1 ? 'is' : 'are'} only in this tab. Load Newer Version replaces ${lost.length === 1 ? 'it' : 'them'} with the version saved elsewhere.`);
  }
  if (progress.written > 0) parts.push(`The other ${progress.written} ${progress.written === 1 ? 'cell was' : 'cells were'} ${verb}.`);
  const refreshed = describeRefreshed(progress);
  if (refreshed) parts.push(refreshed);
  if (error) parts.push(error);
  return parts.join(' ');
}
