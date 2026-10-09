import { describe, expect, it } from 'vitest';
import type { PlacedObject } from '../../config';
import { JIMOTHY_OBJECT_ID } from '../../npcs/model';
import { buildMovedObjectDocument, snapObjectMove } from './objectMovement';

function objects(): PlacedObject[] {
  return [
    { id: 'floor_trigger', instanceId: 'plate', x: 40, y: 312, layer: 'terrain', triggerTargetInstanceId: 'door', coopPlate: true },
    { id: 'door_metal_narrow', instanceId: 'door', x: 200, y: 296, layer: 'terrain' },
    { id: JIMOTHY_OBJECT_ID, instanceId: 'npc', x: 320, y: 304, layer: 'foreground', facing: 'left', npcName: 'Aster', signText: 'Bring the key.', npcMode: 'follow', npcPlayerCollision: false, npcCanJumpFall: true, linkedTargetInstanceIds: ['door'], containedObjectId: 'coin_gold' },
  ];
}

describe('placed object movement document', () => {
  it('moves only the chosen anchor, retaining incoming/outgoing links and every authored field', () => {
    const previous = objects(), move = buildMovedObjectDocument(previous, 'npc', { x: 352, y: 272 });
    expect(move.objects?.[2]).toEqual({ ...previous[2], x: 352, y: 272 });
    expect(move.objects?.slice(0, 2)).toEqual(previous.slice(0, 2));
    expect(previous[2].x).toBe(320);
    move.objects?.[2].linkedTargetInstanceIds?.push('new');
    expect(previous[2].linkedTargetInstanceIds).toEqual(['door']);
    const door = buildMovedObjectDocument(previous, 'door', { x: 216, y: 296 });
    expect(door.objects?.[0].triggerTargetInstanceId).toBe('door');
  });

  it('preserves anchor alignment when snapping positive and negative drag distances', () => {
    expect(snapObjectMove({ x: 200, y: 296 }, { x: 31, y: -17 })).toEqual({ x: 232, y: 280 });
    expect(snapObjectMove({ x: 24, y: 31 }, { x: 2, y: 3 })).toEqual({ x: 24, y: 31 });
  });

  it('rejects occupied destinations without deleting or relinking either object', () => {
    const previous = objects();
    const move = buildMovedObjectDocument(previous, 'plate', { x: 200, y: 312 });
    expect(move.objects).toBeNull(); expect(move.error).toMatch(/already/);
    expect(previous).toEqual(objects());
    const otherLayer = buildMovedObjectDocument([{ ...previous[0], layer: 'background' }, previous[1]], 'plate', { x: 200, y: 312 });
    expect(otherLayer.objects).not.toBeNull();
  });

  it('rejects out-of-cell, non-finite, missing and stale positions; an unchanged drop is no action', () => {
    const previous = objects();
    for (const point of [{ x: -24, y: 312 }, { x: 648, y: 312 }, { x: 40, y: 360 }, { x: Infinity, y: 312 }]) expect(buildMovedObjectDocument(previous, 'plate', point).objects).toBeNull();
    expect(buildMovedObjectDocument(previous, 'missing', { x: 40, y: 40 }).objects).toBeNull();
    expect(buildMovedObjectDocument(previous, 'plate', { x: 72, y: 312 }, { x: 24, y: 312 }).error).toMatch(/changed/);
    expect(buildMovedObjectDocument(previous, 'plate', { x: 40, y: 312 })).toEqual({ objects: null, error: null });
  });
});
