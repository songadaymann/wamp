import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const rawUrl = getStringArg('--url') || process.env.MOBILE_SMOKE_URL?.trim() || 'http://127.0.0.1:3000';
const targetUrl = withMobileSmokeQuery(rawUrl);
const outputDir =
  process.env.MOBILE_SMOKE_OUTPUT_DIR?.trim()
  || path.join('output/web-game/mobile-smoke', sanitizePathSegment(new URL(targetUrl).host));

const summary = {
  url: targetUrl,
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
    name: 'phone-landscape-play-no-legacy-controls',
    profile: profiles.phoneLandscape,
    run: runPhoneLandscapePlayNoLegacyControls,
  },
  {
    name: 'phone-landscape-editor-sheets',
    profile: profiles.phoneLandscape,
    run: runPhoneLandscapeEditorSheets,
  },
  {
    name: 'tablet-landscape-browse',
    profile: profiles.tabletLandscape,
    run: runTabletLandscapeBrowse,
  },
];

mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});

try {
  for (const scenario of scenarios) {
    await runScenario(browser, scenario);
  }

  summary.finishedAt = new Date().toISOString();
  summary.ok =
    Object.values(summary.scenarios).every((scenario) => scenario.ok)
    && summary.consoleErrors.length === 0
    && summary.pageErrors.length === 0;
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

  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }
    const record = {
      scenario: scenario.name,
      type: message.type(),
      text: message.text(),
    };
    if (!isIgnoredConsoleError(record.text)) {
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
    await gotoMobileSmokePage(page, scenario.searchParams);
    await scenario.run(page, scenarioSummary, scenarioDir);
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

async function runPhonePortraitDeepLinkPlay(page, scenarioSummary, scenarioDir) {
  await waitForBodyAppMode(page, 'play-world', 'phone portrait deep-linked play app mode', 30_000);
  await closeBlockingOverlaysUntilClear(page);
  const state = await waitForAppState(
    page,
    (candidate) =>
      candidate?.touch?.active === true
      && candidate?.device?.deviceClass === 'phone'
      && candidate.device.orientationState === 'portrait'
      && candidate?.activeScene?.mode === 'play',
    'phone portrait deep-linked play mode',
  );
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

  const layout = await readPortraitPlayLayout(page, state);
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
  await clickElement(page, '#btn-mobile-world-stop');
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
  await assertHidden(page, '#bottom-bar', 'bottom bar during portrait focused room HUD');
  await assertVisible(page, '#world-hud', 'portrait focused room bottom HUD');
  await assertVisible(page, '#btn-world-play', 'portrait focused room Play button');
  await assertVisible(page, '#btn-world-edit', 'portrait focused room Edit button');
  await assertVisible(page, '#btn-world-build', 'portrait focused room Build button');
  await assertVisible(page, '#btn-world-course-builder', 'portrait focused room Course Builder button');
  await assertVisible(page, '#btn-world-explore', 'portrait focused room Explore button');
  await assertVisible(page, '#btn-world-leaderboard', 'portrait focused room Leaderboard button');
  await assertVisible(page, '#btn-world-chat', 'portrait focused room Chat button');
  await assertVisible(page, '#btn-world-jump-sheet', 'portrait focused room Warp shortcut');
  await assertSelectorsWithinViewport(
    page,
    [
      '#world-hud',
      '#btn-world-play',
      '#btn-world-edit',
      '#btn-world-build',
      '#btn-world-course-builder',
      '#btn-world-explore',
      '#btn-world-leaderboard',
      '#btn-world-chat',
      '#btn-world-jump-sheet',
    ],
    'phone portrait focused room HUD bounds',
  );

  const layout = await readPortraitFocusedWorldHudLayout(page);
  const hudTop = Math.max(layout.hud.top, layout.hudDocument.top);
  const hudBottom = Math.max(layout.hud.bottom, layout.hudDocument.bottom);
  assertCondition(
    layout.mobilePortraitFocusedRoom === 'true' && layout.mobilePortraitPlay === 'false',
    `body should mark focused room portrait HUD without play controls: ${JSON.stringify(layout)}`,
  );
  assertCondition(
    hudTop >= Math.round(layout.viewport.height * 0.55),
    `portrait focused room HUD should live at the bottom: ${JSON.stringify(layout.hud)}`,
  );
  assertCondition(
    hudBottom >= layout.viewport.height - 16,
    `portrait focused room HUD should reach the bottom safe area: ${JSON.stringify(layout.hud)}`,
  );
  assertCondition(
    layout.buttons.every((button) => button.visible && button.withinHud),
    `portrait focused room HUD buttons should be compact and inside the HUD: ${JSON.stringify(layout.buttons)}`,
  );
  assertCondition(
    layout.primaryButtons.length === 4
      && layout.primaryButtons.every((button) => button.visible && button.rowTop === layout.primaryButtons[0].rowTop),
    `portrait focused room primary actions should share one row: ${JSON.stringify(layout.primaryButtons)}`,
  );
  assertCondition(
    !layout.leaderboard.visible || layout.leaderboard.withinHud,
    `portrait focused room best-run strip should stay inside the HUD: ${JSON.stringify(layout.leaderboard)}`,
  );

  scenarioSummary.assertions.push({
    label: 'deep-linked phone portrait stop returns to a compact bottom HUD instead of rotate gate',
    layout,
    activeScene: summarizeActiveScene(state.activeScene),
  });
  await captureScenarioScreenshot(page, scenarioSummary, scenarioDir, 'portrait-bottom-hud');
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

  await assertVisible(page, '#mobile-camera-tuner', 'portrait camera tuner panel');
  await assertVisible(page, '#mobile-camera-tuner-value', 'portrait camera tuner value');
  await assertSelectorsWithinViewport(
    page,
    ['#mobile-camera-tuner', '#mobile-camera-tuner-value'],
    'phone portrait camera tuner bounds',
  );

  const before = await readCameraTunerSnapshot(page);
  await clickElement(page, '[data-mobile-camera-tuner-action="zoom-in"]');
  const afterZoom = await waitForCameraTunerSnapshot(
    page,
    (snapshot) => snapshot.zoomMultiplier > before.zoomMultiplier,
    'zoom-in camera tuner adjustment',
  );
  await clickElement(page, '[data-mobile-camera-tuner-action="player-up"]');
  const afterPlayerUp = await waitForCameraTunerSnapshot(
    page,
    (snapshot) => snapshot.targetY < afterZoom.targetY,
    'player-up camera tuner adjustment',
  );
  assertCondition(
    afterPlayerUp.playerScreen.y < afterZoom.playerScreen.y,
    `player-up should move the player higher in the tuned frame: ${JSON.stringify({ afterZoom, afterPlayerUp })}`,
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
  await assertVisible(page, '#btn-world-chat', 'mobile global chat shortcut');
  await assertVisible(page, '#btn-world-jump-sheet', 'mobile jump shortcut');
  await assertSelectorsWithinViewport(
    page,
    ['#world-hud', '#btn-world-chat', '#btn-world-jump-sheet', '#bottom-bar'],
    'phone landscape browse bounds',
  );
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

async function runPhoneLandscapePlayNoLegacyControls(page, scenarioSummary, scenarioDir) {
  await waitForReadyOverworld(page, 'phone landscape play boot');
  await closeBlockingOverlays(page);
  await selectEditableRoom(page);
  await runPreviewSmokeAction(page, 'playSelectedRoom');
  await closeBlockingOverlays(page);
  await waitForBodyAppMode(page, 'play-world', 'phone play app mode');
  const state = await waitForAppState(
    page,
    (candidate) =>
      candidate?.touch?.active === false
      && candidate?.device?.deviceClass === 'phone'
      && candidate.device.orientationState === 'landscape'
      && candidate?.activeScene?.mode === 'play',
    'phone landscape play mode without portrait controls',
  );
  scenarioSummary.assertions.push({
    label: 'entered phone landscape play without enabling legacy touch controls',
    activeScene: summarizeActiveScene(state.activeScene),
  });

  await assertHidden(page, '#mobile-play-controls', 'portrait-only mobile play controls in phone landscape');
  await assertAbsent(page, '.mobile-dpad-btn', 'legacy mobile D-pad buttons in phone landscape play');
  await assertAbsent(page, '#btn-mobile-right', 'legacy mobile right button in phone landscape play');
  await assertAbsent(page, '#rotate-gate', 'rotate gate in phone landscape play');
  await assertVisible(page, '#world-hud', 'world HUD remains available in phone landscape play');

  scenarioSummary.assertions.push({ label: 'phone landscape stays unblocked without old D-pad controls' });
  await captureScenarioScreenshot(page, scenarioSummary, scenarioDir, 'play-no-legacy-controls');
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

  await assertVisible(page, '#mobile-editor-nav', 'mobile editor nav');
  await assertVisible(page, '#sidebar', 'mobile editor sheet');

  for (const sheet of ['tools', 'background', 'palette', 'objects', 'goal', 'actions']) {
    await clickElement(page, `[data-mobile-editor-sheet="${sheet}"]`);
    await page.waitForFunction((expectedSheet) => document.body.dataset.mobileEditorSheet === expectedSheet, sheet);
    await assertVisible(page, '#sidebar', `mobile editor ${sheet} sheet`);
    await assertSelectorsWithinViewport(page, ['#mobile-editor-nav', '#sidebar'], `mobile editor ${sheet} bounds`);
    scenarioSummary.assertions.push({ label: `mobile editor sheet selectable: ${sheet}` });
  }

  await clickElement(page, '#btn-mobile-editor-toggle');
  await page.waitForFunction(() => document.body.dataset.mobileEditorCollapsed === 'true');
  scenarioSummary.assertions.push({ label: 'mobile editor sheet collapses' });
  await captureScenarioScreenshot(page, scenarioSummary, scenarioDir, 'editor-collapsed');
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

async function readPortraitPlayLayout(page, state) {
  return page.evaluate((activeState) => {
    const controls = document.getElementById('mobile-play-controls');
    if (!(controls instanceof HTMLElement)) {
      throw new Error('Missing mobile play controls');
    }

    const activeScene = activeState?.activeScene;
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
        userSelect: style.userSelect,
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
  }, state);
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
      '#btn-world-edit',
      '#btn-world-build',
      '#btn-world-course-builder',
      '#btn-world-explore',
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
      'btn-world-build',
      'btn-world-course-builder',
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

function isIgnoredConsoleError(text) {
  return (
    text.includes('cloudflareinsights.com/cdn-cgi/rum')
    || text.includes('Failed to load resource: net::ERR_FAILED') && text.includes('cloudflareinsights.com')
  );
}

function writeSummary() {
  writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
}
