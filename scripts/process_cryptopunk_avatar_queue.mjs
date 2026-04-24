import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(repoRoot);

const DEFAULT_PREFIX = 'avatars/cryptopunks';
const DEFAULT_MAX_JOBS = 1;
const DEFAULT_STALE_AFTER_MINUTES = 20;
const LOCAL_WRANGLER_PATH = path.join(repoRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const resolvedOptions = finalizeOptions(options);
let processedJobs = 0;

if (resolvedOptions.staleAfterMinutes > 0) {
  const recovered = recoverStaleJobs(resolvedOptions);
  if (recovered.length > 0) {
    console.log(`Recovered ${recovered.length} stale generating job(s): ${recovered.join(', ')}`);
  }
}

for (let index = 0; index < resolvedOptions.maxJobs; index += 1) {
  const job = claimNextQueuedJob(resolvedOptions);
  if (!job) {
    if (processedJobs === 0) {
      console.log('No queued CryptoPunk avatar jobs found.');
    }
    break;
  }

  processedJobs += 1;
  console.log(`Processing CryptoPunk ${job.punkId} (${job.generationJobId})...`);

  try {
    const uploadSummary = buildAndUploadPack(job, resolvedOptions);
    markJobReady(job, uploadSummary, resolvedOptions);
    console.log(`Ready: cryptopunk-${job.punkId} -> ${uploadSummary.manifestUrl}`);
  } catch (error) {
    const message = formatError(error);
    markJobFailed(job, message, resolvedOptions);
    console.error(`Failed CryptoPunk ${job.punkId}: ${message}`);
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const result = {
    bucket: process.env.CRYPTOPUNK_AVATAR_R2_BUCKET?.trim() || '',
    env: process.env.CRYPTOPUNK_AVATAR_CF_ENV?.trim() || '',
    help: false,
    maxJobs: parsePositiveInteger(process.env.CRYPTOPUNK_AVATAR_MAX_JOBS, DEFAULT_MAX_JOBS),
    prefix: normalizePrefix(process.env.CRYPTOPUNK_AVATAR_R2_PREFIX || DEFAULT_PREFIX),
    publicBaseUrl: trimTrailingSlash(process.env.CRYPTOPUNK_AVATAR_PUBLIC_BASE_URL || ''),
    remote: true,
    staleAfterMinutes: parsePositiveInteger(
      process.env.CRYPTOPUNK_AVATAR_STALE_AFTER_MINUTES,
      DEFAULT_STALE_AFTER_MINUTES
    ),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--bucket':
        if (!next) {
          throw new Error('--bucket requires a value.');
        }
        result.bucket = next.trim();
        index += 1;
        break;
      case '--env':
        if (!next) {
          throw new Error('--env requires a value.');
        }
        result.env = next.trim();
        index += 1;
        break;
      case '--max-jobs':
        if (!next) {
          throw new Error('--max-jobs requires a value.');
        }
        result.maxJobs = parsePositiveInteger(next, DEFAULT_MAX_JOBS);
        index += 1;
        break;
      case '--prefix':
        if (!next) {
          throw new Error('--prefix requires a value.');
        }
        result.prefix = normalizePrefix(next);
        index += 1;
        break;
      case '--public-base-url':
        if (!next) {
          throw new Error('--public-base-url requires a value.');
        }
        result.publicBaseUrl = trimTrailingSlash(next);
        index += 1;
        break;
      case '--stale-after-minutes':
        if (!next) {
          throw new Error('--stale-after-minutes requires a value.');
        }
        result.staleAfterMinutes = parsePositiveInteger(next, DEFAULT_STALE_AFTER_MINUTES);
        index += 1;
        break;
      case '--local':
        result.remote = false;
        break;
      case '--remote':
        result.remote = true;
        break;
      case '-h':
      case '--help':
        result.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return result;
}

function finalizeOptions(options) {
  const envName = options.env || '';
  const bucket = options.bucket || defaultBucketForEnv(envName);
  if (!bucket) {
    throw new Error('Set --bucket or CRYPTOPUNK_AVATAR_R2_BUCKET before running the queue processor.');
  }

  const publicBaseUrl =
    sanitizePublicUrl(options.publicBaseUrl)
    || sanitizePublicUrl(resolveR2DevPublicUrl(bucket));

  if (!publicBaseUrl) {
    throw new Error(
      'Set --public-base-url or enable an r2.dev URL on the target bucket before running the queue processor.'
    );
  }

  return {
    ...options,
    bucket,
    env: envName,
    publicBaseUrl,
  };
}

function printHelp() {
  console.log(`Usage:
  node scripts/process_cryptopunk_avatar_queue.mjs [--env safety] [--bucket <name>]
                                                   [--public-base-url <url>] [--max-jobs <n>]
                                                   [--prefix <path>] [--stale-after-minutes <n>]
                                                   [--local | --remote]

What it does:
  1. Requeues stale generating jobs
  2. Claims queued CryptoPunk avatar rows from D1
  3. Builds each pack with the local generator
  4. Uploads pack assets to R2
  5. Marks the row ready or failed in D1

Defaults:
  - env: current default Wrangler env
  - bucket: ${defaultBucketForEnv('')} or ${defaultBucketForEnv('safety')} when --env safety
  - prefix: ${DEFAULT_PREFIX}
  - max-jobs: ${DEFAULT_MAX_JOBS}
  - stale-after-minutes: ${DEFAULT_STALE_AFTER_MINUTES}

Examples:
  npm run avatar:cryptopunk:queue:safety
  npm run avatar:cryptopunk:queue -- --env safety --max-jobs 5
  npm run avatar:cryptopunk:queue -- --bucket everybodys-platformer-avatars --public-base-url https://pub-xxx.r2.dev
`);
}

function recoverStaleJobs(options) {
  const nowIso = new Date().toISOString();
  const staleBeforeIso = new Date(
    Date.now() - options.staleAfterMinutes * 60_000
  ).toISOString();
  const response = d1ExecJson(
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
        updated_at = ${sqlString(nowIso)}
      WHERE status = 'generating'
        AND generation_started_at IS NOT NULL
        AND generation_started_at < ${sqlString(staleBeforeIso)}
      RETURNING punk_id
    `,
    options
  );
  return response[0]?.results?.map((row) => Number(row.punk_id)) ?? [];
}

function claimNextQueuedJob(options) {
  const nowIso = new Date().toISOString();
  const jobId = buildGenerationJobId();
  const response = d1ExecJson(
    `
      UPDATE cryptopunk_avatar_packs
      SET
        status = 'generating',
        generation_job_id = ${sqlString(jobId)},
        generation_started_at = ${sqlString(nowIso)},
        updated_at = ${sqlString(nowIso)},
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
    options
  );
  const row = response[0]?.results?.[0] ?? null;
  if (!row) {
    return null;
  }

  return {
    avatarId: String(row.avatar_id),
    generationJobId: String(row.generation_job_id ?? jobId),
    punkId: Number(row.punk_id),
  };
}

function buildAndUploadPack(job, options) {
  const buildResult = runCryptopunkBuild(job.punkId);
  if (buildResult) {
    console.log(buildResult.trim());
  }

  const packRoot = path.join(
    repoRoot,
    'gen-avatar',
    'cryptopunk',
    'generated-avatar-packs',
    `punk-${job.punkId}`
  );
  const localManifest = readJsonFile(path.join(packRoot, 'manifest.json'));
  const assetBaseUrl = joinUrl(options.publicBaseUrl, options.prefix, `punk-${job.punkId}`);
  const manifest = {
    accessories: normalizeStringArray(localManifest.accessories),
    assetBaseUrl,
    assets: {
      baseAtlas: `${assetBaseUrl}/PlayerSheet.json`,
      baseTexture: `${assetBaseUrl}/PlayerSheet.png`,
      combatAtlas: `${assetBaseUrl}/PlayerCombatActionsSheet.json`,
      combatTexture: `${assetBaseUrl}/PlayerCombatActionsSheet.png`,
    },
    avatarId: job.avatarId,
    backHead: sanitizeBackHeadInfo(localManifest.backHead),
    generatedAt: new Date().toISOString(),
    headImageUrl: `${assetBaseUrl}/head.png`,
    notes: typeof localManifest.notes === 'string' ? localManifest.notes : '',
    punkId: job.punkId,
    punkType: typeof localManifest.punkType === 'string' ? localManifest.punkType : null,
    version: Number(localManifest.version ?? 1) || 1,
  };

  const uploadManifestPath = path.join(packRoot, 'manifest.runtime.json');
  writeFileSync(uploadManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  try {
    const uploadPlan = [
      {
        cacheControl: 'public, max-age=300',
        contentType: 'image/png',
        key: `${options.prefix}/punk-${job.punkId}/PlayerSheet.png`,
        localPath: path.join(packRoot, 'PlayerSheet.png'),
      },
      {
        cacheControl: 'public, max-age=300',
        contentType: 'application/json',
        key: `${options.prefix}/punk-${job.punkId}/PlayerSheet.json`,
        localPath: path.join(packRoot, 'PlayerSheet.json'),
      },
      {
        cacheControl: 'public, max-age=300',
        contentType: 'image/png',
        key: `${options.prefix}/punk-${job.punkId}/PlayerCombatActionsSheet.png`,
        localPath: path.join(packRoot, 'PlayerCombatActionsSheet.png'),
      },
      {
        cacheControl: 'public, max-age=300',
        contentType: 'application/json',
        key: `${options.prefix}/punk-${job.punkId}/PlayerCombatActionsSheet.json`,
        localPath: path.join(packRoot, 'PlayerCombatActionsSheet.json'),
      },
      {
        cacheControl: 'public, max-age=300',
        contentType: 'image/png',
        key: `${options.prefix}/punk-${job.punkId}/head.png`,
        localPath: path.join(packRoot, 'head.png'),
      },
      {
        cacheControl: 'public, max-age=300',
        contentType: 'application/json',
        key: `${options.prefix}/punk-${job.punkId}/manifest.json`,
        localPath: uploadManifestPath,
      },
    ];

    for (const entry of uploadPlan) {
      if (!existsSync(entry.localPath)) {
        throw new Error(`Missing generated file: ${entry.localPath}`);
      }
      uploadR2Object(entry, options);
    }
  } finally {
    rmSync(uploadManifestPath, { force: true });
  }

  return {
    accessories: manifest.accessories,
    assetBaseUrl,
    baseAtlasUrl: manifest.assets.baseAtlas,
    baseTextureUrl: manifest.assets.baseTexture,
    combatAtlasUrl: manifest.assets.combatAtlas,
    combatTextureUrl: manifest.assets.combatTexture,
    headImageUrl: manifest.headImageUrl,
    manifestUrl: `${assetBaseUrl}/manifest.json`,
    punkType: manifest.punkType,
  };
}

function markJobReady(job, uploadSummary, options) {
  const nowIso = new Date().toISOString();
  const response = d1ExecJson(
    `
      UPDATE cryptopunk_avatar_packs
      SET
        status = 'ready',
        asset_base_url = ${sqlString(uploadSummary.assetBaseUrl)},
        manifest_url = ${sqlString(uploadSummary.manifestUrl)},
        head_image_url = ${sqlString(uploadSummary.headImageUrl)},
        base_texture_url = ${sqlString(uploadSummary.baseTextureUrl)},
        base_atlas_url = ${sqlString(uploadSummary.baseAtlasUrl)},
        combat_texture_url = ${sqlString(uploadSummary.combatTextureUrl)},
        combat_atlas_url = ${sqlString(uploadSummary.combatAtlasUrl)},
        punk_type = ${sqlString(uploadSummary.punkType)},
        accessories_json = ${sqlString(JSON.stringify(uploadSummary.accessories))},
        error_message = NULL,
        generated_at = ${sqlString(nowIso)},
        updated_at = ${sqlString(nowIso)}
      WHERE punk_id = ${job.punkId}
        AND generation_job_id = ${sqlString(job.generationJobId)}
      RETURNING punk_id
    `,
    options
  );

  const row = response[0]?.results?.[0] ?? null;
  if (!row) {
    throw new Error(
      `Lost claim on CryptoPunk ${job.punkId} before marking it ready.`
    );
  }
}

function markJobFailed(job, errorMessage, options) {
  const nowIso = new Date().toISOString();
  d1ExecJson(
    `
      UPDATE cryptopunk_avatar_packs
      SET
        status = 'failed',
        error_message = ${sqlString(errorMessage.slice(0, 2000))},
        updated_at = ${sqlString(nowIso)}
      WHERE punk_id = ${job.punkId}
        AND generation_job_id = ${sqlString(job.generationJobId)}
    `,
    options
  );
}

function runCryptopunkBuild(punkId) {
  try {
    return execFileSync(
      'python3',
      ['gen-avatar/cryptopunk/build-avatar-pack-for-punk-id.py', String(punkId)],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
  } catch (error) {
    throw new Error(formatSubprocessError('CryptoPunk build failed', error));
  }
}

function uploadR2Object(entry, options) {
  const args = wranglerBaseArgs(options).concat([
    'r2',
    'object',
    'put',
    `${options.bucket}/${entry.key}`,
    '--file',
    entry.localPath,
    '--content-type',
    entry.contentType,
    '--cache-control',
    entry.cacheControl,
  ]);

  if (options.remote) {
    args.push('--remote');
  } else {
    args.push('--local');
  }

  try {
    execFileSync(process.execPath, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(
      formatSubprocessError(`R2 upload failed for ${entry.key}`, error)
    );
  }
}

function resolveR2DevPublicUrl(bucket) {
  const args = wranglerBaseArgs({ env: '' }).concat([
    'r2',
    'bucket',
    'dev-url',
    'get',
    bucket,
  ]);

  try {
    const output = execFileSync(process.execPath, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const match = output.match(/https:\/\/[^\s'"]+/);
    return match?.[0] ?? '';
  } catch {
    return '';
  }
}

function d1ExecJson(sql, options) {
  const args = wranglerBaseArgs(options).concat([
    'd1',
    'execute',
    'DB',
    '--json',
    '--yes',
    '--command',
    sql.trim(),
  ]);

  if (options.remote) {
    args.push('--remote');
  } else {
    args.push('--local');
  }

  const raw = execFileSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(raw);
}

function wranglerBaseArgs(options) {
  const wranglerPath = existsSync(LOCAL_WRANGLER_PATH)
    ? LOCAL_WRANGLER_PATH
    : 'node_modules/wrangler/bin/wrangler.js';
  const args = [wranglerPath];
  if (options.env) {
    args.push('--env', options.env);
  }
  return args;
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function sqlString(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildGenerationJobId() {
  return `cryptopunk-job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function joinUrl(...segments) {
  return segments
    .filter(Boolean)
    .map((segment, index) => {
      const value = String(segment);
      if (index === 0) {
        return trimTrailingSlash(value);
      }
      return value.replace(/^\/+|\/+$/g, '');
    })
    .join('/');
}

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/g, '');
}

function sanitizePublicUrl(value) {
  return trimTrailingSlash(
    String(value || '')
      .trim()
      .replace(/^['"]+/, '')
      .replace(/[)'".,]+$/g, '')
  );
}

function normalizePrefix(value) {
  return String(value || DEFAULT_PREFIX)
    .trim()
    .replace(/^\/+|\/+$/g, '');
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string')
    : [];
}

function sanitizeBackHeadInfo(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const source = value;
  const sanitized = {};
  for (const key of [
    'mode',
    'classId',
    'groupId',
    'needsBackFillColor',
    'seedPunkId',
    'sourcePunkId',
    'sharedHumanClassId',
  ]) {
    if (key in source) {
      sanitized[key] = source[key];
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function defaultBucketForEnv(envName) {
  return envName === 'safety'
    ? 'everybodys-platformer-safety-avatars'
    : 'everybodys-platformer-avatars';
}

function formatError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function formatSubprocessError(prefix, error) {
  const pieces = [prefix];
  if (error instanceof Error && error.message) {
    pieces.push(error.message);
  }
  if (typeof error?.stdout === 'string' && error.stdout.trim()) {
    pieces.push(`stdout: ${error.stdout.trim()}`);
  }
  if (typeof error?.stderr === 'string' && error.stderr.trim()) {
    pieces.push(`stderr: ${error.stderr.trim()}`);
  }
  return pieces.join(' | ');
}
