import { describe, expect, it } from 'vitest';
import { applyRegisteredSmartBrushCells } from '../autotiling/brushEngine';
import { decodeTileDataValue, LAYER_NAMES, ROOM_HEIGHT, ROOM_WIDTH, TILE_SIZE } from '../config';
import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import { getTerrainTileCollisionProfile } from '../scenes/overworld/terrainCollision';
import { ROOM_TEMPLATE_DEFINITIONS } from './roomTemplateDefinitions';
import { buildRoomTemplate, chooseRoomTemplateStyle, getRoomTemplateDefaultBrush, getRoomTemplateStyles } from './roomTemplates';

describe('starter room templates', () => {
  for (const style of getRoomTemplateStyles()) {
    for (const definition of ROOM_TEMPLATE_DEFINITIONS) {
      it(`${style.id} / ${definition.id} has bounded terrain and safely supported markers`, () => {
        const base = createDefaultRoomSnapshot('0,0', { x: 0, y: 0 });
        const room = buildRoomTemplate(base, definition.id, style.id);
        expect(base.tileData.terrain.flat().every(value => value === -1)).toBe(true);
        for (const layer of LAYER_NAMES) {
          expect(room.tileData[layer]).toHaveLength(ROOM_HEIGHT);
          expect(room.tileData[layer].every(row => row.length === ROOM_WIDTH)).toBe(true);
        }
        for (const marker of [room.spawnPoint, room.goal?.type === 'reach_exit' ? room.goal.exit : null]) {
          if (!marker) continue;
          const x = Math.floor(marker.x / TILE_SIZE); const y = Math.floor((marker.y - (marker === room.spawnPoint ? 0.5 : 0)) / TILE_SIZE);
          expect(getTerrainTileCollisionProfile(room, x, y).hasCollision).toBe(false);
          expect(getTerrainTileCollisionProfile(room, x, y + 1).hasCollision).toBe(true);
        }
        expect(room.placedObjects).toHaveLength(definition.enemies?.length ?? 0);
        if (definition.id === 'blank') expect(room.smartTerrain?.semanticCells).toEqual({});
        else {
          expect(Object.keys(room.smartTerrain!.semanticCells).length).toBeGreaterThan(0);
          expect(Object.values(room.smartTerrain!.semanticCells).every(cell => cell.styleId === style.id)).toBe(true);
          const extended = applyRegisteredSmartBrushCells({ tileData: room.tileData, smartTerrain: room.smartTerrain! }, { cells: [{ x: 2, y: 19 }], mode: 'paint', brushId: getRoomTemplateDefaultBrush(style.id), styleId: style.id, layer: 'terrain' });
          expect(decodeTileDataValue(extended.tileData.terrain[19][2]).gid).toBeGreaterThan(0);
          expect(getTerrainTileCollisionProfile({ ...room, ...extended }, 2, 19).hasCollision).toBe(true);
        }
      });
    }
  }

  it('preserves settings and custom tile libraries while replacing every layout layer', () => {
    const base = createDefaultRoomSnapshot('0,0', { x: 0, y: 0 });
    base.title = 'My room'; base.pitsAreDeadly = true; base.playerHearts = 3;
    base.cameraMode = 'room'; base.goalIntroText = 'Old goal';
    base.tileData.foreground[2][2] = 5;
    const room = buildRoomTemplate(base, 'flat_run', 'cave');
    expect(room.title).toBe(base.title); expect(room.background).toBe(base.background);
    expect(room.pitsAreDeadly).toBe(true); expect(room.playerHearts).toBe(3); expect(room.cameraMode).toBe('room');
    expect(room.music).toEqual(base.music); expect(room.lighting).toEqual(base.lighting); expect(room.weather).toEqual(base.weather);
    expect(room.customTiles).toEqual(base.customTiles);
    expect(room.tileData.foreground[2][2]).toBe(-1); expect(base.tileData.foreground[2][2]).toBe(5);
    expect(room.goalIntroText).toBeNull();
  });

  it('chooses the dominant supported terrain and considers at most four neighbors', () => {
    const forest = buildRoomTemplate(createDefaultRoomSnapshot('0,0', { x: 0, y: 0 }), 'flat_run', 'forest');
    const cave = buildRoomTemplate(forest, 'stairs_up', 'cave');
    expect(chooseRoomTemplateStyle([forest, cave], 'forest')).toBe('cave');
    expect(chooseRoomTemplateStyle([forest, forest, forest, forest, cave], 'cave')).toBe('forest');
    expect(chooseRoomTemplateStyle([], 'forest')).toBe('forest');
    expect(chooseRoomTemplateStyle([forest, buildRoomTemplate(forest, 'flat_run', 'cave')], 'cave')).toBe('cave');
  });
});
