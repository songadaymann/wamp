import type { RoomDifficulty, RoomDiscoveryResponse, RoomDiscoverySort } from '../../runs/model';
import type { RunRepository } from '../../runs/runRepository';

const MIN_DEFAULT_FEATURED_ROOMS = 8;

export async function loadExploreDiscovery(
  repository: Pick<RunRepository, 'loadRoomDiscovery'>,
  difficulty: RoomDifficulty | null, sort: Exclude<RoomDiscoverySort, 'builder'>, chooseDefault: boolean,
  isCurrent: () => boolean,
): Promise<{ response: RoomDiscoveryResponse; sort: Exclude<RoomDiscoverySort, 'builder'> } | null> {
  let response = await repository.loadRoomDiscovery(difficulty, sort, 48, sort === 'newest' && difficulty === null);
  if (!isCurrent()) return null;
  if (chooseDefault && response.results.filter(room => room.featured).length < MIN_DEFAULT_FEATURED_ROOMS) {
    sort = 'popular';
    response = await repository.loadRoomDiscovery(difficulty, sort, 48, false);
  }
  return isCurrent() ? { response, sort } : null;
}
