// Real app controls, viem and native API/D1; only the external wallet and unrelated APIs are fixtures.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { chromium, webkit } from 'playwright';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createApiFixtures } from './lib/apiFixtures.mjs';
import { installMobileSignedFixture } from './lib/mobileSignedFixture.mjs';
import { startWalletAuthFixture } from './lib/walletAuthServiceFixture.mjs';

const base = process.argv[2] || 'http://127.0.0.1:4198', output = process.argv[3] || 'output/web-game/wallet-auth';
const bundle = process.argv[4] || 'output/web-game/wallet-auth-service/api/worker.js';
mkdirSync(output, { recursive: true });
const service = await startWalletAuthFixture(bundle), reports = [];
const recorded = JSON.parse(gunzipSync(readFileSync('scripts/fixtures/mobile-smoke-api.json.gz')));
const profile = JSON.parse(recorded.entries.find(e => e.path.includes('/profiles/') && e.path.endsWith('/summary')).text);
try {
  for (const [device, engine, width, height, touch] of [['desktop', chromium, 1280, 800, false], ['narrow-phone', chromium, 320, 568, true], ['safari-phone', webkit, 390, 844, true], ['tablet', chromium, 768, 1024, true]]) {
    if (process.env.WALLET_AUTH_PROFILES && !process.env.WALLET_AUTH_PROFILES.split(',').includes(device)) continue;
    const browser = await engine.launch({ args: engine === chromium ? ['--mute-audio'] : [] });
    try {
      for (const kind of ['sign-in', 'link', 'conflict', 'existing-wallet', 'reject', 'wallet-change', 'account-change', 'gate-change', 'no-wallet']) {
        if (process.env.WALLET_AUTH_CASES && !process.env.WALLET_AUTH_CASES.split(',').includes(kind)) continue;
        const name = `${device}-${kind}`, wallet = privateKeyToAccount(generatePrivateKey());
        const other = privateKeyToAccount(generatePrivateKey());
        await service.db.batch([service.db.prepare('DELETE FROM sessions'), service.db.prepare('DELETE FROM wallet_challenges'),
          service.db.prepare("UPDATE users SET wallet_address=NULL WHERE id IN ('builder','p1')")]);
        if (kind === 'conflict') await service.db.prepare("UPDATE users SET wallet_address=? WHERE id='p1'").bind(wallet.address.toLowerCase()).run();
        if (kind === 'existing-wallet') await service.db.prepare("UPDATE users SET wallet_address=? WHERE id='builder'").bind(other.address.toLowerCase()).run();
        const originalCookie = ['sign-in', 'no-wallet'].includes(kind) ? undefined : await service.createSession('builder');
        let cookie = originalCookie;
        const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
        const api = createApiFixtures({ mode: 'replay', file: 'scripts/fixtures/mobile-smoke-api.json.gz' });
        const calls = [], errors = [], expectedErrors = [], unexpected = [], modules = [];
        const reply = (r, json, status = 200) => r.fulfill({ json, status, headers: { 'access-control-allow-origin': r.request().headers().origin || new URL(base).origin,
          'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS' } });
        await context.route('**/*', r => {
          const u = new URL(r.request().url());
          if (u.origin === new URL(base).origin && r.request().method() === 'GET') return r.continue();
          if (u.hostname === 'static.cloudflareinsights.com' && u.pathname === '/beacon.min.js') return r.fulfill({ contentType: 'application/javascript', body: '/* Isolated verification. */' });
          if (u.hostname === 'cloudflareinsights.com' && u.pathname === '/cdn-cgi/rum') return reply(r, {});
          if (u.hostname === 'mann.cool' && u.pathname === '/api/v1/plays') return reply(r, { success: true });
          unexpected.push({ method: r.request().method(), url: u.href }); return r.abort();
        });
        await api.install(context); await installMobileSignedFixture(context);
        await context.route(u => u.pathname === '/api/world/tiles/config', r => reply(r, { schemaVersion: 1, available: false, rolloutPercentage: 0 }));
        await context.route(u => /^\/api\/profiles\/[^/]+\/summary$/.test(u.pathname), r => {
          const id = new URL(r.request().url()).pathname.split('/')[3];
          return reply(r, { ...profile, userId: id, displayName: id === 'builder' ? 'builder' : id === 'p1' ? 'p1' : 'Wallet player', selectedAvatarId: null });
        });
        await context.route(u => u.pathname.startsWith('/api/auth/'), async r => {
          if (r.request().method() === 'OPTIONS') return reply(r, {}, 204);
          const path = new URL(r.request().url()).pathname.slice('/api/auth/'.length);
          calls.push({ path, method: r.request().method() });
          const response = await service.call(path, r.request().method() === 'GET' ? undefined : r.request().postDataJSON(), cookie, new URL(base).origin);
          const setCookie = response.headers.get('set-cookie');
          if (setCookie) cookie = /^ep_session=([^;]+)/.exec(setCookie)?.[1];
          const json = await response.json();
          if (path === 'session') { json.partykitHost = ''; json.partykitParty = ''; }
          return reply(r, json, response.status);
        });
        await context.route(/\/index-[\w-]+\.js(?:\?.*)?$/, async r => {
          const original = await r.fetch(); assert(original.ok()); let body = await original.text();
          const sha256 = createHash('sha256').update(body).digest('hex');
          for (const [symbol, replacement] of [['createAppKit', 'globalThis.__authWalletFactory'], ['WagmiAdapter', 'globalThis.__authWalletAdapter']]) {
            const pattern = new RegExp('([,{])' + symbol + ':([A-Za-z_$][\\w$]*)', 'g'), matches = [...body.matchAll(pattern)];
            if (!matches.length) continue; assert.equal(matches.length, 1);
            assert(!body.includes('Your account or connected wallet changed.'), 'Application auth code must remain unchanged');
            modules.push({ symbol, path: new URL(r.request().url()).pathname, sha256 }); body = body.replace(pattern, '$1' + symbol + ':' + replacement);
          }
          return r.fulfill({ response: original, body });
        });
        await context.exposeBinding('__signWalletProof', (_source, raw) => wallet.signMessage({ message: { raw } }));
        await context.addInitScript(({ address, other, kind }) => {
          localStorage.setItem('crypto-override', kind === 'no-wallet' ? '0' : '1');
          localStorage.setItem('wamp_welcome_modal_seen_v1', '1'); localStorage.setItem('wamp_replay_opt_out', '1');
          localStorage.setItem('wamp.settings.musicVolume', '0'); localStorage.setItem('wamp.settings.sfxVolume', '0');
          const listeners = new Set();
          const state = { address, other, signatures: [], methods: [], bootstraps: 0, pending: null,
            switch: next => { state.address = next; for (const listener of listeners) listener({ address: next, isConnected: true }); } };
          globalThis.__authWallet = state; globalThis.__authWalletAdapter = class {};
          const provider = { request: async q => {
            state.methods.push(q.method);
            if (q.method === 'eth_accounts') return [state.address];
            if (q.method === 'personal_sign') {
              state.signatures.push({ message: q.params[0], address: q.params[1] });
              return new Promise((resolve, reject) => { state.pending = accepted => {
                state.pending = null;
                if (!accepted) reject(Object.assign(new Error('Native approval rejected'), { code: 4001 }));
                else globalThis.__signWalletProof(q.params[0]).then(resolve, reject);
              }; });
            }
            throw new Error('Unexpected wallet method ' + q.method);
          } };
          globalThis.__authWalletFactory = () => {
            state.bootstraps++;
            return { ready: async () => {}, getAddress: () => state.address, getAccount: () => ({ address: state.address, isConnected: true }),
              subscribeAccount: listener => { listeners.add(listener); return () => listeners.delete(listener); }, getWalletProvider: () => provider };
          };
        }, { address: wallet.address, other: other.address, kind });
        const page = await context.newPage(); page.setDefaultTimeout(30_000);
        const click = selector => touch ? page.locator(selector).tap() : page.locator(selector).click();
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', message => {
          if (message.type() !== 'error') return;
          if (message.text().startsWith('Failed to load resource:') && message.location().url.includes('/api/auth/') && /409/.test(message.text())) expectedErrors.push(message.text());
          else errors.push(message.text());
        });
        try {
          const renderer = engine === webkit && process.platform === 'linux' ? 'canvas' : 'webgl';
          await page.goto(`${base}/?welcome=0&renderer=${renderer}`);
          await page.waitForFunction(() => document.body.dataset.appReady === 'true');
          await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
          await click('#menu-toggle');
          if (!['sign-in', 'no-wallet'].includes(kind) && !await page.locator('#account-signin-options').evaluate(el => el.open)) await click('#account-signin-options > summary');
          if (kind === 'no-wallet') {
            assert.equal(await page.locator('#btn-auth-wallet').isVisible(), false);
            assert.equal(await page.locator('[data-crypto]').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden').length), 0);
            assert.equal(modules.length, 0); assert.equal(await page.evaluate(() => globalThis.__authWallet.bootstraps), 0);
          } else {
            const box = await page.locator('#btn-auth-wallet').boundingBox(); assert(box && box.width >= 44 && box.height >= (touch ? 44 : 32), JSON.stringify(box));
            await click('#btn-auth-wallet');
            if (kind !== 'existing-wallet') {
              await page.waitForFunction(() => globalThis.__authWallet.signatures.length === 1 && typeof globalThis.__authWallet.pending === 'function');
              const signedText = await page.evaluate(() => new TextDecoder().decode(Uint8Array.from(globalThis.__authWallet.signatures[0].message.slice(2).match(/../g), s => parseInt(s, 16))));
              assert(signedText.includes(kind === 'sign-in' ? 'sign in with your wallet' : 'builder (builder)'));
              if (kind === 'wallet-change') await page.evaluate(() => { globalThis.__authWallet.switch(globalThis.__authWallet.other); });
              if (kind === 'gate-change') await page.evaluate(() => { document.documentElement.dataset.wallet = 'no'; window.dispatchEvent(new CustomEvent('wallet-gate')); });
              if (kind === 'account-change') {
                cookie = await service.createSession('p1'); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
                // The loading UI may still show the old account; the server must enforce the actual cookie.
                assert.equal(await page.evaluate(() => JSON.parse(window.render_game_to_text()).auth.loading), true);
              }
              await page.evaluate(accept => globalThis.__authWallet.pending(accept), kind !== 'reject');
            }
            await page.waitForFunction(() => !JSON.parse(window.render_game_to_text()).auth.loading);
            const state = await page.evaluate(() => JSON.parse(window.render_game_to_text()).auth);
            assert(state.user || ['sign-in', 'reject'].includes(kind), JSON.stringify(state));
            const verified = calls.filter(c => c.path === 'wallet/verify');
            assert.equal(verified.length, ['sign-in', 'link', 'conflict', 'account-change'].includes(kind) ? 1 : 0);
            if (kind === 'sign-in' || kind === 'link') {
              assert.equal(state.user.walletAddress, wallet.address.toLowerCase());
              if (kind === 'link') assert.equal(state.user.id, 'builder');
            } else {
              assert.equal(state.user?.walletAddress ?? null, kind === 'existing-wallet' ? other.address.toLowerCase() : null);
              assert.match(state.status, kind === 'conflict' ? /Log out of WAMP/ : kind === 'existing-wallet' ? /Switch your wallet app/ : kind === 'reject' ? /approval cancelled/ : kind === 'account-change' ? /Your sign-in changed/ : /account or connected wallet changed/);
              if (kind === 'account-change') {
                assert.equal(state.user.id, 'p1');
                assert.equal((await service.db.prepare("SELECT wallet_address FROM users WHERE id='builder'").first()).wallet_address, null);
              }
              if (kind !== 'gate-change') { assert(await page.locator('#auth-status').isVisible()); assert((await page.locator('#auth-status').innerText()).includes(state.status)); }
              else {
                assert(!/wallet|ETH|NFT/i.test(await page.locator('#auth-status').innerText()));
                assert.equal(await page.locator('[data-crypto]').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden').length), 0);
              }
            }
            assert(modules.some(m => m.symbol === 'createAppKit')); assert(modules.some(m => m.symbol === 'WagmiAdapter'));
            if (kind !== 'gate-change') {
              // The disabled-to-enabled background transition must settle on the readable action color.
              await page.waitForFunction(() => {
                const node = document.getElementById('btn-auth-wallet');
                return !node.disabled && getComputedStyle(node).backgroundColor === 'rgb(39, 123, 48)';
              });
              const style = await page.locator('#btn-auth-wallet').evaluate(node => {
                const computed = getComputedStyle(node); return { background: computed.backgroundColor, color: computed.color, disabled: node.disabled };
              });
              assert.equal(style.disabled, false); assert.equal(style.background, 'rgb(39, 123, 48)'); assert.equal(style.color, 'rgb(255, 243, 219)');
            }
          }
          assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); assert.deepEqual(api.report().misses, {});
          const layout = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
          assert(layout.scroll <= width + 1 && layout.width <= width + 1, JSON.stringify(layout));
          await page.screenshot({ path: `${output}/${name}.png` });
          reports.push({ name, accepted: true, calls, modules, errors, expectedErrors, unexpected, layout, realTransactions: 0 });
          process.stdout.write(`${name}: wallet authentication passed\n`);
          writeFileSync(`${output}/report.json`, JSON.stringify({ accepted: false, cases: reports, productionRequests: 0, transactionsSubmitted: 0 }, null, 2));
        } catch (error) {
          await page.screenshot({ path: `${output}/${name}-failed.png` });
          writeFileSync(`${output}/${name}-failed.json`, JSON.stringify({ error: String(error), calls, errors, expectedErrors, unexpected, modules, fixtures: api.report(),
            state: await page.evaluate(() => window.render_game_to_text?.()).catch(() => null) }, null, 2)); throw error;
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
  assert.deepEqual(service.unexpected, []);
  writeFileSync(`${output}/report.json`, JSON.stringify({ accepted: true, cases: reports, productionRequests: 0, transactionsSubmitted: 0 }, null, 2));
} finally { await service.close(); }
