import { describe, expect, it } from 'vitest';
import { assertWorldTileAvailability } from './check_world_tile_availability.mjs';

const config = {
  schemaVersion: 1, available: true, rolloutPercentage: 100, activeRendererVersion: 'renderer-1',
  activeRendererAssetContractHash: 'catalog-1', expectedRendererAssetContractHash: 'catalog-1',
};

describe('production world map health gate', () => {
  it('accepts a compatible enabled rollout', () => {
    expect(() => assertWorldTileAvailability(config)).not.toThrow();
  });
  it.each([
    { available: false }, { rolloutPercentage: 0 }, { activeRendererVersion: null },
    { activeRendererAssetContractHash: 'old' }, { expectedRendererAssetContractHash: undefined },
  ])('rejects disabled or incompatible imagery: %j', (change) => {
    expect(() => assertWorldTileAvailability({ ...config, ...change })).toThrow('unavailable or incompatible');
  });
});
