import { describe, expect, it } from 'vitest';
import { TILE_SIZE, getObjectById, type PlacedObject } from '../config';
import { cloneRoomSnapshot, createDefaultRoomSnapshot } from '../persistence/roomModel';
import { dedupePlacedObjectsByAnchorCell, getPlacedObjectAnchorCell } from './occupancy';

function triangle(
  instanceId: string,
  tileX: number,
  tileY: number,
  legX: number,
  legY: number,
): PlacedObject {
  return {
    id: 'triangle_piece',
    instanceId,
    x: tileX * TILE_SIZE,
    y: (tileY + 1) * TILE_SIZE,
    layer: 'terrain',
    triangleLegX: legX,
    triangleLegY: legY,
  };
}

function coin(instanceId: string, tileX: number, tileY: number): PlacedObject {
  const config = getObjectById('coin_gold');
  if (!config) throw new Error('missing coin');
  return {
    id: 'coin_gold',
    instanceId,
    x: tileX * TILE_SIZE + config.frameWidth / 2,
    y: tileY * TILE_SIZE + TILE_SIZE - config.frameHeight / 2,
    layer: 'terrain',
  };
}

describe('triangle corners sharing a cell', () => {
  it('keeps every triangle whose right angle sits on the same cell', () => {
    const placed = [
      triangle('floor', 7, 18, 32, -32),
      triangle('ceiling', 7, 18, 32, 32),
      triangle('opposite', 7, 18, -48, -32),
    ];

    expect(getPlacedObjectAnchorCell(placed[0])).toMatchObject({ tileX: 7, tileY: 18 });
    expect(dedupePlacedObjectsByAnchorCell(placed).placedObjects.map((object) => object.instanceId))
      .toEqual(['floor', 'ceiling', 'opposite']);

    const room = createDefaultRoomSnapshot();
    room.placedObjects = placed;
    const cloned = cloneRoomSnapshot(room);
    expect(cloned.placedObjects.map((object) => [object.instanceId, object.triangleLegX, object.triangleLegY]))
      .toEqual([
        ['floor', 32, -32],
        ['ceiling', 32, 32],
        ['opposite', -48, -32],
      ]);
  });

  it('still keeps one ordinary object per cell and leaves a neighbor beside a triangle', () => {
    const shared = dedupePlacedObjectsByAnchorCell([
      coin('first', 4, 10),
      coin('second', 4, 10),
    ]);
    expect(shared.placedObjects.map((object) => object.instanceId)).toEqual(['second']);

    const beside = dedupePlacedObjectsByAnchorCell([
      triangle('ramp', 7, 18, 32, -32),
      coin('nearby', 6, 19),
    ]);
    expect(beside.placedObjects.map((object) => object.instanceId)).toEqual(['ramp', 'nearby']);

    const stacked = dedupePlacedObjectsByAnchorCell([
      triangle('ramp', 4, 10, 32, -32),
      coin('same', 4, 10),
    ]);
    expect(stacked.placedObjects.map((object) => object.instanceId)).toEqual(['same']);
  });
});
