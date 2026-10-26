// Hermetic API data for smokes that need a populated world (F480): replay the recorded production
// responses in scripts/fixtures/mobile-smoke-api.json.gz (F089) instead of a live API. An empty
// local stack has no rooms, and the nightly run must never read production.
//
//   SMOKE_API_FIXTURES=off   use whatever API serves the base URL (a seeded local stack or a
//                            dev proxy) instead of the recording.
//
// The recording holds full data for only a few rooms (0,0, -11,-6 and -6,-8), but its world chunk
// summaries list every cell nearby. Any other cell those summaries call published is answered by
// a stand-in: a copy of room -11,-6 under that cell's id, title and version, with no comments,
// ghosts or leaderboard entries. Explore's discover list is built from the same cells
// (smokeDiscoverResponse), so a script can compare the page with the list it was given.
//
// Scripts that route /api/ themselves should call route.fallback(), not route.continue(), so the
// replay still answers. `rewrite` edits each recorded JSON body for one scenario (for example,
// removing a goal); the variant is written to `variantFile`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createApiFixtures } from './apiFixtures.mjs';

const SMOKE_API_FIXTURE = 'scripts/fixtures/mobile-smoke-api.json.gz';
const TEMPLATE_ROOM = '-11%2C-6';
const ROOM_ROUTE = /^\/api\/rooms\/([^/]+)\/(current|published|summary|comments|ghosts)$/;
const LEADERBOARD_ROUTE = /^\/api\/leaderboards\/rooms\/([^/]+)$/;
const PROFILE_ROUTE = /^\/api\/profiles\/([^/]+)\/summary$/;
const DIFFICULTIES = ['easy', 'medium', 'hard'];

export function smokeApiReplayEnabled() {
  return process.env.SMOKE_API_FIXTURES !== 'off';
}

function readRecording(file) {
  return JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
}

/** Installs the replay and the stand-ins on a browser context. Returns the replay, or null when off. */
export async function installSmokeApiReplay(context, { rewrite, variantFile } = {}) {
  if (!smokeApiReplayEnabled()) return null;
  let recorded = readRecording(SMOKE_API_FIXTURE);
  let file = SMOKE_API_FIXTURE;
  if (rewrite) {
    if (!variantFile) throw new Error('A rewritten fixture needs a variantFile path.');
    const entries = recorded.entries.map((entry) => entry.text && entry.contentType.includes('json')
      ? { ...entry, text: JSON.stringify(rewrite(JSON.parse(entry.text), entry)) }
      : entry);
    recorded = { ...recorded, entries };
    mkdirSync(path.dirname(variantFile), { recursive: true });
    writeFileSync(variantFile, gzipSync(JSON.stringify(recorded)));
    file = variantFile;
  }
  const fixtures = createApiFixtures({ mode: 'replay', file });
  await fixtures.install(context);
  await installStandIns(context, recorded);
  return fixtures;
}

function recordedCells(recorded) {
  const cells = new Map();
  for (const entry of recorded.entries) {
    if (entry.path !== '/api/world/chunks/summary' || !entry.text) continue;
    for (const chunk of JSON.parse(entry.text).chunks ?? []) {
      for (const room of chunk.rooms ?? []) cells.set(room.id, room);
    }
  }
  return cells;
}

/** The discover reply the stand-ins serve for a /api/leaderboards/rooms/discover URL. */
export function smokeDiscoverResponse(url, recorded = readRecording(SMOKE_API_FIXTURE)) {
  const params = new URL(url).searchParams;
  const sort = params.get('sort') || 'featured';
  const difficulty = params.get('difficulty');
  const limit = Number(params.get('limit') || 48);
  const includeGoalLess = params.get('includeGoalLessRooms') === '1';
  const standalone = [...recordedCells(recorded).values()]
    .filter((cell) => cell.state === 'published' && !cell.course && Number.isFinite(cell.version))
    .sort((a, b) => a.id.localeCompare(b.id));
  let rows = standalone.map((cell, index) => ({
    roomId: cell.id,
    roomCoordinates: cell.coordinates,
    roomTitle: cell.title,
    builderUserId: cell.creatorUserId,
    builderDisplayName: cell.creatorDisplayName,
    builderLevel: null,
    builderTotalBxp: null,
    roomVersion: cell.version,
    displayRoomVersion: cell.version,
    leaderboardSourceVersion: null,
    canonicalRoomVersion: null,
    goalType: cell.goalType,
    consensusDifficulty: cell.goalType ? DIFFICULTIES[index % DIFFICULTIES.length] : null,
    difficultySource: cell.goalType ? (index % 4 === 0 ? 'measured' : 'votes') : null,
    measuredPlayerCount: index % 4 === 0 ? 3 + (index % 5) : 0,
    recentPlayers: standalone.length - index,
    voteCount: index % 3,
    quality: { adjustedAverage: index % 2 ? 4 : null, rawAverage: index % 2 ? 4 : null, voteCount: index % 2 ? 2 : 0,
      weightedVoteCount: index % 2 ? 2 : 0, counts: { oneStar: 0, twoStar: 0, threeStar: 0, fourStar: index % 2 ? 2 : 0, fiveStar: 0 } },
    trophy: null,
    publishedAt: cell.publishedAt,
    firstPublishedAt: cell.publishedAt,
    featured: index % 2 === 0,
    featuredAt: index % 2 === 0 ? cell.publishedAt : null,
    viewerState: null,
  }));
  if (!(sort === 'newest' && includeGoalLess)) rows = rows.filter((row) => row.goalType);
  if (sort === 'featured') rows = rows.filter((row) => row.featured);
  if (difficulty) rows = rows.filter((row) => row.consensusDifficulty === difficulty);
  if (sort === 'popular') rows.sort((a, b) => b.recentPlayers - a.recentPlayers);
  if (sort === 'quality') rows.sort((a, b) => (b.quality.adjustedAverage ?? 0) - (a.quality.adjustedAverage ?? 0));
  if (sort === 'newest') rows.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  return { difficultyFilter: difficulty, sort, results: rows.slice(0, limit) };
}

async function installStandIns(context, recorded) {
  const recordedPaths = new Set(recorded.entries.map((entry) => `${entry.method} ${entry.path}`));
  const template = (suffix) => JSON.parse(recorded.entries.find((entry) => entry.path === `/api/rooms/${TEMPLATE_ROOM}/${suffix}`).text);
  const baseRoom = template('published');
  const baseSummary = template('summary');
  const baseBoard = JSON.parse(recorded.entries.find((entry) => entry.path === `/api/leaderboards/rooms/${TEMPLATE_ROOM}`).text);
  const cells = recordedCells(recorded);
  const recordedJson = (pathname) => {
    const entry = recorded.entries.find((candidate) => candidate.method === 'GET' && candidate.path === pathname);
    return entry?.status === 200 && entry.text ? JSON.parse(entry.text) : null;
  };
  const standIn = (id) => {
    const cell = cells.get(id);
    if (cell?.state !== 'published' || !Number.isFinite(cell.version)) return null;
    const encoded = encodeURIComponent(id);
    const published = recordedJson(`/api/rooms/${encoded}/published`) ?? {
      ...structuredClone(baseRoom), id, coordinates: cell.coordinates, title: cell.title, version: cell.version,
      goal: cell.goalType ? baseRoom.goal : null, publishedAt: cell.publishedAt, updatedAt: cell.publishedAt,
    };
    const summary = recordedJson(`/api/rooms/${encoded}/summary`) ?? {
      ...baseSummary, id, coordinates: cell.coordinates, draftTitle: cell.title, publishedTitle: cell.title,
      draftVersion: cell.version, publishedVersion: cell.version, claimerUserId: cell.creatorUserId,
      claimerDisplayName: cell.creatorDisplayName, lastPublishedByUserId: cell.publishedByUserId,
      lastPublishedByDisplayName: cell.publishedByDisplayName,
    };
    return { cell, published, summary };
  };
  // An unclaimed frontier cell: the blank draft the Worker returns for a room nobody has built.
  const blankCurrent = (id, coordinates) => {
    const now = new Date().toISOString();
    const emptyLayer = (rows) => rows.map((row) => row.map(() => -1));
    const draft = {
      ...structuredClone(baseRoom), id, coordinates, title: null, goalIntroText: null, cameraMode: 'follow',
      pitsAreDeadly: false, playerHearts: 1, background: 'none', lighting: { mode: 'off', darkness: 80, radius: 50 },
      weather: { mode: 'off', intensity: 50 }, music: null, goal: null, spawnPoint: null,
      tileData: Object.fromEntries(Object.entries(baseRoom.tileData).map(([layer, rows]) => [layer, emptyLayer(rows)])),
      smartTerrain: { version: 2, editingDisabled: false, detailsEnabled: true, semanticCells: {}, recipes: {}, ownedOutputs: {},
        suppressedOutputParts: [], cells: {}, backdropCells: {}, generatedDecorations: {}, generatedBackgroundDecorations: {},
        suppressedDecorationSlots: [] },
      placedObjects: [], customSprites: [], customTiles: [], version: 1, status: 'draft', createdAt: now, updatedAt: now,
      publishedAt: null, tilesetHint: null,
    };
    delete draft.video;
    const summary = { ...baseSummary, id, coordinates, draftTitle: null, publishedTitle: null, draftVersion: 1, publishedVersion: null,
      draftUpdatedAt: now, publishedUpdatedAt: null, claimerUserId: null, claimerPrincipalKind: null, claimerAgentId: null,
      claimerDisplayName: null, claimedAt: null, lastPublishedByUserId: null, lastPublishedByPrincipalKind: null,
      lastPublishedByAgentId: null, lastPublishedByDisplayName: null };
    return { summary, draft, published: null };
  };
  const reply = (route, json) => {
    const origin = route.request().headers().origin;
    return route.fulfill({ json, headers: origin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' } : {} });
  };
  // A chunk window the recording lacks would otherwise get the latest recorded window, whose bounds
  // don't match, and the world stream around Build's random starter cell fails. Assemble the
  // requested window from every recorded chunk instead, leaving unrecorded chunks empty.
  const recordedChunks = new Map();
  const recordedWindows = new Set();
  for (const entry of recorded.entries) {
    if (entry.path !== '/api/world/chunks/summary' || !entry.text) continue;
    const window = JSON.parse(entry.text);
    recordedWindows.add(JSON.stringify(window.chunkBounds));
    for (const chunk of window.chunks ?? []) recordedChunks.set(chunk.id, chunk);
  }
  await context.route((url) => url.pathname === '/api/world/chunks/summary', (route) => {
    const url = new URL(route.request().url());
    const bound = (name) => Number(url.searchParams.get(name) ?? 0);
    const chunkBounds = { minChunkX: bound('minChunkX'), maxChunkX: bound('maxChunkX'), minChunkY: bound('minChunkY'), maxChunkY: bound('maxChunkY') };
    if (route.request().method() !== 'GET' || recordedWindows.has(JSON.stringify(chunkBounds))) return route.fallback();
    const roomBoundsOf = (minX, maxX, minY, maxY) => ({ minX: minX * 8, maxX: (maxX + 1) * 8 - 1, minY: minY * 8, maxY: (maxY + 1) * 8 - 1 });
    const chunks = [];
    for (let y = chunkBounds.minChunkY; y <= chunkBounds.maxChunkY; y += 1) {
      for (let x = chunkBounds.minChunkX; x <= chunkBounds.maxChunkX; x += 1) {
        chunks.push(recordedChunks.get(`${x},${y}`)
          ?? { id: `${x},${y}`, coordinates: { x, y }, roomBounds: roomBoundsOf(x, x, y, y), rooms: [], chunkPreviewHash: 'smoke-empty' });
      }
    }
    return reply(route, { chunkBounds, roomBounds: roomBoundsOf(chunkBounds.minChunkX, chunkBounds.maxChunkX, chunkBounds.minChunkY, chunkBounds.maxChunkY), chunks });
  });
  // Registered after the replay, so these routes run first and fall back to it for recorded paths.
  await context.route((url) => ROOM_ROUTE.test(url.pathname) || LEADERBOARD_ROUTE.test(url.pathname), (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.method() !== 'GET' || recordedPaths.has(`GET ${pathname}`)) return route.fallback();
    if (pathname === '/api/leaderboards/rooms/discover') return reply(route, smokeDiscoverResponse(request.url(), recorded));
    const [, encoded, kind = 'leaderboard'] = ROOM_ROUTE.exec(pathname) ?? LEADERBOARD_ROUTE.exec(pathname);
    const id = decodeURIComponent(encoded);
    if ((kind === 'current' || kind === 'summary') && cells.get(id)?.state === 'frontier') {
      const blank = blankCurrent(id, cells.get(id).coordinates);
      return reply(route, kind === 'current' ? blank : blank.summary);
    }
    const room = standIn(id);
    if (!room) return route.fallback();
    const { cell, published, summary } = room;
    if (kind === 'current') return reply(route, { summary, draft: published, published });
    if (kind === 'published' || kind === 'summary') return reply(route, kind === 'published' ? published : summary);
    if (kind === 'comments') return reply(route, { comments: [], commentArea: null });
    if (kind === 'ghosts') {
      return reply(route, { roomId: cell.id, roomVersion: cell.version, top: { ghost: null, reason: 'no_run' },
        personal: { ghost: null, reason: 'sign_in' } });
    }
    return reply(route, { ...baseBoard, roomId: cell.id, roomCoordinates: cell.coordinates, roomTitle: cell.title,
      roomVersion: cell.version, displayRoomVersion: cell.version, equivalentRoomVersions: [cell.version],
      leaderboardFamilyVersions: [cell.version], currentPublishedVersion: cell.version, versionOptions: [],
      entries: [], viewerBest: null, viewerRank: null });
  });
  // Guest clears: a start binding the client accepts, a finish that reports a completed run as
  // saved, and /mine listing this context's saved clears. Nothing is verified here; the Worker's
  // verification has its own tests.
  const starts = new Map();
  const savedClears = [];
  await context.route((url) => url.pathname === '/api/guest-runs/start' || url.pathname === '/api/guest-runs/mine'
    || /^\/api\/guest-runs\/[^/]+\/finish$/.test(url.pathname), (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === '/api/guest-runs/mine') {
      return request.method() === 'GET' ? reply(route, { totalClears: savedClears.length, clears: savedClears }) : route.fallback();
    }
    if (request.method() !== 'POST') return route.fallback();
    const body = request.postDataJSON() ?? {};
    if (pathname === '/api/guest-runs/start') {
      const binding = { ...body, attemptId: `smoke-${body.clientRunId}`, startedAt: new Date().toISOString(),
        verificationSchemaVersion: 1, verificationNonce: `smoke-${body.clientRunId}`, snapshotHash: 'smoke-fixture' };
      starts.set(binding.attemptId, binding);
      return reply(route, binding);
    }
    const attemptId = decodeURIComponent(pathname.split('/')[3]);
    const start = starts.get(attemptId);
    const saved = body.result === 'completed' && Boolean(start);
    if (saved && !savedClears.some((clear) => clear.attemptId === attemptId)) {
      const cell = cells.get(start.contentId);
      savedClears.push({ attemptId, contentType: start.contentType, contentId: start.contentId, contentTitle: cell?.title ?? null,
        version: start.version, completedAt: body.finishedAt ?? new Date().toISOString(), elapsedMs: body.elapsedMs, deaths: body.deaths });
    }
    return reply(route, { attemptId, result: body.result, verificationStatus: saved ? 'passed' : 'failed',
      verificationReason: saved ? null : 'not_completed', saved });
  });
  // Snapshot batches: an exact recorded batch replays; any other batch is answered per reference
  // from every recorded preview, or from the stand-ins (pinned versions for Expanded Rooms).
  const recordedKeys = new Set(recorded.entries.map((entry) => entry.key));
  const recordedPreviews = new Map();
  for (const entry of recorded.entries) {
    if (entry.path !== '/api/rooms/snapshots/query' || !entry.text) continue;
    for (const result of JSON.parse(entry.text).snapshots ?? []) recordedPreviews.set(result.snapshot.id, result.snapshot);
  }
  await context.route((url) => url.pathname === '/api/rooms/snapshots/query', (route) => {
    const request = route.request();
    if (request.method() !== 'POST' || recordedKeys.has(`POST /api/rooms/snapshots/query ${request.postData()}`)) return route.fallback();
    const snapshots = [], missing = [];
    for (const reference of request.postDataJSON()?.references ?? []) {
      const room = standIn(reference.roomId);
      const snapshot = reference.kind === 'version'
        ? room && { ...room.published, version: reference.version }
        : recordedPreviews.get(reference.roomId) ?? room?.published;
      if (!snapshot) { missing.push(reference); continue; }
      const key = reference.kind === 'version'
        ? `version:${reference.roomId}:${reference.version}`
        : `current:${reference.roomId}:${reference.state}:${reference.updatedAt}`;
      snapshots.push({ key, reference, snapshot });
    }
    return reply(route, { snapshots, missing });
  });
  // Expanded Rooms the chunk summaries list: a published course over the cells that name it,
  // starting in the first cell with a reach-exit goal in the last. Cells replay as stand-ins.
  const courses = new Map();
  for (const cell of cells.values()) {
    if (cell.state !== 'published' || !cell.course?.courseId) continue;
    if (!courses.has(cell.course.courseId)) courses.set(cell.course.courseId, { course: cell.course, cells: [] });
    courses.get(cell.course.courseId).cells.push(cell);
  }
  await context.route((url) => /^\/api\/courses\/[^/]+$/.test(url.pathname), (route) => {
    const request = route.request();
    const courseId = decodeURIComponent(new URL(request.url()).pathname.split('/')[3]);
    const entry = courses.get(courseId);
    if (request.method() !== 'GET' || !entry) return route.fallback();
    const members = [...entry.cells].sort((a, b) => a.coordinates.y - b.coordinates.y || a.coordinates.x - b.coordinates.x);
    const first = members[0], last = members.at(-1);
    const snapshot = {
      id: courseId, title: entry.course.courseTitle, version: 1, status: 'published', playerHearts: 1, pitsAreDeadly: true,
      roomRefs: members.map((cell) => ({ roomId: cell.id, coordinates: cell.coordinates, roomVersion: cell.version, roomTitle: cell.title })),
      startPoint: { roomId: first.id, x: baseRoom.spawnPoint?.x ?? 64, y: baseRoom.spawnPoint?.y ?? 304 },
      goal: { type: 'reach_exit', exit: { roomId: last.id, x: 600, y: 304 }, timeLimitMs: null },
      objectLinks: [], pressurePlateLinks: [],
      createdAt: first.publishedAt, updatedAt: first.publishedAt, publishedAt: first.publishedAt,
    };
    return reply(route, { draft: snapshot, published: snapshot, versions: [], ownerUserId: first.creatorUserId,
      ownerDisplayName: first.creatorDisplayName, permissions: { canSaveDraft: false, canPublish: false, canUnpublish: false },
      expandedRoomCellLimit: 16 });
  });
  // This week's Room Rush with no pick yet, as the Worker answers before a pick is set.
  await context.route((url) => url.pathname === '/api/room-rush/weekly', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const week = (offsetWeeks) => {
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7) + offsetWeeks * 7);
      const end = new Date(start.getTime() + 7 * 86_400_000);
      const thursday = new Date(start.getTime() + 3 * 86_400_000);
      const isoYearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
      const isoWeek = Math.ceil(((thursday.getTime() - isoYearStart) / 86_400_000 + 1) / 7);
      return { weekKey: `UTC-${thursday.getUTCFullYear()}-${String(isoWeek).padStart(2, '0')}`,
        startsAt: start.toISOString(), endsAt: end.toISOString() };
    };
    return reply(route, { period: week(0), pick: null, previousWeek: week(-1), previousWinners: [], difficulty: 'hard',
      timeLimitMs: 300_000, serverTime: new Date().toISOString() });
  });
  // Builder profiles behind room cards, and the world window Build searches for frontier cells.
  const baseProfile = recorded.entries.find((entry) => PROFILE_ROUTE.test(entry.path));
  const builders = new Map([...cells.values()].filter((cell) => cell.creatorUserId)
    .map((cell) => [cell.creatorUserId, cell.creatorDisplayName]));
  await context.route((url) => PROFILE_ROUTE.test(url.pathname) || url.pathname === '/api/world' || url.pathname === '/api/world/chunks', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET' || recordedPaths.has(`GET ${url.pathname}`)) return route.fallback();
    if (url.pathname === '/api/world/chunks') {
      // The legacy chunk window (used after a compact read fails) was never recorded; an empty
      // window keeps the world stream alive so Build's starter room still loads.
      const bound = (name) => Number(url.searchParams.get(name) ?? 0);
      const chunkBounds = { minChunkX: bound('minChunkX'), maxChunkX: bound('maxChunkX'), minChunkY: bound('minChunkY'), maxChunkY: bound('maxChunkY') };
      const roomBounds = { minX: chunkBounds.minChunkX * 8, maxX: (chunkBounds.maxChunkX + 1) * 8 - 1,
        minY: chunkBounds.minChunkY * 8, maxY: (chunkBounds.maxChunkY + 1) * 8 - 1 };
      return reply(route, { chunkBounds, roomBounds, chunks: [] });
    }
    if (url.pathname === '/api/world') {
      const center = { x: Number(url.searchParams.get('centerX') ?? 0), y: Number(url.searchParams.get('centerY') ?? 0) };
      const radius = Number(url.searchParams.get('radius') ?? 1);
      const rooms = [...cells.values()].filter((cell) => Math.abs(cell.coordinates.x - center.x) <= radius
        && Math.abs(cell.coordinates.y - center.y) <= radius);
      return reply(route, { center, radius, rooms });
    }
    const userId = decodeURIComponent(PROFILE_ROUTE.exec(url.pathname)[1]);
    if (!baseProfile?.text || !builders.has(userId)) return route.fallback();
    const displayName = builders.get(userId) ?? 'Builder';
    return reply(route, { ...JSON.parse(baseProfile.text), userId, displayName, username: null, bio: null });
  });
}
