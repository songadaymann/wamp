import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchReleaseJson } from './world_tile_release_guard.mjs';

const args = new Set(process.argv.slice(2));
const pagesOnly = args.has('--pages-only');
const workerOnly = args.has('--worker-only');
const skipSmoke = args.has('--skip-smoke');
const rendererArgIndex = process.argv.indexOf('--world-tile-renderer');
const candidateVersion = rendererArgIndex < 0 ? null : process.argv[rendererArgIndex + 1];
if (rendererArgIndex >= 0 && (!candidateVersion || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$/.test(candidateVersion))) {
  throw new Error('A valid --world-tile-renderer version is required.');
}
if (candidateVersion && pagesOnly) {
  throw new Error('A staged renderer requires an API Worker release; use a full or --worker-only deployment.');
}

if (pagesOnly && workerOnly) {
  throw new Error('Choose at most one of --pages-only or --worker-only.');
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(repoRoot);

const headCommit = runAndCapture('git', ['rev-parse', 'HEAD']).trim();

ensureOnCleanMain();
ensureOriginMainMatchesHead();

const commitSubject = runAndCapture('git', ['log', '-1', '--pretty=%s']).trim() || headCommit;

console.log(`Deploying commit ${headCommit.slice(0, 7)} from clean main...`);

run('npm', ['run', 'world-tiles:release:check', ...(candidateVersion ? ['--', '--candidate-renderer', candidateVersion] : [])]);

run('npm', ['run', 'build']);

if (!pagesOnly) {
  runNodeScript(['node_modules/wrangler/bin/wrangler.js', 'deploy']);
  if (candidateVersion) {
    const key = process.env.ADMIN_API_KEY?.trim();
    if (!key) throw new Error('ADMIN_API_KEY is required to activate the verified renderer.');
    const status = await fetchReleaseJson(`https://api.wamp.land/api/admin/world-tiles/status?rendererVersion=${encodeURIComponent(candidateVersion)}`, { headers: { 'X-Admin-Key': key } });
    const renderer = status.statuses?.find(entry => entry.renderer?.version === candidateVersion)?.renderer;
    if (renderer?.status === 'building') {
      await fetchReleaseJson('https://api.wamp.land/api/admin/world-tiles/activate', { method: 'POST', headers: { 'X-Admin-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ version: candidateVersion }) });
    } else if (renderer?.status !== 'active') {
      throw new Error('Verified renderer changed status during release; stop and recheck.');
    }
    // Check uncached public config after activation before publishing any frontend.
    run('npm', ['run', 'world-tiles:release:check']);
  }
}

if (!workerOnly) {
  runNodeScript([
    'node_modules/wrangler/bin/wrangler.js',
    'pages',
    'deploy',
    'dist',
    '--project-name',
    'wampland',
    '--branch',
    'main',
    '--commit-hash',
    headCommit,
    '--commit-message',
    commitSubject,
  ]);
}

if (!skipSmoke) {
  run('node', ['scripts/smoke_prod.mjs']);
}

function ensureOnCleanMain() {
  const branch = runAndCapture('git', ['branch', '--show-current']).trim();
  if (branch !== 'main') {
    throw new Error(`Refusing prod deploy from branch "${branch}". Switch to clean local main first.`);
  }

  const status = runAndCapture('git', ['status', '--porcelain']).trim();
  if (status) {
    throw new Error(
      `Refusing prod deploy from a dirty worktree.\n\n${status}`
    );
  }
}

function ensureOriginMainMatchesHead() {
  run('git', ['fetch', 'origin', 'main', '--quiet']);
  const originMain = runAndCapture('git', ['rev-parse', 'refs/remotes/origin/main']).trim();
  if (originMain !== headCommit) {
    throw new Error(
      [
        'Refusing prod deploy because local HEAD does not match origin/main.',
        `HEAD:        ${headCommit}`,
        `origin/main: ${originMain}`,
        'Push or fast-forward main first so local repo and GitHub stay in sync.',
      ].join('\n')
    );
  }
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    ...options,
  });
}

function runAndCapture(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function runNodeScript(args) {
  run(process.execPath, args);
}
