import { describe, expect, it, vi } from 'vitest';
import {
  buildEarlyWorldTileManifestUrl,
  buildEarlyWorldTileCacheUrl,
  calculateEarlyWorldTileImagePresentation,
  calculateEarlyWorldTileViewport,
  createEarlyWorldTileCoverageHandoffSlot,
  decideEarlyWorldTileRollout,
  getEarlyWorldTileCohortBucket,
  getEarlyWorldTileContainerRect,
  getEarlyWorldTileImageStyle,
  getEarlyWorldTileLayerStyle,
  getEarlyWorldTilePublicRequestInit,
  parseEarlyWorldTileBootstrapZoom,
  parseEarlyWorldTileManifest,
  persistEarlyWorldTileBlob,
  setEarlyWorldTileVisibilityDataset,
  type EarlyWorldTileBounds,
  type EarlyWorldTileCoverageManifest,
  type EarlyWorldTileEntry,
} from './earlyWorldTileBootstrap.classic';
import {
  buildWorldTileByteCacheRequest,
  WORLD_TILE_BYTE_CACHE_HASH_PARAM,
} from '../scenes/overworld/worldTiles/byteCacheContract';
import {
  decideWorldTileRollout,
  getWorldTileCohortBucket,
} from '../scenes/overworld/worldTiles/rollout';

const rendererVersion = 'renderer-v1';
const hash = 'a'.repeat(64);

describe('classic early world tile bootstrap', () => {
  it('matches the runtime rollout decision for force, shadow, off, and stable cohorts', () => {
    const config = {
      schemaVersion: 1 as const,
      available: true,
      rolloutPercentage: 37,
      activeRendererVersion: rendererVersion,
    };
    for (const search of ['', '?worldTiles=force', '?worldTiles=shadow', '?worldTiles=off']) {
      const early = decideEarlyWorldTileRollout({ config, cohortId: 'known-cohort', search });
      const runtime = decideWorldTileRollout({ config, cohortId: 'known-cohort', search });
      expect(early).toMatchObject({
        enabled: runtime.enabled,
        forced: runtime.forced,
        shadow: runtime.shadow,
        cohortId: runtime.cohortId,
        bucket: runtime.bucket,
      });
      expect(getEarlyWorldTileCohortBucket('known-cohort'))
        .toBe(getWorldTileCohortBucket('known-cohort'));
    }
  });

  it('uses the 0.18 browse default and accepts only a bounded QA bootstrap zoom', () => {
    expect(parseEarlyWorldTileBootstrapZoom('')).toBe(0.18);
    expect(parseEarlyWorldTileBootstrapZoom('?worldTilesBootstrapZoom=0.08')).toBe(0.08);
    expect(parseEarlyWorldTileBootstrapZoom('?worldTilesBootstrapZoom=0.01')).toBe(0.18);
    expect(parseEarlyWorldTileBootstrapZoom('?worldTilesBootstrapZoom=nope')).toBe(0.18);
  });

  it('uses mathematical floor division across negative L0 coordinates', () => {
    expect(calculateEarlyWorldTileViewport({
      width: 640,
      height: 352,
      zoom: 1,
      roomX: -17,
      roomY: -17,
    }).bounds).toEqual({ minTileX: -2, maxTileX: -2, minTileY: -2, maxTileY: -2 });

    expect(calculateEarlyWorldTileViewport({
      width: 1440,
      height: 900,
      zoom: 0.18,
    }).bounds).toEqual({ minTileX: -1, maxTileX: 0, minTileY: -1, maxTileY: 0 });
  });

  it('positions the full 642x354 guttered image over its 640x352 content area', () => {
    const viewport = calculateEarlyWorldTileViewport({ width: 1440, height: 900, zoom: 0.18 });
    const presentation = calculateEarlyWorldTileImagePresentation(0, 0, viewport);
    const gutter = 16 * viewport.zoom;
    expect(presentation.left + gutter).toBeCloseTo(662.4);
    expect(presentation.top + gutter).toBeCloseTo(418.32);
    expect(presentation.width).toBeCloseTo(642 * gutter);
    expect(presentation.height).toBeCloseTo(354 * gutter);
  });

  it('defines a fixed click-through pixelated DOM cover behind the loading card', () => {
    expect(getEarlyWorldTileLayerStyle({ left: 0, top: 0, width: 1440, height: 864 })).toMatchObject({
      position: 'fixed',
      left: '0px',
      top: '0px',
      width: '1440px',
      height: '864px',
      zIndex: '139',
      pointerEvents: 'none',
      background: 'transparent',
    });
    expect(getEarlyWorldTileImageStyle({ left: -1, top: -2, width: 642, height: 354 }))
      .toMatchObject({
        left: '-1px',
        top: '-2px',
        width: '642px',
        height: '354px',
        pointerEvents: 'none',
        imageRendering: 'pixelated',
      });
  });

  it('aligns display coverage to the live game container while retaining a larger request cover', () => {
    const rect = getEarlyWorldTileContainerRect({
      getElementById: (id) => id === 'game-container' ? ({
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 864 }),
      } as HTMLElement) : null,
      documentElement: { clientWidth: 1440, clientHeight: 900 },
      body: { dataset: { appMode: 'world' } },
    }, { innerWidth: 1440, innerHeight: 900 });
    expect(rect).toEqual({ left: 0, top: 0, width: 1440, height: 864 });
    const displayViewport = calculateEarlyWorldTileViewport({
      width: rect.width,
      height: rect.height,
      zoom: 0.18,
    });
    const presentation = calculateEarlyWorldTileImagePresentation(0, 0, displayViewport);
    expect(presentation.top + 16 * 0.18).toBeCloseTo(400.32);
  });

  it('uses the intended full-width world stage before appMode replaces the editor grid', () => {
    const rect = getEarlyWorldTileContainerRect({
      getElementById: (id) => {
        if (id === 'game-container') {
          return {
            getBoundingClientRect: () => ({ left: 280, top: 0, width: 1160, height: 864 }),
          } as HTMLElement;
        }
        if (id === 'bottom-bar') {
          return {
            getBoundingClientRect: () => ({ left: 0, top: 864, width: 1440, height: 36 }),
          } as HTMLElement;
        }
        return null;
      },
      documentElement: { clientWidth: 1440, clientHeight: 900 },
      body: { dataset: {} },
    }, { innerWidth: 1440, innerHeight: 900 });
    expect(rect).toEqual({ left: 0, top: 0, width: 1440, height: 864 });
  });

  it('keeps public config/manifest reads anonymous and cache persistence off the attach path', () => {
    expect(getEarlyWorldTilePublicRequestInit()).toMatchObject({ credentials: 'omit' });
    let resolvePut!: () => void;
    const put = vi.fn(() => new Promise<void>((resolve) => {
      resolvePut = resolve;
    }));
    expect(persistEarlyWorldTileBlob(
      { put },
      new Request('https://tiles.example/tile.png'),
      new Blob(['png']),
    )).toBeUndefined();
    expect(put).toHaveBeenCalledOnce();
    resolvePut();
  });

  it('keeps the early coarse manifest coverage-only', () => {
    const url = new URL(buildEarlyWorldTileManifestUrl(
      'https://api.example',
      'https://game.example/?worldTiles=force',
      { minTileX: -1, maxTileX: 0, minTileY: -1, maxTileY: 0 },
    ));
    expect(url.pathname).toBe('/api/world/tiles/manifest');
    expect(url.searchParams.get('level')).toBe('0');
    expect(url.searchParams.get('includeRooms')).toBe('0');
  });

  it('sets and clears the narrow loading-veil dataset', () => {
    const body = { dataset: {} as DOMStringMap };
    setEarlyWorldTileVisibilityDataset(body as HTMLElement, true);
    expect(body.dataset.earlyWorldTilesVisible).toBe('true');
    setEarlyWorldTileVisibilityDataset(body as HTMLElement, false);
    expect(body.dataset.earlyWorldTilesVisible).toBeUndefined();
  });

  it('uses the exact shared CacheStorage request identity', () => {
    const ready = { url: 'https://tiles.example/world.png?generation=2', contentHash: hash };
    expect(buildEarlyWorldTileCacheUrl(
      ready.url,
      ready.contentHash,
      WORLD_TILE_BYTE_CACHE_HASH_PARAM,
    )).toBe(buildWorldTileByteCacheRequest(ready).url);
  });

  it('requires complete ready-image or current ready-empty coverage in stable order', () => {
    const bounds: EarlyWorldTileBounds = {
      minTileX: -1,
      maxTileX: 0,
      minTileY: 0,
      maxTileY: 0,
    };
    const parsed = parseEarlyWorldTileManifest({
      schemaVersion: 1,
      rendererVersion,
      level: 0,
      targetBounds: bounds,
      entries: [
        readyEntry(0, 0),
        emptyEntry(-1, 0),
      ],
      rooms: [],
    }, bounds, rendererVersion);
    expect(parsed.entries.map((entry) => [entry.address.x, entry.address.y, Boolean(entry.ready)]))
      .toEqual([[-1, 0, false], [0, 0, true]]);
  });

  it('hands validated anonymous L0 coverage to exactly one matching lifecycle consumer', () => {
    const bounds: EarlyWorldTileBounds = {
      minTileX: -1,
      maxTileX: 0,
      minTileY: 0,
      maxTileY: 0,
    };
    const coverage: EarlyWorldTileCoverageManifest = {
      schemaVersion: 1,
      rendererVersion,
      level: 0,
      targetBounds: bounds,
      entries: [emptyEntry(-1, 0), readyEntry(0, 0)],
      rooms: [],
    };
    const slot = createEarlyWorldTileCoverageHandoffSlot();
    slot.publish(coverage);

    expect(slot.consume({
      schemaVersion: 1,
      consumerGeneration: -1,
      rendererVersion,
      level: 0,
      targetBounds: bounds,
    })).toBeNull();
    expect(slot.consume({
      schemaVersion: 1,
      consumerGeneration: 4,
      rendererVersion: 'different-renderer',
      level: 0,
      targetBounds: bounds,
    })).toBeNull();
    expect(slot.consume({
      schemaVersion: 1,
      consumerGeneration: 4,
      rendererVersion,
      level: 0,
      targetBounds: { ...bounds, maxTileX: 1 },
    })).toBeNull();

    const handoff = slot.consume({
      schemaVersion: 1,
      consumerGeneration: 4,
      rendererVersion,
      level: 0,
      targetBounds: bounds,
    });
    expect(handoff).toMatchObject({
      schemaVersion: 1,
      bootstrapGeneration: 1,
      consumerGeneration: 4,
      manifest: { rendererVersion, level: 0, targetBounds: bounds, rooms: [] },
    });
    handoff!.manifest.entries[0].desiredGeneration = 99;
    expect(coverage.entries[0].desiredGeneration).toBe(2);
    expect(slot.consume({
      schemaVersion: 1,
      consumerGeneration: 4,
      rendererVersion,
      level: 0,
      targetBounds: bounds,
    })).toBeNull();

    slot.publish(coverage);
    slot.clear();
    expect(slot.consume({
      schemaVersion: 1,
      consumerGeneration: 5,
      rendererVersion,
      level: 0,
      targetBounds: bounds,
    })).toBeNull();
  });

  it('rejects missing cells, pending empties, and invalid image contracts before DOM exposure', () => {
    const bounds = { minTileX: 0, maxTileX: 0, minTileY: 0, maxTileY: 0 };
    expect(() => parseEarlyWorldTileManifest(manifest(bounds, []), bounds, rendererVersion))
      .toThrow('Missing early world tile');
    expect(() => parseEarlyWorldTileManifest(manifest(bounds, [{
      ...emptyEntry(0, 0),
      readyEmptyGeneration: 1,
      desiredGeneration: 2,
    }]), bounds, rendererVersion)).toThrow('is not ready');
    expect(() => parseEarlyWorldTileManifest(manifest(bounds, [{
      ...readyEntry(0, 0),
      ready: { ...readyEntry(0, 0).ready, width: 640 },
    }]), bounds, rendererVersion)).toThrow('ready.width');
  });
});

function readyEntry(x: number, y: number): EarlyWorldTileEntry {
  return {
    address: { rendererVersion, level: 0, x, y },
    desiredGeneration: 2,
    desiredEmpty: false,
    readyEmptyGeneration: null,
    ready: {
      generation: 2,
      contentHash: hash,
      url: `https://tiles.example/${x}/${y}.png`,
      width: 642,
      height: 354,
      overlap: 1,
      byteLength: 128,
    },
    staleRoomIds: [],
  };
}

function emptyEntry(x: number, y: number): EarlyWorldTileEntry {
  return {
    address: { rendererVersion, level: 0, x, y },
    desiredGeneration: 2,
    desiredEmpty: true,
    readyEmptyGeneration: 2,
    ready: null,
    staleRoomIds: [],
  };
}

function manifest(bounds: EarlyWorldTileBounds, entries: unknown[]) {
  return {
    schemaVersion: 1,
    rendererVersion,
    level: 0,
    targetBounds: bounds,
    entries,
    rooms: [],
  };
}
