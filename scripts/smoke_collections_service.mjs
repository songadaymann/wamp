import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startWalletAuthFixture } from './lib/walletAuthServiceFixture.mjs';
const output = process.argv[2] || 'output/web-game/collections-service';
mkdirSync(output, { recursive: true });
const bundle = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--outdir',`${output}/api`], { encoding:'utf8', maxBuffer:20*1024*1024 });
writeFileSync(`${output}/bundle.log`, (bundle.stdout || '')+(bundle.stderr || '')); assert.equal(bundle.status,0);
const service = await startWalletAuthFixture(`${output}/api/worker.js`, {
  fixtureModule:'/src/cloudflare/worker/collections/testDatabase.ts',
  bindings:{ EXPANDED_ROOMS_ENABLED:'1', PLAYABLE_CONTENT_INDEX_READS:'1', COMPACT_WORLD_READS:'1' },
});
const cases = [], responses = {};
try {
  const read = async path => {
    const response = await service.request(path); assert.equal(response.status,200,path);
    assert.match(response.headers.get('cache-control') ?? '', /max-age=20/);
    cases.push({path,status:response.status});
    return responses[path] = await response.json();
  };
  const attrPath = '/api/collections/attribution?target=room%3A1%2C0&target=native&target=course%3Alegacy';
  const attribution = await read(attrPath);
  assert.equal(attribution.results[0].collectors[0].userId,'p1');
  assert.equal(attribution.results[1].collectors[0].cellCount,1);
  assert.equal(attribution.results[2].collectors[0].cellCount,2);
  assert.equal(attribution.results[1].cellCount,2);
  let cursor, seen=[];
  do { const page = await read('/api/profiles/p1/collection?limit=2'+(cursor ? '&cursor='+encodeURIComponent(cursor):''));
    seen.push(...page.results.map(r=>r.roomId)); cursor=page.nextCursor;
  } while(cursor);
  assert.equal(seen.length,4); assert.equal(new Set(seen).size,4);
  const shelf = await read('/api/profiles/p1/collection?limit=48');
  assert(shelf.results.every(r=>r.builder.userId==='builder'));
  assert.equal(JSON.stringify(shelf).includes('@example.test'),false);
  assert.deepEqual(await read('/api/profiles/builder/collection'),{results:[]});
  for (const path of ['/api/collections/attribution','/api/collections/attribution?'+new URLSearchParams(Array.from({length:17},(_,n)=>['target',`room:${n},0`])),
    '/api/profiles/p1/collection?limit=0','/api/profiles/p1/collection?cursor=bad']) {
    const r=await service.request(path); assert.equal(r.status,400,path);cases.push({path,status:r.status});
  }
  assert.equal((await service.request('/api/profiles/missing/collection')).status,404);
  // Browser fixtures are generated from this actual Worker + native D1.
  const discovery = await read('/api/leaderboards/rooms/discover?sort=protected&limit=100');
  const builderRooms = await read('/api/profiles/builder/rooms?limit=100');
  const profile = await service.request('/api/profiles/p1').then(r=>r.json());
  assert.equal(profile.collectionAvailable,true);
  writeFileSync(`${output}/browser-data.json`, JSON.stringify({attribution,shelf,discovery,builderRooms,profile}));
  // Explicit refreshed transfer changes display ownership only; no actual chain, signatures, or edits.
  await service.db.prepare("UPDATE users SET wallet_address='0x2222222222222222222222222222222222222222' WHERE id='p2'").run();
  await service.db.prepare("UPDATE rooms SET minted_owner_wallet_address='0x2222222222222222222222222222222222222222' WHERE id='1,0'").run();
  const after=await read('/api/profiles/p1/collection?limit=47'); assert.equal(after.results.some(r=>r.roomId==='1,0'),false);
  assert.equal((await read('/api/profiles/p2/collection')).results[0].builder.userId,'builder');
  const authProbe=await service.request('/api/profiles/p1/collection');
  const invalid=await fetch(authProbe.url,{headers:{Origin:'https://wamp.land',Authorization:'Bearer invalid-collections-fixture'}});
  assert.equal(invalid.status,401);cases.push({name:'credentials checked before cache',status:401});
  assert.deepEqual(service.unexpected,[]);
  writeFileSync(`${output}/report.json`,JSON.stringify({accepted:true,cases,productionWrites:0,externalRequests:service.unexpected},null,2));
  console.log(`Collections service: ${cases.length} native API checks passed`);
} finally { await service.close(); }
