import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Wallet } from 'ethers';

const BASE_URL =
  process.env.ROLL_OUT_BASE_URL ??
  'http://127.0.0.1:8787';
const PARTYKIT_HOST =
  process.env.ROLL_OUT_PARTYKIT_HOST ??
  '127.0.0.1:1999';
const OUTPUT_DIR = 'output/remote-rollout-check';
const ROOM_IDS = ['0,0', '1,0', '0,1'];
const ROOM_WIDTH = 40;
const ROOM_HEIGHT = 22;
const ALLOW_MUTATIONS = process.env.ROLL_OUT_ALLOW_MUTATIONS === '1';
const BLOCKED_BASE_URL_HOSTS = new Set([
  'api.wamp.land',
  'everybodys-platformer.novox-robot.workers.dev',
]);
const BLOCKED_PARTYKIT_HOSTS = new Set([
  'everybodys-platformer-presence.songadaymann.partykit.dev',
]);

mkdirSync(OUTPUT_DIR, { recursive: true });

const summary = {
  baseUrl: BASE_URL,
  partykitHost: PARTYKIT_HOST,
  startedAt: new Date().toISOString(),
  allowMutations: ALLOW_MUTATIONS,
  worldBefore: null,
  accounts: {},
  api: {},
  partykit: null,
  cleanup: null,
};
const cleanupState = {
  accountA: null,
  accountB: null,
};

function createEmptyLayer() {
  return Array.from({ length: ROOM_HEIGHT }, () =>
    Array.from({ length: ROOM_WIDTH }, () => -1)
  );
}

function createTileData() {
  return {
    background: createEmptyLayer(),
    terrain: createEmptyLayer(),
    foreground: createEmptyLayer(),
  };
}

function createRoomSnapshot(roomId, x, y, title, goal = null) {
  const now = new Date().toISOString();
  return {
    id: roomId,
    coordinates: { x, y },
    title,
    background: 'none',
    goal,
    spawnPoint: null,
    tileData: createTileData(),
    placedObjects: [],
    version: 1,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
  };
}

class SessionClient {
  constructor(label) {
    this.label = label;
    this.cookie = '';
  }

  async request(path, init = {}) {
    const headers = new Headers(init.headers ?? {});
    if (this.cookie) {
      headers.set('Cookie', this.cookie);
    }
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
      redirect: 'manual',
    });

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      this.cookie = setCookie.split(';', 1)[0];
    }

    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }

    return {
      status: response.status,
      ok: response.ok,
      json,
      text,
      headers: Object.fromEntries(response.headers.entries()),
    };
  }
}

async function authenticateWallet(label) {
  const wallet = Wallet.createRandom();
  const client = new SessionClient(label);
  const challenge = await client.request('/api/auth/wallet/challenge', {
    method: 'POST',
    body: JSON.stringify({ address: wallet.address }),
  });
  if (!challenge.ok) {
    throw new Error(`${label} wallet challenge failed: ${challenge.status} ${challenge.text}`);
  }

  const signature = await wallet.signMessage(challenge.json.message);
  const verify = await client.request('/api/auth/wallet/verify', {
    method: 'POST',
    body: JSON.stringify({
      address: wallet.address,
      message: challenge.json.message,
      signature,
    }),
  });
  if (!verify.ok) {
    throw new Error(`${label} wallet verify failed: ${verify.status} ${verify.text}`);
  }

  const session = await client.request('/api/auth/session');
  if (!session.ok || !session.json?.authenticated) {
    throw new Error(`${label} session check failed: ${session.status} ${session.text}`);
  }

  return {
    label,
    wallet,
    client,
    userId: session.json.user.id,
    displayName: session.json.user.displayName,
    session: session.json,
  };
}

async function assertEmptyPublishedWorld() {
  const sqlOutput = d1Exec(
    "select id from rooms where published_json is not null order by id;"
  );
  const jsonStart = sqlOutput.indexOf('[');
  const parsed = JSON.parse(sqlOutput.slice(jsonStart));
  const publishedRooms = parsed[0]?.results?.map((row) => row.id) ?? [];
  if (publishedRooms.length > 0) {
    throw new Error(
      `Remote world already has published rooms (${publishedRooms.join(
        ', '
      )}); aborting automated mutation against populated live data.`
    );
  }

  const response = await fetch(`${BASE_URL}/api/world?centerX=0&centerY=0&radius=2`);
  return response.json();
}

async function testPartyKit() {
  const events = {
    clientA: [],
    clientB: [],
  };

  await new Promise((resolve, reject) => {
    const urlA = `wss://${PARTYKIT_HOST}/parties/main/0,0?_pk=rollout-a&userId=rollout-a&displayName=RolloutA&avatarId=default-player`;
    const urlB = `wss://${PARTYKIT_HOST}/parties/main/0,0?_pk=rollout-b&userId=rollout-b&displayName=RolloutB&avatarId=default-player`;
    const clientA = new WebSocket(urlA);
    const clientB = new WebSocket(urlB);
    let opened = 0;
    let sawUpsert = false;
    let sawPopulation = false;
    const timeout = setTimeout(() => {
      reject(new Error('PartyKit websocket test timed out.'));
    }, 10_000);

    const cleanup = () => {
      clearTimeout(timeout);
      try {
        clientA.close();
      } catch {}
      try {
        clientB.close();
      } catch {}
    };

    const maybeFinish = () => {
      if (opened === 2 && sawUpsert && sawPopulation) {
        cleanup();
        resolve();
      }
    };

    clientA.addEventListener('open', () => {
      opened += 1;
      clientA.send(
        JSON.stringify({
          type: 'presence:update',
          presence: {
            roomCoordinates: { x: 0, y: 0 },
            x: 120,
            y: 240,
            velocityX: 0,
            velocityY: 0,
            facing: 1,
            animationState: 'idle',
            mode: 'play',
            timestamp: Date.now(),
          },
        })
      );
      maybeFinish();
    });

    clientB.addEventListener('open', () => {
      opened += 1;
      clientB.send(
        JSON.stringify({
          type: 'presence:update',
          presence: {
            roomCoordinates: { x: 0, y: 0 },
            x: 180,
            y: 240,
            velocityX: 0,
            velocityY: 0,
            facing: -1,
            animationState: 'run',
            mode: 'play',
            timestamp: Date.now(),
          },
        })
      );
      maybeFinish();
    });

    clientA.addEventListener('message', (event) => {
      const data = JSON.parse(String(event.data));
      events.clientA.push(data.type);
      if (data.type === 'upsert') {
        sawUpsert = true;
      }
      if (data.type === 'populations') {
        sawPopulation = true;
      }
      maybeFinish();
    });

    clientB.addEventListener('message', (event) => {
      const data = JSON.parse(String(event.data));
      events.clientB.push(data.type);
      if (data.type === 'upsert') {
        sawUpsert = true;
      }
      if (data.type === 'populations') {
        sawPopulation = true;
      }
      maybeFinish();
    });

    const onError = () => {
      cleanup();
      reject(new Error('PartyKit websocket connection failed.'));
    };
    clientA.addEventListener('error', onError);
    clientB.addEventListener('error', onError);
  });

  return events;
}

function classifyTargetHost(hostname) {
  const normalized = hostname.trim().toLowerCase();
  if (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '[::1]'
  ) {
    return 'local';
  }

  if (
    normalized.includes('safety') ||
    normalized.includes('staging') ||
    normalized.includes('preview')
  ) {
    return 'non-production';
  }

  return 'unknown';
}

function assertMutationTargetSafety() {
  if (!ALLOW_MUTATIONS) {
    throw new Error(
      'remote_rollout_check mutates backend state. Re-run with ROLL_OUT_ALLOW_MUTATIONS=1 only against local or dedicated safety targets.'
    );
  }

  const baseHost = new URL(BASE_URL).hostname.toLowerCase();
  const partykitHost = PARTYKIT_HOST.replace(/^(https?:\/\/|wss?:\/\/)/, '')
    .replace(/\/.*$/, '')
    .toLowerCase();

  summary.targetChecks = {
    baseHost,
    baseHostClassification: classifyTargetHost(baseHost),
    partykitHost,
    partykitHostClassification: classifyTargetHost(partykitHost),
  };

  if (BLOCKED_BASE_URL_HOSTS.has(baseHost)) {
    throw new Error(
      `Refusing to mutate the known production Worker target ${baseHost}. Use a local or safety backend instead.`
    );
  }

  if (BLOCKED_PARTYKIT_HOSTS.has(partykitHost)) {
    throw new Error(
      `Refusing to mutate the known production PartyKit target ${partykitHost}. Use a local or safety PartyKit project instead.`
    );
  }

  if (
    summary.targetChecks.baseHostClassification === 'unknown' ||
    summary.targetChecks.partykitHostClassification === 'unknown'
  ) {
    throw new Error(
      `Refusing to mutate an unclassified target (${baseHost}, ${partykitHost}). Name safety backends with a clear non-production hostname or use localhost.`
    );
  }
}

function d1Exec(sql) {
  return execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'DB',
      '--remote',
      '--env',
      process.env.ROLL_OUT_WRANGLER_ENV?.trim() || 'safety',
      '--command',
      sql,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
}

function cleanupRemoteData(accountA, accountB) {
  const userIds = [accountA.userId, accountB.userId];
  const addresses = [accountA.wallet.address.toLowerCase(), accountB.wallet.address.toLowerCase()];
  const quotedUserIds = userIds.map((value) => `'${value}'`).join(', ');
  const quotedAddresses = addresses.map((value) => `'${value}'`).join(', ');
  const quotedRoomIds = ROOM_IDS.map((value) => `'${value}'`).join(', ');

  const sql = `
    DELETE FROM point_events WHERE user_id IN (${quotedUserIds});
    DELETE FROM room_runs WHERE user_id IN (${quotedUserIds}) OR room_id IN (${quotedRoomIds});
    DELETE FROM room_versions WHERE published_by_user_id IN (${quotedUserIds}) OR room_id IN (${quotedRoomIds});
    DELETE FROM user_stats WHERE user_id IN (${quotedUserIds});
    DELETE FROM sessions WHERE user_id IN (${quotedUserIds});
    DELETE FROM wallet_challenges WHERE address IN (${quotedAddresses});
    DELETE FROM users WHERE id IN (${quotedUserIds});
    DELETE FROM rooms WHERE id IN ('0,0', '1,0', '0,1');
  `;

  return d1Exec(sql);
}

async function main() {
  assertMutationTargetSafety();
  const worldBefore = await assertEmptyPublishedWorld();
  summary.worldBefore = worldBefore;

  const accountA = await authenticateWallet('accountA');
  const accountB = await authenticateWallet('accountB');
  cleanupState.accountA = accountA;
  cleanupState.accountB = accountB;
  summary.accounts.accountA = {
    userId: accountA.userId,
    walletAddress: accountA.wallet.address,
    displayName: accountA.displayName,
    roomClaimsRemainingToday: accountA.session.roomClaimsRemainingToday,
  };
  summary.accounts.accountB = {
    userId: accountB.userId,
    walletAddress: accountB.wallet.address,
    displayName: accountB.displayName,
    roomClaimsRemainingToday: accountB.session.roomClaimsRemainingToday,
  };

  const roomA = createRoomSnapshot('0,0', 0, 0, 'Remote Rollout Room', {
    type: 'reach_exit',
    exit: { x: 320, y: 240 },
    timeLimitMs: 30000,
  });
  const roomB = createRoomSnapshot('1,0', 1, 0, 'Remote Rollout Frontier', null);

  summary.api.saveDraftA = await accountA.client.request('/api/rooms/0%2C0/draft', {
    method: 'PUT',
    body: JSON.stringify(roomA),
  });
  summary.api.publishA = await accountA.client.request('/api/rooms/0%2C0/publish', {
    method: 'POST',
    body: JSON.stringify(roomA),
  });
  summary.api.loadRoomAAfterPublish = await accountA.client.request('/api/rooms/0%2C0?x=0&y=0');

  const sessionAAfterPublish = await accountA.client.request('/api/auth/session');
  summary.api.sessionAAfterPublish = sessionAAfterPublish;

  summary.api.saveDraftByBOwnersRoomPreMint = await accountB.client.request('/api/rooms/0%2C0/draft', {
    method: 'PUT',
    body: JSON.stringify({
      ...roomA,
      title: 'Remote Rollout Room Edited By B',
    }),
  });

  summary.api.mintPrepareBOnARoom = await accountB.client.request(
    '/api/rooms/0%2C0/mint/prepare?x=0&y=0',
    { method: 'POST' }
  );
  summary.api.mintPrepareA = await accountA.client.request(
    '/api/rooms/0%2C0/mint/prepare?x=0&y=0',
    { method: 'POST' }
  );

  summary.api.publishBFrontier = await accountB.client.request('/api/rooms/1%2C0/publish', {
    method: 'POST',
    body: JSON.stringify(roomB),
  });
  summary.api.publishBSecondClaimSameDay = await accountB.client.request('/api/rooms/0%2C1/publish', {
    method: 'POST',
    body: JSON.stringify(createRoomSnapshot('0,1', 0, 1, 'Should Fail Second Claim', null)),
  });

  const recordA = summary.api.publishA.json;
  const publishedA = recordA?.published ?? null;
  if (!publishedA?.goal) {
    throw new Error('Published room A did not have a goal; cannot test runs.');
  }

  summary.api.runStartA = await accountA.client.request('/api/runs/start', {
    method: 'POST',
    body: JSON.stringify({
      roomId: publishedA.id,
      roomCoordinates: publishedA.coordinates,
      roomVersion: publishedA.version,
      goal: publishedA.goal,
    }),
  });

  const attemptId = summary.api.runStartA.json?.attemptId;
  if (!attemptId) {
    throw new Error(`Run start failed: ${summary.api.runStartA.status} ${summary.api.runStartA.text}`);
  }

  summary.api.runFinishA = await accountA.client.request(
    `/api/runs/${encodeURIComponent(attemptId)}/finish`,
    {
      method: 'POST',
      body: JSON.stringify({
        result: 'completed',
        elapsedMs: 5000,
        deaths: 0,
        collectiblesCollected: 0,
        enemiesDefeated: 0,
        checkpointsReached: 0,
      }),
    }
  );

  summary.api.roomLeaderboardA = await accountA.client.request(
    '/api/leaderboards/rooms/0%2C0?x=0&y=0&limit=10'
  );
  summary.api.globalLeaderboardA = await accountA.client.request('/api/leaderboards/global?limit=10');
  summary.api.globalLeaderboardB = await accountB.client.request('/api/leaderboards/global?limit=10');

  summary.partykit = await testPartyKit();

  summary.cleanup = cleanupRemoteData(accountA, accountB);
  summary.finishedAt = new Date().toISOString();
}

main()
  .catch((error) => {
    summary.error = error instanceof Error ? error.message : String(error);
    summary.failedAt = new Date().toISOString();
  })
  .finally(() => {
    if (cleanupState.accountA && cleanupState.accountB) {
      try {
        summary.cleanup = cleanupRemoteData(cleanupState.accountA, cleanupState.accountB);
      } catch (error) {
        summary.cleanupError = error instanceof Error ? error.message : String(error);
      }
    }

    const summaryPath = `${OUTPUT_DIR}/summary.json`;
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(summaryPath);
    if (summary.error) {
      console.error(summary.error);
      process.exit(1);
    }
  });
