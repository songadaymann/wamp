import { parseRoomTokenMetadataUri, sha256Hex } from './roomMetadata';
import type { RoomCoordinates } from '../persistence/roomModel';

export interface RoomTokenMetadataObservation {
  metadataRoomVersion: number | null;
  metadataHash: string;
}

/** A malformed/foreign payload can be recorded as unknown, never as current artwork. */
export async function observeRoomTokenMetadata(tokenUri: string, coordinates: RoomCoordinates): Promise<RoomTokenMetadataObservation> {
  const metadataHash = await sha256Hex(tokenUri);
  let metadataRoomVersion: number | null = null;
  try {
    if (tokenUri.length > 100_000) return { metadataRoomVersion, metadataHash };
    const payload = parseRoomTokenMetadataUri(tokenUri).wamp_room;
    if (payload.coordinates[0] === coordinates.x && payload.coordinates[1] === coordinates.y
      && payload.roomId === `${coordinates.x},${coordinates.y}`
      && Number.isSafeInteger(payload.version) && payload.version > 0) {
      metadataRoomVersion = payload.version;
    }
  } catch { /* An empty or unsupported URI has no verified room version. */ }
  return { metadataRoomVersion, metadataHash };
}
