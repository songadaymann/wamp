import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import './lib/mutedBrowsers.mjs';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:3031';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Synthetic fixtures are local only.');
const output = 'output/web-game/phone-builder';
mkdirSync(output, { recursive: true });
const report = { scenarios: [], pageErrors: [], blockedWrites: [] };
const browser = await chromium.launch();
const devices = [
  ['portrait', { width: 390, height: 844 }],
  ['landscape', { width: 844, height: 390 }],
  ['narrow', { width: 320, height: 568 }],
];

try {
  for (const [device, viewport] of devices) {
    if (process.env.PHONE_DOCK_DEVICES && !process.env.PHONE_DOCK_DEVICES.split(',').includes(device)) continue;
    for (const expanded of [false, true]) {
      const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
      await context.addInitScript(() => {
        localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
        localStorage.setItem('wamp_replay_opt_out', '1');
      });
      const page = await context.newPage();
      page.on('pageerror', error => report.pageErrors.push(error.message));
      await page.route('**/api/**', route => {
        if (['GET', 'OPTIONS'].includes(route.request().method()) || new URL(route.request().url()).pathname === '/api/rooms/snapshots/query') return route.continue();
        report.blockedWrites.push(new URL(route.request().url()).pathname);
        return route.abort();
      });
      const url = new URL(base);
      url.searchParams.set('previewSmoke', '1');
      url.searchParams.set('renderer', 'webgl');
      await page.goto(url.href);
      await page.waitForFunction(() => document.body.dataset.appReady === 'true' && typeof window.run_preview_smoke_action === 'function', null, { timeout: 120_000 });
      const opened = await page.evaluate(expanded => {
        window.__wampEarlyWorldTiles?.release('phone-dock-smoke');
        return window.run_preview_smoke_action(expanded ? 'openSyntheticCourseEditor' : 'openSyntheticEditor');
      }, expanded);
      assert.equal(opened?.ok, true);
      await page.waitForFunction(() => document.body.dataset.editorPhoneDock === 'true');
      await page.evaluate(() => {
        if (document.getElementById('auth-panel')?.classList.contains('menu-open')) document.getElementById('menu-toggle')?.click();
        const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.EditorScene;
        if (scene.roomSession) scene.roomSession.maybeAutoSave = () => {};
      });
      const passed = [];
      const tap = async selector => {
        const node = page.locator(selector);
        await node.scrollIntoViewIfNeeded();
        await node.tap();
        await page.waitForTimeout(100);
      };
      async function bounds(selector, minimum = 0) {
        const box = await page.locator(selector).boundingBox();
        assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${selector}: ${JSON.stringify(box)}`);
        assert.ok(box.height >= minimum, `${selector} target too short`);
      }
      async function selection() {
        // What the editor shows: palette mode, the pressed object tile, and the active drawing tool.
        return page.evaluate(() => ({
          paletteMode: document.body.dataset.editorPaletteMode,
          selectedObjectId: document.querySelector('#object-grid .object-item[aria-pressed="true"]')?.dataset.objectId ?? null,
          activeTool: document.querySelector('.editor-shell-tools [data-tool].active')?.dataset.tool ?? null,
        }));
      }
      for (const selector of ['#editor-shell-phone-bar', '#editor-shell-dock', '#sidebar']) await bounds(selector);
      for (const selector of ['[data-editor-shell-action="test"]', '[data-editor-shell-action="publish"]', '#btn-editor-phone-menu', '#btn-mobile-editor-toggle']) await bounds(selector, 44);
      assert.equal(await page.locator('#mobile-editor-nav').isVisible(), false);
      passed.push('persistent actions and 44px targets fit');

      if (device === 'portrait') {
        // F367: every library button, Markers and Room Setup included, is on screen without scrolling.
        for (const width of [390, 375, 360]) {
          await page.setViewportSize({ width, height: viewport.height });
          await page.waitForTimeout(300);
          const dock = await page.evaluate(() => {
            const row = document.querySelector('#editor-shell-dock .editor-shell-dock-grid');
            const off = [...row.children].filter(b => b.getClientRects().length).map(b => ({ label: b.textContent.trim(), box: b.getBoundingClientRect() }))
              .filter(({ box }) => box.left < -1 || box.right > innerWidth + 1).map(({ label }) => label);
            return { off, scrollWidth: row.scrollWidth, clientWidth: row.clientWidth };
          });
          assert.deepEqual(dock.off, [], `${width}px: dock buttons off screen`);
          assert.ok(dock.scrollWidth <= dock.clientWidth, `${width}px: dock row scrolls ${JSON.stringify(dock)}`);
        }
        await page.setViewportSize(viewport);
        await page.waitForTimeout(300);
        passed.push('all dock buttons fit at 390, 375 and 360px');
      }

      await tap('[data-editor-dock="stuff"]');
      await tap('.obj-cat-tab[data-category="collectible"]');
      const coin = page.locator('#object-grid [data-object-id="coin_gold"]');
      await coin.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/${device}-${expanded ? 'expanded' : 'room'}-palette.png` });
      await coin.tap({ timeout: 5000 });
      const remembered = await selection();
      for (const panel of ['characters', 'hazards', 'deco', 'terrain']) {
        await tap(`[data-editor-dock="${panel}"]`);
        assert.equal(await page.evaluate(() => document.body.dataset.editorShellPanel), panel);
        assert.equal(await page.locator('#sidebar').isVisible(), true);
        if (panel !== 'terrain') assert.equal(await page.locator('#object-grid [data-object-id="spawn_point"]').count(), 0);
      }
      await tap('[data-editor-dock="stuff"]');
      assert.deepEqual(await selection(), remembered);
      passed.push('scoped libraries and Stuff selection survive category changes');
      await page.screenshot({ path: `${output}/${device}-${expanded ? 'expanded' : 'room'}-stuff.png` });

      await tap('[data-editor-dock="markers"]');
      await bounds('[data-editor-marker-action="spawn"]', 44);
      await tap('[data-editor-marker-action="spawn"]');
      assert.equal(await page.evaluate(() => document.body.dataset.editorSpawnPlacement), 'true');
      assert.equal(await page.locator('#sidebar').isVisible(), false);
      assert.equal(await page.locator('#btn-mobile-editor-toggle').textContent(), 'Cancel');
      await tap('#btn-mobile-editor-toggle');
      assert.equal(await page.evaluate(() => document.body.dataset.editorSpawnPlacement), 'false');
      assert.deepEqual(await selection(), remembered);
      passed.push('touch Cancel restores previous selection');

      await tap('[data-editor-dock="markers"]');
      await tap('[data-editor-marker-action="spawn"]');
      const before = await page.evaluate(expanded => {
        const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys[expanded ? 'CourseEditorScene' : 'EditorScene'];
        const runtime = expanded ? scene.getSelectedSlice().runtime : scene.editRuntime;
        return JSON.stringify(runtime.exportRoomSnapshot().spawnPoint);
      }, expanded);
      const point = await page.evaluate(expanded => {
        const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys[expanded ? 'CourseEditorScene' : 'EditorScene'];
        const camera = scene.cameras.main;
        const origin = expanded ? scene.getSelectedSlice().origin : { x: 0, y: 0 };
        camera.setZoom(Math.min(camera.width / 640, camera.height / 352) * 0.85);
        if (expanded) { scene.inspectZoom = camera.zoom; scene.syncCameraBounds(); }
        camera.centerOn(origin.x + 320, origin.y + 176);
        const rect = scene.game.canvas.getBoundingClientRect();
        return { x: rect.x + rect.width * 0.45, y: rect.y + rect.height * 0.5 };
      }, expanded);
      await page.waitForTimeout(150);
      await page.touchscreen.tap(point.x, point.y);
      await page.waitForFunction(() => document.body.dataset.editorSpawnPlacement === 'false');
      const after = await page.evaluate(expanded => {
        const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys[expanded ? 'CourseEditorScene' : 'EditorScene'];
        const runtime = expanded ? scene.getSelectedSlice().runtime : scene.editRuntime;
        return JSON.stringify(runtime.exportRoomSnapshot().spawnPoint);
      }, expanded);
      assert.notEqual(after, before);
      assert.deepEqual(await selection(), remembered);
      passed.push('native canvas tap places Spawn and restores the tool');
      await tap('[data-editor-dock="markers"]');
      await tap('[data-editor-marker-action="goal"]');
      assert.equal(await page.evaluate(() => document.body.dataset.editorShellPanel), 'goal');
      assert.equal(await page.locator('#sidebar').isVisible(), true);
      assert.equal(await page.locator(expanded ? '#course-goal-section' : '#goal-section').isVisible(), true);
      if (expanded) await page.locator('#course-editor-goal-type-select').selectOption('reach_exit');
      passed.push('Markers opens Goal');

      await tap('[data-editor-shell-action="room"]');
      assert.equal(await page.evaluate(() => document.body.dataset.editorShellPanel), 'room');
      for (const section of ['background', 'environment']) {
        await tap(`button[data-editor-room-section="${section}"]`);
        await bounds('#sidebar');
        assert.equal(await page.locator(section === 'environment' ? '#editor-lighting-feature-panel' : '#background-card-grid').isVisible(), true);
      }
      await tap('button[data-editor-room-section="music"]');
      await page.waitForFunction(() => document.body.dataset.editorMusicMode === 'true');
      await bounds('#btn-editor-music-close');
      assert.equal(await page.locator('#editor-shell-phone-bar').isVisible(), false);
      await page.screenshot({ path: `${output}/${device}-${expanded ? 'expanded' : 'room'}-music.png` });
      await tap('#btn-editor-music-close');
      await page.waitForFunction(() => document.body.dataset.editorMusicMode === 'false');
      await tap('button[data-editor-room-section="sprite"]');
      await page.waitForFunction(() => document.body.dataset.editorSpriteMode === 'true');
      await bounds('#btn-editor-sprite-close');
      assert.equal(await page.locator('#editor-shell-phone-bar').isVisible(), false);
      await tap('#btn-editor-sprite-close');
      await page.waitForFunction(() => document.body.dataset.editorSpriteMode === 'false');
      passed.push('Room, Music and Sprite entry and touch exit');

      await tap('#btn-editor-phone-menu');
      assert.equal(await page.locator('[data-editor-shell-action="share"]').isVisible(), !expanded);
      assert.equal(await page.locator('[data-editor-shell-action="save"]').isVisible(), expanded);
      if (!expanded) {
        await tap('[data-editor-shell-action="share"]');
        await bounds('#editor-share-popover');
        assert.equal(await page.locator('[data-editor-share-action="wampogram"]').isVisible(), true);
        await page.locator('#btn-editor-phone-menu').focus();
        await page.keyboard.press('Space');
        assert.equal(await page.locator('#editor-share-popover').isVisible(), false);
        assert.equal(await page.locator('#editor-phone-menu').isVisible(), true);
        await page.keyboard.press('Escape');
      } else await tap('#btn-editor-phone-menu');
      await tap('#btn-editor-phone-menu');
      await tap('#btn-editor-phone-account');
      assert.equal(await page.locator('#auth-panel').evaluate(el => el.classList.contains('menu-open')), true);
      await bounds('#menu-toggle');
      await tap('#menu-toggle');
      assert.equal(await page.locator('#menu-body').isVisible(), false);
      passed.push('More exposes Share or Save Cells and account menu closes');

      await tap('[data-editor-dock="terrain"]');
      await tap('[data-builder-mode-choice="advanced"]');
      await tap('.palette-tab[data-mode="tiles"]');
      await tap('[data-editor-dock="terrain"]');
      await tap('#editor-phone-tools [data-tool="copy"]');
      await tap('[data-editor-dock="terrain"]');
      await tap('#editor-phone-tools [data-tool="pencil"]');
      await bounds('#editor-shell-pencil-picker');
      await tap('#editor-shell-pencil-picker [data-pencil-brush-size="2"]');
      await tap('#btn-mobile-editor-toggle');
      assert.equal(await page.locator('#editor-shell-pencil-picker').isVisible(), false);
      await tap('[data-editor-dock="terrain"]');
      await tap('#editor-phone-tools [data-tool="eraser"]');
      await bounds('#editor-shell-eraser-size-picker');
      await tap('[data-editor-dock="terrain"]');
      await tap('#editor-phone-tools [data-tool="copy"]');
      passed.push('Draw and Erase options fit outside scrolling toolbar');

      // F368: swipes scroll the tile picker by touch, and the last row of WampOS 95 can be tapped.
      await tap('[data-editor-dock="terrain"]');
      assert.equal(await page.locator('#editor-phone-draw-switch').isVisible(), false);
      await page.locator('#tileset-select').selectOption('wampos95');
      await page.waitForTimeout(250);
      const cdp = await context.newCDPSession(page);
      const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
      const picker = () => page.evaluate(() => {
        const canvas = document.getElementById('palette-canvas').getBoundingClientRect();
        const sheet = document.getElementById('editor-sidebar-scroll').getBoundingClientRect();
        return { x: canvas.x, y: canvas.y, width: canvas.width, bottom: canvas.bottom, top: sheet.top, sheetBottom: sheet.bottom };
      });
      // The picker canvas draws the selected tiles' highlight, so its pixels show what is selected.
      const readPicker = () => page.evaluate(() => ({
        tilesetKey: document.getElementById('tileset-select').value,
        image: document.getElementById('palette-canvas').toDataURL(),
      }));
      // Wait for the picker to finish drawing (the tileset image loads after the select changes).
      const tileSelection = async () => {
        let previous = await readPicker();
        for (let attempt = 0; attempt < 40; attempt++) {
          await page.waitForTimeout(150);
          const current = await readPicker();
          if (current.image === previous.image && current.tilesetKey === previous.tilesetKey) return current;
          previous = current;
        }
        return previous;
      };
      // Picker cells whose pixels differ from an earlier picker image (12 columns for WampOS 95).
      const changedCells = (earlier) => page.evaluate(async (earlierImage) => {
        const canvas = document.getElementById('palette-canvas');
        const image = new Image();
        image.src = earlierImage;
        await image.decode();
        const scratch = document.createElement('canvas');
        scratch.width = canvas.width; scratch.height = canvas.height;
        const scratchContext = scratch.getContext('2d');
        scratchContext.drawImage(image, 0, 0);
        const before = scratchContext.getImageData(0, 0, canvas.width, canvas.height).data;
        const after = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        const tile = canvas.width / 12, cells = new Set();
        for (let index = 0; index < after.length; index += 4) {
          if (after[index] === before[index] && after[index + 1] === before[index + 1] && after[index + 2] === before[index + 2]) continue;
          const pixel = index / 4, x = pixel % canvas.width, y = Math.floor(pixel / canvas.width);
          // The highlight's 2px outline bleeds a pixel into neighbouring cells; count cell interiors only.
          if (x % tile < 3 || x % tile > tile - 3 || y % tile < 3 || y % tile > tile - 3) continue;
          cells.add(`${Math.floor(x / tile)},${Math.floor(y / tile)}`);
        }
        return [...cells].sort();
      }, earlier.image);
      const beforeSwipes = await tileSelection();
      let box = await picker();
      for (let swipes = 0; box.bottom > box.sheetBottom - 2; swipes++) {
        assert.ok(swipes < 30, `WampOS 95 picker never scrolled to its end: ${JSON.stringify(box)}`);
        const x = box.x + Math.min(box.width, 300) / 2;
        const from = Math.min(box.sheetBottom - 20, box.bottom - 10);
        const to = Math.max(box.top + 20, from - 160, from - Math.max(40, box.bottom - box.sheetBottom + 10));
        await touch('touchStart', x, from);
        // Every step travels past the 10px tap slop, so a slow machine can't turn the swipe into a
        // 400ms hold-to-select before the finger has visibly moved.
        const steps = Math.max(1, Math.min(8, Math.floor(Math.abs(to - from) / 12)));
        for (let step = 1; step <= steps; step++) { await touch('touchMove', x, from + (to - from) * step / steps); await page.waitForTimeout(16); }
        // Finish still, so the swipe does not fling past the end.
        await page.waitForTimeout(150);
        await touch('touchEnd');
        await page.waitForTimeout(250);
        box = await picker();
      }
      assert.deepEqual(await changedCells(beforeSwipes), [], 'swiping the picker must not select tiles');
      // Let any momentum scroll settle so the tap lands on one cell.
      for (let settle = 0; settle < 40; settle++) {
        await page.waitForTimeout(150);
        const settled = await picker();
        if (settled.y === box.y) break;
        box = settled;
      }
      const tile = box.width / 12;
      await page.touchscreen.tap(box.x + tile * 11.5, box.y + tile * 26.5);
      await page.waitForTimeout(200);
      const tapped = await tileSelection();
      assert.equal(tapped.tilesetKey, 'wampos95');
      // The earlier one-tile highlight clears and only the tapped last-row tile (11,26) lights up.
      const tapChanges = await changedCells(beforeSwipes);
      assert.ok(tapChanges.includes('11,26') && tapChanges.length <= 2,
        `the tap must select only the last-row tile it touched: ${JSON.stringify(tapChanges)}`);
      assert.equal(await page.evaluate(() => document.body.dataset.mobileEditorCollapsed), 'true');
      passed.push('swipe scrolls the WampOS 95 picker and its last row can be tapped');

      // F369: with the sheet hidden, one tap switches between Draw and Erase and keeps the tile.
      for (const tool of ['eraser', 'pencil']) {
        await tap(`[data-editor-phone-tool="${tool}"]`);
        assert.equal((await selection()).activeTool, tool);
        assert.equal(await page.locator(`[data-editor-phone-tool="${tool}"]`).getAttribute('aria-pressed'), 'true');
        assert.deepEqual(await tileSelection(), tapped);
      }
      passed.push('Draw/Erase switch changes the tool in one tap and keeps the tile');

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForFunction(() => document.body.dataset.deviceClass !== 'phone');
      assert.equal(await page.locator('.editor-shell-tools [data-editor-history="undo"]').count(), 1);
      assert.equal(await page.locator('#editor-shell-title-slot #room-title-section').count(), 1);
      assert.equal(await page.locator('.editor-shell-tools #editor-shell-pencil-picker').count(), 1);
      await page.setViewportSize(viewport);
      await page.waitForTimeout(500);
      console.log('handoff', await page.evaluate(() => ({inner:[innerWidth,innerHeight],visual:[visualViewport.width,visualViewport.height,visualViewport.scale],device:document.body.dataset.deviceClass,phoneDock:document.body.dataset.editorPhoneDock})));
      await page.waitForFunction(() => document.body.dataset.editorPhoneDock === 'true');
      assert.equal(await page.locator('#editor-shell-phone-bar [data-editor-history="undo"]').count(), 1);
      await bounds('#editor-shell-phone-bar');
      passed.push('desktop handoff restores original nodes and phone reacquires once');
      for (const [action, targetId] of [['test', 'btn-test-play'], ['publish', 'btn-publish-room'], ['back', 'btn-editor-back'], ...(expanded ? [['save', 'btn-save-draft']] : [])]) {
        await page.evaluate(targetId => {
          const target = document.getElementById(targetId);
          window.__phoneRoute = { originalDisabled: target.disabled, count: 0 };
          window.__phoneRouteListener = event => { event.stopImmediatePropagation(); event.preventDefault(); window.__phoneRoute.count++; };
          target.addEventListener('click', window.__phoneRouteListener, true);
          target.disabled = true;
        }, targetId);
        await page.waitForFunction(action => document.querySelector(`[data-editor-shell-action="${action}"]`).disabled, action);
        await page.evaluate(action => document.querySelector(`[data-editor-shell-action="${action}"]`).click(), action);
        assert.equal(await page.evaluate(() => window.__phoneRoute.count), 0);
        await page.evaluate(targetId => { document.getElementById(targetId).disabled = false; }, targetId);
        await page.waitForFunction(action => !document.querySelector(`[data-editor-shell-action="${action}"]`).disabled, action);
        if (action === 'back' || action === 'save') await tap('#btn-editor-phone-menu');
        await tap(`[data-editor-shell-action="${action}"]`);
        assert.equal(await page.evaluate(() => window.__phoneRoute.count), 1);
        await page.evaluate(targetId => {
          const target = document.getElementById(targetId);
          target.removeEventListener('click', window.__phoneRouteListener, true);
          target.disabled = window.__phoneRoute.originalDisabled;
        }, targetId);
      }
      passed.push('native action proxies reach originals once and preserve disabled permissions');
      await page.screenshot({ path: `${output}/${device}-${expanded ? 'expanded' : 'room'}-final.png` });
      await tap('[data-editor-shell-action="test"]');
      await page.waitForFunction(() => {
        const state = JSON.parse(window.render_game_to_text()).activeScene;
        return state.scene === 'overworld-play' && state.mode === 'play' && state.player && Number.isFinite(state.player.x);
      }, null, { timeout: 30000 });
      await page.waitForTimeout(250);
      writeFileSync(`${output}/${device}-${expanded ? 'expanded' : 'room'}-test-state.json`, await page.evaluate(() => window.render_game_to_text()));
      await page.screenshot({ path: `${output}/${device}-${expanded ? 'expanded' : 'room'}-test-settled.png` });
      await page.waitForFunction(() => document.body.dataset.appMode === 'play-world', null, { timeout: 30000 });
      assert.equal(await page.locator('#editor-shell-phone-bar').isVisible(), false);
      await page.screenshot({ path: `${output}/${device}-${expanded ? 'expanded' : 'room'}-test-play.png` });
      passed.push('native Test enters the actual playable preview');
      report.scenarios.push({ device, expanded, passed });
      console.log(`${device} ${expanded ? 'expanded' : 'room'}: ${passed.length} workflows pass`);
      await context.close();
    }
  }
  assert.deepEqual(report.pageErrors, []);
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = error.stack;
  console.error(error);
} finally {
  writeFileSync(`${output}/summary.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
if (!report.ok) process.exit(1);
