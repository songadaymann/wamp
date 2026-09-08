import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:3014';
const output = process.env.ROOM_CAMERA_SMOKE_OUTPUT_DIR ?? '/tmp/wamp-room-camera-smoke';
mkdirSync(output, { recursive: true });
const touch = process.env.ROOM_CAMERA_SMOKE_TOUCH === '1';
const renderer = process.env.ROOM_CAMERA_SMOKE_RENDERER ?? 'canvas';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: touch ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: touch, hasTouch: touch });
await page.addInitScript(() => {
  localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
  localStorage.setItem('wamp_install_help_dismissed_v1', '1');
});
const errors = [];
const networkWarnings = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const text = message.text();
  // The synthetic room has no remote leaderboard/chat; blocked writes and external telemetry
  // may also fail in an isolated browser. Keep those visible separately from runtime errors.
  if (text.includes('404') || text.includes('cloudflareinsights') || text.includes('net::ERR_FAILED')
    || (text.includes('TypeError: Failed to fetch') && (text.startsWith('Failed to load leaderboards') || text.startsWith('Failed to poll chat messages')))) {
    networkWarnings.push(text);
  } else errors.push(text);
});
await page.route('**/api/**', (route) => {
  if (!['GET', 'OPTIONS'].includes(route.request().method())) return route.abort();
  return route.continue();
});
try {
  await page.goto(`${baseUrl}/?previewSmoke=1&renderer=${renderer}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.appReady === 'true', null, { timeout: 120000 });
  console.log('App ready');
  assert.equal((await page.evaluate(() => window.run_preview_smoke_action('openSyntheticEditor'))).ok, true);
  await page.waitForFunction(() => document.body.dataset.appMode === 'editor');
  await page.evaluate(() => {
    const editor = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.EditorScene;
    const snapshot = editor.editRuntime.exportRoomSnapshot();
    snapshot.background = 'forest';
    snapshot.lighting = { mode: 'off' };
    snapshot.tileData.terrain[17].fill(1);
    snapshot.spawnPoint = { x: 320, y: 220 };
    editor.editRuntime.applyRoomSnapshot(snapshot);
  });
  if (await page.locator('#auth-panel').evaluate((el) => el.classList.contains('menu-open'))) await page.click('#menu-toggle');
  if (touch) {
    await page.click('[data-mobile-editor-sheet="background"]');
    if (!await page.locator('#room-camera-centered').isVisible()) await page.locator('#room-camera-section .sidebar-section-toggle').click();
  } else {
    await page.click('[data-editor-shell-action="room"]');
    await page.click('[data-editor-room-section="camera"]');
  }
  const toggle = page.locator('#room-camera-centered');
  assert.equal(await toggle.isChecked(), false);
  await toggle.check();
  await page.screenshot({ path: `${output}/editor-camera.png` });
  assert.equal((await page.evaluate(() => window.run_preview_smoke_action('saveSyntheticEditorToLocal'))).ok, true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.appReady === 'true', null, { timeout: 120000 });
  assert.equal((await page.evaluate(() => window.run_preview_smoke_action('openSyntheticEditorFromLocal'))).ok, true);
  await page.waitForFunction(() => document.body.dataset.appMode === 'editor');
  assert.equal(await toggle.isChecked(), true);
  console.log('Editor toggle survives save / page reload / reopen');
  await page.evaluate(() => window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.EditorScene.startPlayMode());
  await page.waitForFunction(() => {
    const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.OverworldPlayScene;
    return scene.scene.isActive() && scene.player && scene.cameraController.isRoomCameraFixed();
  }, null, { timeout: 120000 });
  await page.waitForTimeout(600);
  if (await page.locator('#auth-panel').evaluate((el) => el.classList.contains('menu-open'))) await page.click('#menu-toggle');
  const state = () => page.evaluate(() => {
    const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.OverworldPlayScene;
    const camera = scene.cameras.main;
    return { room: scene.currentRoomCoordinates, player: { x: scene.player.x, y: scene.player.y }, fixed: scene.cameraController.isRoomCameraFixed(),
      camera: { x: camera.scrollX, y: camera.scrollY, width: camera.width, height: camera.height, zoom: camera.zoom, follow: !!camera._follow }, normalZoom: scene.inspectZoom };
  });
  const centered = await state();
  console.log('Entered fixed room', JSON.stringify(centered));
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(250);
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(300);
  const moved = await state();
  assert.ok(moved.player.x > centered.player.x + 10);
  assert.deepEqual(moved.camera, centered.camera);
  await page.mouse.move(900, 300);
  await page.mouse.wheel(0, -150);
  await page.keyboard.press('f');
  assert.deepEqual((await state()).camera, centered.camera);
  await page.screenshot({ path: `${output}/play-fixed-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const portrait = await state();
  assert.equal(portrait.fixed, true);
  assert.ok(portrait.camera.width / portrait.camera.zoom >= 640 - 0.01);
  await page.screenshot({ path: `${output}/play-fixed-portrait.png` });
  console.log('Fixed room holds during movement / zoom input and refits portrait', JSON.stringify(portrait));
  if (!touch) await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.OverworldPlayScene;
    const room = structuredClone(scene.getRoomSnapshotViewForCoordinates({ x: 99, y: 99 }));
    room.id = '100,99';
    room.coordinates = { x: 100, y: 99 };
    room.cameraMode = 'follow';
    scene.worldStreamingController.setDraftRoom(room);
    scene.worldStreamingController.setTransientRoomOverride(room);
  });
  await page.waitForFunction(() => window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.OverworldPlayScene.debugPrepareTransitionDestination('100,99').collisionReady, null, { timeout: 30000 });
  const crossTo = async (x) => {
    await page.evaluate((roomX) => {
      const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.OverworldPlayScene;
      scene.debugSetPlayerPosition({ x: roomX * 640 + 24, y: 99 * 352 + 160, bodyEnabled: false });
    }, x);
    await page.waitForFunction((roomX) => window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.OverworldPlayScene.currentRoomCoordinates.x === roomX, x, { timeout: 15000 });
    await page.waitForTimeout(400);
  };
  await crossTo(100);
  const exited = await state();
  assert.equal(exited.fixed, false);
  assert.equal(exited.camera.follow, true);
  assert.equal(exited.camera.zoom, exited.normalZoom);
  console.log('Crossed into neighboring room: normal follow and zoom restored');
  await page.waitForFunction(() => window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.OverworldPlayScene.debugPrepareTransitionDestination('99,99').collisionReady);
  await crossTo(99);
  const reentered = await state();
  assert.equal(reentered.fixed, true);
  assert.equal(reentered.camera.follow, false);
  await page.evaluate(() => window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.OverworldPlayScene.respawnPlayerToCurrentRoom());
  await page.waitForTimeout(400);
  assert.equal((await state()).fixed, true);
  await page.screenshot({ path: `${output}/play-reentered.png` });
  console.log('Reentry and respawn keep whole-room framing');
  await page.evaluate(() => window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.OverworldPlayScene.returnToWorld());
  await page.waitForTimeout(600);
  const returned = await page.evaluate(() => {
    const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.OverworldPlayScene;
    return { mode: scene.mode, fixed: scene.cameraController.isRoomCameraFixed() };
  });
  assert.equal(returned.fixed, false);
  if (touch) {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal((await page.evaluate(() => window.run_preview_smoke_action('openSyntheticEditorFromLocal'))).ok, true);
    if (await page.locator('#auth-panel').evaluate((el) => el.classList.contains('menu-open'))) await page.click('#menu-toggle');
    if (!await toggle.isVisible()) await page.click('[data-mobile-editor-sheet="background"]');
    if (!await toggle.isVisible()) await page.locator('#room-camera-section .sidebar-section-toggle').click();
    assert.equal(await toggle.isChecked(), true);
    await toggle.uncheck();
    assert.equal((await page.evaluate(() => window.run_preview_smoke_action('saveSyntheticEditorToLocal'))).ok, true);
    await page.screenshot({ path: `${output}/editor-camera-phone.png` });
    const capture = await page.evaluate(() => window.run_preview_smoke_action('runEditorCommands', { editorCommands: [{ op: 'capture', name: 'phone' }] }));
    assert.equal(capture.captures.phone.cameraMode, 'follow');
    console.log('Phone editor exposes the saved camera toggle and can turn it off');
  }
  writeFileSync(`${output}/state.json`, JSON.stringify({ centered, moved, portrait, exited, reentered, returned, errors, networkWarnings }, null, 2));
  assert.deepEqual(errors, []);
} catch (error) {
  console.error('Browser errors', errors);
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally { await browser.close(); }
