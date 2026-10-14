import type Phaser from 'phaser';
import { ROOM_HEIGHT, ROOM_PX_HEIGHT, ROOM_PX_WIDTH, ROOM_WIDTH, TILE_SIZE,
  type LayerName, type SpecialTileKind } from '../../config';
import { roomIdFromCoordinates, type RoomCoordinates, type RoomSnapshot } from '../../persistence/roomModel';
import type { LoadedFullRoom } from './worldStreaming';
import type { PlayerGravityDirection } from './specialTiles';
import { getRoomSpecialTileIndex, type RoomSpecialTileIndex } from './specialTileRooms';

export interface SpecialTileMatch<TLiveObject, TEdgeWall> {
  readonly loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>;
  readonly layerName: LayerName;
  readonly tileX: number;
  readonly tileY: number;
  readonly kind: SpecialTileKind;
}
interface ScannerHost<TLiveObject, TEdgeWall> {
  getLoadedFullRooms: () => Iterable<LoadedFullRoom<TLiveObject, TEdgeWall>>;
  getLoadedFullRoomById: (roomId: string) => LoadedFullRoom<TLiveObject, TEdgeWall> | null;
  getRoomCoordinatesForPoint: (x: number, y: number) => RoomCoordinates;
  getRoomOrigin: (coordinates: RoomCoordinates) => { x: number; y: number };
}
interface LoadedRoomIndex<TLiveObject, TEdgeWall> {
  tileData: RoomSnapshot['tileData'];
  origin: { x: number; y: number };
  index: RoomSpecialTileIndex;
  matches: Array<readonly SpecialTileMatch<TLiveObject, TEdgeWall>[] | undefined>;
}

/** Results are borrowed until the next scan; callers consume them immediately. */
export class OverworldSpecialTileScanner<TLiveObject, TEdgeWall> {
  private readonly indexes = new WeakMap<LoadedFullRoom<TLiveObject, TEdgeWall>, LoadedRoomIndex<TLiveObject, TEdgeWall>>();
  private readonly rectMatches: SpecialTileMatch<TLiveObject, TEdgeWall>[] = [];
  private readonly contactMatches: SpecialTileMatch<TLiveObject, TEdgeWall>[] = [];
  private readonly seenContacts = new Set<SpecialTileMatch<TLiveObject, TEdgeWall>>();

  constructor(private readonly host: ScannerHost<TLiveObject, TEdgeWall>) {}

  reset(): void {
    this.rectMatches.length = 0;
    this.contactMatches.length = 0;
    this.seenContacts.clear();
  }

  overlapping(body: Phaser.Physics.Arcade.Body): readonly SpecialTileMatch<TLiveObject, TEdgeWall>[] {
    return this.inRect(body.left + 1, body.right - 1, body.top + 1, body.bottom - 1);
  }

  near(body: Phaser.Physics.Arcade.Body, padding: number): readonly SpecialTileMatch<TLiveObject, TEdgeWall>[] {
    return this.inRect(body.left - padding, body.right + padding, body.top - padding, body.bottom + padding);
  }

  contact(body: Phaser.Physics.Arcade.Body, direction: PlayerGravityDirection): readonly SpecialTileMatch<TLiveObject, TEdgeWall>[] {
    this.contactMatches.length = 0;
    this.seenContacts.clear();
    switch (direction) {
      case 'up':
        this.appendPoint(body.left + 2, body.top - 1);
        this.appendPoint(body.center.x, body.top - 1);
        this.appendPoint(body.right - 2, body.top - 1);
        break;
      case 'left':
        this.appendPoint(body.left - 1, body.top + 2);
        this.appendPoint(body.left - 1, body.center.y);
        this.appendPoint(body.left - 1, body.bottom - 2);
        break;
      case 'right':
        this.appendPoint(body.right + 1, body.top + 2);
        this.appendPoint(body.right + 1, body.center.y);
        this.appendPoint(body.right + 1, body.bottom - 2);
        break;
      case 'down':
      default:
        this.appendPoint(body.left + 2, body.bottom + 1);
        this.appendPoint(body.center.x, body.bottom + 1);
        this.appendPoint(body.right - 2, body.bottom + 1);
    }
    return this.contactMatches;
  }

  private inRect(left: number, right: number, top: number, bottom: number): readonly SpecialTileMatch<TLiveObject, TEdgeWall>[] {
    this.rectMatches.length = 0;
    for (const loadedRoom of this.host.getLoadedFullRooms()) {
      const indexed = this.getIndex(loadedRoom);
      if (!indexed.index.hasSpecialTiles) continue;
      const origin = indexed.origin;
      if (right < origin.x || left > origin.x + ROOM_PX_WIDTH
        || bottom < origin.y || top > origin.y + ROOM_PX_HEIGHT) continue;
      const minX = clamp(Math.floor((left - origin.x) / TILE_SIZE), ROOM_WIDTH - 1);
      const maxX = clamp(Math.floor((right - origin.x) / TILE_SIZE), ROOM_WIDTH - 1);
      const minY = clamp(Math.floor((top - origin.y) / TILE_SIZE), ROOM_HEIGHT - 1);
      const maxY = clamp(Math.floor((bottom - origin.y) / TILE_SIZE), ROOM_HEIGHT - 1);
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const matches = this.atCell(loadedRoom, indexed, x, y);
        if (matches) for (const match of matches) this.rectMatches.push(match);
      }
    }
    return this.rectMatches;
  }

  private appendPoint(worldX: number, worldY: number): void {
    const coordinates = this.host.getRoomCoordinatesForPoint(worldX, worldY);
    const loadedRoom = this.host.getLoadedFullRoomById(roomIdFromCoordinates(coordinates));
    if (!loadedRoom) return;
    const indexed = this.getIndex(loadedRoom);
    if (!indexed.index.hasSpecialTiles) return;
    const origin = indexed.origin;
    const x = Math.floor((worldX - origin.x) / TILE_SIZE), y = Math.floor((worldY - origin.y) / TILE_SIZE);
    if (x < 0 || x >= ROOM_WIDTH || y < 0 || y >= ROOM_HEIGHT) return;
    const matches = this.atCell(loadedRoom, indexed, x, y);
    if (!matches) return;
    for (const match of matches) {
      if (this.seenContacts.has(match)) continue;
      this.seenContacts.add(match);
      this.contactMatches.push(match);
    }
  }

  private getIndex(loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>): LoadedRoomIndex<TLiveObject, TEdgeWall> {
    const tileData = loadedRoom.room.tileData;
    let indexed = this.indexes.get(loadedRoom);
    if (!indexed || indexed.tileData !== tileData) {
      indexed = { tileData, origin: this.host.getRoomOrigin(loadedRoom.room.coordinates), index: getRoomSpecialTileIndex(tileData), matches: new Array(ROOM_WIDTH * ROOM_HEIGHT) };
      this.indexes.set(loadedRoom, indexed);
    }
    return indexed;
  }

  private atCell(loadedRoom: LoadedFullRoom<TLiveObject, TEdgeWall>, indexed: LoadedRoomIndex<TLiveObject, TEdgeWall>,
    tileX: number, tileY: number): readonly SpecialTileMatch<TLiveObject, TEdgeWall>[] | undefined {
    const cell = tileY * ROOM_WIDTH + tileX;
    if ((indexed.index.occupiedCells[cell >>> 5] & (1 << (cell & 31))) === 0) return undefined;
    return indexed.matches[cell] ??= indexed.index.cells[cell]!.map(tile => ({ loadedRoom, tileX, tileY, ...tile }));
  }
}
function clamp(value: number, max: number): number { return Math.max(0, Math.min(max, value)); }
