import { describe, expect, it, vi } from 'vitest';
import { assertWorldTileReleaseCandidate, assertWorldTileReleaseCompatibility, fetchReleaseJson, isProductionPagesBuild } from './world_tile_release_guard.mjs';

const live = { schemaVersion: 1, available: true, activeRendererVersion: 'renderer-current', rolloutPercentage: 100,
  activeRendererAssetContractHash: 'catalog-new', expectedRendererAssetContractHash: 'catalog-new' };
const candidate = () => ({ schemaVersion: 1, generationEnabled: true, statuses: [{ renderer: {
  version: 'renderer-next', status: 'building', asset_contract_hash: 'catalog-new',
  renderer_contract_hash: 'wamp-world-tile-render-v2-box-srgb', render_origin: 'https://abcdef12.wampland.pages.dev',
}, counts: { total: 5, ready: 5, pending: 0, leased: 0, failed: 0, outboxPending: 0 },
leafParity: { publishedRooms: 1, matchingLeaves: 1, missingLeaves: 0, staleLeaves: 0, extraContentLeaves: 0 },
ancestorParity: [0, 1, 2, 3].map(level => ({ level, expected: 1, matching: 1, missing: 0, stale: 0 })) }],
objectVerification: { checked: 5, missingKeys: [], mismatchedKeys: [] } });

describe('blocking world map release gate', () => {
  it('accepts the build only when compatible imagery is available', () => {
    expect(() => assertWorldTileReleaseCompatibility(live, 'catalog-new')).not.toThrow();
  });
  it.each([{ available: false }, { rolloutPercentage: 0 }, { activeRendererAssetContractHash: 'catalog-old' },
    { expectedRendererAssetContractHash: 'catalog-old' }, { activeRendererVersion: null }, { schemaVersion: 2 }])('blocks broken production: %j', change => {
    expect(() => assertWorldTileReleaseCompatibility({ ...live, ...change }, 'catalog-new')).toThrow();
  });
  it('blocks a new catalog even while the current production map is healthy', () => {
    expect(() => assertWorldTileReleaseCompatibility(live, 'catalog-next')).toThrow('Production release blocked');
  });
  it('allows a staged renderer only after full readiness and object verification', () => {
    expect(assertWorldTileReleaseCandidate(candidate(), 'renderer-next', 'catalog-new').status).toBe('building');
  });
  it.each(['wrong-hash', 'mutable-origin', 'wrong-render-contract', 'pending', 'leased', 'failed', 'outbox', 'not-ready',
    'missing-leaf', 'stale-leaf', 'extra-leaf', 'missing-ancestor', 'duplicate-level', 'missing-object', 'wrong-object', 'no-verification', 'retired', 'generation-disabled'])('rejects unsafe candidate: %s', failure => {
    const report = candidate(); const status = report.statuses[0];
    if (failure === 'wrong-hash') status.renderer.asset_contract_hash = 'catalog-old';
    if (failure === 'mutable-origin') status.renderer.render_origin = 'https://wamp.land';
    if (failure === 'wrong-render-contract') status.renderer.renderer_contract_hash = 'old';
    if (failure === 'pending') status.counts.pending = 1;
    if (failure === 'leased') status.counts.leased = 1;
    if (failure === 'failed') status.counts.failed = 1;
    if (failure === 'outbox') status.counts.outboxPending = 1;
    if (failure === 'not-ready') status.counts.ready = 4;
    if (failure === 'missing-leaf') status.leafParity.missingLeaves = 1;
    if (failure === 'stale-leaf') status.leafParity.staleLeaves = 1;
    if (failure === 'extra-leaf') status.leafParity.extraContentLeaves = 1;
    if (failure === 'missing-ancestor') status.ancestorParity[0].missing = 1;
    if (failure === 'duplicate-level') status.ancestorParity[0].level = 1;
    if (failure === 'missing-object') (report.objectVerification.missingKeys as string[]).push('missing');
    if (failure === 'wrong-object') (report.objectVerification.mismatchedKeys as string[]).push('wrong');
    if (failure === 'no-verification') report.objectVerification = null as never;
    if (failure === 'retired') status.renderer.status = 'retired';
    if (failure === 'generation-disabled') report.generationEnabled = false;
    expect(() => assertWorldTileReleaseCandidate(report, 'renderer-next', 'catalog-new')).toThrow('Production release blocked');
  });
  it('does not gate local or preview builds needed to prepare imagery', () => {
    expect(isProductionPagesBuild({})).toBe(false);
    expect(isProductionPagesBuild({ CF_PAGES: '1', CF_PAGES_BRANCH: 'feature' })).toBe(false);
    expect(isProductionPagesBuild({ CF_PAGES: '1', CF_PAGES_BRANCH: 'main' })).toBe(true);
  });
  it('fails closed on API errors', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }));
    await expect(fetchReleaseJson('https://api.example.test/config', {}, fetcher)).rejects.toThrow('HTTP 503');
  });
});
