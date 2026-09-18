import { decodeTileDataValue } from '../../config';

export function encodedTileFloodKey(encoded: number, ignoreTileFlipping: boolean): number {
  if (!ignoreTileFlipping || encoded < 0) {
    return encoded;
  }
  return decodeTileDataValue(encoded).gid;
}

export function encodedTilesMatchForFlood(
  current: number,
  target: number,
  ignoreTileFlipping: boolean,
): boolean {
  return encodedTileFloodKey(current, ignoreTileFlipping)
    === encodedTileFloodKey(target, ignoreTileFlipping);
}
