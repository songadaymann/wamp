// Phone and tablet smoke without a live API (F089): build with the preview-smoke hooks, serve
// the build, and replay the recorded API responses in scripts/fixtures/mobile-smoke-api.json.gz.
//   npm run smoke:mobile:ci                 build, serve and replay
//   npm run smoke:mobile:ci -- --skip-build reuse dist-mobile-smoke/
//   npm run smoke:mobile:ci -- --record     refresh the fixture from production (reads only)
//   npm run smoke:mobile:ci -- --wallet-recovery-only   interrupted approvals, four device profiles
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
  for (const browserEngine of args.has('--expanded-only') || args.has('--pause-only') || args.has('--assist-only') || args.has('--keyboard-only') || args.has('--auth-only') || args.has('--identity-only') || args.has('--map-capture-only') || args.has('--mint-network-only') || args.has('--ownership-only') || args.has('--artwork-only') || args.has('--wallet-recovery-only') || args.has('--costs-only') ? [] : engines) {
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

  if (mode === 'replay' && args.has('--assist-only') && exitCode === 0) {
    const assist = spawnSync(process.execPath, ['scripts/smoke_assist.mjs',
      `http://127.0.0.1:${port}`, `${process.env.MOBILE_SMOKE_OUTPUT_DIR ?? 'output/web-game/mobile-smoke-ci'}/assist`],
    { stdio: 'inherit', env: process.env });
    if (assist.status !== 0) exitCode = assist.status ?? 1;
  }

  if (mode === 'replay' && args.has('--keyboard-only') && exitCode === 0) {
    const keyboard = spawnSync(process.execPath, ['scripts/smoke_keyboard_bindings.mjs',
      `http://127.0.0.1:${port}`, `${process.env.MOBILE_SMOKE_OUTPUT_DIR ?? 'output/web-game/mobile-smoke-ci'}/keyboard`],
    { stdio: 'inherit', env: process.env });
    if (keyboard.status !== 0) exitCode = keyboard.status ?? 1;
  }

  if (mode === 'replay' && args.has('--auth-only') && exitCode === 0) {
    const auth = spawnSync(process.execPath, ['scripts/smoke_auth_state.mjs',
      `http://127.0.0.1:${port}`, `${process.env.MOBILE_SMOKE_OUTPUT_DIR ?? 'output/web-game/mobile-smoke-ci'}/auth`],
    { stdio: 'inherit', env: process.env });
    if (auth.status !== 0) exitCode = auth.status ?? 1;
  }

  if (mode === 'replay' && args.has('--ownership-only') && exitCode === 0) {
    const ownership = spawnSync(process.execPath, ['scripts/smoke_room_ownership.mjs',
      `http://127.0.0.1:${port}`, `${process.env.MOBILE_SMOKE_OUTPUT_DIR ?? 'output/web-game/mobile-smoke-ci'}/room-ownership`],
    { stdio: 'inherit', env: process.env });
    if (ownership.status !== 0) exitCode = ownership.status ?? 1;
  }

  if (mode === 'replay' && args.has('--artwork-only') && exitCode === 0) {
    const artwork = spawnSync(process.execPath, ['scripts/smoke_room_artwork.mjs',
      `http://127.0.0.1:${port}`, `${process.env.MOBILE_SMOKE_OUTPUT_DIR ?? 'output/web-game/mobile-smoke-ci'}/room-artwork`],
    { stdio: 'inherit', env: process.env });
    if (artwork.status !== 0) exitCode = artwork.status ?? 1;
  }

  if (mode === 'replay' && args.has('--costs-only') && exitCode === 0) {
    const costs = spawnSync(process.execPath, ['scripts/smoke_room_artwork.mjs',
      `http://127.0.0.1:${port}`, `${process.env.MOBILE_SMOKE_OUTPUT_DIR ?? 'output/web-game/mobile-smoke-ci'}/room-wallet-costs`, '--costs'],
    { stdio: 'inherit', env: process.env });
    if (costs.status !== 0) exitCode = costs.status ?? 1;
  }

  if (mode === 'replay' && args.has('--wallet-recovery-only') && exitCode === 0) {
    const recovery = spawnSync(process.execPath, ['scripts/smoke_room_artwork.mjs',
      `http://127.0.0.1:${port}`, `${process.env.MOBILE_SMOKE_OUTPUT_DIR ?? 'output/web-game/mobile-smoke-ci'}/room-wallet-recovery`, '--recovery'],
    { stdio: 'inherit', env: process.env });
    if (recovery.status !== 0) exitCode = recovery.status ?? 1;
  }

  if (mode === 'replay' && args.has('--mint-network-only') && exitCode === 0) {
    const mint = spawnSync(process.execPath, ['scripts/smoke_mint_network.mjs',
      `http://127.0.0.1:${port}`, `${process.env.MOBILE_SMOKE_OUTPUT_DIR ?? 'output/web-game/mobile-smoke-ci'}/mint-network`],
    { stdio: 'inherit', env: process.env });
    if (mint.status !== 0) exitCode = mint.status ?? 1;
  }

  if (mode === 'replay' && args.has('--map-capture-only') && exitCode === 0) {
    const capture = spawnSync(process.execPath, ['scripts/smoke_map_capture.mjs',
      `http://127.0.0.1:${port}`, `${process.env.MOBILE_SMOKE_OUTPUT_DIR ?? 'output/web-game/mobile-smoke-ci'}/map-capture`],
    { stdio: 'inherit', env: process.env });
    if (capture.status !== 0) exitCode = capture.status ?? 1;
  }

  if (mode === 'replay' && args.has('--identity-only') && exitCode === 0) {
    const identity = spawnSync(process.execPath, ['scripts/smoke_chat_identity.mjs',
      `http://127.0.0.1:${port}`, `${process.env.MOBILE_SMOKE_OUTPUT_DIR ?? 'output/web-game/mobile-smoke-ci'}/chat-identity`],
    { stdio: 'inherit', env: process.env });
    if (identity.status !== 0) exitCode = identity.status ?? 1;
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
