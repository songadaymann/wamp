// Scratch build for the runtime profile. dist/ cannot run the preview-smoke hooks, because
// installPreviewSmokeActions only installs when VITE_ENABLE_TEST_RESET is '1' at build time
// (src/main/previewSmoke.ts, src/main.ts). So this builds a separate copy the same way
// scripts/mobile_smoke_ci.mjs does, with hidden source maps for analyze.mts and chain.mts.
//
//   node scripts/engine-port/runtime-profile/build.mts [--out-root DIR]
//
// Output: <out-root>/dist-perf/ (default output/engine-port/dist-perf/). dist/ is not touched.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { REPO_ROOT, ensureDir, outRoot, parseArgs } from '../lib.mts';

const args = parseArgs();
const outDir = path.join(ensureDir(outRoot(args)), 'dist-perf');
const vite = path.join(REPO_ROOT, 'node_modules/.bin/vite');
const t0 = Date.now();
const res = spawnSync(process.execPath, [vite, 'build', '--outDir', outDir, '--emptyOutDir', '--sourcemap', 'hidden', '--logLevel', 'warn'], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  env: { ...process.env, VITE_ENABLE_TEST_RESET: '1', VITE_ROOM_API_BASE_URL: '', VITE_PARTYKIT_HOST: '' },
});
if (res.status !== 0) process.exit(res.status ?? 1);
console.log(`built ${path.relative(REPO_ROOT, outDir)} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
