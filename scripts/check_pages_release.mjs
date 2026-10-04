import { execFileSync } from 'node:child_process';
import { isProductionPagesBuild } from './world_tile_release_guard.mjs';

if (isProductionPagesBuild(process.env)) {
  execFileSync('npm', ['run', 'world-tiles:release:check'], { stdio: 'inherit' });
}
