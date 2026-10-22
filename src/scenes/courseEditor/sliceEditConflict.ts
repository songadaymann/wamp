import { draftBackupRevision } from '../../courses/localDraftBackup';
import { isRoomEditConflict } from '../../persistence/roomEditConflict';
import type { RoomRecord, RoomSnapshot, RoomWriteOptions } from '../../persistence/roomRepository';

export type SliceWriteKind = 'save' | 'publish';

export type SliceWriteOutcome =
  | { status: 'written'; record: RoomRecord }
  | { status: 'conflict' };

export interface SliceWriteAdapter {
  write(sent: RoomSnapshot, options: RoomWriteOptions | undefined): Promise<RoomRecord>;
  loadLatest(): Promise<RoomRecord>;
}

/**
 * Saves or publishes one Expanded Room cell against the server version it was edited from (F379).
 * When the server refuses that version, the cell is reloaded. If the server already holds exactly
 * what was sent (a repeated Save, or a reply lost to a timeout), that copy counts as written and its
 * version becomes the new base; a publish of it is retried from that base unless it is already
 * published. If the server holds a copy this tab sent earlier without hearing back
 * (`unconfirmedRevision`), the write is retried from its version. Anything else is a real conflict
 * for the caller to report. Other errors are thrown unchanged.
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
  const revision = draftBackupRevision(sent);
  const latestRevision = draftBackupRevision(latest.draft);
  if (latestRevision === revision && (kind === 'save' || (latest.published && draftBackupRevision(latest.published) === revision))) {
    return { status: 'written', record: latest };
  }
  if (latestRevision !== revision && latestRevision !== unconfirmedRevision) return { status: 'conflict' };
  try {
    return { status: 'written', record: await adapter.write(sent, { baseUpdatedAt: latest.draft.updatedAt }) };
  } catch (error) {
    if (isRoomEditConflict(error)) return { status: 'conflict' };
    throw error;
  }
}

export interface SliceEditConflict {
  label: string;
  /** Whether this cell's version was written to the local backup that reopening offers to restore. */
  kept: boolean;
}

/** One Save or Publish across several cells: a conflicting cell is collected and the rest still written. */
export interface SliceWriteProgress {
  kind: SliceWriteKind;
  written: number;
  conflicts: SliceEditConflict[];
  lastRecord: RoomRecord | null;
}

function listCells(conflicts: readonly SliceEditConflict[]): string {
  const labels = conflicts.map((conflict) => conflict.label);
  const last = labels.pop() ?? '';
  return `${conflicts.length === 1 ? 'cell' : 'cells'} ${labels.length ? `${labels.join('; ')} and ${last}` : last}`;
}

/** One message for every cell a Save or Publish could not write, claiming a local copy only where one was written. */
export function describeSliceEditConflicts(
  conflicts: readonly SliceEditConflict[],
  options: { kind: SliceWriteKind; written: number; error?: string },
): string {
  const one = conflicts.length === 1;
  const cells = listCells(conflicts);
  const kept = conflicts.filter((conflict) => conflict.kept);
  const lost = conflicts.filter((conflict) => !conflict.kept);
  const verb = options.kind === 'save' ? 'saved' : 'published';
  const parts = [`${cells.charAt(0).toUpperCase()}${cells.slice(1)} ${one ? 'was' : 'were'} changed in another tab or device, so ${one ? 'it was' : 'they were'} not ${verb}.`];
  if (kept.length) {
    parts.push(`Your version${kept.length === 1 ? '' : 's'}${lost.length ? ` of ${listCells(kept)}` : ''} ${kept.length === 1 ? 'is' : 'are'} kept on this device: reopen this Expanded Room to choose which to keep.`);
  }
  if (lost.length) {
    parts.push(`Your version${lost.length === 1 ? '' : 's'}${kept.length ? ` of ${listCells(lost)}` : ''} could not be kept on this device and ${lost.length === 1 ? 'is' : 'are'} only in this tab.`);
  }
  if (options.written > 0) parts.push(`The other ${options.written} ${options.written === 1 ? 'cell was' : 'cells were'} ${verb}.`);
  if (options.error) parts.push(options.error);
  return parts.join(' ');
}
