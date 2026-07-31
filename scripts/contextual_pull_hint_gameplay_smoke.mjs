import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const url = process.env.CONTEXTUAL_HINT_SMOKE_URL || 'http://127.0.0.1:4173/?renderer=canvas&previewSmoke=1';
const roomId = process.env.CONTEXTUAL_HINT_SMOKE_ROOM_ID || '1,-1';
const outputDir = path.resolve('output/web-game/contextual-pull-hint-gameplay-smoke');
const screenshotPath = path.join(outputDir, 'pull-hint-visible.png');

fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(() => {
    window.localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
    window.localStorage.setItem('wamp_install_help_dismissed_v1', '1');
    window.localStorage.removeItem('wamp.contextualHint.pullCrate.dismissed.v2');
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    try {
      const rendered = JSON.parse(window.render_game_to_text?.() ?? '{}');
      return rendered.appFeedback?.ready && typeof window.run_preview_smoke_action === 'function';
    } catch {
      return false;
    }
  }, null, { timeout: 60_000 });

  const selection = await page.evaluate(
    (requestedRoomId) => window.run_preview_smoke_action?.('selectEditableRoom', { roomId: requestedRoomId }),
    roomId,
  );
  if (!selection?.ok) {
    throw new Error(`Could not select room ${roomId}: ${JSON.stringify(selection)}`);
  }

  const play = await page.evaluate(() => window.run_preview_smoke_action?.('playSelectedRoom'));
  if (!play?.ok) {
    throw new Error(`Could not enter Play mode: ${JSON.stringify(play)}`);
  }
  const startButton = page.locator('#room-goal-intro-modal:not(.hidden) #btn-room-goal-intro-start');
  if (await startButton.isVisible().catch(() => false)) {
    await startButton.click();
  }
  await page.waitForFunction(() => {
    try {
      return JSON.parse(window.render_game_to_text?.() ?? '{}')?.activeScene?.mode === 'play';
    } catch {
      return false;
    }
  }, null, { timeout: 20_000 });

  const initialState = await readSceneState(page);
  const currentRoom = initialState.currentRoom;
  const crate = initialState.liveObjects?.find((object) => (
    object.id === 'crate' &&
    object.room?.x === currentRoom?.x &&
    object.room?.y === currentRoom?.y
  ));
  if (!crate) {
    throw new Error(`Room ${roomId} has no active crate: ${JSON.stringify(initialState.liveObjects ?? [])}`);
  }

  const xOffsets = [-14, -18, -22, -26, -30];
  const yOffsets = [-14, -10, -6, -2, 2, 6, 10, 14];
  let visibleState = null;
  let playerPosition = null;
  for (const yOffset of yOffsets) {
    for (const xOffset of xOffsets) {
      const x = crate.x + xOffset;
      const y = crate.y + yOffset;
      await page.evaluate(
        (target) => window.run_preview_smoke_action?.('setPlayerPosition', {
          ...target,
          velocityX: 0,
          velocityY: 0,
          bodyEnabled: true,
        }),
        { x, y },
      );
      await page.waitForTimeout(420);
      const state = await readSceneState(page);
      if (state.contextualHints?.visible) {
        visibleState = state;
        playerPosition = { x, y };
        break;
      }
    }
    if (visibleState) break;
  }

  if (!visibleState || !playerPosition) {
    throw new Error(`Could not position the player at a valid crate pull hint target near ${JSON.stringify(crate)}.`);
  }
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await page.keyboard.down('ArrowDown');
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(600);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('ArrowDown');

  const completed = await page.waitForFunction(() => {
    try {
      const scene = JSON.parse(window.render_game_to_text?.() ?? '{}')?.activeScene;
      return scene?.contextualHints?.dismissed?.['pull-crate'] === true &&
        window.localStorage.getItem('wamp.contextualHint.pullCrate.dismissed.v2') === '1';
    } catch {
      return false;
    }
  }, null, { timeout: 5_000 }).then(() => true, () => false);
  const finalState = await readSceneState(page);
  if (!completed) {
    throw new Error(`Pulling the crate did not complete the hint: ${JSON.stringify(finalState.contextualHints)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    roomId,
    crate,
    playerPosition,
    screenshotPath,
    contextualHints: finalState.contextualHints,
  }, null, 2));
} finally {
  await browser.close();
}

async function readSceneState(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? '{}')?.activeScene ?? {});
}
