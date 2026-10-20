import { chromium, webkit } from 'playwright';
import { createServer } from 'vite';
import { encodeFunctionResult } from 'viem';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const base = process.argv[2] || 'http://127.0.0.1:4198', output = process.argv[3] || 'output/web-game/mint-network';
mkdirSync(output, { recursive: true });
const loader = await createServer({ configFile: false, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [], entries: [] }, appType: 'custom', logLevel: 'error' });
let tokenUri, abi;
try {
  const { createDefaultRoomSnapshot } = await loader.ssrLoadModule('/src/persistence/roomModel.ts');
  const { buildRoomTokenMetadata } = await loader.ssrLoadModule('/src/mint/roomMetadata.ts');
  ({ ROOM_OWNERSHIP_TOKEN_ABI: abi } = await loader.ssrLoadModule('/src/mint/roomOwnership.ts'));
  const room = createDefaultRoomSnapshot('0,0', { x: 0, y: 0 }); room.title = 'Network preview'; room.status = 'published'; room.version = 1;
  for (let y = 20; y < 22; y++) for (let x = 0; x < 40; x++) room.tileData.terrain[y][x] = 1;
  ({ tokenUri } = await buildRoomTokenMetadata(room, 'data:image/png;base64,iVBORw0KGgo=', { origin: base, chainId: 8453, contractAddress: '0x1111111111111111111111111111111111111111', tokenId: '42' }));
} finally { await loader.close(); }
const reports = [], expectedError = 'This preview link is missing a valid network. Open the room from WAMP to get its full link.';
for (const [profile, engine, width, height, touch] of [['desktop', chromium, 1280, 800, false], ['narrow-phone', chromium, 320, 568, true], ['safari-phone', webkit, 390, 844, true], ['tablet', chromium, 768, 1024, true]]) {
  if (process.env.MINT_NETWORK_PROFILES && !process.env.MINT_NETWORK_PROFILES.split(',').includes(profile)) continue;
  const browser = await engine.launch({ args: engine === chromium ? ['--mute-audio'] : [] }); const cases = [], unexpected = []; let page;
  try {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
    const rpc = []; await context.route(u => ['mainnet.base.org', 'sepolia.base.org', 'eth.merkle.io'].includes(u.hostname), route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS' } });
      const q = route.request().postDataJSON(); assert.equal(q.method, 'eth_call'); rpc.push({ host: new URL(route.request().url()).hostname, method: q.method });
      return route.fulfill({ json: { jsonrpc: '2.0', id: q.id, result: encodeFunctionResult({ abi, functionName: 'tokenURI', result: tokenUri }) }, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS' } });
    });
    await context.route(u => u.pathname.startsWith('/api/'), route => { unexpected.push(new URL(route.request().url()).pathname); return route.fulfill({ status: 503, body: 'Unexpected fixture request' }); });
    for (const [name, chainId, host, label] of [['base', '8453', 'mainnet.base.org', 'Base'], ['sepolia', '84532', 'sepolia.base.org', 'Base Sepolia'], ['ethereum', '1', 'eth.merkle.io', 'Ethereum'], ['missing', null, null, null], ['invalid', '8453junk', null, null], ['unsupported', '999999', null, null], ['no-wallet', '8453', 'mainnet.base.org', null]]) {
      page = await context.newPage(); const errors = [], consoleErrors = [], before = rpc.length;
      page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      const query = new URLSearchParams({ crypto: name === 'no-wallet' ? '0' : '1', contract: '0x1111111111111111111111111111111111111111', tokenId: '42' }); if (chainId !== null) query.set('chainId', chainId);
      await page.goto(`${base}/minted-room.html?${query}`);
      if (host) {
        await page.waitForFunction(expected => document.querySelector('#minted-room-preview-status')?.textContent === expected,
          name === 'no-wallet' ? 'Room preview ready.' : 'Rendered from on-chain tokenURI metadata.');
        assert.equal(await page.locator('#minted-room-title').textContent(), 'Network preview');
        if (name === 'no-wallet') {
          assert(!/Chain |Token|NFT|0x[\da-f]{8}|Explorer/i.test(await page.locator('body').innerText()));
          assert.equal(await page.locator('[data-crypto]').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length).length), 0);
        } else assert((await page.locator('#minted-room-meta').textContent()).includes('Chain ' + label));
        const canvas = await page.locator('#minted-room-preview canvas').evaluate(c => ({ width: c.width, height: c.height })); assert.deepEqual(canvas, { width: 240, height: 132 });
        assert.equal(rpc.length, before + 1); assert.equal(rpc.at(-1).host, host); assert.deepEqual(consoleErrors, []);
      } else {
        await page.locator('#minted-room-error:not(.hidden)').waitFor(); assert.equal(await page.locator('#minted-room-title').textContent(), 'Preview unavailable'); const text = await page.locator('#minted-room-error-text').textContent();
        assert.equal(text, name === 'unsupported' ? 'Unsupported chain 999999.' : expectedError); assert.equal(rpc.length, before); assert.equal(consoleErrors.length, 1); assert(consoleErrors[0].startsWith('Failed to render minted room')); assert(consoleErrors[0].includes(text));
      }
      const layout = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth })); assert(layout.scroll <= width + 1 && layout.inner <= width + 1, JSON.stringify(layout));
      assert.deepEqual(errors, []); await page.screenshot({ path: `${output}/${profile}-${name}.png`, fullPage: true });
      cases.push({ name, ok: true, rpcRequests: rpc.length - before, errors, expectedCaughtErrors: host ? 0 : consoleErrors.length }); console.log(`${profile}-${name}: mint network passed`); await page.close(); page = null;
    }
    await context.route(u => u.pathname === '/api/jam', r => r.fulfill({ json: { openAt: '2026-07-20T00:00:00Z', closeAt: '2026-07-27T00:00:00Z',
      registrationOpen: false, submissionsOpen: false, turnstileSiteKey: null, turnstileRequired: false },
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,OPTIONS' } }));
    await context.route(u => u.pathname === '/api/auth/session', r => r.fulfill({ json: { authenticated: false, user: null },
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,OPTIONS' } }));
    for (const force of ['0', '1']) {
      page = await context.newPage(); const errors = [], before = rpc.length;
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/jam.html?crypto=${force}`);
      await page.waitForFunction(expected => document.documentElement.dataset.wallet === expected, force === '1' ? 'yes' : 'no');
      const copy = await page.locator('body').innerText();
      assert(copy.includes('USD through PayPal')); assert.equal(copy.includes('USDC to an Ethereum wallet address'), force === '1');
      assert.equal(rpc.length, before); assert.deepEqual(errors, []);
      await page.screenshot({ path: `${output}/${profile}-jam-gate-${force}.png`, fullPage: true });
      cases.push({ name: `jam-gate-${force}`, ok: true, rpcRequests: 0, errors });
      console.log(`${profile}-jam-gate-${force}: mint network passed`);
      await page.close(); page = null;
    }
    assert.deepEqual(unexpected, []); reports.push({ profile, ok: true, cases, unexpected, realRpcRequests: 0, transactionsSubmitted: 0 });
  } catch (error) { if (page && !page.isClosed()) await page.screenshot({ path: `${output}/${profile}-failure.png`, fullPage: true }); writeFileSync(`${output}/${profile}-failure.json`, JSON.stringify({ error: String(error), cases, unexpected }, null, 2)); throw error; }
  finally { await browser.close(); }
}
writeFileSync(`${output}/report.json`, JSON.stringify(reports, null, 2));
