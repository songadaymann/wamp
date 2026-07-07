import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SAFETY_API_BASE_URL =
  process.env.SAFETY_API_BASE_URL?.trim()
  || 'https://everybodys-platformer-safety.novox-robot.workers.dev';
const DEFAULT_SAFETY_PARTYKIT_HOST =
  process.env.SAFETY_PARTYKIT_HOST?.trim()
  || 'everybodys-platformer-presence-safety.songadaymann.partykit.dev';
const DEFAULT_SAFETY_PARTYKIT_PARTY =
  process.env.SAFETY_PARTYKIT_PARTY?.trim()
  || 'main';
const DEFAULT_PAGES_PROJECT = 'wampland';
const DEFAULT_PAGES_BRANCH_PREFIX = 'safety-';
const BRANCH_PREVIEW_HOST_SUFFIX = '.wampland.pages.dev';

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

if (options.pagesOnly && options.workerOnly) {
  throw new Error('Choose at most one of --pages-only or --worker-only.');
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(repoRoot);

const currentBranch = runAndCapture('git', ['branch', '--show-current']).trim() || 'preview';
const headCommit = runAndCapture('git', ['rev-parse', 'HEAD']).trim();
const commitSubject = runAndCapture('git', ['log', '-1', '--pretty=%s']).trim() || headCommit;
const dirtyStatus = runAndCapture('git', ['status', '--porcelain']).trim();
const isDirty = dirtyStatus.length > 0;

const previewBranch = resolvePreviewBranchName(options.branch ?? currentBranch);
const previewUrl = `https://${previewBranch}${BRANCH_PREVIEW_HOST_SUFFIX}`;
const buildEnv = {
  ...process.env,
  VITE_ROOM_API_BASE_URL: DEFAULT_SAFETY_API_BASE_URL,
  VITE_ROOM_STORAGE_BACKEND: 'remote',
  VITE_PARTYKIT_HOST: DEFAULT_SAFETY_PARTYKIT_HOST,
  VITE_PARTYKIT_PARTY: DEFAULT_SAFETY_PARTYKIT_PARTY,
  VITE_ENABLE_TEST_RESET: '1',
};

console.log('Safety branch deploy');
console.log(`- current branch: ${currentBranch}`);
console.log(`- preview branch: ${previewBranch}`);
console.log(`- preview url:    ${previewUrl}`);
console.log(`- safety api:     ${DEFAULT_SAFETY_API_BASE_URL}`);
console.log(`- safety party:   ${DEFAULT_SAFETY_PARTYKIT_HOST} / ${DEFAULT_SAFETY_PARTYKIT_PARTY}`);
console.log(`- git head:       ${headCommit.slice(0, 7)}${isDirty ? ' (dirty worktree)' : ''}`);
if (options.dryRun) {
  console.log('- mode:           dry run');
}

run(
  'npm',
  ['run', 'build'],
  {
    env: buildEnv,
    dryRun: options.dryRun,
    envPreviewKeys: [
      'VITE_ROOM_API_BASE_URL',
      'VITE_ROOM_STORAGE_BACKEND',
      'VITE_PARTYKIT_HOST',
      'VITE_PARTYKIT_PARTY',
      'VITE_ENABLE_TEST_RESET',
    ],
  }
);

if (!options.pagesOnly) {
  if (!options.skipMigrations) {
    run('npm', ['run', 'cf:d1:migrate:safety'], { dryRun: options.dryRun });
  }

  runNodeScript(
    [
      'node_modules/wrangler/bin/wrangler.js',
      'deploy',
      '--env',
      'safety',
      '--var',
      `APP_BASE_URL:${previewUrl}`,
      '--var',
      'ENABLE_TEST_RESET:1',
    ],
    { dryRun: options.dryRun }
  );

  if (!options.skipPresence) {
    run('npm', ['run', 'presence:deploy:safety'], { dryRun: options.dryRun });
  }
}

if (!options.workerOnly) {
  const pagesArgs = [
    'node_modules/wrangler/bin/wrangler.js',
    'pages',
    'deploy',
    'dist',
    '--project-name',
    DEFAULT_PAGES_PROJECT,
    '--branch',
    previewBranch,
  ];

  if (!isDirty) {
    pagesArgs.push(
      '--commit-hash',
      headCommit,
      '--commit-message',
      commitSubject
    );
  }

  runNodeScript(pagesArgs, { dryRun: options.dryRun });
}

console.log('');
console.log('Done.');
console.log(`- preview url: ${previewUrl}`);
console.log(`- safety worker: ${DEFAULT_SAFETY_API_BASE_URL}`);

if (options.skipMigrations) {
  console.log('- note: skipped safety D1 migrations');
}
if (options.skipPresence) {
  console.log('- note: skipped safety PartyKit deploy');
}
if (isDirty) {
  console.log('- note: Pages deploy omitted commit metadata because the worktree is dirty');
}

function parseArgs(argv) {
  const result = {
    branch: null,
    pagesOnly: false,
    workerOnly: false,
    skipMigrations: false,
    skipPresence: false,
    dryRun: false,
    help: false,
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--branch':
        if (!next) {
          throw new Error('--branch requires a value.');
        }
        result.branch = next;
        index += 1;
        break;
      case '--pages-only':
        result.pagesOnly = true;
        break;
      case '--worker-only':
        result.workerOnly = true;
        break;
      case '--skip-migrations':
        result.skipMigrations = true;
        break;
      case '--skip-presence':
        result.skipPresence = true;
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      case '-h':
      case '--help':
        result.help = true;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown argument: ${arg}`);
        }
        positional.push(arg);
        break;
    }
  }

  if (!result.branch && positional.length > 0) {
    result.branch = positional[0];
  }

  return result;
}

function printHelp() {
  console.log(`Usage:
  node scripts/deploy_safety_branch.mjs [--branch <name>] [--pages-only] [--worker-only]
                                       [--skip-migrations] [--skip-presence] [--dry-run]

What it does:
  1. Builds the frontend against the safety Worker + safety PartyKit
  2. Deploys the Worker to the shared safety env with APP_BASE_URL set to the preview URL
  3. Optionally deploys the safety PartyKit presence server
  4. Deploys the built frontend to a Pages branch preview

Defaults:
  - preview branch name is derived from the current git branch
  - safety Worker URL is ${DEFAULT_SAFETY_API_BASE_URL}
  - safety PartyKit host is ${DEFAULT_SAFETY_PARTYKIT_HOST}

Examples:
  npm run deploy:safety:branch
  npm run deploy:safety:branch -- --branch room-music-save-test
  npm run deploy:safety:branch -- --pages-only --branch identity-gate-test
  npm run deploy:safety:branch -- --dry-run
`);
}

function resolvePreviewBranchName(source) {
  const normalized = String(source ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const withoutCommonPrefix = normalized.replace(
    /^(origin-|feature-|feat-|fix-|bugfix-|hotfix-|release-|preview-)/,
    ''
  );
  const base = withoutCommonPrefix || 'preview';
  const prefixed = base.startsWith(DEFAULT_PAGES_BRANCH_PREFIX)
    ? base
    : `${DEFAULT_PAGES_BRANCH_PREFIX}${base}`;

  return prefixed
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function run(command, args, options = {}) {
  const {
    dryRun = false,
    env = process.env,
    envPreviewKeys = [],
  } = options;

  const envPrefix =
    envPreviewKeys.length > 0
      ? `${envPreviewKeys
          .map((key) => `${key}=${JSON.stringify(env[key] ?? '')}`)
          .join(' ')} `
      : '';
  const printableCommand = `${envPrefix}${[command, ...args].join(' ')}`;

  if (dryRun) {
    console.log(`[dry-run] ${printableCommand}`);
    return;
  }

  console.log(`> ${printableCommand}`);
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env,
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

function runNodeScript(args, options = {}) {
  run(process.execPath, args, options);
}
