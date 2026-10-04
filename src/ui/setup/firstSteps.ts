import { ROOM_HEIGHT, ROOM_WIDTH, TILE_SIZE, getTilesetByKey } from '../../config';
import { createDefaultRoomSnapshot, type RoomCoordinates } from '../../persistence/roomModel';
import type { RoomRepository } from '../../persistence/roomRepository';
import type { RoomSequenceStartDetail } from './roomSequenceEvents';

export const FIRST_STEPS_COORDINATES: readonly RoomCoordinates[] = Array.from(
  { length: 6 }, (_, index) => ({ x: -11 + index, y: -6 }),
);

export async function loadFirstSteps(repository: Pick<RoomRepository, 'loadRoomCurrent'>): Promise<RoomSequenceStartDetail> {
  const entries = await Promise.all(FIRST_STEPS_COORDINATES.map(async coordinates => {
    const roomId = `${coordinates.x},${coordinates.y}`;
    const { published } = await repository.loadRoomCurrent(roomId, coordinates);
    if (!published?.goal) throw new Error('A tutorial room is unavailable. Please try again.');
    return { roomId, roomCoordinates: { ...coordinates }, roomVersion: published.version, roomTitle: published.title };
  }));
  return {
    kind: 'welcome', mode: 'play', entries, sourceLabel: 'First Steps', kickerLabel: 'First Steps',
    forceGoalIntro: true, showDesktopControlsIntro: true,
  };
}

/** Use the catalog's authored ground recipe so the starter follows its tileset. */
export function createStarterRoomSnapshot(roomId: string, coordinates: RoomCoordinates) {
  const room = createDefaultRoomSnapshot(roomId, coordinates);
  const forest = getTilesetByKey('forest')!;
  const ground = forest.authoringBuildStyles!.find(style => style.id === 'forest_flat')!;
  const floorRow = ROOM_HEIGHT - 3;
  for (let y = floorRow; y < ROOM_HEIGHT; y++) {
    for (let x = 0; x < ROOM_WIDTH; x++) {
      const indices = y === floorRow ? ground.surfaceLocalIndices : ground.fillLocalIndices;
      room.tileData.terrain[y][x] = forest.firstGid + indices[x % indices.length];
    }
  }
  room.title = 'My First Room';
  room.cameraMode = 'room';
  room.spawnPoint = { x: 3.5 * TILE_SIZE, y: floorRow * TILE_SIZE - TILE_SIZE };
  room.goal = { type: 'reach_exit', exit: { x: (ROOM_WIDTH - 4.5) * TILE_SIZE, y: room.spawnPoint.y }, timeLimitMs: null };
  room.goalIntroText = 'Reach the exit. Then add platforms, coins or a challenge of your own.';
  return room;
}
