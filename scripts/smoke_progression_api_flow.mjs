import fs from 'node:fs';
import path from 'node:path';

const apiBase = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const outputDir = path.resolve('output/web-game/progression-api-flow');
const courseId = '5d16d080-7f72-43f8-99e2-d4e71f1b62d0';

fs.mkdirSync(outputDir, { recursive: true });

const email = `progression-api-smoke-${Date.now()}@example.com`;

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`Expected JSON from ${url}, received: ${text.slice(0, 300)}`);
  }
  return { response, json };
}

function getSessionCookie(setCookieHeader) {
  if (!setCookieHeader) {
    throw new Error('Expected Set-Cookie header from magic link verification.');
  }
  const match = /^([^=]+)=([^;]+)/.exec(setCookieHeader);
  if (!match) {
    throw new Error(`Unable to parse session cookie from: ${setCookieHeader}`);
  }
  return `${match[1]}=${match[2]}`;
}

const requestLink = await fetchJson(`${apiBase}/api/auth/request-link`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email }),
});
const magicLink = requestLink.json?.debugMagicLink;
if (!magicLink) {
  throw new Error(`Expected debug magic link. Response: ${JSON.stringify(requestLink.json)}`);
}

const verifyResponse = await fetch(magicLink, {
  redirect: 'manual',
});
const cookieHeader = getSessionCookie(verifyResponse.headers.get('set-cookie'));

async function authedJson(url, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('cookie', cookieHeader);
  return fetchJson(url, {
    ...init,
    headers,
  });
}

const session = await authedJson(`${apiBase}/api/auth/session`);
if (!session.json?.authenticated || !session.json.user?.id) {
  throw new Error(`Expected authenticated session. Response: ${JSON.stringify(session.json)}`);
}

const courseRecord = await fetchJson(`${apiBase}/api/courses/${encodeURIComponent(courseId)}`);
const courseVersion = courseRecord.json?.published?.version;
const goal = courseRecord.json?.published?.goal;
if (!courseVersion || !goal) {
  throw new Error(`Expected published course version and goal. Response: ${JSON.stringify(courseRecord.json)}`);
}

const runStart = await authedJson(`${apiBase}/api/courses/${encodeURIComponent(courseId)}/runs/start`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    courseId,
    courseVersion,
    goal,
  }),
});
const attemptId = runStart.json?.attemptId;
if (!attemptId) {
  throw new Error(`Expected course attempt id. Response: ${JSON.stringify(runStart.json)}`);
}

const finishResponse = await fetch(`${apiBase}/api/course-runs/${encodeURIComponent(attemptId)}/finish`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    cookie: cookieHeader,
  },
  body: JSON.stringify({
    result: 'completed',
    elapsedMs: 5000,
    deaths: 0,
    collectiblesCollected: 0,
    enemiesDefeated: 0,
    checkpointsReached: 0,
  }),
});
if (finishResponse.status !== 204) {
  const text = await finishResponse.text();
  throw new Error(`Expected 204 from course finish, got ${finishResponse.status}: ${text}`);
}

const userId = session.json.user.id;
const profileBeforeRating = await authedJson(`${apiBase}/api/profiles/${encodeURIComponent(userId)}`);
const playerXpBefore = profileBeforeRating.json?.progression?.player?.xp ?? null;
const curatorXpBefore = profileBeforeRating.json?.progression?.curator?.xp ?? null;

const rating = await authedJson(`${apiBase}/api/courses/${encodeURIComponent(courseId)}/ratings`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    courseVersion,
    qualityStars: 5,
    difficultyChoice: 'hard',
    autoSuggestedDifficulty: 'medium',
  }),
});
if (!rating.json?.ok) {
  throw new Error(`Expected rating success. Response: ${JSON.stringify(rating.json)}`);
}

const profileAfterRating = await authedJson(`${apiBase}/api/profiles/${encodeURIComponent(userId)}`);
const leaderboard = await authedJson(`${apiBase}/api/leaderboards/courses/${encodeURIComponent(courseId)}`);

const playerXpAfter = profileAfterRating.json?.progression?.player?.xp ?? null;
const curatorXpAfter = profileAfterRating.json?.progression?.curator?.xp ?? null;
if (
  typeof playerXpBefore !== 'number' ||
  typeof playerXpAfter !== 'number' ||
  playerXpAfter <= playerXpBefore
) {
  throw new Error(
    `Expected player XP to increase after rating. Before=${playerXpBefore} After=${playerXpAfter}`
  );
}
if (
  typeof curatorXpBefore !== 'number' ||
  typeof curatorXpAfter !== 'number' ||
  curatorXpAfter <= curatorXpBefore
) {
  throw new Error(
    `Expected curator XP to increase after rating. Before=${curatorXpBefore} After=${curatorXpAfter}`
  );
}
if (leaderboard.json?.viewerRating?.qualityStars !== 5) {
  throw new Error(`Expected leaderboard viewer rating to reflect saved quality stars.`);
}

const summary = {
  apiBase,
  email,
  userId,
  courseId,
  courseVersion,
  playerXpBefore,
  playerXpAfter,
  curatorXpBefore,
  curatorXpAfter,
  progressionDelta: rating.json.progressionDelta,
  leaderboard: {
    quality: leaderboard.json?.quality ?? null,
    difficulty: leaderboard.json?.difficulty ?? null,
    viewerRating: leaderboard.json?.viewerRating ?? null,
    viewerRank: leaderboard.json?.viewerRank ?? null,
  },
};

fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));

console.log(`Wrote progression API smoke summary to ${path.join(outputDir, 'summary.json')}`);
console.log(JSON.stringify(summary, null, 2));
