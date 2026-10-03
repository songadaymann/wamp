import { WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH } from '../src/worldTiles/assetContract';

const response = await fetch('https://api.wamp.land/api/world/tiles/config', {
  signal: AbortSignal.timeout(30_000), headers: { 'Cache-Control': 'no-cache' },
});
if (!response.ok) throw new Error(`Production tile config returned HTTP ${response.status}.`);
const config = await response.json() as { activeRendererAssetContractHash?: string };
if (config.activeRendererAssetContractHash !== WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH) {
  console.log(`::warning title=World map renderer rebuild required::This build uses ${WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH}; production imagery uses ${config.activeRendererAssetContractHash ?? 'none'}. Backfill and verify matching imagery before activating it. See docs/overworld-tile-pyramid.md.`);
} else {
  console.log(`World map renderer matches ${WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH}.`);
}
