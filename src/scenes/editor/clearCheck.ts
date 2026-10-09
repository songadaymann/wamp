import { ROOM_HEIGHT, ROOM_WIDTH, TILE_SIZE, decodeTileDataValue, getSpecialTileKindForGid, getObjectById, getObjectDisplayScale } from '../../config';
import { cloneRoomSnapshot, getRoomPublishValidationError, type RoomSnapshot } from '../../persistence/roomModel';
import { resolveGoalRunStartPoint } from '../overworld/goalRunStartGate';
import { getTerrainTileCollisionProfile } from '../overworld/terrainCollision';

const STORAGE_KEY = 'wamp.editorClearChecks.v1';
const MAX_RECEIPTS = 20;
export interface EditorClearCheckBinding { roomId: string; fingerprint: string; eligible: boolean }
interface ClearCheckReceipt { roomId: string; fingerprint: string }
export interface ClearCheckRow { id: 'title' | 'start' | 'goal' | 'clear'; label: string; detail: string; state: 'ready' | 'optional' | 'pending' | 'warning' }
export interface ReadyToPublishChecklist { roomId: string; rows: ClearCheckRow[]; cleared: boolean; ready: boolean; publishError: string | null }
export interface ClearCheckStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
const fallbackReceipts: ClearCheckReceipt[] = [];
const unavailableStores = new WeakSet<ClearCheckStorage>();

function getStorage(): ClearCheckStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.sessionStorage; } catch { return undefined; }
}

function sortedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortedValue(item)]));
  return value;
}

// This is a UI identity, never a verification token or reward credential.
export function getEditorDraftFingerprint(snapshot: RoomSnapshot): string {
  const { id, coordinates, title, cameraMode, pitsAreDeadly, playerHearts, goalIntroText, background, lighting, weather, music, goal, spawnPoint, tileData, smartTerrain, placedObjects, customSprites, customTiles } = cloneRoomSnapshot(snapshot);
  const data = JSON.stringify(sortedValue({ id, coordinates, title, cameraMode, pitsAreDeadly, playerHearts, goalIntroText, background, lighting, weather, music, goal, spawnPoint, tileData, smartTerrain, placedObjects, customSprites, customTiles }));
  let a = 0x811c9dc5; let b = 0x9e3779b9;
  for (let i = 0; i < data.length; i += 1) { a = Math.imul(a ^ data.charCodeAt(i), 16777619); b = Math.imul(b ^ data.charCodeAt(i), 2246822519); }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

function readReceipts(storage?: ClearCheckStorage): ClearCheckReceipt[] {
  if (!storage || unavailableStores.has(storage)) return [...fallbackReceipts];
  try {
    const value: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]');
    if (Array.isArray(value)) return value.slice(-MAX_RECEIPTS).filter((item): item is ClearCheckReceipt => Boolean(item && typeof item === 'object' && typeof item.roomId === 'string' && item.roomId.length <= 80 && typeof item.fingerprint === 'string' && /^[a-f0-9]{16}$/.test(item.fingerprint)));
  } catch { /* A blocked or malformed session store must not stop editing. */ }
  return [...fallbackReceipts];
}

export function recordEditorDraftClear(binding: EditorClearCheckBinding | null | undefined, run: { roomId: string; roomStatus: string; result: string; qualificationState: string }, storage: ClearCheckStorage | undefined = getStorage()): boolean {
  if (!binding?.eligible || binding.roomId !== run.roomId || run.roomStatus !== 'draft' || run.result !== 'completed' || run.qualificationState !== 'qualified' || !/^[a-f0-9]{16}$/.test(binding.fingerprint)) return false;
  const receipts = [...readReceipts(storage).filter(item => item.roomId !== binding.roomId), { roomId: binding.roomId, fingerprint: binding.fingerprint }].slice(-MAX_RECEIPTS);
  fallbackReceipts.splice(0, fallbackReceipts.length, ...receipts);
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(receipts)); if (storage) unavailableStores.delete(storage); } catch { if (storage) unavailableStores.add(storage); }
  return true;
}

export function hasEditorDraftClear(snapshot: RoomSnapshot, storage: ClearCheckStorage | undefined = getStorage()): boolean {
  if (!snapshot.goal) return false;
  const receipt = readReceipts(storage).find(item => item.roomId === snapshot.id);
  return receipt?.fingerprint === getEditorDraftFingerprint(snapshot);
}

function pointInsideTerrain(room: RoomSnapshot, x: number, y: number): boolean {
  const tileX = Math.floor(x / TILE_SIZE); const tileY = Math.floor(y / TILE_SIZE);
  const profile = getTerrainTileCollisionProfile(room, tileX, tileY);
  if (profile.isSmartBackgroundSurface) return false;
  const gid = decodeTileDataValue(room.tileData.terrain[tileY]?.[tileX] ?? -1).gid;
  if (getSpecialTileKindForGid(gid) === 'oneWayPlatform') return false;
  return profile.hasCollision && y - tileY * TILE_SIZE >= profile.topInset && y - tileY * TILE_SIZE < TILE_SIZE - profile.bottomInset;
}

function startIsSafe(room: RoomSnapshot): boolean {
  const originX = room.coordinates.x * ROOM_WIDTH * TILE_SIZE; const originY = room.coordinates.y * ROOM_HEIGHT * TILE_SIZE;
  const start = resolveGoalRunStartPoint(room, 26); const x = start.x - originX; const y = start.y - originY;
  if (x < 5 || x > ROOM_WIDTH * TILE_SIZE - 5 || y < 26 || y > ROOM_HEIGHT * TILE_SIZE) return false;
  if (room.placedObjects.some(placed => {
    const object = getObjectById(placed.id);
    if (object?.category !== 'hazard') return false;
    const scale = getObjectDisplayScale(object);
    const width = object.bodyWidth * scale; const height = object.bodyHeight * scale;
    return placed.x + width / 2 > x - 5 && placed.x - width / 2 < x + 5 && placed.y + height / 2 > y - 26 && placed.y - height / 2 < y;
  })) return false;
  for (let bodyY = y - 25; bodyY < y; bodyY += 2) for (const bodyX of [x - 4, x, x + 4]) if (pointInsideTerrain(room, bodyX, bodyY)) return false;
  for (let floorY = y; floorY <= y + TILE_SIZE; floorY += 1) {
    const tileX = Math.floor(x / TILE_SIZE); const tileY = Math.floor(floorY / TILE_SIZE);
    const profile = getTerrainTileCollisionProfile(room, tileX, tileY);
    if (profile.hasCollision && floorY - tileY * TILE_SIZE >= profile.topInset) return true;
  }
  return false;
}

export function buildReadyToPublishChecklist(room: RoomSnapshot, storage: ClearCheckStorage | undefined = getStorage()): ReadyToPublishChecklist {
  const publishError = getRoomPublishValidationError(room);
  const safeStart = startIsSafe(room); const cleared = hasEditorDraftClear(room, storage);
  const markers = room.goal?.type === 'reach_exit' ? [room.goal.exit]
    : room.goal?.type === 'checkpoint_sprint' ? [...room.goal.checkpoints, room.goal.finish]
      : room.goal?.type === 'npc_quest' && room.goal.questType === 'escort' ? [room.goal.destination] : [];
  const blockedMarker = markers.some(point => point && pointInsideTerrain(room, point.x, point.y));
  const rows: ClearCheckRow[] = [
    { id: 'title', label: 'Room title', detail: room.title?.trim() ? room.title : 'A suggested name is offered when you publish.', state: room.title?.trim() ? 'ready' : 'optional' },
    { id: 'start', label: 'Start safety', detail: safeStart ? room.spawnPoint ? 'Start has ground and clear headroom.' : 'Automatic start has ground and clear headroom.' : 'Start may fall or touch terrain or a hazard. Test it, or place a start on clear ground.', state: safeStart ? 'ready' : 'warning' },
    { id: 'goal', label: 'Goal setup', detail: publishError ?? (blockedMarker ? 'A goal marker is inside terrain. Move it or test its reach.' : room.goal ? 'Goal markers and required objects are set.' : 'No goal: players can explore freely.'), state: publishError || blockedMarker ? 'warning' : room.goal ? 'ready' : 'optional' },
    { id: 'clear', label: 'Clear Check', detail: !room.goal ? 'Optional for a room without a goal.' : cleared ? 'You cleared this exact draft from its start.' : 'Test from the start and complete the goal.', state: !room.goal ? 'optional' : cleared ? 'ready' : 'pending' },
  ];
  return { roomId: room.id, rows, cleared, ready: rows.every(row => row.state === 'ready' || row.state === 'optional'), publishError };
}
