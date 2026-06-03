import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import PartySocket from 'partysocket';

const ROOM_PX_WIDTH = 640;
const ROOM_PX_HEIGHT = 352;
const WORLD_CHUNK_SIZE = 8;
const DEFAULT_HOST = '127.0.0.1:1999';
const DEFAULT_PARTY = 'main';
const DEFAULT_URL = 'http://127.0.0.1:3001/?x=0&y=0';
const DEFAULT_COUNTS = '5,10,20,50';
const DEFAULT_SCENARIOS = 'same-room';
const DEFAULT_DURATION_MS = 12_000;
const DEFAULT_TICK_MS = 200;
const DEFAULT_SPAWN_RATE_MS = 25;

const args = parseArgs(process.argv.slice(2));
const host = getStringArg('host', DEFAULT_HOST);
const party = getStringArg('party', DEFAULT_PARTY);
const protocol = getProtocol(host, getStringArg('protocol', ''));
const identityTokenSecret = getStringArg(
  'identity-token-secret',
  process.env.PARTYKIT_IDENTITY_TOKEN_SECRET || process.env.PARTYKIT_INTERNAL_TOKEN || '',
);
const observerUrl = withPerfParams(getStringArg('url', process.env.PRESENCE_LOAD_URL || DEFAULT_URL));
const originRoom = parseRoomCoordinates(getStringArg('room', '0,0'));
const counts = parseIntegerList(getStringArg('counts', DEFAULT_COUNTS));
const scenarios = parseStringList(getStringArg('scenarios', DEFAULT_SCENARIOS));
const durationMs = getNumberArg('duration-ms', DEFAULT_DURATION_MS, 1000, 120_000);
const tickMs = getNumberArg('tick-ms', DEFAULT_TICK_MS, 80, 2000);
const spawnRateMs = getNumberArg('spawn-rate-ms', DEFAULT_SPAWN_RATE_MS, 0, 1000);
const observerMode = getObserverModeArg(getStringArg('observer-mode', 'play'));
const zoomDuring = getBooleanArg('zoom-during', false);
const zoomEveryMs = getNumberArg('zoom-every-ms', 650, 100, 10_000);
const headless = getBooleanArg('headless', true);
const noObserver = getBooleanArg('no-observer', false);
const screenshot = getBooleanArg('screenshot', true);
const outputDir = path.resolve(
  getStringArg(
    'output-dir',
    path.join('output/web-game/presence-load', new Date().toISOString().replace(/[:.]/g, '-')),
  ),
);

mkdirSync(outputDir, { recursive: true });

const summary = {
  ok: false,
  startedAt: new Date().toISOString(),
  host,
  party,
  protocol,
  identityTokenConfigured: Boolean(identityTokenSecret),
  observerUrl: noObserver ? null : observerUrl,
  originRoom,
  counts,
  scenarios,
  durationMs,
  tickMs,
  spawnRateMs,
  observerMode,
  zoomDuring,
  zoomEveryMs,
  outputDir,
  cases: [],
};

let browser = null;

async function main() {
  try {
    if (!noObserver) {
      browser = await chromium.launch({
        headless,
        args: ['--use-gl=angle', '--use-angle=swiftshader'],
      });
    }

    for (const scenario of scenarios) {
      for (const count of counts) {
        const result = await runPresenceLoadCase({ scenario, count });
        summary.cases.push(result);
        writeSummary();
        console.log(formatCaseLine(result));
      }
    }

    summary.finishedAt = new Date().toISOString();
    summary.ok = summary.cases.every((entry) => entry.ok);
  } catch (error) {
    summary.ok = false;
    summary.error = error instanceof Error ? error.stack || error.message : String(error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
    writeSummary();
  }

  console.log(JSON.stringify({
    ok: summary.ok,
    outputDir,
    cases: summary.cases.map((entry) => ({
      scenario: entry.scenario,
      count: entry.count,
      connectedBots: entry.connectedBots,
      sentMessages: entry.sentMessages,
      approximateFps: entry.observerAfter?.perf?.approximateFps ?? null,
      updateP95Ms: entry.observerAfter?.perf?.updateMs?.p95 ?? null,
      frameDeltaP95Ms: entry.observerAfter?.perf?.frameDeltaMs?.p95 ?? null,
      stutterOver50ms: entry.observerAfter?.perf?.stutterFrames?.over50ms ?? null,
      visibleGhosts: entry.observerAfter?.presence?.visibleGhostCount ?? null,
      renderedGhosts: entry.observerAfter?.presence?.renderedGhostCount ?? null,
      browseDots: entry.observerAfter?.presence?.browseDotCount ?? null,
      editorRooms: entry.observerEditorRooms ?? [],
    })),
  }, null, 2));

  if (!summary.ok) {
    process.exit(1);
  }
  process.exit(0);
}

async function runPresenceLoadCase({ scenario, count }) {
  const caseName = `${scenario}-${count}`;
  const caseDir = path.join(outputDir, sanitizePathSegment(caseName));
  mkdirSync(caseDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const pageErrors = [];
  const consoleErrors = [];
  const ignoredConsoleErrors = [];
  let page = null;
  let context = null;
  let observerBefore = null;
  let observerAfter = null;
  let observerCleanup = null;
  const bots = createBots({ scenario, count });
  let sentMessages = 0;
  let incomingMessages = 0;
  let tickCount = 0;
  let zoomActionCount = 0;

  try {
    if (browser) {
      context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      });
      await context.addInitScript(() => {
        window.localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
        window.localStorage.setItem('wamp_install_help_dismissed_v1', '1');
      });
      page = await context.newPage();
      page.on('console', (message) => {
        if (message.type() === 'error') {
          const text = message.text();
          if (isIgnoredConsoleError(text)) {
            ignoredConsoleErrors.push(text);
          } else {
            consoleErrors.push(text);
          }
        }
      });
      page.on('pageerror', (error) => {
        pageErrors.push(String(error));
      });

      await page.goto(observerUrl, { waitUntil: 'domcontentloaded' });
      await prepareObserverPage(page);
      await setObserverMode(page, observerMode);
      observerBefore = await captureObserver(page, `${caseName}:before`);
      await page.evaluate(() => window.wampMobilePerf?.reset?.());
      if (zoomDuring) {
        await installObserverZoomLoop(page, zoomEveryMs);
      }
    }

    for (const bot of bots) {
      await bot.connect();
      if (spawnRateMs > 0) {
        await sleep(spawnRateMs);
      }
    }

    const started = Date.now();
    let nextTickAt = started;
    while (Date.now() - started < durationMs) {
      const now = Date.now();
      if (now < nextTickAt) {
        await sleep(Math.min(25, nextTickAt - now));
        continue;
      }

      for (const bot of bots) {
        await bot.step(now, tickMs);
        sentMessages += bot.flushSentMessages();
        incomingMessages += bot.flushIncomingMessages();
      }
      tickCount += 1;
      nextTickAt += tickMs;
    }

    if (page) {
      await page.waitForTimeout(600);
      zoomActionCount = zoomDuring
        ? await page.evaluate(() => window.__presenceLoadZoomCount ?? 0).catch(() => 0)
        : 0;
      observerAfter = await captureObserver(page, `${caseName}:after`);
      if (screenshot) {
        const screenshotPath = path.join(caseDir, 'observer-after.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        observerCleanup = { screenshotPath };
      }
    }

    const connectedBots = bots.filter((bot) => bot.connected).length;
    const botErrors = bots.flatMap((bot) => bot.errors);
    const observerEditorRooms = collectPositiveCountEntries(observerAfter?.presenceDebug?.roomEditors);
    return {
      ok: connectedBots === count && pageErrors.length === 0 && consoleErrors.length === 0 && botErrors.length === 0,
      scenario,
      count,
      startedAt,
      finishedAt: new Date().toISOString(),
      connectedBots,
      sentMessages,
      incomingMessages,
      tickCount,
      zoomActionCount,
      observerBefore,
      observerAfter,
      observerEditorRooms,
      observerCleanup,
      pageErrors,
      consoleErrors,
      ignoredConsoleErrors,
      botErrors,
    };
  } finally {
    for (const bot of bots) {
      bot.destroy();
    }
    if (context) {
      await context.close();
    }
  }
}

class PresenceBot {
  constructor({ index, scenario, count }) {
    this.index = index;
    this.scenario = scenario;
    this.count = count;
    this.userId = `guest-load-${scenario.slice(0, 8)}-${index}-${crypto.randomUUID()}`;
    this.displayName = `Bot ${String(index + 1).padStart(2, '0')}`;
    this.avatarId = 'default-player';
    this.state = createInitialBotState(index, count, scenario);
    this.socket = null;
    this.shardId = null;
    this.connected = false;
    this.sentMessages = 0;
    this.incomingMessages = 0;
    this.errors = [];
  }

  async connect() {
    const nextShardId = chunkIdFromRoom(this.state.room);
    if (this.socket && this.shardId === nextShardId && this.connected) {
      return;
    }

    this.destroySocket();
    this.shardId = nextShardId;
    this.connected = false;
    const identityToken = await createPresenceIdentityToken({
      userId: this.userId,
      displayName: this.displayName,
      avatarId: this.avatarId,
    });
    this.socket = new PartySocket({
      host,
      protocol,
      party,
      room: nextShardId,
      id: this.userId,
      query: {
        identityToken,
      },
      maxRetries: 0,
      connectionTimeout: 3000,
    });

    this.socket.addEventListener('message', () => {
      this.incomingMessages += 1;
    });
    this.socket.addEventListener('error', (event) => {
      this.errors.push(`socket error on ${nextShardId}: ${String(event?.message ?? event?.type ?? 'unknown')}`);
    });
    this.socket.addEventListener('close', () => {
      this.connected = false;
    });

    await waitForSocketOpen(this.socket, 5000);
    this.connected = true;
    this.sendPresence();
  }

  async step(now, tickMs) {
    updateBotState(this.state, this.index, this.count, this.scenario, now, tickMs);
    const nextShardId = chunkIdFromRoom(this.state.room);
    if (nextShardId !== this.shardId) {
      this.sendLeave();
      await this.connect();
    }
    this.sendPresence();
  }

  sendPresence() {
    if (!this.socket || this.socket.readyState !== 1) {
      return;
    }

    this.socket.send(JSON.stringify({
      type: 'presence:update',
      presence: buildPresencePayload(this.state),
    }));
    this.sentMessages += 1;
  }

  sendLeave() {
    if (!this.socket || this.socket.readyState !== 1) {
      return;
    }

    this.socket.send(JSON.stringify({ type: 'presence:leave' }));
    this.sentMessages += 1;
  }

  flushSentMessages() {
    const count = this.sentMessages;
    this.sentMessages = 0;
    return count;
  }

  flushIncomingMessages() {
    const count = this.incomingMessages;
    this.incomingMessages = 0;
    return count;
  }

  destroy() {
    this.sendLeave();
    this.destroySocket();
  }

  destroySocket() {
    if (!this.socket) {
      return;
    }

    try {
      this.socket.close(1000, 'presence-load-complete');
    } catch {
      // Best effort cleanup.
    }
    this.socket = null;
    this.connected = false;
  }
}

function createBots({ scenario, count }) {
  return Array.from({ length: count }, (_, index) => new PresenceBot({ index, scenario, count }));
}

function createInitialBotState(index, count, scenario) {
  const room = pickScenarioRoom(index, count, scenario, 0);
  const localSlot = index % 24;
  return {
    room,
    localX: 72 + (localSlot % 8) * 60,
    localY: 282 - Math.floor(localSlot / 8) * 34,
    directionX: index % 2 === 0 ? 1 : -1,
    speed: 56 + (index % 5) * 8,
    nextHopAt: Date.now() + 1800 + (index % 9) * 180,
    hopIndex: 0,
  };
}

function updateBotState(state, index, count, scenario, now, tickMs) {
  const dt = tickMs / 1000;
  if (scenario === 'room-hop' && now >= state.nextHopAt) {
    state.hopIndex += 1;
    state.room = pickScenarioRoom(index, count, scenario, state.hopIndex);
    state.localX = 96 + ((index + state.hopIndex) % 7) * 72;
    state.localY = 272 - ((index + state.hopIndex) % 4) * 32;
    state.directionX = state.hopIndex % 2 === 0 ? 1 : -1;
    state.nextHopAt = now + 1800 + (index % 11) * 120;
    return;
  }

  state.localX += state.directionX * state.speed * dt;
  if (state.localX > ROOM_PX_WIDTH - 48) {
    state.localX = ROOM_PX_WIDTH - 48;
    state.directionX = -1;
  } else if (state.localX < 48) {
    state.localX = 48;
    state.directionX = 1;
  }
}

function pickScenarioRoom(index, count, scenario, hopIndex) {
  switch (scenario) {
    case 'nearby-rooms': {
      const offsets = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
        { x: 1, y: 1 },
        { x: -1, y: 1 },
        { x: 1, y: -1 },
        { x: -1, y: -1 },
      ];
      const offset = offsets[index % offsets.length];
      return { x: originRoom.x + offset.x, y: originRoom.y + offset.y };
    }
    case 'chunk-spread': {
      const chunkOffsets = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
        { x: 1, y: 1 },
        { x: -1, y: 1 },
        { x: 1, y: -1 },
        { x: -1, y: -1 },
      ];
      const offset = chunkOffsets[index % chunkOffsets.length];
      return {
        x: originRoom.x + offset.x * WORLD_CHUNK_SIZE + Math.floor(index / chunkOffsets.length) % 3,
        y: originRoom.y + offset.y * WORLD_CHUNK_SIZE,
      };
    }
    case 'room-hop': {
      const path = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: -1 },
        { x: 0, y: -1 },
        { x: -1, y: -1 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ];
      const offset = path[(index + hopIndex) % path.length];
      return { x: originRoom.x + offset.x, y: originRoom.y + offset.y };
    }
    case 'same-room':
    default:
      return { ...originRoom };
  }
}

function buildPresencePayload(state) {
  return {
    roomCoordinates: { ...state.room },
    x: Math.round(state.room.x * ROOM_PX_WIDTH + state.localX),
    y: Math.round(state.room.y * ROOM_PX_HEIGHT + state.localY),
    velocityX: Math.round(state.directionX * state.speed),
    velocityY: 0,
    facing: state.directionX,
    animationState: 'run',
    mode: 'play',
    timestamp: Date.now(),
  };
}

async function createPresenceIdentityToken(identity) {
  if (!identityTokenSecret) {
    throw new Error(
      'Presence load bots need PARTYKIT_IDENTITY_TOKEN_SECRET or PARTYKIT_INTERNAL_TOKEN to sign PartyKit identities.'
    );
  }

  const now = Date.now();
  const claims = {
    ...identity,
    source: 'guest',
    iat: now,
    exp: now + 5 * 60 * 1000,
    nonce: crypto.randomUUID(),
  };
  const encoder = new TextEncoder();
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const signedValue = `v1.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(identityTokenSecret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signedValue));
  return `${signedValue}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function base64UrlEncode(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

async function prepareObserverPage(page) {
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function', null, {
    timeout: 15_000,
  });
  await page.waitForTimeout(3000);

  const startButton = page.locator('#btn-room-goal-intro-start');
  if (await startButton.count()) {
    await startButton.click({ timeout: 5000 }).catch(() => null);
  }
  await page.waitForTimeout(350);

  const welcomeCloseButton = page.locator('#btn-welcome-close');
  if (await welcomeCloseButton.count()) {
    await welcomeCloseButton.click({ timeout: 5000, force: true }).catch(() => null);
  }

  await page.evaluate(() => {
    const game = window.__EVERYBODYS_PLATFORMER_GAME__;
    const scene = game?.scene?.scenes?.find((candidate) => candidate.scene?.key === 'OverworldPlayScene');
    if (scene && scene.mode !== 'play' && typeof scene.playSelectedRoom === 'function') {
      scene.playSelectedRoom();
    }
  }).catch(() => null);

  await page.waitForTimeout(2000);
}

async function setObserverMode(page, mode) {
  await page.evaluate((targetMode) => {
    const game = window.__EVERYBODYS_PLATFORMER_GAME__;
    const scene = game?.scene?.scenes?.find((candidate) => candidate.scene?.key === 'OverworldPlayScene');
    if (!scene) {
      return;
    }

    if (targetMode === 'browse') {
      if (typeof scene.returnToWorld === 'function') {
        scene.returnToWorld();
      }
      return;
    }

    if (scene.mode !== 'play' && typeof scene.playSelectedRoom === 'function') {
      scene.playSelectedRoom();
    }
  }, mode).catch(() => null);
  await page.waitForFunction((targetMode) => {
    const game = window.__EVERYBODYS_PLATFORMER_GAME__;
    const scene = game?.scene?.scenes?.find((candidate) => candidate.scene?.key === 'OverworldPlayScene');
    return scene?.mode === targetMode;
  }, mode, { timeout: 5000 });
  await page.waitForTimeout(750);
}

async function installObserverZoomLoop(page, intervalMs) {
  await page.evaluate((zoomIntervalMs) => {
    if (window.__presenceLoadZoomTimer) {
      window.clearInterval(window.__presenceLoadZoomTimer);
    }

    window.__presenceLoadZoomCount = 0;
    window.__presenceLoadZoomTimer = window.setInterval(() => {
      const game = window.__EVERYBODYS_PLATFORMER_GAME__;
      const scene = game?.scene?.scenes?.find((candidate) => candidate.scene?.key === 'OverworldPlayScene');
      if (!scene) {
        return;
      }

      const zoomCount = window.__presenceLoadZoomCount ?? 0;
      if (zoomCount % 2 === 0 && typeof scene.zoomOut === 'function') {
        scene.zoomOut();
      } else if (typeof scene.zoomIn === 'function') {
        scene.zoomIn();
      }
      window.__presenceLoadZoomCount = zoomCount + 1;
    }, zoomIntervalMs);
  }, intervalMs).catch(() => null);
}

async function captureObserver(page, reason) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.evaluate((captureReason) => {
        let state = null;
        try {
          const raw = window.render_game_to_text?.();
          state = typeof raw === 'string' ? JSON.parse(raw) : raw ?? null;
        } catch {
          state = null;
        }

        const activeScene = state?.activeScene ?? null;
        let presenceDebug = null;
        try {
          const game = window.__EVERYBODYS_PLATFORMER_GAME__;
          const scene = game?.scene?.scenes?.find((candidate) => candidate.scene?.key === 'OverworldPlayScene');
          const presenceController = scene?.presenceController ?? null;
          if (typeof presenceController?.getDebugSnapshot === 'function') {
            const debug = presenceController.getDebugSnapshot();
            presenceDebug = {
              roomEditors: debug.roomEditors ?? {},
              roomPopulations: debug.roomPopulations ?? {},
              ghostCount: debug.snapshot?.ghosts?.length ?? 0,
            };
          }
        } catch {
          presenceDebug = null;
        }

        return {
          reason: captureReason,
          capturedAt: new Date().toISOString(),
          mode: activeScene?.mode ?? null,
          selected: activeScene?.selected ?? null,
          currentRoom: activeScene?.currentRoom ?? null,
          presence: activeScene?.presence ?? null,
          presenceDebug,
          mobilePerformance: activeScene?.mobilePerformance ?? null,
          perf: window.wampMobilePerf?.get?.(captureReason) ?? null,
        };
      }, reason);
    } catch (error) {
      if (attempt >= 2) {
        throw error;
      }
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => null);
      await page.waitForTimeout(500);
    }
  }

  return null;
}

function chunkIdFromRoom(room) {
  return `${Math.floor(room.x / WORLD_CHUNK_SIZE)},${Math.floor(room.y / WORLD_CHUNK_SIZE)}`;
}

function waitForSocketOpen(socket, timeoutMs) {
  if (socket.readyState === 1) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out connecting to PartyKit room ${socket.roomUrl}`));
    }, timeoutMs);

    const handleOpen = () => {
      cleanup();
      resolve();
    };
    const handleError = (event) => {
      cleanup();
      reject(new Error(`Failed to connect to PartyKit room ${socket.roomUrl}: ${String(event?.message ?? event?.type ?? 'error')}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('error', handleError);
    };

    socket.addEventListener('open', handleOpen);
    socket.addEventListener('error', handleError);
  });
}

function withPerfParams(rawUrl) {
  const url = new URL(rawUrl);
  url.searchParams.set('perf', '1');
  url.searchParams.set('mobilePerfHud', '0');
  url.searchParams.set('mobilePerfLogMs', '30000');
  return url.toString();
}

function getProtocol(rawHost, requestedProtocol) {
  if (requestedProtocol === 'ws' || requestedProtocol === 'wss') {
    return requestedProtocol;
  }

  return isLocalHost(rawHost) ? 'ws' : 'wss';
}

function isLocalHost(rawHost) {
  const hostName = rawHost
    .replace(/^(https?:\/\/|wss?:\/\/)/, '')
    .split(':')[0]
    ?.replace(/^\[|\]$/g, '')
    .toLowerCase();
  return (
    hostName === 'localhost' ||
    hostName === '0.0.0.0' ||
    hostName === '::1' ||
    hostName?.startsWith('127.')
  );
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }

    const equalsIndex = arg.indexOf('=');
    if (equalsIndex !== -1) {
      parsed.set(arg.slice(2, equalsIndex), arg.slice(equalsIndex + 1));
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed.set(key, next);
      index += 1;
    } else {
      parsed.set(key, '1');
    }
  }
  return parsed;
}

function getStringArg(key, fallback) {
  const value = args.get(key);
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function getNumberArg(key, fallback, min, max) {
  const raw = Number(args.get(key));
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, raw));
}

function getBooleanArg(key, fallback) {
  const raw = args.get(key);
  if (raw === undefined) {
    return fallback;
  }
  return raw !== '0' && raw !== 'false' && raw !== 'no';
}

function getObserverModeArg(value) {
  if (value === 'browse' || value === 'play') {
    return value;
  }
  throw new Error(`Expected --observer-mode to be "play" or "browse", got "${value}".`);
}

function isIgnoredConsoleError(text) {
  return text.includes('Failed to poll chat messages TypeError: Failed to fetch');
}

function parseIntegerList(raw) {
  const values = raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0);
  if (values.length === 0) {
    throw new Error(`Expected a comma-separated non-negative integer list, got "${raw}".`);
  }
  return values;
}

function parseStringList(raw) {
  const allowed = new Set(['same-room', 'nearby-rooms', 'chunk-spread', 'room-hop']);
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const value of values) {
    if (!allowed.has(value)) {
      throw new Error(`Unknown scenario "${value}". Expected one of: ${Array.from(allowed).join(', ')}.`);
    }
  }
  if (values.length === 0) {
    throw new Error('At least one scenario is required.');
  }
  return values;
}

function parseRoomCoordinates(raw) {
  const [xRaw, yRaw] = raw.split(',');
  const x = Number(xRaw);
  const y = Number(yRaw);
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error(`Expected --room x,y with integer coordinates, got "${raw}".`);
  }
  return { x, y };
}

function sanitizePathSegment(value) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'case';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectPositiveCountEntries(counts) {
  return Object.entries(counts ?? {})
    .filter(([, count]) => Number(count) > 0)
    .map(([roomId, count]) => ({ roomId, count }));
}

function formatCaseLine(result) {
  const perf = result.observerAfter?.perf ?? null;
  const presence = result.observerAfter?.presence ?? null;
  return [
    `[presence-load] ${result.scenario} count=${result.count}`,
    `ok=${result.ok}`,
    `connected=${result.connectedBots}`,
    `sent=${result.sentMessages}`,
    perf ? `fps=${perf.approximateFps}` : null,
    perf ? `updateP95=${perf.updateMs.p95}ms` : null,
    perf ? `deltaP95=${perf.frameDeltaMs.p95}ms` : null,
    perf ? `stutter50=${perf.stutterFrames.over50ms}` : null,
    presence ? `visibleGhosts=${presence.visibleGhostCount}` : null,
    presence ? `renderedGhosts=${presence.renderedGhostCount}` : null,
    result.observerEditorRooms?.length ? `editorRooms=${result.observerEditorRooms.length}` : null,
  ].filter(Boolean).join(' ');
}

function writeSummary() {
  writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
}

await main();
