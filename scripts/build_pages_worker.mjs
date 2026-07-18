import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const esbuildBin = process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild';
const esbuildPath = path.join(repoRoot, 'node_modules', '.bin', esbuildBin);
const workerSource = path.join(repoRoot, 'src', 'pages', 'worker.ts');
const workerOutput = path.join(repoRoot, 'dist', '_worker.js');
const standalonePages = ['jam', 'school-admin', 'school-login'];

if (!fs.existsSync(esbuildPath)) {
  throw new Error('Missing esbuild binary. Run npm install before building.');
}

if (!fs.existsSync(workerSource)) {
  throw new Error(`Missing typed Pages worker source: ${workerSource}`);
}

if (!fs.existsSync(path.dirname(workerOutput))) {
  throw new Error('Missing dist directory. Run vite build before bundling the Pages worker.');
}

const standaloneOutputDir = path.join(repoRoot, 'dist', '__standalone');
fs.mkdirSync(standaloneOutputDir, { recursive: true });
for (const page of standalonePages) {
  fs.copyFileSync(
    path.join(repoRoot, 'dist', `${page}.html`),
    path.join(standaloneOutputDir, `${page}.asset`),
  );
}

execFileSync(esbuildPath, [
  workerSource,
  '--bundle',
  '--platform=neutral',
  '--format=esm',
  '--loader:.ts=ts',
  `--outfile=${workerOutput}`,
], {
  cwd: repoRoot,
  stdio: 'inherit',
});
