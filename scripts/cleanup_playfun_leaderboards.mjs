import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const targetEnv = args.env ?? 'safety';
const baseUrl = args.baseUrl ?? resolveBaseUrl(targetEnv);
const outputDir = join(
  'output',
  'playfun-leaderboard-cleanup',
  `${runId}-${targetEnv}`
);

mkdirSync(outputDir, { recursive: true });

const summary = {
  runId,
  targetEnv,
  baseUrl,
  apply: args.apply,
  startedAt: new Date().toISOString(),
  response: null,
  error: null,
};

main()
  .catch((error) => {
    summary.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  })
  .finally(() => {
    summary.finishedAt = new Date().toISOString();
    writeFileSync(join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  });

async function main() {
  const adminApiKey = args.adminKey ?? loadAdminApiKey();
  const response = await fetch(`${baseUrl}/api/admin/playfun/leaderboard-cleanup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': adminApiKey,
    },
    body: JSON.stringify({
      apply: args.apply,
    }),
  });

  const rawText = await response.text();
  const parsed = rawText ? parseJsonSafely(rawText) : null;
  if (!response.ok) {
    const errorMessage =
      parsed && typeof parsed.error === 'string' && parsed.error.trim()
        ? parsed.error
        : rawText.trim() || `Cleanup request failed with status ${response.status}.`;
    throw new Error(errorMessage);
  }

  summary.response = parsed ?? rawText;
  const payload = parsed ?? {};
  console.log(
    JSON.stringify(
      {
        targetEnv,
        apply: args.apply,
        burnerUserCount: payload.burnerUserCount ?? null,
        roomRunCount: payload.roomRunCount ?? null,
        courseRunCount: payload.courseRunCount ?? null,
        creatorPointEventCount: payload.creatorPointEventCount ?? null,
        affectedUserCount: payload.affectedUserCount ?? null,
        outputDir,
      },
      null,
      2
    )
  );
}

function parseArgs(argv) {
  const parsed = {
    env: null,
    baseUrl: null,
    adminKey: null,
    apply: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      parsed.apply = true;
      continue;
    }
    if (arg === '--env') {
      parsed.env = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--base-url') {
      parsed.baseUrl = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--admin-key') {
      parsed.adminKey = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function resolveBaseUrl(targetEnv) {
  switch ((targetEnv || '').toLowerCase()) {
    case 'prod':
    case 'production':
      return 'https://api.wamp.land';
    case 'safety':
      return 'https://everybodys-platformer-safety.novox-robot.workers.dev';
    case 'local':
      return 'http://127.0.0.1:8787';
    default:
      throw new Error(`Unknown cleanup environment: ${targetEnv}`);
  }
}

function loadAdminApiKey() {
  const configured = process.env.ADMIN_API_KEY?.trim();
  if (configured) {
    return configured;
  }

  for (const fileName of ['.dev.vars', '.env']) {
    const value = loadEnvValue(fileName, 'ADMIN_API_KEY');
    if (value) {
      return value;
    }
  }

  throw new Error('ADMIN_API_KEY is required. Set it in the environment or in .dev.vars.');
}

function loadEnvValue(fileName, key) {
  if (!existsSync(fileName)) {
    return null;
  }

  const content = readFileSync(fileName, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }

    const currentKey = line.slice(0, equalsIndex).trim();
    if (currentKey !== key) {
      continue;
    }

    return line.slice(equalsIndex + 1).trim();
  }

  return null;
}

function parseJsonSafely(rawText) {
  try {
    return JSON.parse(rawText);
  } catch {
    return null;
  }
}
