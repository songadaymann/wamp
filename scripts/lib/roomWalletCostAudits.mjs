import assert from 'node:assert/strict';

export const ROOM_WALLET_COST_CASES = ['cancel-consent', 'escape-consent', 'insufficient-balance', 'balance-unavailable',
  'balance-cancel', 'wallet-rejection', 'insufficient-funds', 'price-changed', 'expired-approval',
  'artwork-consent', 'account-consent', 'gate-consent', 'wallet-mismatch'];

/** Cost consent runs through actual controls before the isolated EIP-1193 wallet boundary. */
export async function auditRoomWalletCosts(h) {
  const { page, kind, audit, calls, click } = h;
  const approvals = () => page.evaluate(() => globalThis.__artworkWallet.approvals.length);
  const pending = () => page.evaluate(() => JSON.parse(localStorage.getItem('wamp:pending-room-wallet:v1') || '[]'));
  const sheet = () => page.locator('#busy-overlay[data-busy-state="confirmation"]').waitFor();
  const hidden = () => page.locator('#busy-overlay').waitFor({ state: 'hidden' });
  const validate = async () => {
    await sheet();
    for (const selector of ['#btn-busy-retry', '#btn-busy-close']) {
      const box = await page.locator(selector).boundingBox();
      assert(box && box.width >= 44 && box.height >= 44 && box.x >= 0 && box.y >= 0
        && box.x + box.width <= h.width + 1 && box.y + box.height <= h.height + 1, selector + ' ' + JSON.stringify(box));
    }
    assert.equal(await page.locator('#busy-overlay').getAttribute('role'), 'dialog');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-busy-close');
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-busy-retry');
    await page.keyboard.press('Shift+Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-busy-close');
    const text = await page.locator('#busy-overlay-status').innerText(); assert(text.includes('Base')); assert(text.includes('fee')); assert(!text.includes('$'));
    assert.deepEqual(await pending(), []);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${h.output}/${h.name}-cost.png` });
  };
  const unsent = async () => { assert.equal(await approvals(), 0); assert.deepEqual(await pending(), []);
    assert.equal(await page.evaluate(() => globalThis.__artworkWallet.bootstraps), 0); };
  const failure = async expected => {
    await page.locator('#busy-overlay[data-busy-state="error"]').waitFor();
    const text = await page.locator('#busy-overlay-status').innerText(); assert.match(text, expected);
    assert(!/Request Arguments|Docs:|Version: viem|0x[\da-f]{40}/i.test(text), text);
    assert.equal(await page.locator('#btn-busy-retry').textContent(), 'Try again');
    assert.deepEqual(await pending(), []);
    const retryStyle = await page.locator('#btn-busy-retry').evaluate(node => {
      const style = getComputedStyle(node);
      return { color: style.color, background: style.backgroundColor, opacity: style.opacity, disabled: node.disabled };
    });
    assert.equal(retryStyle.background, 'rgb(39, 123, 48)', 'Try again keeps its green action surface on touch hover');
    assert.equal(retryStyle.color, 'rgb(255, 243, 219)');
    audit.retryStyle = retryStyle;
    await page.screenshot({ path: `${h.output}/${h.name}-failure.png` });
  };
  await h.action();
  if (kind === 'balance-cancel') {
    await page.waitForFunction(() => document.getElementById('busy-overlay-status').textContent === 'Checking your balance...');
    await click('#btn-busy-close'); await hidden(); h.releaseBalance();
    await page.waitForTimeout(5_200); await unsent(); assert.equal(audit.publicRequests.filter(x => x === 'eth_getBalance').length, 1); return;
  }
  await validate(); await unsent();
  if (kind === 'account-consent') {
    h.setUser(false); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => !JSON.parse(window.render_game_to_text()).auth.authenticated);
    await hidden(); await unsent(); return;
  }
  if (kind === 'gate-consent') {
    await page.evaluate(() => { document.documentElement.dataset.wallet = 'no'; window.dispatchEvent(new CustomEvent('wallet-gate')); });
    await hidden(); await unsent();
    assert.equal(await page.locator('[data-crypto]').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden').length), 0);
    assert(!/ETH|wallet approval/i.test(await page.locator('#editor-top-save-status').innerText())); return;
  }
  if (kind === 'cancel-consent' || kind === 'escape-consent' || kind === 'balance-unavailable') {
    if (kind === 'balance-unavailable') assert((await page.locator('#busy-overlay-status').innerText()).includes('Balance unavailable'));
    if (kind === 'escape-consent') await page.keyboard.press('Escape'); else await click('#btn-busy-close');
    await hidden(); await unsent();
    assert.equal(await page.locator('#busy-overlay').getAttribute('role'), null); return;
  }
  if (kind === 'insufficient-balance') {
    assert((await page.locator('#busy-overlay-status').innerText()).includes('0.005 ETH'));
    assert.equal(await page.locator('#btn-busy-retry').textContent(), 'Check balance');
    await click('#btn-busy-retry'); await sheet(); await unsent();
    h.setBalance(100000000000000000n); await click('#btn-busy-retry'); await sheet(); await unsent();
    assert((await page.locator('#busy-overlay-status').innerText()).includes('0.1 ETH'));
    assert.equal(audit.publicRequests.filter(x => x === 'eth_getBalance').length, 3);
    await click('#btn-busy-retry'); await page.waitForFunction(() => globalThis.__artworkWallet.approvals.length === 1);
    await h.approve(false); await failure(/You cancelled/); await click('#btn-busy-close'); return;
  }
  await h.consent('mint');
  if (kind === 'wallet-mismatch') {
    await failure(/Switch to your linked wallet 0x2222…2222/);
    assert.equal(await approvals(), 0); assert.deepEqual(await pending(), []);
    await click('#btn-busy-close'); return;
  }
  await page.waitForFunction(() => globalThis.__artworkWallet.approvals.length === 1);
  if (kind === 'artwork-consent') {
    await h.approve(true); await validate();
    const text = await page.locator('#busy-overlay-status').innerText(); assert(text.includes('No extra collection charge')); assert(text.includes('network fee'));
    assert.equal(await approvals(), 1); assert.equal(calls.filter(x => x === 'confirm').length, 1);
    await click('#btn-busy-close');
    await page.locator('#busy-overlay[data-busy-state="error"]').waitFor();
    assert((await page.locator('#busy-overlay-status').innerText()).includes('already collected'));
    await click('#btn-busy-close'); assert.equal(await approvals(), 1); assert.deepEqual(await pending(), []); return;
  }
  await h.approve(kind !== 'wallet-rejection');
  await failure(kind === 'insufficient-funds' ? /more ETH on Base/ : kind === 'price-changed' ? /price changed/ : kind === 'expired-approval' ? /expired/ : /You cancelled/);
  assert.equal(calls.filter(x => x === 'prepare').length, 1, 'No automatic re-prepare after rejection');
  await click('#btn-busy-retry'); await sheet();
  assert.equal(await approvals(), 1, 'Retry needs another explicit cost confirmation');
  assert.equal(calls.filter(x => x === 'prepare').length, 2);
  if (kind === 'price-changed') {
    assert.equal(h.lastPrice(), '20000000000000000');
    assert((await page.locator('#busy-overlay-status').innerText()).includes('0.02 ETH'));
    await h.consent('mint', '0.02'); await page.waitForFunction(() => globalThis.__artworkWallet.approvals.length === 2);
    const value = await page.evaluate(() => globalThis.__artworkWallet.approvals[1].transaction.value);
    assert.equal(BigInt(value), 20000000000000000n);
    await h.approve(false); await failure(/You cancelled/); await click('#btn-busy-close');
  } else { await click('#btn-busy-close'); await hidden(); }
  assert.equal(calls.filter(x => x === 'confirm').length, 0); assert.deepEqual(await pending(), []);
}
