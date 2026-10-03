import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

// Synthetic editor fixtures only. This probe requires a local development
// server; production room/account writes are never part of recovery QA.
const base = process.env.DRAFT_RECOVERY_SMOKE_URL || 'http://127.0.0.1:3017';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const url = new URL(base);
url.searchParams.set('previewSmoke', '1');
url.searchParams.set('renderer', 'canvas');
const output = process.env.DRAFT_RECOVERY_SMOKE_OUTPUT || 'output/web-game/draft-recovery';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const summary = { scenarios: [], pageErrors: [], blockedWrites: [] };

async function boot(page) {
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.appReady === 'true', undefined, { timeout: 120_000 });
  await page.evaluate(() => {
    window.__wampEarlyWorldTiles?.release('draft-recovery-smoke');
    document.querySelector('#btn-welcome-close')?.click();
  });
}

async function openSingle(page, recover = false) {
  const opened = await page.evaluate(() => window.run_preview_smoke_action?.('openSyntheticEditor'));
  assert.equal(opened?.ok, true, JSON.stringify(opened));
  return page.evaluate(async (recover) => {
    const { createDefaultRoomRecord, createRoomSummaryFromRecord } = await import('/src/persistence/roomModel.ts');
    const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.EditorScene;
    const record = createDefaultRoomRecord('99,99', { x: 99, y: 99 });
    record.draft.createdAt = record.draft.updatedAt = '2026-10-03T12:00:00.000Z';
    record.draft.title = 'Account Draft';
    record.claimerUserId = 'synthetic-builder';
    record.claimedAt = record.draft.createdAt;
    scene.roomSession.maybeAutoSave = () => {};
    scene.roomSession.roomRepository.loadRoomCurrent = async () => ({
      summary: createRoomSummaryFromRecord(record), draft: record.draft, published: null,
    });
    if (recover) await scene.roomSession.loadPersistedRoom(null);
    else {
      localStorage.removeItem('everybodys-platformer:room:99,99');
      await scene.roomSession.loadPersistedRoom(null);
    }
    return { title: scene.exportRoomSnapshot().title, dirty: scene.editRuntime.isRoomDirty };
  }, recover);
}

async function openExpanded(page, remoteTime = '2026-10-03T12:00:00.000Z') {
  await page.evaluate(async (remoteTime) => {
    const session = await import('/src/courses/draftSession.ts');
    const { createDefaultCourseRecord } = await import('/src/courses/model.ts');
    const { createDefaultRoomRecord } = await import('/src/persistence/roomModel.ts');
    const game = window.__EVERYBODYS_PLATFORMER_GAME__;
    for (const name of ['EditorScene', 'CourseEditorScene', 'CourseComposerScene']) {
      if (game.scene.isActive(name) || game.scene.isSleeping(name)) game.scene.stop(name);
    }
    session.clearActiveCourseDraftSession();
    const course = createDefaultCourseRecord('recovery-smoke-expanded');
    course.draft.title = 'Account Expanded Room';
    course.draft.createdAt = course.draft.updatedAt = remoteTime;
    const rooms = [99, 100].map((x) => {
      const record = createDefaultRoomRecord(`${x},99`, { x, y: 99 });
      record.draft.title = `Account cell ${x}`;
      record.draft.createdAt = record.draft.updatedAt = course.draft.updatedAt;
      record.claimerUserId = 'synthetic-builder';
      record.claimedAt = course.draft.updatedAt;
      return record;
    });
    course.draft.roomRefs = rooms.map(({ draft }) => ({
      roomId: draft.id, coordinates: draft.coordinates, roomVersion: draft.version, roomTitle: draft.title,
    }));
    const scene = game.scene.keys.CourseEditorScene;
    scene.expandedRoomEditorRepository.loadExpandedRoomRecord = async () => structuredClone(course);
    scene.roomRepository.loadRoom = async (id) => structuredClone(rooms.find((room) => room.draft.id === id));
    window.__draftRecoveryFixtures = { course, rooms };
    game.scene.run('CourseEditorScene', { courseId: course.draft.id, selectedRoomId: rooms[0].draft.id });
    if (game.scene.isActive('OverworldPlayScene')) game.scene.sleep('OverworldPlayScene');
  }, remoteTime);
  await page.waitForFunction(() => {
    const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.CourseEditorScene;
    return !scene.loading && scene.roomSlices.size === 2 && scene.roomBackupBases.size === 2;
  });
  // Room hydration is asynchronous after the workspace is created.
  await page.waitForTimeout(150);
}

async function expandedState(page) {
  return page.evaluate(async () => {
    const session = await import('/src/courses/draftSession.ts');
    const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.CourseEditorScene;
    return {
      title: session.getActiveCourseDraftSessionRecord().draft.title,
      goal: session.getActiveCourseDraftSessionRecord().draft.goal?.type ?? null,
      metadataDirty: session.isActiveCourseDraftSessionDirty(),
      cells: [...scene.roomSlices.values()].map((slice) => ({
        id: slice.roomId, title: slice.runtime.exportRoomSnapshot().title,
        tile: slice.runtime.exportRoomSnapshot().tileData.terrain[12][12], dirty: slice.runtime.isRoomDirty,
      })),
    };
  });
}

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, ...(viewport.width < 500 ? {
      isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    } : {}) });
    const page = await context.newPage();
    page.on('pageerror', (error) => summary.pageErrors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (!['GET', 'OPTIONS'].includes(request.method())
        && !['/api/rooms/snapshots/query', '/api/presence/identity-token'].includes(pathname)
        && !pathname.startsWith('/api/guest-activity/')) {
        summary.blockedWrites.push(`${request.method()} ${pathname}`);
        return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Synthetic recovery QA blocks writes"}' });
      }
      return route.continue();
    });
    await boot(page);
    assert.equal((await openSingle(page)).dirty, false);
    await page.evaluate(() => {
      const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.EditorScene;
      scene.setRoomTitle('Recovered after tab reload');
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      window.__draftWarningPrevented = event.defaultPrevented;
      window.dispatchEvent(new Event('pagehide'));
    });
    assert.equal(await page.evaluate(() => window.__draftWarningPrevented), true);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('everybodys-platformer:room:99,99')));
    assert.equal(stored.draft.title, 'Recovered after tab reload');
    assert.equal(stored.localBackup.baseUpdatedAt, '2026-10-03T12:00:00.000Z');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.dataset.appReady === 'true', undefined, { timeout: 120_000 });
    const restored = await openSingle(page, true);
    assert.deepEqual(restored, { title: 'Recovered after tab reload', dirty: true });
    await page.screenshot({ path: path.join(output, `single-recovered-${viewport.width}.png`) });
    summary.scenarios.push({ name: 'single-room-reload', viewport, restored });

    await openExpanded(page);
    await page.evaluate(async () => {
      const session = await import('/src/courses/draftSession.ts');
      const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.CourseEditorScene;
      session.updateActiveCourseDraftSession((draft) => { draft.title = 'Recovered expanded setup'; });
      scene.setCourseGoalType('reach_exit');
      for (const slice of scene.roomSlices.values()) {
        scene.selectRoomById(slice.roomId);
        scene.setRoomTitle(`Recovered cell ${slice.coordinates.x}`);
        slice.layers.get('terrain').putTileAt(1, 12, 12);
        slice.runtime.isRoomDirty = true;
        slice.runtime.currentLastDirtyAt = performance.now();
      }
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      window.__draftWarningPrevented = event.defaultPrevented;
      window.dispatchEvent(new Event('pagehide'));
    });
    assert.equal(await page.evaluate(() => window.__draftWarningPrevented), true);
    const before = await expandedState(page);
    assert.equal(before.metadataDirty, true);
    assert.ok(before.cells.every((cell) => cell.dirty && cell.tile === 1));
    await boot(page);
    await openExpanded(page);
    const recoveredExpanded = await expandedState(page);
    assert.deepEqual(recoveredExpanded, before);
    await page.screenshot({ path: path.join(output, `expanded-recovered-${viewport.width}.png`) });
    summary.scenarios.push({ name: 'expanded-two-cell-and-settings-reload', viewport, restored: recoveredExpanded });

    // Save one cell, fail the next, then edit while the retry is in flight.
    // Successful cells clear only their backup; the later edit stays dirty.
    const partial = await page.evaluate(async () => {
      const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.CourseEditorScene;
      let calls = 0;
      scene.roomRepository.saveDraft = async (sent) => {
        calls += 1;
        if (calls === 2) throw new Error('Synthetic offline save');
        const record = structuredClone(window.__draftRecoveryFixtures.rooms.find((room) => room.draft.id === sent.id));
        record.draft = { ...structuredClone(sent), updatedAt: '2026-10-03T13:00:00.000Z' };
        return record;
      };
      await scene.saveDraft();
      const first = [...scene.roomSlices.values()].map((slice) => slice.runtime.isRoomDirty);
      let release;
      scene.roomRepository.saveDraft = (sent) => new Promise((resolve) => {
        release = () => {
          const record = structuredClone(window.__draftRecoveryFixtures.rooms.find((room) => room.draft.id === sent.id));
          record.draft = { ...structuredClone(sent), updatedAt: '2026-10-03T14:00:00.000Z' };
          resolve(record);
        };
      });
      const saving = scene.saveDraft();
      scene.selectRoomById('100,99');
      scene.setRoomTitle('Edited during Save');
      release();
      await saving;
      const second = scene.roomSlices.get('100,99');
      const backup = Object.keys(localStorage).filter((key) => key.startsWith('wamp:expanded-draft-backup:v1:'))
        .map((key) => ({ key, value: JSON.parse(localStorage.getItem(key)) }));
      return { first, title: second.runtime.exportRoomSnapshot().title, dirty: second.runtime.isRoomDirty,
        roomBackups: backup.filter(({ key }) => key.includes(':room:')).map(({ value }) => ({
          id: value.snapshot.id, title: value.snapshot.title, baseUpdatedAt: value.baseUpdatedAt,
        })) };
    });
    assert.deepEqual(partial.first, [false, true]);
    assert.equal(partial.title, 'Edited during Save');
    assert.equal(partial.dirty, true);
    assert.deepEqual(partial.roomBackups, [{ id: '100,99', title: 'Edited during Save', baseUpdatedAt: '2026-10-03T14:00:00.000Z' }]);
    summary.scenarios.push({ name: 'expanded-partial-save-and-in-flight-edit', viewport, ...partial });

    const immediateSave = await page.evaluate(async () => {
      const session = await import('/src/courses/draftSession.ts');
      const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.CourseEditorScene;
      const storageKeys = () => Object.keys(localStorage).filter((key) => key.startsWith('wamp:expanded-draft-backup:v1:'));
      scene.selectRoomById('100,99');
      scene.setRoomTitle('Older backed-up edit');
      window.dispatchEvent(new Event('pagehide'));
      scene.setRoomTitle('Immediate Save revision');
      scene.roomRepository.saveDraft = async (sent) => {
        const record = structuredClone(window.__draftRecoveryFixtures.rooms.find((room) => room.draft.id === sent.id));
        record.draft = { ...structuredClone(sent), updatedAt: '2026-10-03T15:00:00.000Z' };
        return record;
      };
      await scene.saveDraft();
      const cellBackups = storageKeys().filter((key) => key.includes(':room:')).length;
      const baseline = session.getActiveCourseDraftSessionPersistedDraft();
      session.updateActiveCourseDraftSession((draft) => Object.assign(draft, baseline));
      window.dispatchEvent(new Event('pagehide'));
      const courseBackups = storageKeys().filter((key) => key.endsWith(':course')).length;
      return { cellBackups, courseBackups, metadataDirty: session.isActiveCourseDraftSessionDirty() };
    });
    assert.deepEqual(immediateSave, { cellBackups: 0, courseBackups: 0, metadataDirty: false });
    summary.scenarios.push({ name: 'immediate-save-and-reverted-metadata', viewport, ...immediateSave });

    await page.evaluate(() => {
      const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.CourseEditorScene;
      window.__originalStorageSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('wamp:expanded-draft-backup:v1:')) throw new DOMException('Synthetic quota', 'QuotaExceededError');
        return window.__originalStorageSetItem.call(this, key, value);
      };
      scene.setRoomTitle('Quota-failure edit stays dirty');
    });
    await page.waitForFunction(() => document.body.textContent.includes('Could not back up changes on this device.'));
    const storageFailure = await page.evaluate(() => {
      Storage.prototype.setItem = window.__originalStorageSetItem;
      const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.CourseEditorScene;
      window.dispatchEvent(new Event('pagehide'));
      return { dirty: scene.roomSlices.get('100,99').runtime.isRoomDirty };
    });
    assert.equal(storageFailure.dirty, true);
    summary.scenarios.push({ name: 'storage-failure-visible-and-dirty-retained', viewport, ...storageFailure });

    await boot(page);
    const openingNewerDraft = openExpanded(page, '2026-10-03T16:00:00.000Z');
    await page.getByRole('button', { name: 'Restore Local', exact: true }).click();
    await openingNewerDraft;
    const conflictRestored = (await expandedState(page)).cells.find((cell) => cell.id === '100,99');
    assert.equal(conflictRestored.title, 'Quota-failure edit stays dirty');
    assert.equal(conflictRestored.dirty, true);
    summary.scenarios.push({ name: 'newer-account-draft-explicit-restore', viewport, restored: conflictRestored });

    await page.evaluate(() => {
      const scene = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.CourseEditorScene;
      for (const slice of scene.roomSlices.values()) {
        scene.selectRoomById(slice.roomId);
        scene.setRoomTitle(`Pending Save cell ${slice.coordinates.x}`);
      }
      let calls = 0;
      scene.roomRepository.saveDraft = (sent) => {
        calls += 1;
        window.__pendingCellSaveCalls = calls;
        return new Promise((resolve) => {
          window.__releasePendingCellSave = () => {
            const record = structuredClone(window.__draftRecoveryFixtures.rooms.find((room) => room.draft.id === sent.id));
            record.draft = { ...structuredClone(sent), updatedAt: '2026-10-03T17:00:00.000Z' };
            resolve(record);
          };
        });
      };
      window.__pendingCellSave = scene.saveDraft();
    });

    await page.evaluate(() => {
      const game = window.__EVERYBODYS_PLATFORMER_GAME__;
      const composer = game.scene.keys.CourseComposerScene;
      composer.expandedRoomEditorRepository.loadExpandedRoomRecord = async () => structuredClone(window.__draftRecoveryFixtures.course);
      composer.roomRepository.loadRoom = async (id) => structuredClone(window.__draftRecoveryFixtures.rooms.find((room) => room.draft.id === id));
      game.scene.run('CourseComposerScene', { courseId: window.__draftRecoveryFixtures.course.draft.id });
    });
    await page.waitForFunction(() => {
      const composer = window.__EVERYBODYS_PLATFORMER_GAME__.scene.keys.CourseComposerScene;
      return composer.record && !composer.loading;
    });
    await page.evaluate(async () => {
      const game = window.__EVERYBODYS_PLATFORMER_GAME__;
      game.scene.sleep('CourseComposerScene');
      game.scene.keys.CourseEditorScene.selectRoomById('100,99');
      game.scene.keys.CourseEditorScene.setRoomTitle('Last edit before returning');
      await game.scene.keys.CourseEditorScene.returnToCourseBuilder();
    });
    await page.waitForFunction(() => window.__EVERYBODYS_PLATFORMER_GAME__.scene.isActive('CourseComposerScene'));
    const lateSaveCalls = await page.evaluate(async () => {
      window.__releasePendingCellSave();
      await window.__pendingCellSave;
      return window.__pendingCellSaveCalls;
    });
    assert.equal(lateSaveCalls, 1);
    summary.scenarios.push({ name: 'pending-multi-cell-save-stops-after-editor-exit', viewport, calls: lateSaveCalls });
    const handoff = await page.evaluate(async () => {
      const session = await import('/src/courses/draftSession.ts');
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      const cellBackupKey = Object.keys(localStorage).find((key) => key.startsWith('wamp:expanded-draft-backup:v1:') && key.endsWith(':room:100%2C99'));
      return { warned: event.defaultPrevented, metadataDirty: session.isActiveCourseDraftSessionDirty(),
        unsavedCells: session.hasActiveCourseDraftSessionUnsavedRooms(),
        title: JSON.parse(localStorage.getItem(cellBackupKey)).snapshot.title };
    });
    assert.deepEqual(handoff, { warned: true, metadataDirty: false, unsavedCells: true, title: 'Last edit before returning' });
    summary.scenarios.push({ name: 'composer-handoff-keeps-unsaved-cell-warning', viewport, ...handoff });
    await context.close();
  }
  assert.deepEqual(summary.pageErrors, []);
  assert.deepEqual(summary.blockedWrites, []);
  writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
}
