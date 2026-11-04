// Serves the scratch build from build.mts on 127.0.0.1 (default port 3000) until you stop it.
//
//   node scripts/engine-port/runtime-profile/preview.mts [--port 3000] [--out-root DIR]
//
// measure.mts --start-preview runs this for you and stops it at the end.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, isMain, outRoot, parseArgs } from '../lib.mts';

export function startPreview({ port = 3000, root = outRoot(), stdout = 'inherit', stderr = 'inherit' } = {}) {
  const outDir = path.join(root, 'dist-perf');
  if (!fs.existsSync(path.join(outDir, 'index.html'))) throw new Error(`no build at ${outDir}; run runtime-profile/build.mts first`);
  const vite = path.join(REPO_ROOT, 'node_modules/.bin/vite');
  return spawn(process.execPath, [vite, 'preview', '--outDir', outDir, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', stdout, stderr],
  });
}

if (isMain(import.meta.url)) {
  const args = parseArgs();
  const child = startPreview({ port: Number(args.port ?? 3000), root: outRoot(args) });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { child.kill(); process.exit(0); });
  child.on('exit', (code) => process.exit(code ?? 0));
}
