import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Build-time only: hashes bytes, never changes the authoring registries. */
export function createPublicAssetHashes(publicDirectory: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        const key = relative(publicDirectory, path).split(sep).join('/');
        hashes[key] = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12);
      }
    }
  };
  visit(join(publicDirectory, 'assets'));
  return hashes;
}
