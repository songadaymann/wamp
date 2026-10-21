// Actual API bundle and native D1; no production rows, RPC, wallets or counters.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startWalletAuthFixture } from './lib/walletAuthServiceFixture.mjs';

const output = process.argv.slice(2).find(arg => !arg.startsWith('--')) || 'output/web-game/room-protection-service';
mkdirSync(output, { recursive: true });
if (!process.argv.includes('--skip-build')) {
  for (const [command, args, name] of [['npm', ['run', 'build'], 'build.log'], [process.execPath,
    ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--outdir', `${output}/api`], 'bundle.log']]) {
    const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    writeFileSync(`${output}/${name}`, (result.stdout || '') + (result.stderr || '')); assert.equal(result.status, 0, name);
  }
}
const cases = [];
for (const index of [false, true]) {
  const service = await startWalletAuthFixture(`${output}/api/worker.js`, {
    fixtureModule: '/src/cloudflare/worker/runs/discoveryTestDatabase.ts',
    bindings: { PLAYABLE_CONTENT_INDEX_READS: index ? '1' : '0', EXPANDED_ROOMS_ENABLED: '1', COMPACT_WORLD_READS: '1' },
    prepare(f) {
      for (const [target, cell] of [['native', '8,0'], ['course:legacy', '10,0']]) f.sqlite.prepare(
        'INSERT INTO playable_content_index_members(target_key,room_id,room_version) VALUES (?,?,1)').run(`expanded_room:${target}`, cell);
      f.sqlite.prepare("UPDATE rooms SET minted_token_id='42' WHERE id IN ('0,0','1,0','9,0','10,0')").run();
      f.sqlite.prepare("UPDATE rooms SET minted_chain_id=8453 WHERE id IN ('8,0','13,0')").run();
      f.sqlite.prepare("UPDATE rooms SET published_json=json_set(published_json,'$.goal',NULL) WHERE id='13,0'").run();
      f.sqlite.prepare("UPDATE room_versions SET snapshot_json=json_set(snapshot_json,'$.goal',NULL) WHERE room_id='13,0'").run();
      f.sqlite.prepare("UPDATE playable_content_index SET first_published_at='2026-10-20T00:00:00Z' WHERE content_id='0,0'").run();
      f.sqlite.prepare("UPDATE room_versions SET created_at='2026-10-20T00:00:00Z' WHERE room_id='0,0'").run();
    },
  });
  try {
    const responses = {};
    const read = async path => {
      const response = await service.request(path), text = await response.text(); assert.equal(response.status, 200, text);
      assert(!text.includes('minted_contract_address')); assert(!text.includes('minted_owner_wallet_address'));
      cases.push({ name: `${index ? 'indexed' : 'legacy'}:${path.split('?')[0]}`, status: response.status });
      return responses[path] = JSON.parse(text);
    };
    for (const path of ['/api/leaderboards/rooms/discover?sort=newest&limit=100', '/api/profiles/builder/rooms?limit=100']) {
      const { results } = await read(path);
      assert.equal(results.find(r => r.roomId === '1,0').protectedCellCount, 1);
      assert.equal(results.find(r => r.expandedRoom?.expandedRoomId === 'native').protectedCellCount, 1);
      assert.equal(results.find(r => r.expandedRoom?.expandedRoomId === 'course:legacy').protectedCellCount, 2);
      assert.equal(results.find(r => r.roomId === '2,0').protectedCellCount, undefined);
      if (path.includes('/discover')) assert.equal(results.find(r => r.roomId === '1,0').builderUserId, 'builder');
    }
    for (const path of ['/api/world?centerX=1&centerY=0&radius=2', '/api/world/chunks?minChunkX=0&maxChunkX=1&minChunkY=0&maxChunkY=0', '/api/world/chunks/summary?minChunkX=0&maxChunkX=1&minChunkY=0&maxChunkY=0']) {
      const body = await read(path), rooms = body.rooms ?? body.chunks.flatMap(c => c.rooms);
      assert.equal(rooms.find(r => r.id === '1,0').isMinted, true);
      assert.equal(rooms.find(r => r.id === '2,0').isMinted, undefined);
    }
    const protectedDiscovery = await read('/api/leaderboards/rooms/discover?sort=protected&limit=100');
    assert.equal(protectedDiscovery.protectedDiscoveryAvailable, true);
    const key = entry => entry.expandedRoom?.expandedRoomId ?? entry.roomId;
    assert.deepEqual(new Set(protectedDiscovery.results.map(key)), new Set(['0,0','1,0','native','course:legacy','13,0']));
    assert.equal(protectedDiscovery.results.find(r => r.roomId === '13,0').goalType, null);
    assert.equal(protectedDiscovery.results[0].roomId, '0,0');
    const seen = []; let cursor;
    do {
      const page = await read('/api/leaderboards/rooms/discover?sort=protected&limit=2' + (cursor ? '&cursor=' + cursor : ''));
      assert(page.results.length > 0); assert(page.results.every(r => r.protectedCellCount > 0));
      seen.push(...page.results.map(key)); cursor = page.nextCursor;
    } while (cursor);
    assert.equal(seen.length, 5); assert.equal(new Set(seen).size, 5);
    const badCursor = Buffer.from(JSON.stringify({ version: 1, sort: 'newest', offset: 2 })).toString('base64url');
    const rejected = await service.request('/api/leaderboards/rooms/discover?sort=protected&cursor=' + badCursor);
    assert.equal(rejected.status, 400); cases.push({ name: `${index ? 'indexed' : 'legacy'}:sort-bound-cursor`, status: rejected.status });
    const summary = await read('/api/rooms/1%2C0/summary');
    writeFileSync(`${output}/browser-data-${index ? 'indexed' : 'legacy'}.json`, JSON.stringify({
      discovery: responses['/api/leaderboards/rooms/discover?sort=newest&limit=100'],
      profile: responses['/api/profiles/builder/rooms?limit=100'],
      world: responses['/api/world/chunks/summary?minChunkX=0&maxChunkX=1&minChunkY=0&maxChunkY=0'], summary,
      protectedDiscovery,
    }));
    // Confirmed storage change appears on the next uncached read; the public cache's separate unit test proves its 20s lifetime.
    await service.db.prepare("UPDATE rooms SET minted_contract_address='0x1111111111111111111111111111111111111111' WHERE id='2,0'").run();
    const updated = await read('/api/world/chunks/summary?minChunkX=0&maxChunkX=0&minChunkY=0&maxChunkY=0');
    assert.equal(updated.chunks.flatMap(c => c.rooms).find(r => r.id === '2,0').isMinted, true);
    assert.deepEqual(service.unexpected, []);
  } finally { await service.close(); }
}
writeFileSync(`${output}/report.json`, JSON.stringify({ accepted: true, cases, productionRequests: 0, transactionsSubmitted: 0, unexpectedOutbound: [] }, null, 2));
console.log(`room protection service: ${cases.length} native API checks passed`);
