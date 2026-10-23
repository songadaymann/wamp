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
import { appendFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NIGHTLY_GROUPS, SMOKES } from './lib/smokeManifest.mjs';

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
const stopChildren = () => {
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already gone. */ }
  }
};
process.on('SIGINT', () => { stopChildren(); process.exit(130); });
process.on('SIGTERM', () => { stopChildren(); process.exit(143); });

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
  stopChildren();
  writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify({ group: label, results }, null, 2));
  writeSummary(label, results);
}
process.exit(exitCode);

async function startStack() {
  const probe = await fetch(`${STACK}/api/health`).then(() => true, () => false);
  if (probe) throw new Error(`Port ${STACK_PORT} is already in use; the nightly stack needs it`);
  const persistTo = mkdtempSync(path.join(tmpdir(), 'wamp-nightly-d1-'));
  for (const database of ['DB', 'wamp-solo-room-jam-db']) {
    const migrate = spawnSync(process.execPath, [WRANGLER, 'd1', 'migrations', 'apply', database, '--local', '--persist-to', persistTo], {
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
  const child = spawn(process.execPath, [WRANGLER, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(STACK_PORT),
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
    if (await fetch(url).then((response) => response.ok, () => false)) return;
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
  const code = await new Promise((resolve) => child.on('close', resolve));
  clearTimeout(timer);
  await new Promise((resolve) => log.end(resolve));
  const output = readFileSync(path.join(outputDir, logName), 'utf8');
  const known = entry.knownIssue && output.includes(entry.knownIssue.match);
  const status = timedOut ? 'timeout'
    : code === 0 ? (entry.knownIssue ? 'fixed' : 'pass')
    : known ? 'known' : 'fail';
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
  for (const name of NIGHTLY_GROUPS) {
    const file = [path.join(dir, name, 'results.json'), path.join(dir, `nightly-smokes-${name}`, 'results.json')].find(existsSync);
    if (!file) { missing.push(name); continue; }
    for (const row of JSON.parse(readFileSync(file, 'utf8')).results) rows.push({ ...row, group: name });
  }
  // A group can be missing because a manual run picked one group, or because its job failed before
  // the smokes started; that job's own log says which.
  const markdown = summaryMarkdown('Nightly smokes', rows)
    + (missing.length > 0 ? `\nNo results from: ${missing.join(', ')}.\n` : '');
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  return rows.some((row) => row.status === 'fail' || row.status === 'timeout') ? 1 : 0;
}
