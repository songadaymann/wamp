import { ROOM_WIDTH, ROOM_HEIGHT } from '../../../config/room';
import { MAX_RUN_DEATH_LOCATIONS, type RankedRunVerificationTrace } from '../../../runs/verificationTrace';
import type { RoomCoordinates } from '../../../persistence/roomModel';

/** Feedback only; it never grants a clear, rank or XP. Missing data stays unknown. */
export function deathLocationsJson(
  trace: RankedRunVerificationTrace | null | undefined,
  binding: { verificationNonce?: string | null; snapshotHash?: string | null },
  cells: RoomCoordinates[], elapsedMs: number, deaths: number,
): string | null {
  if (!trace?.deathEvents || !Array.isArray(trace.deathEvents) || !binding.verificationNonce || !binding.snapshotHash
    || trace.verificationNonce !== binding.verificationNonce || trace.snapshotHash !== binding.snapshotHash) return null;
  const membership = new Set(cells.map(cell => `${cell.x},${cell.y}`));
  let previousMs = -1;
  const events = trace.deathEvents.slice(0, Math.min(MAX_RUN_DEATH_LOCATIONS, Math.max(0, deaths))).filter(event => {
    if (![event.atMs, event.roomX, event.roomY, event.tileX, event.tileY].every(Number.isSafeInteger)
      || event.atMs < previousMs || event.atMs < 0 || event.atMs > elapsedMs + 600
      || event.tileX < 0 || event.tileX >= ROOM_WIDTH || event.tileY < 0 || event.tileY >= ROOM_HEIGHT
      || !membership.has(`${event.roomX},${event.roomY}`)) return false;
    previousMs = event.atMs; return true;
  }).map(({ roomX, roomY, tileX, tileY }) => ({ roomX, roomY, tileX, tileY }));
  return JSON.stringify(events);
}
