// Phone and tablet smoke without a live API (F089): build with the preview-smoke hooks, serve
// the build, and replay the recorded API responses in scripts/fixtures/mobile-smoke-api.json.gz.
//   npm run smoke:mobile:ci                 build, serve and replay
//   npm run smoke:mobile:ci -- --skip-build reuse dist-mobile-smoke/
//   npm run smoke:mobile:ci -- --record     refresh the fixture from production (reads only)
import { spawn, spawnSync } from 'node:child_process';

const port = Number(process.env.MOBILE_SMOKE_PORT ?? 4173);
const outDir = 'dist-mobile-smoke';
const args = new Set(process.argv.slice(2));
const mode = args.has('--record') ? 'record' : 'replay';
const engineIndex = process.argv.indexOf('--engine');
const engine = engineIndex < 0 ? (mode === 'record' ? 'chromium' : 'all') : process.argv[engineIndex + 1];
if (!['all', 'chromium', 'webkit'].includes(engine)) throw new Error('Choose all, chromium or webkit');
const engines = engine === 'all' ? ['chromium', 'webkit'] : [engine];
const vite = 'node_modules/.bin/vite';

if (!args.has('--skip-build')) {
  const build = spawnSync(process.execPath, [vite, 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_ENABLE_TEST_RESET: '1', VITE_ROOM_API_BASE_URL: '', VITE_PARTYKIT_HOST: '' },
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const preview = spawn(process.execPath, [vite, 'preview', '--outDir', outDir, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
let exitCode = 1;
try {
  await waitForServer(`http://127.0.0.1:${port}/`, 30_000);
  exitCode = 0;
  for (const browserEngine of args.has('--expanded-only') || args.has('--pause-only') ? [] : engines) {
    const smoke = spawnSync(process.execPath, ['scripts/mobile_smoke.mjs', '--url', `http://127.0.0.1:${port}`, '--engine', browserEngine], {
      stdio: 'inherit',
      env: { ...process.env, MOBILE_SMOKE_API_FIXTURES: mode,
        MOBILE_SMOKE_OUTPUT_DIR: `${process.env.MOBILE_SMOKE_OUTPUT_DIR ?? 'output/web-game/mobile-smoke-ci'}/${browserEngine}` },
    });
    if (smoke.status !== 0) exitCode = smoke.status ?? 1;
  }

  if (mode === 'replay' && args.has('--expanded-only') && exitCode === 0) {
    const leaderboards = spawnSync(process.execPath, ['scripts/smoke_expanded_leaderboards.mjs',
      `http://127.0.0.1:${port}`, `${process.env.MOBILE_SMOKE_OUTPUT_DIR ?? 'output/web-game/mobile-smoke-ci'}/expanded-leaderboards`],
    { stdio: 'inherit', env: process.env });
    if (leaderboards.status !== 0) exitCode = leaderboards.status ?? 1;
  }

  if (mode === 'replay' && args.has('--pause-only') && exitCode === 0) {
    const pause = spawnSync(process.execPath, ['scripts/smoke_gameplay_pause.mjs',
      `http://127.0.0.1:${port}`, `${process.env.MOBILE_SMOKE_OUTPUT_DIR ?? 'output/web-game/mobile-smoke-ci'}/gameplay-pause`],
    { stdio: 'inherit', env: process.env });
    if (pause.status !== 0) exitCode = pause.status ?? 1;
  }
} finally {
  preview.kill();
}
process.exit(exitCode);

async function waitForServer(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Preview server did not start at ${url}`);
}
