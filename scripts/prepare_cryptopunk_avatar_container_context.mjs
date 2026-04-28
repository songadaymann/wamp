import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const containerDir = path.join(repoRoot, 'cloudflare', 'cryptopunk-avatar-queue');
const buildInputDir = path.join(containerDir, 'build-input');

const localFlingPunkAssets = path.resolve(repoRoot, '..', 'fling-punk', 'assets');
const localSpritesRoot = path.resolve(
  repoRoot,
  '..',
  '..',
  '..',
  'Sprites-and-Things',
  'player',
  'SpritesSeparated',
);

const metadataPath = path.resolve(
  process.env.CRYPTOPUNK_METADATA_PATH || path.join(localFlingPunkAssets, 'punks-metadata.json'),
);
const punksDir = path.resolve(
  process.env.CRYPTOPUNK_PUNKS_DIR || path.join(localFlingPunkAssets, 'punks'),
);
const spritesRoot = path.resolve(
  process.env.PLAYER_SPRITES_SEPARATED_ROOT || localSpritesRoot,
);

for (const source of [metadataPath, punksDir, spritesRoot]) {
  if (!existsSync(source)) {
    throw new Error(`Missing required CryptoPunk container input: ${source}`);
  }
}

rmSync(buildInputDir, { force: true, recursive: true });
mkdirSync(buildInputDir, { recursive: true });

copyRepoInputs();
copyAssetInputs();
writeManifest();

console.log(`Prepared CryptoPunk avatar container context: ${buildInputDir}`);
console.log(`- metadata: ${metadataPath}`);
console.log(`- punk images: ${punksDir}`);
console.log(`- player source sprites: ${spritesRoot}`);

function copyRepoInputs() {
  const repoInputRoot = path.join(buildInputDir, 'repo');
  copyDir(
    path.join(repoRoot, 'gen-avatar', 'cryptopunk'),
    path.join(repoInputRoot, 'gen-avatar', 'cryptopunk'),
    (sourcePath) => {
      const normalized = sourcePath.split(path.sep).join('/');
      return (
        !normalized.includes('/generated-avatar-packs/')
        && !normalized.includes('/__pycache__/')
        && !normalized.endsWith('.pyc')
      );
    },
  );
  copyFile(
    path.join(repoRoot, 'gen-avatar', 'prototype-punk-avatar.mjs'),
    path.join(repoInputRoot, 'gen-avatar', 'prototype-punk-avatar.mjs'),
  );
  copyDir(
    path.join(repoRoot, 'public', 'assets', 'player', 'default'),
    path.join(repoInputRoot, 'public', 'assets', 'player', 'default'),
  );
}

function copyAssetInputs() {
  const assetsRoot = path.join(buildInputDir, 'assets');
  copyFile(metadataPath, path.join(assetsRoot, 'fling-punk', 'punks-metadata.json'));
  copyDir(punksDir, path.join(assetsRoot, 'fling-punk', 'punks'));
  copyDir(spritesRoot, path.join(assetsRoot, 'player', 'SpritesSeparated'));
}

function writeManifest() {
  const manifest = {
    createdAt: new Date().toISOString(),
    sources: {
      metadataPath,
      punksDir,
      spritesRoot,
    },
    totals: {
      files: countFiles(buildInputDir),
      bytes: countBytes(buildInputDir),
    },
  };
  writeFileSync(
    path.join(buildInputDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

function copyDir(source, target, filter = () => true) {
  cpSync(source, target, {
    recursive: true,
    filter: (sourcePath) => filter(sourcePath),
  });
}

function copyFile(source, target) {
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
}

function countFiles(root) {
  let count = 0;
  cpWalk(root, (filePath) => {
    if (statSync(filePath).isFile()) {
      count += 1;
    }
  });
  return count;
}

function countBytes(root) {
  let count = 0;
  cpWalk(root, (filePath) => {
    const stats = statSync(filePath);
    if (stats.isFile()) {
      count += stats.size;
    }
  });
  return count;
}

function cpWalk(root, visit) {
  const entries = existsSync(root) ? readdirSync(root) : [];
  for (const entry of entries) {
    const filePath = path.join(root, entry);
    visit(filePath);
    if (statSync(filePath).isDirectory()) {
      cpWalk(filePath, visit);
    }
  }
}
