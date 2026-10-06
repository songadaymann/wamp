import { getApiBaseUrl } from '../api/baseUrl';
import type { RoomCoordinates } from '../persistence/roomModel';
import { normalizeRunGhost, type GhostOption, type GhostRaceChoice, type RoomGhostResponse, type RunGhost } from './ghostRace';

const recentTopGhosts = new Map<string, { roomId: string; ghost: RunGhost; loadedAt: number }>();
const bestListeners = new Set<{ roomId: string; listener: () => void }>();
let revision = 0;
const cacheKey = (roomId: string, version: number) => `${getApiBaseUrl()}:${roomId}:${version}`;

/** Only public #1 recordings are reused. Account bests are always read from the current session. */
export function getRecentTopGhost(roomId: string, version: number): RunGhost | null {
  const key = cacheKey(roomId, version), entry = recentTopGhosts.get(key);
  if (!entry || Date.now() - entry.loadedAt > 30_000) { recentTopGhosts.delete(key); return null; }
  return entry.ghost;
}

export function subscribeGhostBestUpdates(roomId: string, listener: () => void): () => void {
  const subscription = { roomId, listener };
  bestListeners.add(subscription);
  return () => { bestListeners.delete(subscription); };
}

export function notifyGhostBestUpdated(roomId: string): void {
  revision++;
  for (const [key, entry] of recentTopGhosts) if (entry.roomId === roomId) recentTopGhosts.delete(key);
  for (const subscription of [...bestListeners]) {
    if (subscription.roomId === roomId) subscription.listener();
  }
}

export async function loadRoomGhosts(roomId: string, version: number, coordinates: RoomCoordinates,
  signal: AbortSignal): Promise<RoomGhostResponse> {
  const startedRevision = revision;
  const params = new URLSearchParams({ x: String(coordinates.x), y: String(coordinates.y), version: String(version) });
  const response = await fetch(`${getApiBaseUrl()}/api/rooms/${encodeURIComponent(roomId)}/ghosts?${params}`,
    { credentials: 'include', cache: 'no-store', signal });
  if (!response.ok) throw new Error('Ghost unavailable');
  const value = await response.json();
  if (value.roomId !== roomId || value.roomVersion !== version) throw new Error('Ghost layout changed');
  const option = (raw: GhostOption | undefined): GhostOption => {
    const ghost = normalizeRunGhost(raw?.ghost);
    if (ghost && ghost.roomId !== roomId) throw new Error('Ghost room changed');
    return { ghost, reason: ghost ? null : raw?.reason ?? 'no_recording' };
  };
  const result = { roomId, roomVersion: version, top: option(value.top), personal: option(value.personal) };
  if (!signal.aborted && revision === startedRevision) {
    const key = cacheKey(roomId, version);
    recentTopGhosts.delete(key);
    if (result.top.ghost) {
      recentTopGhosts.set(key, { roomId, ghost: result.top.ghost, loadedAt: Date.now() });
      while (recentTopGhosts.size > 20) recentTopGhosts.delete(recentTopGhosts.keys().next().value!);
    }
  }
  return result;
}

export async function loadRaceGhost(roomId: string, version: number, coordinates: RoomCoordinates,
  choice: Exclude<GhostRaceChoice, 'off'>, signal: AbortSignal): Promise<RunGhost | null> {
  return (await loadRoomGhosts(roomId, version, coordinates, signal))[choice].ghost;
}
