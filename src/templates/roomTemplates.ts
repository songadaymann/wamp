import { applyRegisteredSmartBrushCells } from '../autotiling/brushEngine';
import { createRoomSmartTerrainState, type SmartStyleId } from '../autotiling/model';
import { getSmartBrushDefinition, getSmartStyleDefinition, getSmartThemeDefinition, listSmartThemeDefinitions } from '../autotiling/registry';
import { cloneRoomSnapshot, createDefaultRoomSnapshot, type RoomSnapshot } from '../persistence/roomModel';
import { decodeTileDataValue, TILE_SIZE } from '../config';
import { applyRoomDraftCommands, type RoomDraftCommand } from '../cloudflare/worker/rooms/commandCore';
import { getRoomTemplateDefinition, type RoomTemplateId } from './roomTemplateDefinitions';

export function getRoomTemplateStyles() {
  return listSmartThemeDefinitions().filter(theme => getSmartBrushDefinition(theme.defaultBrushId).collisionRole === 'solid')
    .flatMap(theme => theme.styleIds.map(id => getSmartStyleDefinition(id)));
}

export function getRoomTemplateDefaultBrush(styleId: SmartStyleId) {
  return getSmartThemeDefinition(getSmartStyleDefinition(styleId).themeId).defaultBrushId;
}

export function chooseRoomTemplateStyle(neighbors: readonly RoomSnapshot[], fallback: SmartStyleId): SmartStyleId {
  const styles = getRoomTemplateStyles();
  const counts = new Map<SmartStyleId, number>();
  for (const room of neighbors.slice(0, 4)) {
    for (const row of room.tileData.terrain ?? []) {
      for (const value of row) {
        const { gid } = decodeTileDataValue(value);
        const style = styles.find(candidate => gid >= candidate.firstGid && gid < candidate.firstGid + candidate.tileCount);
        if (style) counts.set(style.id, (counts.get(style.id) ?? 0) + 1);
      }
    }
  }
  const defaultId = styles.some(style => style.id === fallback) ? fallback : 'forest';
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] === defaultId ? -1 : b[0] === defaultId ? 1 : a[0].localeCompare(b[0])))[0]?.[0] ?? defaultId;
}

export function buildRoomTemplate(base: RoomSnapshot, id: RoomTemplateId, styleId: SmartStyleId): RoomSnapshot {
  const definition = getRoomTemplateDefinition(id);
  const style = getSmartStyleDefinition(styleId);
  const brushId = getSmartThemeDefinition(style.themeId).defaultBrushId;
  if (getSmartBrushDefinition(brushId).collisionRole !== 'solid') throw new RangeError('Choose a solid terrain style for this layout.');
  const room = cloneRoomSnapshot(base);
  room.tileData = createDefaultRoomSnapshot(base.id, base.coordinates).tileData;
  room.smartTerrain = createRoomSmartTerrainState();
  room.smartTerrain.detailsEnabled = base.smartTerrain?.detailsEnabled ?? true;
  room.placedObjects = [];
  room.goal = null;
  room.goalIntroText = null;
  room.spawnPoint = null;
  const cells = new Map<string, { x: number; y: number }>();
  for (const rect of definition.rectangles) {
    for (let x = rect.x1; x <= rect.x2; x += 1) for (let y = rect.y1; y <= rect.y2; y += 1) cells.set(`${x},${y}`, { x, y });
  }
  if (cells.size) {
    const document = applyRegisteredSmartBrushCells({ tileData: room.tileData, smartTerrain: room.smartTerrain }, { cells: cells.values(), mode: 'paint', brushId, styleId, layer: 'terrain' });
    room.tileData = document.tileData;
    room.smartTerrain = document.smartTerrain;
  }
  const commands: RoomDraftCommand[] = [];
  if (definition.spawn) commands.push({ type: 'set_spawn', ...definition.spawn });
  if (definition.exit) commands.push({ type: 'set_goal', goal: { type: 'reach_exit', exit: { x: definition.exit.tileX * TILE_SIZE + TILE_SIZE / 2, y: definition.exit.tileY * TILE_SIZE + TILE_SIZE / 2 }, timeLimitMs: null } });
  for (const enemy of definition.enemies ?? []) commands.push({ type: 'place_object', objectId: enemy.id, tileX: enemy.tileX, tileY: enemy.tileY });
  return applyRoomDraftCommands(room, commands).snapshot;
}
