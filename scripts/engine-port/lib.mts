// Shared helpers for the engine-port measurement harness (see scripts/engine-port/README.md).
// Plain JavaScript in a .mts file: the README says why.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Parses --key value and --flag (no value) into an object. Repeated keys keep the last value.
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

// Everything the harness writes goes under output/engine-port/ (output/ is gitignored).
// Override with --out-root DIR or ENGINE_PORT_OUT=DIR.
export function outRoot(args = parseArgs()) {
  const dir = args['out-root'] ?? process.env.ENGINE_PORT_OUT ?? path.join(REPO_ROOT, 'output', 'engine-port');
  return path.resolve(REPO_ROOT, dir);
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Launches the repo's Playwright Chromium. ENGINE_PORT_CHROMIUM points it at another Chromium
// or headless shell binary (for example one installed for a different Playwright version).
export async function launchChromium(options = {}) {
  const { chromium } = await import('playwright');
  const executablePath = process.env.ENGINE_PORT_CHROMIUM || undefined;
  return chromium.launch({ ...options, ...(executablePath ? { executablePath } : {}) });
}

// CPU ms (utime + stime) per Chromium process type, read from /proc. Linux only; {} elsewhere.
export function procTimes() {
  const out = {};
  if (!fs.existsSync('/proc')) return out;
  for (const pid of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (!/chrom/i.test(cmd)) continue;
      const sub = /--utility-sub-type=([\w.]+)/.exec(cmd)?.[1];
      const type = (cmd.match(/--type=([a-z-]+)/)?.[1] ?? 'browser') + (sub ? ':' + sub : '');
      const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
      out[type] = (out[type] ?? 0) + (Number(st[11]) + Number(st[12])) * 10;
    } catch { /* the process exited while we read it */ }
  }
  return out;
}

export function procDelta(before, after) {
  return Object.fromEntries(Object.keys(after).map((k) => [k, after[k] - (before[k] ?? 0)]));
}

export async function isServing(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

export async function waitForServer(url, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await isServing(url)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`nothing answered at ${url} within ${timeoutMs} ms`);
}

export function isMain(importMetaUrl) {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(importMetaUrl);
}
