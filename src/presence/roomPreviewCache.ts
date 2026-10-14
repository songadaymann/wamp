import { cloneRoomSnapshot } from '../persistence/roomModel';
import type { WorldPresenceRoomPreview } from './worldPresence';

const TTL_MS = 120_000;

/** Own wire data once; the server's content revision excludes lease timestamps. */
export function ownRoomPreview(
  shardId: string, roomId: string, value: WorldPresenceRoomPreview,
  previous?: WorldPresenceRoomPreview,
): WorldPresenceRoomPreview | null {
  if (!value || typeof value !== 'object' || !Number.isFinite(value.timestamp)
    || Date.now() - value.timestamp > TTL_MS || !value.roomCoordinates
    || !Number.isInteger(value.roomCoordinates.x) || !Number.isInteger(value.roomCoordinates.y)
    || !value.snapshot || typeof value.snapshot !== 'object') return null;
  const revision = typeof value.revision === 'string' && value.revision.length <= 100
    ? value.revision : undefined;
  const reusable = revision && previous?.revision === revision && previous.roomId === roomId
    && previous.shardId === shardId && previous.userId === value.userId
    && previous.roomCoordinates.x === value.roomCoordinates.x
    && previous.roomCoordinates.y === value.roomCoordinates.y;
  return { ...value, roomId, shardId, revision, roomCoordinates: { ...value.roomCoordinates },
    snapshot: reusable ? previous.snapshot : cloneRoomSnapshot(value.snapshot) };
}
