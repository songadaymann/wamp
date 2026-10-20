/** Public room links never inherit preview, tracking, or token-supplied URLs. */
export function buildRoomTokenPlayUrl(coordinates: readonly number[]): string {
  if (coordinates.length !== 2 || coordinates.some(value =>
    !Number.isInteger(value) || value < -2147483648 || value > 2147483647)) {
    throw new Error('Invalid room coordinates.');
  }
  return `https://wamp.land/r/${coordinates[0]}/${coordinates[1]}`;
}

export function parseRoomPreviewTokenId(value: string | null): bigint {
  if (!value || !/^[1-9][0-9]{0,77}$/.test(value)) {
    throw new Error('This preview link has an invalid token ID.');
  }
  const tokenId = BigInt(value);
  if (tokenId >= 2n ** 256n) throw new Error('This preview link has an invalid token ID.');
  return tokenId;
}
