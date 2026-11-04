// Static server for the bench pages on 127.0.0.1 (default port 5174). The runners start it
// themselves when nothing is listening and stop it when they finish; run it by hand to open the
// pages in another browser (for example a phone, through adb reverse; see README.md).
//
//   node scripts/engine-port/engine-bench/serve.mts [--port 5174] [--out-root DIR]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { isMain, isServing, outRoot, parseArgs } from '../lib.mts';

export function benchPaths(args = parseArgs()) {
  const root = path.join(outRoot(args), 'engine-bench');
  return { root, dist: path.join(root, 'dist'), results: path.join(root, 'results'), port: Number(args.port ?? process.env.ENGINE_BENCH_PORT ?? 5174) };
}

export function startServer(dist, port) {
  const types = { '.html': 'text/html', '.js': 'application/javascript' };
  const server = http.createServer((req, res) => {
    const p = path.join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(dist) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(server)); });
}

// Runs fn(baseUrl) with the bench server up, starting it only if nothing answers on the port.
export async function withBenchServer(args, fn) {
  const { dist, port } = benchPaths(args);
  if (!fs.existsSync(path.join(dist, 'mini.html'))) throw new Error(`no bench build at ${dist}; run engine-bench/build.mts first`);
  const base = `http://127.0.0.1:${port}`;
  const server = (await isServing(`${base}/mini.html`)) ? null : await startServer(dist, port);
  try { return await fn(base); } finally { if (server) { server.closeAllConnections(); await new Promise((r) => server.close(r)); } }
}

if (isMain(import.meta.url)) {
  const { dist, port } = benchPaths();
  await startServer(dist, port);
  console.log(`serving ${dist} on http://127.0.0.1:${port}`);
}
