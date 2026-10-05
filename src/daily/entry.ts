import type { DailyRepository } from './repository';
import type { RoomCoordinates } from '../persistence/roomModel';

/** Only daily links need this extra gate; ordinary shared-link loading stays unchanged. */
export async function dailyEntryReady(repository: DailyRepository, date: string, coordinates: RoomCoordinates,
  selectedRoomVersion: number | null, publishedSummaryVersion: number | null = null): Promise<boolean> {
  const response=await repository.load();
  const pick=response.pick;
  return response.date===date && Boolean(pick?.available && pick.coordinates.x===coordinates.x && pick.coordinates.y===coordinates.y
    // Tiled Browse has publication metadata before it hydrates the full snapshot for Play.
    // A known stale snapshot still fails the gate; metadata only fills an absent snapshot.
    && (pick.contentType==='expanded_room' || pick.roomVersion===(selectedRoomVersion ?? publishedSummaryVersion)));
}
