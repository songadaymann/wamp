import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:3031';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Synthetic fixtures are local only.');
const output = 'output/web-game/editor-touch';
mkdirSync(output, { recursive: true });
const report = { scenarios: [], errors: [] };
const browser = await chromium.launch();
const selectedDevices = process.env.TOUCH_DEVICES?.split(',');
const selectedModes = process.env.TOUCH_MODES?.split(',');

try {
  for (const [device, viewport] of [
    ['tablet', { width: 1024, height: 768 }],
    ['phone', { width: 390, height: 844 }],
    ['phone-landscape', { width: 844, height: 390 }],
  ]) {
    if (selectedDevices && !selectedDevices.includes(device)) continue;
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: device.startsWith('phone') });
    await context.addInitScript(() => {
      localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
      localStorage.setItem('wamp_replay_opt_out', '1');
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.message));
    await page.route('**/api/**', (route) => ['GET', 'OPTIONS'].includes(route.request().method())
      ? route.continue() : route.abort());
    const url = new URL(base);
    url.searchParams.set('previewSmoke', '1');
    url.searchParams.set('renderer', 'webgl');
    await page.goto(url.href);
    await page.waitForFunction(() => document.body.dataset.appReady === 'true'
      && typeof window.run_preview_smoke_action === 'function', null, { timeout: 120_000 });
    await page.evaluate(() => window.__wampEarlyWorldTiles?.release('editor-touch-smoke'));
    const cdp = await context.newCDPSession(page);
    const touch = async (type, points) => {
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
      await page.waitForTimeout(40);
    };

    for (const expanded of [false, true]) {
      const mode = expanded ? 'expanded' : 'room';
      if (selectedModes && !selectedModes.includes(mode)) continue;
      async function fixture(tool, extra = {}) {
        const opened = await page.evaluate(async ({ expanded, tool, extra }) => {
          const game = window.__EVERYBODYS_PLATFORMER_GAME__;
          if (expanded && game.scene.isActive('EditorScene')) game.scene.sleep('EditorScene');
          if (game.scene.isActive('CourseEditorScene') || game.scene.isSleeping('CourseEditorScene')) game.scene.stop('CourseEditorScene');
          for (const key of Object.keys(localStorage)) {
            if (key.startsWith('wamp:expanded-draft-backup:v1:') && key.includes('preview-smoke-expanded-room')) localStorage.removeItem(key);
          }
          const result = await window.run_preview_smoke_action(expanded ? 'openSyntheticCourseEditor' : 'openSyntheticEditor');
          document.getElementById('btn-guest-builder-claim-continue')?.click();
          // Exercise drawing on the exposed canvas, using the actual Hide control.
          if (document.body.dataset.deviceClass === 'phone' && document.body.dataset.mobileEditorCollapsed !== 'true') {
            document.getElementById('btn-mobile-editor-toggle')?.click();
          }
          const { editorState, resetEditorPaletteSelection } = await import('/src/config.ts');
          resetEditorPaletteSelection();
          editorState.paletteMode = extra.objects ? 'objects' : extra.smart ? 'smart' : 'tiles';
          editorState.activeTool = tool;
          editorState.selectedObjectId = extra.spawn ? 'spawn_point' : 'coin_gold';
          editorState.lineCurve = Boolean(extra.curve);
          editorState.pencilSprayMode = Boolean(extra.spray);
          editorState.selectedLightingMode = 'off';
          editorState.activeLayer = 'terrain';
          editorState.rectOutline = false;
          editorState.ellipseOutline = false;
          const scene = game.scene.keys[expanded ? 'CourseEditorScene' : 'EditorScene'];
          const runtime = expanded ? scene.getSelectedSlice().runtime : scene.editRuntime;
          if (expanded) {
            scene.clipboardPastePreviewActive = false;
            scene.clipboardState = null;
            scene.courseGoalPlacementMode = null;
          }
          if (!expanded) {
            scene.roomSession.maybeAutoSave = () => {};
            scene.roomSession.roomCreatedAt = '2026-10-04T00:00:00.000Z';
            scene.roomSession.roomUpdatedAt = '2026-10-04T00:00:00.000Z';
          }
          const snapshot = runtime.exportRoomSnapshot();
          for (let y = 8; y <= 13; y++) for (let x = 8; x <= 13; x++) snapshot.tileData.terrain[y][x] = 2;
          if (extra.objects && tool === 'eraser') snapshot.placedObjects = [{ id: 'coin_gold', instanceId: 'touch-erase-fixture', x: 8 * 16 + 8, y: 8 * 16 + 8 }];
          runtime.applyRoomSnapshot(snapshot);
          if (extra.marker) {
            if (expanded) { scene.setCourseGoalType('reach_exit'); scene.startCourseGoalMarkerPlacement('start'); }
            else { runtime.setGoalType('reach_exit'); runtime.startGoalMarkerPlacement('exit'); }
          }
          if (extra.paste) {
            runtime.copyTilesToClipboard(8, 8, 10, 10);
            if (expanded) {
              scene.clipboardState = runtime.currentClipboardState;
              scene.clipboardPastePreviewActive = true;
            } else scene.toolController.beginClipboardPastePreview();
          }
          // A pre-existing Redo branch must survive every cancelled gesture.
          const savedTool = editorState.activeTool;
          editorState.activeTool = 'pencil';
          runtime.beginTileBatch();
          runtime.placeTileAt((expanded ? scene.getSelectedSlice().origin.x : 0) + 30 * 16,
            (expanded ? scene.getSelectedSlice().origin.y : 0) + 15 * 16);
          runtime.commitTileBatch();
          runtime.undo();
          editorState.activeTool = savedTool;
          if (extra.marker && !expanded && runtime.currentGoalPlacementMode !== 'exit') runtime.startGoalMarkerPlacement('exit');
          const camera = scene.cameras.main;
          const origin = expanded ? scene.getSelectedSlice().origin : { x: 0, y: 0 };
          camera.setZoom(Math.min(camera.width / 640, camera.height / 352) * 0.85);
          if (expanded) { scene.inspectZoom = camera.zoom; scene.syncCameraBounds(); }
          else editorState.zoom = camera.zoom;
          camera.centerOn(origin.x + 320, origin.y + 176);
          window.__touchScene = scene;
          window.__touchRuntime = runtime;
          return result;
        }, { expanded, tool, extra });
        assert.equal(opened?.ok, true, JSON.stringify(opened));
        await page.waitForTimeout(100);
        return points();
      }

      async function points() {
        return page.evaluate((expanded) => {
          const scene = window.__touchScene;
          const camera = scene.cameras.main;
          const origin = expanded ? scene.getSelectedSlice().origin : { x: 0, y: 0 };
          const canvas = scene.game.canvas;
          const rect = canvas.getBoundingClientRect();
          return [8, 13, 22].map((v) => ({ id: 0,
            x: rect.x + ((origin.x + v * 16 + 8 - camera.scrollX - camera.width / 2) * camera.zoom
              + camera.width / 2) * rect.width / canvas.width,
            y: rect.y + ((origin.y + (v === 22 ? 18 : v) * 16 + 8 - camera.scrollY - camera.height / 2) * camera.zoom
              + camera.height / 2) * rect.height / canvas.height,
          }));
        }, expanded);
      }

      async function inspect() {
        return page.evaluate((expanded) => {
          const scene = window.__touchScene;
          const runtimes = expanded ? [...scene.roomSlices.values()].map((slice) => slice.runtime) : [scene.editRuntime];
          return {
            rooms: runtimes.map((runtime) => ({ snapshot: runtime.exportRoomSnapshot(),
              dirty: runtime.isRoomDirty, dirtyAt: runtime.currentLastDirtyAt,
              undo: runtime.hasUndoHistory(), redo: runtime.hasRedoHistory() })),
            goal: expanded ? { goal: scene.getActiveCourseDraft()?.goal, start: scene.getActiveCourseDraft()?.startPoint } : null,
          };
        }, expanded);
      }

      async function hitCanvas(point) {
        const target = await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.outerHTML.slice(0,200), point);
        const hit = await page.evaluate((p) => document.elementFromPoint(p.x, p.y) === window.__touchScene.game.canvas, point);
        if (!hit) await page.screenshot({ path: `${output}/${device}-${mode}-failed-contact.png` });
        assert.equal(await page.evaluate((p) => document.elementFromPoint(p.x, p.y)
          === window.__touchScene.game.canvas, point), true, `${device} ${mode}: touch must hit the visible canvas. ${JSON.stringify(point)} ${target}`);
      }

      function record(name) {
        report.scenarios.push({ device, mode, name });
        writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
        console.log(`${device} ${mode}: ${name} passes.`);
      }

      if (!process.env.TOUCH_LIFECYCLE_ONLY) {
      for (const tool of ['rect', 'ellipse', 'line', 'curve', 'copy']) {
        const [start, end] = await fixture(tool === 'curve' ? 'line' : tool, { curve: tool === 'curve' });
        await hitCanvas(start);
        await hitCanvas(end);
        const before = await inspect();
        await touch('touchStart', [start]);
        await touch('touchMove', [end]);
        assert.equal(await page.evaluate((expanded) => expanded ? Boolean(window.__touchScene.rectStart)
          : window.__touchScene.interactionController.isDrawing, expanded), true);
        await page.screenshot({ path: `${output}/${device}-${mode}-${tool}-preview.png` });
        await touch('touchEnd', []);
        if (tool === 'copy') {
          assert.deepEqual(await inspect(), before);
          assert.equal(await page.evaluate((expanded) => expanded ? Boolean(window.__touchScene.clipboardState)
            : Boolean(window.__touchScene.toolController.getClipboardPreview()), expanded), true);
        } else if (tool === 'curve') {
          assert.deepEqual(await inspect(), before, 'Curve endpoints are a preview until the bend is accepted.');
          const bend = { ...start, x: (start.x + end.x) / 2, y: end.y };
          await hitCanvas(bend);
          await touch('touchStart', [bend]);
          await touch('touchEnd', []);
          assert.notDeepEqual((await inspect()).rooms[0].snapshot.tileData, before.rooms[0].snapshot.tileData);
        } else assert.notDeepEqual((await inspect()).rooms[0].snapshot.tileData, before.rooms[0].snapshot.tileData);
        record(`${tool} drag`);
      }

      const cases = [
        ['pencil', {}], ['eraser', {}], ['randomize', {}], ['fill', {}], ['rect', {}],
        ['ellipse', {}], ['line', {}], ['line', { curve: true }], ['copy', {}],
        ['pencil', { smart: true }], ['pencil', { spray: true }],
        ['pencil', { objects: true }], ['fill', { objects: true }], ['eraser', { objects: true }],
        ['pencil', { objects: true, spawn: true }], ['pencil', { marker: true }], ['copy', { paste: true }],
      ];
      for (const [tool, extra] of cases) {
        const [start, end] = await fixture(tool, extra);
        await hitCanvas(start);
        const before = await inspect();
        await touch('touchStart', [start]);
        await touch('touchMove', [end]);
        // A late second finger must also cancel a visible stroke, not just a quick candidate.
        await page.waitForTimeout(150);
        const second = { id: 1, x: end.x + 35, y: end.y };
        await hitCanvas(second);
        await touch('touchStart', [end, second]);
        await touch('touchMove', [{ ...end, x: end.x - 8 }, { ...second, x: second.x + 8 }]);
        await touch('touchEnd', [end]);
        await touch('touchMove', [{ ...end, y: end.y + 8 }]);
        await touch('touchEnd', []);
        assert.deepEqual(await inspect(), before, `Pinch pollution: ${tool} ${JSON.stringify(extra)}`);
        record(`pinch ${tool} ${JSON.stringify(extra)}`);
      }

      for (const [tool, extra] of [['fill', {}], ['pencil', {}], ['pencil', { objects: true }]]) {
        const [start] = await fixture(tool, extra);
        const before = await inspect();
        await touch('touchStart', [start]);
        const second = { id: 1, x: start.x + 35, y: start.y };
        await touch('touchStart', [start, second]);
        await touch('touchEnd', [second]);
        await touch('touchEnd', []);
        assert.deepEqual(await inspect(), before);
        record(`early pinch ${tool} ${JSON.stringify(extra)}`);
      }

      for (const [tool, extra] of [
        ['fill', {}], ['eraser', {}], ['pencil', { objects: true }],
        ['pencil', { objects: true, spawn: true }], ['pencil', { marker: true }], ['copy', { paste: true }],
      ]) {
        const coords = await fixture(tool, extra);
        const start = extra.paste ? coords[2] : coords[0];
        await hitCanvas(start);
        const before = await inspect();
        await touch('touchStart', [start]);
        await touch('touchEnd', []);
        const after = await inspect();
        assert.notDeepEqual({ rooms: after.rooms.map((r) => r.snapshot), goal: after.goal },
          { rooms: before.rooms.map((r) => r.snapshot), goal: before.goal }, `Tap must apply ${tool} ${JSON.stringify(extra)}`);
        if (extra.marker) assert.notDeepEqual(expanded ? after.goal : after.rooms[0].snapshot.goal,
          expanded ? before.goal : before.rooms[0].snapshot.goal);
        else if (extra.spawn) assert.notDeepEqual(after.rooms[0].snapshot.spawnPoint, before.rooms[0].snapshot.spawnPoint);
        else if (extra.objects) assert.notDeepEqual(after.rooms[0].snapshot.placedObjects, before.rooms[0].snapshot.placedObjects);
        else assert.notDeepEqual(after.rooms[0].snapshot.tileData, before.rooms[0].snapshot.tileData);
        record(`tap ${tool} ${JSON.stringify(extra)}`);
      }

      if (expanded) {
        for (const objects of [false, true]) {
          await fixture('pencil', { objects });
          const coords = await page.evaluate(() => {
            const scene = window.__touchScene;
            const camera = scene.cameras.main;
            camera.setZoom(Math.min(camera.width / 1280, camera.height / 352) * 0.8);
            scene.syncCameraBounds();
            camera.centerOn(640, 176);
            const canvas = scene.game.canvas;
            const rect = canvas.getBoundingClientRect();
            return [37, 44].map((x) => ({ id: 0,
              x: rect.x + ((x * 16 + 8 - camera.scrollX - camera.width / 2) * camera.zoom
                + camera.width / 2) * rect.width / canvas.width,
              y: rect.y + ((8 * 16 + 8 - camera.scrollY - camera.height / 2) * camera.zoom
                + camera.height / 2) * rect.height / canvas.height,
            }));
          });
          await page.waitForTimeout(50);
          for (const point of coords) await hitCanvas(point);
          const before = await inspect();
          await touch('touchStart', [coords[0]]);
          await touch('touchMove', [coords[1]]);
          const preview = await inspect();
          assert.notDeepEqual(preview.rooms[0].snapshot, before.rooms[0].snapshot);
          assert.notDeepEqual(preview.rooms[1].snapshot, before.rooms[1].snapshot);
          const second = { ...coords[1], id: 1, x: coords[1].x + 20 };
          await touch('touchStart', [coords[1], second]);
          await touch('touchEnd', []);
          assert.deepEqual(await inspect(), before);
          record(`cross-cell ${objects ? 'objects' : 'tiles'} rollback`);
        }
      }

      }
      const [start] = await fixture('pencil');
      const before = await inspect();
      await touch('touchStart', [start]);
      await touch('touchCancel', []);
      assert.deepEqual(await inspect(), before);
      record('native cancellation preserves history');
      await touch('touchStart', [start]);
      await page.evaluate(() => window.__touchScene.game.events.emit('blur'));
      await touch('touchEnd', []);
      assert.deepEqual(await inspect(), before);
      record('focus loss cancels preview');
      await touch('touchStart', [start]);
      await page.evaluate(async () => { (await import('/src/config.ts')).editorState.activeTool = 'fill'; });
      await touch('touchEnd', []);
      assert.deepEqual(await inspect(), before);
      record('tool change cancels preview');
      await page.evaluate(async () => { (await import('/src/config.ts')).editorState.activeTool = 'pencil'; });
      await touch('touchStart', [start]);
      await touch('touchEnd', []);
      assert.notDeepEqual((await inspect()).rooms[0].snapshot.tileData, before.rooms[0].snapshot.tileData);
      assert.equal((await inspect()).rooms[0].redo, false);
      record('fresh tap commits and replaces Redo');
      const [backupStart, backupEnd] = await fixture('pencil');
      const committed = await inspect();
      await page.evaluate((expanded) => {
        const scene = window.__touchScene;
        window.__touchBackupCaptures = [];
        window.__touchAutoSaveCalls = 0;
        if (expanded) {
          const original = scene.draftBackup.writeRoom.bind(scene.draftBackup);
          scene.draftBackup.writeRoom = (...args) => {
            window.__touchBackupCaptures.push(structuredClone(args[1]));
            return original(...args);
          };
        } else {
          const original = scene.roomSession.backupDraftForPageExit.bind(scene.roomSession);
          scene.roomSession.backupDraftForPageExit = () => {
            window.__touchBackupCaptures.push(scene.editRuntime.exportRoomSnapshot());
            return original();
          };
          scene.previewSmokePersistenceIsolated = false;
          scene.persistenceController.maybeAutoSave = () => { window.__touchAutoSaveCalls++; };
        }
      }, expanded);
      await touch('touchStart', [backupStart]);
      await touch('touchMove', [backupEnd]);
      await page.evaluate((expanded) => {
        if (expanded) window.__touchScene.flushDraftBackup();
        else {
          if (!window.__touchScene.interactionController.hasPendingTouchEdit) throw Error('Expected an owned preview.');
          window.__touchAutoSaveCalls = 0;
          window.__touchScene.maybeAutoSave(0);
        }
      }, expanded);
      assert.equal(await page.evaluate((expanded) => expanded ? window.__touchBackupCaptures.length
        : window.__touchAutoSaveCalls, expanded), 0, 'Uncommitted previews must stay out of persistence.');
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await touch('touchEnd', []);
      assert.deepEqual(await inspect(), committed);
      const captures = await page.evaluate(() => window.__touchBackupCaptures);
      assert.ok(captures.length > 0, 'Page exit must still flush committed dirty work.');
      for (const snapshot of captures) assert.deepEqual(snapshot,
        committed.rooms.find((room) => room.snapshot.id === snapshot.id).snapshot);
      record('autosave deferral and page-exit rollback');
      if (device.startsWith('phone')) {
        await page.locator('#btn-chat-toggle-floating').tap();
        assert.equal(await page.locator('#global-chat').evaluate((element) => element.classList.contains('is-open')), true);
        await page.locator('#btn-chat-close').tap();
        assert.equal(await page.locator('#global-chat').evaluate((element) => element.classList.contains('is-open')), false);
        await hitCanvas(backupStart);
        record('closed chat passes canvas input while its button stays interactive');
      }
      await page.screenshot({ path: `${output}/${device}-${mode}-final.png` });
    }
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
