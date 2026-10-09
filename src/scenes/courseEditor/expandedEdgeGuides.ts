import type Phaser from 'phaser';
import type { RoomCoordinates, RoomSnapshot } from '../../persistence/roomModel';
import type { WorldRepository } from '../../persistence/worldRepository';
import type { EditorEditRuntime } from '../editor/editRuntime';
import { drawRoomEdgeGuideMarks } from '../editor/edgeGuideDrawing';
import {
  EditorEdgeGuideCache,
  ROOM_EDGE_OFFSET,
  ROOM_EDGE_SIDES,
  type RoomEdgeSide,
  type RoomEdgeSummary,
} from '../editor/edgeGuides';

const coordinateKey = (coordinates: RoomCoordinates) => `${coordinates.x},${coordinates.y}`;

/**
 * Sides of each member cell that face outside the Expanded Room (internal seams are
 * skipped), and the outside cells those sides touch.
 */
export function getExpandedRoomPerimeter(members: readonly RoomCoordinates[]): {
  sides: Map<string, RoomEdgeSide[]>;
  neighborCells: RoomCoordinates[];
} {
  const memberKeys = new Set(members.map(coordinateKey));
  const sides = new Map<string, RoomEdgeSide[]>();
  const neighbors = new Map<string, RoomCoordinates>();
  for (const member of members) {
    const outer: RoomEdgeSide[] = [];
    for (const side of ROOM_EDGE_SIDES) {
      const [dx, dy] = ROOM_EDGE_OFFSET[side];
      const cell = { x: member.x + dx, y: member.y + dy };
      if (memberKeys.has(coordinateKey(cell))) continue;
      outer.push(side);
      neighbors.set(coordinateKey(cell), cell);
    }
    sides.set(coordinateKey(member), outer);
  }
  return { sides, neighborCells: [...neighbors.values()] };
}

/** The smallest world window (the API adds one cell of margin) that covers every perimeter cell. */
export function getExpandedRoomNeighborWindow(members: readonly RoomCoordinates[]): { center: RoomCoordinates; radius: number } {
  const xs = members.map((cell) => cell.x);
  const ys = members.map((cell) => cell.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const center = { x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2) };
  return { center, radius: Math.max(center.x - minX, maxX - center.x, center.y - minY, maxY - center.y) };
}

export interface ExpandedEdgeGuideCell {
  roomId: string;
  coordinates: RoomCoordinates;
  origin: { x: number; y: number };
  runtime: Pick<EditorEditRuntime, 'documentRevision' | 'exportRoomSnapshot'>;
}

/**
 * Neighbor opening guides on an Expanded Room's outer perimeter: each member cell
 * compares its outward edges with the published room beyond them, reusing the
 * standalone editor's standing-body clearance rules and per-revision caching.
 */
export class ExpandedEdgeGuideController {
  private readonly caches = new Map<string, EditorEdgeGuideCache>();
  private perimeter: ReturnType<typeof getExpandedRoomPerimeter> = { sides: new Map(), neighborCells: [] };
  private neighbors: RoomSnapshot[] = [];
  private status: RoomEdgeSummary['status'] = 'loading';
  private revision = 0;
  private token = 0;
  private graphics: Phaser.GameObjects.Graphics | null = null;
  private zoom = -1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly worldRepository: Pick<WorldRepository, 'loadWorldWindow' | 'loadPublishedRoom'>,
  ) {}

  /** Loads the published rooms around the perimeter; stale or failed loads leave guides unknown. */
  async load(members: readonly RoomCoordinates[]): Promise<void> {
    const token = ++this.token;
    this.perimeter = getExpandedRoomPerimeter(members);
    this.neighbors = [];
    this.status = 'loading';
    this.revision += 1;
    if (members.length === 0) {
      return;
    }

    const memberKeys = new Set(members.map(coordinateKey));
    const wanted = new Set(this.perimeter.neighborCells.map(coordinateKey));
    try {
      const { center, radius } = getExpandedRoomNeighborWindow(members);
      const window = await this.worldRepository.loadWorldWindow(center, radius);
      if (token !== this.token) return;
      const rooms = window.rooms.filter((room) => room.state === 'published'
        && wanted.has(coordinateKey(room.coordinates)) && !memberKeys.has(coordinateKey(room.coordinates)));
      const loaded = await Promise.all(rooms.map((room) => this.worldRepository.loadPublishedRoom(room.id, room.coordinates)));
      if (token !== this.token) return;
      this.neighbors = loaded.flatMap((snapshot) => (snapshot ? [snapshot] : []));
      this.status = loaded.some((snapshot) => !snapshot) ? 'error' : 'ready';
    } catch {
      if (token !== this.token) return;
      this.status = 'error';
    }
    this.revision += 1;
  }

  /** Per frame: recompute only cells whose document or neighbors changed, and redraw on change or zoom. */
  sync(enabled: boolean, cells: Iterable<ExpandedEdgeGuideCell>, zoom: number): void {
    let changed = false;
    const list = [...cells];
    for (const cell of list) {
      let cache = this.caches.get(cell.roomId);
      if (!cache) {
        cache = new EditorEdgeGuideCache();
        this.caches.set(cell.roomId, cache);
      }
      const sides = this.perimeter.sides.get(coordinateKey(cell.coordinates)) ?? [];
      changed = cache.sync(enabled, cell.runtime.documentRevision, this.revision, this.status,
        () => cell.runtime.exportRoomSnapshot(), this.neighbors, sides) || changed;
    }
    if (!changed && zoom === this.zoom) {
      return;
    }

    this.zoom = zoom;
    this.graphics ??= this.scene.add.graphics().setDepth(103);
    this.graphics.clear();
    for (const cell of list) {
      drawRoomEdgeGuideMarks(this.graphics, this.caches.get(cell.roomId)?.guides ?? [], zoom, cell.origin);
    }
  }

  get guidesByRoom(): Map<string, EditorEdgeGuideCache['guides']> {
    return new Map([...this.caches].map(([roomId, cache]) => [roomId, cache.guides]));
  }

  reset(): void {
    this.token += 1;
    this.caches.clear();
    this.perimeter = { sides: new Map(), neighborCells: [] };
    this.neighbors = [];
    this.status = 'loading';
    this.revision += 1;
    this.zoom = -1;
    this.graphics?.clear();
  }

  destroy(): void {
    this.reset();
    this.graphics?.destroy();
    this.graphics = null;
  }
}
