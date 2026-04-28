import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(repoRoot, 'output', 'cryptopunk-avatar-queue');
const lockPath = path.join(outputDir, 'queue.lock');
const queueScript = path.join(repoRoot, 'scripts', 'process_cryptopunk_avatar_queue.mjs');
const DEFAULT_MAX_JOBS = 2;
const STALE_LOCK_MS = 30 * 60 * 1000;

mkdirSync(outputDir, { recursive: true });

const { maxJobs, passthroughArgs } = parseArgs(process.argv.slice(2));
const lockFd = acquireLock();

try {
  const childEnv = {
    ...process.env,
    PATH: buildPath(process.env.PATH),
  };
  execFileSync(
    process.execPath,
    [
      queueScript,
      '--max-jobs',
      String(maxJobs),
      ...passthroughArgs,
    ],
    {
      cwd: repoRoot,
      env: childEnv,
      stdio: 'inherit',
    },
  );
} finally {
  closeSync(lockFd);
  rmSync(lockPath, { force: true });
}

function parseArgs(args) {
  let maxJobs = parsePositiveInteger(
    process.env.CRYPTOPUNK_AVATAR_AUTO_MAX_JOBS,
    DEFAULT_MAX_JOBS,
  );
  const passthroughArgs = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--max-jobs') {
      const next = args[index + 1];
      if (!next) {
        throw new Error('--max-jobs requires a value.');
      }
      maxJobs = parsePositiveInteger(next, DEFAULT_MAX_JOBS);
      index += 1;
      continue;
    }

    passthroughArgs.push(arg);
  }

  return { maxJobs, passthroughArgs };
}

function acquireLock() {
  try {
    const fd = openSync(lockPath, 'wx');
    writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`, 'utf8');
    return fd;
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw error;
    }

    let lockAgeMs = 0;
    try {
      lockAgeMs = Date.now() - statSync(lockPath).mtimeMs;
    } catch {
      lockAgeMs = STALE_LOCK_MS + 1;
    }

    if (lockAgeMs > STALE_LOCK_MS) {
      rmSync(lockPath, { force: true });
      return acquireLock();
    }

    console.log('CryptoPunk avatar queue runner is already active; skipping this tick.');
    process.exit(0);
  }
}

function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function buildPath(existingPath) {
  const entries = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/Library/Frameworks/Python.framework/Versions/3.9/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    existingPath,
  ];
  return entries.filter(Boolean).join(':');
}
