import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const label = 'land.wamp.cryptopunk-avatar-queue';
const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
const plistPath = path.join(launchAgentsDir, `${label}.plist`);
const outputDir = path.join(repoRoot, 'output', 'cryptopunk-avatar-queue');
const runnerScript = path.join(repoRoot, 'scripts', 'run_cryptopunk_avatar_queue_once.mjs');
const wranglerPath = path.join(repoRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const productionBucket = 'everybodys-platformer-avatars';

const options = parseArgs(process.argv.slice(2));

if (process.platform !== 'darwin') {
  throw new Error('This installer uses macOS launchd and must be run on macOS.');
}

if (options.uninstall) {
  uninstall();
  process.exit(0);
}

install();

function parseArgs(args) {
  const result = {
    intervalSeconds: parsePositiveInteger(
      process.env.CRYPTOPUNK_AVATAR_QUEUE_INTERVAL_SECONDS,
      60,
    ),
    maxJobs: parsePositiveInteger(process.env.CRYPTOPUNK_AVATAR_AUTO_MAX_JOBS, 2),
    uninstall: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    switch (arg) {
      case '--interval-seconds':
        if (!next) {
          throw new Error('--interval-seconds requires a value.');
        }
        result.intervalSeconds = parsePositiveInteger(next, result.intervalSeconds);
        index += 1;
        break;
      case '--max-jobs':
        if (!next) {
          throw new Error('--max-jobs requires a value.');
        }
        result.maxJobs = parsePositiveInteger(next, result.maxJobs);
        index += 1;
        break;
      case '--uninstall':
        result.uninstall = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return result;
}

function install() {
  mkdirSync(launchAgentsDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  const publicBaseUrl = discoverR2PublicBaseUrl();
  const plist = buildPlist(publicBaseUrl);

  if (existsSync(plistPath)) {
    unloadPlist();
  }

  writeFileSync(plistPath, plist, 'utf8');
  runLaunchctl(['bootstrap', guiDomain(), plistPath]);
  runLaunchctl(['enable', `${guiDomain()}/${label}`]);
  runLaunchctl(['kickstart', '-k', `${guiDomain()}/${label}`]);

  console.log(`Installed ${label}`);
  console.log(`Plist: ${plistPath}`);
  console.log(`Logs: ${outputDir}`);
  console.log(`Interval: ${options.intervalSeconds}s, max jobs per tick: ${options.maxJobs}`);
  if (publicBaseUrl) {
    console.log(`R2 public base URL: ${publicBaseUrl}`);
  }
}

function uninstall() {
  unloadPlist();
  rmSync(plistPath, { force: true });
  console.log(`Uninstalled ${label}`);
}

function unloadPlist() {
  if (!existsSync(plistPath)) {
    return;
  }

  try {
    runLaunchctl(['bootout', guiDomain(), plistPath]);
  } catch {
    try {
      runLaunchctl(['remove', label]);
    } catch {
      // The job may not be loaded yet; removing the plist is enough.
    }
  }
}

function buildPlist(publicBaseUrl) {
  const env = {
    HOME: os.homedir(),
    PATH: buildPath(process.env.PATH),
    CRYPTOPUNK_AVATAR_R2_BUCKET: productionBucket,
  };
  if (publicBaseUrl) {
    env.CRYPTOPUNK_AVATAR_PUBLIC_BASE_URL = publicBaseUrl;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(process.execPath)}</string>
    <string>${xmlEscape(runnerScript)}</string>
    <string>--max-jobs</string>
    <string>${options.maxJobs}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(repoRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env).map(([key, value]) => `    <key>${xmlEscape(key)}</key>
    <string>${xmlEscape(value)}</string>`).join('\n')}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${options.intervalSeconds}</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(outputDir, 'launchd.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(outputDir, 'launchd.err.log'))}</string>
</dict>
</plist>
`;
}

function discoverR2PublicBaseUrl() {
  if (!existsSync(wranglerPath)) {
    return '';
  }

  try {
    const output = execFileSync(
      process.execPath,
      [
        wranglerPath,
        'r2',
        'bucket',
        'dev-url',
        'get',
        productionBucket,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: buildPath(process.env.PATH),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return output.match(/https:\/\/[^\s'"]+/)?.[0] ?? '';
  } catch {
    return '';
  }
}

function runLaunchctl(args) {
  execFileSync('launchctl', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  });
}

function guiDomain() {
  return `gui/${process.getuid()}`;
}

function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function buildPath(existingPath) {
  return [
    path.dirname(process.execPath),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/Library/Frameworks/Python.framework/Versions/3.9/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    existingPath,
  ].filter(Boolean).join(':');
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
