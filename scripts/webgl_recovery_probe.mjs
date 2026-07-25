import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:4518/?worldTiles=force&webglRecoveryProbe=1';
const outputPrefix = process.argv[3] ?? 'output/webgl-recovery';
const browser = await chromium.launch({ headless: true });

async function createReadyPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const messages = [];
  page.on('console', (message) => {
    if (message.text().includes('Context') || message.text().includes('webgl-context')) {
      messages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => messages.push(`pageerror: ${error.message}`));
  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
      const context = originalGetContext.call(this, type, ...args);
      if ((type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') && context) {
        window.__wampCapturedGl = context;
      }
      return context;
    };
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    if (typeof window.render_game_to_text !== 'function') return false;
    const state = JSON.parse(window.render_game_to_text());
    return state.activeScene?.worldTiles?.coveragePercentage === 100
      && state.activeScene?.worldTiles?.attachedTileCount > 0;
  }, { timeout: 20_000 });
  const closeButton = page.locator('#welcome-modal button', { hasText: 'CLOSE' });
  if (await closeButton.count()) await closeButton.first().click();
  return { context, page, messages };
}

async function loseContext(page) {
  return page.evaluate(() => {
    const extension = window.__wampCapturedGl?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    window.__wampContextLossExtension = extension;
    extension.loseContext();
    return true;
  });
}

const restoredRun = await createReadyPage();
const restoredLossStarted = await loseContext(restoredRun.page);
await restoredRun.page.waitForTimeout(750);
await restoredRun.page.evaluate(() => window.__wampContextLossExtension?.restoreContext());
await restoredRun.page.waitForFunction(() => {
  if (typeof window.render_game_to_text !== 'function') return false;
  const state = JSON.parse(window.render_game_to_text());
  return state.graphics?.status === 'healthy'
    && state.graphics?.restoreCount === 1
    && state.activeScene?.worldTiles?.targetCoveragePercentage === 100
    && state.activeScene?.worldTiles?.contextRestorePending === false
    && state.activeScene?.worldTiles?.attachedTileCount > 0;
}, { timeout: 15_000 });
await restoredRun.page.screenshot({ path: `${outputPrefix}-native-restored.png` });
const restoredState = await restoredRun.page.evaluate(() => {
  const state = JSON.parse(window.render_game_to_text());
  return { graphics: state.graphics, worldTiles: state.activeScene.worldTiles };
});
await restoredRun.context.close();

const reloadRun = await createReadyPage();
const reloadLossStarted = await loseContext(reloadRun.page);
await reloadRun.page.waitForFunction(() => {
  if (typeof window.render_game_to_text !== 'function') return false;
  const state = JSON.parse(window.render_game_to_text());
  return state.graphics?.status === 'healthy'
    && state.graphics?.lastAutoReloadAtMs !== null
    && state.activeScene?.worldTiles?.targetCoveragePercentage === 100
    && state.activeScene?.worldTiles?.contextRestorePending === false
    && state.activeScene?.worldTiles?.attachedTileCount > 0;
}, { timeout: 20_000 });
await reloadRun.page.screenshot({ path: `${outputPrefix}-auto-reloaded.png` });
const reloadState = await reloadRun.page.evaluate(() => {
  const state = JSON.parse(window.render_game_to_text());
  return { graphics: state.graphics, worldTiles: state.activeScene.worldTiles };
});
await reloadRun.context.close();

console.log(JSON.stringify({
  url,
  restoredLossStarted,
  restoredState,
  restoredMessages: restoredRun.messages,
  reloadLossStarted,
  reloadState,
  reloadMessages: reloadRun.messages,
}, null, 2));
await browser.close();
