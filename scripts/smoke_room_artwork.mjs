// Real app controls/auth sender/viem/renderer. Only HTTP APIs and the external wallet bootstrap/provider are fixtures.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import './lib/mutedBrowsers.mjs';
import { chromium, webkit } from 'playwright';
import { createServer } from 'vite';
import { encodeFunctionData, decodeFunctionData } from 'viem';
import { createMobileInputRoomFixtures } from './lib/mobileInputRoomFixture.mjs';
import { installMobileSignedFixture } from './lib/mobileSignedFixture.mjs';
import { ROOM_WALLET_RECOVERY_CASES, auditRoomWalletRecovery } from './lib/roomWalletRecoveryAudits.mjs';
import { ROOM_WALLET_COST_CASES, auditRoomWalletCosts } from './lib/roomWalletCostAudits.mjs';
const recoveryMode = process.argv.includes('--recovery');
const costMode = process.argv.includes('--costs');
const base = process.argv[2] || 'http://127.0.0.1:4198';
const output = process.argv[3] || 'output/web-game/room-artwork';
mkdirSync(output, { recursive: true });
const loader = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [], entries: [] }, appType: 'custom', logLevel: 'error' });
let abi, parseMetadata, recordTemplate;
try {
  ({ ROOM_OWNERSHIP_TOKEN_ABI: abi } = await loader.ssrLoadModule('/src/mint/roomOwnership.ts'));
  ({ parseRoomTokenMetadataUri: parseMetadata } = await loader.ssrLoadModule('/src/mint/roomMetadata.ts'));
  const { createDefaultRoomRecord } = await loader.ssrLoadModule('/src/persistence/roomModel.ts');
  recordTemplate = createDefaultRoomRecord('0,0', { x: 0, y: 0 });
} finally { await loader.close(); }
createMobileInputRoomFixtures('scripts/fixtures/mobile-smoke-api.json.gz', `${output}/api.json.gz`, { goalEnabled: !recoveryMode });
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
    for (const kind of costMode ? ROOM_WALLET_COST_CASES : recoveryMode ? ROOM_WALLET_RECOVERY_CASES : ['success', 'artwork-rejection', 'artwork-reverted', 'render-failure', 'confirm-failure', 'account-cancellation', 'account-roundtrip']) {
      if (process.env.ARTWORK_CASES && !process.env.ARTWORK_CASES.split(',').includes(kind)) continue;
      const name = `${device}-${kind}`, calls = [], errors = [], consoleErrors = [], unexpected = [], walletModules = [], backgroundRequests = [];
      const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
      const local = new URL(base);
      const audit = { requests: [], publicRequests: [], refreshes: 0, holdRefresh: false, publicReceiptStatus: null, expectedStatuses: [] };
      let chainMinted = kind.startsWith('no-wallet'), chainMetadataHash = null, chainMetadataVersion = null, owner = kind === 'no-wallet-readonly' ? '0x' + '3'.repeat(40) : wallet, draft = null;
      const refreshWaiters = [], draftWaiters = [];
      const balanceWaiters = [];
      let balanceWei = kind === 'insufficient-balance' ? 5000000000000000n : 100000000000000000n;
      const releaseBalance = () => { for (const release of balanceWaiters.splice(0)) release(); };
      let lastPrice = '10000000000000000';
      const releaseDraft = () => { for (const release of draftWaiters.splice(0)) release(); };
      let refreshStarted; const refreshReady = new Promise(resolve => { refreshStarted = resolve; });
      const releaseRefresh = () => { audit.holdRefresh = false; for (const release of refreshWaiters.splice(0)) release(); };
      if (recoveryMode) await context.exposeBinding('__roomWalletAudit', (_source, request) => {
        audit.requests.push(request);
        if (request.method === 'eth_sendTransaction') {
          assert.equal(request.params[0].chainId, '0x2105', 'The prepared chain must be present in the wallet request');
          return '0x' + audit.requests.filter(r => r.method === 'eth_sendTransaction').length.toString(16).padStart(64, '0');
        }
        return null;
      });
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
      const api = createMobileInputRoomFixtures('scripts/fixtures/mobile-smoke-api.json.gz', `${output}/${name}-api.json.gz`, { goalEnabled: !recoveryMode });
      await api.install(context); await installMobileSignedFixture(context, { roomEditor: true });
      if (local.hostname === '127.0.0.1') await context.routeWebSocket(u => u.hostname === local.hostname && u.port === local.port && u.pathname === '/', s => s.connectToServer());
      // Replace only the third-party lazy namespace factories. No application/auth/room/renderer code is changed.
      await context.route(/\/index-[\w-]+\.js(?:\?.*)?$/, async r => {
        const original = await r.fetch({ maxRetries: 1 }); assert(original.ok(), 'External wallet module fixture must read the served artifact'); let body = await original.text();
        const originalSha256 = createHash('sha256').update(body).digest('hex');
        for (const [symbol, replacement] of [['createAppKit', 'globalThis.__artworkWalletFactory'], ['WagmiAdapter', 'globalThis.__artworkWalletAdapter']]) {
          const pattern = new RegExp('([,{])' + symbol + ':([A-Za-z_$][\\w$]*)', 'g'); const matches = [...body.matchAll(pattern)];
          if (!matches.length) continue; assert.equal(matches.length, 1, 'One external wallet namespace ' + symbol);
          assert(!body.includes('Step 1 of 2: Collect & Lock') && !body.includes('Room collection was not completed.'), 'Application flow must remain unchanged');
          walletModules.push({ symbol, path: new URL(r.request().url()).pathname, originalSha256 });
          body = body.replace(pattern, '$1' + symbol + ':' + replacement);
        }
        return r.fulfill({ response: original, body });
      });
      await context.addInitScript(({ wallet, contract, kind, recoveryMode }) => {
        if (recoveryMode) {
          for (const event of ['beforeunload', 'pagehide', 'pageshow', 'visibilitychange']) {
            const target = event === 'visibilitychange' ? document : window;
            target.addEventListener(event, () => {
              const key = '__walletRecoveryLifecycle';
              try { localStorage.setItem(key, JSON.stringify([...JSON.parse(localStorage.getItem(key) || '[]'), { event, at: Date.now(), visibility: document.visibilityState }])); }
              catch { /* The initial about:blank document has no storage origin. */ }
            });
          }
        }
        localStorage.setItem('crypto-override', kind.startsWith('no-wallet') ? '0' : '1'); // This suite explicitly exercises the wallet-enabled flow.
        localStorage.setItem('wamp_welcome_modal_seen_v1', '1'); localStorage.setItem('wamp_replay_opt_out', '1');
        localStorage.setItem('wamp.settings.musicVolume', '0'); localStorage.setItem('wamp.settings.sfxVolume', '0');
        const state = { requests: [], approvals: [], pending: null, receiptHeld: false, bootstraps: 0 };
        if (kind.startsWith('no-wallet')) localStorage.setItem('wamp:pending-room-wallet:v1', JSON.stringify([{ id: 'hidden-recovery', kind: 'mint',
          roomId: '0,0', coordinates: { x: 0, y: 0 }, userId: 'mobile-smoke-fixture', wallet, chainId: 8453,
          contractAddress: contract, txHash: '0x' + '1'.repeat(64), tokenId: null, metadataHash: null, metadataRoomVersion: null, createdAt: Date.now() }]));
        if (kind === 'storage-failure') {
          const set = Storage.prototype.setItem;
          Storage.prototype.setItem = function(key, value) { if (key === 'wamp:pending-room-wallet:v1') throw new Error('Isolated storage quota'); return set.call(this, key, value); };
        }
        globalThis.__artworkWallet = state; globalThis.__artworkWalletAdapter = class {};
        const provider = { async request(q) {
          state.requests.push(q.method);
          const auditHash = recoveryMode ? await globalThis.__roomWalletAudit(q) : null;
          if (q.method === 'wallet_switchEthereumChain') return null;
          if (q.method === 'eth_accounts') return [kind === 'wallet-mismatch' ? '0x' + '3'.repeat(40) : wallet];
          if (q.method === 'eth_chainId') return kind === 'network-change' ? '0x14a34' : '0x2105';
          if (q.method === 'eth_blockNumber') return '0x10';
          if (q.method === 'eth_sendTransaction') {
            const hash = auditHash || '0x' + (state.approvals.length + 1).toString(16).padStart(64, '0');
            state.approvals.push({ hash, transaction: q.params[0] });
            return new Promise((resolve, reject) => { state.pending = approve => {
              state.pending = null;
              if (!approve) return reject(Object.assign(new Error('User rejected artwork'), { code: 4001 }));
              if (state.approvals.length === 1 && kind === 'insufficient-funds') return reject(Object.assign(new Error('insufficient funds for gas * price + value'), { code: -32000 }));
              if (state.approvals.length === 1 && kind === 'price-changed') return reject(Object.assign(new Error('execution reverted: Incorrect mint price.'), { code: 3 }));
              if (state.approvals.length === 1 && kind === 'expired-approval') return reject(Object.assign(new Error('execution reverted: Mint authorization expired.'), { code: 3 }));
              resolve(hash);
            }; });
          }
          if (q.method === 'eth_getTransactionReceipt' && state.receiptHeld) return null;
          if (q.method === 'eth_getTransactionReceipt') return { transactionHash: q.params[0], blockHash: '0x' + 'b'.repeat(64), blockNumber: '0x10', transactionIndex: '0x0', from: wallet, to: contract,
            cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x1', contractAddress: null, logs: [], logsBloom: '0x' + '0'.repeat(512), status: kind === 'artwork-reverted' && q.params[0] === '0x' + '2'.padStart(64, '0') ? '0x0' : '0x1', type: '0x2' };
          throw new Error('Unexpected isolated wallet method ' + q.method);
        } };
        globalThis.__artworkWalletFactory = () => {
          state.bootstraps++;
          if (recoveryMode) void globalThis.__roomWalletAudit({ method: 'wallet_bootstrap' });
          return { ready: () => kind === 'bootstrap-close' ? new Promise(resolve => { state.bootstrapRelease = resolve; }) : Promise.resolve(), getAddress: () => wallet,
            getAccount: () => ({ address: wallet, isConnected: true }), subscribeAccount: () => () => {}, getWalletProvider: () => provider };
        };
      }, { wallet, contract, kind, recoveryMode });
      let minted = kind.startsWith('no-wallet'), metadataHash = null, preparedMetadataHash = null, metadataVersion = null, failConfirm = kind === 'confirm-failure' || kind === 'artwork-confirm-reload', activeUser = true;
      const snapshot = { ...sourceSnapshot, title: 'Artwork test room', background: 'solid:#294e67',
        ...(recoveryMode ? { goal: null, goalIntroText: null } : {}) };
      if (kind === 'render-failure') snapshot.placedObjects = [{ id: 'unresolved-artwork-fixture', x: 100, y: 100, layer: 'terrain' }];
      const summary = () => ({ ...sourceSummary, title: snapshot.title, claimerUserId: 'mobile-smoke-fixture',
        mintedChainId: minted ? 8453 : null, mintedContractAddress: minted ? contract : null, mintedTokenId: minted ? '42' : null, mintedOwnerWalletAddress: minted ? owner : null,
        mintedOwnerSyncedAt: minted ? snapshot.updatedAt : null, mintedMetadataUpdatedAt: metadataVersion === null ? null : snapshot.updatedAt,
        mintedMetadataRoomVersion: metadataVersion, mintedMetadataHash: metadataHash,
        permissions: { canSaveDraft: !minted || owner === wallet, canPublish: !minted || owner === wallet, canRevert: false, canMint: !minted } });
      const record = () => ({ ...recordTemplate, ...summary(), draft: draft || snapshot, published: snapshot });
      const reply = (r, json, status = 200) => r.fulfill({ status, json, headers: { 'access-control-allow-origin': r.request().headers().origin || local.origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' } });
      await context.route(u => u.pathname.startsWith('/api/'), r => {
        if (new URL(r.request().url()).origin === 'https://mann.cool' && new URL(r.request().url()).pathname === '/api/v1/plays'
          && ['POST', 'OPTIONS'].includes(r.request().method())) {
          backgroundRequests.push({ origin: 'https://mann.cool', path: '/api/v1/plays', method: r.request().method() });
          return r.fulfill({ status: 200, json: { success: true },
            headers: { 'access-control-allow-origin': local.origin, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS' } });
        }
        if (r.request().method() === 'OPTIONS') return reply(r, {}, 204);
        const path = new URL(r.request().url()).pathname;
        if ((path === '/api/settings/me' && r.request().method() === 'PUT') || (path === '/api/guest-activity/heartbeat' && r.request().method() === 'POST')) {
          backgroundRequests.push({ path, method: r.request().method() }); return r.fallback();
        }
        if (['GET', 'HEAD'].includes(r.request().method()) || new URL(r.request().url()).pathname === '/api/rooms/snapshots/query') return r.fallback();
        unexpected.push({ method: r.request().method(), path: new URL(r.request().url()).pathname }); return reply(r, { error: 'Unexpected fixture write' }, 503);
      });
      await context.route(u => u.pathname === '/api/me/cleared-rooms', r => reply(r, { userId: 'mobile-smoke-fixture', roomIds: [], nextCursor: null }));
      await context.route(u => u.pathname === '/api/world/tiles/config', r => reply(r, { schemaVersion: 1, available: false, rolloutPercentage: 0 }));
      await context.route(u => u.pathname === '/api/auth/session', r => reply(r, { authenticated: activeUser, source: 'session', user: activeUser ? { id: 'mobile-smoke-fixture', walletAddress: wallet, displayName: 'Artwork test', email: null } : null,
        walletProjectId: 'public-test-project-id', partykitHost: '', schoolManaged: false, school: null, chatModeration: { role: 'none', banned: false } }));
      await context.route(u => u.pathname === '/api/rooms/0%2C0/summary', r => reply(r, summary()));
      await context.route(u => u.pathname === '/api/rooms/0%2C0/current', r => reply(r, { summary: summary(), draft: draft || snapshot, published: snapshot }));
      await context.route(u => u.pathname === '/api/rooms/0%2C0/published', r => reply(r, snapshot));
      await context.route('https://mainnet.base.org/', async r => {
        if (r.request().method() === 'OPTIONS') return reply(r, {}, 204);
        const q = r.request().postDataJSON(); audit.publicRequests.push(q.method);
        if (q.method === 'eth_getBalance') {
          assert.deepEqual(q.params, [wallet, 'latest']);
          if (kind === 'balance-cancel') await new Promise(resolve => balanceWaiters.push(resolve));
          const result = kind === 'balance-unavailable' ? { error: { code: -32000, message: 'Isolated balance unavailable' } }
            : { result: '0x' + balanceWei.toString(16) };
          try { return await reply(r, { jsonrpc: '2.0', id: q.id, ...result }); } catch { return; }
        }
        assert(recoveryMode && ['eth_chainId', 'eth_getTransactionReceipt'].includes(q.method));
        return reply(r, { jsonrpc: '2.0', id: q.id, result: q.method === 'eth_chainId' ? '0x2105'
          : audit.publicReceiptStatus ? { transactionHash: q.params[0], from: wallet, to: contract, blockNumber: '0x10', status: audit.publicReceiptStatus } : null });
      });
      if (recoveryMode) {
        await context.route(u => u.pathname === '/api/rooms/0%2C0/versions', r => reply(r, { versions: [{ version: snapshot.version, title: snapshot.title,
          createdAt: snapshot.publishedAt || snapshot.updatedAt, publishedByUserId: sourceSummary.claimerUserId, publishedByPrincipalKind: 'user',
          publishedByAgentId: null, publishedByDisplayName: sourceSummary.claimerDisplayName, revertedFromVersion: null, leaderboardSourceVersion: null }] }));
        await context.route(u => u.pathname === '/api/rooms/snapshots/query', r => {
          const references = r.request().postDataJSON()?.references;
          if (!Array.isArray(references) || !references.length || !references.every(ref => ref.kind === 'version' && ref.roomId === '0,0' && ref.version === snapshot.version)) return r.fallback();
          return reply(r, { snapshots: [{ key: `version:0,0:${snapshot.version}`, snapshot }], missing: [] });
        });
        await context.route(u => u.pathname === '/api/rooms/0%2C0/ownership/refresh', async r => {
          if (r.request().method() === 'OPTIONS') return reply(r, {}, 204);
          assert.equal(r.request().method(), 'POST'); audit.refreshes++; refreshStarted();
          if (audit.holdRefresh) await new Promise(resolve => refreshWaiters.push(resolve));
          minted = chainMinted; metadataHash = chainMetadataHash; metadataVersion = chainMetadataVersion;
          try { return await reply(r, summary()); } catch { /* The test may have cancelled this captured request. */ }
        });
        await context.route(u => u.pathname === '/api/rooms/0%2C0/draft', async r => {
          if (r.request().method() === 'OPTIONS') return reply(r, {}, 204);
          assert.equal(r.request().method(), 'PUT'); draft = r.request().postDataJSON();
          if (kind === 'dirty-recovery') await new Promise(resolve => draftWaiters.push(resolve));
          try { return await reply(r, { summary: { ...summary(), draftTitle: draft.title }, draft, published: snapshot }); } catch { /* Context can close after the assertion. */ }
        });
      }
      let releasePrepare = () => {}, prepareStarted;
      const prepareReady = new Promise(resolve => { prepareStarted = resolve; });
      await context.route(u => u.pathname.startsWith('/api/rooms/0%2C0/mint/'), async r => {
        if (r.request().method() === 'OPTIONS') return reply(r, {}, 204);
        assert.equal(r.request().method(), 'POST'); const path = new URL(r.request().url()).pathname, body = r.request().postDataJSON(); calls.push(path.split('/mint/')[1]);
        if (path.endsWith('/mint/prepare')) {
          lastPrice = kind === 'price-changed' && calls.filter(c => c === 'prepare').length > 1 ? '20000000000000000' : '10000000000000000';
          return reply(r, { roomId: '0,0', roomCoordinates: { x: 0, y: 0 }, linkedWalletAddress: wallet, contractAddress: contract, priceWei: lastPrice, chain, transaction: { to: contract, data: mintData, value: lastPrice, chainId: 8453 } });
        }
        if (path.endsWith('/mint/confirm')) {
          if (recoveryMode && (kind === 'mint-confirm-reload' || !chainMinted)) { audit.expectedStatuses.push(503); return reply(r, { error: 'Isolated mint confirmation unavailable' }, 503); }
          minted = true; return reply(r, record());
        }
        if (path.endsWith('/metadata/prepare')) {
          const metadata = parseMetadata(body.tokenUri); assert.equal(metadata.wamp_room.roomId, '0,0'); assert.equal(metadata.wamp_room.version, snapshot.version);
          assert(metadata.image.startsWith('data:image/svg+xml,')); assert.equal(metadata.external_url, 'https://wamp.land/r/0/0');
          assert(body.tokenUri.length <= 20000, 'Artwork fits the conservative fresh-storage budget');
          const artwork = decodeURIComponent(metadata.image.slice('data:image/svg+xml,'.length));
          assert(artwork.includes('image-rendering:pixelated') && artwork.includes('href="data:image/png;base64,'));
          preparedMetadataHash = createHash('sha256').update(body.tokenUri).digest('hex'); prepareStarted();
          if (kind === 'account-cancellation' || kind === 'account-roundtrip') await new Promise(resolve => { releasePrepare = resolve; });
          return reply(r, { chain, transaction: { to: contract, data: encodeFunctionData({ abi, functionName: 'setRoomTokenURI', args: [0, 0, body.tokenUri] }), value: '0', chainId: 8453 } });
        }
        assert(path.endsWith('/metadata/confirm')); assert.equal(body.metadataHash, preparedMetadataHash); assert.equal(body.metadataRoomVersion, snapshot.version);
        if (failConfirm) { failConfirm = false; audit.expectedStatuses.push(503); return reply(r, { error: 'Isolated confirmation outage' }, 503); }
        metadataVersion = body.metadataRoomVersion; metadataHash = body.metadataHash; return reply(r, record());
      });
      const page = await context.newPage(); page.setDefaultTimeout(30_000);
      const requestFailures = [], pageErrorDetails = [];
      page.on('requestfailed', r => requestFailures.push({ at: Date.now(), url: r.url(), error: r.failure()?.errorText }));
      page.on('pageerror', e => pageErrorDetails.push({ at: Date.now(), message: e.message, stack: e.stack }));
      page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      const click = selector => touch ? page.locator(selector).tap() : page.locator(selector).click();
      const markChain = artwork => { chainMinted = true; if (artwork) { chainMetadataHash = preparedMetadataHash; chainMetadataVersion = snapshot.version; } };
      const approve = async (value, { mine = true } = {}) => {
        await page.waitForFunction(() => typeof globalThis.__artworkWallet?.pending === 'function');
        if (recoveryMode && value && mine) { const n = await page.evaluate(() => globalThis.__artworkWallet.approvals.length); markChain(n > 1); }
        await page.evaluate(value => globalThis.__artworkWallet.pending(value), value);
      };
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
      const consent = async (stage = 'mint', expected = '0.01') => {
        await page.locator('#busy-overlay[data-busy-state="confirmation"]').waitFor();
        const text = await page.locator('#busy-overlay-status').textContent();
        assert(text.includes(stage === 'mint' ? `Collect & Lock for ${expected} ETH on Base.` : 'Add artwork on Base. No extra collection charge.'));
        assert(text.includes('fee'));
        if (stage === 'mint') assert(text.includes('separate transaction with its own fee'));
        assert.equal(await page.locator('#btn-busy-retry').textContent(), 'Continue to wallet');
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('wamp:pending-room-wallet:v1') || '[]').length), 0, 'Consent cannot reserve a submitted/unknown intent');
        await page.screenshot({ path: `${output}/${name}-${stage}-consent.png` });
        await click('#btn-busy-retry');
      };
      const enterEditor = async () => {
        await page.waitForFunction(() => document.body.dataset.appReady === 'true', null, { timeout: 120_000 });
        const current = await page.evaluate(() => JSON.parse(window.render_game_to_text()).activeScene);
        if (current?.scene === 'editor') return;
        if (current?.mode === 'play') {
          await page.locator('#room-goal-intro-modal').waitFor({ state: 'visible' });
          await click('#btn-room-goal-intro-start');
          await click(touch ? '#btn-mobile-world-stop' : '#btn-world-play');
          await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene?.mode === 'browse');
        }
        if (touch) { await click('#btn-world-jump-sheet'); await page.locator('#mobile-world-jump-input').fill('0,0'); await click('#btn-mobile-world-jump-go'); }
        else { await page.locator('#world-jump-input').fill('0,0'); await click('#btn-world-jump'); }
        await page.waitForFunction(() => { const s = JSON.parse(window.render_game_to_text()).activeScene; return s?.mode === 'browse' && s.selected.x === 0 && s.selected.y === 0; });
        if (kind === 'no-wallet-readonly') return;
        await click('#btn-world-edit'); await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene?.scene === 'editor');
      };
      try {
        await page.goto(`${base}/?welcome=0&renderer=${engine === webkit && process.platform === 'linux' ? 'canvas' : 'webgl'}`);
        await enterEditor();
        if (costMode) {
          await auditRoomWalletCosts({ page, context, kind, name, output, audit, calls, width, height, click, consent, action: artworkAction, approve,
            setBalance: value => { balanceWei = value; }, releaseBalance, setUser: value => { activeUser = value; }, lastPrice: () => lastPrice });
          assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(api.report().misses, {});
          reports.push({ name, accepted: true, costs: true, audit, calls, errors, unexpected, realTransactions: 0 });
          console.log(`${name}: collection cost passed`); continue;
        }
        if (recoveryMode) {
          await auditRoomWalletRecovery({ page, context, kind, name, output, audit, width, height, click, consent, enterEditor, approve, action: artworkAction, markChain,
            walletModules, version: snapshot.version, claimerDisplayName: sourceSummary.claimerDisplayName, transferOwner: () => { owner = '0x' + '3'.repeat(40); }, releaseDraft, waitForRefresh: () => refreshReady, releaseRefresh, setUser: value => { activeUser = value; }, metadataHash: () => metadataHash,
            supersedeArtwork: () => { chainMetadataHash = 'b'.repeat(64); chainMetadataVersion = snapshot.version; } });
          assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); assert.deepEqual(api.report().misses, {});
          const expectedErrors = consoleErrors.filter(e => audit.expectedStatuses.some(status => new RegExp(String(status)).test(e)));
          assert.deepEqual(consoleErrors.filter(e => !expectedErrors.includes(e)), []);
          const layout = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth }));
          assert(layout.scroll <= width + 1 && layout.inner <= width + 1, JSON.stringify(layout));
          await page.screenshot({ path: `${output}/${name}-after.png` });
          reports.push({ name, accepted: true, recovery: true, audit, calls, walletModules, layout, errors, expectedErrors, unexpected,
            fixtureMisses: api.report().misses, realTransactions: 0 });
          console.log(`${name}: wallet recovery passed`); continue;
        }
        assert.equal(await page.locator('#btn-mint-room').textContent(), 'Collect & Lock');
        assert.equal(await page.locator('[data-editor-share-action="collect"] [data-editor-share-label]').textContent(), 'Collect & Lock');
        await artworkAction(); await consent('mint'); await page.waitForFunction(() => globalThis.__artworkWallet?.approvals.length === 1);
        assert.equal(await page.locator('#busy-overlay-title').textContent(), 'Step 1 of 2: Collect & Lock');
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
          await consent('artwork');
          await page.waitForFunction(() => globalThis.__artworkWallet?.approvals.length === 2);
          assert.equal(await page.locator('#busy-overlay-title').textContent(), 'Step 2 of 2: Add artwork');
          await page.screenshot({ path: `${output}/${name}-artwork.png` }); await approve(kind !== 'artwork-rejection');
          if (kind === 'artwork-rejection' || kind === 'artwork-reverted' || kind === 'confirm-failure') {
            await acknowledgePending();
            await artworkAction(); if (kind === 'artwork-rejection' || kind === 'artwork-reverted') { await consent('artwork'); await approve(true); }
          }
          await page.waitForFunction(() => /Room artwork is saved\./i.test(document.body.textContent || ''));
          await page.locator('#busy-overlay').waitFor({ state: 'hidden' });
          assert.equal(metadataVersion, snapshot.version);
        }
        if (!['account-cancellation', 'account-roundtrip'].includes(kind)) {
          const link = page.locator('#editor-collectible-link');
          await link.scrollIntoViewIfNeeded();
          assert(await link.isVisible(), 'The collectible destination is reachable in Room Setup');
          const bounds = await link.boundingBox();
          assert(bounds && bounds.width >= 44 && bounds.height >= 44 && bounds.x >= 0
            && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1,
            'The collectible destination has an on-screen touch target: ' + JSON.stringify(bounds));

          assert.equal(await link.textContent(), 'View collectible');
          const href = new URL(await link.getAttribute('href'), base);
          assert.equal(href.origin, new URL(base).origin);
          assert.equal(href.pathname, '/minted-room.html');
          assert.deepEqual(Object.fromEntries(href.searchParams), { chainId: '8453', contract, tokenId: '42' });
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
        const lifecycle = await page.evaluate(() => localStorage.getItem('__walletRecoveryLifecycle')).catch(() => null);
        writeFileSync(`${output}/${name}-failure.json`, JSON.stringify({ error: String(error), calls, errors, pageErrorDetails, requestFailures, lifecycle, consoleErrors, unexpected, walletModules, fixtures: api.report() }, null, 2)); throw error;
      } finally { releasePrepare(); releaseRefresh(); releaseDraft(); await context.close(); }
    }
  } finally { await browser.close(); }
}
writeFileSync(`${output}/report.json`, JSON.stringify({ accepted: true, cases: reports, realTransactions: 0, walletBoundary: 'External AppKit/Wagmi namespace factories and EIP-1193 provider only; application flow and viem are unchanged' }, null, 2));
