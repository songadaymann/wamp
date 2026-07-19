import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const SAFETY_BASE_URL = 'https://everybodys-platformer-safety.novox-robot.workers.dev';
const PRODUCTION_BASE_URL = 'https://everybodys-platformer.novox-robot.workers.dev';
const ACTIONS = new Set([
  'status',
  'backfill',
  'repair',
  'activate',
  'garbage-collect',
  'deploy-renderer',
]);

export function parseWorldTileCliArgs(argv) {
  const [action, ...args] = argv;
  if (!ACTIONS.has(action)) {
    throw new CliUsageError(
      'Usage: node scripts/world_tiles.mjs '
      + '<status|backfill|repair|activate|garbage-collect|deploy-renderer> '
      + '[--env safety|production] [--confirm-production] [command options]'
    );
  }

  const environment = readArg(args, '--env') ?? 'safety';
  if (environment !== 'safety' && environment !== 'production') {
    throw new CliUsageError('--env must be safety or production.');
  }
  const explicitBaseUrl = readArg(args, '--base-url');
  const baseUrl = (explicitBaseUrl ?? (
    environment === 'safety' ? SAFETY_BASE_URL : PRODUCTION_BASE_URL
  )).replace(/\/+$/, '');
  const productionTarget = environment === 'production' || !isSafetyUrl(baseUrl);
  if (productionTarget && !args.includes('--confirm-production')) {
    throw new CliUsageError(
      'Production world-tile operations require --confirm-production. Use --env safety for safety.'
    );
  }

  const version = readArg(args, '--version');
  const request = buildRequest(action, args, version);
  return {
    action,
    baseUrl,
    environment,
    productionTarget,
    request,
  };
}

export async function runWorldTileCli(argv, options = {}) {
  const parsed = parseWorldTileCliArgs(argv);
  if (parsed.request.kind === 'deploy') {
    const spawnImpl = options.spawnImpl ?? spawnSync;
    const result = spawnImpl('npx', parsed.request.args, { stdio: 'inherit', shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Renderer deployment failed with exit code ${result.status ?? 'unknown'}.`);
    }
    return { ok: true, environment: parsed.environment };
  }
  const adminKey = options.adminKey ?? loadAdminKey();
  if (!adminKey) {
    throw new CliUsageError('Set ADMIN_API_KEY or provide it in .dev.vars.');
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL(parsed.request.path, `${parsed.baseUrl}/`);
  for (const [key, value] of Object.entries(parsed.request.query)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  const response = await fetchImpl(url, {
    method: parsed.request.method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-admin-key': adminKey,
    },
    body: parsed.request.body === null ? undefined : JSON.stringify(parsed.request.body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${parsed.action} failed (${response.status}): ${text}`);
  }
  const result = text ? JSON.parse(text) : null;
  if (options.print !== false) {
    console.log(JSON.stringify(result, null, 2));
  }
  return result;
}

function buildRequest(action, args, version) {
  if (action === 'deploy-renderer') {
    const environment = readArg(args, '--env') ?? 'safety';
    return {
      kind: 'deploy',
      args: [
        'wrangler',
        'deploy',
        '--config',
        'wrangler.world-tile-renderer.jsonc',
        ...(environment === 'safety' ? ['--env', 'safety'] : []),
      ],
    };
  }
  if (action === 'status') {
    return {
      kind: 'api',
      method: 'GET',
      path: '/api/admin/world-tiles/status',
      query: {
        rendererVersion: version,
        verifyObjects: args.includes('--verify-objects') ? '1' : null,
      },
      body: null,
    };
  }
  if (action === 'backfill') {
    return {
      kind: 'api',
      method: 'POST',
      path: '/api/admin/world-tiles/backfill',
      query: {},
      body: {
        version: requireArg(version, '--version'),
        renderOrigin: requireArg(readArg(args, '--render-origin'), '--render-origin'),
        rendererContractHash: requireArg(
          readArg(args, '--renderer-contract-hash'),
          '--renderer-contract-hash'
        ),
        assetContractHash: requireArg(readArg(args, '--asset-contract-hash'), '--asset-contract-hash'),
        immutableRenderOrigin: true,
      },
    };
  }
  if (action === 'repair' || action === 'activate') {
    return {
      kind: 'api',
      method: 'POST',
      path: `/api/admin/world-tiles/${action}`,
      query: {},
      body: { version: requireArg(version, '--version') },
    };
  }

  const apply = args.includes('--apply');
  if (apply && !args.includes('--confirm-delete')) {
    throw new CliUsageError('Garbage-collection deletion requires both --apply and --confirm-delete.');
  }
  const olderThanDays = readOptionalPositiveInteger(args, '--older-than-days');
  if (olderThanDays !== null && olderThanDays < 30) {
    throw new CliUsageError('--older-than-days must be at least 30.');
  }
  return {
    kind: 'api',
    method: 'POST',
    path: '/api/admin/world-tiles/garbage-collect',
    query: {},
    body: {
      dryRun: !apply,
      confirm: apply,
      ...(olderThanDays === null ? {} : { olderThanDays }),
    },
  };
}

function readArg(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1]?.trim() || null : null;
}

function readOptionalPositiveInteger(args, name) {
  const value = readArg(args, name);
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new CliUsageError(`${name} must be a positive safe integer.`);
  }
  return parsed;
}

function requireArg(value, name) {
  if (!value) throw new CliUsageError(`${name} is required.`);
  return value;
}

function isSafetyUrl(value) {
  try {
    return /(^|[.-])safety([.-]|$)/i.test(new URL(value).hostname);
  } catch {
    throw new CliUsageError('--base-url must be a valid URL.');
  }
}

function loadAdminKey() {
  const direct = process.env.ADMIN_API_KEY?.trim();
  if (direct) return direct;
  const path = join(process.cwd(), '.dev.vars');
  if (!existsSync(path)) return null;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^ADMIN_API_KEY=(.*)$/.exec(line.trim());
    if (!match) continue;
    const value = match[1]?.trim() ?? '';
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }
    return value;
  }
  return null;
}

export class CliUsageError extends Error {}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  runWorldTileCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof CliUsageError ? 2 : 1;
  });
}
