import { SPECIAL_TILESET_FIRST_GID, SPECIAL_TILE_LOCAL_INDICES, TILE_SIZE } from '../config';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../persistence/roomModel';
import { JIMOTHY_OBJECT_ID } from '../npcs/model';

export type PreviewPhysicsFixture = 'normal' | 'ice' | 'conveyor' | 'water' | 'wind' | 'moving-platform'
  | 'gravity-up' | 'gravity-left' | 'gravity-right' | 'jimothy-wander';

/** Authored local-only rooms for the existing preview smoke surface. */
export function createPhysicsPreviewRoom(fixture: PreviewPhysicsFixture = 'normal'): RoomSnapshot {
  if (fixture === 'jimothy-wander') {
    return createJimothyWanderPreviewRoom();
  }
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

function createJimothyWanderPreviewRoom(): RoomSnapshot {
  const room = createDefaultRoomSnapshot('99,99', { x: 99, y: 99 });
  const floorY = 16;
  const solid = 492;
  const pitColumns = new Set([18, 19, 20, 21]);
  room.title = 'Jimothy Wander';
  room.background = 'cave';
  room.spawnPoint = { x: 12 * TILE_SIZE + 8, y: floorY * TILE_SIZE - 16 };
  for (let tileX = 2; tileX <= 37; tileX += 1) {
    room.tileData.terrain[pitColumns.has(tileX) ? floorY + 1 : floorY][tileX] = solid;
  }
  for (const tileY of [floorY - 3, floorY - 2, floorY - 1]) {
    room.tileData.terrain[tileY][2] = solid;
    room.tileData.terrain[tileY][37] = solid;
  }
  for (const tileX of [10, 11, 12, 27, 28, 29]) {
    room.tileData.terrain[floorY - 1][tileX] = solid;
  }
  const feetY = floorY * TILE_SIZE - 16;
  room.placedObjects = [
    {
      id: JIMOTHY_OBJECT_ID,
      instanceId: 'jimothy-wander-left',
      layer: 'terrain',
      x: 8 * TILE_SIZE,
      y: feetY,
      facing: 'right',
      npcMode: 'wander',
      npcCanJumpFall: true,
      npcPlayerCollision: true,
      npcFriendlyFire: false,
      npcName: 'Left',
    },
    {
      id: JIMOTHY_OBJECT_ID,
      instanceId: 'jimothy-wander-right',
      layer: 'terrain',
      x: 32 * TILE_SIZE,
      y: feetY,
      facing: 'left',
      npcMode: 'wander',
      npcCanJumpFall: true,
      npcPlayerCollision: true,
      npcFriendlyFire: false,
      npcName: 'Right',
    },
  ];
  return room;
}
