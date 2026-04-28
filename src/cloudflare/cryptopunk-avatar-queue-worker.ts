import { Container, getContainer } from '@cloudflare/containers';

const CONTAINER_INSTANCE_NAME = 'cryptopunk-avatar-queue';
const DEFAULT_PREFIX = 'avatars/cryptopunks';
const DEFAULT_MAX_JOBS = 2;
const DEFAULT_STALE_AFTER_MINUTES = 20;
const REQUIRED_GENERATED_FILES = [
  'PlayerSheet.png',
  'PlayerSheet.json',
  'PlayerCombatActionsSheet.png',
  'PlayerCombatActionsSheet.json',
  'head.png',
] as const;

export class CryptopunkAvatarQueueContainer extends Container<QueueEnv> {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = '30s';
  enableInternet = false;
  pingEndpoint = 'localhost/ready';
}

export default {
  async fetch(request: Request, env: QueueEnv): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        return jsonResponse({
          ok: true,
          queue: await loadQueueSummary(env),
          config: summarizeConfig(env),
        });
      }

      if (request.method === 'POST' && url.pathname === '/api/run') {
        assertManualRunAuthorized(request, env);
        return jsonResponse(await processQueue(env, 'manual'));
      }

      return jsonResponse({ ok: false, error: 'Not found.' }, 404);
    } catch (error) {
      return jsonResponse({ ok: false, error: formatError(error) }, statusForError(error));
    }
  },

  async scheduled(controller: QueueScheduledController, env: QueueEnv, ctx: QueueExecutionContext): Promise<void> {
    ctx.waitUntil(processQueue(env, `cron:${controller.cron}`));
  },
};

async function processQueue(env: QueueEnv, trigger: string): Promise<QueueRunSummary> {
  const config = loadQueueConfig(env);
  const recovered = await recoverStaleJobs(env, config);
  const processed: QueueRunSummary['processed'] = [];

  for (let index = 0; index < config.maxJobs; index += 1) {
    const job = await claimNextQueuedJob(env);
    if (!job) {
      break;
    }

    try {
      const containerResult = await runContainerJob(env, job);
      const uploadSummary = await uploadGeneratedPack(env, config, job, containerResult);
      await markJobReady(env, job, uploadSummary);
      processed.push({
        avatarId: job.avatarId,
        manifestUrl: uploadSummary.manifestUrl,
        punkId: job.punkId,
        status: 'ready',
      });
    } catch (error) {
      const message = formatError(error);
      await markJobFailed(env, job, message);
      processed.push({
        avatarId: job.avatarId,
        errorMessage: message.slice(0, 500),
        punkId: job.punkId,
        status: 'failed',
      });
    }
  }

  return {
    ok: true,
    processed,
    recovered,
    trigger,
  };
}

async function runContainerJob(
  env: QueueEnv,
  job: ClaimedCryptopunkJob,
): Promise<ContainerRunResponse> {
  const container = getContainer(
    env.CRYPTOPUNK_AVATAR_QUEUE_CONTAINER,
    CONTAINER_INSTANCE_NAME,
  );
  const response = await container.fetch(new Request('http://container/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      avatarId: job.avatarId,
      punkId: job.punkId,
    }),
  }));

  const rawBody = await response.text();
  let body: unknown;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    throw new Error(`Container returned non-JSON response ${response.status}: ${rawBody.slice(0, 500)}`);
  }

  if (!response.ok || !isContainerRunResponse(body)) {
    const errorMessage = getObjectString(body, 'error') || rawBody.slice(0, 500);
    throw new Error(`Container generation failed for ${job.avatarId}: ${errorMessage}`);
  }

  return body;
}

async function uploadGeneratedPack(
  env: QueueEnv,
  config: QueueConfig,
  job: ClaimedCryptopunkJob,
  containerResult: ContainerRunResponse,
): Promise<GeneratedPackUploadSummary> {
  const localManifest = containerResult.localManifest;
  const assetBaseUrl = joinUrl(config.publicBaseUrl, config.prefix, `punk-${job.punkId}`);
  const runtimeManifest = {
    accessories: normalizeStringArray(localManifest.accessories),
    assetBaseUrl,
    assets: {
      baseAtlas: `${assetBaseUrl}/PlayerSheet.json`,
      baseTexture: `${assetBaseUrl}/PlayerSheet.png`,
      combatAtlas: `${assetBaseUrl}/PlayerCombatActionsSheet.json`,
      combatTexture: `${assetBaseUrl}/PlayerCombatActionsSheet.png`,
    },
    avatarId: job.avatarId,
    backHead: isRecord(localManifest.backHead) ? localManifest.backHead : null,
    generatedAt: new Date().toISOString(),
    headImageUrl: `${assetBaseUrl}/head.png`,
    notes: typeof localManifest.notes === 'string' ? localManifest.notes : '',
    punkId: job.punkId,
    punkType: typeof localManifest.punkType === 'string' ? localManifest.punkType : null,
    version: Number(localManifest.version ?? 1) || 1,
  };

  for (const name of REQUIRED_GENERATED_FILES) {
    const file = containerResult.files[name];
    if (!file) {
      throw new Error(`Container did not return generated file ${name}.`);
    }
    await putR2Object(env, {
      body: decodeBase64(file.base64),
      cacheControl: 'public, max-age=300',
      contentType: file.contentType,
      key: `${config.prefix}/punk-${job.punkId}/${name}`,
    });
  }

  await putR2Object(env, {
    body: new TextEncoder().encode(`${JSON.stringify(runtimeManifest, null, 2)}\n`),
    cacheControl: 'public, max-age=300',
    contentType: 'application/json',
    key: `${config.prefix}/punk-${job.punkId}/manifest.json`,
  });

  return {
    accessories: runtimeManifest.accessories,
    assetBaseUrl,
    baseAtlasUrl: runtimeManifest.assets.baseAtlas,
    baseTextureUrl: runtimeManifest.assets.baseTexture,
    combatAtlasUrl: runtimeManifest.assets.combatAtlas,
    combatTextureUrl: runtimeManifest.assets.combatTexture,
    headImageUrl: runtimeManifest.headImageUrl,
    manifestUrl: `${assetBaseUrl}/manifest.json`,
    punkType: runtimeManifest.punkType,
  };
}

async function putR2Object(env: QueueEnv, input: R2PutInput): Promise<void> {
  await env.AVATAR_BUCKET.put(input.key, input.body, {
    httpMetadata: {
      cacheControl: input.cacheControl,
      contentType: input.contentType,
    },
  });
}

async function recoverStaleJobs(env: QueueEnv, config: QueueConfig): Promise<number[]> {
  if (config.staleAfterMinutes <= 0) {
    return [];
  }

  const nowIso = new Date().toISOString();
  const staleBeforeIso = new Date(Date.now() - config.staleAfterMinutes * 60_000).toISOString();
  const response = await env.DB.prepare(
    `
      UPDATE cryptopunk_avatar_packs
      SET
        status = 'queued',
        generation_job_id = NULL,
        generation_started_at = NULL,
        generated_at = NULL,
        asset_base_url = NULL,
        manifest_url = NULL,
        head_image_url = NULL,
        base_texture_url = NULL,
        base_atlas_url = NULL,
        combat_texture_url = NULL,
        combat_atlas_url = NULL,
        punk_type = NULL,
        accessories_json = NULL,
        error_message = NULL,
        requested_at = COALESCE(requested_at, generation_started_at, updated_at, created_at),
        updated_at = ?
      WHERE status = 'generating'
        AND generation_started_at IS NOT NULL
        AND generation_started_at < ?
      RETURNING punk_id
    `,
  )
    .bind(nowIso, staleBeforeIso)
    .all<{ punk_id: number }>();

  return response.results.map((row) => Number(row.punk_id));
}

async function claimNextQueuedJob(env: QueueEnv): Promise<ClaimedCryptopunkJob | null> {
  const nowIso = new Date().toISOString();
  const jobId = buildGenerationJobId();
  const response = await env.DB.prepare(
    `
      UPDATE cryptopunk_avatar_packs
      SET
        status = 'generating',
        generation_job_id = ?,
        generation_started_at = ?,
        updated_at = ?,
        error_message = NULL
      WHERE punk_id = (
        SELECT punk_id
        FROM cryptopunk_avatar_packs
        WHERE status = 'queued'
        ORDER BY COALESCE(requested_at, updated_at, created_at) ASC, punk_id ASC
        LIMIT 1
      )
      RETURNING punk_id, avatar_id, generation_job_id
    `,
  )
    .bind(jobId, nowIso, nowIso)
    .all<{
      avatar_id: string;
      generation_job_id: string | null;
      punk_id: number;
    }>();

  const row = response.results[0] ?? null;
  if (!row) {
    return null;
  }

  return {
    avatarId: String(row.avatar_id),
    generationJobId: String(row.generation_job_id ?? jobId),
    punkId: Number(row.punk_id),
  };
}

async function markJobReady(
  env: QueueEnv,
  job: ClaimedCryptopunkJob,
  uploadSummary: GeneratedPackUploadSummary,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const response = await env.DB.prepare(
    `
      UPDATE cryptopunk_avatar_packs
      SET
        status = 'ready',
        asset_base_url = ?,
        manifest_url = ?,
        head_image_url = ?,
        base_texture_url = ?,
        base_atlas_url = ?,
        combat_texture_url = ?,
        combat_atlas_url = ?,
        punk_type = ?,
        accessories_json = ?,
        error_message = NULL,
        generated_at = ?,
        updated_at = ?
      WHERE punk_id = ?
        AND generation_job_id = ?
      RETURNING punk_id
    `,
  )
    .bind(
      uploadSummary.assetBaseUrl,
      uploadSummary.manifestUrl,
      uploadSummary.headImageUrl,
      uploadSummary.baseTextureUrl,
      uploadSummary.baseAtlasUrl,
      uploadSummary.combatTextureUrl,
      uploadSummary.combatAtlasUrl,
      uploadSummary.punkType,
      JSON.stringify(uploadSummary.accessories),
      nowIso,
      nowIso,
      job.punkId,
      job.generationJobId,
    )
    .all<{ punk_id: number }>();

  if (!response.results[0]) {
    throw new Error(`Lost claim on ${job.avatarId} before marking it ready.`);
  }
}

async function markJobFailed(
  env: QueueEnv,
  job: ClaimedCryptopunkJob,
  errorMessage: string,
): Promise<void> {
  await env.DB.prepare(
    `
      UPDATE cryptopunk_avatar_packs
      SET
        status = 'failed',
        error_message = ?,
        updated_at = ?
      WHERE punk_id = ?
        AND generation_job_id = ?
    `,
  )
    .bind(errorMessage.slice(0, 2000), new Date().toISOString(), job.punkId, job.generationJobId)
    .all();
}

async function loadQueueSummary(env: QueueEnv): Promise<Record<string, number>> {
  const response = await env.DB.prepare(
    `
      SELECT status, COUNT(*) AS count
      FROM cryptopunk_avatar_packs
      GROUP BY status
      ORDER BY status ASC
    `,
  ).all<{ count: number; status: string }>();

  const summary: Record<string, number> = {};
  for (const row of response.results) {
    summary[String(row.status)] = Number(row.count) || 0;
  }
  return summary;
}

function loadQueueConfig(env: QueueEnv): QueueConfig {
  const publicBaseUrl = trimTrailingSlash(env.CRYPTOPUNK_AVATAR_PUBLIC_BASE_URL || '');
  if (!publicBaseUrl) {
    throw new HttpStatusError(500, 'CRYPTOPUNK_AVATAR_PUBLIC_BASE_URL is required.');
  }

  return {
    maxJobs: parsePositiveInteger(env.CRYPTOPUNK_AVATAR_MAX_JOBS, DEFAULT_MAX_JOBS),
    prefix: normalizePrefix(env.CRYPTOPUNK_AVATAR_R2_PREFIX || DEFAULT_PREFIX),
    publicBaseUrl,
    staleAfterMinutes: parsePositiveInteger(
      env.CRYPTOPUNK_AVATAR_STALE_AFTER_MINUTES,
      DEFAULT_STALE_AFTER_MINUTES,
    ),
  };
}

function summarizeConfig(env: QueueEnv): Record<string, unknown> {
  return {
    hasAvatarBucket: Boolean(env.AVATAR_BUCKET),
    hasContainer: Boolean(env.CRYPTOPUNK_AVATAR_QUEUE_CONTAINER),
    maxJobs: parsePositiveInteger(env.CRYPTOPUNK_AVATAR_MAX_JOBS, DEFAULT_MAX_JOBS),
    prefix: normalizePrefix(env.CRYPTOPUNK_AVATAR_R2_PREFIX || DEFAULT_PREFIX),
    publicBaseUrl: trimTrailingSlash(env.CRYPTOPUNK_AVATAR_PUBLIC_BASE_URL || ''),
    staleAfterMinutes: parsePositiveInteger(
      env.CRYPTOPUNK_AVATAR_STALE_AFTER_MINUTES,
      DEFAULT_STALE_AFTER_MINUTES,
    ),
  };
}

function assertManualRunAuthorized(request: Request, env: QueueEnv): void {
  const token = env.ADMIN_API_KEY || '';
  if (!token) {
    throw new HttpStatusError(404, 'Manual queue runs are not enabled.');
  }

  const authorization = request.headers.get('Authorization') || '';
  const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const headerToken = request.headers.get('x-admin-api-key') || '';
  if (bearerToken !== token && headerToken !== token) {
    throw new HttpStatusError(401, 'Unauthorized.');
  }
}

function isContainerRunResponse(value: unknown): value is ContainerRunResponse {
  if (!isRecord(value) || value.ok !== true) {
    return false;
  }
  if (!Number.isInteger(value.punkId) || typeof value.avatarId !== 'string') {
    return false;
  }
  if (!isRecord(value.localManifest) || !isRecord(value.files)) {
    return false;
  }

  const files = value.files;
  return REQUIRED_GENERATED_FILES.every((name) => {
    const file = files[name];
    return (
      isRecord(file)
      && typeof file.base64 === 'string'
      && typeof file.contentType === 'string'
    );
  });
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function getObjectString(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const entry = value[key];
  return typeof entry === 'string' ? entry : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function buildGenerationJobId(): string {
  return `cryptopunk-job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function joinUrl(...segments: string[]): string {
  return segments
    .filter(Boolean)
    .map((segment, index) => {
      if (index === 0) {
        return trimTrailingSlash(segment);
      }
      return segment.replace(/^\/+|\/+$/g, '');
    })
    .join('/');
}

function normalizePrefix(value: string): string {
  return String(value || DEFAULT_PREFIX)
    .trim()
    .replace(/^\/+|\/+$/g, '');
}

function trimTrailingSlash(value: string): string {
  return String(value || '').trim().replace(/\/+$/g, '');
}

function parsePositiveInteger(value: unknown, fallbackValue: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusForError(error: unknown): number {
  return error instanceof HttpStatusError ? error.status : 500;
}

class HttpStatusError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

interface QueueExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface QueueScheduledController {
  cron: string;
  scheduledTime: number;
  type: string;
}

type DurableObjectNamespace<T = unknown> = unknown;

interface QueueEnv {
  ADMIN_API_KEY?: string;
  AVATAR_BUCKET: R2Bucket;
  CRYPTOPUNK_AVATAR_CONTAINER_TIMEOUT_MS?: string;
  CRYPTOPUNK_AVATAR_MAX_JOBS?: string;
  CRYPTOPUNK_AVATAR_PUBLIC_BASE_URL?: string;
  CRYPTOPUNK_AVATAR_QUEUE_CONTAINER: DurableObjectNamespace<CryptopunkAvatarQueueContainer>;
  CRYPTOPUNK_AVATAR_R2_PREFIX?: string;
  CRYPTOPUNK_AVATAR_STALE_AFTER_MINUTES?: string;
  DB: D1Database;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | string,
    options?: {
      httpMetadata?: {
        cacheControl?: string;
        contentType?: string;
      };
    },
  ): Promise<unknown>;
}

interface QueueConfig {
  maxJobs: number;
  prefix: string;
  publicBaseUrl: string;
  staleAfterMinutes: number;
}

interface ClaimedCryptopunkJob {
  avatarId: string;
  generationJobId: string;
  punkId: number;
}

interface ContainerRunResponse {
  avatarId: string;
  files: Record<string, {
    base64: string;
    contentType: string;
  }>;
  localManifest: Record<string, unknown>;
  ok: true;
  punkId: number;
}

interface GeneratedPackUploadSummary {
  accessories: string[];
  assetBaseUrl: string;
  baseAtlasUrl: string;
  baseTextureUrl: string;
  combatAtlasUrl: string;
  combatTextureUrl: string;
  headImageUrl: string;
  manifestUrl: string;
  punkType: string | null;
}

interface R2PutInput {
  body: Uint8Array;
  cacheControl: string;
  contentType: string;
  key: string;
}

interface QueueRunSummary {
  ok: true;
  processed: Array<{
    avatarId: string;
    errorMessage?: string;
    manifestUrl?: string;
    punkId: number;
    status: 'failed' | 'ready';
  }>;
  recovered: number[];
  trigger: string;
}
