import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:4175/?previewSmoke=1';
const outputDir = path.resolve('output/web-game/progression-rating-modal');

fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [];

page.on('console', (message) => {
  if (message.type() === 'error') {
    errors.push({ type: 'console.error', text: message.text() });
  }
});
page.on('pageerror', (error) => {
  errors.push({ type: 'pageerror', text: String(error) });
});
page.on('response', (response) => {
  if (response.status() >= 400) {
    errors.push({
      type: 'http',
      status: response.status(),
      url: response.url(),
    });
  }
});
await page.routeWebSocket('ws://127.0.0.1:1999/**', (webSocket) => {
  webSocket.onMessage(() => {
    // Presence transport is unrelated to this modal smoke; keep the socket local and quiet.
  });
});

await page.route('**/api/auth/session', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      authenticated: true,
      source: 'session',
      user: {
        id: 'smoke-user',
        email: 'smoke@example.com',
        walletAddress: null,
        displayName: 'Smoke Player',
        selectedAvatarId: null,
      },
    }),
  });
});

const makeLane = (lane) => ({
  lane,
  xp: 0,
  level: 1,
  currentLevelStartXp: 0,
  nextLevelXp: 100,
  progressFraction: 0,
  medalLabel: 'Starter',
  medalTint: '#79ccde',
  emblem: 'star',
  crown: false,
  ribbons: 0,
});
const smokeProgression = {
  founderNumber: null,
  player: makeLane('player'),
  builder: makeLane('builder'),
  curator: makeLane('curator'),
  builderCaps: {
    trustTier: 'T0',
    claimLimitPerDay: 1,
    publishLimitPerDay: 1,
    objectLimit: 50,
    collectibleLimit: 20,
    expandedRoomCellLimit: 4,
    overrideActive: false,
  },
  featuredBadges: [],
  badgeCount: 0,
  trophyCount: 0,
  recentTrophies: [],
};

await page.route('**/api/settings/me', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ settings: null, updatedAt: null }),
  });
});

await page.route('**/api/profiles/smoke-user', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      userId: 'smoke-user',
      displayName: 'Smoke Player',
      username: null,
      createdAt: '2026-08-20T00:00:00.000Z',
      avatarUrl: null,
      bio: null,
      selectedAvatarId: 'default-player',
      avatarChoices: [],
      isSelf: true,
      canEdit: true,
      stats: {
        totalPoints: 0,
        totalScore: 0,
        totalDeaths: 0,
        totalCollectibles: 0,
        totalEnemiesDefeated: 0,
        totalCheckpoints: 0,
        totalRoomsPublished: 0,
        completedRuns: 2,
        failedRuns: 0,
        abandonedRuns: 0,
        pvpWins: 0,
        pvpLosses: 0,
        pvpDraws: 0,
        bestScore: 0,
        fastestClearMs: null,
        globalRank: null,
      },
      progression: smokeProgression,
      publishedRooms: [],
      playlists: [],
      publishedCourseCount: 0,
    }),
  });
});

await page.route('**/api/presence/identity-token', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      token: 'v1.smoke.smoke',
      expiresAt: '2099-01-01T00:00:00.000Z',
      identity: {
        userId: 'smoke-user',
        displayName: 'Smoke Player',
        avatarId: 'default-player',
      },
      source: 'auth',
    }),
  });
});

await page.route('**/api/leaderboards/rooms/smoke-room-*', async (route) => {
  const requestUrl = new URL(route.request().url());
  const roomId = requestUrl.pathname.split('/').at(-1) ?? 'smoke-room';
  const roomNumber = roomId.endsWith('c') ? 3 : roomId.endsWith('b') ? 2 : 1;
  const roomTitle = roomNumber === 3 ? 'Solo Summit' : roomNumber === 2 ? 'Moonlit Mines' : 'Cloud Castle';
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      roomId,
      roomCoordinates: { x: roomNumber, y: 0 },
      roomTitle,
      roomVersion: 1,
      displayRoomVersion: 1,
      equivalentRoomVersions: [1],
      leaderboardFamilyVersions: [1],
      leaderboardSourceVersion: 1,
      canonicalRoomVersion: 1,
      currentPublishedVersion: 1,
      goalType: 'reach_exit',
      rankingMode: 'time',
      difficulty: {
        consensus: 'medium',
        counts: { easy: 0, medium: 1, hard: 0, extreme: 0 },
        totalVotes: 1,
        viewerVote: null,
        viewerSignedIn: true,
        viewerCanVote: true,
        viewerNeedsRun: false,
      },
      quality: {
        adjustedAverage: 4,
        rawAverage: 4,
        voteCount: 1,
        weightedVoteCount: 1,
        counts: { oneStar: 0, twoStar: 0, threeStar: 0, fourStar: 1, fiveStar: 0 },
      },
      viewerRating: null,
      trophy: null,
      entries: [],
      viewerBest: null,
      viewerRank: null,
    }),
  });
});

await page.route('**/api/rooms/smoke-room-*/ratings', async (route) => {
  const requestUrl = new URL(route.request().url());
  const roomId = requestUrl.pathname.split('/').at(-2) ?? 'smoke-room';
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      roomId,
      roomVersion: 1,
      progressionDelta: { pxp: 0, bxp: 0, cxp: 0, trust: 0 },
      summary: {
        quality: {
          adjustedAverage: 4,
          rawAverage: 4,
          voteCount: 2,
          weightedVoteCount: 2,
          counts: { oneStar: 0, twoStar: 0, threeStar: 0, fourStar: 2, fiveStar: 0 },
        },
        difficulty: {
          consensus: 'hard',
          counts: { easy: 0, medium: 1, hard: 1, extreme: 0 },
          totalVotes: 2,
          viewerVote: 'hard',
          viewerSignedIn: true,
          viewerCanVote: true,
          viewerNeedsRun: false,
        },
        viewerRating: {
          qualityStars: 4,
          difficultyChoice: 'hard',
          autoSuggestedDifficulty: 'hard',
          updatedAt: '2026-08-20T00:00:00.000Z',
        },
        trophy: null,
      },
      progression: smokeProgression,
    }),
  });
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  document.body.dataset.appReady = 'true';
  document.body.dataset.appMode = 'play-world';
  document.getElementById('boot-splash')?.classList.add('hidden');
  document.getElementById('busy-overlay')?.classList.add('hidden');
  document.getElementById('welcome-modal')?.classList.add('hidden');

  const requests = [
    {
      contentType: 'room',
      contentId: 'smoke-room-a',
      contentTitle: 'Cloud Castle',
      roomCoordinates: { x: 1, y: 0 },
      version: 1,
      previousViewerRank: null,
      elapsedMs: 84250,
      deaths: 2,
      score: 320,
      autoSuggestedDifficulty: 'hard',
    },
    {
      contentType: 'room',
      contentId: 'smoke-room-b',
      contentTitle: 'Moonlit Mines',
      roomCoordinates: { x: 2, y: 0 },
      version: 1,
      previousViewerRank: null,
      elapsedMs: 42100,
      deaths: 0,
      score: 500,
      autoSuggestedDifficulty: 'medium',
    },
  ];
  for (const detail of requests) {
    window.dispatchEvent(new CustomEvent('post-run-rating-request', { detail }));
  }
});

const deferredState = await page.evaluate(() => ({
  appMode: document.body.dataset.appMode,
  modalHidden: document.getElementById('run-rating-modal')?.classList.contains('hidden') ?? false,
}));
if (deferredState.appMode !== 'play-world' || !deferredState.modalHidden) {
  throw new Error(`Expected rating prompts to remain hidden during Play: ${JSON.stringify(deferredState)}`);
}

await page.evaluate(() => {
  document.body.dataset.appMode = 'world';
});
await page.waitForSelector('#run-rating-modal:not(.hidden)');
await page.waitForSelector('#run-rating-batch:not(.hidden)');
await page.waitForTimeout(250);

const firstState = await page.evaluate(() => ({
  title: document.getElementById('run-rating-title')?.textContent ?? '',
  batchTitle: document.getElementById('run-rating-batch-title')?.textContent ?? '',
  batchProgress: document.getElementById('run-rating-batch-progress')?.textContent ?? '',
  batchItems: Array.from(document.querySelectorAll('#run-rating-batch-list li')).map((item) => item.textContent ?? ''),
}));
if (
  firstState.title !== 'Cloud Castle'
  || firstState.batchTitle !== 'Rate the rooms you just completed'
  || firstState.batchProgress !== 'Room 1 of 2'
  || firstState.batchItems.length !== 2
) {
  throw new Error(`Unexpected first batch state: ${JSON.stringify(firstState)}`);
}

await page.screenshot({
  path: path.join(outputDir, 'multi-room-rating-1-of-2.png'),
  fullPage: true,
});

await page.click('[data-quality-stars="4"]');
await page.click('#btn-run-rating-submit');
await page.waitForFunction(() => document.getElementById('btn-run-rating-skip')?.textContent === 'Next Room');
const ratedState = await page.evaluate(() => ({
  status: document.getElementById('run-rating-status')?.textContent ?? '',
  nextButton: document.getElementById('btn-run-rating-skip')?.textContent ?? '',
  batchItems: Array.from(document.querySelectorAll('#run-rating-batch-list li')).map((item) => item.textContent ?? ''),
}));
if (!ratedState.status.includes('Rating updated') || !ratedState.batchItems[0]?.includes('Rated')) {
  throw new Error(`Unexpected saved batch state: ${JSON.stringify(ratedState)}`);
}
await page.screenshot({
  path: path.join(outputDir, 'multi-room-rating-1-rated.png'),
  fullPage: true,
});

await page.click('#btn-run-rating-skip');
await page.waitForFunction(() => document.getElementById('run-rating-title')?.textContent === 'Moonlit Mines');
const secondState = await page.evaluate(() => ({
  title: document.getElementById('run-rating-title')?.textContent ?? '',
  batchProgress: document.getElementById('run-rating-batch-progress')?.textContent ?? '',
  batchItems: Array.from(document.querySelectorAll('#run-rating-batch-list li')).map((item) => item.textContent ?? ''),
}));
if (
  secondState.batchProgress !== 'Room 2 of 2'
  || !secondState.batchItems[0]?.includes('Rated')
  || !secondState.batchItems[1]?.includes('Now')
) {
  throw new Error(`Unexpected second batch state: ${JSON.stringify(secondState)}`);
}

await page.screenshot({
  path: path.join(outputDir, 'multi-room-rating-2-of-2.png'),
  fullPage: true,
});

await page.click('#btn-run-rating-close');
await page.evaluate(() => {
  document.body.dataset.appMode = 'play-world';
  window.dispatchEvent(new CustomEvent('post-run-rating-request', {
    detail: {
      contentType: 'room',
      contentId: 'smoke-room-c',
      contentTitle: 'Solo Summit',
      roomCoordinates: { x: 3, y: 0 },
      version: 1,
      previousViewerRank: null,
      elapsedMs: 30100,
      deaths: 1,
      score: 420,
      autoSuggestedDifficulty: 'medium',
    },
  }));
});
const singleDeferred = await page.evaluate(() => (
  document.getElementById('run-rating-modal')?.classList.contains('hidden') ?? false
));
if (!singleDeferred) {
  throw new Error('Expected the single-room prompt to remain hidden during Play.');
}
await page.evaluate(() => {
  document.body.dataset.appMode = 'world';
});
await page.waitForFunction(() => document.getElementById('run-rating-title')?.textContent === 'Solo Summit');
const singleState = await page.evaluate(() => ({
  title: document.getElementById('run-rating-title')?.textContent ?? '',
  batchHidden: document.getElementById('run-rating-batch')?.classList.contains('hidden') ?? false,
}));
if (singleState.title !== 'Solo Summit' || !singleState.batchHidden) {
  throw new Error(`Unexpected single-room state: ${JSON.stringify(singleState)}`);
}
await page.screenshot({
  path: path.join(outputDir, 'single-room-rating.png'),
  fullPage: true,
});

const bodyText = await page.evaluate(() => document.body.innerText);
fs.writeFileSync(path.join(outputDir, 'body.txt'), bodyText);
fs.writeFileSync(path.join(outputDir, 'deferred-state.json'), JSON.stringify(deferredState, null, 2));
fs.writeFileSync(path.join(outputDir, 'first-state.json'), JSON.stringify(firstState, null, 2));
fs.writeFileSync(path.join(outputDir, 'rated-state.json'), JSON.stringify(ratedState, null, 2));
fs.writeFileSync(path.join(outputDir, 'second-state.json'), JSON.stringify(secondState, null, 2));
fs.writeFileSync(path.join(outputDir, 'single-state.json'), JSON.stringify(singleState, null, 2));
fs.writeFileSync(path.join(outputDir, 'errors.json'), JSON.stringify(errors, null, 2));

await browser.close();

console.log(`Wrote progression rating smoke artifacts to ${outputDir}`);
