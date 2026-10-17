import assert from 'node:assert/strict';

/** Real cross-origin parent frames; intercept analytics so automated visits never inflate counts. */
export async function auditMannCool(page, capture = async () => {}, assetOrigin = new URL(page.url()).origin) {
  const context = page.context(), reports = [];
  await context.route(url => url.protocol === 'https:' && url.origin === 'https://wamp.land' && !url.pathname.startsWith('/api/'), async route => {
    const url = new URL(route.request().url());
    const response = await fetch(assetOrigin + url.pathname + url.search);
    await route.fulfill({ status: response.status, headers: { 'content-type': response.headers.get('content-type') || 'application/octet-stream' }, body: Buffer.from(await response.arrayBuffer()) });
  });
  await context.route('https://mann.cool/api/v1/plays', async route => {
    const request = route.request();
    if (request.method() === 'POST') reports.push({ body: request.postDataJSON(), headers: request.headers() });
    await route.fulfill({ status: request.method() === 'OPTIONS' ? 204 : 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'Content-Type' }, body: request.method() === 'OPTIONS' ? '' : '{}' });
  });
  await context.route('https://mann.cool/controller-empty', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Controller fixture transition</title>' }));
  const parentHtml = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;width:100%;height:calc(100% - 56px);border:0}button{height:50px;width:80px}</style><iframe id="game" src="https://wamp.land/?x=0&y=0&welcome=0"></iframe><button id="right">Right</button><button id="jump">Jump</button><script>function send(key,eventType){game.contentWindow.postMessage({type:'keyEvent',key,eventType},'https://wamp.land')}for(const [id,key] of [['right','ArrowRight'],['jump',' ']]){document.getElementById(id).addEventListener('pointerdown',()=>send(key,'keydown'));document.getElementById(id).addEventListener('pointerup',()=>send(key,'keyup'))}</script>`;
  await context.route(url => ['https://mann.cool', 'https://untrusted.example'].includes(url.origin) && url.pathname === '/controller-fixture', route => route.fulfill({ contentType: 'text/html', body: parentHtml }));
  const open = async origin => {
    await page.goto(origin + '/controller-fixture');
    const frame = page.frames().find(f => f.url().startsWith('https://wamp.land/'));
    assert(frame, 'actual WAMP child frame exists');
    await frame.waitForFunction(() => document.body.dataset.appReady === 'true', null, { timeout: 120000 });
    await frame.locator('#btn-room-goal-intro-start').waitFor({ state: 'visible', timeout: 30000 });
    await frame.locator('#btn-room-goal-intro-start').click();
    await frame.locator('#room-goal-intro-modal').waitFor({ state: 'hidden' });
    return frame;
  };
  const read = frame => frame.evaluate(() => JSON.parse(window.render_game_to_text()));
  const send = async (key, eventType = 'keydown') => { await page.evaluate(({ key, eventType }) => window.send(key, eventType), { key, eventType }); await page.waitForTimeout(80); };
  const frame = await open('https://mann.cool');
  try {
  await frame.waitForFunction(() => JSON.parse(window.render_game_to_text()).mannCool.playReport === 'sent');
  assert.equal(reports.length, 1); assert.deepEqual(reports[0].body, { slug: 'wamp', source: 'mann.cool' });
  assert(!reports[0].headers.cookie && !reports[0].headers.referer);
  const before = await read(frame);
  // Physical pointer on a parent button moves focus out of the iframe, as the console does.
  const box = await page.locator('#right').boundingBox(); assert(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await frame.waitForFunction(x => JSON.parse(window.render_game_to_text()).activeScene.player.x > x + 10, before.activeScene.player.x, { timeout: 10000 });
  await page.mouse.up();
  await frame.waitForFunction(() => JSON.parse(window.render_game_to_text()).mannCool.controller.moveX === 0);
  await frame.locator('#game-container > canvas').click();
  await frame.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene.player.coyoteMs > 0);
  const y = (await read(frame)).activeScene.player.y;
  await frame.evaluate(y => {
    window.__mannCoolJumpMinY = y; window.__mannCoolObserveJump = true;
    const tick = () => { if (!window.__mannCoolObserveJump) return; window.__mannCoolJumpMinY = Math.min(window.__mannCoolJumpMinY, JSON.parse(window.render_game_to_text()).activeScene.player.y); requestAnimationFrame(tick); }; tick();
  }, y);
  await page.locator('#jump').tap();
  await frame.waitForFunction(y => window.__mannCoolJumpMinY < y - 4, y);
  await frame.evaluate(() => { window.__mannCoolObserveJump = false; });
  await capture('mann-cool-parent-jump');
  await send('r'); await send('r', 'keyup');
  await frame.waitForFunction(() => JSON.parse(window.render_game_to_text()).activeScene.player.coyoteMs > 0);
  for (const [key, cooldown] of [['q', 'meleeCooldownMs'], ['e', 'rangedCooldownMs']]) {
    await frame.evaluate(cooldown => {
      window.__mannCoolCombatPeak = 0; window.__mannCoolObserveCombat = true;
      const tick = () => { if (!window.__mannCoolObserveCombat) return; window.__mannCoolCombatPeak = Math.max(window.__mannCoolCombatPeak, JSON.parse(window.render_game_to_text()).activeScene.combat[cooldown]); requestAnimationFrame(tick); }; tick();
    }, cooldown);
    await send(key);
    await frame.waitForFunction(() => window.__mannCoolCombatPeak > 0, null, { timeout: 5000 });
    await send(key, 'keyup'); await frame.evaluate(() => { window.__mannCoolObserveCombat = false; });
  }
  await frame.locator('#game-container > canvas').click();
  await frame.waitForFunction(() => JSON.parse(window.render_game_to_text()).mannCool.controller.enabled);
  const camera = (await read(frame)).activeScene.cameraMode;
  await frame.locator('#game-container > canvas').press('9', { delay: 120 });
  const keyboardCamera = (await read(frame)).activeScene.cameraMode;
  await frame.locator('#game-container > canvas').press('9', { delay: 120 });
  await frame.waitForFunction(camera => JSON.parse(window.render_game_to_text()).activeScene.cameraMode === camera, camera);
  await send('9');
  await frame.waitForFunction(camera => JSON.parse(window.render_game_to_text()).activeScene.cameraMode === camera, keyboardCamera);
  const toggled = (await read(frame)).activeScene.cameraMode; assert.equal(toggled, keyboardCamera, 'parent camera follows native policy');
  await send('9'); assert.equal((await read(frame)).activeScene.cameraMode, toggled, 'repeat does not toggle twice');
  await send('9', 'keyup'); await send('9'); await send('9', 'keyup');
  await frame.waitForFunction(camera => JSON.parse(window.render_game_to_text()).activeScene.cameraMode === camera, camera);
  await send('ArrowLeft'); assert.equal((await read(frame)).mannCool.controller.moveX, -1);
  await frame.locator('#menu-toggle').click();
  await frame.waitForFunction(() => !JSON.parse(window.render_game_to_text()).mannCool.controller.active);
  await frame.locator('#auth-email-input').fill('controller-fixture@example.invalid');
  const typingRun = (await read(frame)).activeScene.goalRun.elapsedMs;
  assert(typingRun > 500, 'typing check has a running attempt to protect');
  await send('r'); await send('r', 'keyup');
  assert.equal(await frame.locator('#auth-email-input').inputValue(), 'controller-fixture@example.invalid');
  assert((await read(frame)).activeScene.goalRun.elapsedMs >= typingRun, 'parent R cannot restart while typing');
  await send('ArrowLeft'); assert.equal((await read(frame)).mannCool.controller.active, false);
  await frame.locator('#menu-toggle').click(); await send('ArrowLeft');
  assert.equal((await read(frame)).mannCool.controller.active, false, 'held direction must not resume after menu');
  await send('ArrowLeft', 'keyup'); await send('ArrowLeft'); assert.equal((await read(frame)).mannCool.controller.moveX, -1);
  await send('ArrowLeft', 'keyup');
  await send('ArrowRight');
  await frame.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal((await read(frame)).mannCool.controller.active, false, 'blur clears remote holds');
  await send('ArrowRight'); assert.equal((await read(frame)).mannCool.controller.active, false);
  await send('ArrowRight', 'keyup');
  await send('ArrowRight');
  await frame.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal((await read(frame)).mannCool.controller.active, false, 'hidden document clears remote holds');
  await frame.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await send('ArrowRight'); assert.equal((await read(frame)).mannCool.controller.active, false);
  await send('ArrowRight', 'keyup');
  await send('r'); await send('r', 'keyup');
  await frame.waitForFunction(x => Math.abs(JSON.parse(window.render_game_to_text()).activeScene.player.x - x) < 4, before.activeScene.player.x);
  // A same-origin sibling is still not the parent.
  await page.evaluate(() => { const sibling = document.createElement('iframe'); sibling.srcdoc = `<script>parent.document.getElementById('game').contentWindow.postMessage({type:'keyEvent',key:'ArrowRight',eventType:'keydown'},'https://wamp.land')<\/script>`; document.body.append(sibling); });
  await page.waitForTimeout(150); assert.equal((await read(frame)).mannCool.controller.active, false);
  await send('Escape'); await frame.waitForFunction(() => document.body.dataset.appMode === 'world'); await send('Escape', 'keyup');
  await send('ArrowRight'); assert.equal((await read(frame)).mannCool.controller.active, false, 'browse mode ignores parent controls');
  assert.equal(reports.length, 1, 'menus and mode changes never report another visit');
  const trusted = await read(frame);
  await page.goto('https://mann.cool/controller-empty');
  await page.waitForTimeout(250); // Let the previous iframe renderer release its resources.
  const evil = await open('https://untrusted.example');
  await send('ArrowRight'); assert.equal((await read(evil)).mannCool.controller.active, false, 'wrong-origin parent rejected');
  await evil.waitForFunction(() => JSON.parse(window.render_game_to_text()).mannCool.playReport === 'sent');
  assert.equal(reports.length, 2); assert.deepEqual(reports[1].body, { slug: 'wamp', source: 'direct' });
  await capture('mann-cool-untrusted-parent');
  return { label: 'mann.cool visit and real parent controller', reports: reports.map(r => r.body), trustedController: trusted.mannCool.controller, wrongOriginRejected: true };
  } catch (error) {
    const state = await read(frame).catch(() => null);
    throw new Error(`${error.stack || error}\nChild input at failure: ${JSON.stringify({ controller: state?.mannCool, mode: state?.activeScene?.mode, camera: state?.activeScene?.cameraMode })}`);
  }
}
