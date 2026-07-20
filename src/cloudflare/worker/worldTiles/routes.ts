import {
  WORLD_TILE_R2_PREFIX,
  WORLD_TILE_SCHEMA_VERSION,
  assertWorldTileBounds,
  assertWorldTileLevel,
  type WorldTileBounds,
  type WorldTileLevel,
} from '../../../worldTiles/model';
import { normalizeImmutablePagesDeploymentOrigin } from '../../../worldTiles/rendererOrigin';
import {
  requireAdminRequest,
  requireTrustedOriginForMutation,
} from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import { loadAnonymousPublicCache } from '../core/publicCache';
import { ServerTiming, timedJsonResponse } from '../core/serverTiming';
import type {
  Env,
  R2BucketBinding,
  R2ObjectMetadata,
  WorkerExecutionContextLike,
} from '../core/types';
import {
  activateWorldTileRendererVersion,
  backfillWorldTileRendererLeaves,
  createWorldTileRendererVersion,
  loadAllReferencedWorldTileObjectKeys,
  loadReferencedWorldTileObjectPointers,
  loadWorldTileAncestorParity,
  loadWorldTileLeafParityCounts,
  loadWorldTileRendererStatusCounts,
  loadWorldTileRendererVersion,
  loadWorldTileRendererVersions,
  repairWorldTileOutbox,
  type WorldTileRendererVersionRow,
} from './store';
import {
  dispatchPendingWorldTileOutbox,
  loadWorldTileConfig,
  loadWorldTileManifest,
  worldTileGenerationEnabled,
} from './service';

const DYNAMIC_CACHE_CONTROL = 'public, max-age=20, stale-while-revalidate=40';
const WORLD_TILE_MIN_GC_AGE_DAYS = 30;

export async function handleWorldTileConfigRequest(
  request: Request,
  env: Env,
  context?: WorkerExecutionContextLike,
  authenticated = false,
): Promise<Response> {
  const loadResponse = async (): Promise<Response> => {
    const timing = new ServerTiming();
    const config = await timing.measure('config_d1', () => loadWorldTileConfig(env));
    const etag = createWeakJsonEtag('world-tile-config', config);
    timing.setDiagnostic('cache_policy', authenticated ? 'private' : 'public-20-40');
    return timedJsonResponse(request, config, timing, {
      headers: {
        'Cache-Control': authenticated ? 'private, no-store' : DYNAMIC_CACHE_CONTROL,
        ETag: etag,
      },
    });
  };

  const response = await loadAnonymousPublicCache(
    request,
    authenticated ? undefined : context,
    loadResponse,
  );
  return applyConditionalEtag(request, response);
}

export async function handleWorldTileManifestRequest(
  request: Request,
  url: URL,
  env: Env,
  context?: WorkerExecutionContextLike,
  authenticated = false,
): Promise<Response> {
  const { level, bounds, includeRooms } = parseWorldTileManifestQuery(url.searchParams);
  const loadResponse = async (): Promise<Response> => {
    const timing = new ServerTiming();
    const result = await timing.measure('manifest_d1', () => (
      loadWorldTileManifest(env, level, bounds, { includeRooms })
    ));
    if (!result) {
      timing.setDiagnostic('cache_policy', 'unavailable-no-store');
      return timedJsonResponse(request, {
        error: 'Tiled overworld reads are unavailable.',
      }, timing, {
        status: 404,
        headers: {
          'Cache-Control': 'private, no-store',
        },
      });
    }
    timing.setDiagnostic('cache_policy', authenticated ? 'private' : 'public-20-40');
    return timedJsonResponse(request, result.manifest, timing, {
      headers: {
        'Cache-Control': authenticated ? 'private, no-store' : DYNAMIC_CACHE_CONTROL,
        ETag: result.etag,
      },
    });
  };

  const response = await loadAnonymousPublicCache(
    request,
    authenticated ? undefined : context,
    loadResponse,
  );
  return applyConditionalEtag(request, response);
}

export async function handleAdminWorldTileRequest(
  request: Request,
  url: URL,
  env: Env,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  requireAdminRequest(env, request, 'manage world tiles');
  requireTrustedOriginForMutation(request);

  if (url.pathname === '/api/admin/world-tiles/status' && request.method === 'GET') {
    return handleWorldTileStatus(request, url, env);
  }
  if (url.pathname === '/api/admin/world-tiles/backfill' && request.method === 'POST') {
    return handleWorldTileBackfill(request, env, context);
  }
  if (url.pathname === '/api/admin/world-tiles/repair' && request.method === 'POST') {
    return handleWorldTileRepair(request, env, context);
  }
  if (url.pathname === '/api/admin/world-tiles/activate' && request.method === 'POST') {
    return handleWorldTileActivate(request, env);
  }
  if (url.pathname === '/api/admin/world-tiles/garbage-collect' && request.method === 'POST') {
    return handleWorldTileGarbageCollect(request, env);
  }

  throw new HttpError(404, 'World tile admin route not found.');
}

export function parseWorldTileManifestQuery(searchParams: URLSearchParams): {
  level: WorldTileLevel;
  bounds: WorldTileBounds;
  includeRooms: boolean;
} {
  const levelValue = parseSafeIntegerQuery(searchParams, 'level');
  const bounds = {
    minTileX: parseSafeIntegerQuery(searchParams, 'minTileX'),
    maxTileX: parseSafeIntegerQuery(searchParams, 'maxTileX'),
    minTileY: parseSafeIntegerQuery(searchParams, 'minTileY'),
    maxTileY: parseSafeIntegerQuery(searchParams, 'maxTileY'),
  };
  try {
    assertWorldTileLevel(levelValue);
    assertWorldTileBounds(bounds);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Invalid world tile query.');
  }
  return {
    level: levelValue,
    bounds,
    includeRooms: parseOptionalBinaryQuery(searchParams, 'includeRooms', true),
  };
}

interface WorldTileBackfillBody {
  version?: unknown;
  renderOrigin?: unknown;
  rendererContractHash?: unknown;
  assetContractHash?: unknown;
  immutableRenderOrigin?: unknown;
}

async function handleWorldTileBackfill(
  request: Request,
  env: Env,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  const body = await parseJsonBody<WorldTileBackfillBody>(request);
  const version = normalizeIdentifier(body.version, 'version');
  const renderOrigin = normalizeImmutableRenderOrigin(body.renderOrigin, body.immutableRenderOrigin);
  const rendererContractHash = normalizeContractHash(body.rendererContractHash, 'rendererContractHash');
  const assetContractHash = normalizeContractHash(body.assetContractHash, 'assetContractHash');
  const existing = await loadWorldTileRendererVersion(env, version);
  if (!existing) {
    await createWorldTileRendererVersion(env, {
      version,
      renderOrigin,
      rendererContractHash,
      assetContractHash,
    });
  } else if (
    existing.render_origin !== renderOrigin
    || existing.renderer_contract_hash !== rendererContractHash
    || existing.asset_contract_hash !== assetContractHash
  ) {
    throw new HttpError(409, 'Renderer version identity is immutable and does not match the existing row.');
  } else if (existing.status === 'failed') {
    throw new HttpError(409, 'Failed renderer versions cannot be backfilled without creating a new version.');
  }

  await backfillWorldTileRendererLeaves(env, version);
  const dispatch = scheduleWorldTileOutboxDispatch(env, context);
  const counts = await loadWorldTileRendererStatusCounts(env, version);
  return jsonResponse(request, {
    ok: true,
    version,
    counts,
    dispatch,
  });
}

interface WorldTileVersionBody {
  version?: unknown;
}

async function handleWorldTileRepair(
  request: Request,
  env: Env,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  const body = await parseJsonBody<WorldTileVersionBody>(request);
  const version = normalizeIdentifier(body.version, 'version');
  const renderer = await requireWorldTileRendererVersion(env, version);
  if (renderer.status === 'failed' || renderer.status === 'retired') {
    throw new HttpError(409, 'Failed or retired renderer versions must be re-backfilled before repair.');
  }
  await repairWorldTileOutbox(env, version);
  const dispatch = scheduleWorldTileOutboxDispatch(env, context);
  const counts = await loadWorldTileRendererStatusCounts(env, version);
  return jsonResponse(request, { ok: true, version, counts, dispatch });
}

async function handleWorldTileActivate(request: Request, env: Env): Promise<Response> {
  const body = await parseJsonBody<WorldTileVersionBody>(request);
  const version = normalizeIdentifier(body.version, 'version');
  const renderer = await requireWorldTileRendererVersion(env, version);
  if (renderer.status !== 'building') {
    throw new HttpError(409, 'Only a fully reconciled building renderer version can be activated.');
  }

  const counts = await loadWorldTileRendererStatusCounts(env, version);
  if (counts.pending > 0 || counts.leased > 0 || counts.failed > 0 || counts.outboxPending > 0) {
    throw new HttpError(409, 'Renderer activation requires zero pending, leased, failed, and undispatched rows.');
  }
  const leafParity = await loadWorldTileLeafParityCounts(env, version);
  if (
    leafParity.missingLeaves > 0
    || leafParity.staleLeaves > 0
    || leafParity.extraContentLeaves > 0
    || leafParity.matchingLeaves !== leafParity.publishedRooms
  ) {
    throw new HttpError(409, 'Renderer activation requires one current L4 leaf for every published room.');
  }
  const ancestorParity = await loadWorldTileAncestorParity(env, version);
  if (ancestorParity.some((level) => (
    level.missing > 0 || level.stale > 0 || level.matching !== level.expected
  ))) {
    throw new HttpError(409, 'Renderer activation requires every nonempty L0-L3 ancestor to be current.');
  }
  const objectVerification = await verifyWorldTileObjects(env, version);
  if (objectVerification.missingKeys.length > 0 || objectVerification.mismatchedKeys.length > 0) {
    throw new HttpError(409, 'Renderer activation requires every advertised R2 object to match its ready pointer.');
  }

  if (!(await activateWorldTileRendererVersion(env, version))) {
    throw new HttpError(409, 'Renderer activation lost a concurrent status change; recheck and retry.');
  }
  return jsonResponse(request, {
    ok: true,
    version,
    counts,
    leafParity,
    ancestorParity,
    objectVerification,
  });
}

async function handleWorldTileStatus(request: Request, url: URL, env: Env): Promise<Response> {
  const requestedVersion = url.searchParams.get('rendererVersion')?.trim() || null;
  const versions = await loadWorldTileRendererVersions(env);
  if (requestedVersion && !versions.some((entry) => entry.version === requestedVersion)) {
    throw new HttpError(404, `World tile renderer ${requestedVersion} was not found.`);
  }
  const selected = requestedVersion
    ? versions.filter((entry) => entry.version === requestedVersion)
    : versions;
  const statuses = await Promise.all(selected.map(async (renderer) => ({
    renderer,
    counts: await loadWorldTileRendererStatusCounts(env, renderer.version),
    leafParity: await loadWorldTileLeafParityCounts(env, renderer.version),
    ancestorParity: await loadWorldTileAncestorParity(env, renderer.version),
  })));
  const verifyObjects = url.searchParams.get('verifyObjects') === '1' && requestedVersion !== null;
  return jsonResponse(request, {
    schemaVersion: WORLD_TILE_SCHEMA_VERSION,
    generationEnabled: worldTileGenerationEnabled(env),
    statuses,
    objectVerification: verifyObjects
      ? await verifyWorldTileObjects(env, requestedVersion)
      : null,
  }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

interface WorldTileGarbageCollectBody {
  dryRun?: unknown;
  confirm?: unknown;
  olderThanDays?: unknown;
}

async function handleWorldTileGarbageCollect(request: Request, env: Env): Promise<Response> {
  const bucket = requireWorldTileBucket(env);
  const body = await parseJsonBody<WorldTileGarbageCollectBody>(request);
  const dryRun = body.dryRun !== false;
  const confirmed = body.confirm === true;
  if (!dryRun && !confirmed) {
    throw new HttpError(400, 'Garbage collection deletion requires confirm=true.');
  }
  const olderThanDays = body.olderThanDays === undefined
    ? WORLD_TILE_MIN_GC_AGE_DAYS
    : Number(body.olderThanDays);
  if (!Number.isSafeInteger(olderThanDays) || olderThanDays < WORLD_TILE_MIN_GC_AGE_DAYS) {
    throw new HttpError(400, `olderThanDays must be a safe integer of at least ${WORLD_TILE_MIN_GC_AGE_DAYS}.`);
  }

  const cutoffMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1_000;
  const referencedKeys = await loadAllReferencedWorldTileObjectKeys(env.DB);
  const candidates: R2ObjectMetadata[] = [];
  let examined = 0;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: WORLD_TILE_R2_PREFIX, cursor, limit: 1_000 });
    examined += page.objects.length;
    for (const object of page.objects) {
      if (!referencedKeys.has(object.key) && object.uploaded.getTime() < cutoffMs) {
        candidates.push(object);
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
    if (page.truncated && !cursor) {
      throw new Error('R2 returned a truncated object page without a cursor.');
    }
  } while (cursor);

  if (!dryRun) {
    for (let index = 0; index < candidates.length; index += 1_000) {
      await bucket.delete(candidates.slice(index, index + 1_000).map((object) => object.key));
    }
  }

  return jsonResponse(request, {
    ok: true,
    dryRun,
    olderThanDays,
    examined,
    referenced: referencedKeys.size,
    candidates: candidates.length,
    candidateBytes: candidates.reduce((total, object) => total + object.size, 0),
    deleted: dryRun ? 0 : candidates.length,
  });
}

async function verifyWorldTileObjects(env: Env, rendererVersion: string): Promise<{
  checked: number;
  missingKeys: string[];
  mismatchedKeys: string[];
}> {
  const bucket = requireWorldTileBucket(env);
  const pointers = await loadReferencedWorldTileObjectPointers(env.DB, rendererVersion);
  const pointerByKey = new Map<string, { etag: string; byteLength: number }>();
  const missingKeys: string[] = [];
  const mismatchedKeys: string[] = [];
  for (const pointer of pointers) {
    const existing = pointerByKey.get(pointer.key);
    if (existing && (
      normalizeR2Etag(existing.etag) !== normalizeR2Etag(pointer.etag)
      || existing.byteLength !== pointer.byteLength
    )) {
      mismatchedKeys.push(pointer.key);
      continue;
    }
    pointerByKey.set(pointer.key, { etag: pointer.etag, byteLength: pointer.byteLength });
  }
  const keys = [...pointerByKey.keys()].sort();
  for (let index = 0; index < keys.length; index += 20) {
    const chunk = keys.slice(index, index + 20);
    const objects = await Promise.all(chunk.map((key) => bucket.head(key)));
    objects.forEach((object, objectIndex) => {
      const key = chunk[objectIndex];
      const pointer = pointerByKey.get(key)!;
      if (!object) {
        missingKeys.push(key);
      } else if (
        object.key !== key
        || object.size !== pointer.byteLength
        || normalizeR2Etag(object.etag) !== normalizeR2Etag(pointer.etag)
      ) {
        mismatchedKeys.push(key);
      }
    });
  }
  return {
    checked: keys.length,
    missingKeys: [...new Set(missingKeys)].sort(),
    mismatchedKeys: [...new Set(mismatchedKeys)].sort(),
  };
}

function normalizeR2Etag(value: string): string {
  return value.trim().replace(/^W\//i, '').replace(/^"|"$/g, '');
}

export function scheduleWorldTileOutboxDispatch(
  env: Env,
  context?: WorkerExecutionContextLike,
): { scheduled: boolean; reason: string | null } {
  if (!worldTileGenerationEnabled(env)) {
    return { scheduled: false, reason: 'generation-disabled' };
  }
  if (!env.WORLD_TILE_QUEUE) {
    return { scheduled: false, reason: 'queue-unbound' };
  }
  const dispatch = dispatchPendingWorldTileOutbox(env, env.WORLD_TILE_QUEUE).catch((error) => {
    console.error('World tile outbox dispatch failed.', error);
    throw error;
  });
  if (context) {
    context.waitUntil(dispatch);
  } else {
    void dispatch.catch(() => undefined);
  }
  return { scheduled: true, reason: null };
}

function applyConditionalEtag(request: Request, response: Response): Response {
  const etag = response.headers.get('ETag');
  const ifNoneMatch = request.headers.get('If-None-Match');
  if (!etag || !ifNoneMatch || !ifNoneMatch.split(',').map((value) => value.trim()).includes(etag)) {
    return response;
  }
  return new Response(null, {
    status: 304,
    headers: response.headers,
  });
}

function parseSafeIntegerQuery(searchParams: URLSearchParams, key: string): number {
  const raw = searchParams.get(key);
  if (raw === null || raw.trim() === '') {
    throw new HttpError(400, `${key} is required.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new HttpError(400, `${key} must be a safe integer.`);
  }
  return value;
}

function parseOptionalBinaryQuery(
  searchParams: URLSearchParams,
  key: string,
  defaultValue: boolean,
): boolean {
  const raw = searchParams.get(key);
  if (raw === null) return defaultValue;
  if (raw === '0') return false;
  if (raw === '1') return true;
  throw new HttpError(400, `${key} must be 0 or 1.`);
}

function normalizeIdentifier(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$/.test(normalized)) {
    throw new HttpError(400, `${label} must be a 3-128 character stable identifier.`);
  }
  return normalized;
}

function normalizeContractHash(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9:_-]{8,256}$/.test(normalized)) {
    throw new HttpError(400, `${label} must be an 8-256 character contract hash.`);
  }
  return normalized;
}

function normalizeImmutableRenderOrigin(value: unknown, acknowledged: unknown): string {
  if (acknowledged !== true) {
    throw new HttpError(400, 'immutableRenderOrigin=true is required for renderer version creation.');
  }
  const raw = typeof value === 'string' ? value.trim() : '';
  const normalized = normalizeImmutablePagesDeploymentOrigin(raw);
  if (!normalized) {
    throw new HttpError(400, 'renderOrigin must be an immutable HTTPS Pages deployment origin.');
  }
  return normalized;
}

async function requireWorldTileRendererVersion(
  env: Env,
  version: string,
): Promise<WorldTileRendererVersionRow> {
  const renderer = await loadWorldTileRendererVersion(env, version);
  if (!renderer) throw new HttpError(404, `World tile renderer ${version} was not found.`);
  return renderer;
}

function requireWorldTileBucket(env: Env): R2BucketBinding {
  if (!env.WORLD_TILE_BUCKET) {
    throw new HttpError(503, 'World tile R2 binding is unavailable.');
  }
  return env.WORLD_TILE_BUCKET;
}

function createWeakJsonEtag(namespace: string, value: unknown): string {
  const serialized = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `W/"${namespace}-${(hash >>> 0).toString(16).padStart(8, '0')}"`;
}
