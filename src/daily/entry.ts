import type { DailyRepository } from './repository';
import type { RoomCoordinates } from '../persistence/roomModel';

/** Only daily links need this extra gate; ordinary shared-link loading stays unchanged. */
export async function dailyEntryReady(repository: DailyRepository, date: string, coordinates: RoomCoordinates,
  selectedRoomVersion: number | null): Promise<boolean> {
  const response=await repository.load();
  const pick=response.pick;
  return response.date===date && Boolean(pick?.available && pick.coordinates.x===coordinates.x && pick.coordinates.y===coordinates.y
    && (pick.contentType==='expanded_room' || pick.roomVersion===selectedRoomVersion));
}
