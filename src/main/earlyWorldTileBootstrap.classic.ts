declare const __WAMP_EARLY_WORLD_TILE_API_BASE__: string;
declare const __WAMP_WORLD_TILE_BYTE_CACHE_NAME__: string;
declare const __WAMP_WORLD_TILE_BYTE_CACHE_HASH_PARAM__: string;

const EARLY_WORLD_TILE_SCHEMA_VERSION = 1;
const EARLY_WORLD_TILE_LEVEL = 0;
const EARLY_WORLD_TILE_MAX_LEVEL = 4;
const EARLY_WORLD_TILE_IMAGE_WIDTH = 642;
const EARLY_WORLD_TILE_IMAGE_HEIGHT = 354;
const EARLY_WORLD_TILE_OVERLAP = 1;
const EARLY_WORLD_TILE_CONTENT_WIDTH = 640;
const EARLY_WORLD_TILE_CONTENT_HEIGHT = 352;
const EARLY_WORLD_TILE_ROOMS_PER_SIDE = 16;
const EARLY_WORLD_TILE_DEFAULT_ZOOM = 0.18;
const EARLY_WORLD_TILE_MIN_QA_ZOOM = 0.04;
const EARLY_WORLD_TILE_MAX_QA_ZOOM = 4;
const EARLY_WORLD_TILE_COHORT_STORAGE_KEY = 'wamp_world_tile_cohort_v1';
const EARLY_WORLD_TILE_READY_EVENT = 'wamp:early-world-tiles-ready';
const EARLY_WORLD_TILE_SHARP_READY_EVENT = 'wamp:early-world-tiles-sharp-ready';
const EARLY_WORLD_TILE_MAX_FETCH_CONCURRENCY = 6;

export type EarlyWorldTileLevel = 0 | 1 | 2 | 3 | 4;

export type EarlyWorldTileBootstrapStatus =
  | 'installed'
  | 'loading-config'
  | 'disabled'
  | 'loading-manifest'
  | 'loading-tiles'
  | 'ready-shadow'
  | 'visible'
  | 'failed'
  | 'released';

export interface EarlyWorldTileBounds {
  minTileX: number;
  maxTileX: number;
  minTileY: number;
  maxTileY: number;
}

interface EarlyWorldTileConfig {
  schemaVersion: 1;
  available: boolean;
  rolloutPercentage: number;
  activeRendererVersion: string | null;
}

export interface EarlyWorldTileReady {
  generation: number;
  contentHash: string;
  url: string;
  width: 642;
  height: 354;
  overlap: 1;
  byteLength: number;
}

export interface EarlyWorldTileEntry {
  address: {
    rendererVersion: string;
    level: EarlyWorldTileLevel;
    x: number;
    y: number;
  };
  desiredGeneration: number;
  desiredEmpty: boolean;
  readyEmptyGeneration: number | null;
  ready: EarlyWorldTileReady | null;
  staleRoomIds: string[];
}

export interface EarlyWorldTileRolloutDecision {
  enabled: boolean;
  forced: boolean;
  shadow: boolean;
  cohortId: string;
  bucket: number;
  reason: string | null;
}

export interface EarlyWorldTileViewport {
  width: number;
  height: number;
  zoom: number;
  centerWorldX: number;
  centerWorldY: number;
  bounds: EarlyWorldTileBounds;
}

export interface EarlyWorldTileImagePresentation {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface EarlyWorldTileContainerRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface EarlyWorldTileBootstrapState {
  schemaVersion: 1;
  status: EarlyWorldTileBootstrapStatus;
  decision: EarlyWorldTileRolloutDecision | null;
  apiBaseUrl: string;
  rendererVersion: string | null;
  displayLevel: EarlyWorldTileLevel;
  targetLevel: EarlyWorldTileLevel;
  viewport: EarlyWorldTileViewport | null;
  targetViewport: EarlyWorldTileViewport | null;
  targetBounds: EarlyWorldTileBounds | null;
  coverageKey: string | null;
  displayRect: EarlyWorldTileContainerRect | null;
  imageTileCount: number;
  emptyTileCount: number;
  staleMaskCount: number;
  cacheHitCount: number;
  networkFetchCount: number;
  error: string | null;
  refinementError: string | null;
  releaseReason: string | null;
  timings: {
    installedAtMs: number;
    configStartedAtMs: number | null;
    configReadyAtMs: number | null;
    manifestStartedAtMs: number | null;
    manifestReadyAtMs: number | null;
    firstTileByteAtMs: number | null;
    tilesValidatedAtMs: number | null;
    visibleAtMs: number | null;
    refinementStartedAtMs: number | null;
    refinementManifestReadyAtMs: number | null;
    sharpVisibleAtMs: number | null;
    releasedAtMs: number | null;
  };
}

export interface EarlyWorldTileCoverageRequest {
  schemaVersion: 1;
  consumerGeneration: number;
  rendererVersion: string;
  level: 0;
  targetBounds: EarlyWorldTileBounds;
}

export interface EarlyWorldTileCoverageManifest {
  schemaVersion: 1;
  rendererVersion: string;
  level: 0;
  targetBounds: EarlyWorldTileBounds;
  entries: EarlyWorldTileEntry[];
  rooms: [];
}

export interface EarlyWorldTileCoverageHandoff {
  schemaVersion: 1;
  bootstrapGeneration: number;
  consumerGeneration: number;
  manifest: EarlyWorldTileCoverageManifest;
}

export interface EarlyWorldTileCoverageHandoffSlot {
  publish(manifest: EarlyWorldTileCoverageManifest): void;
  consume(request: EarlyWorldTileCoverageRequest): EarlyWorldTileCoverageHandoff | null;
  clear(): void;
}

export interface EarlyWorldTileBootstrapHandle {
  readonly schemaVersion: 1;
  readonly ready: Promise<EarlyWorldTileBootstrapState>;
  readonly sharp: Promise<EarlyWorldTileBootstrapState>;
  getState(): EarlyWorldTileBootstrapState;
  consumeCoverage(request: EarlyWorldTileCoverageRequest): EarlyWorldTileCoverageHandoff | null;
  cancelSharp(reason: EarlyWorldTileSharpCancellationReason): void;
  alignToGameContainer(): void;
  release(reason?: string): void;
}

export type EarlyWorldTileSharpCancellationReason = 'coarse-timeout' | 'refinement-timeout';

export interface EarlyWorldTileRefinementCancellation {
  readonly signal: AbortSignal;
  readonly reason: EarlyWorldTileSharpCancellationReason | null;
  cancel(reason: EarlyWorldTileSharpCancellationReason): void;
  abort(): void;
}

export function createEarlyWorldTileRefinementCancellation(): EarlyWorldTileRefinementCancellation {
  const controller = new AbortController();
  let reason: EarlyWorldTileSharpCancellationReason | null = null;
  return {
    get signal() { return controller.signal; },
    get reason() { return reason; },
    cancel(nextReason) {
      reason ??= nextReason;
      controller.abort();
    },
    abort() {
      controller.abort();
    },
  };
}

declare global {
  interface Window {
    __wampEarlyWorldTiles?: EarlyWorldTileBootstrapHandle;
  }
}

interface ParsedEarlyManifest {
  rendererVersion: string;
  entries: EarlyWorldTileEntry[];
}

interface LoadedEarlyWorldTile {
  entry: EarlyWorldTileEntry;
  image: HTMLImageElement;
  objectUrl: string;
  cacheHit: boolean;
  networkFetch: boolean;
}

interface InstallEarlyWorldTileBootstrapOptions {
  win: Window;
  doc: Document;
  apiBaseUrl: string;
  cacheName: string;
  cacheHashParam: string;
}

/**
 * Stores only the already-validated, anonymous L0 manifest. A successful take
 * is one-shot, while mismatched consumers leave the handoff available for the
 * correct renderer and viewport.
 */
export function createEarlyWorldTileCoverageHandoffSlot(): EarlyWorldTileCoverageHandoffSlot {
  let published: { generation: number; manifest: EarlyWorldTileCoverageManifest } | null = null;
  let nextGeneration = 0;
  let consumed = false;
  return {
    publish(manifest) {
      nextGeneration += 1;
      published = {
        generation: nextGeneration,
        manifest: cloneCoverageManifest(manifest),
      };
      consumed = false;
    },
    consume(request) {
      if (
        consumed
        || !published
        || request.schemaVersion !== EARLY_WORLD_TILE_SCHEMA_VERSION
        || request.level !== EARLY_WORLD_TILE_LEVEL
        || !Number.isSafeInteger(request.consumerGeneration)
        || request.consumerGeneration < 0
        || request.rendererVersion !== published.manifest.rendererVersion
        || !equalBounds(request.targetBounds, published.manifest.targetBounds)
      ) return null;
      consumed = true;
      return {
        schemaVersion: 1,
        bootstrapGeneration: published.generation,
        consumerGeneration: request.consumerGeneration,
        manifest: cloneCoverageManifest(published.manifest),
      };
    },
    clear() {
      published = null;
      consumed = true;
    },
  };
}

export function parseEarlyWorldTileBootstrapZoom(search: string): number {
  const raw = new URLSearchParams(search).get('worldTilesBootstrapZoom');
  if (raw === null || raw.trim() === '') return EARLY_WORLD_TILE_DEFAULT_ZOOM;
  const value = Number(raw);
  return Number.isFinite(value)
    && value >= EARLY_WORLD_TILE_MIN_QA_ZOOM
    && value <= EARLY_WORLD_TILE_MAX_QA_ZOOM
    ? value
    : EARLY_WORLD_TILE_DEFAULT_ZOOM;
}

export function calculateEarlyWorldTileViewport(input: {
  width: number;
  height: number;
  zoom: number;
  roomX?: number;
  roomY?: number;
}): EarlyWorldTileViewport {
  return calculateEarlyWorldTileViewportAtLevel(input, EARLY_WORLD_TILE_LEVEL);
}

export function selectEarlyWorldTileLevel(zoom: number): EarlyWorldTileLevel {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new RangeError('Early world tile zoom must be positive and finite.');
  }
  if (zoom < 0.10) return 0;
  if (zoom < 0.20) return 1;
  if (zoom < 0.40) return 2;
  if (zoom < 0.80) return 3;
  return 4;
}

export function buildEarlyWorldTileCoverageKey(
  rendererVersion: string,
  level: EarlyWorldTileLevel,
  bounds: EarlyWorldTileBounds,
): string {
  return JSON.stringify([
    rendererVersion,
    level,
    bounds.minTileX,
    bounds.maxTileX,
    bounds.minTileY,
    bounds.maxTileY,
  ]);
}

export function earlyWorldTileBoundsContain(
  outer: EarlyWorldTileBounds,
  inner: EarlyWorldTileBounds,
): boolean {
  return outer.minTileX <= inner.minTileX
    && outer.maxTileX >= inner.maxTileX
    && outer.minTileY <= inner.minTileY
    && outer.maxTileY >= inner.maxTileY;
}

export function calculateEarlyWorldTileViewportAtLevel(input: {
  width: number;
  height: number;
  zoom: number;
  roomX?: number;
  roomY?: number;
}, level: EarlyWorldTileLevel): EarlyWorldTileViewport {
  if (![input.width, input.height, input.zoom].every(Number.isFinite)) {
    throw new RangeError('Early world tile viewport values must be finite.');
  }
  if (input.width <= 0 || input.height <= 0 || input.zoom <= 0) {
    throw new RangeError('Early world tile viewport dimensions and zoom must be positive.');
  }
  const roomX = input.roomX ?? 0;
  const roomY = input.roomY ?? 0;
  if (!Number.isSafeInteger(roomX) || !Number.isSafeInteger(roomY)) {
    throw new RangeError('Early world tile room coordinates must be safe integers.');
  }
  const centerWorldX = roomX * EARLY_WORLD_TILE_CONTENT_WIDTH + EARLY_WORLD_TILE_CONTENT_WIDTH / 2;
  const centerWorldY = roomY * EARLY_WORLD_TILE_CONTENT_HEIGHT + EARLY_WORLD_TILE_CONTENT_HEIGHT / 2;
  const halfWorldWidth = input.width / input.zoom / 2;
  const halfWorldHeight = input.height / input.zoom / 2;
  const roomsPerSide = getEarlyWorldTileRoomsPerSide(level);
  const worldWidth = EARLY_WORLD_TILE_CONTENT_WIDTH * roomsPerSide;
  const worldHeight = EARLY_WORLD_TILE_CONTENT_HEIGHT * roomsPerSide;
  const bounds = {
    minTileX: Math.floor((centerWorldX - halfWorldWidth) / worldWidth),
    maxTileX: Math.ceil((centerWorldX + halfWorldWidth) / worldWidth) - 1,
    minTileY: Math.floor((centerWorldY - halfWorldHeight) / worldHeight),
    maxTileY: Math.ceil((centerWorldY + halfWorldHeight) / worldHeight) - 1,
  };
  if (
    bounds.maxTileX - bounds.minTileX + 1 > 16
    || bounds.maxTileY - bounds.minTileY + 1 > 16
  ) {
    throw new RangeError('Early world tile viewport exceeds the manifest limit.');
  }
  return {
    width: input.width,
    height: input.height,
    zoom: input.zoom,
    centerWorldX,
    centerWorldY,
    bounds,
  };
}

export function calculateEarlyWorldTileImagePresentation(
  tileX: number,
  tileY: number,
  viewport: EarlyWorldTileViewport,
): EarlyWorldTileImagePresentation {
  return calculateEarlyWorldTileImagePresentationAtLevel(
    tileX,
    tileY,
    viewport,
    EARLY_WORLD_TILE_LEVEL,
  );
}

export function calculateEarlyWorldTileImagePresentationAtLevel(
  tileX: number,
  tileY: number,
  viewport: EarlyWorldTileViewport,
  level: EarlyWorldTileLevel,
): EarlyWorldTileImagePresentation {
  if (!Number.isSafeInteger(tileX) || !Number.isSafeInteger(tileY)) {
    throw new RangeError('Early world tile coordinates must be safe integers.');
  }
  const roomsPerSide = getEarlyWorldTileRoomsPerSide(level);
  const worldWidth = EARLY_WORLD_TILE_CONTENT_WIDTH * roomsPerSide;
  const worldHeight = EARLY_WORLD_TILE_CONTENT_HEIGHT * roomsPerSide;
  const pixelScale = viewport.zoom * roomsPerSide;
  return {
    left: (tileX * worldWidth - viewport.centerWorldX) * viewport.zoom
      + viewport.width / 2 - EARLY_WORLD_TILE_OVERLAP * pixelScale,
    top: (tileY * worldHeight - viewport.centerWorldY) * viewport.zoom
      + viewport.height / 2 - EARLY_WORLD_TILE_OVERLAP * pixelScale,
    width: EARLY_WORLD_TILE_IMAGE_WIDTH * pixelScale,
    height: EARLY_WORLD_TILE_IMAGE_HEIGHT * pixelScale,
  };
}

export function getEarlyWorldTileLayerStyle(
  rect: EarlyWorldTileContainerRect,
): Record<string, string> {
  return {
    position: 'fixed',
    inset: 'auto',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    zIndex: '139',
    overflow: 'hidden',
    pointerEvents: 'none',
    contain: 'strict',
    background: 'transparent',
  };
}

export function getEarlyWorldTilePublicRequestInit(signal?: AbortSignal): RequestInit {
  return { credentials: 'omit', signal };
}

export function buildEarlyWorldTileManifestUrl(
  apiBaseUrl: string,
  pageUrl: string,
  bounds: EarlyWorldTileBounds,
  level: EarlyWorldTileLevel = EARLY_WORLD_TILE_LEVEL,
): string {
  const manifestUrl = new URL(`${apiBaseUrl}/api/world/tiles/manifest`, pageUrl);
  manifestUrl.search = new URLSearchParams({
    level: String(level),
    minTileX: String(bounds.minTileX),
    maxTileX: String(bounds.maxTileX),
    minTileY: String(bounds.minTileY),
    maxTileY: String(bounds.maxTileY),
    includeRooms: '0',
  }).toString();
  return manifestUrl.toString();
}

export function persistEarlyWorldTileBlob(
  cache: Pick<Cache, 'put'>,
  request: Request,
  blob: Blob,
): void {
  void cache.put(request, new Response(blob, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })).catch(() => undefined);
}

export function setEarlyWorldTileVisibilityDataset(
  body: Pick<HTMLElement, 'dataset'> | null,
  visible: boolean,
): void {
  if (!body) return;
  if (visible) body.dataset.earlyWorldTilesVisible = 'true';
  else delete body.dataset.earlyWorldTilesVisible;
}

export function getEarlyWorldTileImageStyle(
  presentation: EarlyWorldTileImagePresentation,
): Record<string, string> {
  return {
    position: 'absolute',
    left: `${presentation.left}px`,
    top: `${presentation.top}px`,
    width: `${presentation.width}px`,
    height: `${presentation.height}px`,
    maxWidth: 'none',
    pointerEvents: 'none',
    userSelect: 'none',
    imageRendering: 'pixelated',
    zIndex: '1',
  };
}

export function decideEarlyWorldTileRollout(input: {
  config: EarlyWorldTileConfig;
  cohortId: string;
  search: string;
}): EarlyWorldTileRolloutDecision {
  const params = new URLSearchParams(input.search);
  const override = params.get('worldTiles')?.trim().toLowerCase() ?? null;
  const forced = override === 'force';
  const shadow = override === 'shadow';
  const bucket = getEarlyWorldTileCohortBucket(input.cohortId);
  const base = { forced, cohortId: input.cohortId, bucket };
  if (input.config.schemaVersion !== EARLY_WORLD_TILE_SCHEMA_VERSION) {
    return { ...base, enabled: false, shadow: false, reason: 'schema-incompatible' };
  }
  if (override === 'off') {
    return { ...base, enabled: false, forced: false, shadow: false, reason: 'query-disabled' };
  }
  if (!input.config.available || !input.config.activeRendererVersion) {
    return { ...base, enabled: false, shadow: false, reason: 'unavailable' };
  }
  if (forced) return { ...base, enabled: true, shadow: false, reason: null };
  if (shadow) return { ...base, enabled: true, forced: false, shadow: true, reason: null };
  if (bucket >= input.config.rolloutPercentage) {
    return { ...base, enabled: false, forced: false, shadow: false, reason: 'outside-cohort' };
  }
  return { ...base, enabled: true, forced: false, shadow: false, reason: null };
}

export function getEarlyWorldTileCohortBucket(cohortId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < cohortId.length; index += 1) {
    hash ^= cohortId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000 * 100;
}

export function parseEarlyWorldTileManifest(
  value: unknown,
  requestedBounds: EarlyWorldTileBounds,
  expectedRendererVersion: string,
): ParsedEarlyManifest {
  return parseEarlyWorldTileManifestAtLevel(
    value,
    requestedBounds,
    expectedRendererVersion,
    EARLY_WORLD_TILE_LEVEL,
  );
}

export function parseEarlyWorldTileManifestAtLevel(
  value: unknown,
  requestedBounds: EarlyWorldTileBounds,
  expectedRendererVersion: string,
  expectedLevel: EarlyWorldTileLevel,
): ParsedEarlyManifest {
  const record = requireRecord(value, 'manifest');
  if (record.schemaVersion !== EARLY_WORLD_TILE_SCHEMA_VERSION || record.level !== expectedLevel) {
    throw new Error('Unsupported early world tile manifest.');
  }
  const rendererVersion = requireString(record.rendererVersion, 'rendererVersion');
  if (rendererVersion !== expectedRendererVersion) {
    throw new Error('Early world tile renderer version changed during bootstrap.');
  }
  const targetBounds = parseBounds(record.targetBounds);
  if (!equalBounds(targetBounds, requestedBounds)) {
    throw new Error('Early world tile manifest bounds do not match the requested viewport.');
  }

  const entriesByKey = new Map<string, EarlyWorldTileEntry>();
  for (const rawEntry of requireArray(record.entries, 'entries')) {
    const rawAddress = requireRecord(requireRecord(rawEntry, 'entry').address, 'address');
    if (rawAddress.level !== expectedLevel) continue;
    const entry = parseEntry(rawEntry, rendererVersion, expectedLevel);
    const key = `${entry.address.x},${entry.address.y}`;
    if (entriesByKey.has(key)) throw new Error('Duplicate early world tile manifest entry.');
    entriesByKey.set(key, entry);
  }

  const entries: EarlyWorldTileEntry[] = [];
  for (let y = requestedBounds.minTileY; y <= requestedBounds.maxTileY; y += 1) {
    for (let x = requestedBounds.minTileX; x <= requestedBounds.maxTileX; x += 1) {
      const entry = entriesByKey.get(`${x},${y}`);
      if (!entry) throw new Error(`Missing early world tile ${x},${y}.`);
      const readyEmpty = entry.desiredEmpty
        && entry.readyEmptyGeneration !== null
        && entry.readyEmptyGeneration >= entry.desiredGeneration;
      if (!entry.ready && !readyEmpty) {
        throw new Error(`Early world tile ${x},${y} is not ready.`);
      }
      entries.push(entry);
    }
  }
  return { rendererVersion, entries };
}

export function buildEarlyWorldTileCacheUrl(
  url: string,
  contentHash: string,
  hashParam = '__wamp_tile_hash',
): string {
  const parsed = new URL(url);
  parsed.searchParams.set(hashParam, contentHash);
  return parsed.toString();
}

export function installEarlyWorldTileBootstrap(
  options: InstallEarlyWorldTileBootstrapOptions,
): EarlyWorldTileBootstrapHandle {
  const existing = options.win.__wampEarlyWorldTiles;
  if (existing) return existing;

  const now = () => options.win.performance?.now() ?? Date.now();
  const state: EarlyWorldTileBootstrapState = {
    schemaVersion: 1,
    status: 'installed',
    decision: null,
    apiBaseUrl: resolveEarlyWorldTileApiBaseUrl(options.apiBaseUrl, options.win, options.doc),
    rendererVersion: null,
    displayLevel: 0,
    targetLevel: 0,
    viewport: null,
    targetViewport: null,
    targetBounds: null,
    coverageKey: null,
    displayRect: null,
    imageTileCount: 0,
    emptyTileCount: 0,
    staleMaskCount: 0,
    cacheHitCount: 0,
    networkFetchCount: 0,
    error: null,
    refinementError: null,
    releaseReason: null,
    timings: {
      installedAtMs: now(),
      configStartedAtMs: null,
      configReadyAtMs: null,
      manifestStartedAtMs: null,
      manifestReadyAtMs: null,
      firstTileByteAtMs: null,
      tilesValidatedAtMs: null,
      visibleAtMs: null,
      refinementStartedAtMs: null,
      refinementManifestReadyAtMs: null,
      sharpVisibleAtMs: null,
      releasedAtMs: null,
    },
  };
  const abortController = new AbortController();
  const refinementCancellation = createEarlyWorldTileRefinementCancellation();
  const objectUrls = new Set<string>();
  const coverageHandoff = createEarlyWorldTileCoverageHandoffSlot();
  let layer: HTMLElement | null = null;
  let released = false;

  const alignToGameContainer = (): void => {
    if (!layer || released || !state.viewport) return;
    const rect = getEarlyWorldTileContainerRect(options.doc, options.win);
    alignEarlyWorldTileLayer(layer, state.viewport.zoom, rect);
    state.displayRect = rect;
  };

  const release = (reason = 'explicit'): void => {
    if (released) return;
    released = true;
    abortController.abort();
    refinementCancellation.abort();
    coverageHandoff.clear();
    layer?.remove();
    layer = null;
    setEarlyWorldTileVisibilityDataset(options.doc.body, false);
    for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl);
    objectUrls.clear();
    state.status = 'released';
    state.releaseReason = reason;
    state.timings.releasedAtMs = now();
  };

  const runOptions: RunEarlyWorldTileBootstrapOptions = {
    ...options,
    state,
    signal: abortController.signal,
    now,
    isReleased: () => released,
    registerObjectUrl: (url) => {
      if (released) URL.revokeObjectURL(url);
      else objectUrls.add(url);
    },
    attachLayer: (nextLayer) => {
      if (released) {
        nextLayer.remove();
        return;
      }
      layer?.remove();
      layer = nextLayer;
    },
    publishCoverage: (manifest) => coverageHandoff.publish(manifest),
  };
  const ready = runEarlyWorldTileBootstrap(runOptions).catch((error: unknown) => {
    if (!released) {
      coverageHandoff.clear();
      state.status = 'failed';
      state.error = error instanceof Error ? error.message : String(error);
      layer?.remove();
      layer = null;
      setEarlyWorldTileVisibilityDataset(options.doc.body, false);
      for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl);
      objectUrls.clear();
    }
    return copyState(state);
  });
  const sharp = ready.then(async () => {
    if (
      released
      || state.status === 'failed'
      || state.status === 'disabled'
      || state.status === 'ready-shadow'
      || state.status === 'released'
      || refinementCancellation.signal.aborted
    ) return copyState(state);
    try {
      await refineEarlyWorldTileBootstrap({
        ...runOptions,
        signal: refinementCancellation.signal,
      });
    } catch (error) {
      if (
        !released
        && !abortController.signal.aborted
        && !refinementCancellation.signal.aborted
      ) {
        state.refinementError = error instanceof Error ? error.message : String(error);
      }
    }
    return copyState(state);
  });
  const handle: EarlyWorldTileBootstrapHandle = {
    schemaVersion: 1,
    ready,
    sharp,
    getState: () => copyState(state),
    consumeCoverage: (request) => coverageHandoff.consume(request),
    cancelSharp: (reason) => refinementCancellation.cancel(reason),
    alignToGameContainer,
    release,
  };
  options.win.__wampEarlyWorldTiles = handle;
  return handle;
}

interface RunEarlyWorldTileBootstrapOptions extends InstallEarlyWorldTileBootstrapOptions {
  state: EarlyWorldTileBootstrapState;
  signal: AbortSignal;
  now: () => number;
  isReleased: () => boolean;
  registerObjectUrl: (url: string) => void;
  attachLayer: (layer: HTMLElement) => void;
  publishCoverage: (manifest: EarlyWorldTileCoverageManifest) => void;
}

async function runEarlyWorldTileBootstrap(
  options: RunEarlyWorldTileBootstrapOptions,
): Promise<EarlyWorldTileBootstrapState> {
  const { state, signal } = options;
  state.status = 'loading-config';
  state.timings.configStartedAtMs = options.now();
  const configResponse = await options.win.fetch(
    `${state.apiBaseUrl}/api/world/tiles/config`,
    getEarlyWorldTilePublicRequestInit(signal),
  );
  if (!configResponse.ok) {
    state.status = 'disabled';
    state.error = `config-${configResponse.status}`;
    return copyState(state);
  }
  const config = parseConfig(await configResponse.json());
  state.timings.configReadyAtMs = options.now();
  const cohortId = getOrCreateEarlyWorldTileCohortId(options.win);
  const decision = decideEarlyWorldTileRollout({
    config,
    cohortId,
    search: options.win.location.search,
  });
  state.decision = decision;
  state.rendererVersion = config.activeRendererVersion;
  if (!decision.enabled || !config.activeRendererVersion) {
    state.status = 'disabled';
    return copyState(state);
  }

  const viewport = calculateEarlyWorldTileViewport({
    width: Math.max(1, options.win.innerWidth || options.doc.documentElement.clientWidth),
    height: Math.max(1, options.win.innerHeight || options.doc.documentElement.clientHeight),
    zoom: parseEarlyWorldTileBootstrapZoom(options.win.location.search),
  });
  state.viewport = viewport;
  state.targetLevel = selectEarlyWorldTileLevel(viewport.zoom);
  state.targetViewport = calculateEarlyWorldTileViewportAtLevel({
    width: viewport.width,
    height: viewport.height,
    zoom: viewport.zoom,
  }, state.targetLevel);
  state.targetBounds = { ...state.targetViewport.bounds };
  state.coverageKey = buildEarlyWorldTileCoverageKey(
    config.activeRendererVersion,
    state.targetLevel,
    state.targetBounds,
  );
  const manifestUrl = buildEarlyWorldTileManifestUrl(
    state.apiBaseUrl,
    options.win.location.href,
    viewport.bounds,
  );
  state.status = 'loading-manifest';
  state.timings.manifestStartedAtMs = options.now();
  const manifestResponse = await options.win.fetch(
    manifestUrl,
    getEarlyWorldTilePublicRequestInit(signal),
  );
  if (!manifestResponse.ok) throw new Error(`Early world tile manifest failed with ${manifestResponse.status}.`);
  const manifest = parseEarlyWorldTileManifest(
    await manifestResponse.json(),
    viewport.bounds,
    config.activeRendererVersion,
  );
  state.timings.manifestReadyAtMs = options.now();
  state.imageTileCount = manifest.entries.filter((entry) => entry.ready !== null).length;
  state.emptyTileCount = manifest.entries.length - state.imageTileCount;
  state.status = 'loading-tiles';

  const cache = await openEarlyWorldTileCache(options.win, options.cacheName);
  const imageEntries = manifest.entries.filter(
    (entry): entry is EarlyWorldTileEntry & { ready: EarlyWorldTileReady } => entry.ready !== null,
  );
  const loadedTiles = await mapWithConcurrency(
    imageEntries,
    EARLY_WORLD_TILE_MAX_FETCH_CONCURRENCY,
    (entry) => loadEarlyWorldTile({
      entry,
      win: options.win,
      doc: options.doc,
      cache,
      cacheHashParam: options.cacheHashParam,
      signal,
      registerObjectUrl: options.registerObjectUrl,
      markFirstByte: () => {
        state.timings.firstTileByteAtMs ??= options.now();
      },
    }),
    signal,
  );
  if (options.isReleased()) return copyState(state);
  for (const tile of loadedTiles) {
    if (tile.cacheHit) state.cacheHitCount += 1;
    if (tile.networkFetch) state.networkFetchCount += 1;
  }
  state.timings.tilesValidatedAtMs = options.now();
  const displayRect = getEarlyWorldTileContainerRect(options.doc, options.win);
  state.displayRect = displayRect;
  const displayViewport = calculateEarlyWorldTileViewport({
    width: displayRect.width,
    height: displayRect.height,
    zoom: viewport.zoom,
  });
  if (!earlyWorldTileBoundsContain(viewport.bounds, displayViewport.bounds)) {
    throw new Error('Early world tile request does not contain the live display viewport.');
  }
  if (state.targetLevel === 0) {
    state.targetViewport = displayViewport;
    state.targetBounds = { ...displayViewport.bounds };
    state.coverageKey = buildEarlyWorldTileCoverageKey(
      config.activeRendererVersion,
      0,
      displayViewport.bounds,
    );
  }
  const layer = await buildEarlyWorldTileLayer(
    options.doc,
    displayViewport,
    displayRect,
    manifest.entries,
    loadedTiles,
    0,
  );
  if (options.isReleased()) {
    layer.remove();
    return copyState(state);
  }
  state.staleMaskCount = layer.querySelectorAll('[data-wamp-early-world-tile-mask]').length;
  if (decision.shadow) {
    layer.remove();
    state.status = 'ready-shadow';
  } else {
    options.doc.body.prepend(layer);
    setEarlyWorldTileVisibilityDataset(options.doc.body, true);
    options.attachLayer(layer);
    state.status = 'visible';
    state.timings.visibleAtMs = options.now();
  }
  options.publishCoverage({
    schemaVersion: 1,
    rendererVersion: manifest.rendererVersion,
    level: 0,
    targetBounds: { ...viewport.bounds },
    entries: manifest.entries,
    rooms: [],
  });
  options.win.dispatchEvent(new CustomEvent(EARLY_WORLD_TILE_READY_EVENT, {
    detail: copyState(state),
  }));
  return copyState(state);
}

async function refineEarlyWorldTileBootstrap(
  options: RunEarlyWorldTileBootstrapOptions,
): Promise<void> {
  const { state, signal } = options;
  if (
    options.isReleased()
    || signal.aborted
    || state.status !== 'visible'
    || !state.rendererVersion
    || !state.viewport
  ) return;

  const level = state.targetLevel;
  if (level === 0) {
    const displayRect = getEarlyWorldTileContainerRect(options.doc, options.win);
    const displayViewport = calculateEarlyWorldTileViewport({
      width: displayRect.width,
      height: displayRect.height,
      zoom: state.viewport.zoom,
    });
    if (!earlyWorldTileBoundsContain(state.viewport.bounds, displayViewport.bounds)) {
      throw new Error('Early world tile request no longer contains the live display viewport.');
    }
    state.displayRect = displayRect;
    state.targetViewport = displayViewport;
    state.targetBounds = { ...displayViewport.bounds };
    state.coverageKey = buildEarlyWorldTileCoverageKey(
      state.rendererVersion,
      0,
      displayViewport.bounds,
    );
    await waitForEarlyWorldTilePaint(options.win);
    if (options.isReleased() || signal.aborted) return;
    state.timings.sharpVisibleAtMs = options.now();
    options.win.dispatchEvent(new CustomEvent(EARLY_WORLD_TILE_SHARP_READY_EVENT, {
      detail: copyState(state),
    }));
    return;
  }

  state.timings.refinementStartedAtMs = options.now();
  const viewport = calculateEarlyWorldTileViewportAtLevel({
    width: state.viewport.width,
    height: state.viewport.height,
    zoom: state.viewport.zoom,
  }, level);
  const manifestResponse = await options.win.fetch(
    buildEarlyWorldTileManifestUrl(
      state.apiBaseUrl,
      options.win.location.href,
      viewport.bounds,
      level,
    ),
    getEarlyWorldTilePublicRequestInit(signal),
  );
  if (!manifestResponse.ok) {
    throw new Error(`Early world tile refinement manifest failed with ${manifestResponse.status}.`);
  }
  const manifest = parseEarlyWorldTileManifestAtLevel(
    await manifestResponse.json(),
    viewport.bounds,
    state.rendererVersion,
    level,
  );
  state.timings.refinementManifestReadyAtMs = options.now();
  const cache = await openEarlyWorldTileCache(options.win, options.cacheName);
  const imageEntries = manifest.entries.filter(
    (entry): entry is EarlyWorldTileEntry & { ready: EarlyWorldTileReady } => entry.ready !== null,
  );
  const loadedTiles = await mapWithConcurrency(
    imageEntries,
    EARLY_WORLD_TILE_MAX_FETCH_CONCURRENCY,
    (entry) => loadEarlyWorldTile({
      entry,
      win: options.win,
      doc: options.doc,
      cache,
      cacheHashParam: options.cacheHashParam,
      signal,
      registerObjectUrl: options.registerObjectUrl,
      markFirstByte: () => undefined,
    }),
    signal,
  );
  if (options.isReleased() || signal.aborted) return;
  for (const tile of loadedTiles) {
    if (tile.cacheHit) state.cacheHitCount += 1;
    if (tile.networkFetch) state.networkFetchCount += 1;
  }

  const displayRect = getEarlyWorldTileContainerRect(options.doc, options.win);
  const displayViewport = calculateEarlyWorldTileViewportAtLevel({
    width: displayRect.width,
    height: displayRect.height,
    zoom: viewport.zoom,
  }, level);
  if (!earlyWorldTileBoundsContain(viewport.bounds, displayViewport.bounds)) {
    throw new Error('Early world tile refinement does not contain the live display viewport.');
  }
  const layer = await buildEarlyWorldTileLayer(
    options.doc,
    displayViewport,
    displayRect,
    manifest.entries,
    loadedTiles,
    level,
  );
  if (options.isReleased() || signal.aborted) {
    layer.remove();
    return;
  }

  options.doc.body.prepend(layer);
  options.attachLayer(layer);
  state.displayRect = displayRect;
  state.displayLevel = level;
  state.targetViewport = displayViewport;
  state.targetBounds = { ...displayViewport.bounds };
  state.coverageKey = buildEarlyWorldTileCoverageKey(
    state.rendererVersion,
    level,
    displayViewport.bounds,
  );
  state.imageTileCount = imageEntries.length;
  state.emptyTileCount = manifest.entries.length - imageEntries.length;
  state.staleMaskCount = layer.querySelectorAll('[data-wamp-early-world-tile-mask]').length;
  await waitForEarlyWorldTilePaint(options.win);
  if (options.isReleased() || signal.aborted) return;
  state.timings.sharpVisibleAtMs = options.now();
  options.win.dispatchEvent(new CustomEvent(EARLY_WORLD_TILE_SHARP_READY_EVENT, {
    detail: copyState(state),
  }));
}

async function loadEarlyWorldTile(input: {
  entry: EarlyWorldTileEntry & { ready: EarlyWorldTileReady };
  win: Window;
  doc: Document;
  cache: Cache | null;
  cacheHashParam: string;
  signal: AbortSignal;
  registerObjectUrl: (url: string) => void;
  markFirstByte: () => void;
}): Promise<LoadedEarlyWorldTile> {
  input.signal.throwIfAborted();
  const ready = input.entry.ready;
  const cacheUrl = buildEarlyWorldTileCacheUrl(ready.url, ready.contentHash, input.cacheHashParam);
  const cacheRequest = new Request(cacheUrl, { method: 'GET' });
  if (input.cache) {
    const cachedResponse = await input.cache.match(cacheRequest);
    if (cachedResponse) {
      try {
        const blob = await cachedResponse.blob();
        input.markFirstByte();
        const validated = await validateEarlyWorldTileBlob(
          blob,
          ready,
          input.win,
          input.doc,
          input.signal,
        );
        input.registerObjectUrl(validated.objectUrl);
        return { entry: input.entry, ...validated, cacheHit: true, networkFetch: false };
      } catch (error) {
        if (input.signal.aborted) throw error;
        await input.cache.delete(cacheRequest).catch(() => false);
      }
    }
  }

  const response = await input.win.fetch(ready.url, {
    cache: 'force-cache',
    credentials: 'omit',
    mode: 'cors',
    signal: input.signal,
  });
  if (!response.ok) throw new Error(`Early world tile image failed with ${response.status}.`);
  const blob = await response.blob();
  input.signal.throwIfAborted();
  input.markFirstByte();
  const validated = await validateEarlyWorldTileBlob(
    blob,
    ready,
    input.win,
    input.doc,
    input.signal,
  );
  input.registerObjectUrl(validated.objectUrl);
  if (input.cache) {
    persistEarlyWorldTileBlob(input.cache, cacheRequest, blob);
  }
  return { entry: input.entry, ...validated, cacheHit: false, networkFetch: true };
}

async function validateEarlyWorldTileBlob(
  blob: Blob,
  ready: EarlyWorldTileReady,
  win: Window,
  doc: Document,
  signal: AbortSignal,
): Promise<{ image: HTMLImageElement; objectUrl: string }> {
  signal.throwIfAborted();
  if (blob.size !== ready.byteLength || blob.size <= 0) {
    throw new Error(`Early world tile byte length mismatch for ${ready.contentHash}.`);
  }
  if (!win.crypto?.subtle) throw new Error('SubtleCrypto is required for early world tiles.');
  const objectUrl = URL.createObjectURL(blob);
  const image = doc.createElement('img');
  image.decoding = 'async';
  image.alt = '';
  image.draggable = false;
  image.src = objectUrl;
  let rejectAbort!: (error: DOMException) => void;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const handleAbort = () => {
    image.removeAttribute('src');
    rejectAbort(new DOMException('Early world tile refinement aborted.', 'AbortError'));
  };
  signal.addEventListener('abort', handleAbort, { once: true });
  try {
    const digestPromise = blob.arrayBuffer()
      .then((bytes) => win.crypto.subtle.digest('SHA-256', bytes));
    const [digest] = await Promise.race([
      Promise.all([digestPromise, image.decode()]),
      abortPromise,
    ]);
    signal.throwIfAborted();
    const actualHash = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    if (actualHash !== ready.contentHash) {
      throw new Error(`Early world tile hash mismatch for ${ready.contentHash}.`);
    }
    if (
      image.naturalWidth !== EARLY_WORLD_TILE_IMAGE_WIDTH
      || image.naturalHeight !== EARLY_WORLD_TILE_IMAGE_HEIGHT
    ) {
      throw new Error(`Early world tile dimensions must be ${EARLY_WORLD_TILE_IMAGE_WIDTH}x${EARLY_WORLD_TILE_IMAGE_HEIGHT}.`);
    }
    return { image, objectUrl };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  } finally {
    signal.removeEventListener('abort', handleAbort);
  }
}

async function buildEarlyWorldTileLayer(
  doc: Document,
  viewport: EarlyWorldTileViewport,
  displayRect: EarlyWorldTileContainerRect,
  entries: EarlyWorldTileEntry[],
  loadedTiles: LoadedEarlyWorldTile[],
  level: EarlyWorldTileLevel,
): Promise<HTMLElement> {
  if (!doc.body) await waitForBody(doc);
  const layer = doc.createElement('div');
  layer.id = 'wamp-early-world-tiles';
  layer.dataset.wampEarlyWorldTiles = 'true';
  layer.dataset.wampEarlyWorldTileLevel = String(level);
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, getEarlyWorldTileLayerStyle(displayRect));

  const fragment = doc.createDocumentFragment();
  for (const tile of loadedTiles) {
    const presentation = calculateEarlyWorldTileImagePresentationAtLevel(
      tile.entry.address.x,
      tile.entry.address.y,
      viewport,
      level,
    );
    const image = tile.image;
    image.dataset.wampEarlyWorldTile = `${tile.entry.address.x},${tile.entry.address.y}`;
    Object.assign(image.style, getEarlyWorldTileImageStyle(presentation));
    fragment.append(image);
  }

  for (const entry of entries) {
    for (const roomId of entry.staleRoomIds) {
      const coordinates = parseRoomId(roomId);
      if (!coordinates) continue;
      const mask = doc.createElement('div');
      mask.dataset.wampEarlyWorldTileMask = roomId;
      const left = (coordinates.x * EARLY_WORLD_TILE_CONTENT_WIDTH - viewport.centerWorldX)
        * viewport.zoom + viewport.width / 2;
      const top = (coordinates.y * EARLY_WORLD_TILE_CONTENT_HEIGHT - viewport.centerWorldY)
        * viewport.zoom + viewport.height / 2;
      Object.assign(mask.style, {
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
        width: `${EARLY_WORLD_TILE_CONTENT_WIDTH * viewport.zoom}px`,
        height: `${EARLY_WORLD_TILE_CONTENT_HEIGHT * viewport.zoom}px`,
        background: '#080d18',
        pointerEvents: 'none',
        zIndex: '2',
      });
      fragment.append(mask);
    }
  }
  layer.append(fragment);
  return layer;
}

export function getEarlyWorldTileContainerRect(
  doc: {
    getElementById(id: string): Pick<HTMLElement, 'getBoundingClientRect'> | null;
    documentElement: Pick<HTMLElement, 'clientWidth' | 'clientHeight'>;
    body?: { dataset: { appMode?: string; appReady?: string } } | null;
  },
  win: Pick<Window, 'innerWidth' | 'innerHeight'>,
): EarlyWorldTileContainerRect {
  const gameContainer = doc.getElementById('game-container');
  const rect = gameContainer?.getBoundingClientRect();
  const appMode = doc.body?.dataset.appMode;
  const liveWorldLayout = appMode === 'world'
    || appMode === 'play-world'
    || doc.body?.dataset.appReady === 'true';
  if (liveWorldLayout && rect && rect.width > 0 && rect.height > 0) {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  const viewportWidth = Math.max(1, win.innerWidth || doc.documentElement.clientWidth);
  const viewportHeight = Math.max(1, win.innerHeight || doc.documentElement.clientHeight);
  const bottomBarHeight = doc.getElementById('bottom-bar')?.getBoundingClientRect().height;
  return {
    left: 0,
    top: 0,
    width: viewportWidth,
    height: Math.max(1, viewportHeight - (
      bottomBarHeight && bottomBarHeight > 0 ? bottomBarHeight : 36
    )),
  };
}

function alignEarlyWorldTileLayer(
  layer: HTMLElement,
  zoom: number,
  rect: EarlyWorldTileContainerRect,
): void {
  const parsedLevel = Number(layer.dataset.wampEarlyWorldTileLevel ?? 0);
  const level = Number.isSafeInteger(parsedLevel) && parsedLevel >= 0 && parsedLevel <= 4
    ? parsedLevel as EarlyWorldTileLevel
    : 0;
  const viewport = calculateEarlyWorldTileViewportAtLevel(
    { width: rect.width, height: rect.height, zoom },
    level,
  );
  Object.assign(layer.style, getEarlyWorldTileLayerStyle(rect));
  for (const image of layer.querySelectorAll<HTMLImageElement>('[data-wamp-early-world-tile]')) {
    const coordinates = parseRoomId(image.dataset.wampEarlyWorldTile ?? '');
    if (!coordinates) continue;
    Object.assign(
      image.style,
      getEarlyWorldTileImageStyle(calculateEarlyWorldTileImagePresentationAtLevel(
        coordinates.x,
        coordinates.y,
        viewport,
        level,
      )),
    );
  }
  for (const mask of layer.querySelectorAll<HTMLElement>('[data-wamp-early-world-tile-mask]')) {
    const coordinates = parseRoomId(mask.dataset.wampEarlyWorldTileMask ?? '');
    if (!coordinates) continue;
    const left = (coordinates.x * EARLY_WORLD_TILE_CONTENT_WIDTH - viewport.centerWorldX)
      * viewport.zoom + viewport.width / 2;
    const top = (coordinates.y * EARLY_WORLD_TILE_CONTENT_HEIGHT - viewport.centerWorldY)
      * viewport.zoom + viewport.height / 2;
    Object.assign(mask.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${EARLY_WORLD_TILE_CONTENT_WIDTH * viewport.zoom}px`,
      height: `${EARLY_WORLD_TILE_CONTENT_HEIGHT * viewport.zoom}px`,
    });
  }
}

function parseConfig(value: unknown): EarlyWorldTileConfig {
  const record = requireRecord(value, 'config');
  if (record.schemaVersion !== EARLY_WORLD_TILE_SCHEMA_VERSION) {
    throw new Error('Unsupported early world tile config.');
  }
  const rolloutPercentage = requireNumber(record.rolloutPercentage, 'rolloutPercentage');
  if (rolloutPercentage < 0 || rolloutPercentage > 100) {
    throw new Error('Invalid early world tile rollout percentage.');
  }
  return {
    schemaVersion: 1,
    available: requireBoolean(record.available, 'available'),
    rolloutPercentage,
    activeRendererVersion: record.activeRendererVersion === null
      ? null
      : requireString(record.activeRendererVersion, 'activeRendererVersion'),
  };
}

function parseEntry(
  value: unknown,
  rendererVersion: string,
  expectedLevel: EarlyWorldTileLevel = EARLY_WORLD_TILE_LEVEL,
): EarlyWorldTileEntry {
  const record = requireRecord(value, 'entry');
  const address = requireRecord(record.address, 'address');
  if (
    requireString(address.rendererVersion, 'address.rendererVersion') !== rendererVersion
    || address.level !== expectedLevel
  ) {
    throw new Error('Invalid early world tile address.');
  }
  const readyRecord = record.ready === null ? null : requireRecord(record.ready, 'ready');
  const ready = readyRecord === null ? null : {
    generation: requireSafeInteger(readyRecord.generation, 'ready.generation'),
    contentHash: requireHash(readyRecord.contentHash),
    url: requireHttpUrl(readyRecord.url),
    width: requireLiteral(readyRecord.width, EARLY_WORLD_TILE_IMAGE_WIDTH, 'ready.width') as 642,
    height: requireLiteral(readyRecord.height, EARLY_WORLD_TILE_IMAGE_HEIGHT, 'ready.height') as 354,
    overlap: requireLiteral(readyRecord.overlap, EARLY_WORLD_TILE_OVERLAP, 'ready.overlap') as 1,
    byteLength: requirePositiveSafeInteger(readyRecord.byteLength, 'ready.byteLength'),
  };
  return {
    address: {
      rendererVersion,
      level: expectedLevel,
      x: requireSafeInteger(address.x, 'address.x'),
      y: requireSafeInteger(address.y, 'address.y'),
    },
    desiredGeneration: requireSafeInteger(record.desiredGeneration, 'desiredGeneration'),
    desiredEmpty: requireBoolean(record.desiredEmpty, 'desiredEmpty'),
    readyEmptyGeneration: record.readyEmptyGeneration === null
      ? null
      : requireSafeInteger(record.readyEmptyGeneration, 'readyEmptyGeneration'),
    ready,
    staleRoomIds: requireArray(record.staleRoomIds, 'staleRoomIds')
      .map((roomId) => requireString(roomId, 'staleRoomId')),
  };
}

function parseBounds(value: unknown): EarlyWorldTileBounds {
  const record = requireRecord(value, 'bounds');
  const bounds = {
    minTileX: requireSafeInteger(record.minTileX, 'minTileX'),
    maxTileX: requireSafeInteger(record.maxTileX, 'maxTileX'),
    minTileY: requireSafeInteger(record.minTileY, 'minTileY'),
    maxTileY: requireSafeInteger(record.maxTileY, 'maxTileY'),
  };
  if (
    bounds.minTileX > bounds.maxTileX
    || bounds.minTileY > bounds.maxTileY
    || bounds.maxTileX - bounds.minTileX + 1 > 16
    || bounds.maxTileY - bounds.minTileY + 1 > 16
  ) throw new Error('Invalid early world tile bounds.');
  return bounds;
}

function equalBounds(left: EarlyWorldTileBounds, right: EarlyWorldTileBounds): boolean {
  return left.minTileX === right.minTileX
    && left.maxTileX === right.maxTileX
    && left.minTileY === right.minTileY
    && left.maxTileY === right.maxTileY;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid early world tile ${label}.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid early world tile ${label}.`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid early world tile ${label}.`);
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid early world tile ${label}.`);
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid early world tile ${label}.`);
  }
  return value;
}

function requireSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`Invalid early world tile ${label}.`);
  return value as number;
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  const result = requireSafeInteger(value, label);
  if (result <= 0) throw new Error(`Invalid early world tile ${label}.`);
  return result;
}

function requireLiteral(value: unknown, expected: number, label: string): number {
  if (value !== expected) throw new Error(`Invalid early world tile ${label}.`);
  return expected;
}

function requireHash(value: unknown): string {
  const hash = requireString(value, 'contentHash');
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid early world tile contentHash.');
  return hash;
}

function requireHttpUrl(value: unknown): string {
  const raw = requireString(value, 'url');
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Invalid early world tile URL.');
  }
  return url.toString();
}

function getOrCreateEarlyWorldTileCohortId(win: Window): string {
  const existing = win.localStorage.getItem(EARLY_WORLD_TILE_COHORT_STORAGE_KEY)?.trim();
  if (existing && existing.length >= 8 && existing.length <= 128) return existing;
  const cohortId = typeof win.crypto?.randomUUID === 'function'
    ? win.crypto.randomUUID()
    : `tile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  try {
    win.localStorage.setItem(EARLY_WORLD_TILE_COHORT_STORAGE_KEY, cohortId);
  } catch {
    // Private browsing can still keep this page-local cohort.
  }
  return cohortId;
}

function resolveEarlyWorldTileApiBaseUrl(configured: string, win: Window, doc: Document): string {
  const normalizedConfigured = configured.trim().replace(/\/+$/, '');
  if (normalizedConfigured) {
    try {
      const apiUrl = new URL(normalizedConfigured);
      if (isLoopback(apiUrl.hostname) && isLoopback(win.location.hostname)) {
        apiUrl.hostname = win.location.hostname;
        return apiUrl.toString().replace(/\/+$/, '');
      }
    } catch {
      return normalizedConfigured;
    }
    return normalizedConfigured;
  }
  const hostname = win.location.hostname.toLowerCase();
  if (isLoopback(hostname) || hostname.endsWith('.workers.dev') || hostname === 'api.wamp.land') return '';
  const metaBase = doc.querySelector('meta[name="ai-api-base"]')?.getAttribute('content')?.trim();
  if (metaBase) return metaBase.replace(/\/+$/, '');
  if (
    hostname === 'wamp.land'
    || hostname === 'wampland.pages.dev'
    || hostname.endsWith('.wampland.pages.dev')
  ) return 'https://api.wamp.land';
  return '';
}

function isLoopback(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
}

async function openEarlyWorldTileCache(win: Window, name: string): Promise<Cache | null> {
  if (!('caches' in win)) return null;
  try {
    return await win.caches.open(name);
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      signal?.throwIfAborted();
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(values[index]);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    () => worker(),
  ));
  return results;
}

function parseRoomId(roomId: string): { x: number; y: number } | null {
  const match = /^(-?\d+),(-?\d+)$/.exec(roomId);
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  return Number.isSafeInteger(x) && Number.isSafeInteger(y) ? { x, y } : null;
}

function getEarlyWorldTileRoomsPerSide(level: EarlyWorldTileLevel): number {
  if (!Number.isSafeInteger(level) || level < 0 || level > EARLY_WORLD_TILE_MAX_LEVEL) {
    throw new RangeError('Invalid early world tile level.');
  }
  return EARLY_WORLD_TILE_ROOMS_PER_SIDE >> level;
}

function waitForBody(doc: Document): Promise<void> {
  if (doc.body) return Promise.resolve();
  return new Promise((resolve) => {
    doc.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });
}

function waitForEarlyWorldTilePaint(win: Window): Promise<void> {
  if (typeof win.requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    win.requestAnimationFrame(() => resolve());
  });
}

function copyState(state: EarlyWorldTileBootstrapState): EarlyWorldTileBootstrapState {
  return JSON.parse(JSON.stringify(state)) as EarlyWorldTileBootstrapState;
}

function cloneCoverageManifest(
  manifest: EarlyWorldTileCoverageManifest,
): EarlyWorldTileCoverageManifest {
  return JSON.parse(JSON.stringify(manifest)) as EarlyWorldTileCoverageManifest;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  installEarlyWorldTileBootstrap({
    win: window,
    doc: document,
    apiBaseUrl: __WAMP_EARLY_WORLD_TILE_API_BASE__,
    cacheName: __WAMP_WORLD_TILE_BYTE_CACHE_NAME__,
    cacheHashParam: __WAMP_WORLD_TILE_BYTE_CACHE_HASH_PARAM__,
  });
}
