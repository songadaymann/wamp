import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

/** Isolated read-only SDK boundary; the application still runs its actual connection/auth code. */
export async function installReadOnlyWalletConnection(context, address) {
  const modules = [];
  await context.route(/\/index-[\w-]+\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch(); assert(response.ok());
    let body = await response.text();
    const sha256 = createHash('sha256').update(body).digest('hex');
    for (const [symbol, replacement] of [['createAppKit', 'globalThis.__readOnlyWalletFactory'], ['WagmiAdapter', 'globalThis.__readOnlyWalletAdapter']]) {
      const pattern = new RegExp('([,{])' + symbol + ':([A-Za-z_$][\\w$]*)', 'g');
      const matches = [...body.matchAll(pattern)];
      if (!matches.length) continue;
      assert.equal(matches.length, 1);
      assert(!body.includes('Your account or connected wallet changed.'), 'Only external SDK modules may be replaced');
      modules.push({ symbol, sha256, path: new URL(route.request().url()).pathname });
      body = body.replace(pattern, '$1' + symbol + ':' + replacement);
    }
    return route.fulfill({ response, body });
  });
  await context.addInitScript(address => {
    globalThis.__readOnlyWalletAdapter = class {};
    globalThis.__readOnlyWalletFactory = () => ({
      ready: async () => {}, open: async () => {}, getAddress: () => address,
      getAccount: () => ({ address, isConnected: true }), subscribeAccount: () => () => {},
      getWalletProvider: () => ({ request: async request => {
        if (request.method === 'eth_accounts' || request.method === 'eth_requestAccounts') return [address];
        if (request.method === 'personal_sign') return '0x' + '11'.repeat(65); // Verified by the isolated auth route fixture, never a real signer.
        if (request.method === 'eth_chainId') return '0x2105';
        throw new Error('Unexpected read-only wallet fixture method ' + request.method);
      } }),
    });
  }, address);
  return modules;
}
