import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const requestedBaseUrl = process.env.WAMP_SMOKE_URL;
const baseUrl = requestedBaseUrl ?? 'http://localhost:4519';
const outputDir = path.resolve('output/web-game/launch-admin-game-jams');
await mkdir(outputDir, { recursive: true });
const localServer = requestedBaseUrl
  ? null
  : spawn('npx', ['vite', '--strictPort', '--port', '4519'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
if (localServer) {
  await waitForServer(baseUrl, localServer);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];

page.on('console', (message) => {
  if (message.type() === 'error') {
    consoleErrors.push(message.text());
  }
});

await page.addInitScript(() => {
  window.sessionStorage.setItem('ep_launch_admin_api_key', 'smoke-admin-key');
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const pathname = new URL(rawUrl, window.location.origin).pathname;
    if (pathname === '/api/admin/game-jams') {
      return new Response(JSON.stringify({
        generatedAt: '2026-07-26T23:30:00.000Z',
        jams: [
          {
            slug: 'solo-room-jam-2026-07',
            registrationCount: 8,
            submissionCount: 3,
            awaitingSubmissionCount: 5,
            participants: [
              {
                registration: {
                  id: 'registration-one',
                  username: 'JamBuilder',
                  email: 'builder@example.com',
                  registeredAt: '2026-07-21T18:00:00.000Z',
                  updatedAt: '2026-07-21T18:00:00.000Z',
                },
                account: {
                  id: 'user-one',
                  displayName: 'Jam Builder',
                  username: 'jambuilder',
                  email: 'account@example.com',
                  walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
                },
                submission: {
                  id: 'submission-one',
                  username: 'JamBuilder',
                  email: 'builder@example.com',
                  roomX: 6,
                  roomY: 12,
                  roomUrl: 'https://wamp.land/r/6/12',
                  submittedAt: '2026-07-26T22:59:12.606Z',
                  updatedAt: '2026-07-26T22:59:12.606Z',
                },
              },
              {
                registration: {
                  id: 'registration-two',
                  username: 'Still Building',
                  email: 'building@example.com',
                  registeredAt: '2026-07-20T13:00:00.000Z',
                  updatedAt: '2026-07-20T13:00:00.000Z',
                },
                account: null,
                submission: null,
              },
            ],
          },
          {
            slug: 'future-team-jam-2027',
            registrationCount: 0,
            submissionCount: 0,
            awaitingSubmissionCount: 0,
            participants: [],
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Not mocked by Game Jam admin smoke.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return nativeFetch(input, init);
  };
});

await page.goto(`${baseUrl}/launch-admin.html#game-jams`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => document.querySelector('#game-jam-status')?.textContent?.includes('2 people'),
);

await expectText(page, '#game-jam-summary .card:nth-child(1) .value', '8');
await expectText(page, '#game-jam-summary .card:nth-child(2) .value', '3');
await expectText(page, '#game-jam-summary .card:nth-child(3) .value', '5');
await expectContains(page, '#game-jam-participants-body', 'Jam Builder');
await expectContains(page, '#game-jam-participants-body', 'builder@example.com');
await expectContains(page, '#game-jam-participants-body', '0x123456…345678');
await expectContains(page, '#game-jam-participants-body', 'Room 6,12');
await expectContains(page, '#game-jam-participants-body', 'Awaiting level');

await page.screenshot({
  path: path.join(outputDir, 'desktop.png'),
  fullPage: true,
});

await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => document.querySelector('#game-jam-status')?.textContent?.includes('2 people'),
);
await page.screenshot({
  path: path.join(outputDir, 'mobile.png'),
  fullPage: true,
});

if (consoleErrors.length > 0) {
  throw new Error(`Unexpected console errors:\n${consoleErrors.join('\n')}`);
}

console.log(JSON.stringify({
  ok: true,
  screenshots: [
    path.join(outputDir, 'desktop.png'),
    path.join(outputDir, 'mobile.png'),
  ],
}));
await browser.close();
localServer?.kill('SIGTERM');

async function expectText(targetPage, selector, expected) {
  const actual = (await targetPage.locator(selector).textContent())?.trim();
  if (actual !== expected) {
    throw new Error(`${selector} expected "${expected}", got "${actual ?? ''}".`);
  }
}

async function expectContains(targetPage, selector, expected) {
  const actual = (await targetPage.locator(selector).textContent()) ?? '';
  if (!actual.includes(expected)) {
    throw new Error(`${selector} should contain "${expected}", got "${actual.trim()}".`);
  }
}

async function waitForServer(url, server) {
  const timeoutAt = Date.now() + 15_000;
  let output = '';
  server.stdout?.on('data', (chunk) => {
    output += String(chunk);
  });
  server.stderr?.on('data', (chunk) => {
    output += String(chunk);
  });
  while (Date.now() < timeoutAt) {
    if (server.exitCode !== null) {
      throw new Error(`Vite exited before the smoke started:\n${output}`);
    }
    try {
      const response = await fetch(`${url}/launch-admin.html`);
      if (response.ok) {
        return;
      }
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  server.kill('SIGTERM');
  throw new Error(`Timed out waiting for Vite:\n${output}`);
}
