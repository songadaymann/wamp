import { parseCustomBackgroundId } from '../../backgrounds/model';
import type { RoomSnapshot } from '../../persistence/roomModel';
import { WorldTileBrowserSession } from './browser';
import {
  WORLD_TILE_JOB_SCHEMA_VERSION,
  buildParentDesiredHash,
  buildWorldTileR2Key,
  parseWorldTileRenderJob,
  resolveParentReadiness,
  type ParentChildSlot,
  type WorldRenderTileRow,
  type WorldTileRenderJob,
  type WorldTileRendererVersionRow,
} from './contracts';
import { collectUnreferencedWorldTileObjects } from './gc';
import {
  acquireRenderLease,
  isCustomBackgroundApproved,
  listDispatchableOutbox,
  loadChildRenderTiles,
  loadPublishedRoomAt,
  loadRendererVersion,
  loadRenderTile,
  markOutboxDispatched,
  markOutboxDispatchFailed,
  markOutboxDispatching,
  publishReadyEmpty,
  publishReadyObject,
  requeueCurrentWorldTileGeneration,
  recoverExpiredLeases,
  releaseRenderLease,
  updateDesiredRenderState,
} from './store';
import type {
  D1Database,
  ExecutionContextLike,
  QueueMessage,
  QueueMessageBatch,
  ScheduledControllerLike,
  WorldTileRendererEnv,
} from './runtimeTypes';

const DEFAULT_LEASE_SECONDS = 120;
const OUTBOX_DISPATCH_LIMIT = 100;
const OUTBOX_STALE_MILLISECONDS = 60_000;
const RETRY_DELAYS_SECONDS = [1, 2, 5, 10, 30] as const;

export const worldTileRendererWorker = {
  async fetch(request: Request, env: WorldTileRendererEnv): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        return jsonResponse({
          ok: true,
          environment: env.WORLD_TILE_ENVIRONMENT ?? 'unknown',
          generationEnabled: worldTileGenerationEnabled(env),
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/admin/status') {
        assertAdminAuthorized(request, env);
        return jsonResponse({ ok: true, ...(await loadRendererStatus(env)) });
      }
      if (request.method === 'POST' && url.pathname === '/api/admin/repair') {
        assertAdminAuthorized(request, env);
        const repaired = await runRepair(env);
        return jsonResponse({ ok: true, ...repaired });
      }
      if (request.method === 'POST' && url.pathname === '/api/admin/gc') {
        assertAdminAuthorized(request, env);
        const body = await parseJsonBody(request);
        assertProductionGarbageCollectionConfirmed(request, env, body);
        const result = await collectUnreferencedWorldTileObjects(env.DB, env.WORLD_TILES, {
          dryRun: body.dryRun !== false,
          maximumDeletes: readOptionalInteger(body.maximumDeletes),
          maximumScanned: readOptionalInteger(body.maximumScanned),
          minimumAgeDays: readOptionalInteger(body.minimumAgeDays),
        });
        return jsonResponse({ ok: true, ...result });
      }
      return jsonResponse({ ok: false, error: 'Not found.' }, 404);
    } catch (error) {
      return jsonResponse({ ok: false, error: formatError(error) }, statusForError(error));
    }
  },

  async queue(batch: QueueMessageBatch<unknown>, env: WorldTileRendererEnv): Promise<void> {
    const startedAt = Date.now();
    const browserHolder: { promise: Promise<WorldTileBrowserSession> | null } = { promise: null };
    const counters: Record<WorldTileMessageResult, number> = {
      failed: 0,
      paused: 0,
      ready: 0,
      stale: 0,
      waiting: 0,
    };
    const getBrowser = (): Promise<WorldTileBrowserSession> => {
      browserHolder.promise ??= WorldTileBrowserSession.launch(env.WORLD_TILE_BROWSER);
      return browserHolder.promise;
    };

    try {
      for (const message of batch.messages) {
        try {
          const result = await processWorldTileMessage(message, env, getBrowser);
          counters[result] += 1;
          if (
            result === 'paused'
            || result === 'ready'
            || result === 'stale'
            || result === 'waiting'
          ) {
            message.ack();
          } else {
            message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
          }
        } catch (error) {
          counters.failed += 1;
          console.error('World tile Queue message failed.', {
            error: formatError(error),
            messageId: message.id,
            queue: batch.queue,
          });
          message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
        }
      }
    } finally {
      if (browserHolder.promise) {
        try {
          const browser = await browserHolder.promise;
          await browser.close();
        } catch (error) {
          console.warn('Failed to close Browser Run session.', formatError(error));
        }
      }
      console.log(JSON.stringify({
        event: 'world-tile-render-batch',
        queue: batch.queue,
        messageCount: batch.messages.length,
        durationMs: Date.now() - startedAt,
        browserSessionUsed: browserHolder.promise !== null,
        ...counters,
      }));
    }
  },

  async scheduled(
    controller: ScheduledControllerLike,
    env: WorldTileRendererEnv,
    ctx: ExecutionContextLike
  ): Promise<void> {
    ctx.waitUntil(runRepair(env).then((result) => {
      console.log(JSON.stringify({
        event: 'world-tile-render-repair',
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
        ...result,
      }));
    }));
  },
};

type WorldTileMessageResult = 'failed' | 'paused' | 'ready' | 'stale' | 'waiting';

async function processWorldTileMessage(
  message: QueueMessage<unknown>,
  env: WorldTileRendererEnv,
  getBrowser: () => Promise<WorldTileBrowserSession>
): Promise<WorldTileMessageResult> {
  const job = parseWorldTileRenderJob(message.body);
  const address = {
    rendererVersion: job.rendererVersion,
    level: job.level,
    x: job.x,
    y: job.y,
  };
  if (!worldTileGenerationEnabled(env)) {
    await requeueCurrentWorldTileGeneration(env.DB, {
      address,
      generation: job.generation,
      now: new Date().toISOString(),
      reason: 'generation-paused',
    });
    return 'paused';
  }
  const [renderer, currentTile] = await Promise.all([
    loadRendererVersion(env.DB, job.rendererVersion),
    loadRenderTile(env.DB, address),
  ]);
  if (!renderer) {
    throw new Error(`Renderer version ${job.rendererVersion} does not exist.`);
  }
  if (renderer.status === 'retired' || renderer.status === 'failed') {
    return 'stale';
  }
  if (!currentTile || currentTile.desired_generation !== job.generation) {
    return 'stale';
  }
  if (isCompleteReadyPointer(currentTile, job.generation)) {
    return 'stale';
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const leaseOwner = crypto.randomUUID();
  const leaseSeconds = readLeaseSeconds(env.WORLD_TILE_LEASE_SECONDS);
  const leased = await acquireRenderLease(env.DB, {
    address,
    generation: job.generation,
    leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1_000).toISOString(),
    leaseOwner,
    now: nowIso,
  });
  if (!leased) {
    return 'waiting';
  }

  try {
    const didPublish = job.level === 4
      ? await renderLeafJob(env, renderer, job, leased.desired_hash, leaseOwner, getBrowser)
      : await renderParentJob(env, renderer, job, leaseOwner, getBrowser);
    if (!didPublish) {
      await releaseRenderLease(env.DB, {
        address,
        error: 'render result lost generation or lease CAS',
        generation: job.generation,
        leaseOwner,
        now: new Date().toISOString(),
      });
      return 'stale';
    }
    return 'ready';
  } catch (error) {
    await releaseRenderLease(env.DB, {
      address,
      error: formatError(error),
      generation: job.generation,
      leaseOwner,
      now: new Date().toISOString(),
    });
    if (error instanceof WaitingForWorldTileChildrenError) {
      return 'waiting';
    }
    throw error;
  }
}

async function renderLeafJob(
  env: WorldTileRendererEnv,
  renderer: WorldTileRendererVersionRow,
  job: WorldTileRenderJob,
  existingDesiredHash: string | null,
  leaseOwner: string,
  getBrowser: () => Promise<WorldTileBrowserSession>
): Promise<boolean> {
  const address = jobAddress(job);
  const row = await loadPublishedRoomAt(env.DB, { x: job.x, y: job.y });
  const now = new Date().toISOString();
  if (!row?.published_json) {
    const updated = await updateDesiredRenderState(env.DB, {
      address,
      desiredEmpty: true,
      desiredHash: null,
      generation: job.generation,
      leaseOwner,
      now,
    });
    return updated && publishReadyEmpty(env.DB, {
      address,
      generation: job.generation,
      leaseOwner,
      now,
    });
  }

  const parsedSnapshot = parsePublishedSnapshot(row.published_json, row.id, job.x, job.y);
  const snapshot = await resolveRenderableLeafSnapshot(env.DB, parsedSnapshot);
  const sourceHash = existingDesiredHash
    ?? await sha256Hex(new TextEncoder().encode(row.published_json));
  const updated = await updateDesiredRenderState(env.DB, {
    address,
    desiredEmpty: false,
    desiredHash: sourceHash,
    generation: job.generation,
    leaseOwner,
    now,
  });
  if (!updated) {
    return false;
  }

  const browser = await getBrowser();
  const output = await browser.renderLeaf(renderer, snapshot);
  const png = decodeAndValidatePng(output.pngDataUrl);
  return uploadThenPublish(env, job, leaseOwner, png);
}

async function resolveRenderableLeafSnapshot(
  db: D1Database,
  snapshot: RoomSnapshot
): Promise<RoomSnapshot> {
  const customBackgroundId = parseCustomBackgroundId(snapshot.background);
  if (!customBackgroundId || await isCustomBackgroundApproved(db, customBackgroundId)) {
    return snapshot;
  }
  return {
    ...snapshot,
    background: 'solid:#050505',
  };
}

async function renderParentJob(
  env: WorldTileRendererEnv,
  renderer: WorldTileRendererVersionRow,
  job: WorldTileRenderJob,
  leaseOwner: string,
  getBrowser: () => Promise<WorldTileBrowserSession>
): Promise<boolean> {
  const address = jobAddress(job);
  const childRows = await loadChildRenderTiles(env.DB, address);
  const readiness = resolveParentReadiness(address, childRows);
  if (readiness.kind === 'waiting') {
    throw new WaitingForWorldTileChildrenError(
      `Parent l${job.level}/${job.x}/${job.y} is waiting for ${readiness.waiting.length} current children.`
    );
  }

  const now = new Date().toISOString();
  if (readiness.kind === 'empty') {
    const updated = await updateDesiredRenderState(env.DB, {
      address,
      desiredEmpty: true,
      desiredHash: null,
      generation: job.generation,
      leaseOwner,
      now,
    });
    return updated && publishReadyEmpty(env.DB, {
      address,
      generation: job.generation,
      leaseOwner,
      now,
    });
  }

  const desiredHash = await sha256Hex(new TextEncoder().encode(buildParentDesiredHash(readiness.sources)));
  const updated = await updateDesiredRenderState(env.DB, {
    address,
    desiredEmpty: false,
    desiredHash,
    generation: job.generation,
    leaseOwner,
    now,
  });
  if (!updated) {
    return false;
  }

  const children: Record<ParentChildSlot, string | null> = {
    northEast: null,
    northWest: null,
    southEast: null,
    southWest: null,
  };
  await Promise.all(readiness.sources.map(async (source) => {
    const object = await env.WORLD_TILES.get(source.key);
    if (!object) {
      throw new RetryableWorldTileError(`Current child object ${source.key} is missing from R2.`);
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    assertPngDimensions(bytes);
    const actualHash = await sha256Hex(bytes);
    if (actualHash !== source.contentHash) {
      throw new RetryableWorldTileError(
        `Child object ${source.key} hash mismatch: expected ${source.contentHash}, received ${actualHash}.`
      );
    }
    children[source.slot] = encodePngDataUrl(bytes);
  }));

  const browser = await getBrowser();
  const output = await browser.renderParent(renderer, children);
  const png = decodeAndValidatePng(output.pngDataUrl);
  return uploadThenPublish(env, job, leaseOwner, png);
}

async function uploadThenPublish(
  env: WorldTileRendererEnv,
  job: WorldTileRenderJob,
  leaseOwner: string,
  png: Uint8Array
): Promise<boolean> {
  const address = jobAddress(job);
  const contentHash = await sha256Hex(png);
  const key = buildWorldTileR2Key(address, contentHash);
  const uploaded = await env.WORLD_TILES.put(key, png, {
    httpMetadata: {
      cacheControl: 'public, max-age=31536000, immutable',
      contentType: 'image/png',
    },
    customMetadata: {
      contentHash,
      generation: String(job.generation),
      level: String(job.level),
      rendererVersion: job.rendererVersion,
      tileX: String(job.x),
      tileY: String(job.y),
    },
  });

  return publishReadyObject(env.DB, {
    address,
    byteLength: png.byteLength,
    contentHash,
    generation: job.generation,
    leaseOwner,
    now: new Date().toISOString(),
    r2Etag: uploaded.httpEtag ?? uploaded.etag,
    r2Key: key,
  });
}

export async function dispatchWorldTileOutbox(env: WorldTileRendererEnv): Promise<number> {
  if (!worldTileGenerationEnabled(env)) {
    return 0;
  }
  const now = new Date();
  const staleBefore = new Date(now.getTime() - OUTBOX_STALE_MILLISECONDS).toISOString();
  const rows = await listDispatchableOutbox(env.DB, staleBefore, OUTBOX_DISPATCH_LIMIT);
  let dispatched = 0;
  for (const row of rows) {
    const dispatching = await markOutboxDispatching(
      env.DB,
      row.id,
      staleBefore,
      new Date().toISOString()
    );
    if (!dispatching) {
      continue;
    }
    const enqueuedAt = new Date().toISOString();
    try {
      const job = parseWorldTileRenderJob({
        schemaVersion: WORLD_TILE_JOB_SCHEMA_VERSION,
        rendererVersion: row.renderer_version,
        level: row.level,
        x: row.tile_x,
        y: row.tile_y,
        generation: row.generation,
        reason: row.reason,
        enqueuedAt,
      });
      await env.WORLD_TILE_RENDER_QUEUE.send(job, { contentType: 'json' });
      await markOutboxDispatched(env.DB, row.id, new Date().toISOString());
      dispatched += 1;
    } catch (error) {
      await markOutboxDispatchFailed(env.DB, row.id, formatError(error), new Date().toISOString());
    }
  }
  return dispatched;
}

async function runRepair(env: WorldTileRendererEnv): Promise<{ dispatched: number; expiredLeases: number }> {
  const expiredLeases = await recoverExpiredLeases(env.DB, new Date().toISOString());
  const dispatched = await dispatchWorldTileOutbox(env);
  return { dispatched, expiredLeases };
}

async function loadRendererStatus(env: WorldTileRendererEnv): Promise<Record<string, unknown>> {
  const [versions, tileCounts, outboxCounts] = await Promise.all([
    env.DB.prepare(
      `SELECT version, status, created_at, activated_at, retired_at
       FROM world_tile_renderer_versions ORDER BY created_at DESC, version ASC LIMIT 20`
    ).all(),
    env.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN ready_generation = desired_generation THEN 1 ELSE 0 END) AS ready,
         SUM(CASE WHEN ready_generation IS NULL OR ready_generation < desired_generation THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN lease_owner IS NOT NULL THEN 1 ELSE 0 END) AS leased,
         SUM(CASE WHEN last_error IS NOT NULL THEN 1 ELSE 0 END) AS failed
       FROM world_render_tiles`
    ).first(),
    env.DB.prepare(
      `SELECT
         SUM(CASE WHEN state = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN state = 'dispatching' THEN 1 ELSE 0 END) AS dispatching,
         SUM(CASE WHEN state = 'dispatched' THEN 1 ELSE 0 END) AS dispatched
       FROM world_render_tile_outbox`
    ).first(),
  ]);
  return {
    generationEnabled: worldTileGenerationEnabled(env),
    outbox: outboxCounts ?? {},
    tiles: tileCounts ?? {},
    versions: versions.results,
  };
}

function parsePublishedSnapshot(raw: string, roomId: string, x: number, y: number): RoomSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Published snapshot for ${roomId} is not valid JSON.`);
  }
  if (!isRecord(parsed) || parsed.id !== roomId || parsed.status !== 'published') {
    throw new Error(`Published snapshot identity/status mismatch for ${roomId}.`);
  }
  if (!isRecord(parsed.coordinates) || parsed.coordinates.x !== x || parsed.coordinates.y !== y) {
    throw new Error(`Published snapshot coordinates do not match ${x},${y}.`);
  }
  if (!isRecord(parsed.tileData) || !Array.isArray(parsed.placedObjects)) {
    throw new Error(`Published snapshot for ${roomId} is missing renderable room data.`);
  }
  return parsed as unknown as RoomSnapshot;
}

function decodeAndValidatePng(dataUrl: string): Uint8Array {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) {
    throw new Error('Browser renderer did not return a PNG data URL.');
  }
  const encoded = dataUrl.slice(prefix.length);
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw new Error('Browser renderer returned invalid base64 PNG bytes.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  assertPngDimensions(bytes);
  return bytes;
}

function assertPngDimensions(bytes: Uint8Array): void {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || signature.some((value, index) => bytes[index] !== value)) {
    throw new Error('Rendered world tile is not a valid PNG.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width !== 642 || height !== 354) {
    throw new Error(`Rendered PNG was ${width}x${height}; expected 642x354.`);
  }
}

function encodePngDataUrl(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 32_768))));
  }
  return `data:image/png;base64,${btoa(chunks.join(''))}`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const stableBytes = new Uint8Array(bytes.byteLength);
  stableBytes.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', stableBytes.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function jobAddress(job: WorldTileRenderJob) {
  return {
    rendererVersion: job.rendererVersion,
    level: job.level,
    x: job.x,
    y: job.y,
  };
}

function isCompleteReadyPointer(row: WorldRenderTileRow, generation: number): boolean {
  if (row.ready_generation !== generation) {
    return false;
  }
  if (row.ready_empty === 1) {
    return true;
  }
  return row.ready_empty === 0
    && Boolean(row.ready_hash)
    && Boolean(row.r2_key)
    && Boolean(row.r2_etag)
    && typeof row.byte_length === 'number'
    && row.byte_length > 0;
}

function worldTileGenerationEnabled(env: WorldTileRendererEnv): boolean {
  const value = env.WORLD_TILE_GENERATION_ENABLED?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on';
}

function readLeaseSeconds(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 30 || parsed > 900) {
    return DEFAULT_LEASE_SECONDS;
  }
  return parsed;
}

function retryDelaySeconds(attempts: number): number {
  return RETRY_DELAYS_SECONDS[Math.min(Math.max(0, attempts - 1), RETRY_DELAYS_SECONDS.length - 1)];
}

async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('Content-Type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new HttpStatusError(415, 'Expected application/json.');
  }
  const parsed = await request.json();
  if (!isRecord(parsed)) {
    throw new HttpStatusError(400, 'Expected a JSON object.');
  }
  return parsed;
}

function assertAdminAuthorized(request: Request, env: WorldTileRendererEnv): void {
  const expected = env.ADMIN_API_KEY?.trim();
  if (!expected) {
    throw new HttpStatusError(503, 'Renderer admin API is not configured.');
  }
  const authorization = request.headers.get('Authorization')?.trim() ?? '';
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  const provided = bearer || request.headers.get('X-Admin-Key')?.trim() || '';
  if (provided !== expected) {
    throw new HttpStatusError(401, 'Unauthorized.');
  }
}

function assertProductionGarbageCollectionConfirmed(
  request: Request,
  env: WorldTileRendererEnv,
  body: Record<string, unknown>
): void {
  if ((env.WORLD_TILE_ENVIRONMENT ?? '').trim().toLowerCase() !== 'production') {
    return;
  }
  if (
    body.confirmProduction !== true
    || request.headers.get('X-WAMP-Confirm-Production') !== 'world-tile-gc'
  ) {
    throw new HttpStatusError(
      409,
      'Production garbage collection requires confirmProduction=true and X-WAMP-Confirm-Production: world-tile-gc.'
    );
  }
}

function readOptionalInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function statusForError(error: unknown): number {
  return error instanceof HttpStatusError ? error.status : 500;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class RetryableWorldTileError extends Error {}
class WaitingForWorldTileChildrenError extends Error {}

class HttpStatusError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
