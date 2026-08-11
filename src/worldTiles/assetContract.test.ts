import { describe, expect, it } from 'vitest';
import {
  WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH,
  createWorldTileAuthoringAssetContractHash,
  serializeWorldTileAuthoringAssets,
} from './assetContract';

describe('world tile authoring asset contract', () => {
  it('is deterministic and versioned', () => {
    expect(WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH).toBe(
      createWorldTileAuthoringAssetContractHash(serializeWorldTileAuthoringAssets()),
    );
    expect(WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH)
      .toMatch(/^authoring-catalog-v1:[a-f0-9]{16}$/);
  });

  it('changes when a registry serialization changes', () => {
    expect(createWorldTileAuthoringAssetContractHash('{"tilesets":[]}'))
      .not.toBe(createWorldTileAuthoringAssetContractHash('{"tilesets":[{"key":"new"}]}'));
  });
});
