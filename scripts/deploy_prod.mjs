import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const pagesOnly = args.has('--pages-only');
const workerOnly = args.has('--worker-only');
const skipSmoke = args.has('--skip-smoke');

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

run('npm', ['run', 'build']);

if (!pagesOnly) {
  runNodeScript(['node_modules/wrangler/bin/wrangler.js', 'deploy']);
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
