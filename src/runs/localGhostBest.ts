import { normalizeRunGhost, type RunGhost } from './ghostRace';
import { notifyGhostBestUpdated } from './ghostRepository';

const KEY = 'wamp:guest-ghost-bests:v1';
interface StoredBest { ghost: RunGhost; deaths: number }
function read(storage: Storage | null): StoredBest[] {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw) || raw.length > 20) return [];
    return raw.flatMap(entry => {
      const ghost = normalizeRunGhost(entry?.ghost);
      return ghost && Number.isSafeInteger(entry.deaths) && entry.deaths >= 0 ? [{ ghost, deaths: entry.deaths }] : [];
    });
  } catch { return []; }
}
export function loadLocalGhostBest(storage: Storage | null, roomId: string, version: number): RunGhost | null {
  return read(storage).find(entry => entry.ghost.roomId === roomId && entry.ghost.roomVersion === version)?.ghost ?? null;
}
export function saveLocalGhostBest(storage: Storage | null, ghost: RunGhost, deaths: number): boolean {
  const entries = read(storage), previous = entries.find(entry => entry.ghost.roomId === ghost.roomId && entry.ghost.roomVersion === ghost.roomVersion);
  if (previous && (previous.ghost.elapsedMs < ghost.elapsedMs
    || (previous.ghost.elapsedMs === ghost.elapsedMs && previous.deaths <= deaths))) return false;
  const next = [{ ghost, deaths }, ...entries.filter(entry => entry !== previous)].slice(0, 20);
  while (next.length > 1 && JSON.stringify(next).length > 2_000_000) next.pop();
  try {
    if (!storage) return false;
    storage.setItem(KEY, JSON.stringify(next));
    notifyGhostBestUpdated(ghost.roomId);
    return true;
  } catch { return false; }
}
export function getGhostStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
