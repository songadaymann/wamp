import { pathToFileURL } from 'node:url';

export function assertWorldTileAvailability(config) {
  if (config?.schemaVersion !== 1 || config.available !== true
    || typeof config.activeRendererVersion !== 'string' || !config.activeRendererVersion
    || typeof config.expectedRendererAssetContractHash !== 'string'
    || !config.expectedRendererAssetContractHash
    || config.activeRendererAssetContractHash !== config.expectedRendererAssetContractHash
    || !(config.rolloutPercentage > 0)) {
    throw new Error(`World map imagery is unavailable or incompatible: ${JSON.stringify(config)}`);
  }
}

export async function checkWorldTileAvailability(apiBase = 'https://api.wamp.land') {
  const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/world/tiles/config`, {
    headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`World map config returned HTTP ${response.status}.`);
  const config = await response.json();
  assertWorldTileAvailability(config);
  return config;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  checkWorldTileAvailability(process.env.PROD_API_BASE_URL).then((config) => {
    console.log(JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), config }, null, 2));
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
