import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.argv[2] || 'http://127.0.0.1:4517/';
const outputDir = process.env.POLICE_SMOKE_OUTPUT_DIR || 'output/web-game/police-enemies';
const url = new URL(baseUrl);
url.searchParams.set('previewSmoke', '1');
url.searchParams.set('renderer', 'canvas');

mkdirSync(outputDir, { recursive: true });

const summary = {
  url: url.toString(),
  outputDir,
  consoleErrors: [],
  pageErrors: [],
  editor: null,
  runtime: null,
};

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
await context.addInitScript(() => {
  window.localStorage.setItem('wamp_install_help_dismissed_v1', '1');
  window.localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
});
const page = await context.newPage();

page.on('console', (message) => {
  if (message.type() === 'error') {
    summary.consoleErrors.push(message.text());
  }
});
page.on('pageerror', (error) => summary.pageErrors.push(error.message));

try {
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.run_preview_smoke_action === 'function');
  await waitForState(
    page,
    (state) => state?.appFeedback?.ready === true && state?.activeScene?.scene === 'overworld-play',
    'overworld boot',
  );

  const fixture = await page.evaluate(
    () => window.run_preview_smoke_action?.('openSyntheticPoliceEditor') ?? null,
  );
  assert.equal(fixture?.ok, true, `Police editor fixture failed: ${JSON.stringify(fixture)}`);
  await waitForState(page, (state) => state?.activeScene?.scene === 'editor', 'editor');

  await page.click('.palette-tab[data-mode="objects"]');
  await page.fill('#object-search-input', 'Police');
  await page.waitForFunction(() => document.querySelectorAll('.object-item[data-object-id^="police"]').length === 2);
  await page.screenshot({ path: path.join(outputDir, 'police-palette.png') });
  await setCanvasVisibility(page, false);
  await page.locator('#object-palette-section').screenshot({ path: path.join(outputDir, 'police-palette-panel.png') });
  await setCanvasVisibility(page, true);

  await page.click('.object-item[data-object-id="police_patrolman"]');
  const canvasBox = await page.evaluate(() => Array.from(document.querySelectorAll('canvas'))
    .map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null);
  assert.ok(canvasBox, 'Game canvas was not visible.');
  await page.mouse.click(
    canvasBox.x + canvasBox.width * 0.68,
    canvasBox.y + canvasBox.height * 0.73,
  );
  await page.waitForSelector('#police-behavior-panel:not(.hidden)');

  assert.equal(await page.inputValue('#police-behavior-mode-select'), 'hunter');
  assert.equal(await page.locator('#police-patrol-shoots-row').evaluate((element) => element.classList.contains('hidden')), true);

  await page.selectOption('#police-behavior-mode-select', 'patrol');
  await page.waitForFunction(() => !document.querySelector('#police-patrol-shoots-row')?.classList.contains('hidden'));
  await page.check('#police-patrol-shoots-checkbox');
  assert.equal(await page.isChecked('#police-patrol-shoots-checkbox'), true);
  await page.screenshot({ path: path.join(outputDir, 'police-patrol-inspector.png') });
  await setCanvasVisibility(page, false);
  await page.locator('#editor-inspector').screenshot({ path: path.join(outputDir, 'police-patrol-inspector-panel.png') });
  await setCanvasVisibility(page, true);

  const editorState = await readState(page);
  summary.editor = {
    scene: editorState?.activeScene?.scene ?? null,
    placedObjects: editorState?.activeScene?.placedObjects ?? null,
    selectedMode: await page.inputValue('#police-behavior-mode-select'),
    patrolShoots: await page.isChecked('#police-patrol-shoots-checkbox'),
  };
  assert.equal(summary.editor.placedObjects, 3);

  await page.click('#btn-test-play');
  await waitForState(
    page,
    (state) => state?.activeScene?.scene === 'overworld-play' && state?.activeScene?.mode === 'play',
    'test play',
  );
  const playState = await waitForState(
    page,
    (state) => policeObjects(state).length >= 3,
    'police runtime objects',
  );
  const initialPolice = policeObjects(playState);
  assert.ok(initialPolice.some((enemy) => enemy.id === 'police_patrolman' && enemy.policeBehaviorMode === 'hunter'));
  assert.ok(initialPolice.some((enemy) => enemy.id === 'policewoman' && enemy.policeBehaviorMode === 'patrol' && enemy.policePatrolShoots === true));

  let observedHunterState = null;
  let observedHunterReloadState = null;
  let observedHunterPostReloadState = null;
  let observedHunterSecondAttackState = null;
  let observedPatrolShooterState = null;
  let lastObservedState = playState;
  let lastHunterAiState = null;
  let hunterAttackCycleCount = 0;
  const runtimeSamples = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < 4000) {
    const state = await readState(page);
    lastObservedState = state;
    const police = policeObjects(state);
    const hunter = police.find((enemy) => enemy.id === 'police_patrolman' && enemy.policeBehaviorMode === 'hunter');
    const patrolShooter = police.find(
      (enemy) => enemy.id === 'policewoman' && enemy.policeBehaviorMode === 'patrol' && enemy.policePatrolShoots === true,
    );
    if (hunter?.aiState === 'attack' && lastHunterAiState !== 'attack') {
      hunterAttackCycleCount += 1;
      if (hunterAttackCycleCount >= 2 && !observedHunterSecondAttackState) {
        observedHunterSecondAttackState = state;
      }
    }
    lastHunterAiState = hunter?.aiState ?? null;
    const sample = {
      player: state?.activeScene?.player
        ? { x: state.activeScene.player.x, y: state.activeScene.player.y }
        : null,
      hunter: hunter
        ? { x: hunter.x, y: hunter.y, aiState: hunter.aiState, textureKey: hunter.textureKey }
        : null,
      projectileCount: state?.activeScene?.combat?.projectileCount ?? 0,
    };
    if (JSON.stringify(sample) !== JSON.stringify(runtimeSamples.at(-1))) {
      runtimeSamples.push(sample);
    }
    if (hunter?.aiState === 'attack' && !observedHunterState) {
      observedHunterState = state;
      await page.screenshot({ path: path.join(outputDir, 'police-hunter-shoot-registration.png') });
    }
    if (
      hunter?.aiState === 'cooldown'
      && hunter?.animationKey === 'police_patrolman-reload'
      && !observedHunterReloadState
    ) {
      observedHunterReloadState = state;
      await page.screenshot({ path: path.join(outputDir, 'police-hunter-reload-registration.png') });
    }
    if (
      observedHunterReloadState
      && hunter?.aiState !== 'attack'
      && hunter?.aiState !== 'cooldown'
      && hunter?.originX === 0.5
      && !observedHunterPostReloadState
    ) {
      observedHunterPostReloadState = state;
    }
    if (patrolShooter?.aiState === 'attack') {
      observedPatrolShooterState = state;
    }
    if (
      observedHunterState
      && observedHunterReloadState
      && observedHunterPostReloadState
      && observedHunterSecondAttackState
      && observedPatrolShooterState
    ) {
      break;
    }
    await page.waitForTimeout(50);
  }
  if (
    !observedHunterState
    || !observedHunterReloadState
    || !observedHunterPostReloadState
    || !observedHunterSecondAttackState
    || !observedPatrolShooterState
  ) {
    summary.runtime = {
      police: policeObjects(lastObservedState),
      samples: runtimeSamples,
    };
    await page.screenshot({ path: path.join(outputDir, 'police-test-play-failed.png') });
  }
  assert.ok(observedHunterState, 'Hunter police enemy never reached its ranged attack state.');
  assert.ok(observedHunterReloadState, 'Hunter police enemy never reached its reload state.');
  assert.ok(observedHunterPostReloadState, 'Hunter police enemy never restored its standing registration after reload.');
  assert.ok(observedHunterSecondAttackState, 'Hunter police enemy never completed a second firing cycle.');
  assert.ok(observedPatrolShooterState, 'Patrol+Shoot police enemy never reached its ranged attack state.');

  const hunterAttack = policeObjects(observedHunterState).find(
    (enemy) => enemy.id === 'police_patrolman' && enemy.policeBehaviorMode === 'hunter',
  );
  const hunterReload = policeObjects(observedHunterReloadState).find(
    (enemy) => enemy.id === 'police_patrolman' && enemy.policeBehaviorMode === 'hunter',
  );
  const hunterPostReload = policeObjects(observedHunterPostReloadState).find(
    (enemy) => enemy.id === 'police_patrolman' && enemy.policeBehaviorMode === 'hunter',
  );
  const hunterSecondAttack = policeObjects(observedHunterSecondAttackState).find(
    (enemy) => enemy.id === 'police_patrolman' && enemy.policeBehaviorMode === 'hunter',
  );
  assert.ok(hunterAttack);
  assert.ok(hunterReload);
  assert.ok(hunterPostReload);
  assert.ok(hunterSecondAttack);
  assert.equal(hunterAttack.originX, hunterAttack.flipX ? 0.875 : 0.125);
  assert.equal(hunterReload.originX, hunterReload.flipX ? 0.5938 : 0.4063);
  assert.equal(hunterPostReload.originX, 0.5);
  assert.equal(hunterSecondAttack.originX, hunterSecondAttack.flipX ? 0.875 : 0.125);
  assert.equal(hunterAttack.bodyCenterX, hunterReload.bodyCenterX);
  assert.equal(
    Number((hunterAttack.bodyCenterX - hunterAttack.x).toFixed(2)),
    Number((hunterPostReload.bodyCenterX - hunterPostReload.x).toFixed(2)),
  );
  assert.equal(
    Number((hunterAttack.bodyCenterX - hunterAttack.x).toFixed(2)),
    Number((hunterSecondAttack.bodyCenterX - hunterSecondAttack.x).toFixed(2)),
  );

  summary.runtime = {
    police: policeObjects(lastObservedState).map((enemy) => ({
      id: enemy.id,
      mode: enemy.policeBehaviorMode,
      patrolShoots: enemy.policePatrolShoots,
      aiState: enemy.aiState,
      textureKey: enemy.textureKey,
    })),
    observedAttacks: {
      hunter: policeObjects(observedHunterState).find(
        (enemy) => enemy.id === 'police_patrolman' && enemy.policeBehaviorMode === 'hunter',
      ),
      patrolShooter: policeObjects(observedPatrolShooterState).find(
        (enemy) => enemy.id === 'policewoman' && enemy.policeBehaviorMode === 'patrol',
      ),
      hunterReload,
      hunterPostReload,
      hunterSecondAttack,
    },
  };
  await setEarlyWorldTilesVisibility(page, false);
  await page.screenshot({ path: path.join(outputDir, 'police-test-play.png') });
  await setEarlyWorldTilesVisibility(page, true);

  assert.deepEqual(summary.consoleErrors, []);
  assert.deepEqual(summary.pageErrors, []);
  summary.ok = true;
} catch (error) {
  summary.ok = false;
  summary.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  await browser.close();
}

console.log(JSON.stringify(summary, null, 2));

function policeObjects(state) {
  return (state?.activeScene?.liveObjects ?? []).filter(
    (object) => object.id === 'police_patrolman' || object.id === 'policewoman',
  );
}

async function readState(page) {
  return page.evaluate(() => {
    const raw = window.render_game_to_text?.() ?? '';
    return raw ? JSON.parse(raw) : null;
  });
}

async function setCanvasVisibility(page, visible) {
  await page.evaluate((nextVisible) => {
    for (const surface of document.querySelectorAll('canvas, #wamp-early-world-tiles')) {
      surface.style.visibility = nextVisible ? '' : 'hidden';
    }
  }, visible);
}

async function setEarlyWorldTilesVisibility(page, visible) {
  await page.evaluate((nextVisible) => {
    const layer = document.querySelector('#wamp-early-world-tiles');
    if (layer instanceof HTMLElement) {
      layer.style.visibility = nextVisible ? '' : 'hidden';
    }
  }, visible);
}

async function waitForState(page, predicate, label, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastState = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastState = await readState(page);
    if (lastState && predicate(lastState)) {
      return lastState;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(lastState?.activeScene ?? null)}`);
}
