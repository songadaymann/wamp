import { cloneRoomSnapshot, type RoomSnapshot } from './roomModel';

const MAX_SNAPSHOTS = 256;
const snapshots = new Map<string, RoomSnapshot>();

export function buildSharedRoomSnapshotKey(
  roomId: string,
  version: number | null,
  state: string,
  updatedAt: string | null = null,
): string {
  return `${roomId}:${version ?? 'current'}:${state}:${updatedAt ?? ''}`;
}

export function getSharedRoomSnapshot(key: string): RoomSnapshot | null {
  const snapshot = snapshots.get(key);
  if (!snapshot) return null;
  snapshots.delete(key);
  snapshots.set(key, snapshot);
  return cloneRoomSnapshot(snapshot);
}

export function setSharedRoomSnapshot(key: string, snapshot: RoomSnapshot): void {
  snapshots.delete(key);
  snapshots.set(key, cloneRoomSnapshot(snapshot));
  while (snapshots.size > MAX_SNAPSHOTS) {
    const oldest = snapshots.keys().next().value;
    if (typeof oldest !== 'string') break;
    snapshots.delete(oldest);
  }
}

export function invalidateSharedRoomSnapshots(roomId: string): void {
  for (const key of snapshots.keys()) {
    if (key.startsWith(`${roomId}:`)) snapshots.delete(key);
  }
}
