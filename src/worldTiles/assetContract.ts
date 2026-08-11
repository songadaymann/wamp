import { BACKGROUND_GROUPS, GAME_OBJECTS, TILESETS } from '../config';

const FNV_1A_64_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_1A_64_PRIME = 0x100000001b3n;
const FNV_1A_64_MASK = 0xffffffffffffffffn;

export function createWorldTileAuthoringAssetContractHash(source: string): string {
  let hash = FNV_1A_64_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(source)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_1A_64_PRIME) & FNV_1A_64_MASK;
  }
  return `authoring-catalog-v1:${hash.toString(16).padStart(16, '0')}`;
}

export function serializeWorldTileAuthoringAssets(): string {
  return JSON.stringify({
    tilesets: TILESETS,
    objects: GAME_OBJECTS,
    backgrounds: BACKGROUND_GROUPS,
  });
}

/**
 * Changes whenever a built-in asset registry changes in a way that could affect
 * immutable overworld preview rendering.
 */
export const WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH =
  createWorldTileAuthoringAssetContractHash(serializeWorldTileAuthoringAssets());
