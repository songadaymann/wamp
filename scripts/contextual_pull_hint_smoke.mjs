import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const url = process.env.CONTEXTUAL_HINT_SMOKE_URL || 'http://localhost:4173/?renderer=canvas';
const outputDir = path.resolve('output/web-game/contextual-pull-hint-smoke');
const screenshotPath = path.join(outputDir, 'visible-hint.png');

fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(async () => {
    const storageKey = 'wamp.contextualHint.pullCrate.dismissed.v2';
    window.localStorage.removeItem(storageKey);

    const module = await import('/src/scenes/overworld/contextualHints.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 352;
    canvas.style.position = 'fixed';
    canvas.style.left = '40px';
    canvas.style.top = '80px';
    canvas.style.width = '640px';
    canvas.style.height = '352px';
    canvas.style.pointerEvents = 'none';
    document.body.append(canvas);

    const scene = {
      time: { now: 0 },
      cameras: {
        main: {
          x: 0,
          y: 0,
          width: 640,
          height: 352,
          worldView: { x: 0, y: 0, width: 640, height: 352 },
        },
      },
      game: { canvas },
      scale: { width: 640, height: 352 },
    };
    const request = {
      id: 'pull-crate',
      anchor: { worldX: -10_000, worldY: -10_000 },
      backDirection: -1,
    };

    const controller = new module.OverworldContextualHintsController(scene);
    controller.update([request]);
    const immediatelyVisible = controller.getDebugState().visible;
    scene.time.now = 349;
    controller.update([request]);
    const visibleBeforeDelay = controller.getDebugState().visible;
    scene.time.now = 350;
    controller.update([request]);
    const visibleState = controller.getDebugState();
    const element = document.querySelector('.world-contextual-hint');
    const elementRect = element?.getBoundingClientRect() ?? null;
    const viewportPlacementOk = Boolean(
      visibleState.anchor &&
      elementRect &&
      visibleState.anchor.screenX >= elementRect.width / 2 + 12 &&
      visibleState.anchor.screenX <= window.innerWidth - elementRect.width / 2 - 12 &&
      visibleState.anchor.screenY >= elementRect.height + 32 &&
      visibleState.anchor.screenY <= window.innerHeight - 12
    );

    window.__contextualHintSmoke = { canvas, controller, request, scene };
    return {
      immediatelyVisible,
      visibleBeforeDelay,
      visibleState,
      viewportPlacementOk,
    };
  });

  if (result.immediatelyVisible || result.visibleBeforeDelay || !result.visibleState.visible) {
    throw new Error(`Delayed display assertion failed: ${JSON.stringify(result)}`);
  }
  if (!result.viewportPlacementOk) {
    throw new Error(`Viewport placement assertion failed: ${JSON.stringify(result.visibleState)}`);
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });

  const completion = await page.evaluate(async () => {
    const smoke = window.__contextualHintSmoke;
    if (!smoke) throw new Error('Contextual hint smoke state is missing.');
    const { canvas, controller, request, scene } = smoke;
    const module = await import('/src/scenes/overworld/contextualHints.ts');
    controller.completeHint('pull-crate');
    const afterPullCompletion = controller.getDebugState();
    controller.destroy();

    const persistedController = new module.OverworldContextualHintsController(scene);
    scene.time.now = 2000;
    persistedController.update([request]);
    scene.time.now = 2500;
    persistedController.update([request]);
    const persisted = persistedController.getDebugState();
    persistedController.destroy();

    window.localStorage.removeItem('wamp.contextualHint.pullCrate.dismissed.v2');
    const unrelatedController = new module.OverworldContextualHintsController(scene);
    scene.time.now = 3000;
    unrelatedController.update([]);
    const unrelated = unrelatedController.getDebugState();
    unrelatedController.destroy();
    canvas.remove();
    delete window.__contextualHintSmoke;

    return { afterPullCompletion, persisted, unrelated };
  });

  if (
    completion.afterPullCompletion.visible ||
    !completion.afterPullCompletion.dismissed['pull-crate'] ||
    completion.persisted.visible ||
    !completion.persisted.dismissed['pull-crate'] ||
    completion.unrelated.visible ||
    completion.unrelated.activeHintId !== null
  ) {
    throw new Error(`Completion or persistence assertion failed: ${JSON.stringify(completion)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    screenshotPath,
    delayedDisplay: true,
    completedAfterPullSignal: true,
    dismissalPersisted: true,
    viewportPlacement: true,
    unrelatedInteractionsHidden: true,
  }, null, 2));
} finally {
  await browser.close();
}
