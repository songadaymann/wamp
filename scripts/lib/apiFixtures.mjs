// Record the API responses a browser smoke needs from production, or replay them so the smoke
// runs in CI without a live API or multiplayer server (F089).
//
//   record: every /api/ GET (and the read-only POSTs below) is fetched from RECORD_ORIGIN and
//           saved; other writes are answered with an empty success and never sent.
//   replay: /api/ requests are answered from the fixture file. A request with no exact match
//           falls back to the latest response recorded for the same method and path.
// In both modes multiplayer sockets are refused, so nothing joins a live room.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

const RECORD_ORIGIN = 'https://api.wamp.land';
const READ_ONLY_POSTS = [/^\/api\/rooms\/snapshots\/query$/];
const VOLATILE_QUERY_PARAMS = new Set(['_', 't', 'ts', 'cacheBust', 'nocache']);
const TEXT_TYPES = /json|text|javascript|xml|svg/;
// The fixture is committed to a public repo: keep players' chat out of it, and keep the smoke
// from finding the live multiplayer server.
const SANITIZERS = new Map([
  ['/api/chat/messages', (chat) => ({ ...chat, messages: [] })],
  ['/api/auth/session', (session) => ({ ...session, partykitHost: '', partykitParty: '' })],
]);

export function createApiFixtures({ mode, file }) {
  if (mode !== 'record' && mode !== 'replay') {
    throw new Error(`API fixture mode must be record or replay, got ${mode}`);
  }
  const entries = new Map();
  if (mode === 'replay') {
    if (!existsSync(file)) throw new Error(`API fixture file missing: ${file}`);
    const stored = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
    for (const entry of stored.entries) entries.set(entry.key, entry);
  }
  const misses = new Map();
  let served = 0;

  async function install(context) {
    await context.routeWebSocket(/.*/, (socket) => socket.close({ code: 1000, reason: 'smoke fixtures' }));
    await context.route(isApiUrl, (route) => (mode === 'record' ? recordRoute(route) : replayRoute(route)));
  }

  async function recordRoute(route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (method !== 'GET' && !READ_ONLY_POSTS.some((pattern) => pattern.test(url.pathname))) {
      return route.fulfill({ status: 200, contentType: 'application/json', headers: corsHeaders(request), body: '{}' });
    }
    try {
      const response = await route.fetch({ url: RECORD_ORIGIN + url.pathname + url.search, maxRedirects: 0 });
      const body = await response.body();
      const contentType = response.headers()['content-type'] ?? 'application/octet-stream';
      const key = fixtureKey(method, url, request.postData());
      const sanitize = SANITIZERS.get(url.pathname);
      const text = TEXT_TYPES.test(contentType) ? body.toString('utf8') : null;
      const stored = sanitize && text !== null ? JSON.stringify(sanitize(JSON.parse(text))) : text;
      entries.set(key, {
        key,
        method,
        path: url.pathname,
        status: response.status(),
        contentType,
        ...(stored !== null ? { text: stored } : { base64: body.toString('base64') }),
      });
      await route.fulfill({ status: response.status(), contentType, headers: corsHeaders(request), body: stored ?? body });
    } catch (error) {
      if (!String(error).includes('Target page, context or browser has been closed')) throw error;
    }
  }

  async function replayRoute(route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(request) });
    const entry = entries.get(fixtureKey(method, url, request.postData())) ?? latestForPath(method, url.pathname);
    if (!entry) {
      if (method !== 'GET' && !READ_ONLY_POSTS.some((pattern) => pattern.test(url.pathname))) {
        served += 1;
        return route.fulfill({ status: 200, contentType: 'application/json', headers: corsHeaders(request), body: '{}' });
      }
      const missKey = `${method} ${url.pathname}`;
      misses.set(missKey, (misses.get(missKey) ?? 0) + 1);
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        headers: corsHeaders(request),
        body: JSON.stringify({ error: 'Not in smoke fixtures.' }),
      });
    }
    served += 1;
    return route.fulfill({
      status: entry.status,
      contentType: entry.contentType,
      headers: corsHeaders(request),
      body: entry.text ?? Buffer.from(entry.base64 ?? '', 'base64'),
    }).catch(() => {});
  }

  function latestForPath(method, pathname) {
    let latest = null;
    for (const entry of entries.values()) if (entry.method === method && entry.path === pathname) latest = entry;
    return latest;
  }

  function save() {
    if (mode !== 'record') return;
    mkdirSync(path.dirname(file), { recursive: true });
    const sorted = [...entries.values()].sort((a, b) => a.key.localeCompare(b.key));
    writeFileSync(file, gzipSync(JSON.stringify({ recordedFrom: RECORD_ORIGIN, recordedAt: new Date().toISOString(), entries: sorted })));
  }

  function report() {
    return { mode, file, entries: entries.size, served, misses: Object.fromEntries(misses) };
  }

  return { install, save, report };
}

function isApiUrl(url) {
  return url.pathname.startsWith('/api/');
}

function fixtureKey(method, url, postData) {
  const params = [...url.searchParams.entries()]
    .filter(([name]) => !VOLATILE_QUERY_PARAMS.has(name))
    .sort(([a], [b]) => a.localeCompare(b));
  const search = new URLSearchParams(params).toString();
  return `${method} ${url.pathname}${search ? `?${search}` : ''}${method === 'GET' || !postData ? '' : ` ${postData}`}`;
}

function corsHeaders(request) {
  const origin = request.headers().origin;
  return origin
    ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' }
    : {};
}
