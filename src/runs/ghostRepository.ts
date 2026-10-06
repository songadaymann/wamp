import { getApiBaseUrl } from '../api/baseUrl';
import type { RoomCoordinates } from '../persistence/roomModel';
import { normalizeRunGhost, type GhostRaceChoice, type RunGhost } from './ghostRace';

export async function loadRaceGhost(roomId: string, version: number, coordinates: RoomCoordinates,
  choice: Exclude<GhostRaceChoice, 'off'>, signal: AbortSignal): Promise<RunGhost | null> {
  const params = new URLSearchParams({ x: String(coordinates.x), y: String(coordinates.y), version: String(version) });
  const response = await fetch(`${getApiBaseUrl()}/api/rooms/${encodeURIComponent(roomId)}/ghosts?${params}`,
    { credentials: 'include', cache: 'no-store', signal });
  if (!response.ok) throw new Error('Ghost unavailable');
  const value = await response.json();
  if (value.roomId !== roomId || value.roomVersion !== version) throw new Error('Ghost layout changed');
  const ghost = normalizeRunGhost(value[choice]?.ghost);
  if (ghost && ghost.roomId !== roomId) throw new Error('Ghost room changed');
  return ghost;
}
