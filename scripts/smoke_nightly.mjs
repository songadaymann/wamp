// Nightly smokes (F480): the browser smokes and probes the pull-request checks skip, run against a
// fresh local stack. .github/workflows/nightly-smokes.yml runs one group per job; the scripts and
// their groups are listed in scripts/lib/smokeManifest.mjs.
//   npm run smoke:nightly -- --group editor                build, start the stack, run one group
//   npm run smoke:nightly -- --group editor --skip-build   reuse dist-mobile-smoke/
//   npm run smoke:nightly -- --only smoke_police_enemies.mjs --skip-build   one script
//   npm run smoke:nightly -- --list                        every smoke and probe, and where it runs
//   npm run smoke:nightly -- --report output/nightly-smokes   one table from every group's results
// The stack is `wrangler dev --local` on 127.0.0.1:8788 (several smokes forward API calls to that
// port) serving the test-hook build, with a new D1 directory, throwaway secrets and debug sign-in
// links. Nothing leaves the machine. Logs and results.json go to output/nightly-smokes/<group>/.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NIGHTLY_GROUPS, SMOKES } from './lib/smokeManifest.mjs';
import { classifySmokeResult } from './lib/smokeReports.mjs';

const STACK_PORT = 8788;
const VITE_DEV_PORT = Number(process.env.NIGHTLY_VITE_DEV_PORT ?? 4361);
const STACK = `http://127.0.0.1:${STACK_PORT}`;
const VITE_DEV = `http://127.0.0.1:${VITE_DEV_PORT}`;
const BUILD_DIR = 'dist-mobile-smoke';
const OUTPUT_ROOT = 'output/nightly-smokes';
const WRANGLER = 'node_modules/wrangler/bin/wrangler.js';
const VITE = 'node_modules/.bin/vite';
const TSX = 'node_modules/tsx/dist/cli.mjs';
const STATUS_TEXT = {
  pass: 'pass',
  fail: '**FAIL**',
  timeout: '**TIMED OUT**',
  known: 'known issue',
  fixed: 'passes: remove its knownIssue note',
};

const argv = process.argv.slice(2);
const option = (name) => { const index = argv.indexOf(name); return index < 0 ? undefined : argv[index + 1]; };
const nameOf = (entry) => entry.name ?? entry.file;

if (argv.includes('--list')) {
  for (const runs of ['ci', 'nightly', 'deploy', 'manual', 'devtool']) {
    console.log(`\n${runs}`);
    for (const entry of SMOKES.filter((candidate) => candidate.runs === runs)) {
      console.log(`  ${nameOf(entry).padEnd(42)} ${entry.group ? `[${entry.group}] ` : ''}${entry.covers}${entry.why ? ` (${entry.why})` : ''}`);
    }
  }
  process.exit(0);
}

if (option('--report')) {
  process.exit(writeCombinedReport(option('--report')));
}

const group = option('--group');
const only = option('--only');
if (group && !NIGHTLY_GROUPS.includes(group)) throw new Error(`Unknown group ${group}; choose ${NIGHTLY_GROUPS.join(', ')}`);
const entries = SMOKES.filter((entry) => entry.runs === 'nightly'
  && (only ? entry.file === only || entry.name === only : entry.group === group));
if (entries.length === 0) throw new Error('Pass --group <name>, --only <script>, --list or --report <dir>');
const label = group ?? entries[0].group;
const outputDir = path.join(OUTPUT_ROOT, label);
mkdirSync(outputDir, { recursive: true });

const children = [];
const scratchDirs = [];
const stopChildren = async () => {
  await Promise.all(children.filter((child) => child.pid && child.exitCode === null && child.signalCode === null)
    .map((child) => new Promise((resolve) => {
      const timeout = setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already gone. */ }
        resolve();
      }, 5000);
      child.once('close', () => { clearTimeout(timeout); resolve(); });
      try { process.kill(-child.pid, 'SIGTERM'); } catch { clearTimeout(timeout); resolve(); }
    })));
};
const removeScratchDirs = () => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
};
process.on('SIGINT', async () => { await stopChildren(); removeScratchDirs(); process.exit(130); });
process.on('SIGTERM', async () => { await stopChildren(); removeScratchDirs(); process.exit(143); });

const results = [];
let exitCode = 0;
try {
  if (!argv.includes('--skip-build')) {
    console.log(`Building the test-hook frontend into ${BUILD_DIR}/`);
    const build = spawnSync(process.execPath, [VITE, 'build', '--outDir', BUILD_DIR, '--emptyOutDir', '--logLevel', 'error'], {
      stdio: 'inherit',
      env: { ...process.env, VITE_ENABLE_TEST_RESET: '1', VITE_ROOM_API_BASE_URL: '', VITE_PARTYKIT_HOST: '' },
    });
    if (build.status !== 0) throw new Error('Test-hook build failed');
  }
  if (!existsSync(path.join(BUILD_DIR, 'index.html'))) throw new Error(`${BUILD_DIR}/ is missing; run without --skip-build`);

  const stack = await startStack();
  if (entries.some((entry) => entry.server === 'vite-dev')) await startViteDev();

  for (const entry of entries) {
    const result = await runEntry(entry, stack);
    results.push(result);
    console.log(`${result.status.toUpperCase().padEnd(7)} ${nameOf(entry)} (${result.seconds}s)`);
    if (result.status === 'fail' || result.status === 'timeout') exitCode = 1;
  }
} catch (error) {
  console.error(error);
  results.push({ name: 'setup', file: '', status: 'fail', seconds: 0, tail: String(error?.stack ?? error) });
  exitCode = 1;
} finally {
  await stopChildren();
  removeScratchDirs();
  writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify({ group: label, results }, null, 2));
  writeSummary(label, results);
}
process.exit(exitCode);

async function startStack() {
  const probe = await fetch(`${STACK}/api/health`, { signal: AbortSignal.timeout(2000) }).then(() => true, () => false);
  if (probe) throw new Error(`Port ${STACK_PORT} is already in use; the nightly stack needs it`);
  const persistTo = mkdtempSync(path.join(tmpdir(), 'wamp-nightly-d1-'));
  scratchDirs.push(persistTo);
  const configFile = path.resolve(outputDir, 'wrangler.json');
  // Deliberately independent of production bindings, secrets, queues and service connections.
  writeFileSync(configFile, JSON.stringify({
    name: `wamp-nightly-${label}`, main: path.resolve('src/cloudflare/worker.ts'),
    compatibility_date: '2026-03-08', compatibility_flags: ['global_fetch_strictly_public'],
    assets: { directory: path.resolve(BUILD_DIR), binding: 'ASSETS',
      run_worker_first: ['/api/*', '/parties/*'], not_found_handling: 'single-page-application' },
    durable_objects: { bindings: [{ name: 'PRESENCE_ROOMS', class_name: 'PresenceDurableObject' }] },
    migrations: [{ tag: 'presence-v1', new_sqlite_classes: ['PresenceDurableObject'] }],
    d1_databases: [
      { binding: 'DB', database_name: 'wamp-nightly-db', database_id: randomUUID(), migrations_dir: path.resolve('migrations') },
      { binding: 'JAM_DB', database_name: 'wamp-nightly-jam-db', database_id: randomUUID(), migrations_dir: path.resolve('jam-migrations') },
    ],
    vars: { WORLDS_ENABLED: '1', COMPACT_WORLD_READS: '1', PLAYABLE_CONTENT_INDEX_READS: '1', TILED_OVERWORLD_READS: '0', WORLD_TILE_GENERATION_ENABLED: '0', WORLD_MAP_HEALTH_ALERTS_ENABLED: '0',
      RUN_GHOST_COST_ALERTS_ENABLED: '0', ENABLE_SNAPSHOT_ADMIN: '1' },
  }, null, 2));
  for (const database of ['DB', 'JAM_DB']) {
    const migrate = spawnSync(process.execPath, [WRANGLER, 'd1', 'migrations', 'apply', database, '--config', configFile, '--local', '--persist-to', persistTo], {
      encoding: 'utf8', env: wranglerEnv(), maxBuffer: 20 * 1024 * 1024,
    });
    writeFileSync(path.join(outputDir, `migrate-${database}.log`), (migrate.stdout ?? '') + (migrate.stderr ?? ''));
    if (migrate.status !== 0) throw new Error(`D1 migrations failed for ${database}; see ${outputDir}/migrate-${database}.log`);
  }
  // Throwaway values for this run only; the stack listens on loopback and is deleted with the job.
  const adminKey = randomUUID();
  const vars = {
    PARTYKIT_HOST: `127.0.0.1:${STACK_PORT}`,
    AUTH_DEBUG_MAGIC_LINKS: '1',
    ENABLE_TEST_RESET: '1',
    PARTYKIT_IDENTITY_TOKEN_SECRET: randomUUID(),
    ADMIN_API_KEY: adminKey,
  };
  const log = createWriteStream(path.join(outputDir, 'stack.log'));
  const child = spawn(process.execPath, [WRANGLER, 'dev', '--config', configFile, '--local', '--ip', '127.0.0.1', '--port', String(STACK_PORT),
    '--inspector-port', String(STACK_PORT + 551), '--persist-to', persistTo, '--assets', BUILD_DIR,
    '--show-interactive-dev-session=false', ...Object.entries(vars).flatMap(([key, value]) => ['--var', `${key}:${value}`])], {
    detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: wranglerEnv(),
  });
  children.push(child);
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  await waitForUrl(`${STACK}/api/health`, 120_000, child);
  console.log(`Local stack ready at ${STACK} (D1 in ${persistTo})`);
  return { adminKey, persistTo };
}

async function startViteDev() {
  const log = createWriteStream(path.join(outputDir, 'vite-dev.log'));
  const child = spawn(process.execPath, [VITE, '--port', String(VITE_DEV_PORT), '--strictPort', '--host', '127.0.0.1', '--open', 'false'], {
    detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, VITE_ENABLE_TEST_RESET: '1', VITE_ROOM_API_BASE_URL: STACK, VITE_PARTYKIT_HOST: '' },
  });
  children.push(child);
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  await waitForUrl(`${VITE_DEV}/`, 120_000, child);
  console.log(`Vite dev server ready at ${VITE_DEV}`);
}

function wranglerEnv() {
  return { ...process.env, WRANGLER_SEND_METRICS: 'false' };
}

async function waitForUrl(url, timeoutMs, child) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`Server for ${url} exited with ${child.exitCode}`);
    if (await fetch(url, { signal: AbortSignal.timeout(2000) }).then((response) => response.ok, () => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server did not answer at ${url} within ${timeoutMs / 1000}s`);
}

function fill(value, stack) {
  return value.replaceAll('{stack}', STACK).replaceAll('{viteDev}', VITE_DEV)
    .replaceAll('{adminKey}', stack.adminKey).replaceAll('{persistTo}', stack.persistTo);
}

async function runEntry(entry, stack) {
  const script = path.join('scripts', entry.file);
  const args = [...(entry.file.endsWith('.ts') ? [TSX] : []), script, ...(entry.args ?? []).map((arg) => fill(arg, stack))];
  const env = { ...process.env, ...Object.fromEntries(Object.entries(entry.env ?? {}).map(([key, value]) => [key, fill(value, stack)])) };
  const logName = `${nameOf(entry).replace(/[^\w.-]+/g, '_')}.log`;
  const log = createWriteStream(path.join(outputDir, logName));
  const started = Date.now();
  const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let tail = '';
  const keep = (chunk) => { log.write(chunk); tail = (tail + chunk.toString()).slice(-6000); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already gone. */ }
  }, (entry.timeoutMinutes ?? 10) * 60_000);
  const code = await new Promise((resolve) => {
    child.once('error', (error) => { keep(`Could not start ${script}: ${error.message}\n`); resolve(-1); });
    child.once('close', resolve);
  });
  clearTimeout(timer);
  await new Promise((resolve) => log.end(resolve));
  const output = readFileSync(path.join(outputDir, logName), 'utf8');
  const status = classifySmokeResult(code, timedOut, output, entry.knownIssue);
  return { name: nameOf(entry), file: entry.file, status, seconds: Math.round((Date.now() - started) / 1000),
    note: entry.knownIssue?.note, log: logName, tail: status === 'pass' ? '' : tail.split('\n').slice(-40).join('\n') };
}

function summaryMarkdown(title, rows) {
  const counts = Object.fromEntries(Object.keys(STATUS_TEXT).map((status) => [status, rows.filter((row) => row.status === status).length]));
  const lines = [`### ${title}`, '',
    `${counts.pass} passed, ${counts.fail + counts.timeout} failed, ${counts.known} known issues, ${counts.fixed} known issues now passing.`, '',
    '| Script | Group | Result | Time | Note |', '|---|---|---|---|---|'];
  for (const row of rows) {
    lines.push(`| ${row.name} | ${row.group ?? ''} | ${STATUS_TEXT[row.status] ?? row.status} | ${row.seconds}s | ${row.note ?? ''} |`);
  }
  for (const row of rows.filter((candidate) => candidate.status === 'fail' || candidate.status === 'timeout')) {
    lines.push('', `<details><summary>${row.name}: last lines of output</summary>`, '', '```', row.tail.replaceAll('```', "'''"), '```', '', '</details>');
  }
  return `${lines.join('\n')}\n`;
}

function writeSummary(title, rows) {
  const markdown = summaryMarkdown(`Nightly smokes: ${title}`, rows.map((row) => ({ ...row, group: title })));
  writeFileSync(path.join(outputDir, 'summary.md'), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
}

function writeCombinedReport(dir) {
  const rows = [];
  const missing = [];
  const selected = option('--group');
  const expected = !selected || selected === 'all' ? NIGHTLY_GROUPS : [selected];
  if (expected.some((name) => !NIGHTLY_GROUPS.includes(name))) throw new Error('Unknown report group');
  for (const name of expected) {
    const file = [path.join(dir, name, 'results.json'), path.join(dir, `nightly-smokes-${name}`, 'results.json')].find(existsSync);
    if (!file) { missing.push(name); continue; }
    try {
      const result = JSON.parse(readFileSync(file, 'utf8'));
      if (result.group !== name || !Array.isArray(result.results)) throw new Error('Invalid group result');
      const expectedNames = SMOKES.filter((entry) => entry.runs === 'nightly' && entry.group === name).map(nameOf);
      const actualNames = result.results.map((row) => row.name);
      if (new Set(actualNames).size !== actualNames.length
        || expectedNames.some((entry) => !actualNames.includes(entry))
        || result.results.some((row) => !Object.hasOwn(STATUS_TEXT, row.status))) {
        throw new Error('Incomplete or invalid script results');
      }
      for (const row of result.results) rows.push({ ...row, group: name });
    } catch (error) {
      rows.push({ name: `${name} results`, group: name, status: 'fail', seconds: 0, tail: String(error) });
    }
  }
  const markdown = summaryMarkdown('Nightly smokes', rows)
    + (missing.length > 0 ? `\nNo results from: ${missing.join(', ')}.\n` : '');
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  return missing.length > 0 || rows.some((row) => row.status === 'fail' || row.status === 'timeout') ? 1 : 0;
}
