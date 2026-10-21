import assert from 'node:assert/strict';

export const ROOM_WALLET_RECOVERY_CASES = [
  'bootstrap-close', 'mint-close', 'artwork-close', 'mint-check', 'artwork-check',
  'mint-reload', 'artwork-reload', 'mint-unhashed-reload', 'artwork-unhashed-reload', 'mint-return', 'artwork-return',
  'mint-confirm-reload', 'artwork-confirm-reload', 'receipt-close',
  'late-hash-navigation', 'unknown-dedup', 'account-check-cancel', 'no-wallet', 'no-wallet-readonly',
  'storage-failure', 'reverted-reload', 'superseded-artwork', 'dirty-recovery', 'transferred-owner', 'network-change',
];
const KEY = 'wamp:pending-room-wallet:v1';

/** Actual controls and application code; only wallet/network responses are fixtures. */
export async function auditRoomWalletRecovery(h) {
  const { page, kind, audit, output, name } = h;
  const pending = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), KEY);
  const approvals = () => audit.requests.filter(r => r.method === 'eth_sendTransaction').length;
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()).activeScene);
  const holdReceipts = value => page.evaluate(value => { globalThis.__artworkWallet.receiptHeld = value; }, value);
  const unlocked = async () => {
    await page.locator('#busy-overlay').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => {
      const s = JSON.parse(window.render_game_to_text()).activeScene;
      return s?.scene !== 'editor' || !s.canSaveDraft || document.querySelector(s.mintedTokenId ? '#btn-refresh-room-metadata' : '#btn-mint-room')?.disabled === false;
    });
  };
  const controls = async () => {
    for (const id of ['#btn-busy-close', '#btn-busy-retry']) {
      const button = page.locator(id); await button.waitFor({ state: 'visible' });
      const b = await button.boundingBox(); assert(b && b.width >= 44 && b.height >= 44, `${id} ${JSON.stringify(b)}`);
      assert(b.x >= 0 && b.y >= 0 && b.x + b.width <= h.width + 1 && b.y + b.height <= h.height + 1);
    }
    assert.equal(await page.locator('#btn-busy-retry').textContent(), 'Check again');
    await page.screenshot({ path: `${output}/${name}-wait.png` });
  };
  const close = async () => { await controls(); await h.click('#btn-busy-close'); await unlocked(); };
  const dismissResult = async () => {
    await page.waitForFunction(() => { const root = document.getElementById('busy-overlay'); return root.classList.contains('hidden') || root.dataset.busyState === 'error'; });
    if (await page.locator('#busy-overlay').isVisible()) await h.click('#btn-busy-close');
    await unlocked();
  };
  const waitRecovered = async expected => {
    await page.waitForFunction(expected => {
      const s = JSON.parse(window.render_game_to_text()).activeScene;
      return s?.scene === 'editor' && s.mintedTokenId === '42';
    }, expected);
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '[]').length === 0, KEY);
    if (expected === 'artwork') {
      await dismissResult();
      if (!await page.locator('[data-editor-room-action="history"]').isVisible()) await h.click('[data-editor-shell-action="room"]');
      await h.click('[data-editor-room-action="history"]');
      await page.locator('#room-history-modal').waitFor({ state: 'visible' });
      await page.waitForFunction(version => document.getElementById('room-history-meta').textContent.includes(`NFT metadata current at v${version}`), h.version);
      await h.click('#btn-room-history-close');
    }
  };
  const returnToTab = async () => {
    // Exercise the real visibility/focus handlers; this is a browser lifecycle fixture, not a physical iOS claim.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus'));
    });
  };

  if (kind.startsWith('no-wallet')) {
    assert.equal(await page.evaluate(() => document.documentElement.dataset.wallet), 'no');
    if (kind === 'no-wallet-readonly') {
      assert.equal((await state()).scene, 'overworld-play');
      await page.waitForFunction(() => document.getElementById('btn-world-edit').disabled
        && document.getElementById('world-hud').textContent.includes('This room is protected.'));
      assert.equal(await page.locator('#btn-world-edit').isDisabled(), true);
      assert.equal(await page.locator('#btn-world-play').isDisabled(), false);
      assert(!/Minted|token owner|linked wallet/i.test(await page.locator('#world-hud').innerText()));
    } else {
      await h.click('[data-editor-shell-action="room"]');
      await h.click('[data-editor-room-action="history"]');
      await page.locator('#room-history-modal').waitFor({ state: 'visible' });
      assert(!/Token #|NFT|0x[\da-f]{8}/i.test(await page.locator('#room-history-meta').innerText()));
      await page.locator('#btn-room-history-close').click();
      if (!await page.locator('#menu-toggle').isVisible()) {
        await h.click('#btn-editor-phone-menu'); await h.click('#btn-editor-phone-account');
      } else await h.click('#menu-toggle');
      assert.equal(await page.locator('#btn-auth-wallet').isVisible(), false);
      assert(!/wallet|mint|NFT|0x[\da-f]{8}/i.test(await page.locator('#auth-panel').innerText()));
    }
    assert.equal(await page.locator('[data-crypto]').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden').length), 0);
    await returnToTab(); await page.waitForTimeout(5_000);
    assert.equal(audit.refreshes, 0); assert.equal(approvals(), 0); assert.equal(audit.publicRequests.length, 0);
    assert.equal(audit.requests.filter(r => r.method === 'wallet_bootstrap').length, 0);
    assert.equal(h.walletModules.length, 0); return;
  }

  await h.action();
  await h.consent('mint');
  if (kind === 'network-change') {
    await page.locator('#busy-overlay[data-busy-state="error"]').waitFor();
    assert.match(await page.locator('#busy-overlay-status').innerText(), /Switch your wallet to Base/);
    await h.click('#btn-busy-close'); await unlocked(); assert.equal(approvals(), 0); assert.deepEqual(await pending(), []);
    assert(audit.requests.some(r => r.method === 'eth_chainId')); return;
  }
  if (kind === 'bootstrap-close') {
    await page.waitForFunction(() => typeof globalThis.__artworkWallet?.bootstrapRelease === 'function');
    await close(); await page.evaluate(() => globalThis.__artworkWallet.bootstrapRelease());
    await page.waitForTimeout(300); assert.equal(approvals(), 0); assert.deepEqual(await pending(), []); return;
  }
  await page.waitForFunction(() => typeof globalThis.__artworkWallet?.pending === 'function');
  const artwork = kind.startsWith('artwork-') || kind === 'superseded-artwork';
  if (artwork) {
    await h.approve(true); await h.consent('artwork'); await page.waitForFunction(() => globalThis.__artworkWallet?.approvals.length === 2);
  }
  await holdReceipts(true); await controls();
  const expectedApprovals = artwork ? 2 : 1;
  assert.equal(approvals(), expectedApprovals);

  if (kind === 'storage-failure') {
    assert.match(await page.locator('#busy-overlay-status').innerText(), /Keep this tab open/);
    await close(); await h.approve(true); await h.action();
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene?.mintedTokenId === '42');
    await dismissResult(); assert.equal(approvals(), 1); assert.deepEqual(await pending(), []); return;
  }
  if (kind === 'mint-close' || kind === 'artwork-close') {
    await close(); await h.approve(true);
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '[]').some(p => /^0x[\da-f]{64}$/i.test(p.txHash)), KEY);
    await h.action(); await dismissResult(); await waitRecovered(artwork ? 'artwork' : 'mint');
  } else if (kind === 'mint-check' || kind === 'artwork-check') {
    // Chain approval completed, but the wallet has not returned its hash yet.
    // Check again closes the waiting overlay before its asynchronous result is ready.
    h.markChain(artwork); await h.click('#btn-busy-retry'); await waitRecovered(artwork ? 'artwork' : 'mint'); await dismissResult();
    await h.approve(true); // Late hash belongs to the captured operation, never a new approval.
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '[]').some(p => p.txHash), KEY);
    await returnToTab(); await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '[]').length === 0, KEY);
  } else if (kind.includes('reload')) {
    if (kind.includes('confirm-reload')) await holdReceipts(false);
    if (kind === 'reverted-reload') audit.publicReceiptStatus = '0x0';
    if (kind.includes('unhashed')) {
      h.markChain(artwork);
      assert.equal((await pending()).at(-1).txHash, null, 'the wallet has not returned its hash before reload');
    } else {
      await h.approve(true, { mine: kind !== 'reverted-reload' });
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '[]').some(p => p.txHash), KEY);
    }
    if (kind.includes('confirm-reload')) await page.waitForFunction(() => /without another wallet approval/.test(document.body.textContent));
    const bootstraps = audit.requests.filter(r => r.method === 'wallet_bootstrap').length;
    await page.reload(); await h.enterEditor();
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '[]').length === 0, KEY);
    if (kind === 'reverted-reload') {
      assert.equal((await state()).mintedTokenId, null);
      await dismissResult(); await h.action();
      await h.consent('mint');
      await page.waitForFunction(() => typeof globalThis.__artworkWallet?.pending === 'function');
      assert.equal(approvals(), 2); await close(); await h.approve(false); return;
    }
    await waitRecovered(artwork ? 'artwork' : 'mint');
    assert.equal(audit.requests.filter(r => r.method === 'wallet_bootstrap').length, bootstraps, 'reload recovery must not bootstrap a wallet');
    await dismissResult();
  } else if (kind === 'mint-return' || kind === 'artwork-return' || kind === 'superseded-artwork') {
    await h.approve(true);
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '[]').some(p => p.txHash), KEY);
    if (kind === 'superseded-artwork') { audit.publicReceiptStatus = '0x1'; h.supersedeArtwork(); }
    await returnToTab(); await unlocked(); await waitRecovered(artwork ? 'artwork' : 'mint');
    if (kind === 'superseded-artwork') assert.equal(h.metadataHash(), 'b'.repeat(64));
  } else if (kind === 'receipt-close') {
    await h.approve(true, { mine: false });
    await page.waitForFunction(() => globalThis.__artworkWallet.requests.includes('eth_getTransactionReceipt'));
    await close();
    const count = audit.requests.filter(r => ['eth_blockNumber', 'eth_getTransactionReceipt'].includes(r.method)).length;
    await page.waitForTimeout(6_000);
    assert.equal(audit.requests.filter(r => ['eth_blockNumber', 'eth_getTransactionReceipt'].includes(r.method)).length, count, 'Close must stop wallet-provider polling');
    assert.equal((await pending()).length, 1);
  } else if (kind === 'late-hash-navigation') {
    await close();
    if (!await page.locator('[data-editor-shell-action="back"]').isVisible()) await h.click('#btn-editor-phone-menu');
    await h.click('[data-editor-shell-action="back"]');
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene?.scene === 'overworld-play');
    await h.approve(true);
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '[]').some(p => p.roomId === '0,0' && p.txHash), KEY);
    const scene = await state(); assert.equal(scene.scene, 'overworld-play'); assert.equal(approvals(), 1);
    await h.enterEditor(); await waitRecovered('mint'); await dismissResult();
  } else if (kind === 'unknown-dedup' || kind === 'account-check-cancel') {
    audit.holdRefresh = true; await h.click('#btn-busy-retry');
    await page.waitForFunction(() => document.getElementById('busy-overlay').classList.contains('hidden'));
    await h.waitForRefresh();
    if (kind === 'account-check-cancel') {
      h.setUser(false); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.waitForFunction(() => !JSON.parse(window.render_game_to_text()).auth.authenticated);
      await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }));
      h.setUser(true); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).auth.authenticated);
      h.markChain(false); h.releaseRefresh(); await page.waitForTimeout(250);
      assert.equal((await state()).mintedTokenId, null, 'old response cannot apply after an account roundtrip');
    } else {
      await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus')); });
      assert.equal(audit.refreshes, 1, 'explicit check and return events share one in-flight request');
      h.releaseRefresh(); await page.locator('#busy-overlay[data-busy-state="error"]').waitFor();
      await h.click('#btn-busy-close');
      await page.waitForTimeout(6_000); const count = audit.refreshes;
      assert(count <= 3, 'one finite recovery burst'); await page.waitForTimeout(3_000); assert.equal(audit.refreshes, count);
    }
    assert.equal(approvals(), 1); assert.equal((await pending()).length, 1);
    await h.approve(false); // Definite rejection cleans only the captured unhashed intent.
  } else if (kind === 'dirty-recovery') {
    await close(); await h.approve(true); audit.holdRefresh = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await h.waitForRefresh();
    if (!await page.locator('#room-title-input').isVisible()) {
      if (await page.locator('#btn-editor-phone-menu').isVisible()) await h.click('#btn-editor-phone-menu');
      else await h.click('[data-editor-shell-action="room"]');
    }
    await page.locator('#room-title-input').fill('Unsaved recovery draft');
    await page.locator('#room-title-input').dispatchEvent('change');
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene?.roomDirty === true);
    h.releaseRefresh();
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '[]').length === 0, KEY);
    assert.equal(await page.locator('#room-title-input').inputValue(), 'Unsaved recovery draft');
    assert.equal((await state()).roomDirty, true, 'recovery must not clear unsaved edits');
    audit.dirtyPreservedBeforeSave = true; h.releaseDraft();
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene?.mintedTokenId === '42');
  } else if (kind === 'transferred-owner') {
    await close(); await h.approve(true); h.transferOwner();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => {
      const s = JSON.parse(window.render_game_to_text()).activeScene;
      return s?.mintedTokenId === '42' && s.canSaveDraft === false && s.canPublish === false;
    });
    assert.equal((await state()).mintedOwnerWalletAddress, '0x' + '3'.repeat(40));
    assert.equal((await state()).claimerDisplayName, h.claimerDisplayName);
  } else throw new Error(`Missing recovery audit: ${kind}`);

  assert.equal(approvals(), expectedApprovals, 'recovery must not request another wallet approval');
  assert(audit.publicRequests.every(method => ['eth_chainId', 'eth_getTransactionReceipt', 'eth_getBalance'].includes(method)));
  assert.equal(audit.publicRequests.filter(method => method === 'eth_getBalance').length, artwork ? 2 : 1, 'Recovery never opens another cost sheet or balance lookup');
}
