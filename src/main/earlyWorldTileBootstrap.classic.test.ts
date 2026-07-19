import { describe, expect, it, vi } from 'vitest';
import {
  buildEarlyWorldTileManifestUrl,
  buildEarlyWorldTileCacheUrl,
  buildEarlyWorldTileCoverageKey,
  calculateEarlyWorldTileImagePresentation,
  calculateEarlyWorldTileImagePresentationAtLevel,
  calculateEarlyWorldTileViewport,
  calculateEarlyWorldTileViewportAtLevel,
  createEarlyWorldTileCoverageHandoffSlot,
  createEarlyWorldTileRefinementCancellation,
  decideEarlyWorldTileRollout,
  getEarlyWorldTileCohortBucket,
  getEarlyWorldTileContainerRect,
  getEarlyWorldTileImageStyle,
  getEarlyWorldTileLayerStyle,
  getEarlyWorldTilePublicRequestInit,
  earlyWorldTileBoundsContain,
  installEarlyWorldTileBootstrap,
  parseEarlyWorldTileBootstrapZoom,
  parseEarlyWorldTileFocus,
  parseEarlyWorldTileManifest,
  parseEarlyWorldTileManifestAtLevel,
  persistEarlyWorldTileBlob,
  setEarlyWorldTileVisibilityDataset,
  selectEarlyWorldTileLevel,
  waitForEarlyWorldTilePaint,
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

  it('prefers signed room-share paths, accepts safe query coordinates, and defaults safely', () => {
    expect(parseEarlyWorldTileFocus('/r/-17/42', '?x=8&y=9')).toEqual({ x: -17, y: 42 });
    expect(parseEarlyWorldTileFocus('/', '?x=-8&y=9')).toEqual({ x: -8, y: 9 });
    expect(parseEarlyWorldTileFocus('/', '?x=&y=9')).toEqual({ x: 0, y: 0 });
    expect(parseEarlyWorldTileFocus('/', `?x=${Number.MAX_SAFE_INTEGER + 1}&y=9`))
      .toEqual({ x: 0, y: 0 });
  });

  it('selects the five initial pyramid levels at their exact zoom boundaries', () => {
    expect([0.08, 0.10, 0.17, 0.18, 0.20, 0.40, 0.80].map(selectEarlyWorldTileLevel))
      .toEqual([0, 1, 1, 1, 2, 3, 4]);
  });

  it('uses the same explicit renderer, level, and signed bounds coverage identity as Phaser', () => {
    const bounds = { minTileX: -2, maxTileX: 1, minTileY: -1, maxTileY: 0 };
    expect(buildEarlyWorldTileCoverageKey(rendererVersion, 2, bounds)).toBe(
      JSON.stringify([rendererVersion, 2, -2, 1, -1, 0]),
    );
    expect(earlyWorldTileBoundsContain(bounds, {
      minTileX: -1,
      maxTileX: 1,
      minTileY: -1,
      maxTileY: 0,
    })).toBe(true);
    expect(earlyWorldTileBoundsContain(bounds, { ...bounds, maxTileX: 2 })).toBe(false);
  });

  it('cancels only target refinement and retains the first intentional timeout reason', () => {
    const cancellation = createEarlyWorldTileRefinementCancellation();
    expect(cancellation.signal.aborted).toBe(false);
    expect(cancellation.reason).toBeNull();
    cancellation.cancel('coarse-timeout');
    cancellation.cancel('refinement-timeout');
    expect(cancellation.signal.aborted).toBe(true);
    expect(cancellation.reason).toBe('coarse-timeout');
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

  it('carries a negative deep-link focus through L0 and target-level geometry', () => {
    const focus = parseEarlyWorldTileFocus('/r/-17/-9', '');
    const l0 = calculateEarlyWorldTileViewport({
      width: 640,
      height: 352,
      zoom: 1,
      roomX: focus.x,
      roomY: focus.y,
    });
    const target = calculateEarlyWorldTileViewportAtLevel({
      width: 1280,
      height: 784,
      zoom: 0.18,
      roomX: focus.x,
      roomY: focus.y,
    }, 1);
    expect(l0.centerWorldX).toBe(-17 * 640 + 320);
    expect(l0.centerWorldY).toBe(-9 * 352 + 176);
    expect(target.centerWorldX).toBe(l0.centerWorldX);
    expect(target.centerWorldY).toBe(l0.centerWorldY);
    expect(target.bounds.minTileX).toBeLessThan(0);
    expect(target.bounds.minTileY).toBeLessThan(0);
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

  it('uses signed target-level geometry for pre-Phaser sharp refinement', () => {
    const viewport = calculateEarlyWorldTileViewportAtLevel({
      width: 1280,
      height: 784,
      zoom: 0.18,
    }, 1);
    expect(viewport.bounds).toEqual({
      minTileX: -1,
      maxTileX: 0,
      minTileY: -1,
      maxTileY: 0,
    });
    const presentation = calculateEarlyWorldTileImagePresentationAtLevel(-1, -1, viewport, 1);
    expect(presentation.width).toBeCloseTo(642 * 8 * 0.18);
    expect(presentation.height).toBeCloseTo(354 * 8 * 0.18);
    expect(presentation.left).toBeLessThan(0);
    expect(presentation.top).toBeLessThan(0);
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

  it('keeps public reads anonymous and exposes completion of CacheStorage persistence', async () => {
    expect(getEarlyWorldTilePublicRequestInit()).toMatchObject({ credentials: 'omit' });
    let resolvePut!: () => void;
    const put = vi.fn(() => new Promise<void>((resolve) => {
      resolvePut = resolve;
    }));
    let persisted = false;
    const persistence = persistEarlyWorldTileBlob(
      { put },
      new Request('https://tiles.example/tile.png'),
      new Blob(['png']),
    ).then(() => { persisted = true; });
    expect(put).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(persisted).toBe(false);
    resolvePut();
    await persistence;
    expect(persisted).toBe(true);
  });

  it('waits for two animation frames before reporting painted coverage', async () => {
    const callbacks: FrameRequestCallback[] = [];
    const painted = waitForEarlyWorldTilePaint({
      requestAnimationFrame: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      cancelAnimationFrame: vi.fn(),
    });

    expect(callbacks).toHaveLength(1);
    callbacks.shift()!(16);
    await Promise.resolve();
    expect(callbacks).toHaveLength(1);
    let settled = false;
    void painted.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    callbacks.shift()!(32);
    await painted;
    expect(settled).toBe(true);
  });

  it('retains L0 while a resized deep-link target retries and paints for two frames', async () => {
    const environment = await createBootstrapEnvironment('/r/-17/-9');
    const handle = installEarlyWorldTileBootstrap(environment.options);
    const ready = await handle.ready;
    expect(ready.status).toBe('visible');
    expect(ready.focusRoom).toEqual({ x: -17, y: -9 });
    const coarseLayer = environment.layers()[0];
    expect(coarseLayer.dataset.wampEarlyWorldTileLevel).toBe('0');

    await environment.waitForTargetManifestCount(1);
    expect(environment.pendingFrameCount()).toBe(0);
    expect(environment.sharpEvents).toHaveLength(0);
    environment.releaseCacheWrites();
    await environment.waitForFrame();
    const targetRequests = environment.manifestUrls.filter(
      (url) => new URL(url).searchParams.get('level') === '1',
    );
    expect(targetRequests).toHaveLength(2);
    expect(new URL(targetRequests[0]).searchParams.get('minTileX'))
      .not.toBe(new URL(targetRequests[1]).searchParams.get('minTileX'));
    expect(environment.layers().map((layer) => layer.dataset.wampEarlyWorldTileLevel))
      .toEqual(['1', '0']);
    expect(coarseLayer.removed).toBe(false);
    expect(environment.sharpEvents).toHaveLength(0);

    environment.flushFrame(16);
    await environment.waitForFrame();
    expect(coarseLayer.removed).toBe(false);
    expect(environment.sharpEvents).toHaveLength(0);
    environment.flushFrame(32);
    const sharp = await handle.sharp;

    expect(sharp.displayLevel).toBe(1);
    expect(sharp.focusRoom).toEqual({ x: -17, y: -9 });
    expect(sharp.timings.sharpVisibleAtMs).not.toBeNull();
    expect(environment.sharpEvents).toHaveLength(1);
    expect(coarseLayer.removed).toBe(true);
    expect(environment.layers().map((layer) => layer.dataset.wampEarlyWorldTileLevel))
      .toEqual(['1']);
    handle.release('test-complete');
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

  it('requests and parses only target-level entries while accepting manifest ancestor closure', () => {
    const bounds = { minTileX: -1, maxTileX: 0, minTileY: 0, maxTileY: 0 };
    const url = new URL(buildEarlyWorldTileManifestUrl(
      'https://api.example',
      'https://game.example/?worldTiles=force',
      bounds,
      1,
    ));
    expect(url.searchParams.get('level')).toBe('1');
    const levelOne = (x: number): EarlyWorldTileEntry => ({
      ...readyEntry(x, 0),
      address: { rendererVersion, level: 1, x, y: 0 },
    });
    const parsed = parseEarlyWorldTileManifestAtLevel({
      schemaVersion: 1,
      rendererVersion,
      level: 1,
      targetBounds: bounds,
      entries: [readyEntry(0, 0), levelOne(0), levelOne(-1)],
      rooms: [],
    }, bounds, rendererVersion, 1);
    expect(parsed.entries.map((entry) => [entry.address.level, entry.address.x]))
      .toEqual([[1, -1], [1, 0]]);
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

class FakeBootstrapElement {
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly children: FakeBootstrapElement[] = [];
  parent: FakeBootstrapElement | null = null;
  removed = false;
  id = '';
  decoding = '';
  alt = '';
  draggable = false;
  src = '';
  readonly naturalWidth = 642;
  readonly naturalHeight = 354;

  constructor(readonly tagName: string) {}

  append(...nodes: FakeBootstrapElement[]): void {
    for (const node of nodes) {
      if (node.tagName === '#fragment') {
        this.append(...node.children.splice(0));
        continue;
      }
      node.parent?.detach(node);
      node.parent = this;
      node.removed = false;
      this.children.push(node);
    }
  }

  prepend(node: FakeBootstrapElement): void {
    node.parent?.detach(node);
    node.parent = this;
    node.removed = false;
    this.children.unshift(node);
  }

  remove(): void {
    this.parent?.detach(this);
    this.parent = null;
    this.removed = true;
  }

  setAttribute(): void {}

  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }

  decode(): Promise<void> {
    return Promise.resolve();
  }

  querySelectorAll<T>(selector: string): T[] {
    const dataKey = selector === '[data-wamp-early-world-tile]'
      ? 'wampEarlyWorldTile'
      : selector === '[data-wamp-early-world-tile-mask]'
        ? 'wampEarlyWorldTileMask'
        : null;
    if (!dataKey) return [];
    return this.children.filter((child) => child.dataset[dataKey] !== undefined) as T[];
  }

  private detach(node: FakeBootstrapElement): void {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
  }
}

async function createBootstrapEnvironment(pathname: string) {
  const tileBlob = new Blob([new Uint8Array([1, 3, 3, 7])], { type: 'image/png' });
  const digest = await crypto.subtle.digest('SHA-256', await tileBlob.arrayBuffer());
  const contentHash = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  const body = new FakeBootstrapElement('body');
  body.dataset.appMode = 'world';
  let currentRect = { left: 0, top: 0, width: 640, height: 352 };
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrameId = 0;
  let targetManifestCount = 0;
  const manifestUrls: string[] = [];
  const sharpEvents: Event[] = [];
  let resolveCacheWrites!: () => void;
  const cacheWrites = new Promise<void>((resolve) => {
    resolveCacheWrites = resolve;
  });
  const search = '?worldTiles=force&worldTilesBootstrapZoom=0.18';
  const href = `https://game.example${pathname}${search}`;
  const gameContainer = {
    getBoundingClientRect: () => ({ ...currentRect }),
  };
  const bottomBar = {
    getBoundingClientRect: () => ({ left: 0, top: 352, width: currentRect.width, height: 36 }),
  };
  const doc = {
    body,
    documentElement: { clientWidth: 640, clientHeight: 388 },
    createElement: (tagName: string) => new FakeBootstrapElement(tagName),
    createDocumentFragment: () => new FakeBootstrapElement('#fragment'),
    getElementById: (id: string) => id === 'game-container'
      ? gameContainer
      : id === 'bottom-bar' ? bottomBar : null,
    querySelector: () => null,
    addEventListener: vi.fn(),
  };
  const cache = {
    match: vi.fn(async () => undefined),
    put: vi.fn(async () => cacheWrites),
    delete: vi.fn(async () => true),
  };
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString(), href);
    if (url.pathname === '/api/world/tiles/config') {
      return Response.json({
        schemaVersion: 1,
        available: true,
        rolloutPercentage: 100,
        activeRendererVersion: rendererVersion,
      });
    }
    if (url.pathname === '/api/world/tiles/manifest') {
      manifestUrls.push(url.toString());
      const level = Number(url.searchParams.get('level')) as 0 | 1;
      const bounds = {
        minTileX: Number(url.searchParams.get('minTileX')),
        maxTileX: Number(url.searchParams.get('maxTileX')),
        minTileY: Number(url.searchParams.get('minTileY')),
        maxTileY: Number(url.searchParams.get('maxTileY')),
      };
      const entries: EarlyWorldTileEntry[] = [];
      for (let y = bounds.minTileY; y <= bounds.maxTileY; y += 1) {
        for (let x = bounds.minTileX; x <= bounds.maxTileX; x += 1) {
          entries.push({
            address: { rendererVersion, level, x, y },
            desiredGeneration: 1,
            desiredEmpty: false,
            readyEmptyGeneration: null,
            ready: {
              generation: 1,
              contentHash,
              url: `https://tiles.example/${level}/${x}/${y}.png`,
              width: 642,
              height: 354,
              overlap: 1,
              byteLength: tileBlob.size,
            },
            staleRoomIds: [],
          });
        }
      }
      if (level === 1 && ++targetManifestCount === 1) {
        currentRect = { ...currentRect, width: 2_000 };
      }
      return Response.json({
        schemaVersion: 1,
        rendererVersion,
        level,
        targetBounds: bounds,
        entries,
        rooms: [],
      });
    }
    if (url.hostname === 'tiles.example') return new Response(tileBlob);
    return new Response(null, { status: 404 });
  });
  const storage = new Map([['wamp_world_tile_cohort_v1', 'known-cohort']]);
  const win = {
    innerWidth: 640,
    innerHeight: 388,
    location: { href, pathname, search, hostname: 'game.example' },
    performance,
    crypto,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    caches: { open: vi.fn(async () => cache) },
    fetch,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
    dispatchEvent: (event: Event) => {
      if (event.type === 'wamp:early-world-tiles-sharp-ready') sharpEvents.push(event);
      return true;
    },
  };

  return {
    options: {
      win: win as unknown as Window,
      doc: doc as unknown as Document,
      apiBaseUrl: 'https://api.example',
      cacheName: 'world-tiles-test',
      cacheHashParam: '__wamp_tile_hash',
    },
    manifestUrls,
    sharpEvents,
    layers: () => body.children.filter((child) => child.dataset.wampEarlyWorldTiles === 'true'),
    releaseCacheWrites: () => resolveCacheWrites(),
    pendingFrameCount: () => frames.size,
    waitForTargetManifestCount: async (count: number) => waitForCondition(
      () => targetManifestCount >= count,
    ),
    waitForFrame: async () => waitForCondition(() => frames.size > 0),
    flushFrame: (atMs: number) => {
      const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!entry) throw new Error('No animation frame is pending.');
      frames.delete(entry[0]);
      entry[1](atMs);
    },
  };
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for the bootstrap test condition.');
}
