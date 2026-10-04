import { WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH } from '../src/worldTiles/assetContract';
import { assertWorldTileReleaseCandidate, assertWorldTileReleaseCompatibility, fetchReleaseJson } from './world_tile_release_guard.mjs';

const apiBase = 'https://api.wamp.land';
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const candidateIndex = args.indexOf('--candidate-renderer');
const candidateVersion = candidateIndex < 0 ? null : args[candidateIndex + 1];
if (candidateIndex >= 0 && (!candidateVersion || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$/.test(candidateVersion))) {
  throw new Error('A valid --candidate-renderer version is required.');
}

if (candidateVersion) {
  const key = process.env.ADMIN_API_KEY?.trim();
  if (!strict || !key) throw new Error('Candidate release verification requires --strict and ADMIN_API_KEY.');
  const url = `${apiBase}/api/admin/world-tiles/status?rendererVersion=${encodeURIComponent(candidateVersion)}&verifyObjects=1`;
  const report = await fetchReleaseJson(url, { headers: { 'X-Admin-Key': key } });
  assertWorldTileReleaseCandidate(report, candidateVersion, WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH);
  console.log(`Verified complete renderer ${candidateVersion} for ${WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH}.`);
} else {
  const config = await fetchReleaseJson(`${apiBase}/api/world/tiles/config?releaseCheck=${Date.now()}`);
  if (strict) {
    assertWorldTileReleaseCompatibility(config, WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH);
  } else if (config.activeRendererAssetContractHash !== WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH || config.available !== true) {
    console.log(`::warning title=World map renderer rebuild required::This build uses ${WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH}; production imagery uses ${config.activeRendererAssetContractHash ?? 'none'}. Prepare and verify matching imagery before releasing it. See docs/overworld-tile-pyramid.md.`);
  }
  console.log(`World map asset check completed for ${WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH}.`);
}
