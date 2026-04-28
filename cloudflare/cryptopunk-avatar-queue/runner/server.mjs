import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const repoRoot = process.env.CRYPTOPUNK_REPO_ROOT || '/app/repo';
const outputRoot = path.join(repoRoot, 'gen-avatar', 'cryptopunk', 'generated-avatar-packs');
const buildScript = path.join(repoRoot, 'gen-avatar', 'cryptopunk', 'build-avatar-pack-for-punk-id.py');
const port = Number.parseInt(process.env.PORT || '8080', 10);
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_LOG_BYTES = 1024 * 1024;
const packFiles = [
  ['PlayerSheet.png', 'image/png'],
  ['PlayerSheet.json', 'application/json'],
  ['PlayerCombatActionsSheet.png', 'image/png'],
  ['PlayerCombatActionsSheet.json', 'application/json'],
  ['head.png', 'image/png'],
];

let activeJob = null;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    if (request.method === 'GET' && url.pathname === '/ready') {
      writeJson(response, 200, { ok: true, activeJob });
      return;
    }

    if (request.method !== 'POST' || url.pathname !== '/run') {
      writeJson(response, 404, { ok: false, error: 'Not found.' });
      return;
    }

    if (activeJob !== null) {
      writeJson(response, 409, { ok: false, error: `Container is already processing ${activeJob}.` });
      return;
    }

    const body = parseRunRequest(await readRequestBody(request));
    activeJob = `cryptopunk-${body.punkId}`;
    console.log(`Generating ${activeJob} for ${body.avatarId}...`);

    try {
      const result = await generatePack(body);
      writeJson(response, 200, result);
      console.log(`Generated ${activeJob}.`);
    } finally {
      activeJob = null;
    }
  } catch (error) {
    activeJob = null;
    const message = formatError(error);
    console.error(message);
    writeJson(response, 500, { ok: false, error: message });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`CryptoPunk avatar queue container listening on ${port}.`);
});

async function generatePack(body) {
  const packRoot = path.join(outputRoot, `punk-${body.punkId}`);
  await rm(packRoot, { force: true, recursive: true });
  await mkdir(outputRoot, { recursive: true });

  const { stdout, stderr } = await execFileAsync(
    'python3',
    [buildScript, String(body.punkId)],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CRYPTOPUNK_METADATA_PATH: process.env.CRYPTOPUNK_METADATA_PATH || '/app/assets/fling-punk/punks-metadata.json',
        CRYPTOPUNK_PUNKS_DIR: process.env.CRYPTOPUNK_PUNKS_DIR || '/app/assets/fling-punk/punks',
        PLAYER_SPRITES_SEPARATED_ROOT: process.env.PLAYER_SPRITES_SEPARATED_ROOT || '/app/assets/player/SpritesSeparated',
      },
      maxBuffer: MAX_LOG_BYTES,
    },
  );

  const localManifest = JSON.parse(await readFile(path.join(packRoot, 'manifest.json'), 'utf8'));
  const files = {};
  for (const [name, contentType] of packFiles) {
    const bytes = await readFile(path.join(packRoot, name));
    files[name] = {
      base64: bytes.toString('base64'),
      contentType,
    };
  }

  return {
    ok: true,
    avatarId: body.avatarId,
    punkId: body.punkId,
    localManifest,
    files,
    logs: {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    },
  };
}

function parseRunRequest(rawBody) {
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new Error('Request body must be JSON.');
  }

  const punkId = Number(body?.punkId);
  if (!Number.isInteger(punkId) || punkId < 0 || punkId > 9999) {
    throw new Error('punkId must be an integer from 0 through 9999.');
  }

  const avatarId = String(body?.avatarId || '').trim();
  if (!/^cryptopunk-\d{1,4}$/.test(avatarId)) {
    throw new Error('avatarId must be a cryptopunk avatar id.');
  }

  return { avatarId, punkId };
}

async function readRequestBody(request) {
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;
    if (byteLength > MAX_REQUEST_BYTES) {
      throw new Error('Request body is too large.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(response, statusCode, body) {
  const payload = `${JSON.stringify(body)}\n`;
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function formatError(error) {
  if (error && typeof error === 'object' && 'stderr' in error && error.stderr) {
    return `${error.message}\n${error.stderr}`.trim();
  }
  return error instanceof Error ? error.message : String(error);
}
