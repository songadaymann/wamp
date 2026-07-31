import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STACK_NAME = 'safety-local';
const DEFAULT_FRONTEND_PORT = 3008;
const DEFAULT_API_PORT = 8787;
const DEFAULT_PARTYKIT_PORT = 1999;
const DEFAULT_WORLD_CHUNK_QUERY = 'minChunkX=-1&maxChunkX=1&minChunkY=-1&maxChunkY=1';
const DEFAULT_DEBUG_EMAIL = 'dev-safety-smoke@example.com';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const config = {
  frontendPort: readPortOption(options.frontendPort, 'DEV_SAFETY_FRONTEND_PORT', DEFAULT_FRONTEND_PORT),
  apiPort: readPortOption(options.apiPort, 'DEV_SAFETY_API_PORT', DEFAULT_API_PORT),
  partykitPort: readPortOption(options.partykitPort, 'DEV_SAFETY_PARTYKIT_PORT', DEFAULT_PARTYKIT_PORT),
  worldChunkQuery: process.env.DEV_SAFETY_WORLD_CHUNK_QUERY?.trim() || DEFAULT_WORLD_CHUNK_QUERY,
  debugEmail: process.env.DEV_SAFETY_EMAIL?.trim() || DEFAULT_DEBUG_EMAIL,
};

config.frontendOrigin = `http://127.0.0.1:${config.frontendPort}`;
config.frontendUrl = `${config.frontendOrigin}/?renderer=canvas`;
config.apiOrigin = `http://127.0.0.1:${config.apiPort}`;
config.partykitHost = `127.0.0.1:${config.partykitPort}`;

const startedChildren = [];
let shuttingDown = false;

process.on('SIGINT', () => requestShutdown(0));
process.on('SIGTERM', () => requestShutdown(0));
process.on('exit', () => {
  for (const child of startedChildren) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
});

console.log('Safety local dev stack');
console.log(`- frontend: ${config.frontendUrl}`);
console.log(`- api:      ${config.apiOrigin} (safety D1, debug magic links)`);
console.log(`- partykit: ${config.partykitHost}`);
console.log(`- marker:   ${STACK_NAME}`);

try {
  if (!options.preflightOnly) {
    if (!options.skipMigrations) {
      runForeground('npm', ['run', 'cf:d1:migrate:safety']);
    }

    await ensurePartykit(config);
    await ensureApi(config);
    await ensureFrontend(config);
  }

  await runPreflight(config);

  console.log('');
  console.log('Safety local dev stack ready.');
  console.log(`Open ${config.frontendUrl}`);
  console.log('Debug magic links are verified to stay on localhost.');

  if (options.preflightOnly || startedChildren.length === 0) {
    process.exit(0);
  }

  console.log('Press Ctrl-C to stop the services started by this command.');
  await new Promise(() => {});
} catch (error) {
  console.error('');
  console.error(error instanceof Error ? error.message : String(error));
  if (startedChildren.length > 0) {
    requestShutdown(1);
  } else {
    process.exit(1);
  }
}

async function ensurePartykit(currentConfig) {
  const occupied = await isPortListening(currentConfig.partykitPort);
  if (occupied) {
    console.log(`Partykit port ${currentConfig.partykitPort} is already in use; reusing it and verifying during preflight.`);
    return;
  }

  startService(
    'partykit',
    path.join(repoRoot, 'node_modules/.bin/partykit'),
    [
      'dev',
      '--config',
      'partykit.safety.json',
      '--port',
      String(currentConfig.partykitPort),
      '--no-hotkeys',
    ],
  );
  await waitFor(`Partykit on ${currentConfig.partykitHost}`, () => isPortListening(currentConfig.partykitPort));
}

async function ensureApi(currentConfig) {
  const occupied = await isPortListening(currentConfig.apiPort);
  if (occupied) {
    console.log(`API port ${currentConfig.apiPort} is already in use; reusing it and verifying during preflight.`);
    return;
  }

  startService(
    'worker',
    path.join(repoRoot, 'node_modules/.bin/wrangler'),
    [
      'dev',
      '--env',
      'safety',
      '--remote',
      '--port',
      String(currentConfig.apiPort),
      '--var',
      'AUTH_DEBUG_MAGIC_LINKS:1',
      '--var',
      'ENABLE_TEST_RESET:1',
      '--var',
      `PARTYKIT_HOST:${currentConfig.partykitHost}`,
      '--var',
      'PARTYKIT_PARTY:main',
      '--var',
      `APP_BASE_URL:${currentConfig.frontendOrigin}`,
      '--var',
      `DEV_STACK_NAME:${STACK_NAME}`,
    ],
    {
      AUTH_DEBUG_MAGIC_LINKS: '1',
    },
  );

  await waitFor('safety Worker API health', async () => {
    const health = await fetchJson(`${currentConfig.apiOrigin}/api/health`);
    return health?.ok === true;
  }, 90000);
}

async function ensureFrontend(currentConfig) {
  const occupied = await isPortListening(currentConfig.frontendPort);
  if (occupied) {
    console.log(`Frontend port ${currentConfig.frontendPort} is already in use; reusing it and verifying during preflight.`);
    return;
  }

  startService(
    'vite',
    path.join(repoRoot, 'node_modules/.bin/vite'),
    [
      '--force',
      '--strictPort',
      '--port',
      String(currentConfig.frontendPort),
      '--host',
      '127.0.0.1',
    ],
    {
      VITE_ROOM_API_BASE_URL: '',
      VITE_ROOM_STORAGE_BACKEND: 'remote',
      VITE_PARTYKIT_HOST: currentConfig.partykitHost,
      VITE_PARTYKIT_PARTY: 'main',
      VITE_ENABLE_TEST_RESET: '1',
    },
  );

  await waitFor('Vite frontend', async () => {
    const response = await fetchWithTimeout(`${currentConfig.frontendOrigin}/src/auth/runtimeConfig.ts`);
    return response.ok;
  });
}

async function runPreflight(currentConfig) {
  console.log('');
  console.log('Running safety stack preflight...');

  const health = await fetchJson(`${currentConfig.apiOrigin}/api/health`);
  assert(health?.ok === true, 'Safety API health did not return ok: true.');
  assert(health?.auth?.debugMagicLinks === true, 'Safety API is not running with AUTH_DEBUG_MAGIC_LINKS=1.');
  assert(health?.auth?.testResetEnabled === true, 'Safety API is not running with ENABLE_TEST_RESET=1.');
  assert(
    health?.devStack === STACK_NAME,
    `Safety API is not the standardized local stack. Expected devStack "${STACK_NAME}", got "${String(health?.devStack ?? 'missing')}". Stop the process on the API port and rerun npm run dev:safety.`,
  );

  const runtimeConfig = await fetchText(`${currentConfig.frontendOrigin}/src/auth/runtimeConfig.ts`);
  assert(
    runtimeConfig.includes(`"VITE_ROOM_STORAGE_BACKEND": "remote"`)
      || runtimeConfig.includes('"VITE_ROOM_STORAGE_BACKEND":"remote"'),
    'Frontend is not bundled with VITE_ROOM_STORAGE_BACKEND=remote.',
  );
  assert(
    runtimeConfig.includes(`"VITE_PARTYKIT_HOST": "${currentConfig.partykitHost}"`)
      || runtimeConfig.includes(`"VITE_PARTYKIT_HOST":"${currentConfig.partykitHost}"`),
    `Frontend is not bundled with local PartyKit host ${currentConfig.partykitHost}.`,
  );

  const world = await fetchJson(`${currentConfig.frontendOrigin}/api/world/chunks?${currentConfig.worldChunkQuery}`);
  const chunks = Array.isArray(world?.chunks) ? world.chunks : [];
  const roomCount = chunks.reduce((sum, chunk) => sum + (Array.isArray(chunk.rooms) ? chunk.rooms.length : 0), 0);
  assert(chunks.length > 0, 'Safety D1 world chunk request returned no chunks.');
  assert(roomCount > 0, 'Safety D1 world chunk request returned no rooms.');

  const linkResponse = await fetchJson(`${currentConfig.frontendOrigin}/api/auth/request-link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: currentConfig.debugEmail,
      returnTo: currentConfig.frontendUrl,
    }),
  });
  assert(linkResponse?.delivery === 'debug', 'Magic link request did not use debug delivery.');
  assert(typeof linkResponse?.debugMagicLink === 'string', 'Magic link response did not include debugMagicLink.');

  const debugLink = new URL(linkResponse.debugMagicLink);
  assert(
    debugLink.origin === currentConfig.frontendOrigin,
    `Debug magic link origin is ${debugLink.origin}; expected ${currentConfig.frontendOrigin}.`,
  );

  const verifyResponse = await fetchWithTimeout(debugLink.toString(), { redirect: 'manual' });
  const setCookie = verifyResponse.headers.get('set-cookie') ?? '';
  assert(verifyResponse.status === 302, `Magic link verify returned ${verifyResponse.status}; expected 302.`);
  assert(setCookie.includes('ep_session='), 'Magic link verify did not set an ep_session cookie.');

  const sessionCookie = setCookie.split(';')[0];
  const session = await fetchJson(`${currentConfig.frontendOrigin}/api/auth/session`, {
    headers: { cookie: sessionCookie },
  });
  assert(session?.authenticated === true, 'Session check with the debug cookie did not authenticate.');

  console.log(`- health: debug links on, test reset on, marker ${STACK_NAME}`);
  console.log(`- frontend config: remote room storage, local PartyKit ${currentConfig.partykitHost}`);
  console.log(`- safety D1 world: ${chunks.length} chunks, ${roomCount} rooms`);
  console.log(`- debug login: localhost link verified for ${currentConfig.debugEmail}`);
}

function startService(name, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  startedChildren.push(child);

  child.stdout.on('data', (chunk) => writePrefixedOutput(name, chunk, process.stdout));
  child.stderr.on('data', (chunk) => writePrefixedOutput(name, chunk, process.stderr));
  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }
    const reason = signal ? `signal ${signal}` : `code ${String(code)}`;
    console.error(`${name} exited unexpectedly with ${reason}.`);
    requestShutdown(1);
  });

  return child;
}

function writePrefixedOutput(name, chunk, stream) {
  const text = chunk.toString();
  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) {
      continue;
    }
    stream.write(`[${name}] ${line}\n`);
  }
}

function runForeground(command, args, env = {}) {
  execFileSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
}

async function waitFor(label, probe, timeoutMs = 60000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await probe()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${label}.${suffix}`);
}

function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      resolve(false);
    });
  });
}

async function fetchJson(url, init) {
  const response = await fetchWithTimeout(url, init);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Expected JSON from ${url}, got: ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    throw new Error(`Request failed ${response.status} for ${url}: ${text.slice(0, 300)}`);
  }

  return body;
}

async function fetchText(url, init) {
  const response = await fetchWithTimeout(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Request failed ${response.status} for ${url}: ${text.slice(0, 300)}`);
  }
  return text;
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function requestShutdown(exitCode) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  process.exitCode = exitCode;

  for (const child of [...startedChildren].reverse()) {
    if (!child.killed) {
      child.kill('SIGINT');
    }
  }

  setTimeout(() => {
    for (const child of startedChildren) {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    }
    process.exit(exitCode);
  }, 1500).unref();
}

function parseArgs(args) {
  const parsed = {
    help: false,
    preflightOnly: false,
    skipMigrations: process.env.DEV_SAFETY_SKIP_MIGRATIONS === '1',
    frontendPort: null,
    apiPort: null,
    partykitPort: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--preflight-only') {
      parsed.preflightOnly = true;
    } else if (arg === '--skip-migrations') {
      parsed.skipMigrations = true;
    } else if (arg === '--frontend-port') {
      parsed.frontendPort = args[++index] ?? null;
    } else if (arg.startsWith('--frontend-port=')) {
      parsed.frontendPort = arg.slice('--frontend-port='.length);
    } else if (arg === '--api-port') {
      parsed.apiPort = args[++index] ?? null;
    } else if (arg.startsWith('--api-port=')) {
      parsed.apiPort = arg.slice('--api-port='.length);
    } else if (arg === '--partykit-port') {
      parsed.partykitPort = args[++index] ?? null;
    } else if (arg.startsWith('--partykit-port=')) {
      parsed.partykitPort = arg.slice('--partykit-port='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function readPortOption(optionValue, envName, fallback) {
  const raw = optionValue ?? process.env[envName] ?? String(fallback);
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port for ${envName}: ${raw}`);
  }
  return port;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`
Usage:
  npm run dev:safety
  npm run dev:safety:check

Starts the canonical local test stack:
  - safety remote D1 through wrangler dev on 127.0.0.1:8787
  - debug magic links forced on
  - local PartyKit on 127.0.0.1:1999
  - Vite on 127.0.0.1:3008 with remote room storage

Options:
  --preflight-only       Verify the currently running stack without starting services.
  --skip-migrations      Do not apply safety D1 migrations before startup.
  --frontend-port <n>    Override Vite port. Default: ${DEFAULT_FRONTEND_PORT}.
  --api-port <n>         Override Worker API port. Default: ${DEFAULT_API_PORT}.
  --partykit-port <n>    Override PartyKit port. Default: ${DEFAULT_PARTYKIT_PORT}.

Environment overrides:
  DEV_SAFETY_EMAIL
  DEV_SAFETY_WORLD_CHUNK_QUERY
  DEV_SAFETY_SKIP_MIGRATIONS=1
  DEV_SAFETY_FRONTEND_PORT
  DEV_SAFETY_API_PORT
  DEV_SAFETY_PARTYKIT_PORT
`.trim());
}
