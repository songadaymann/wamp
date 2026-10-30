import { ROOM_CRYPTO_FIELDS } from '../../../persistence/roomCryptoDetails';
import { isRoomMinted, type RoomRecord, type RoomSummary } from '../../../persistence/roomModel';

/** Presentation only: compute permissions from the complete record before projecting it. */
export function presentRoomCryptoDetails<T extends RoomRecord | RoomSummary>(value: T, url: URL) {
  const view: Partial<T> & { isProtected: boolean } = { ...value, isProtected: isRoomMinted(value) };
  if (url.searchParams.get('crypto') !== '1') {
    for (const key of ROOM_CRYPTO_FIELDS) delete view[key];
  }
  return view;
}
