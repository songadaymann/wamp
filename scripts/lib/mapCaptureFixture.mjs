import { createServer } from 'vite';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { Readable } from 'node:stream';

/** Real admin read/authorization handlers with fully migrated, disposable SQLite/R2 data. */
export async function createMapCaptureFixture(context, base) {
  const loader = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: false } });
  const { fixture } = await loader.ssrLoadModule('/src/cloudflare/worker/activity/testDatabase.ts');
  const { handleAdminRequest } = await loader.ssrLoadModule('/src/cloudflare/worker/admin/routes.ts');
  const { handleAdminWeeklyRoomRush } = await loader.ssrLoadModule('/src/cloudflare/worker/runs/weeklyRoomRushRoutes.ts');
  const { default: map } = await loader.ssrLoadModule('/src/mapScreenshot/http.ts');
  const f = fixture();
  for (const name of readdirSync('jam-migrations').filter(n => n.endsWith('.sql')).sort()) f.sqlite.exec(readFileSync('jam-migrations/' + name, 'utf8'));
  const key = 'fixture-map-admin-key', png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ioAAAAASUVORK5CYII=', 'base64');
  const files = new Map(['2026_10_19_0.png', '2026_09_19_0.png'].map(name => ['screenshots/' + name, png]));
  const bucket = {
    async list(options = {}) { return { objects: [...files].filter(([name]) => name.startsWith(options.prefix || '')).map(([name, bytes]) => ({ key: name, size: bytes.length, uploaded: new Date('2026-10-19T17:00:00Z') })), truncated: false }; },
    async get(name) { const bytes = files.get(name); if (!bytes) return null; return { key: name, size: bytes.length, body: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }), text: async () => bytes.toString(), arrayBuffer: async () => bytes.slice().buffer }; },
  };
  const state = { key, mode: 'success', calls: 0, pending: null, errors: [], requests: [], expectedAbort: false };
  // Serve the actual attachment stream over HTTP for native browser download checks.
  const galleryServer = createHttpServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url, 'http://gallery.fixture');
    if (url.pathname === '/favicon.ico') { outgoing.writeHead(204); outgoing.end(); return; }
    state.requests.push({ path: url.pathname, method: incoming.method, transport: 'http' });
    try {
      const request = new Request(url, { method: incoming.method, headers: { 'X-WAMP-Public-Base-Path': '/capture' } });
      const response = await map.fetch(request, { SCREENSHOTS: bucket, MAP_SCREENSHOT_ADMIN_BASE_URL: new URL(base).origin });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) { outgoing.end(); return; }
      const stream = Readable.fromWeb(response.body);
      stream.on('error', error => { if (!state.closing) state.errors.push({ path: url.pathname, error: String(error) }); outgoing.destroy(); });
      outgoing.on('close', () => { if (!outgoing.writableFinished) stream.destroy(); }); stream.pipe(outgoing);
    } catch (error) { state.errors.push({ path: url.pathname, error: String(error) }); outgoing.destroy(); }
  });
  await new Promise((resolve, reject) => { galleryServer.once('error', reject); galleryServer.listen(0, '127.0.0.1', resolve); });
  const galleryBase = `http://127.0.0.1:${galleryServer.address().port}`;
  f.env.ADMIN_API_KEY = key;
  f.env.MAP_SCREENSHOTS = { async captureManual() {
    state.calls++; const mode = state.mode;
    if (mode === 'delayed') await new Promise(resolve => { state.pending = resolve; });
    state.pending = null;
    if (mode === 'busy') return { ok: false, busy: true, reason: 'A map capture is already running. Try again shortly.' };
    if (mode === 'failure') return { ok: false, reason: 'Map capture failed. The attempt remains used.' };
    files.set('screenshots/2026_10_19_1.png', png); return { ok: true, fileName: '2026_10_19_1.png' };
  } };
  const tasks = new Set();
  const headers = request => ({ 'access-control-allow-origin': request.headers().origin || new URL(base).origin, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-credentials': 'true' });
  await context.route(url => url.pathname.startsWith('/api/') || (url.origin === new URL(base).origin && (url.pathname === '/capture' || url.pathname.startsWith('/capture/'))), route => {
    const task = (async () => {
      const request = route.request(), url = new URL(request.url()); state.requests.push({ path: url.pathname, method: request.method() });
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: headers(request) });
      let response;
      try {
        const incoming = new Request('https://api.wamp.land' + url.pathname + url.search, { method: request.method(), headers: request.headers(), ...(request.postData() ? { body: request.postData() } : {}) });
        if (url.pathname.startsWith('/capture')) {
          incoming.headers.set('X-WAMP-Public-Base-Path', '/capture');
          response = await map.fetch(incoming, { SCREENSHOTS: bucket, MAP_SCREENSHOT_ADMIN_BASE_URL: new URL(base).origin });
        } else if (url.pathname === '/api/admin/room-rush/weekly') response = await handleAdminWeeklyRoomRush(incoming, new URL(incoming.url), f.env);
        else if (url.pathname.startsWith('/api/admin/')) response = await handleAdminRequest(incoming, new URL(incoming.url), f.env);
        else throw new Error('Unexpected API request: ' + url.pathname);
      } catch (error) {
        state.errors.push({ path: url.pathname, error: String(error) });
        response = new Response(JSON.stringify({ error: String(error) }), { status: error.status || 500 });
      }
      try { await route.fulfill({ status: response.status, headers: { ...Object.fromEntries(response.headers), ...headers(request) }, body: Buffer.from(await response.arrayBuffer()) }); }
      catch (error) { if (!state.closing && !(state.expectedAbort && url.pathname === '/api/admin/map-screenshot/capture')) state.errors.push({ path: url.pathname, error: String(error) }); }
    })();
    tasks.add(task); task.then(() => tasks.delete(task), error => { tasks.delete(task); if (!state.closing) state.errors.push({ error: String(error) }); }); return task;
  });
  return { state, files, galleryBase, async idle() { await Promise.all([...tasks]); }, async close() {
    state.closing = true; state.pending?.(); await Promise.allSettled([...tasks]);
    await new Promise(resolve => { galleryServer.close(resolve); galleryServer.closeAllConnections(); });
    f.sqlite.close(); await loader.close();
  } };
}
