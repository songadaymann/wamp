import assert from 'node:assert/strict';

/** Exercise production input polling through the browser Gamepad API; no scene internals. */
export async function auditGamepadControls(page, capture = async () => {}) {
  const read = () => page.evaluate(() => {
    const s = JSON.parse(window.render_game_to_text()).activeScene;
    return { mode: s.mode, player: s.player, gamepad: s.gamepad, combat: s.combat,
      cameraMode: s.cameraMode, goalRun: s.goalRun };
  });
  const wait = async (predicate, label, timeout = 10000) => {
    const end = Date.now() + timeout; let state;
    while (Date.now() < end) { state = await read(); if (predicate(state)) return state; await page.waitForTimeout(60); }
    throw new Error(`${label}: ${JSON.stringify(state)}`);
  };
  await page.locator('#btn-room-goal-intro-start').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#btn-room-goal-intro-start').click();
  await page.locator('#room-goal-intro-modal').waitFor({ state: 'hidden' });
  await page.bringToFront();
  await page.evaluate(() => {
    if (typeof navigator.getGamepads !== 'function') throw new Error('Browser Gamepad API unavailable');
    window.__wampAuditPad = { id: 'standard-api-fixture', index: 0, mapping: 'standard', connected: true,
      axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })) };
    window.__wampAuditPadConnected = true;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true,
      value: () => window.__wampAuditPadConnected ? [window.__wampAuditPad] : [] });
  });
  const input = async (buttons = [], axes = [0, 0]) => page.evaluate(({ buttons, axes }) => {
    const pad = window.__wampAuditPad; pad.axes = axes;
    pad.buttons.forEach((button, index) => { button.pressed = buttons.includes(index); button.value = button.pressed ? 1 : 0; });
  }, { buttons, axes });
  const neutral = async () => { await input(); await page.waitForTimeout(120); };
  await wait(s => s.gamepad.connected && s.player, 'neutral gamepad recognized');
  const start = await read(), spawnX = start.player.x;
  const move = async () => {
    await input([], [1, 0]);
    await wait(s => s.player.x > spawnX + 20, 'stick moves player');
    await neutral();
  };
  await move();
  const beforeJump = await read();
  await input([0]);
  const jump = await wait(s => s.player.velocityY < -10 || s.player.y < beforeJump.player.y - 4, 'face-button jump');
  await capture('gamepad-jump');
  await neutral();
  await wait(s => s.player.velocityY === 0 && s.player.coyoteMs > 0, 'land after jump');
  const heldAction = async (button, cooldown, label) => {
    await input([button]); await wait(s => s.combat[cooldown] > 0, `pad ${label}`);
    const drained = await wait(s => s.combat[cooldown] === 0, `${label} cooldown drains while held`);
    const until = drained.goalRun.elapsedMs + 400;
    await wait(s => {
      assert.equal(s.combat[cooldown], 0, `held ${label} is not auto-repeat`);
      return s.goalRun.elapsedMs >= until;
    }, `${label} stays idle through more gameplay while held`);
  };
  await heldAction(2, 'meleeCooldownMs', 'slash');
  await neutral();
  await heldAction(3, 'rangedCooldownMs', 'shoot');
  await neutral();

  // Repeated input must not restart while a modal or text field owns the controls.
  const outsideSpawn = (await read()).player.x;
  assert(outsideSpawn > spawnX + 10);
  const controls = page.locator('#btn-world-controls');
  if (await controls.isVisible()) await controls.click();
  else { await page.locator('#menu-toggle').click(); await page.locator('#btn-menu-controls').click(); }
  await page.locator('#controls-modal').waitFor({ state: 'visible' });
  await page.keyboard.press('r'); await input([9]); await page.waitForTimeout(250);
  assert((await read()).player.x > spawnX + 10, 'modal R/Start must not restart');
  assert.equal((await read()).gamepad.active, false, 'modal yields controller input');
  await page.getByText('Standard gamepad', { exact: true }).scrollIntoViewIfNeeded();
  await capture('gamepad-controls');
  await page.locator('#btn-controls-close').click();
  if (await page.locator('#auth-panel').evaluate(e => e.classList.contains('menu-open'))) await page.locator('#menu-toggle').click();
  await page.waitForTimeout(250);
  assert((await read()).player.x > spawnX + 10, 'held Start after closing modal must not restart');
  await neutral();
  await page.keyboard.press('t');
  await page.locator('#room-chat-input').waitFor({ state: 'visible' });
  await page.locator('#room-chat-input').pressSequentially('restart r', { delay: 10 });
  await input([9]); await page.waitForTimeout(200);
  assert.equal(await page.locator('#room-chat-input').inputValue(), 'restart r');
  assert((await read()).player.x > spawnX + 10, 'typing R/holding Start must not restart');
  await neutral(); await page.locator('#room-chat-input').press('Escape');
  await page.locator('#room-chat-input').waitFor({ state: 'hidden' });
  await page.waitForTimeout(150);
  await page.keyboard.press('r');
  await wait(s => Math.abs(s.player.x - spawnX) <= 3, 'R restarts at spawn');
  await capture('keyboard-restart');

  await neutral(); await move();
  await input([9]); await wait(s => Math.abs(s.player.x - spawnX) <= 3, 'Start restarts at spawn');
  await input([9], [1, 0]);
  await wait(s => s.player.x > spawnX + 15, 'held Start does not repeatedly restart');
  await neutral();
  await page.evaluate(() => { window.__wampAuditPadConnected = false; });
  await wait(s => !s.gamepad.connected, 'disconnect clears controller');
  const unplugged = (await read()).player.x;
  await input([9]); await page.evaluate(() => { window.__wampAuditPadConnected = true; });
  await wait(s => s.gamepad.connected, 'controller reconnect'); await page.waitForTimeout(200);
  assert(Math.abs((await read()).player.x - unplugged) <= 3, 'held reconnect Start is ignored');
  await neutral();

  const beforeCamera = (await read()).cameraMode;
  await page.keyboard.press('9', { delay: 150 }); await page.waitForTimeout(120); const keyboardCamera = (await read()).cameraMode;
  await page.keyboard.press('9', { delay: 150 }); await page.waitForTimeout(120); assert.equal((await read()).cameraMode, beforeCamera);
  await input([11]); await page.waitForTimeout(120); assert.equal((await read()).cameraMode, keyboardCamera, 'pad camera matches key 9 policy');
  await neutral();
  await input([8]); await wait(s => s.mode === 'browse', 'Select returns to browse');
  await page.keyboard.press('r'); assert.equal((await read()).mode, 'browse', 'browse R does nothing');
  await capture('gamepad-browse');
  await page.locator('#btn-world-play').click();
  await page.waitForTimeout(300);
  if (await page.locator('#btn-room-goal-intro-start').isVisible()) {
    await page.locator('#btn-room-goal-intro-start').click(); await page.locator('#room-goal-intro-modal').waitFor({ state: 'hidden' });
  }
  await wait(s => s.mode === 'play', 'reenter Play with Select still held'); await page.waitForTimeout(200);
  assert.equal((await read()).mode, 'play', 'held Select cannot immediately leave a new Play session');
  await neutral();
  return { spawnX, movedX: outsideSpawn, jumpY: jump.player.y, keyboardCamera, cases: [
    'stick movement', 'jump and landing', 'slash edge', 'shoot edge', 'modal R/Start guard',
    'typing R/Start guard', 'R restart', 'Start restart', 'held Start', 'disconnect',
    'held reconnect', 'camera policy', 'Select browse', 'browse R guard', 'held Select on reentry',
  ] };
}
