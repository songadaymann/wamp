import { isRoomMinted, type RoomRecord, type RoomSummary } from './roomModel';

export const ROOM_CRYPTO_FIELDS = [
  'mintedChainId', 'mintedContractAddress', 'mintedTokenId', 'mintedOwnerWalletAddress',
  'mintedOwnerSyncedAt', 'mintedMetadataRoomVersion', 'mintedMetadataUpdatedAt', 'mintedMetadataHash',
] as const;

/** Restore the internal nullable model after reading a payload without crypto details. */
export function normalizeRoomCryptoDetails<T extends RoomRecord | RoomSummary>(value: T, includeCrypto = true): T {
  const normalized = { ...value, isProtected: isRoomMinted(value) };
  for (const key of ROOM_CRYPTO_FIELDS) {
    // Both internal models use nullable fields; the wire view may omit them.
    Object.assign(normalized, { [key]: includeCrypto ? value[key] ?? null : null });
  }
  return normalized;
}
