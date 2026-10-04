import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

// Local test-enabled Vite only. No account or published room writes.
const baseUrl = process.argv[2] ?? 'http://127.0.0.1:3031';
const output = process.env.PHYSICS_SMOKE_OUTPUT_DIR ?? 'output/web-game/physics-cadence/smoke';
const mobile = process.env.PHYSICS_SMOKE_MOBILE === '1';
const fixtures = (process.env.PHYSICS_SMOKE_FIXTURES
  ?? 'normal,ice,conveyor,water,wind,gravity-up,gravity-left,gravity-right,moving-platform').split(',');
const renderer = process.env.PHYSICS_SMOKE_RENDERER ?? 'canvas';
const url = new URL(baseUrl);
url.searchParams.set('renderer', renderer);
url.searchParams.set('previewSmoke', '1');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const reports = [];
try {
  const page = await browser.newPage({ viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 900 },
    isMobile: mobile, hasTouch: mobile });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
    localStorage.setItem('wamp_replay_opt_out', '1');
    localStorage.setItem('wamp_install_help_dismissed_v1', '1');
  });
  await page.route('**/api/**', route => ['GET', 'OPTIONS'].includes(route.request().method())
    ? route.continue() : route.abort());
  await page.goto(url.toString());
  await page.waitForFunction(() => document.body.dataset.appReady === 'true'
    && typeof window.run_preview_smoke_action === 'function', null, { timeout: 120000 });
  for (const fixture of fixtures) {
    const opened = await page.evaluate(fixture => window.run_preview_smoke_action(
      'openSyntheticPhysicsEditor', { physicsFixture: fixture }), fixture);
    assert.equal(opened.ok, true);
    await page.waitForFunction(() => document.body.dataset.appMode === 'editor');
    await page.evaluate(() => window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.EditorScene.startPlayMode());
    await page.waitForFunction(() => {
      const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.OverworldPlayScene;
      return scene.scene.isActive() && scene.mode === 'play' && scene.playerBody?.enable;
    }, null, { timeout: 120000 });
    await page.waitForTimeout(1200);
    const report = await page.evaluate(fixture => {
      const game = window.__EVERYBODYS_PLATFORMER_GAME__;
      const scene = game.scene.keys.OverworldPlayScene;
      const world = scene.physics.world;
      game.loop.sleep();
      document.activeElement?.blur();
      const pressJump = down => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup',
        { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true }));
      const objects = scene.worldStreamingController.getLoadedFullRoomsById().get('99,99').liveObjects
        .filter(object => object.sprite.body?.velocity);
      const starts = objects.map(object => ({ object, x: object.sprite.x, y: object.sprite.y,
        runtime: { ...object.runtime } }));
      const platform = objects.find(object => object.config.id === 'moving_platform');
      let time = scene.time.now;
      const step = delta => { time += delta; game.step(time, delta); };
      const runs = [];
      try {
        for (const hz of [60, 30, 90, 120, 144, 165, 240]) {
          pressJump(false);
          for (const start of starts) {
            const body = start.object.sprite.body;
            body.reset(start.x, start.y);
            body.updateFromGameObject();
            body.prev.copy(body.position);
            body.prevFrame.copy(body.position);
            Object.assign(start.object.runtime, start.runtime);
          }
          scene.movementController.handleRespawnReset();
          scene.physicsCadence.reset();
          scene.debugSetPlayerPosition({ x: 99 * 640 + 320, y: 99 * 352 + 224 });
          if (platform) scene.debugSetPlayerPosition({
            x: platform.sprite.body.center.x, y: platform.sprite.body.top - 13,
          });
          if (platform) {
            const npc = objects.find(object => object.config.category === 'npc');
            const body = npc.sprite.body;
            body.reset(npc.sprite.x + platform.sprite.body.center.x - body.center.x,
              npc.sprite.y + platform.sprite.body.top - body.bottom);
            body.updateFromGameObject();
            body.prev.copy(body.position);
            body.prevFrame.copy(body.position);
          }
          // Test reset only; production code does not read Arcade's private accumulator.
          world._elapsed = 0;
          for (let warm = 0; warm < 18; warm++) step(1000 / 60);
          if (fixture === 'ice') scene.playerBody.setVelocityX(150);
          const samples = [];
          const capture = () => {
            const body = scene.playerBody;
            samples.push({ x: body.x, y: body.y, vx: body.velocity.x, vy: body.velocity.y,
              actors: objects.map(object => ({ id: object.config.id, x: object.sprite.body.x,
                y: object.sprite.body.y, height: object.sprite.body.height,
                vx: object.sprite.body.velocity.x, vy: object.sprite.body.velocity.y })) });
          };
          world.on('worldstep', capture);
          try {
            if (fixture === 'normal' || fixture === 'water' || fixture.startsWith('gravity')) pressJump(true);
            let released = false;
            for (let frame = 0; samples.length < 120 && frame < 1000; frame++) {
              // Release at the same simulation boundary, separating cadence from input sampling latency.
              if (fixture === 'normal' && !released && samples.length >= 6) { pressJump(false); released = true; }
              step(1000 / hz);
            }
          } finally { world.off('worldstep', capture); pressJump(false); }
          runs.push({ hz, samples: samples.slice(0, 120), sprite: { x: scene.player.x, y: scene.player.y } });
        }
      } finally { game.loop.wake(); }
      return { fixture, runs, state: JSON.parse(window.render_game_to_text()) };
    }, fixture);
    reports.push(report);
    writeFileSync(`${output}/report.json`, JSON.stringify({ reports, errors }, null, 2));
    const baseline = report.runs[0];
    assert.equal(baseline.samples.length, 120);
    if (fixture === 'moving-platform') {
      assert.ok(Math.max(...baseline.samples.map(sample => sample.x))
        - Math.min(...baseline.samples.map(sample => sample.x)) > 30, 'Player must actually ride the platform');
      const npcs = baseline.samples.map(sample => sample.actors.find(actor => actor.id === 'jimothy'));
      assert.ok(Math.max(...npcs.map(npc => npc.x)) - Math.min(...npcs.map(npc => npc.x)) > 30,
        'NPC must actually ride the platform');
      for (let i = 0; i < 120; i++) {
        const platform = baseline.samples[i].actors.find(actor => actor.id === 'moving_platform');
        assert.ok(Math.abs(npcs[i].y + npcs[i].height - platform.y) < 0.01, 'NPC must remain supported');
      }
    }
    for (const run of report.runs) {
      assert.equal(run.samples.length, 120);
      let difference = 0;
      for (let i = 0; i < 120; i++) {
        for (const key of ['x', 'y', 'vx', 'vy']) difference = Math.max(difference,
          Math.abs(run.samples[i][key] - baseline.samples[i][key]));
        assert.equal(run.samples[i].actors.length, baseline.samples[i].actors.length);
        for (let actor = 0; actor < run.samples[i].actors.length; actor++) {
          for (const key of ['x', 'y', 'vx', 'vy']) difference = Math.max(difference,
            Math.abs(run.samples[i].actors[actor][key] - baseline.samples[i].actors[actor][key]));
        }
      }
      assert.ok(difference < 0.01, `${fixture} at ${run.hz}Hz differs by ${difference}`);
      console.log(`${fixture}: ${run.hz}Hz matches 60Hz (${difference})`);
    }
    if (await page.locator('#auth-panel').evaluate(element => element.classList.contains('menu-open'))) {
      await page.click('#menu-toggle');
    }
    await page.waitForTimeout(500);
    if (mobile && fixture === 'normal') {
      const groundedY = await page.evaluate(() => window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.OverworldPlayScene.player.y);
      const jump = await page.locator('#btn-mobile-jump').boundingBox();
      assert.ok(jump, 'Phone jump control must be visible');
      await page.touchscreen.tap(jump.x + jump.width / 2, jump.y + jump.height / 2);
      await page.waitForFunction(y => window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.OverworldPlayScene.player.y < y - 3,
        groundedY, { timeout: 3000 });
      await page.screenshot({ path: `${output}/touch-jump.png` });
      await page.waitForFunction(y => Math.abs(window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.OverworldPlayScene.player.y - y) < 1,
        groundedY, { timeout: 5000 });
      report.touchJumpAndLanding = true;
      writeFileSync(`${output}/report.json`, JSON.stringify({ reports, errors }, null, 2));
    }
    await page.screenshot({ path: `${output}/${fixture}.png` });
    await page.evaluate(() => window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.OverworldPlayScene.returnToWorld());
  }
  assert.deepEqual(errors, []);
  console.log(`Passed ${reports.length * 7} complete-scene cadence comparisons; zero page errors.`);
} finally { await browser.close(); }
