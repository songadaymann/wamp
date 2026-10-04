import { assertWorldTileAvailability } from './check_world_tile_availability.mjs';

export function assertWorldTileReleaseCompatibility(config, expectedHash) {
  assertWorldTileAvailability(config);
  if (config.activeRendererAssetContractHash !== expectedHash) {
    throw new Error(`Production release blocked: this build needs ${expectedHash}; active imagery uses ${config.activeRendererAssetContractHash}. Prepare and verify matching imagery first. See docs/overworld-tile-pyramid.md.`);
  }
}

const count = value => Number.isSafeInteger(value) && value >= 0;
export function assertWorldTileReleaseCandidate(report, version, expectedHash) {
  const status = Array.isArray(report?.statuses) ? report.statuses.find(entry => entry.renderer?.version === version) : null;
  const renderer = status?.renderer;
  const counts = status?.counts;
  const leaves = status?.leafParity;
  const ancestors = status?.ancestorParity;
  const objects = report?.objectVerification;
  if (report?.schemaVersion !== 1 || report.generationEnabled !== true
    || !renderer || !['building', 'active'].includes(renderer.status)
    || renderer.asset_contract_hash !== expectedHash
    || renderer.renderer_contract_hash !== 'wamp-world-tile-render-v2-box-srgb'
    || !/^https:\/\/[a-f0-9]{8}\.wampland\.pages\.dev$/.test(renderer.render_origin)
    || !counts || !count(counts.total) || counts.total === 0 || counts.ready !== counts.total
    || ['pending', 'leased', 'failed', 'outboxPending'].some(key => counts[key] !== 0)
    || !leaves || !count(leaves.publishedRooms) || leaves.matchingLeaves !== leaves.publishedRooms
    || ['missingLeaves', 'staleLeaves', 'extraContentLeaves'].some(key => leaves[key] !== 0)
    || !Array.isArray(ancestors) || ancestors.length !== 4
    || [0, 1, 2, 3].some(level => {
      const entry = ancestors.find(ancestor => ancestor.level === level);
      return !entry || !count(entry.expected) || entry.matching !== entry.expected || entry.missing !== 0 || entry.stale !== 0;
    })
    || !objects || !count(objects.checked) || objects.checked < leaves.matchingLeaves || objects.checked > counts.total
    || !Array.isArray(objects.missingKeys) || objects.missingKeys.length !== 0
    || !Array.isArray(objects.mismatchedKeys) || objects.mismatchedKeys.length !== 0) {
    throw new Error(`Production release blocked: renderer ${version} lacks complete matching leaf, ancestor and object readiness.`);
  }
  return renderer;
}

export async function fetchReleaseJson(url, init = {}, fetcher = fetch) {
  const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(120_000), headers: { 'Cache-Control': 'no-cache', ...init.headers } });
  if (!response.ok) throw new Error(`World map release check returned HTTP ${response.status}.`);
  return response.json();
}

export function isProductionPagesBuild(env) {
  return env.CF_PAGES === '1' && env.CF_PAGES_BRANCH === 'main';
}
