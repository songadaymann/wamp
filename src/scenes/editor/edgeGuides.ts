import { ROOM_WIDTH, ROOM_HEIGHT, ROOM_PX_WIDTH, ROOM_PX_HEIGHT, TILE_SIZE, SPECIAL_TILE_ONE_WAY_PLATFORM_GID, getObjectById, getObjectRuntimeBodyRect, getPlacedObjectLayer, isSolidRuntimeObjectConfig } from '../../config';
import type { RoomSnapshot } from '../../persistence/roomModel';
import { getTerrainTileCollisionProfile, getTerrainCollisionTileValue } from '../overworld/terrainCollision';
import { PLAYER_STANDING_HEIGHT as STANDING_HEIGHT, PLAYER_BODY_WIDTH as BODY_WIDTH } from '../../player/geometry';

export type RoomEdgeSide = 'left' | 'right' | 'top' | 'bottom';
export type EdgeGuideState = 'connected' | 'blocked' | 'open-space';
export interface RoomEdgeGuide { side: RoomEdgeSide; start: number; end: number; state: EdgeGuideState }
export interface RoomEdgeSummary { connectedNeighbors: number; openSides: number; status: 'loading' | 'ready' | 'error' }
type EdgeOpenings = Record<RoomEdgeSide, Uint8Array>;
const SIDES: RoomEdgeSide[] = ['left', 'right', 'top', 'bottom'];
const OPPOSITE: Record<RoomEdgeSide, RoomEdgeSide> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
const OFFSET = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
// Standing gameplay body. A narrow crouch-only route is intentionally not a green hint.

export function getStandingEdgeOpenings(room: RoomSnapshot, side: RoomEdgeSide): Uint8Array {
  const horizontal = side === 'left' || side === 'right';
  const length = horizontal ? ROOM_PX_HEIGHT : ROOM_PX_WIDTH;
  const clear = new Uint8Array(length).fill(1);
  const block = (rect: { x: number; y: number; width: number; height: number }) => {
    const touches = side === 'left' ? rect.x < BODY_WIDTH && rect.x + rect.width > 0
      : side === 'right' ? rect.x < ROOM_PX_WIDTH && rect.x + rect.width > ROOM_PX_WIDTH - BODY_WIDTH
        : side === 'top' ? rect.y < STANDING_HEIGHT && rect.y + rect.height > 0
          : rect.y < ROOM_PX_HEIGHT && rect.y + rect.height > ROOM_PX_HEIGHT - STANDING_HEIGHT;
    if (!touches) return;
    const start = Math.max(0, Math.floor(horizontal ? rect.y : rect.x));
    const end = Math.min(length, Math.ceil(horizontal ? rect.y + rect.height : rect.x + rect.width));
    clear.fill(0, start, Math.max(start, end));
  };
  for (let y = 0; y < ROOM_HEIGHT; y++) for (let x = 0; x < ROOM_WIDTH; x++) {
    // Only edge-adjacent tiles can intersect the standing-body corridor.
    if (horizontal ? x !== (side === 'left' ? 0 : ROOM_WIDTH - 1) : side === 'top' ? y > 1 : y < ROOM_HEIGHT - 2) continue;
    const profile = getTerrainTileCollisionProfile(room, x, y);
    if (!profile.hasCollision || getTerrainCollisionTileValue(room, x, y).gid === SPECIAL_TILE_ONE_WAY_PLATFORM_GID) continue;
    block({ x: x * TILE_SIZE, y: y * TILE_SIZE + profile.topInset, width: TILE_SIZE, height: profile.height });
  }
  for (const placed of room.placedObjects) {
    const config = getObjectById(placed.id);
    if (!config || config.category === 'npc' || getPlacedObjectLayer(placed) !== 'terrain' || !isSolidRuntimeObjectConfig(config)) continue;
    block(getObjectRuntimeBodyRect(config, placed));
  }
  const result = new Uint8Array(length), required = horizontal ? STANDING_HEIGHT : BODY_WIDTH;
  for (let start = 0; start < length;) {
    if (!clear[start]) { start++; continue; }
    let end = start + 1; while (end < length && clear[end]) end++;
    if (end - start >= required) result.fill(1, start + Math.ceil(required / 2), end - Math.floor(required / 2) + 1);
    start = end;
  }
  return result;
}

function getEdges(room: RoomSnapshot): EdgeOpenings {
  return Object.fromEntries(SIDES.map(side => [side, getStandingEdgeOpenings(room, side)])) as EdgeOpenings;
}

/** Bounded by the editor's current document and weakly held immutable neighbor snapshots. */
export class EditorEdgeGuideCache {
  guides: RoomEdgeGuide[] = [];
  summary: RoomEdgeSummary = { connectedNeighbors: 0, openSides: 0, status: 'loading' };
  private ownRevision = -1;
  private neighborRevision = -1;
  private enabled = false;
  private own: RoomSnapshot | null = null;
  private ownEdges: EdgeOpenings | null = null;
  private neighbors = new WeakMap<RoomSnapshot, { version: number; updatedAt: string; edges: EdgeOpenings }>();

  sync(enabled: boolean, ownRevision: number, neighborRevision: number, status: RoomEdgeSummary['status'], exportOwn: () => RoomSnapshot, neighbors: readonly RoomSnapshot[]): boolean {
    if (!enabled && !this.enabled) return false;
    if (enabled === this.enabled && ownRevision === this.ownRevision && neighborRevision === this.neighborRevision && status === this.summary.status) return false;
    const ownChanged = ownRevision !== this.ownRevision || !this.own;
    this.enabled = enabled; this.neighborRevision = neighborRevision;
    if (!enabled) { this.guides = []; this.ownRevision = -1; return true; }
    if (ownChanged) { this.own = exportOwn(); this.ownEdges = getEdges(this.own); this.ownRevision = ownRevision; }
    const own = this.own!, ownEdges = this.ownEdges!;
    this.guides = []; let connectedNeighbors = 0, openSides = 0;
    for (const side of SIDES) {
      const mine = ownEdges[side]; if (mine.some(Boolean)) openSides++;
      if (status !== 'ready') continue;
      const [dx, dy] = OFFSET[side];
      const neighbor = neighbors.find(n => n.status === 'published' && n.coordinates.x === own.coordinates.x + dx && n.coordinates.y === own.coordinates.y + dy);
      let theirs: Uint8Array | null = null;
      if (neighbor) {
        let cached = this.neighbors.get(neighbor);
        if (!cached || cached.version !== neighbor.version || cached.updatedAt !== neighbor.updatedAt) {
          cached = { version: neighbor.version, updatedAt: neighbor.updatedAt, edges: getEdges(neighbor) }; this.neighbors.set(neighbor, cached);
        }
        theirs = cached.edges[OPPOSITE[side]];
      }
      const states: (EdgeGuideState | null)[] = Array.from(mine, (open, index) => theirs
        ? open && theirs[index] ? 'connected' : open || theirs[index] ? 'blocked' : null
        : open ? 'open-space' : null);
      if (states.includes('connected')) connectedNeighbors++;
      for (let start = 0; start < states.length;) {
        const state = states[start]; let end = start + 1; while (end < states.length && states[end] === state) end++;
        if (state) this.guides.push({ side, start, end, state }); start = end;
      }
    }
    this.summary = { connectedNeighbors, openSides, status }; return true;
  }

  reset(): void {
    this.own = null; this.ownEdges = null; this.ownRevision = -1; this.neighborRevision = -1; this.enabled = false;
    this.neighbors = new WeakMap(); this.guides = []; this.summary = { connectedNeighbors: 0, openSides: 0, status: 'loading' };
  }
}
