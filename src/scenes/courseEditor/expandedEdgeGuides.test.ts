import { describe, expect, it, vi } from 'vitest';
import { getTilesetByKey } from '../../config';
import { createDefaultRoomSnapshot, type RoomCoordinates, type RoomSnapshot } from '../../persistence/roomModel';
import {
  ExpandedEdgeGuideController,
  getExpandedRoomNeighborWindow,
  getExpandedRoomPerimeter,
  type ExpandedEdgeGuideCell,
} from './expandedEdgeGuides';

const SOLID = getTilesetByKey('forest')!.firstGid + 14;
const room = (x: number, y: number) => createDefaultRoomSnapshot(`${x},${y}`, { x, y });
const seal = (r: RoomSnapshot) => { r.tileData.terrain.forEach((row) => row.fill(SOLID)); return r; };
const published = (r: RoomSnapshot) => { r.status = 'published'; return r; };
// L-shaped Expanded Room: (0,0) (1,0) (0,1).
const L: RoomCoordinates[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];

describe('Expanded Room perimeter', () => {
  it('keeps only edges that face outside the room and lists the cells beyond them', () => {
    const { sides, neighborCells } = getExpandedRoomPerimeter(L);
    expect(sides.get('0,0')).toEqual(['left', 'top']);
    expect(sides.get('1,0')).toEqual(['right', 'top', 'bottom']);
    expect(sides.get('0,1')).toEqual(['left', 'right', 'bottom']);
    expect(neighborCells.map(({ x, y }) => `${x},${y}`).sort()).toEqual(['-1,0', '-1,1', '0,-1', '0,2', '1,-1', '1,1', '2,0']);
  });

  it('asks for a world window that covers every perimeter cell', () => {
    const cells = [{ x: 3, y: -2 }, { x: 4, y: -2 }, { x: 5, y: -2 }, { x: 6, y: -2 }, { x: 6, y: -1 }];
    const { center, radius } = getExpandedRoomNeighborWindow(cells);
    for (const cell of getExpandedRoomPerimeter(cells).neighborCells) {
      // The API returns center ± (radius + 1).
      expect(Math.abs(cell.x - center.x)).toBeLessThanOrEqual(radius + 1);
      expect(Math.abs(cell.y - center.y)).toBeLessThanOrEqual(radius + 1);
    }
  });
});

describe('ExpandedEdgeGuideController', () => {
  function setup(windowRooms: Array<{ id: string; coordinates: RoomCoordinates; state: string }>, snapshots: Map<string, RoomSnapshot | null>) {
    const graphics = { setDepth: vi.fn(() => graphics), clear: vi.fn(), lineStyle: vi.fn(), lineBetween: vi.fn(), destroy: vi.fn() };
    const scene = { add: { graphics: () => graphics } };
    const repository = {
      loadWorldWindow: vi.fn(async () => ({ rooms: windowRooms }) as never),
      loadPublishedRoom: vi.fn(async (id: string) => snapshots.get(id) ?? null),
    };
    const controller = new ExpandedEdgeGuideController(scene as never, repository as never);
    const cells = (rooms: RoomSnapshot[]): ExpandedEdgeGuideCell[] => rooms.map((r) => ({
      roomId: r.id, coordinates: r.coordinates, origin: { x: r.coordinates.x * 640, y: r.coordinates.y * 352 },
      runtime: { documentRevision: 1, exportRoomSnapshot: () => r },
    }));
    return { controller, repository, graphics, cells };
  }

  it('loads only published perimeter rooms and guides only the outer edges', async () => {
    const members = [room(0, 0), room(1, 0), room(0, 1)];
    const leftOfOrigin = published(room(-1, 0));
    const sealedAbove = published(seal(room(0, -1)));
    const { controller, repository, graphics, cells } = setup([
      { id: '-1,0', coordinates: { x: -1, y: 0 }, state: 'published' },
      { id: '0,-1', coordinates: { x: 0, y: -1 }, state: 'published' },
      { id: '2,0', coordinates: { x: 2, y: 0 }, state: 'draft' },
      { id: '3,3', coordinates: { x: 3, y: 3 }, state: 'published' },
      { id: '1,0', coordinates: { x: 1, y: 0 }, state: 'published' }, // a member
    ], new Map([['-1,0', leftOfOrigin], ['0,-1', sealedAbove]]));
    await controller.load(L);
    expect(repository.loadPublishedRoom.mock.calls.map(([id]) => id).sort()).toEqual(['-1,0', '0,-1']);

    controller.sync(true, cells(members), 1);
    const guides = controller.guidesByRoom;
    const sidesOf = (roomId: string) => [...new Set(guides.get(roomId)!.map((g) => `${g.side}:${g.state}`))].sort();
    // Open cell meets an open published room on the left, a sealed one above (blocked), empty space elsewhere.
    expect(sidesOf('0,0')).toEqual(['left:connected', 'top:blocked']);
    expect(sidesOf('1,0')).toEqual(['bottom:open-space', 'right:open-space', 'top:open-space']);
    expect(sidesOf('0,1')).toEqual(['bottom:open-space', 'left:open-space', 'right:open-space']);
    // No guide on any internal seam.
    expect(guides.get('0,0')!.some((g) => g.side === 'right' || g.side === 'bottom')).toBe(false);
    expect(graphics.lineBetween).toHaveBeenCalled();

    // Stable frames do not recompute or redraw.
    graphics.clear.mockClear();
    controller.sync(true, cells(members), 1);
    expect(graphics.clear).not.toHaveBeenCalled();
    // Play mode hides them.
    controller.sync(false, cells(members), 1);
    expect([...controller.guidesByRoom.values()].every((list) => list.length === 0)).toBe(true);
  });

  it('ignores a load that finishes after a newer one, and shows unknown edges when loading fails', async () => {
    const { controller, repository, cells } = setup([], new Map());
    let finishSlow!: (value: never) => void;
    repository.loadWorldWindow.mockImplementationOnce(() => new Promise((resolve) => { finishSlow = resolve as never; }));
    const slow = controller.load(L);
    repository.loadWorldWindow.mockRejectedValueOnce(new Error('offline'));
    await controller.load(L);
    finishSlow({ rooms: [{ id: '-1,0', coordinates: { x: -1, y: 0 }, state: 'published' }] } as never);
    await slow;
    expect(repository.loadPublishedRoom).not.toHaveBeenCalled();
    controller.sync(true, cells([room(0, 0), room(1, 0), room(0, 1)]), 1);
    // Error status: no neighbor-dependent guides at all.
    expect([...controller.guidesByRoom.values()].every((list) => list.length === 0)).toBe(true);
  });
});
