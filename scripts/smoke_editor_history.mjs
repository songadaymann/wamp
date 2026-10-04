import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:3031';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Synthetic fixtures are local only.');
const output = 'output/web-game/editor-history';
mkdirSync(output, { recursive: true });
const url = new URL(base);
url.searchParams.set('previewSmoke', '1');
url.searchParams.set('renderer', 'webgl');
const report = { scenarios: [], errors: [], blockedWrites: [] };
const browser = await chromium.launch({ headless: true });

async function inspect(page, expanded) {
  return page.evaluate((expanded) => {
    const game = window.__EVERYBODYS_PLATFORMER_GAME__;
    const scene = game.scene.keys[expanded ? 'CourseEditorScene' : 'EditorScene'];
    const runtime = expanded ? scene.getSelectedSlice().runtime : scene.editRuntime;
    return JSON.stringify(runtime.exportRoomSnapshot().tileData);
  }, expanded);
}

async function paint(page, expanded, x = 12) {
  await page.evaluate(async ({ expanded, x }) => {
    const { editorState } = await import('/src/config.ts');
    editorState.paletteMode = 'tiles';
    editorState.selectedTileIndex = 0;
    const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys[expanded ? 'CourseEditorScene' : 'EditorScene'];
    const runtime = expanded ? scene.getSelectedSlice().runtime : scene.editRuntime;
    runtime.beginTileBatch();
    runtime.placeTileAt(x * 16, 12 * 16);
    runtime.commitTileBatch();
    if (expanded) scene.renderUi();
    else scene.updateBottomBar();
  }, { expanded, x });
}

try {
  for (const [name, viewport, hasTouch] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['tablet', { width: 1024, height: 768 }, true],
    ['phone', { width: 390, height: 844 }, true],
    ['phone-landscape', { width: 844, height: 390 }, true],
  ]) {
    const context = await browser.newContext({ viewport, hasTouch, isMobile: name.startsWith('phone') });
    await context.addInitScript(() => {
      localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
      localStorage.setItem('wamp_replay_opt_out', '1');
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await page.route('**/api/**', (route) => {
      if (['GET', 'OPTIONS'].includes(route.request().method())) return route.continue();
      report.blockedWrites.push(new URL(route.request().url()).pathname);
      return route.abort();
    });
    await page.goto(url.href);
    await page.waitForFunction(() => document.body.dataset.appReady === 'true'
      && typeof window.run_preview_smoke_action === 'function', null, { timeout: 120_000 });
    await page.evaluate(() => window.__wampEarlyWorldTiles?.release('editor-history-smoke'));
    for (const expanded of [false, true]) {
      const opened = await page.evaluate((expanded) => {
        const game = window.__EVERYBODYS_PLATFORMER_GAME__;
        if (expanded && game.scene.isActive('EditorScene')) game.scene.sleep('EditorScene');
        return window.run_preview_smoke_action(expanded ? 'openSyntheticCourseEditor' : 'openSyntheticEditor');
      }, expanded);
      assert.equal(opened?.ok, true, JSON.stringify(opened));
      await page.waitForFunction(() => document.body.dataset.appMode === 'editor');
      await page.evaluate(() => {
        const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.EditorScene;
        if (scene.roomSession) scene.roomSession.maybeAutoSave = () => {};
        if (document.querySelector('#auth-panel.menu-open')) document.getElementById('menu-toggle')?.click();
      });
      const prefix = name.startsWith('phone') ? '#editor-shell-phone-bar ' : '.editor-shell-tools ';
      const undo = page.locator(`${prefix}[data-editor-history="undo"]`);
      const redo = page.locator(`${prefix}[data-editor-history="redo"]`);
      for (const button of [undo, redo]) {
        assert.ok(await button.isVisible());
        const box = await button.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= viewport.width
          && box.y >= 0 && box.y + box.height <= viewport.height, JSON.stringify(box));
        assert.ok(await button.isDisabled());
      }
      const before = await inspect(page, expanded);
      await paint(page, expanded);
      const after = await inspect(page, expanded);
      assert.notEqual(after, before);
      assert.ok(await undo.isEnabled());
      assert.ok(await redo.isDisabled());
      if (hasTouch) await undo.tap();
      else await undo.click();
      assert.equal(await inspect(page, expanded), before);
      assert.ok(await redo.isEnabled());
      if (hasTouch) await redo.tap();
      else await redo.click();
      assert.equal(await inspect(page, expanded), after);
      for (const lock of ['editorMusicUiLocked', 'editorSpriteUiLocked']) {
        await page.evaluate((lock) => { document.body.dataset[lock] = 'true'; }, lock);
        await page.waitForTimeout(50);
        assert.ok(await undo.isDisabled());
        await page.evaluate((lock) => { document.body.dataset[lock] = 'false'; }, lock);
        await page.waitForTimeout(50);
        assert.ok(await undo.isEnabled());
      }
      if (hasTouch) await undo.tap();
      else await undo.click();
      await paint(page, expanded, 13);
      assert.ok(await redo.isDisabled());
      if (expanded) {
        await page.evaluate(() => {
          const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.CourseEditorScene;
          scene.selectRoomById('100,99');
          scene.renderUi();
        });
        assert.ok(await undo.isDisabled(), 'History must follow the selected cell.');
        assert.ok(await redo.isDisabled());
        await page.evaluate(() => {
          const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.CourseEditorScene;
          scene.selectRoomById('99,99');
          scene.renderUi();
        });
        assert.ok(await undo.isEnabled());
      }
      const mode = expanded ? 'expanded' : 'room';
      await page.screenshot({ path: `${output}/${name}-${mode}.png` });
      report.scenarios.push({ device: name, mode, history: true, locks: true, redoBranch: true });
      writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
      console.log(`${name} ${mode}: history, locks and branch replacement pass.`);
    }
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
