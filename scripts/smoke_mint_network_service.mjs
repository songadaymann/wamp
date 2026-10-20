// Real API bundle, native D1, authenticated sessions and an isolated JSON-RPC peer.
import { Miniflare } from 'miniflare';
import { createServer } from 'vite';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const output = process.argv.slice(2).find(a => !a.startsWith('--')) || 'output/web-game/mint-network-service';
mkdirSync(output, { recursive: true }); const freshBuild = !process.argv.includes('--skip-build');
const run = (command, args, file) => { const r = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }); writeFileSync(`${output}/${file}`, (r.stdout || '') + (r.stderr || '')); assert.equal(r.status, 0, file); };
if (freshBuild) { run('npm', ['run', 'build'], 'build.log'); run(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--outdir', `${output}/api`], 'bundle.log'); }
const loader = await createServer({ configFile: false, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [], entries: [] }, appType: 'custom', logLevel: 'error' });
let mf, f; const cases = [], unexpected = [];
try {
  const { fixture } = await loader.ssrLoadModule('/src/cloudflare/worker/activity/testDatabase.ts');
  const { createSession } = await loader.ssrLoadModule('/src/cloudflare/worker/auth/store.ts');
  const fixtures = await loader.ssrLoadModule('/src/cloudflare/worker/mint/testRpc.ts');
  const providers = { base: fixtures.createMintRpcFixture(8453), sepolia: fixtures.createMintRpcFixture(84532) };
  let providerFailure = false;
  const profiles = [['base', '8453'], ['sepolia', '84532'], ['missing', null], ['unsupported', '1']];
  mf = new Miniflare({ workers: profiles.map(([name, chainId]) => ({ name, modules: [{ type: 'ESModule', path: resolve(output, 'api/worker.js') }], compatibilityDate: '2026-03-08', compatibilityFlags: ['global_fetch_strictly_public'], unsafeDirectSockets: [{ host: '127.0.0.1', port: 0 }],
    bindings: { ...(chainId ? { ROOM_MINT_CHAIN_ID: chainId } : {}), ROOM_MINT_CONTRACT_ADDRESS: fixtures.FIXTURE_MINT_CONTRACT, ROOM_MINT_RPC_URL: `https://server-rpc.example/${name}/private-sentinel`, ROOM_MINT_AUTH_PRIVATE_KEY: fixtures.FIXTURE_MINT_AUTH_KEY },
    d1Databases: { DB: 'ephemeral-mint-network', JAM_DB: 'ephemeral-mint-network' }, serviceBindings: { ASSETS: () => new Response('Not found', { status: 404 }) },
    outboundService: async request => { const u = new URL(request.url); if (u.hostname !== 'server-rpc.example') { unexpected.push(u.origin); throw new Error('Unexpected outbound'); } if (providerFailure) throw new Error('private-provider-diagnostic-sentinel'); const provider = providers[u.pathname.split('/')[1]]; assert(provider, 'Unconfigured networks must not reach an RPC'); return provider.fetch(request); },
  })) });
  const db = await mf.getD1Database('DB', 'base'); f = fixture();
  const schema = f.sqlite.prepare("SELECT type,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid").all();
  await db.batch(schema.filter(r => r.type !== 'trigger').map(r => db.prepare(r.sql)));
  const inserts = [db.prepare('PRAGMA defer_foreign_keys = ON')];
  for (const { name } of f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all()) {
    const quoted = `"${name.replaceAll('"', '""')}"`;
    for (const row of f.sqlite.prepare(`SELECT * FROM ${quoted}`).all()) { const columns = Object.keys(row); inserts.push(db.prepare(`INSERT INTO ${quoted} (${columns.map(c => `"${c.replaceAll('"', '""')}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`).bind(...Object.values(row))); }
  }
  await db.batch(inserts);
  await db.batch(schema.filter(r => r.type === 'trigger').map(r => db.prepare(r.sql)));
  await db.prepare('UPDATE users SET wallet_address=? WHERE id=?').bind(fixtures.FIXTURE_MINT_WALLET, 'builder').run();
  const cookie = await createSession({ DB: db }, 'builder'), urls = Object.fromEntries(await Promise.all(profiles.map(async ([n]) => [n, await mf.unsafeGetDirectURL(n)])));
  const call = (name, kind = 'mint', auth = true, origin = 'https://wamp.land') => fetch(new URL(`/api/rooms/0,0/${kind === 'mint' ? 'mint' : 'mint/metadata'}/prepare`, urls[name]), { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(auth ? { Cookie: `ep_session=${cookie}` } : {}) }, body: JSON.stringify(kind === 'mint' ? {} : { tokenUri: 'data:application/json;base64,e30=' }) });
  for (const [name, chainId] of [['base', 8453], ['sepolia', 84532]]) { const r = await call(name), text = await r.text(), body = JSON.parse(text); assert.equal(r.status, 200, text); assert.equal(body.chain.chainId, chainId); assert.equal(body.transaction.chainId, chainId); assert.equal(body.priceWei, '1000'); assert(!text.includes('private-sentinel')); assert.equal(body.chain.rpcUrl, chainId === 8453 ? 'https://mainnet.base.org' : 'https://sepolia.base.org'); cases.push({ name: name + '-valid-mint', status: r.status }); }
  const count = () => providers.base.methods.length + providers.sepolia.methods.length;
  for (const [name, auth, origin, expected] of [['missing', false, 'https://wamp.land', 401], ['base', true, 'https://untrusted.example', 403], ['missing', true, 'https://wamp.land', 503], ['unsupported', true, 'https://wamp.land', 503]]) { const before = count(), r = await call(name, 'mint', auth, origin), text = await r.text(); assert.equal(r.status, expected, text); assert.equal(count(), before); assert(!text.includes('private-sentinel')); cases.push({ name: name + '-gate-' + expected, status: r.status }); }
  const before = await db.prepare('SELECT minted_chain_id,minted_token_id,minted_owner_wallet_address FROM rooms WHERE id=?').bind('0,0').first();
  providers.base.state.chainId = 84532;
  const wrong = await call('base'); assert.equal(wrong.status, 503, await wrong.text()); assert.deepEqual(await db.prepare('SELECT minted_chain_id,minted_token_id,minted_owner_wallet_address FROM rooms WHERE id=?').bind('0,0').first(), before); cases.push({ name: 'mismatch-no-ownership-write', status: wrong.status });
  providers.base.state.chainId = 8453; providerFailure = true; const failure = await call('base'), failedText = await failure.text(); assert.equal(failure.status, 503, failedText); assert(!failedText.includes('private-provider-diagnostic-sentinel')); assert(!failedText.includes('private-sentinel')); cases.push({ name: 'provider-failure-private', status: failure.status }); providerFailure = false;
  assert.equal((await call('base')).status, 200); cases.push({ name: 'failure-recovery', status: 200 });
  await db.prepare('UPDATE rooms SET minted_chain_id=8453,minted_contract_address=?,minted_token_id=?,minted_owner_wallet_address=? WHERE id=?').bind(fixtures.FIXTURE_MINT_CONTRACT, '42', fixtures.FIXTURE_MINT_WALLET, '0,0').run(); providers.base.state.tokenId = 42n;
  const metadata = await call('base', 'metadata'), metadataText = await metadata.text(); assert.equal(metadata.status, 200, metadataText); assert.equal(JSON.parse(metadataText).transaction.chainId, 8453); assert(!metadataText.includes('private-sentinel')); cases.push({ name: 'metadata-verified', status: metadata.status });
  providers.base.state.chainId = 84532; const badMetadata = await call('base', 'metadata'); assert.equal(badMetadata.status, 503, await badMetadata.text()); cases.push({ name: 'metadata-mismatch', status: badMetadata.status });
  assert.deepEqual(unexpected, []); writeFileSync(`${output}/report.json`, JSON.stringify({ accepted: true, freshBuild, cases, unexpectedOutbound: unexpected, productionRequests: 0, transactionsSubmitted: 0, realKeysUsed: false }, null, 2)); console.log('mint network service: native API passed');
} finally { f?.sqlite.close(); await mf?.dispose(); await loader.close(); }
