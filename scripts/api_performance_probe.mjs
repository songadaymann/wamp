const DEFAULT_BASE_URL = 'https://api.wamp.land';
const DEFAULT_RUNS = 10;

const args = new Map();
for (const raw of process.argv.slice(2)) {
  const [key, ...parts] = raw.replace(/^--/, '').split('=');
  args.set(key, parts.join('='));
}

const baseUrl = (args.get('base-url') || process.env.PERF_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
const runs = parsePositiveInteger(args.get('runs') || process.env.PERF_API_RUNS, DEFAULT_RUNS);
const profileUserId = args.get('profile-user-id') || process.env.PERF_PROFILE_USER_ID || null;
const timeoutMs = parsePositiveInteger(args.get('timeout-ms') || process.env.PERF_API_TIMEOUT_MS, 15_000);
const leaderboardRoomId = args.get('leaderboard-room-id') || process.env.PERF_LEADERBOARD_ROOM_ID || '0,0';
const leaderboardRoomX = Number(args.get('leaderboard-room-x') || process.env.PERF_LEADERBOARD_ROOM_X || 0);
const leaderboardRoomY = Number(args.get('leaderboard-room-y') || process.env.PERF_LEADERBOARD_ROOM_Y || 0);

const probes = [
  { name: 'health', path: '/api/health' },
  {
    name: 'newest-rooms-48',
    path: '/api/leaderboards/rooms/discover?sort=newest&limit=48&includeGoalLessRooms=1',
  },
  {
    name: 'featured-rooms-48',
    path: '/api/leaderboards/rooms/discover?sort=featured&limit=48',
  },
  {
    name: 'recent-builders-48',
    path: '/api/leaderboards/builders/discover?sort=recent&limit=48',
  },
  {
    name: 'global-leaderboard-25',
    path: '/api/leaderboards/global?limit=25',
  },
  {
    name: 'room-leaderboard-25',
    path: `/api/leaderboards/rooms/${encodeURIComponent(leaderboardRoomId)}?x=${encodeURIComponent(String(leaderboardRoomX))}&y=${encodeURIComponent(String(leaderboardRoomY))}&limit=25`,
  },
  ...(profileUserId
    ? [
        { name: 'profile-summary', path: `/api/profiles/${encodeURIComponent(profileUserId)}/summary` },
        { name: 'profile-rooms-48', path: `/api/profiles/${encodeURIComponent(profileUserId)}/rooms?limit=48` },
        { name: 'profile-playlists', path: `/api/profiles/${encodeURIComponent(profileUserId)}/playlists` },
        { name: 'profile-compat', path: `/api/profiles/${encodeURIComponent(profileUserId)}` },
      ]
    : []),
];

let failed = false;
for (const probe of probes) {
  const samples = [];
  let responseBytes = 0;
  let serverTiming = '';
  for (let index = 0; index <= runs; index += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = performance.now();
    try {
      const response = await fetch(`${baseUrl}${probe.path}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const body = await response.arrayBuffer();
      const elapsedMs = performance.now() - startedAt;
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      if (index > 0) {
        samples.push(elapsedMs);
      }
      responseBytes = body.byteLength;
      serverTiming = response.headers.get('Server-Timing') || '';
    } catch (error) {
      failed = true;
      console.error(`${probe.name}: ${error instanceof Error ? error.message : String(error)}`);
      break;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (samples.length === 0) {
    continue;
  }
  samples.sort((left, right) => left - right);
  console.log(JSON.stringify({
    probe: probe.name,
    runs: samples.length,
    p50Ms: round(percentile(samples, 0.5)),
    p95Ms: round(percentile(samples, 0.95)),
    minMs: round(samples[0]),
    maxMs: round(samples.at(-1)),
    responseBytes,
    serverTiming,
  }));
}

if (failed) {
  process.exitCode = 1;
}

function percentile(sortedValues, fraction) {
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * fraction) - 1);
  return sortedValues[Math.max(0, index)];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
