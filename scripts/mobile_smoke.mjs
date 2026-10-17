import { auditMannCool } from './lib/mannCoolAudits.mjs';
import { auditNavigation, installNavigationFixtures } from './lib/navigationAudits.mjs';
import { auditStartupDownloads, installStartupFixture } from './lib/startupAudits.mjs';
import { installHapticProbe, auditHapticSettings, auditHapticClear } from './lib/hapticAudits.mjs';
import { auditGamepadControls } from './lib/gamepadAudits.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { createApiFixtures } from './lib/apiFixtures.mjs';
import { createMobileSpawnPickupFixtures } from './lib/mobileSpawnPickupFixture.mjs';
import { readPhoneTapTargets, setKeyboardViewport, restoreKeyboardViewport, readBackgroundThumbnailImages } from './lib/mobileInputAudits.mjs';
import { installMobileSignedFixture } from './lib/mobileSignedFixture.mjs';

const rawUrl = getStringArg('--url') || process.env.MOBILE_SMOKE_URL?.trim() || 'http://127.0.0.1:3000';
const engineName = getStringArg('--engine') || process.env.MOBILE_SMOKE_BROWSER || 'chromium';
if (!['chromium', 'webkit'].includes(engineName)) throw new Error('Choose chromium or webkit');
const targetUrl = withMobileSmokeQuery(rawUrl);
const outputDir =
  process.env.MOBILE_SMOKE_OUTPUT_DIR?.trim()
  || path.join('output/web-game/mobile-smoke', sanitizePathSegment(new URL(targetUrl).host));

// MOBILE_SMOKE_API_FIXTURES=record saves production API responses; =replay serves them (CI).
const apiFixtureMode = process.env.MOBILE_SMOKE_API_FIXTURES?.trim() || null;
const apiFixtureFile = process.env.MOBILE_SMOKE_API_FIXTURE_FILE?.trim() || 'scripts/fixtures/mobile-smoke-api.json.gz';
const apiFixtures = apiFixtureMode
  ? createApiFixtures({
      mode: apiFixtureMode,
      file: apiFixtureFile,
    })
  : null;

const summary = {
  url: targetUrl,
  engine: engineName,
  outputDir,
  startedAt: new Date().toISOString(),
  scenarios: {},
  consoleErrors: [],
  pageErrors: [],
};

const profiles = {
  phonePortrait: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  phoneLandscape: {
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 3,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  tabletPortrait: {
    viewport: { width: 820, height: 1180 },
    deviceScaleFactor: 2,
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  tabletLandscape: {
    viewport: { width: 1180, height: 820 },
    deviceScaleFactor: 2,
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
};

const scenarios = [
  {
    name: 'phone-portrait-browse-unblocked',
    profile: profiles.phonePortrait,
    run: runPhonePortraitBrowseUnblocked,
  },
  {
    name: 'phone-portrait-deep-link-play',
    profile: profiles.phonePortrait,
    searchParams: { x: '0', y: '0' },
    run: runPhonePortraitDeepLinkPlay,
  },
  {
    name: 'phone-portrait-recording-notice',
    profile: profiles.phonePortrait,
    searchParams: { x: '0', y: '0' },
    run: runPhoneRecordingNotice,
  },
  {
    name: 'phone-portrait-deep-link-bottom-hud',
    profile: profiles.phonePortrait,
    searchParams: { x: '0', y: '0' },
    run: runPhonePortraitDeepLinkBottomHud,
  },
  {
    name: 'phone-portrait-camera-tuner',
    profile: profiles.phonePortrait,
    searchParams: { x: '0', y: '0', cameraTuner: '1' },
    run: runPhonePortraitCameraTuner,
  },
  {
    name: 'phone-landscape-browse',
    profile: profiles.phoneLandscape,
    run: runPhoneLandscapeBrowse,
  },
  {
    name: 'phone-landscape-welcome-modal',
    profile: profiles.phoneLandscape,
    searchParams: { welcome: '1' },
    run: runPhoneLandscapeWelcomeModal,
  },
  {
    name: 'phone-landscape-play-overlay-controls',
    profile: profiles.phoneLandscape,
    run: (page, scenarioSummary, scenarioDir) =>
      runTouchOverlayPlay(page, scenarioSummary, scenarioDir, { deviceClass: 'phone', orientationState: 'landscape' }),
  },
  {
    name: 'phone-portrait-editor-dock',
    profile: profiles.phonePortrait,
    run: runPhoneLandscapeEditorSheets,
  },
  {
    name: 'phone-landscape-editor-dock',
    profile: profiles.phoneLandscape,
    run: runPhoneLandscapeEditorSheets,
  },
  {
    name: 'tablet-landscape-browse',
    profile: profiles.tabletLandscape,
    run: runTabletLandscapeBrowse,
  },
  {
    name: 'tablet-landscape-play-overlay-controls',
    profile: profiles.tabletLandscape,
    run: (page, scenarioSummary, scenarioDir) =>
      runTouchOverlayPlay(page, scenarioSummary, scenarioDir, { deviceClass: 'tablet', orientationState: 'landscape' }),
  },
  {
    name: 'tablet-portrait-play-overlay-controls',
    profile: profiles.tabletPortrait,
    run: (page, scenarioSummary, scenarioDir) =>
      runTouchOverlayPlay(page, scenarioSummary, scenarioDir, { deviceClass: 'tablet', orientationState: 'portrait' }),
  },
  { name: 'phone-landscape-recording-notice', profile: profiles.phoneLandscape, searchParams: { x: '0', y: '0' }, run: runPhoneRecordingNotice },
  { name: 'phone-narrow-landscape-recording-notice', profile: { ...profiles.phoneLandscape, viewport: { width: 568, height: 320 } }, searchParams: { x: '0', y: '0' }, run: runPhoneRecordingNotice },
  { name: 'phone-keyboard-email', profile: profiles.phonePortrait, run: runPhoneEmailKeyboard },
  { name: 'phone-keyboard-chat', profile: profiles.phonePortrait, signedFixture: true, searchParams: { x: '0', y: '0' }, run: runPhoneChatKeyboard },
  { name: 'phone-keyboard-room-say', profile: profiles.phonePortrait, signedFixture: true, roomChatFixture: true, searchParams: { x: '0', y: '0' }, run: runPhoneRoomKeyboard },
  { name: 'phone-landscape-room-start', profile: profiles.phoneLandscape, searchParams: { x: '0', y: '0' }, run: runPhoneLandscapeRoomStart },
  { name: 'phone-portrait-tap-targets', profile: profiles.phonePortrait, run: runPhoneTapTargets },
  { name: 'phone-landscape-tap-targets', profile: profiles.phoneLandscape, run: runPhoneTapTargets },
  { name: 'phone-signed-room-controls', profile: profiles.phonePortrait, signedFixture: true, roomEditorFixture: true, activityFixture: true, searchParams: { x: '0', y: '0' }, run: runSignedRoomControls },
  { name: 'phone-narrow-navigation', profile: { ...profiles.phonePortrait, viewport: { width: 320, height: 568 } }, signedFixture: true, roomEditorFixture: true, navigationFixture: true, searchParams: { x: '0', y: '0' }, run: runNavigation },
  { name: 'phone-navigation', profile: profiles.phonePortrait, signedFixture: true, roomEditorFixture: true, navigationFixture: true, searchParams: { x: '0', y: '0' }, run: runNavigation },
  { name: 'tablet-gamepad-controls', profile: profiles.tabletLandscape, signedFixture: true, roomChatFixture: true, roomEditorFixture: true, gamepadFixture: true, searchParams: { x: '0', y: '0' }, run: runGamepadControls },
  { name: 'phone-spawn-goal-pickups', profile: profiles.phonePortrait, spawnPickupFixture: true, searchParams: { x: '0', y: '0' }, run: runSpawnGoalPickups },
  { name: 'phone-mann-cool', mannCoolFixture: true, profile: profiles.phonePortrait, navigationFixture: true, searchParams: { x: '0', y: '0' }, run: async (page, row, dir) => {
    row.assertions.push(await auditMannCool(page, label => captureScenarioScreenshot(page, row, dir, label), new URL(targetUrl).origin));
  } },
  { name: 'phone-startup-downloads', profile: profiles.phonePortrait, navigationFixture: true, startupFixture: true, searchParams: { x: '0', y: '0' }, run: async (page, row, dir) => {
    row.assertions.push(await auditStartupDownloads(page));
    await captureScenarioScreenshot(page, row, dir, 'startup-ready');
  } },
  { name: 'phone-haptic-settings', profile: profiles.phonePortrait, navigationFixture: true, hapticFixture: true, searchParams: { x: '0', y: '0' }, run: async (page, row, dir) => {
    row.assertions.push(await auditHapticSettings(page, label => captureScenarioScreenshot(page, row, dir, label)));
  } },
  { name: 'phone-haptic-clear', profile: profiles.phonePortrait, navigationFixture: true, spawnPickupFixture: true, hapticFixture: true, searchParams: { x: '0', y: '0' }, run: async (page, row, dir) => {
    row.assertions.push(await auditHapticClear(page, label => captureScenarioScreenshot(page, row, dir, label)));
  } },
  { name: 'phone-narrow-signed-room-controls', profile: { ...profiles.phonePortrait, viewport: { width: 320, height: 568 } }, signedFixture: true, roomEditorFixture: true, activityFixture: true, searchParams: { x: '0', y: '0' }, run: runSignedRoomControls },
];

mkdirSync(outputDir, { recursive: true });

const browser = await (engineName === 'webkit' ? webkit : chromium).launch({
  headless: true,
  ...(engineName === 'chromium' ? { args: ['--use-gl=angle', '--use-angle=swiftshader', '--mute-audio'] } : {}),
});

try {
  const onlyScenarios = getStringArg('--only')?.split(',').map((name) => name.trim()).filter(Boolean) ?? [];
  for (const scenario of scenarios) {
    if (onlyScenarios.length > 0 && !onlyScenarios.includes(scenario.name)) {
      continue;
    }
    await runScenario(browser, scenario);
  }

  summary.finishedAt = new Date().toISOString();
  apiFixtures?.save();
  summary.apiFixtures = apiFixtures?.report() ?? null;
  summary.ok =
    Object.values(summary.scenarios).every((scenario) => scenario.ok)
    && summary.consoleErrors.length === 0
    && summary.pageErrors.length === 0
    && Object.keys(summary.apiFixtures?.misses ?? {}).length === 0;
} finally {
  await browser.close();
  writeSummary();
}

console.log(
  JSON.stringify(
    {
      ok: summary.ok,
      url: summary.url,
      outputDir: summary.outputDir,
      scenarios: Object.fromEntries(
        Object.entries(summary.scenarios).map(([name, scenario]) => [
          name,
          {
            ok: scenario.ok,
            error: scenario.error ?? null,
            device: scenario.device ?? null,
            appMode: scenario.appMode ?? null,
            activeScene: scenario.activeScene ?? null,
          },
        ]),
      ),
      consoleErrors: summary.consoleErrors.length,
      pageErrors: summary.pageErrors.length,
      apiFixtures: summary.apiFixtures,
    },
    null,
    2,
  ),
);

if (!summary.ok) {
  process.exit(1);
}

async function runScenario(browserInstance, scenario) {
  const scenarioDir = path.join(outputDir, scenario.name);
  mkdirSync(scenarioDir, { recursive: true });

  const scenarioSummary = {
    ok: false,
    screenshots: [],
    assertions: [],
  };
  summary.scenarios[scenario.name] = scenarioSummary;

  const context = await browserInstance.newContext({
    viewport: scenario.profile.viewport,
    deviceScaleFactor: scenario.profile.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
    userAgent: scenario.profile.userAgent,
  });
  const scenarioApiFixtures = scenario.spawnPickupFixture
    ? createMobileSpawnPickupFixtures(apiFixtureFile, path.join(scenarioDir, 'api.json.gz')) : apiFixtures;
  await scenarioApiFixtures?.install(context);
  if (scenario.signedFixture) {
    if (!apiFixtures) throw new Error('Signed input checks require isolated API fixtures');
    await installMobileSignedFixture(context, { roomChat: scenario.roomChatFixture, roomEditor: scenario.roomEditorFixture, activity: scenario.activityFixture });
  }
  await context.addInitScript(() => {
    window.localStorage.setItem('wamp_install_help_dismissed_v1', '1');
    window.localStorage.setItem('wamp_welcome_modal_seen_v1', '1');

    try {
      Object.defineProperty(navigator, 'maxTouchPoints', {
        configurable: true,
        get: () => 5,
      });
    } catch {
      // Best effort only; Playwright's hasTouch context option normally covers this.
    }

    const originalMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const normalized = String(query);
      if (normalized.includes('pointer: coarse') || normalized.includes('any-pointer: coarse')) {
        return createStaticMediaQueryList(normalized, true);
      }
      if (normalized.includes('pointer: fine') || normalized.includes('any-pointer: fine')) {
        return createStaticMediaQueryList(normalized, false);
      }
      return originalMatchMedia(query);
    };

    function createStaticMediaQueryList(media, matches) {
      return {
        media,
        matches,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      };
    }
  });

  if (scenario.gamepadFixture) await context.addInitScript(() => {
    localStorage.setItem('wamp.devicePerformanceMode.v1', JSON.stringify({ version: 1, mode: 'full-quality' }));
    localStorage.setItem('wamp.settings.musicVolume', '0'); localStorage.setItem('wamp.settings.sfxVolume', '0');
  });
  if (scenario.navigationFixture) await installNavigationFixtures(context);
  if (scenario.hapticFixture) await installHapticProbe(context);
  if (scenario.startupFixture) await installStartupFixture(context);
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }
    const location = message.location();
    const record = {
      scenario: scenario.name,
      type: message.type(),
      text: message.text(),
      url: location.url || null,
    };
    if (!isIgnoredConsoleError(record.text, record.url)) {
      summary.consoleErrors.push(record);
    }
  });
  page.on('pageerror', (error) => {
    summary.pageErrors.push({
      scenario: scenario.name,
      text: error.message,
    });
  });

  try {
    if (!scenario.mannCoolFixture) await gotoMobileSmokePage(page, scenario.searchParams);
    await scenario.run(page, scenarioSummary, scenarioDir);
    if (scenario.spawnPickupFixture) {
      const report = scenarioApiFixtures.report();
      assertCondition(Object.keys(report.misses).length === 0, 'Spawn pickup requests must all be isolated fixtures');
      scenarioSummary.assertions.push({ label: 'Spawn pickup API replay has no misses', apiFixtures: report });
    }
    const state = await readState(page);
    scenarioSummary.ok = true;
    scenarioSummary.device = state?.device ?? null;
    scenarioSummary.appMode = await page.evaluate(() => document.body.dataset.appMode ?? null);
    scenarioSummary.activeScene = summarizeActiveScene(state?.activeScene);
  } catch (error) {
    scenarioSummary.error = error instanceof Error ? error.message : String(error);
    try {
      await captureScenarioScreenshot(page, scenarioSummary, scenarioDir, 'failure');
      scenarioSummary.lastState = await readState(page);
    } catch {
      // The page may already be torn down after a navigation or browser failure.
    }
  } finally {
    writeFileSync(path.join(scenarioDir, 'summary.json'), JSON.stringify(scenarioSummary, null, 2));
    await context.close();
  }
}

async function gotoMobileSmokePage(page, searchParams = undefined) {
  const scenarioUrl = buildScenarioUrl(searchParams);
  await page.goto(scenarioUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

async function assertPhoneTapTargets(page, summary, label) {
  const targets = await readPhoneTapTargets(page);
  const failures = targets.filter(target => target.width < 40 || target.height < 40);
  assertCondition(targets.length > 0, `${label}: no visible targets audited`);
  assertCondition(failures.length === 0, `${label}: undersized phone targets: ${JSON.stringify(failures)}`);
  summary.assertions.push({ label: `${label}: every foreground button is at least 40×40`, targets });
}
async function checkKeyboard(page, selector, summary, directory) {
  await page.locator(selector).focus();
  await page.locator(selector).fill('');
  await page.locator(selector).pressSequentially('Keyboard check', { delay: 10 });
  await setKeyboardViewport(page, 360);
  const state = await waitForAppState(page, value => value?.device?.viewport?.height === 360, 'keyboard visual viewport');
  assertCondition(state.device.orientationState === 'portrait', 'Keyboard must preserve portrait orientation');
  const fields = await page.evaluate(() => Array.from(document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),textarea')).filter(el => el.getClientRects().length).map(el => ({ id: el.id, font: parseFloat(getComputedStyle(el).fontSize) })));
  assertCondition(fields.every(field => field.font >= 16), `Small phone input text: ${JSON.stringify(fields)}`);
  await page.waitForFunction(id => { const box = document.querySelector(id)?.getBoundingClientRect(); return box && box.top >= 0 && box.bottom <= 360; }, selector, { timeout: 5000 });
  const fieldBounds = await page.locator(selector).boundingBox();
  assertCondition(fieldBounds && fieldBounds.y >= 0 && fieldBounds.y + fieldBounds.height <= 360, `Focused field covered by keyboard: ${JSON.stringify(fieldBounds)}`);
  const foreground = await page.locator(selector).evaluate(element => {
    const box = element.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element;
  });
  assertCondition(foreground, 'Focused field must remain visible through its panel, not clipped');
  if (state.activeScene?.mode === 'play') {
    const canvas = await page.locator('#game-container').boundingBox();
    assertCondition(canvas && canvas.height > 400, `Portrait canvas collapsed behind keyboard: ${JSON.stringify(canvas)}`);
  }
  assertCondition(await page.locator(selector).inputValue() === 'Keyboard check', 'Keyboard resize discarded entered text');
  summary.assertions.push({ label: 'Keyboard preserves portrait layout, visible field, text and 16px input fonts', fields, fieldBounds });
  await captureScenarioScreenshot(page, summary, directory, 'keyboard-open');
  await restoreKeyboardViewport(page);
  await waitForAppState(page, value => value?.device?.viewport?.height === 844, 'restored keyboard viewport');
}
async function runPhoneEmailKeyboard(page, summary, directory) {
  await waitForReadyOverworld(page, 'email keyboard'); await closeBlockingOverlaysUntilClear(page);
  await page.locator('#menu-toggle').tap(); await checkKeyboard(page, '#auth-email-input', summary, directory);
  await captureScenarioScreenshot(page, summary, directory, 'email-keyboard-return');
}
async function runPhoneChatKeyboard(page, summary, directory) {
  await startKeyboardFixtureRoom(page, summary, 'chat keyboard');
  await page.locator('#menu-toggle').tap(); await page.locator('#btn-menu-chat').tap();
  await page.waitForFunction(() => !document.getElementById('chat-input').disabled);
  await checkKeyboard(page, '#chat-input', summary, directory);
  assertCondition((await readState(page))?.activeScene?.mode === 'play', 'Typing must not leave the room');
  await assertVisible(page, '#mobile-play-controls', 'Portrait controls persist through keyboard return');
  await captureScenarioScreenshot(page, summary, directory, 'chat-keyboard-return');
}
async function runPhoneRoomKeyboard(page, summary, directory) {
  await startKeyboardFixtureRoom(page, summary, 'room keyboard');
  // The isolated session enables the composer; fixture sockets remain refused and nothing is sent.
  await page.keyboard.press('t'); await page.locator('#room-chat-input').waitFor({ state: 'visible', timeout: 5000 });
  await checkKeyboard(page, '#room-chat-input', summary, directory);
  assertCondition((await readState(page))?.activeScene?.mode === 'play', 'Room typing must preserve Play');
  await captureScenarioScreenshot(page, summary, directory, 'room-keyboard-return');
}
async function runSpawnGoalPickups(page, summary, directory) {
  await waitForReadyOverworld(page, 'spawn pickups');
  const start = page.locator('#btn-room-goal-intro-start');
  await start.waitFor({ state: 'visible', timeout: 30_000 });
  const before = (await readState(page)).activeScene;
  const coins = before.liveObjects.filter(object => object.id === 'coin_gold' && object.room.x === 0 && object.room.y === 0);
  assertCondition(coins.length === 2, `Both spawn coins must remain before Start; got ${coins.length}`);
  await start.tap();
  await page.locator('#room-goal-intro-modal').waitFor({ state: 'hidden' });
  await waitForAppState(page, state => state?.activeScene?.goalRun?.collectiblesCollected === 2
    && state.activeScene.goalRun.result === 'completed', 'Both spawn pickups credit the newly started goal', 15_000);
  const run = (await readState(page)).activeScene.goalRun;
  assertCondition(run.deaths === 0, 'Spawn pickup goal clears without a death or movement hook');
  summary.assertions.push({ label: 'Real Start tap preserves then credits both spawn pickups', before: coins.length, collected: run.collectiblesCollected, result: run.result, movementHook: false });
  await captureScenarioScreenshot(page, summary, directory, 'spawn-pickup-clear');
}
async function startKeyboardFixtureRoom(page, summary, label) {
  await waitForReadyOverworld(page, label);
  await waitForBodyAppMode(page, 'play-world', `${label} play mode`, 30000);
  // These scenarios open the recorded room at 0,0 in a fresh context. Its intro
  // arrives after play mode, so an earlier "no overlays" check is not a start barrier.
  const start = page.locator('#btn-room-goal-intro-start');
  await start.waitFor({ state: 'visible', timeout: 30000 });
  await start.tap();
  await page.locator('#room-goal-intro-modal').waitFor({ state: 'hidden' });
  await waitForAppState(page, state => state?.activeScene?.goalRun?.elapsedMs > 0, `${label} running room`);
  summary.assertions.push({ label: `${label}: real Start tap starts the room before typing` });
}
async function runPhoneLandscapeRoomStart(page, summary, directory) {
  await waitForReadyOverworld(page, 'landscape room start');
  const start = page.locator('#btn-room-goal-intro-start');
  await start.waitFor({ state: 'visible', timeout: 10000 });
  await start.scrollIntoViewIfNeeded();
  const box = await start.boundingBox();
  assertCondition(box && box.y >= 0 && box.y + box.height <= 390 && box.width >= 40 && box.height >= 40, `Landscape Start must be reachable: ${JSON.stringify(box)}`);
  await captureScenarioScreenshot(page, summary, directory, 'start-reachable');
  await start.tap();
  await page.locator('#room-goal-intro-modal').waitFor({ state: 'hidden' });
  await waitForBodyAppMode(page, 'play-world', 'landscape started play');
  summary.assertions.push({ label: 'Landscape room Start scrolls into view and accepts a real tap', box });
  await captureScenarioScreenshot(page, summary, directory, 'room-started');
}
async function runPhoneTapTargets(page, summary, directory) {
  await waitForReadyOverworld(page, 'phone target audit'); await closeBlockingOverlaysUntilClear(page);
  await assertPhoneTapTargets(page, summary, 'Browse');
  await page.locator('#btn-mobile-world-hud-details').tap(); await assertPhoneTapTargets(page, summary, 'Room details'); await page.locator('#btn-mobile-world-hud-details').tap();
  await page.locator('#menu-toggle').tap(); await assertPhoneTapTargets(page, summary, 'Menu');
  await page.locator('#menu-body').evaluate(element => { element.scrollTop = element.scrollHeight; }); await assertPhoneTapTargets(page, summary, 'Menu bottom');
  await page.locator('#btn-world-settings').tap(); await assertPhoneTapTargets(page, summary, 'Settings'); await page.locator('#btn-settings-close').tap();
  await page.locator('#btn-chat-toggle').tap(); await assertPhoneTapTargets(page, summary, 'Chat'); await page.locator('#btn-chat-close').tap();
  await captureScenarioScreenshot(page, summary, directory, 'browse-targets');
  await selectEditableRoom(page); await runPreviewSmokeAction(page, 'playSelectedRoom'); await closeBlockingOverlaysUntilClear(page);
  await assertPhoneTapTargets(page, summary, 'Play');
  await page.locator('#menu-toggle').tap(); await assertPhoneTapTargets(page, summary, 'Play menu');
  await page.locator('#btn-world-settings').tap(); await assertVisible(page, '#settings-modal', 'Settings reachable during landscape play'); await page.locator('#btn-settings-close').tap();
  await page.locator('#menu-toggle').tap(); await page.locator('#btn-menu-chat').tap(); await assertVisible(page, '#global-chat-body', 'Chat reachable during landscape play'); await page.locator('#btn-chat-close').tap();
  await captureScenarioScreenshot(page, summary, directory, 'play-targets');
}

async function runPhonePortraitBrowseUnblocked(page, scenarioSummary, scenarioDir) {
  const state = await waitForAppState(
    page,
    (candidate) =>
      candidate?.device?.deviceClass === 'phone' &&
      candidate.device.orientationState === 'portrait' &&
      candidate?.activeScene?.scene === 'overworld-play',
    'phone portrait unblocked browse',
  );
  scenarioSummary.assertions.push({
    label: 'phone portrait browse is not blocked by install or rotate gate',
    device: state.device,
    activeScene: summarizeActiveScene(state.activeScene),
  });
  await assertAbsent(page, '#rotate-gate', 'rotate gate in phone portrait browse');
  await assertAbsent(page, '#install-help-modal', 'install help modal in phone portrait browse');
  await assertAbsent(page, '#btn-install-help-open', 'install app menu button in phone portrait browse');
  await assertAbsent(page, '.mobile-dpad-btn', 'legacy mobile D-pad buttons in phone portrait browse');
  await assertHidden(page, '#mobile-play-controls', 'mobile play controls while browsing portrait');
  await captureScenarioScreenshot(page, scenarioSummary, scenarioDir, 'portrait-browse');
}

async function runPhoneRecordingNotice(page, scenarioSummary, scenarioDir) {
  await waitForBodyAppMode(page, 'play-world', 'phone recording notice play mode', 30_000);
  await closeBlockingOverlaysUntilClear(page);
  await page.locator('.guest-replay-notice').waitFor({ state: 'visible', timeout: 15_000 });
  // The room intro can arrive while the replay notice is loading.
  await closeBlockingOverlaysUntilClear(page);
  const layout = await page.evaluate(() => {
    const notice = document.querySelector('.guest-replay-notice');
    const rect = notice.getBoundingClientRect();
    const controls = ['btn-mobile-jump', 'btn-mobile-slash', 'btn-mobile-shoot', 'mobile-move-zone', 'btn-mobile-world-stop', 'btn-mobile-world-restart'].map(id => {
      const element = document.getElementById(id);
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { id, covered: rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top,
        centerInteractive: hit === element || element.contains(hit) };
    });
    const optOut = notice.querySelector('button').getBoundingClientRect();
    return { controls, optOut: { width: optOut.width, height: optOut.height } };
  });
  assertCondition(layout.controls.every(control => !control.covered && control.centerInteractive), `Recording notice obstructs play controls: ${JSON.stringify(layout)}`);
  assertCondition(layout.optOut.width >= 43.99 && layout.optOut.height >= 43.99, `Recording opt-out is too small: ${JSON.stringify(layout)}`);
  scenarioSummary.assertions.push({ label: 'Recording notice leaves play controls interactive and opt-out touch sized', ...layout });
  await captureScenarioScreenshot(page, scenarioSummary, scenarioDir, 'recording-notice');
}

async function runPhonePortraitDeepLinkPlay(page, scenarioSummary, scenarioDir) {
  await waitForBodyAppMode(page, 'play-world', 'phone portrait deep-linked play app mode', 30_000);
  await closeBlockingOverlaysUntilClear(page);
  const state = await waitForAppState(
    page,
    (candidate) =>
      candidate?.touch?.active === true
      && candidate?.device?.deviceClass === 'phone'
      && candidate.device.orientationState === 'portrait'
      && candidate?.activeScene?.mode === 'play'
      && candidate.activeScene.player !== null
      && candidate.activeScene.mobilePortraitCamera?.playerScreen !== null,
    'phone portrait deep-linked play mode',
  );
  await closeBlockingOverlaysUntilClear(page);
  await assertAbsent(page, '#rotate-gate', 'rotate gate during phone portrait play');
  await assertVisible(page, '#mobile-play-controls', 'portrait mobile play controls');
  await assertVisible(page, '#mobile-move-zone', 'portrait mobile move zone');
  await assertVisible(page, '#mobile-move-stick', 'portrait mobile move stick');
  await assertAbsent(page, '.mobile-dpad-btn', 'legacy mobile D-pad buttons during portrait play');
  await assertVisible(page, '#btn-mobile-jump', 'portrait mobile jump');
  await assertVisible(page, '#btn-mobile-slash', 'portrait mobile sword');
  await assertVisible(page, '#btn-mobile-shoot', 'portrait mobile shoot');
  await assertVisible(page, '#btn-mobile-world-stop', 'portrait mobile stop');
  await assertVisible(page, '#btn-mobile-world-restart', 'portrait mobile restart');
  await assertVisible(page, '#world-goal-panel', 'portrait mobile compact goal panel');
  await assertHidden(page, '#bottom-bar', 'bottom bar during portrait play deck');
  await assertSelectorsWithinViewport(
    page,
    [
      '#mobile-play-controls',
      '#mobile-move-zone',
      '#mobile-move-stick',
      '#btn-mobile-jump',
      '#btn-mobile-slash',
      '#btn-mobile-shoot',
      '#btn-mobile-world-stop',
      '#btn-mobile-world-restart',
      '#world-goal-panel',
    ],
    'phone portrait play controls bounds',
  );

  // Sample current camera/player state only after the existing framing barrier.
  await page.waitForFunction(() => {
    const scene = JSON.parse(window.render_game_to_text?.() || 'null')?.activeScene;
    const view = scene?.camera?.worldView, controls = document.getElementById('mobile-play-controls')?.getBoundingClientRect();
    if (!view || !controls || !scene.currentRoom) return false;
    const roomTop = scene.currentRoom.y * 352;
    const top = (roomTop - view.y) * scene.zoom, bottom = (roomTop + 352 - view.y) * scene.zoom;
    return top >= -2 && bottom <= controls.top + 2 && Math.abs((top + bottom) / 2 - controls.top / 2) <= 6;
  }, null, { timeout: 5000 });
  const layout = await readPortraitPlayLayout(page);
  assertCondition(
    layout.mobilePortraitPlay === 'true',
    `body should mark mobile portrait play mode: ${JSON.stringify(layout)}`,
  );
  assertCondition(
    layout.mobilePortraitFocusedRoom === 'true',
    `body should mark mobile portrait focused room mode: ${JSON.stringify(layout)}`,
  );
  assertCondition(
    layout.controls.top >= Math.round(layout.viewport.height * 0.55),
    `portrait control deck should leave a tall game view: ${JSON.stringify(layout.controls)}`,
  );
  assertCondition(
    layout.controls.height <= Math.round(layout.viewport.height * 0.43),
    `portrait console deck should stay compressed enough for the room view: ${JSON.stringify(layout.controls)}`,
  );
  assertCondition(
    layout.playerScreen.x > layout.viewport.width * 0.34
      && layout.playerScreen.x < layout.viewport.width * 0.66,
    `portrait camera should keep player roughly centered horizontally: ${JSON.stringify(layout.playerScreen)}`,
  );
  assertCondition(
    state.activeScene.mobilePortraitCamera?.zoomMultiplier === 2
      && state.activeScene.mobilePortraitCamera?.targetY === 0.53,
    `portrait camera should use the wider, centered mobile defaults: ${JSON.stringify(state.activeScene.mobilePortraitCamera)}`,
  );
  const roomFraming = await page.evaluate(() => {
    const scene = JSON.parse(window.render_game_to_text?.() || 'null')?.activeScene;
    const view = scene?.camera?.worldView;
    const roomTop = scene.currentRoom.y * 352;
    return {
      top: Math.round((roomTop - view.y) * scene.zoom),
      bottom: Math.round((roomTop + 352 - view.y) * scene.zoom),
    };
  });
  assertCondition(
    roomFraming.top >= -2
      && roomFraming.bottom <= layout.controls.top + 2
      && Math.abs((roomFraming.top + roomFraming.bottom) / 2 - layout.controls.top / 2) <= 6,
    `portrait camera should show the whole room centred above the console: ${JSON.stringify({ roomFraming, controls: layout.controls })}`,
  );
  assertCondition(
    layout.playerScreen.y < layout.controls.top - 16,
    `portrait camera should keep player above the control deck: ${JSON.stringify(layout)}`,
  );
  assertCondition(
    layout.moveZone.userSelect === 'none' && layout.moveZone.webkitUserSelect === 'none',
    `portrait move zone should suppress text selection: ${JSON.stringify(layout.moveZone)}`,
  );
  assertCondition(
    layout.moveZone.backgroundColor === 'rgb(170, 164, 165)',
    `portrait move zone outside stick should be grey: ${JSON.stringify(layout.moveZone)}`,
  );
  assertCondition(
    layout.moveStick.visible && layout.moveStick.withinMoveZone,
    `portrait move stick should be visible inside move zone: ${JSON.stringify(layout.moveStick)}`,
  );
  assertCondition(
    layout.moveStick.rect.width >= 124 && layout.moveStick.rect.height >= 124,
    `portrait move stick should be large enough for thumb targeting: ${JSON.stringify(layout.moveStick)}`,
  );
  await page.waitForTimeout(500);
  const streamingState = await readState(page);
  const lodMetrics = streamingState?.activeScene?.lodMetrics ?? null;
  assertCondition(
    lodMetrics?.fullRoomBudget === 1,
    `reduced phone portrait play should only budget one full gameplay room: ${JSON.stringify(lodMetrics)}`,
  );
  assertCondition(
    lodMetrics?.loadedFullRoomCount <= 1,
    `reduced phone portrait play should not keep neighboring live rooms loaded: ${JSON.stringify(lodMetrics)}`,
  );
  assertCondition(
    lodMetrics?.previewRoomBudget <= 9,
    `reduced phone portrait play should keep preview budget tight: ${JSON.stringify(lodMetrics)}`,
  );
  assertCondition(
    lodMetrics?.protectedVisiblePreviewRoomCount === 0,
    `reduced phone portrait play should not expand budget to every visible preview room: ${JSON.stringify(lodMetrics)}`,
  );

  await dispatchPointerAtRatio(page, '#mobile-move-zone', 'pointerdown', 50, 0.16, 0.16);
  await dispatchPointerAtRatio(page, '#mobile-move-zone', 'pointermove', 50, 0.86, 0.86);
  await page.waitForTimeout(100);
  const outsideStickState = await readState(page);
  assertCondition(
    outsideStickState?.touch?.moveX === 0 && outsideStickState.touch.moveY === 0,
    `portrait grey move-zone background should not move player: ${JSON.stringify(outsideStickState?.touch)}`,
  );
  await dispatchPointerAtRatio(page, '#mobile-move-zone', 'pointerup', 50, 0.86, 0.86);

  await dispatchPointerAt(page, '#mobile-move-stick', 'pointerdown', 51);
  await dispatchPointerAt(page, '#mobile-move-stick', 'pointermove', 51, 8, 0);
  await waitForAppState(
    page,
    (candidate) => candidate?.touch?.active === true && candidate.touch.moveX >= 0.28,
    'dragged right touch input in portrait play',
    5000,
  );
  const rightStick = await readMoveStickSnapshot(page);
  assertCondition(
    rightStick.knobCenter.x > rightStick.baseCenter.x + 6,
    `portrait move stick knob should move right with horizontal drag: ${JSON.stringify(rightStick)}`,
  );
  await dispatchDocumentPointer(page, 'pointerup', 51);
  await waitForAppState(
    page,
    (candidate) =>
      candidate?.touch?.active === true
      && candidate.touch.moveX === 0
      && candidate.touch.moveY === 0,
    'document-level portrait move release',
    5000,
  );
  await dispatchPointerAt(page, '#mobile-move-stick', 'pointerdown', 53);
  await dispatchPointerAt(page, '#mobile-move-stick', 'pointermove', 53, -8, 0);
  await waitForAppState(
    page,
    (candidate) => candidate?.touch?.active === true && candidate.touch.moveX <= -0.28,
    'dragged left touch input in portrait play',
    5000,
  );
  await dispatchPointerAt(page, '#mobile-move-stick', 'pointermove', 53, 0, -8);
  await page.waitForTimeout(100);
  const shallowVerticalState = await readState(page);
  assertCondition(
    shallowVerticalState?.touch?.moveY > -0.42,
    `shallow portrait vertical drag should not climb yet: ${JSON.stringify(shallowVerticalState?.touch)}`,
  );
  await dispatchPointerAt(page, '#mobile-move-stick', 'pointermove', 53, 0, -22);
  await waitForAppState(
    page,
    (candidate) => candidate?.touch?.active === true && candidate.touch.moveY <= -0.42,
    'dragged up touch input in portrait play',
    5000,
  );
  await dispatchPointerAt(page, '#mobile-move-stick', 'pointermove', 53, 0, 8);
  await page.waitForTimeout(100);
  const shallowDownState = await readState(page);
  assertCondition(
    shallowDownState?.touch?.moveY < 0.42,
    `shallow portrait downward drag should not crouch yet: ${JSON.stringify(shallowDownState?.touch)}`,
  );
  await dispatchPointerAt(page, '#mobile-move-stick', 'pointermove', 53, 0, 22);
  await waitForAppState(
    page,
    (candidate) => candidate?.touch?.active === true && candidate.touch.moveY >= 0.42,
    'dragged down touch input in portrait play',
    5000,
  );
  await dispatchPointerAt(page, '#mobile-move-stick', 'pointerup', 53, 0, 22);
  await waitForAppState(
    page,
    (candidate) =>
      candidate?.touch?.active === true
      && candidate.touch.moveX === 0
      && candidate.touch.moveY === 0,
    'released portrait move zone touch input',
    5000,
  );
  await dispatchPointer(page, '#btn-mobile-jump', 'pointerdown', 52);
  await waitForAppState(
    page,
    (candidate) => candidate?.touch?.active === true && candidate.touch.jumpHeld === true,
    'held jump touch input in portrait play',
    5000,
  );
  await dispatchPointer(page, '#btn-mobile-jump', 'pointerup', 52);

  scenarioSummary.assertions.push({
    label: 'deep-linked phone portrait play is unblocked with player above control deck',
    layout,
    lodMetrics,
    activeScene: summarizeActiveScene(state.activeScene),
  });
  await captureScenarioScreenshot(page, scenarioSummary, scenarioDir, 'portrait-play');
}

async function runPhonePortraitDeepLinkBottomHud(page, scenarioSummary, scenarioDir) {
  await waitForBodyAppMode(page, 'play-world', 'phone portrait deep-linked play app mode', 30_000);
  // The intro arrives with the playable snapshot; do not click Stop during hydration.
  await waitForAppState(page, candidate => candidate?.activeScene?.player
    && candidate.activeScene.currentCollisionReady, 'phone portrait player and collisions before intro dismissal');
  await closeBlockingOverlaysUntilClear(page);
  await waitForAppState(
    page,
    (candidate) =>
      candidate?.touch?.active === true
      && candidate?.device?.deviceClass === 'phone'
      && candidate.device.orientationState === 'portrait'
      && candidate?.activeScene?.mode === 'play',
    'phone portrait deep-linked play before stop',
  );
  await assertVisible(page, '#btn-mobile-world-stop', 'portrait mobile stop before bottom HUD check');
  await page.locator('#btn-mobile-world-stop').tap();
  await waitForBodyAppMode(page, 'world', 'phone portrait focused room browse app mode', 10_000);
  const state = await waitForAppState(
    page,
    (candidate) =>
      candidate?.device?.deviceClass === 'phone'
      && candidate.device.orientationState === 'portrait'
      && candidate?.activeScene?.scene === 'overworld-play'
      && candidate.activeScene.mode === 'browse',
    'phone portrait focused room browse mode',
  );

  await assertAbsent(page, '#rotate-gate', 'rotate gate during phone portrait focused room browse');
  await assertHidden(page, '#mobile-play-controls', 'mobile play controls after stopping portrait play');
  await assertVisible(page, '#bottom-bar', 'compact phone footer during portrait focused room HUD');
  await assertVisible(page, '#world-hud', 'portrait focused room compact HUD');
  await assertVisible(page, '#btn-world-play', 'portrait focused room Play button');
  await assertHidden(page, '#btn-world-edit', 'locked room has no unusable Edit button');
  await assertHidden(page, '#btn-world-build', 'published room has no unusable Build button');
  await assertVisible(page, '#world-selected-action-reason', 'locked room edit explanation');
  await assertVisible(page, '#world-selected-goal', 'portrait focused room goal');
  await assertVisible(page, '#btn-mobile-world-hud-details', 'portrait focused room More disclosure');
  await assertVisible(page, '#btn-mobile-world-hud-minimize', 'portrait focused room collapse button');
  await assertHidden(page, '#btn-world-course-builder', 'portrait focused room Course Builder by default');
  await assertVisible(page, '#btn-world-explore', 'Explore is always in the browse footer');
  await assertHidden(page, '#btn-world-leaderboard', 'portrait focused room Leaderboard by default');
  await assertHidden(page, '#btn-world-chat', 'portrait focused room Chat by default');
  await assertVisible(page, '#btn-world-jump-sheet', 'portrait focused room Warp on the card');
  await assertHidden(page, '#btn-world-zoom-out-footer', 'phone footer zoom out');
  await assertHidden(page, '#btn-world-zoom-in-footer', 'phone footer zoom in');
  await assertHidden(page, '#btn-fit-screen', 'phone footer Fit button');
  await assertHidden(page, '#zoom-level', 'phone footer zoom readout');
  for (const selector of ['#btn-world-report-bug', '#btn-guestbook-open', '#btn-world-controls']) {
    await assertHidden(page, selector, `phone toolbar ${selector} (opens from the menu on phones)`);
  }
  await assertSelectorsWithinViewport(
    page,
    [
      '#world-hud',
      '#btn-world-play',
      '#world-selected-goal',
      '#world-selected-action-reason',
      '#btn-world-jump-sheet',
      '#btn-mobile-world-hud-details',
      '#btn-mobile-world-hud-minimize',
      '#bottom-bar',
    ],
    'phone portrait focused room HUD bounds',
  );

  const layout = await readPortraitFocusedWorldHudLayout(page);
  const hudTop = Math.max(layout.hud.top, layout.hudDocument.top);
  assertCondition(
    layout.mobilePortraitFocusedRoom === 'true' && layout.mobilePortraitPlay === 'false',
    `body should mark focused room portrait HUD without play controls: ${JSON.stringify(layout)}`,
  );
  assertCondition(
    hudTop <= 80,
    `portrait focused room HUD should stay compact at the top: ${JSON.stringify(layout.hud)}`,
  );
  assertCondition(
    layout.hud.height <= 280,
    `portrait focused room HUD should fit its goal, best result and primary Play within 280px: ${JSON.stringify(layout.hud)}`,
  );
  assertCondition(
    layout.buttons.filter((button) => button.visible).every((button) => button.withinHud),
    `visible portrait focused room HUD buttons should stay inside the HUD: ${JSON.stringify(layout.buttons)}`,
  );
  const visiblePrimaryButtons = layout.primaryButtons.filter((button) => button.visible);
  assertCondition(
    visiblePrimaryButtons.some((button) => button.id === 'btn-world-jump-sheet')
      && new Set(visiblePrimaryButtons.map((button) => button.rowTop)).size <= 2
      && visiblePrimaryButtons.every((button) => button.withinHud),
    `portrait focused room should show its actions, Warp included, in at most two rows inside the card: ${JSON.stringify(layout.primaryButtons)}`,
  );
  assertCondition(
    layout.leaderboard.visible && layout.leaderboard.withinHud && layout.leaderboard.text.startsWith('Best:'),
    `portrait focused room best-run strip should remain readable inside the card: ${JSON.stringify(layout.leaderboard)}`,
  );

  const play = layout.primaryButtons.find(button => button.id === 'btn-world-play');
  assertCondition(play?.visible && play.rect.height >= 48 && play.rect.width >= layout.hud.width - 24,
    `Play should fill its own 48px row: ${JSON.stringify(play)}`);
  assertCondition(layout.buttons.filter(button => button.visible).every(button => !button.disabled),
    `visible room actions should be usable: ${JSON.stringify(layout.buttons)}`);

  await clickElement(page, '#btn-mobile-world-hud-details');
  await assertHidden(page, '#btn-world-course-builder', 'locked room has no unusable Course Builder after More');
  await assertHidden(page, '#btn-world-edit', 'locked room Edit stays hidden after More');
  await assertHidden(page, '#btn-world-build', 'published room Build stays hidden after More');
  await assertVisible(page, '#btn-world-explore', 'Explore stays in the footer after More');
  await assertVisible(page, '#btn-world-leaderboard', 'portrait focused room Leaderboard after More');
  await assertVisible(page, '#btn-world-chat', 'portrait focused room Chat after More');
  await assertVisible(page, '#btn-world-jump-sheet', 'portrait focused room Warp after More');
  await captureScenarioScreenshot(page, scenarioSummary, scenarioDir, 'portrait-more-actions');
  await clickElement(page, '#btn-mobile-world-hud-details');
  await assertVisible(page, '#btn-world-explore', 'Explore stays in the footer after closing More');

  await clickElement(page, '#btn-mobile-world-hud-minimize');
  await assertHidden(page, '#world-hud', 'portrait focused room collapsed HUD');
  await assertVisible(page, '#btn-world-hud-toggle', 'portrait focused room expand control');
  await captureScenarioScreenshot(page, scenarioSummary, scenarioDir, 'portrait-collapsed-hud');
  await clickElement(page, '#btn-world-hud-toggle');
  await assertVisible(page, '#world-hud', 'portrait focused room re-expanded HUD');

  scenarioSummary.assertions.push({
    label: 'deep-linked phone portrait stop returns to a compact, disclosed, collapsible HUD',
    layout,
    activeScene: summarizeActiveScene(state.activeScene),
  });
  await captureScenarioScreenshot(page, scenarioSummary, scenarioDir, 'portrait-compact-hud');
}

async function runPhonePortraitCameraTuner(page, scenarioSummary, scenarioDir) {
  await waitForBodyAppMode(page, 'play-world', 'phone portrait camera tuner play app mode', 30_000);
  await closeBlockingOverlaysUntilClear(page);
  const state = await waitForAppState(
    page,
    (candidate) =>
      candidate?.touch?.active === true
      && candidate?.device?.deviceClass === 'phone'
      && candidate.device.orientationState === 'portrait'
      && candidate?.activeScene?.mode === 'play'
      && candidate.activeScene.mobilePortraitCamera?.enabled === true,
    'phone portrait camera tuner play mode',
  );
  // The room goal intro can open after the first check, as in the deep-link play scenario.
  await closeBlockingOverlaysUntilClear(page);

  await assertVisible(page, '#mobile-camera-tuner', 'portrait camera tuner panel');
  await assertVisible(page, '#mobile-camera-tuner-value', 'portrait camera tuner value');
  await assertSelectorsWithinViewport(
    page,
    ['#mobile-camera-tuner', '#mobile-camera-tuner-value'],
    'phone portrait camera tuner bounds',
  );

  // Exercise camera tuning with the visitor's normal opt-out action; notice geometry
  // remains covered independently by the recording-notice scenarios.
  const replayOptOut = page.locator('.guest-replay-notice button');
  await replayOptOut.waitFor({ state: 'visible', timeout: 15_000 });
  await replayOptOut.tap();
  await page.locator('.guest-replay-notice').waitFor({ state: 'hidden' });
  const before = await readCameraTunerSnapshot(page);
  assertCondition(
    before.zoomMultiplier === 2 && before.targetY === 0.53,
    `camera tuner should begin from the wider, centered portrait defaults: ${JSON.stringify(before)}`,
  );
  await closeBlockingOverlaysUntilClear(page);
  await page.locator('[data-mobile-camera-tuner-action="zoom-in"]').tap();
  const afterZoom = await waitForCameraTunerSnapshot(
    page,
    (snapshot) => snapshot.zoomMultiplier > before.zoomMultiplier,
    'zoom-in camera tuner adjustment',
  );
  assertCondition(
    afterZoom.cameraZoom > before.cameraZoom,
    `zoom-in should zoom the portrait camera in: ${JSON.stringify({ before, afterZoom })}`,
  );
  // The player anchor only steers the camera when the room is too tall to fit above the console;
  // otherwise the whole room stays framed.
  await closeBlockingOverlaysUntilClear(page);
  await page.locator('[data-mobile-camera-tuner-action="player-up"]').tap();
  const afterPlayerUp = await waitForCameraTunerSnapshot(
    page,
    (snapshot) => snapshot.targetY < afterZoom.targetY,
    'player-up camera tuner adjustment',
  );
  const logged = await page.evaluate(() => window.wampMobileCameraTuner?.log('smoke-log') ?? null);

  assertCondition(
    logged?.zoomMultiplier === afterPlayerUp.zoomMultiplier
      && logged?.targetY === afterPlayerUp.targetY,
    `camera tuner log should return latest settings: ${JSON.stringify({ logged, afterPlayerUp })}`,
  );

  scenarioSummary.assertions.push({
    label: 'phone portrait camera tuner adjusts and logs copyable settings',
    before,
    afterZoom,
    afterPlayerUp,
    activeScene: summarizeActiveScene(state.activeScene),
  });
  await captureScenarioScreenshot(page, scenarioSummary, scenarioDir, 'camera-tuner');
}

async function runPhoneLandscapeBrowse(page, scenarioSummary, scenarioDir) {
  const state = await waitForReadyOverworld(page, 'phone landscape browse');
  assertCondition(state.device.deviceClass === 'phone', 'expected phone device class');
  await closeBlockingOverlays(page);
  await assertAbsent(page, '#rotate-gate', 'rotate gate in phone landscape');
  await assertAbsent(page, '#install-help-modal', 'install help modal in phone landscape');
  await assertAbsent(page, '.mobile-dpad-btn', 'legacy mobile D-pad buttons in phone landscape browse');
  await assertVisible(page, '#world-hud', 'world HUD');
  await assertVisible(page, '#btn-mobile-world-hud-details', 'mobile More disclosure');
  await assertVisible(page, '#btn-mobile-world-hud-minimize', 'mobile room collapse button');
  await assertHidden(page, '#btn-world-chat', 'mobile global chat shortcut by default');
  await assertVisible(page, '#btn-world-jump-sheet', 'mobile Warp on the card by default');
  await assertSelectorsWithinViewport(
    page,
    ['#world-hud', '#btn-mobile-world-hud-details', '#btn-mobile-world-hud-minimize', '#bottom-bar'],
    'phone landscape browse bounds',
  );
  await clickElement(page, '#btn-mobile-world-hud-details');
  await assertVisible(page, '#btn-world-chat', 'mobile global chat shortcut after More');
  await assertVisible(page, '#btn-world-jump-sheet', 'mobile jump shortcut after More');
  await clickElement(page, '#btn-mobile-world-hud-details');
  await captureScenarioScreenshot(page, scenarioSummary, scenarioDir, 'browse');
}

async function runPhoneLandscapeWelcomeModal(page, scenarioSummary, scenarioDir) {
  const state = await waitForReadyOverworld(page, 'phone landscape welcome boot');
  assertCondition(state.device.deviceClass === 'phone', 'expected phone device class');

  await page.waitForSelector('#welcome-modal:not(.hidden)', { state: 'visible', timeout: 15_000 });
  await assertVisible(page, '#welcome-modal .welcome-modal-panel', 'welcome modal panel');
  await assertVisible(page, '#btn-welcome-explore', 'welcome Explore action');
  await assertVisible(page, '#btn-welcome-play', 'welcome Play action');
  await assertVisible(page, '#btn-welcome-build', 'welcome Build action');
  const layout = await readWelcomeModalLayout(page);
  assertCondition(
    layout.panel.width <= 660,
    `welcome modal should be a compact phone panel, got width ${layout.panel.width}`,
  );
  assertCondition(
    layout.panel.height <= layout.viewport.height - 16,
    `welcome modal should not fill the phone viewport, got panel ${layout.panel.height} in viewport ${layout.viewport.height}`,
  );
  assertCondition(
    layout.panel.left > 20 && layout.panel.right < layout.viewport.width - 20,
    `welcome modal should leave visible side margins: ${JSON.stringify(layout.panel)}`,
  );
  assertCondition(
    layout.actions.every((action) => action.withinPanel === true),
    `welcome modal actions should be visible without scrolling: ${JSON.stringify(layout.actions)}`,
  );
  scenarioSummary.assertions.push({
    label: 'welcome modal is compact and immediately actionable on phone landscape',
    layout,
  });
  await captureScenarioScreenshot(page, scenarioSummary, scenarioDir, 'welcome-modal');
}

// Landscape phones and tablets (either orientation) play with the corner overlay: joystick
// bottom-left, Jump/Sword/Shoot bottom-right, Stop/Restart top-left, all over the room.
async function runTouchOverlayPlay(page, scenarioSummary, scenarioDir, expected) {
  const label = `${expected.deviceClass} ${expected.orientationState}`;
  await waitForReadyOverworld(page, `${label} play boot`);
  await closeBlockingOverlays(page);
  await selectEditableRoom(page);
  // The selected room can still be streaming in; Play is a no-op until it is, so retry.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await runPreviewSmokeAction(page, 'playSelectedRoom');
    await closeBlockingOverlays(page);
    const mode = await page.evaluate(() => document.body.dataset.appMode ?? null);
    if (mode === 'play-world') break;
    await page.waitForTimeout(1500);
  }
  await waitForBodyAppMode(page, 'play-world', `${label} play app mode`);
  const state = await waitForAppState(
    page,
    (candidate) =>
      candidate?.touch?.active === true
      && candidate?.device?.deviceClass === expected.deviceClass
      && candidate.device.orientationState === expected.orientationState
      && candidate?.activeScene?.mode === 'play',
    `${label} play mode with touch controls`,
  );
  scenarioSummary.assertions.push({
    label: `entered ${label} play with touch controls`,
    activeScene: summarizeActiveScene(state.activeScene),
  });
  await closeBlockingOverlaysUntilClear(page);

  const layoutName = await page.evaluate(() => document.body.dataset.mobileTouchPlayLayout ?? null);
  assertCondition(layoutName === 'overlay', `${label} should use the overlay play layout, got ${layoutName}`);
  await assertAbsent(page, '.mobile-dpad-btn', `legacy D-pad buttons in ${label} play`);
  await assertAbsent(page, '#rotate-gate', `rotate gate in ${label} play`);
  const controlSelectors = [
    '#mobile-play-controls',
    '#mobile-move-zone',
    '#mobile-move-stick',
    '#btn-mobile-jump',
    '#btn-mobile-slash',
    '#btn-mobile-shoot',
    '#btn-mobile-world-stop',
    '#btn-mobile-world-restart',
  ];
  for (const selector of controlSelectors) {
    await assertVisible(page, selector, `${label} ${selector}`);
  }
  await assertSelectorsWithinViewport(page, controlSelectors.slice(1), `${label} overlay controls bounds`);

  const rects = await page.evaluate((selectors) => Object.fromEntries(selectors.map((selector) => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return [selector, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }];
  })), ['#mobile-move-stick', '#btn-mobile-jump', '#btn-mobile-slash', '#btn-mobile-shoot', '#btn-mobile-world-stop', '#btn-mobile-world-restart', '#btn-world-hud-toggle', '#world-goal-panel', '#btn-chat-toggle', '#btn-world-room-chat']);
  const overlaps = (a, b) => a.width > 0 && b.width > 0 && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const buttons = ['#btn-mobile-jump', '#btn-mobile-slash', '#btn-mobile-shoot'];
  for (const button of buttons) {
    assertCondition(!overlaps(rects['#mobile-move-stick'], rects[button]), `${label}: joystick overlaps ${button}: ${JSON.stringify(rects)}`);
    assertCondition(rects[button].width >= 44 && rects[button].height >= 44, `${label}: ${button} is too small to tap: ${JSON.stringify(rects[button])}`);
  }
  const pad = (rect, by) => ({ ...rect, left: rect.left - by, top: rect.top - by, right: rect.right + by, bottom: rect.bottom + by });
  for (const corner of ['#btn-mobile-world-stop', '#btn-mobile-world-restart', '#btn-world-hud-toggle', '#world-goal-panel', '#btn-chat-toggle', '#btn-world-room-chat']) {
    for (const control of ['#mobile-move-stick', ...buttons]) {
      // Keep a 12px gap so a thumb on a control does not catch another button.
      assertCondition(!overlaps(pad(rects[corner], 12), rects[control]), `${label}: ${corner} crowds ${control}: ${JSON.stringify(rects)}`);
    }
  }
  assertCondition(
    !overlaps(rects['#world-goal-panel'], rects['#btn-chat-toggle']),
    `${label}: goal panel overlaps World Chat: ${JSON.stringify(rects)}`,
  );
  for (const runButton of ['#btn-mobile-world-stop', '#btn-mobile-world-restart']) {
    assertCondition(
      !overlaps(rects['#btn-world-hud-toggle'], rects[runButton]),
      `${label}: Room + overlaps ${runButton}, so a tap could end the run: ${JSON.stringify(rects)}`,
    );
  }
  assertCondition(
    rects['#mobile-move-stick'].width >= 120,
    `${label}: joystick should be large enough for a thumb: ${JSON.stringify(rects['#mobile-move-stick'])}`,
  );
  scenarioSummary.assertions.push({ label: `${label} overlay controls are visible, tappable and non-overlapping`, rects });

  await dispatchPointerAt(page, '#mobile-move-stick', 'pointerdown', 61);
  await dispatchPointerAt(page, '#mobile-move-stick', 'pointermove', 61, 24, 0);
  await waitForAppState(
    page,
    (candidate) => candidate?.touch?.active === true && candidate.touch.moveX >= 0.9,
    `dragged right with the ${label} joystick`,
    5000,
  );
  const stick = await readMoveStickSnapshot(page);
  assertCondition(
    stick.knobCenter.x > stick.baseCenter.x + 12,
    `${label} joystick knob should follow the drag: ${JSON.stringify(stick)}`,
  );
  await dispatchDocumentPointer(page, 'pointerup', 61);
  await waitForAppState(
    page,
    (candidate) => candidate?.touch?.active === true && candidate.touch.moveX === 0 && candidate.touch.moveY === 0,
    `released the ${label} joystick`,
    5000,
  );

  await dispatchPointerAt(page, '#btn-mobile-jump', 'pointerdown', 62);
  await waitForAppState(page, (candidate) => candidate?.touch?.jumpHeld === true, `${label} jump held`, 5000);
  await dispatchPointerAt(page, '#btn-mobile-jump', 'pointerup', 62);
  await waitForAppState(page, (candidate) => candidate?.touch?.jumpHeld === false, `${label} jump released`, 5000);
  scenarioSummary.assertions.push({ label: `${label} joystick and jump drive touch input` });

  await captureScenarioScreenshot(page, scenarioSummary, scenarioDir, 'play-overlay-controls');
}

async function runPhoneLandscapeEditorSheets(page, scenarioSummary, scenarioDir) {
  await waitForReadyOverworld(page, 'phone editor smoke boot');
  const editorResult = await runPreviewSmokeAction(page, 'openSyntheticEditor');
  assertCondition(editorResult?.ok === true, `openSyntheticEditor failed: ${JSON.stringify(editorResult)}`);
  await closeBlockingOverlays(page);
  const editorState = await waitForAppState(
    page,
    (candidate) => candidate?.activeScene?.scene === 'editor',
    'phone editor scene',
  );
  scenarioSummary.assertions.push({
    label: 'opened synthetic editor on phone',
    activeScene: summarizeActiveScene(editorState.activeScene),
  });

  await assertHidden(page, '#mobile-editor-nav', 'legacy editor nav');
  await assertVisible(page, '#editor-shell-phone-bar', 'persistent phone actions');
  await assertSelectorsWithinViewport(page, ['#editor-shell-phone-bar', '#editor-shell-dock', '#sidebar'], 'phone editor bounds');
  for (const action of ['test', 'publish']) await assertVisible(page, `[data-editor-shell-action="${action}"]`, `phone ${action}`);
  for (const panel of ['terrain', 'stuff', 'characters', 'hazards', 'deco']) {
    await page.locator(`[data-editor-dock="${panel}"]`).scrollIntoViewIfNeeded();
    await clickElement(page, `[data-editor-dock="${panel}"]`);
    await page.waitForFunction(expected => document.body.dataset.editorShellPanel === expected, panel);
    await assertVisible(page, '#sidebar', `${panel} library`);
    await assertPhoneTapTargets(page, scenarioSummary, `editor library ${panel}`);
    scenarioSummary.assertions.push({ label: `phone library selectable: ${panel}` });
  }
  await assertPhoneTapTargets(page, scenarioSummary, 'editor dock');
  await captureScenarioScreenshot(page, scenarioSummary, scenarioDir, 'editor-dock');
  await clickElement(page, '#btn-mobile-editor-toggle');
  await page.waitForFunction(() => document.body.dataset.mobileEditorCollapsed === 'true');
  await assertHidden(page, '#sidebar', 'collapsed library');
  await assertVisible(page, '[data-editor-shell-action="test"]', 'Test remains reachable');
  await assertVisible(page, '[data-editor-shell-action="publish"]', 'Publish remains reachable');
  await captureScenarioScreenshot(page, scenarioSummary, scenarioDir, 'editor-collapsed');
  scenarioSummary.assertions.push({ label: 'persistent actions remain visible with the library hidden' });
}

async function runTabletLandscapeBrowse(page, scenarioSummary, scenarioDir) {
  const state = await waitForReadyOverworld(page, 'tablet landscape browse');
  assertCondition(state.device.deviceClass === 'tablet', `expected tablet, got ${state.device.deviceClass}`);
  assertCondition(state.device.coarsePointer === true, 'expected coarse pointer on tablet profile');
  await closeBlockingOverlays(page);
  await assertVisible(page, '#world-hud', 'tablet world HUD');
  await assertHidden(page, '#mobile-editor-nav', 'phone editor nav on tablet browse');
  await assertSelectorsWithinViewport(page, ['#world-hud', '#bottom-bar'], 'tablet browse bounds');
  await captureScenarioScreenshot(page, scenarioSummary, scenarioDir, 'tablet-browse');
}

async function waitForReadyOverworld(page, label) {
  return waitForAppState(
    page,
    (state) => state?.appFeedback?.ready === true && state?.activeScene?.scene === 'overworld-play',
    label,
  );
}

async function waitForBodyAppMode(page, mode, label, timeoutMs = 10_000) {
  const startedAt = Date.now();
  let lastMode = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastMode = await page.evaluate(() => document.body.dataset.appMode ?? null);
    if (lastMode === mode) {
      return lastMode;
    }
    await page.waitForTimeout(100);
  }

  throw new Error(`Timed out waiting for ${label}. Last app mode: ${lastMode ?? 'none'}`);
}

async function closeBlockingOverlays(page) {
  await page.evaluate(() => {
    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };

    const authPanel = document.getElementById('auth-panel');
    authPanel?.classList.remove('menu-open');

    const welcomeModal = document.getElementById('welcome-modal');
    if (isVisible(welcomeModal)) {
      document.getElementById('btn-welcome-close')?.click();
    }

    const roomGoalIntroModal = document.getElementById('room-goal-intro-modal');
    if (isVisible(roomGoalIntroModal)) {
      document.getElementById('btn-room-goal-intro-start')?.click();
    }

    const chatPanel = document.getElementById('global-chat');
    if (chatPanel?.classList.contains('is-open')) {
      document.getElementById('btn-chat-toggle')?.click();
    }

    const jumpSheet = document.getElementById('mobile-jump-sheet');
    jumpSheet?.classList.add('hidden');
    delete document.body.dataset.mobileJumpSheetOpen;
  });
  await page.waitForTimeout(250);
}

async function closeBlockingOverlaysUntilClear(page, timeoutMs = 6000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await closeBlockingOverlays(page);
    const clear = await page.evaluate(() => {
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };

      return !isVisible(document.getElementById('room-goal-intro-modal'))
        && !isVisible(document.getElementById('welcome-modal'));
    });
    if (clear) {
      return;
    }
    await page.waitForTimeout(250);
  }
}

async function selectEditableRoom(page) {
  const targetRoom = await runPreviewSmokeAction(page, 'selectEditableRoom');
  assertCondition(
    targetRoom?.ok === true,
    `Failed to find an editable room in the loaded world window: ${JSON.stringify(targetRoom)}`,
  );
  return targetRoom;
}

async function runPreviewSmokeAction(page, action, payload = undefined) {
  return page.evaluate(
    ({ actionName, actionPayload }) => window.run_preview_smoke_action?.(actionName, actionPayload) ?? null,
    { actionName: action, actionPayload: payload },
  );
}

async function readState(page) {
  return page.evaluate(() => {
    const raw = window.render_game_to_text?.() ?? '';
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });
}

async function readCameraTunerSnapshot(page) {
  return page.evaluate(() => window.wampMobileCameraTuner?.get() ?? null);
}

async function waitForCameraTunerSnapshot(page, predicate, label, timeoutMs = 5000) {
  const startedAt = Date.now();
  let lastSnapshot = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastSnapshot = await readCameraTunerSnapshot(page);
    if (lastSnapshot && predicate(lastSnapshot)) {
      return lastSnapshot;
    }
    await page.waitForTimeout(100);
  }

  throw new Error(`Timed out waiting for ${label}. Last tuner snapshot: ${JSON.stringify(lastSnapshot)}`);
}

async function waitForAppState(page, predicate, label, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastState = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastState = await readState(page);
    if (lastState && predicate(lastState)) {
      return lastState;
    }
    await page.waitForTimeout(250);
  }

  lastState = await readState(page);
  if (lastState && predicate(lastState)) {
    return lastState;
  }

  throw new Error(`Timed out waiting for ${label}. Last state: ${JSON.stringify(summarizeStateForLog(lastState))}`);
}

async function assertVisible(page, selector, label) {
  await page.waitForSelector(selector, { state: 'visible', timeout: 5000 });
  const visible = await page.locator(selector).first().isVisible();
  assertCondition(visible, `${label} should be visible (${selector})`);
}

async function assertHidden(page, selector, label) {
  await page.waitForSelector(selector, { state: 'hidden', timeout: 2000 }).catch(() => {});
  const visible = await page.locator(selector).first().isVisible().catch(() => false);
  assertCondition(!visible, `${label} should be hidden (${selector})`);
}

async function assertAbsent(page, selector, label) {
  const count = await page.locator(selector).count();
  assertCondition(count === 0, `${label} should be absent (${selector}), found ${count}`);
}

async function assertSelectorsWithinViewport(page, selectors, label) {
  const violations = await page.evaluate((candidateSelectors) => {
    const tolerance = 2;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const failures = [];

    for (const selector of candidateSelectors) {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        continue;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const visible =
        style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
      if (!visible) {
        continue;
      }

      if (
        rect.left < -tolerance
        || rect.top < -tolerance
        || rect.right > viewportWidth + tolerance
        || rect.bottom > viewportHeight + tolerance
      ) {
        failures.push({
          selector,
          rect: {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            right: Math.round(rect.right),
            bottom: Math.round(rect.bottom),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          viewport: {
            width: viewportWidth,
            height: viewportHeight,
          },
        });
      }
    }

    return failures;
  }, selectors);

  assertCondition(violations.length === 0, `${label} overflowed viewport: ${JSON.stringify(violations)}`);
}

async function dispatchPointer(page, selector, type, pointerId) {
  await dispatchPointerAt(page, selector, type, pointerId);
}

async function dispatchPointerAt(page, selector, type, pointerId, deltaX = 0, deltaY = 0) {
  await page.$eval(
    selector,
    (element, payload) => {
      const rect = element.getBoundingClientRect();
      const event = new PointerEvent(payload.type, {
        bubbles: true,
        cancelable: true,
        pointerId: payload.pointerId,
        pointerType: 'touch',
        isPrimary: true,
        clientX: rect.left + rect.width / 2 + payload.deltaX,
        clientY: rect.top + rect.height / 2 + payload.deltaY,
      });
      element.dispatchEvent(event);
    },
    { type, pointerId, deltaX, deltaY },
  );
}

async function dispatchPointerAtRatio(page, selector, type, pointerId, xRatio, yRatio) {
  await page.$eval(
    selector,
    (element, payload) => {
      const rect = element.getBoundingClientRect();
      const event = new PointerEvent(payload.type, {
        bubbles: true,
        cancelable: true,
        pointerId: payload.pointerId,
        pointerType: 'touch',
        isPrimary: true,
        clientX: rect.left + rect.width * payload.xRatio,
        clientY: rect.top + rect.height * payload.yRatio,
      });
      element.dispatchEvent(event);
    },
    { type, pointerId, xRatio, yRatio },
  );
}

async function dispatchDocumentPointer(page, type, pointerId) {
  await page.evaluate((payload) => {
    const event = new PointerEvent(payload.type, {
      bubbles: true,
      cancelable: true,
      pointerId: payload.pointerId,
      pointerType: 'touch',
      isPrimary: true,
      clientX: Math.round(window.innerWidth / 2),
      clientY: Math.round(window.innerHeight / 2),
    });
    document.dispatchEvent(event);
  }, { type, pointerId });
}

async function clickElement(page, selector) {
  await page.$eval(selector, (element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Element is not clickable: ${element?.nodeName ?? 'missing'}`);
    }
    element.click();
  });
  await page.waitForTimeout(100);
}

async function captureScenarioScreenshot(page, scenarioSummary, scenarioDir, name) {
  const screenshotPath = path.join(scenarioDir, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  scenarioSummary.screenshots.push(screenshotPath);
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function summarizeActiveScene(activeScene) {
  if (!activeScene || typeof activeScene !== 'object') {
    return activeScene ?? null;
  }

  const summary = {};
  for (const key of [
    'scene',
    'mode',
    'cameraMode',
    'selectedState',
    'source',
    'roomId',
    'activeTool',
    'selectedLayer',
    'zoom',
  ]) {
    if (key in activeScene) {
      summary[key] = activeScene[key];
    }
  }

  if (activeScene.selected && typeof activeScene.selected === 'object') {
    summary.selected = activeScene.selected;
  }
  if (activeScene.currentRoom && typeof activeScene.currentRoom === 'object') {
    summary.currentRoom = activeScene.currentRoom;
  }
  if (activeScene.player && typeof activeScene.player === 'object') {
    summary.player = {
      x: activeScene.player.x,
      y: activeScene.player.y,
      velocityX: activeScene.player.velocityX,
      velocityY: activeScene.player.velocityY,
    };
  }

  return summary;
}

function summarizeStateForLog(state) {
  if (!state || typeof state !== 'object') {
    return state ?? null;
  }

  return {
    activeScene: summarizeActiveScene(state.activeScene),
    device: state.device ?? null,
    touch: state.touch ?? null,
    appFeedback: state.appFeedback
      ? {
          ready: state.appFeedback.ready,
          bootVisible: state.appFeedback.bootVisible,
          busyVisible: state.appFeedback.busyVisible,
          bootStatus: state.appFeedback.bootStatus,
          busyStatus: state.appFeedback.busyStatus,
        }
      : null,
    auth: state.auth
      ? {
          loading: state.auth.loading,
          authenticated: state.auth.authenticated,
          status: state.auth.status,
        }
      : null,
  };
}

function getStringArg(flagName) {
  const equalsArg = process.argv.find((candidate) => candidate.startsWith(`${flagName}=`));
  if (equalsArg) {
    return equalsArg.slice(flagName.length + 1).trim();
  }

  const flagIndex = process.argv.indexOf(flagName);
  if (flagIndex >= 0) {
    return process.argv[flagIndex + 1]?.trim() || '';
  }

  return '';
}

function sanitizePathSegment(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

function withMobileSmokeQuery(value) {
  const url = new URL(value);
  url.searchParams.set('previewSmoke', '1');
  if (engineName === 'webkit') url.searchParams.set('renderer', 'canvas');
  return url.toString();
}

function buildScenarioUrl(searchParams = undefined) {
  const url = new URL(targetUrl);
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function readWelcomeModalLayout(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('#welcome-modal .welcome-modal-panel');
    if (!(panel instanceof HTMLElement)) {
      throw new Error('Missing welcome modal panel');
    }

    const panelRect = panel.getBoundingClientRect();
    const panelBounds = serializeRect(panelRect);
    const actions = Array.from(
      document.querySelectorAll('#btn-welcome-close, #btn-welcome-explore, #btn-welcome-play, #btn-welcome-build'),
    ).map((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return {
        id: candidate.id,
        rect: serializeRect(rect),
        withinPanel:
          rect.top >= panelRect.top - 2
          && rect.left >= panelRect.left - 2
          && rect.right <= panelRect.right + 2
          && rect.bottom <= panelRect.bottom + 2,
      };
    });

    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      panel: panelBounds,
      scroll: {
        scrollTop: panel.scrollTop,
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
      },
      actions,
    };

    function serializeRect(rect) {
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }
  });
}

async function readPortraitPlayLayout(page) {
  return page.evaluate(() => {
    const controls = document.getElementById('mobile-play-controls');
    if (!(controls instanceof HTMLElement)) {
      throw new Error('Missing mobile play controls');
    }

    const activeScene = JSON.parse(window.render_game_to_text?.() || 'null')?.activeScene;
    const zoom = Number(activeScene?.zoom ?? 0);
    const worldView = activeScene?.camera?.worldView;
    const player = activeScene?.player;
    if (!zoom || !worldView || !player) {
      throw new Error(`Missing portrait camera/player state: ${JSON.stringify(activeScene)}`);
    }

    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      controls: serializeRect(controls.getBoundingClientRect()),
      moveZone: readSelectionStyle(document.getElementById('mobile-move-zone')),
      moveStick: readMoveStickLayout(),
      playerScreen: {
        x: Math.round((player.x - worldView.x) * zoom),
        y: Math.round((player.y - worldView.y) * zoom),
      },
      camera: {
        zoom,
        worldView,
      },
      mobilePortraitPlay: document.body.dataset.mobilePortraitPlay ?? null,
      mobilePortraitFocusedRoom: document.body.dataset.mobilePortraitFocusedRoom ?? null,
    };

    function readSelectionStyle(element) {
      if (!(element instanceof HTMLElement)) {
        throw new Error('Missing mobile move zone');
      }

      const style = window.getComputedStyle(element);
      return {
        userSelect: style.getPropertyValue('user-select') || style.getPropertyValue('-webkit-user-select'),
        webkitUserSelect: style.getPropertyValue('-webkit-user-select'),
        backgroundColor: style.backgroundColor,
      };
    }

    function readMoveStickLayout() {
      const moveZone = document.getElementById('mobile-move-zone');
      const stick = document.getElementById('mobile-move-stick');
      const knob = stick?.querySelector('.mobile-move-stick-knob');
      if (!(moveZone instanceof HTMLElement) || !(stick instanceof HTMLElement) || !(knob instanceof HTMLElement)) {
        throw new Error('Missing mobile move stick');
      }

      const moveZoneRect = moveZone.getBoundingClientRect();
      const stickRect = stick.getBoundingClientRect();
      const knobRect = knob.getBoundingClientRect();
      const style = window.getComputedStyle(stick);
      const visible =
        style.display !== 'none'
        && style.visibility !== 'hidden'
        && stickRect.width > 0
        && stickRect.height > 0;
      return {
        visible,
        rect: serializeRect(stickRect),
        knob: serializeRect(knobRect),
        withinMoveZone:
          stickRect.top >= moveZoneRect.top - 2
          && stickRect.left >= moveZoneRect.left - 2
          && stickRect.right <= moveZoneRect.right + 2
          && stickRect.bottom <= moveZoneRect.bottom + 2,
      };
    }

    function serializeRect(rect) {
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }
  });
}

async function readMoveStickSnapshot(page) {
  return page.evaluate(() => {
    const stick = document.getElementById('mobile-move-stick');
    const knob = stick?.querySelector('.mobile-move-stick-knob');
    if (!(stick instanceof HTMLElement) || !(knob instanceof HTMLElement)) {
      throw new Error('Missing mobile move stick');
    }

    const baseRect = stick.getBoundingClientRect();
    const knobRect = knob.getBoundingClientRect();
    return {
      base: serializeRect(baseRect),
      knob: serializeRect(knobRect),
      baseCenter: {
        x: Math.round(baseRect.left + baseRect.width / 2),
        y: Math.round(baseRect.top + baseRect.height / 2),
      },
      knobCenter: {
        x: Math.round(knobRect.left + knobRect.width / 2),
        y: Math.round(knobRect.top + knobRect.height / 2),
      },
    };

    function serializeRect(rect) {
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }
  });
}

async function readPortraitFocusedWorldHudLayout(page) {
  return page.evaluate(() => {
    const hud = document.getElementById('world-hud');
    if (!(hud instanceof HTMLElement)) {
      throw new Error('Missing world HUD');
    }

    const buttonSelector = [
      '#btn-world-play',
      '#btn-world-share',
      '#btn-world-edit',
      '#btn-world-build',
      '#btn-world-course-builder',
      '#btn-world-leaderboard',
      '#btn-world-chat',
      '#btn-world-jump-sheet',
    ].join(', ');
    const buttons = Array.from(document.querySelectorAll(buttonSelector)).map((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const hudRect = hud.getBoundingClientRect();
      const style = window.getComputedStyle(candidate);
      const visible =
        candidate instanceof HTMLElement
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
      return {
        id: candidate.id,
        disabled: candidate instanceof HTMLButtonElement && candidate.disabled,
        visible,
        rect: serializeRect(rect),
        withinHud:
          rect.top >= hudRect.top - 2
          && rect.left >= hudRect.left - 2
          && rect.right <= hudRect.right + 2
          && rect.bottom <= hudRect.bottom + 2,
      };
    });
    const primaryButtonIds = [
      'btn-world-play',
      'btn-world-edit',
      'btn-world-share',
      'btn-world-build',
      'btn-world-course-builder',
      'btn-world-jump-sheet',
    ];
    const primaryButtons = buttons
      .filter((button) => primaryButtonIds.includes(button.id))
      .map((button) => ({
        ...button,
        rowTop: button.rect.top,
      }));
    const leaderboard = document.getElementById('world-leaderboard');
    if (!(leaderboard instanceof HTMLElement)) {
      throw new Error('Missing world leaderboard strip');
    }
    const leaderboardRect = leaderboard.getBoundingClientRect();
    const leaderboardStyle = window.getComputedStyle(leaderboard);
    const leaderboardVisible =
      leaderboardStyle.display !== 'none'
      && leaderboardStyle.visibility !== 'hidden'
      && leaderboardRect.width > 0
      && leaderboardRect.height > 0;

    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      hud: serializeRect(hud.getBoundingClientRect()),
      hudDocument: serializeRect(toDocumentRect(hud.getBoundingClientRect())),
      scroll: {
        x: Math.round(window.scrollX),
        y: Math.round(window.scrollY),
      },
      mobilePortraitPlay: document.body.dataset.mobilePortraitPlay ?? null,
      mobilePortraitFocusedRoom: document.body.dataset.mobilePortraitFocusedRoom ?? null,
      buttons,
      primaryButtons,
      leaderboard: {
        text: leaderboard.textContent?.trim() ?? '',
        visible: leaderboardVisible,
        rect: serializeRect(leaderboardRect),
        withinHud:
          leaderboardRect.top >= hud.getBoundingClientRect().top - 2
          && leaderboardRect.left >= hud.getBoundingClientRect().left - 2
          && leaderboardRect.right <= hud.getBoundingClientRect().right + 2
          && leaderboardRect.bottom <= hud.getBoundingClientRect().bottom + 2,
      },
    };

    function toDocumentRect(rect) {
      return {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        right: rect.right + window.scrollX,
        bottom: rect.bottom + window.scrollY,
        width: rect.width,
        height: rect.height,
      };
    }

    function serializeRect(rect) {
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }
  });
}

function isIgnoredConsoleError(text, url = null) {
  return (
    text.includes('cloudflareinsights.com/cdn-cgi/rum')
    || url?.includes('cloudflareinsights.com/cdn-cgi/rum')
  );
}

function writeSummary() {
  writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
}


async function runSignedRoomControls(page, summary, directory) {
  await waitForBodyAppMode(page, 'play-world', 'signed portrait initial Play', 30_000);
  // Play mode precedes the asynchronous room intro; wait for its actual Start action.
  await page.locator('#btn-room-goal-intro-start').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('#btn-room-goal-intro-start').tap();
  await page.locator('#room-goal-intro-modal').waitFor({ state: 'hidden' });
  await closeBlockingOverlaysUntilClear(page);
  await page.locator('#btn-mobile-world-stop').tap();
  await waitForBodyAppMode(page, 'world', 'signed portrait Stop');
  await closeBlockingOverlaysUntilClear(page);
  const hit = async selector => {
    await page.locator(selector).waitFor({ state: 'visible' });
    const result = await page.locator(selector).evaluate(element => {
      const r = element.getBoundingClientRect(), h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { width: r.width, height: r.height, foreground: element === h || element.contains(h), inside: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
    });
    assertCondition(result.width >= 40 && result.height >= 40 && result.foreground && result.inside, `${selector} must remain a reachable target: ${JSON.stringify(result)}`);
  };
  for (const id of ['#btn-world-edit', '#btn-mobile-world-hud-details', '#btn-mobile-world-hud-minimize', '#menu-toggle']) await hit(id);
  await page.locator('#btn-mobile-world-hud-details').tap();
  await page.waitForFunction(() => document.body.dataset.mobileWorldHudDetails === 'true');
  await page.locator('#btn-mobile-world-hud-details').tap();
  await waitForBodyAppMode(page, 'world', 'More keeps the room stopped');
  await page.locator('#btn-activity-open').waitFor({ state: 'visible', timeout: 30_000 });
  await hit('#btn-activity-open');
  assertCondition((await page.locator('#activity-unread-count').textContent()) === '3', 'Activity keeps its unread indicator');
  await page.locator('#btn-activity-open').tap(); await page.locator('#activity-modal').waitFor({ state: 'visible' });
  await page.locator('#btn-activity-close').tap();
  await captureScenarioScreenshot(page, summary, directory, 'signed-room-controls');
  await page.locator('#menu-toggle').tap(); await hit('#auth-identity'); await hit('#btn-activity-open');
  await captureScenarioScreenshot(page, summary, directory, 'signed-open-menu');
  await page.locator('#menu-toggle').tap();
  await assertHidden(page, '#auth-identity', 'signed profile kept inside the closed menu');
  await page.locator('#btn-world-edit').tap();
  await waitForBodyAppMode(page, 'editor', 'real portrait Edit touch enters editor', 30_000);
  await page.locator('[data-editor-shell-action="room"]').tap();
  await page.locator('button[data-editor-room-section="background"]').tap();
  await page.locator('#background-card-grid').waitFor({ state: 'visible' });
  const thumbnails = await readBackgroundThumbnailImages(page);
  assertCondition(thumbnails.length === 22, 'All 22 built-in thumbnail layers decode');
  summary.assertions.push({ label: 'all built-in background layers use versioned root URLs and decode', thumbnails });
  const forest = page.locator('#background-card-grid button[data-background-id="forest"]');
  await forest.scrollIntoViewIfNeeded();
  await hit('#background-card-grid button[data-background-id="forest"]');
  await captureScenarioScreenshot(page, summary, directory, 'signed-background-thumbnails');
  const [backgroundSaved] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/rooms/0%2C0/draft' && response.request().method() === 'PUT' && response.status() === 200, { timeout: 15_000 }),
    forest.tap(),
  ]);
  assertCondition((await page.locator('#background-select').inputValue()) === 'forest', 'Decoded background remains selectable');
  assertCondition((await backgroundSaved.json()).draft.background === 'forest', 'Selected background is saved in the draft');
  const goalPrompt = await checkPhoneGoalPrompt(page, summary, directory);
  const musicTab = page.locator('button[data-editor-room-section="music"]');
  if (!(await musicTab.isVisible())) await page.locator('[data-editor-shell-action="room"]').tap();
  await musicTab.tap();
  await page.locator('#editor-music-overlay').waitFor({ state: 'visible' });
  const tools = page.locator('#btn-editor-music-touch-tools');
  if (await tools.isVisible() && await tools.getAttribute('aria-expanded') !== 'true') await tools.tap();
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/rooms/0%2C0/draft' && response.request().method() === 'PUT' && response.status() === 200, { timeout: 15_000 });
  await page.locator('#btn-editor-music-tempo-up').tap();
  assertCondition((await page.locator('#editor-music-tempo-label').textContent()).includes('125'), 'real music touch changes tempo');
  await page.locator('#btn-editor-music-tempo-down').tap();
  await captureScenarioScreenshot(page, summary, directory, 'signed-portrait-music');
  await hit('#btn-editor-music-close'); await page.locator('#btn-editor-music-close').tap();
  await assertHidden(page, '#editor-music-overlay', 'Music Close stays reachable with signed Activity');
  assertCondition((await (await saved).json()).draft.goalIntroText === goalPrompt, 'Music edits preserve the saved Goal Prompt');
  await page.locator('#btn-editor-phone-menu').tap();
  await page.locator('#btn-editor-phone-account').tap();
  await hit('#btn-activity-open');
  await page.locator('#menu-toggle').tap();
  summary.assertions.push({ label: 'signed room controls, notifications, profile menu and natural portrait editor/music touches pass' });
}

async function checkPhoneGoalPrompt(page, summary, directory) {
  await page.locator('[data-editor-dock="markers"]').tap();
  await page.locator('[data-editor-marker-action="goal"]').tap();
  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/rooms/0%2C0/draft'
      && response.request().method() === 'PUT' && response.status() === 200
      && response.request().postDataJSON().goal?.type === 'collect_target', { timeout: 15_000 }),
    page.locator('#goal-type-button-grid button[data-goal-type-value="collect_target"]').tap(),
  ]);
  const field = page.locator('#goal-intro-text');
  await field.scrollIntoViewIfNeeded();
  const layout = await field.evaluate(element => {
    const box = element.getBoundingClientRect();
    const row = element.closest('.goal-control-row').getBoundingClientRect();
    const label = element.closest('.goal-control-row').querySelector('label').getBoundingClientRect();
    return { width: box.width, rowWidth: row.width, labelBottom: label.bottom, top: box.top,
      fontSize: parseFloat(getComputedStyle(element).fontSize), maxLength: element.maxLength,
      foreground: document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element };
  });
  assertCondition(layout.width >= layout.rowWidth - 4 && layout.labelBottom <= layout.top + 1,
    `Goal Prompt must use the full row below its label: ${JSON.stringify(layout)}`);
  assertCondition(layout.foreground && layout.fontSize >= 16 && layout.maxLength === 140,
    `Goal Prompt must remain readable and editable: ${JSON.stringify(layout)}`);
  const prompt = 'Collect the coins, then bring them back to your friend.';
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/rooms/0%2C0/draft'
      && response.request().method() === 'PUT' && response.status() === 200
      && response.request().postDataJSON().goalIntroText === prompt, { timeout: 15_000 }),
    (async () => { await field.fill(prompt); await field.press('Tab'); })(),
  ]);
  assertCondition((await response.json()).draft.goalIntroText === prompt, 'Typed Goal Prompt is saved in the draft');
  summary.assertions.push({ label: 'full-width phone Goal Prompt accepts and saves text', layout });
  await captureScenarioScreenshot(page, summary, directory, 'signed-goal-prompt');
  return prompt;
}


async function runGamepadControls(page, scenarioSummary, scenarioDir) {
  const result = await auditGamepadControls(page,
    label => captureScenarioScreenshot(page, scenarioSummary, scenarioDir, label));
  scenarioSummary.assertions.push({ label: 'standard Gamepad API and R route existing gameplay actions safely', ...result });
}

async function runNavigation(page, summary, directory) {
  const result = await auditNavigation(page, { capture: label => captureScenarioScreenshot(page, summary, directory, label) });
  summary.assertions.push({ label: 'browse, account, play and editor navigation destinations', ...result });
}
