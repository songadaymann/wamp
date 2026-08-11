import { describe, expect, it } from 'vitest';
import {
  getWorldTileManifestRendererRole,
  parseWorldTileConfig,
  parseWorldTileManifest,
  WorldTileManifestCompatibilityError,
} from './manifest';

describe('world tile wire contracts', () => {
  it('accepts strict ready-image and ready-empty entries in stable order', () => {
    const manifest = parseWorldTileManifest({
      schemaVersion: 1,
      rendererVersion: 'renderer-v1',
      level: 1,
      targetBounds: { minTileX: 0, maxTileX: 0, minTileY: 0, maxTileY: 0 },
      entries: [
        {
          address: { rendererVersion: 'renderer-v1', level: 1, x: 1, y: 0 },
          desiredGeneration: 1,
          desiredEmpty: true,
          readyEmptyGeneration: 1,
          ready: null,
          staleRoomIds: [],
        },
        {
          address: { rendererVersion: 'renderer-v1', level: 1, x: 0, y: 0 },
          desiredGeneration: 2,
          desiredEmpty: false,
          readyEmptyGeneration: null,
          ready: {
            generation: 2,
            contentHash: 'a'.repeat(64),
            url: 'https://tiles.example.test/world/a.png',
            width: 642,
            height: 354,
            overlap: 1,
            byteLength: 12,
          },
          staleRoomIds: ['0,0'],
        },
      ],
      rooms: [],
    });
    expect(manifest.entries.map((entry) => entry.address.x)).toEqual([0, 1]);
    expect(manifest.entries[1].readyEmptyGeneration).toBe(1);
  });

  it('rejects incompatible dimensions, renderer identities, and private room states', () => {
    const base = {
      schemaVersion: 1,
      rendererVersion: 'renderer-v1',
      level: 0,
      targetBounds: { minTileX: 0, maxTileX: 0, minTileY: 0, maxTileY: 0 },
      entries: [],
      rooms: [],
    };
    expect(() => parseWorldTileManifest({
      ...base,
      entries: [{
        address: { rendererVersion: 'renderer-v2', level: 0, x: 0, y: 0 },
        desiredGeneration: 1,
        desiredEmpty: false,
        readyEmptyGeneration: null,
        ready: null,
        staleRoomIds: [],
      }],
    })).toThrow(WorldTileManifestCompatibilityError);
    expect(() => parseWorldTileManifest({
      ...base,
      rooms: [{ state: 'claimed_unpublished' }],
    })).toThrow(WorldTileManifestCompatibilityError);
  });

  it('parses only the supported config schema', () => {
    expect(parseWorldTileConfig({
      schemaVersion: 1,
      available: true,
      rolloutPercentage: 25,
      activeRendererVersion: 'renderer-v1',
      activeRendererAssetContractHash: 'authoring-catalog-v1:1234567890abcdef',
      expectedRendererAssetContractHash: 'authoring-catalog-v1:1234567890abcdef',
    })).toMatchObject({
      available: true,
      rolloutPercentage: 25,
      activeRendererAssetContractHash: 'authoring-catalog-v1:1234567890abcdef',
      expectedRendererAssetContractHash: 'authoring-catalog-v1:1234567890abcdef',
    });
    expect(() => parseWorldTileConfig({ schemaVersion: 2 }))
      .toThrow(WorldTileManifestCompatibilityError);
  });

  it('allows manifests only for renderer identities established by config', () => {
    const input = {
      activeRendererVersion: 'renderer-v2',
      previousRendererVersion: 'renderer-v1',
    };
    expect(getWorldTileManifestRendererRole({
      ...input,
      manifestRendererVersion: 'renderer-v2',
    })).toBe('active');
    expect(getWorldTileManifestRendererRole({
      ...input,
      manifestRendererVersion: 'renderer-v1',
    })).toBe('previous');
    expect(getWorldTileManifestRendererRole({
      ...input,
      manifestRendererVersion: 'renderer-v0',
    })).toBe('reject');
    expect(getWorldTileManifestRendererRole({
      activeRendererVersion: null,
      previousRendererVersion: null,
      manifestRendererVersion: 'renderer-v1',
    })).toBe('reject');
  });
});
