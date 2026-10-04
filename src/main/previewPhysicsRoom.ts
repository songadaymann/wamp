import { SPECIAL_TILESET_FIRST_GID, SPECIAL_TILE_LOCAL_INDICES, TILE_SIZE } from '../config';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../persistence/roomModel';
import { JIMOTHY_OBJECT_ID } from '../npcs/model';

export type PreviewPhysicsFixture = 'normal' | 'ice' | 'conveyor' | 'water' | 'wind' | 'moving-platform'
  | 'gravity-up' | 'gravity-left' | 'gravity-right';

/** Authored local-only rooms for the existing preview smoke surface. */
export function createPhysicsPreviewRoom(fixture: PreviewPhysicsFixture = 'normal'): RoomSnapshot {
  const room = createDefaultRoomSnapshot('99,99', { x: 99, y: 99 });
  const floorY = 16;
  const solid = 492;
  const gid = (kind: keyof typeof SPECIAL_TILE_LOCAL_INDICES) => SPECIAL_TILESET_FIRST_GID + SPECIAL_TILE_LOCAL_INDICES[kind];
  room.title = `Physics Preview: ${fixture}`;
  room.background = 'cave';
  room.spawnPoint = { x: 320, y: floorY * TILE_SIZE - 16 };
  room.tileData.terrain[floorY].fill(fixture === 'ice' ? gid('ice') : fixture === 'conveyor' ? gid('conveyorRight') : solid);
  if (fixture === 'water' || fixture === 'wind') {
    for (let y = 4; y < floorY; y += 1) room.tileData.terrain[y].fill(gid(fixture === 'water' ? 'water' : 'windRight'));
  }
  const gravity = fixture === 'gravity-up' ? 'gravityUp' : fixture === 'gravity-left' ? 'gravityLeft'
    : fixture === 'gravity-right' ? 'gravityRight' : null;
  if (gravity) {
    room.tileData.terrain[floorY - 1].fill(gid(gravity));
    room.tileData.terrain[3].fill(solid);
    for (let y = 3; y < floorY; y += 1) {
      room.tileData.terrain[y][3] = solid;
      room.tileData.terrain[y][36] = solid;
    }
  }
  room.placedObjects = [{
    id: JIMOTHY_OBJECT_ID, instanceId: 'physics-preview-npc', layer: 'terrain',
    x: 480, y: floorY * TILE_SIZE - 32, facing: 'left', npcMode: 'patrol',
    npcPushable: true, npcCanJumpFall: false, npcPlayerCollision: false,
  }];
  if (fixture === 'moving-platform') {
    room.placedObjects[0].npcMode = 'idle';
    room.placedObjects.push(
      { id: 'moving_platform', instanceId: 'physics-preview-platform', layer: 'terrain',
        x: 320, y: 192, linkedTargetInstanceIds: ['physics-preview-anchor'] },
      { id: 'moving_platform_endpoint', instanceId: 'physics-preview-anchor', layer: 'terrain',
        x: 416, y: 192 },
    );
  }
  return room;
}
