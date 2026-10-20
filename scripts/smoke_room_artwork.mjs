// Real app controls/auth sender/viem/renderer. Only HTTP APIs and the external wallet bootstrap/provider are fixtures.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { chromium, webkit } from 'playwright';
import { createServer } from 'vite';
import { encodeFunctionData, decodeFunctionData } from 'viem';
import { createMobileInputRoomFixtures } from './lib/mobileInputRoomFixture.mjs';
import { installMobileSignedFixture } from './lib/mobileSignedFixture.mjs';
const base = process.argv[2] || 'http://127.0.0.1:4198';
const output = process.argv[3] || 'output/web-game/room-artwork';
mkdirSync(output, { recursive: true });
const loader = await createServer({ configFile: false, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [], entries: [] }, appType: 'custom', logLevel: 'error' });
let abi, parseMetadata, recordTemplate;
try {
  ({ ROOM_OWNERSHIP_TOKEN_ABI: abi } = await loader.ssrLoadModule('/src/mint/roomOwnership.ts'));
  ({ parseRoomTokenMetadataUri: parseMetadata } = await loader.ssrLoadModule('/src/mint/roomMetadata.ts'));
  const { createDefaultRoomRecord } = await loader.ssrLoadModule('/src/persistence/roomModel.ts');
  recordTemplate = createDefaultRoomRecord('0,0', { x: 0, y: 0 });
} finally { await loader.close(); }
createMobileInputRoomFixtures('scripts/fixtures/mobile-smoke-api.json.gz', `${output}/api.json.gz`);
const recorded = JSON.parse(gunzipSync(readFileSync(`${output}/api.json.gz`)));
const sourceSnapshot = JSON.parse(recorded.entries.find(e => e.path === '/api/rooms/0%2C0/published').text);
const sourceSummary = JSON.parse(recorded.entries.find(e => e.path === '/api/rooms/0%2C0/summary').text);
const wallet = '0x2222222222222222222222222222222222222222', contract = '0x1111111111111111111111111111111111111111';
const chain = { chainId: 8453, name: 'Base', rpcUrl: 'https://rpc.invalid', blockExplorerUrl: 'https://explorer.invalid', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } };
const mintData = encodeFunctionData({ abi, functionName: 'mintRoom', args: [0, 0, wallet, 2000000000n, '0x' + '00'.repeat(65)] });
const reports = [];
for (const [device, engine, width, height, touch] of [['desktop', chromium, 1280, 800, false], ['narrow-phone', chromium, 320, 568, true], ['safari-phone', webkit, 390, 844, true], ['tablet', chromium, 768, 1024, true]]) {
  if (process.env.ARTWORK_PROFILES && !process.env.ARTWORK_PROFILES.split(',').includes(device)) continue;
  const browser = await engine.launch({ args: engine === chromium ? ['--mute-audio'] : [] });
  try {
    for (const kind of ['success', 'artwork-rejection', 'artwork-reverted', 'render-failure', 'confirm-failure', 'account-cancellation', 'account-roundtrip']) {
      if (process.env.ARTWORK_CASES && !process.env.ARTWORK_CASES.split(',').includes(kind)) continue;
      const name = `${device}-${kind}`, calls = [], errors = [], consoleErrors = [], unexpected = [], walletModules = [], backgroundRequests = [];
      const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
      const local = new URL(base);
      await context.route('**/*', r => {
        const u = new URL(r.request().url());
        if (u.origin === local.origin && r.request().method() === 'GET') return r.continue();
        if (u.hostname === 'static.cloudflareinsights.com' && u.pathname === '/beacon.min.js' && r.request().method() === 'GET') {
          return r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* Analytics is disabled in isolated artwork verification. */' });
        }
        if (u.hostname === 'cloudflareinsights.com' && u.pathname === '/cdn-cgi/rum') return r.fulfill({ status: 204,
          headers: { 'access-control-allow-origin': r.request().headers().origin || local.origin, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS' } });
        if (u.hostname === 'mann.cool' && u.pathname === '/api/v1/plays') return r.fulfill({ json: { success: true } });
        unexpected.push({ method: r.request().method(), url: u.href }); return r.abort();
      });
      const api = createMobileInputRoomFixtures('scripts/fixtures/mobile-smoke-api.json.gz', `${output}/${name}-api.json.gz`);
      await api.install(context); await installMobileSignedFixture(context, { roomEditor: true });
      if (local.hostname === '127.0.0.1') await context.routeWebSocket(u => u.hostname === local.hostname && u.port === local.port && u.pathname === '/', s => s.connectToServer());
      // Replace only the third-party lazy namespace factories. No application/auth/room/renderer code is changed.
      await context.route(/\/index-[\w-]+\.js(?:\?.*)?$/, async r => {
        const original = await r.fetch(); let body = await original.text();
        const originalSha256 = createHash('sha256').update(body).digest('hex');
        for (const [symbol, replacement] of [['createAppKit', 'globalThis.__artworkWalletFactory'], ['WagmiAdapter', 'globalThis.__artworkWalletAdapter']]) {
          const pattern = new RegExp('([,{])' + symbol + ':([A-Za-z_$][\\w$]*)', 'g'); const matches = [...body.matchAll(pattern)];
          if (!matches.length) continue; assert.equal(matches.length, 1, 'One external wallet namespace ' + symbol);
          assert(!body.includes('Step 1 of 2: Collect room') && !body.includes('Room collection was not completed.'), 'Application flow must remain unchanged');
          walletModules.push({ symbol, path: new URL(r.request().url()).pathname, originalSha256 });
          body = body.replace(pattern, '$1' + symbol + ':' + replacement);
        }
        return r.fulfill({ response: original, body });
      });
      await context.addInitScript(({ wallet, contract, kind }) => {
        localStorage.setItem('crypto-override', '1'); // This suite explicitly exercises the wallet-enabled flow.
        localStorage.setItem('wamp_welcome_modal_seen_v1', '1'); localStorage.setItem('wamp_replay_opt_out', '1');
        localStorage.setItem('wamp.settings.musicVolume', '0'); localStorage.setItem('wamp.settings.sfxVolume', '0');
        const state = { requests: [], approvals: [], pending: null, rejectNextArtwork: kind === 'artwork-rejection' };
        globalThis.__artworkWallet = state; globalThis.__artworkWalletAdapter = class {};
        const provider = { async request(q) {
          state.requests.push(q.method);
          if (q.method === 'wallet_switchEthereumChain') return null;
          if (q.method === 'eth_accounts') return [wallet];
          if (q.method === 'eth_blockNumber') return '0x10';
          if (q.method === 'eth_sendTransaction') {
            const hash = '0x' + (state.approvals.length + 1).toString(16).padStart(64, '0');
            state.approvals.push({ hash, transaction: q.params[0] });
            return new Promise((resolve, reject) => { state.pending = approve => {
              state.pending = null;
              if (!approve) return reject(Object.assign(new Error('User rejected artwork'), { code: 4001 }));
              resolve(hash);
            }; });
          }
          if (q.method === 'eth_getTransactionReceipt') return { transactionHash: q.params[0], blockHash: '0x' + 'b'.repeat(64), blockNumber: '0x10', transactionIndex: '0x0', from: wallet, to: contract,
            cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x1', contractAddress: null, logs: [], logsBloom: '0x' + '0'.repeat(512), status: kind === 'artwork-reverted' && q.params[0] === '0x' + '2'.padStart(64, '0') ? '0x0' : '0x1', type: '0x2' };
          throw new Error('Unexpected isolated wallet method ' + q.method);
        } };
        globalThis.__artworkWalletFactory = () => ({ ready: async () => {}, getAddress: () => wallet,
          getAccount: () => ({ address: wallet, isConnected: true }), subscribeAccount: () => () => {}, getWalletProvider: () => provider });
      }, { wallet, contract, kind });
      let minted = false, metadataHash = null, preparedMetadataHash = null, metadataVersion = null, failConfirm = kind === 'confirm-failure', activeUser = true;
      const snapshot = { ...sourceSnapshot, title: 'Artwork test room', background: 'solid:#294e67' };
      if (kind === 'render-failure') snapshot.placedObjects = [{ id: 'unresolved-artwork-fixture', x: 100, y: 100, layer: 'terrain' }];
      const summary = () => ({ ...sourceSummary, title: snapshot.title, claimerUserId: 'mobile-smoke-fixture',
        mintedChainId: minted ? 8453 : null, mintedContractAddress: minted ? contract : null, mintedTokenId: minted ? '42' : null, mintedOwnerWalletAddress: minted ? wallet : null,
        mintedOwnerSyncedAt: minted ? snapshot.updatedAt : null, mintedMetadataUpdatedAt: metadataVersion === null ? null : snapshot.updatedAt,
        mintedMetadataRoomVersion: metadataVersion, mintedMetadataHash: metadataHash,
        permissions: { canSaveDraft: true, canPublish: true, canRevert: false, canMint: !minted } });
      const record = () => ({ ...recordTemplate, ...summary(), draft: snapshot, published: snapshot });
      const reply = (r, json, status = 200) => r.fulfill({ status, json, headers: { 'access-control-allow-origin': r.request().headers().origin || local.origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' } });
      await context.route(u => u.pathname.startsWith('/api/'), r => {
        if (r.request().method() === 'OPTIONS') return reply(r, {}, 204);
        const path = new URL(r.request().url()).pathname;
        if ((path === '/api/settings/me' && r.request().method() === 'PUT') || (path === '/api/guest-activity/heartbeat' && r.request().method() === 'POST')) {
          backgroundRequests.push({ path, method: r.request().method() }); return r.fallback();
        }
        if (['GET', 'HEAD'].includes(r.request().method()) || new URL(r.request().url()).pathname === '/api/rooms/snapshots/query') return r.fallback();
        unexpected.push({ method: r.request().method(), path: new URL(r.request().url()).pathname }); return reply(r, { error: 'Unexpected fixture write' }, 503);
      });
      await context.route(u => u.pathname === '/api/world/tiles/config', r => reply(r, { schemaVersion: 1, available: false, rolloutPercentage: 0 }));
      await context.route(u => u.pathname === '/api/auth/session', r => reply(r, { authenticated: activeUser, source: 'session', user: activeUser ? { id: 'mobile-smoke-fixture', walletAddress: wallet, displayName: 'Artwork test', email: null } : null,
        walletProjectId: 'public-test-project-id', partykitHost: '', schoolManaged: false, school: null, chatModeration: { role: 'none', banned: false } }));
      await context.route(u => u.pathname === '/api/rooms/0%2C0/summary', r => reply(r, summary()));
      await context.route(u => u.pathname === '/api/rooms/0%2C0/current', r => reply(r, { summary: summary(), draft: snapshot, published: snapshot }));
      await context.route(u => u.pathname === '/api/rooms/0%2C0/published', r => reply(r, snapshot));
      let releasePrepare = () => {}, prepareStarted;
      const prepareReady = new Promise(resolve => { prepareStarted = resolve; });
      await context.route(u => u.pathname.startsWith('/api/rooms/0%2C0/mint/'), async r => {
        if (r.request().method() === 'OPTIONS') return reply(r, {}, 204);
        assert.equal(r.request().method(), 'POST'); const path = new URL(r.request().url()).pathname, body = r.request().postDataJSON(); calls.push(path.split('/mint/')[1]);
        if (path.endsWith('/mint/prepare')) return reply(r, { roomId: '0,0', roomCoordinates: { x: 0, y: 0 }, linkedWalletAddress: wallet, contractAddress: contract, priceWei: '10000000000000000', chain, transaction: { to: contract, data: mintData, value: '10000000000000000', chainId: 8453 } });
        if (path.endsWith('/mint/confirm')) { minted = true; return reply(r, record()); }
        if (path.endsWith('/metadata/prepare')) {
          const metadata = parseMetadata(body.tokenUri); assert.equal(metadata.wamp_room.roomId, '0,0'); assert.equal(metadata.wamp_room.version, snapshot.version); assert(metadata.image.startsWith('data:image/png;base64,'));
          preparedMetadataHash = createHash('sha256').update(body.tokenUri).digest('hex'); prepareStarted();
          if (kind === 'account-cancellation' || kind === 'account-roundtrip') await new Promise(resolve => { releasePrepare = resolve; });
          return reply(r, { chain, transaction: { to: contract, data: encodeFunctionData({ abi, functionName: 'setRoomTokenURI', args: [0, 0, body.tokenUri] }), value: '0', chainId: 8453 } });
        }
        assert(path.endsWith('/metadata/confirm')); assert.equal(body.metadataHash, preparedMetadataHash); assert.equal(body.metadataRoomVersion, snapshot.version);
        if (failConfirm) { failConfirm = false; return reply(r, { error: 'Isolated confirmation outage' }, 503); }
        metadataVersion = body.metadataRoomVersion; metadataHash = body.metadataHash; return reply(r, record());
      });
      const page = await context.newPage(); page.setDefaultTimeout(30_000);
      page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      const click = selector => touch ? page.locator(selector).tap() : page.locator(selector).click();
      const approve = async value => { await page.waitForFunction(() => typeof globalThis.__artworkWallet?.pending === 'function'); await page.evaluate(value => globalThis.__artworkWallet.pending(value), value); };
      const acknowledgePending = async () => {
        await page.locator('#busy-overlay[data-busy-state="error"]').waitFor();
        assert.equal(await page.locator('#busy-overlay-title').textContent(), 'Room collected');
        assert.match(await page.locator('#busy-overlay-status').textContent(), /already collected|without another wallet approval/);
        const box = await page.locator('#btn-busy-close').boundingBox(); assert(box && box.width >= 44 && box.height >= 44, JSON.stringify(box));
        await page.screenshot({ path: `${output}/${name}-pending.png` }); await click('#btn-busy-close');
      };
      const artworkAction = async () => {
        await page.locator('#busy-overlay').waitFor({ state: 'hidden' });
        if (!await page.locator('[data-editor-share-action="collect"]').isVisible()) await click('[data-editor-shell-action="room"]');
        const box = await page.locator('[data-editor-share-action="collect"]').boundingBox();
        assert(box && box.width >= 44 && box.height >= 44, JSON.stringify(box));
        await click('[data-editor-share-action="collect"]');
      };
      try {
        await page.goto(`${base}/?welcome=0&renderer=${engine === webkit && process.platform === 'linux' ? 'canvas' : 'webgl'}`);
        await page.waitForFunction(() => document.body.dataset.appReady === 'true', null, { timeout: 120_000 });
        if (touch) { await click('#btn-world-jump-sheet'); await page.locator('#mobile-world-jump-input').fill('0,0'); await click('#btn-mobile-world-jump-go'); }
        else { await page.locator('#world-jump-input').fill('0,0'); await click('#btn-world-jump'); }
        await page.waitForFunction(() => { const s = JSON.parse(window.render_game_to_text()).activeScene; return s?.mode === 'browse' && s.selected.x === 0 && s.selected.y === 0; });
        await click('#btn-world-edit'); await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene?.scene === 'editor');
        await artworkAction(); await page.waitForFunction(() => globalThis.__artworkWallet?.approvals.length === 1);
        assert.equal(await page.locator('#busy-overlay-title').textContent(), 'Step 1 of 2: Collect room');
        await page.screenshot({ path: `${output}/${name}-collect.png` }); await approve(true);
        if (kind === 'render-failure') {
          await acknowledgePending();
          await page.locator('#busy-overlay').waitFor({ state: 'hidden' }); assert(minted); assert.deepEqual(calls, ['prepare', 'confirm']);
        } else if (kind === 'account-cancellation' || kind === 'account-roundtrip') {
          await prepareReady; activeUser = false; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
          await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).auth.authenticated === false);
          if (kind === 'account-roundtrip') { activeUser = true; await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).auth.authenticated === true); }
          releasePrepare();
          await page.locator('#busy-overlay').waitFor({ state: 'hidden' });
        } else {
          await page.waitForFunction(() => globalThis.__artworkWallet?.approvals.length === 2);
          assert.equal(await page.locator('#busy-overlay-title').textContent(), 'Step 2 of 2: Add artwork');
          await page.screenshot({ path: `${output}/${name}-artwork.png` }); await approve(kind !== 'artwork-rejection');
          if (kind === 'artwork-rejection' || kind === 'artwork-reverted' || kind === 'confirm-failure') {
            await acknowledgePending();
            await artworkAction(); if (kind === 'artwork-rejection' || kind === 'artwork-reverted') await approve(true);
          }
          await page.waitForFunction(() => /Room artwork is saved\./i.test(document.body.textContent || ''));
          await page.locator('#busy-overlay').waitFor({ state: 'hidden' });
          assert.equal(metadataVersion, snapshot.version);
        }
        const approvals = await page.evaluate(() => globalThis.__artworkWallet.approvals);
        assert.equal(approvals.length, ['render-failure', 'account-cancellation', 'account-roundtrip'].includes(kind) ? 1 : ['artwork-rejection', 'artwork-reverted'].includes(kind) ? 3 : 2);
        assert.equal(decodeFunctionData({ abi, data: approvals[0].transaction.data }).functionName, 'mintRoom');
        for (const approval of approvals.slice(1)) { assert.equal(decodeFunctionData({ abi, data: approval.transaction.data }).functionName, 'setRoomTokenURI'); assert.equal(approval.transaction.value, '0x0'); }
        assert.equal(calls.filter(c => c === 'prepare').length, 1); assert.equal(calls.filter(c => c === 'confirm').length, 1);
        assert.deepEqual(calls, kind === 'render-failure' ? ['prepare', 'confirm'] : ['account-cancellation', 'account-roundtrip'].includes(kind) ? ['prepare', 'confirm', 'metadata/prepare']
          : ['artwork-rejection', 'artwork-reverted'].includes(kind) ? ['prepare', 'confirm', 'metadata/prepare', 'metadata/prepare', 'metadata/confirm']
          : kind === 'confirm-failure' ? ['prepare', 'confirm', 'metadata/prepare', 'metadata/confirm', 'metadata/confirm']
          : ['prepare', 'confirm', 'metadata/prepare', 'metadata/confirm']);
        const finalState = await page.evaluate(() => JSON.parse(window.render_game_to_text()).activeScene); assert.equal(finalState.mintedTokenId, '42');
        if (kind !== 'account-cancellation') await page.waitForFunction(() => document.querySelector('#btn-refresh-room-metadata')?.disabled === false);
        const layout = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth })); assert(layout.scroll <= width + 1 && layout.inner <= width + 1, JSON.stringify(layout));
        if (kind === 'confirm-failure') { assert.equal(calls.filter(c => c === 'metadata/prepare').length, 1); assert.equal(calls.filter(c => c === 'metadata/confirm').length, 2); }
        assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); assert.deepEqual(api.report().misses, {});
        const expectedErrors = kind === 'confirm-failure' ? consoleErrors.filter(e => /503|Service Unavailable/.test(e)) : [];
        assert.deepEqual(consoleErrors.filter(e => !expectedErrors.includes(e)), []);
        assert(walletModules.some(m => m.symbol === 'createAppKit')); assert(walletModules.some(m => m.symbol === 'WagmiAdapter'));
        await page.screenshot({ path: `${output}/${name}-after.png` });
        reports.push({ name, accepted: true, walletApprovalRequests: approvals.length, calls, walletModules, layout, fixtureMisses: api.report().misses, errors, expectedErrors, unexpected, interceptedBackgroundRequests: backgroundRequests, realTransactions: 0 });
        console.log(`${name}: artwork flow passed`);
      } catch (error) {
        await page.screenshot({ path: `${output}/${name}-failure.png` });
        writeFileSync(`${output}/${name}-failure.json`, JSON.stringify({ error: String(error), calls, errors, consoleErrors, unexpected, walletModules, fixtures: api.report() }, null, 2)); throw error;
      } finally { releasePrepare(); await context.close(); }
    }
  } finally { await browser.close(); }
}
writeFileSync(`${output}/report.json`, JSON.stringify({ accepted: true, cases: reports, realTransactions: 0, walletBoundary: 'External AppKit/Wagmi namespace factories and EIP-1193 provider only; application flow and viem are unchanged' }, null, 2));
