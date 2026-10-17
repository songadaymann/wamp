import assert from 'node:assert/strict';

/** Record API requests, without claiming browser emulation has a vibration motor. */
export async function installHapticProbe(context) {
  await context.addInitScript(() => {
    window.__hapticPendingImageDecodes = 0;
    const decodeImage = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function (...args) {
      window.__hapticPendingImageDecodes++;
      return decodeImage.apply(this, args).then(value => {
        window.__hapticPendingImageDecodes--;
        return value;
      }, error => {
        window.__hapticPendingImageDecodes--;
        throw error;
      });
    };
    window.__hapticCalls = [];
    window.__hapticProbe = pattern => {
      window.__hapticCalls.push({ pattern, at: performance.now(), mode: document.body?.dataset.appMode });
      return true;
    };
    Object.defineProperty(navigator, 'vibrate', { configurable: true, writable: true, value: window.__hapticProbe });
    // This reload audit covers device feedback, not session replay uploads.
    localStorage.setItem('wamp_replay_opt_out', '1');
    localStorage.setItem('wamp.settings.musicVolume', '0');
    localStorage.setItem('wamp.settings.sfxVolume', '0');
    localStorage.setItem('wamp.devicePerformanceMode.v1', JSON.stringify({ version: 1, mode: 'full-quality' }));
  });
}

async function startRoom(page) {
  await page.waitForFunction(() => document.body.dataset.appReady === 'true');
  await page.locator('#btn-room-goal-intro-start').waitFor({ state: 'visible' });
  await page.locator('#btn-room-goal-intro-start').tap();
  await page.locator('#room-goal-intro-modal').waitFor({ state: 'hidden' });
}

async function jump(page) {
  await page.waitForFunction(() => {
    const state = JSON.parse(window.render_game_to_text()).activeScene;
    return state?.player?.velocityY === 0 && state.player.bodyHeight === 26;
  }, null, { timeout: 15000 });
  await page.locator('#btn-mobile-jump').tap();
  await page.waitForTimeout(200);
}

export async function auditHapticSettings(page, capture = async () => {}) {
  await startRoom(page);
  const settings = async () => {
    await page.locator('#menu-toggle').tap();
    await page.locator('#btn-world-settings').tap();
    await page.locator('#settings-modal').waitFor({ state: 'visible' });
  };
  await settings();
  assert(await page.locator('#settings-haptics-row').isVisible());
  const target = await page.locator('#settings-haptics-row').evaluate(e => {
    const r = e.getBoundingClientRect(); return { height: r.height, left: r.left, right: r.right, viewport: innerWidth };
  });
  assert(target.height >= 44 && target.left >= 0 && target.right <= target.viewport, 'vibration label is a full-size, unclipped touch target');
  assert(await page.locator('#settings-haptics').isChecked());
  await page.locator('#settings-haptics').uncheck();
  assert.equal(await page.evaluate(() => localStorage.getItem('wamp.settings.haptics')), 'false');
  await capture('haptics-off');
  // The existing sound warmer starts1.5s after the first gesture. Let it finish:
  // desktop WebKit reports aborted image/audio decodes as CORS errors on reload.
  await page.waitForTimeout(1600);
  await page.waitForFunction(() => window.get_sfx_debug_state?.().buffers.loading === 0);
  await page.waitForLoadState('networkidle');
  // Network idle does not include blob image decoding. Wait for the actual image
  // promises and map queues too, so reload does not abort WebKit's active decodes.
  await page.waitForFunction(() => {
    const queues = JSON.parse(window.render_game_to_text()).activeScene?.worldTiles?.queueDepths;
    return window.__hapticPendingImageDecodes === 0
      && (!queues || Object.values(queues).every(depth => depth === 0));
  }, null, { timeout: 30000 });
  await page.reload();
  await startRoom(page); await settings();
  assert.equal(await page.locator('#settings-haptics').isChecked(), false, 'device preference survives reload');
  await page.locator('#btn-settings-close').tap();
  await page.evaluate(() => { window.__hapticCalls.length = 0; });
  await jump(page);
  assert.deepEqual(await page.evaluate(() => window.__hapticCalls), [], 'muted/off gameplay emits no vibration');

  await settings(); await page.locator('#settings-haptics').check();
  await page.locator('#btn-settings-close').tap();
  await jump(page);
  const calls = await page.evaluate(() => window.__hapticCalls);
  assert(calls.some(c => c.pattern === 5), 'real touch jump requests the light pulse while SFX volume is zero');
  assert(calls.every(c => c.mode === 'play-world'), 'only gameplay requests vibration');
  await capture('haptics-jump');
  await settings();
  await page.evaluate(() => Object.defineProperty(navigator, 'vibrate', { configurable: true, writable: true, value: undefined }));
  await page.locator('#btn-settings-close').tap();
  await settings();
  assert.equal(await page.locator('#settings-haptics-row').isVisible(), false, 'unsupported devices hide the switch');
  await capture('haptics-unsupported');
  await page.locator('#btn-settings-close').tap();
  await jump(page); // Missing API is harmless during actual gameplay too.
  return { cases: ['default on', 'off and reload', 'muted off jump', 'muted enabled touch jump', 'unsupported UI and gameplay'], calls };
}

export async function auditHapticClear(page, capture = async () => {}) {
  await page.waitForFunction(() => document.body.dataset.appReady === 'true');
  assert.deepEqual(await page.evaluate(() => window.__hapticCalls), [], 'intro has no vibration');
  await startRoom(page);
  await page.waitForFunction(() => {
    const run = JSON.parse(window.render_game_to_text()).activeScene?.goalRun;
    return run?.result === 'completed' && run.collectiblesCollected === 2;
  }, null, { timeout: 15000 });
  const calls = await page.evaluate(() => window.__hapticCalls);
  assert(calls.some(c => c.pattern === 8), 'actual spawn pickup requests a pulse');
  assert.equal(calls.filter(c => Array.isArray(c.pattern) && c.pattern.join(',') === '30,40,60').length, 1, 'one complete cue for the actual clear');
  assert(calls.filter(c => c.pattern === 8).length <= 2, 'pickup burst stays bounded');
  assert(calls.every(c => c.mode === 'play-world'));
  await capture('haptics-clear');
  return { cases: ['quiet intro', 'local pickup', 'verified two-pickup clear', 'one goal cue', 'bounded burst'], calls };
}
