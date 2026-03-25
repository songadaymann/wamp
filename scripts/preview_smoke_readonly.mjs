import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const rawUrl = getStringArg('--url') || process.env.PREVIEW_SMOKE_URL?.trim() || '';
if (!rawUrl) {
  throw new Error('Provide a preview URL with PREVIEW_SMOKE_URL or --url.');
}

const targetUrl = withPreviewSmokeQuery(rawUrl);
const preferredRoomId = getStringArg('--room-id') || process.env.PREVIEW_SMOKE_ROOM_ID?.trim() || '';
const outputDir =
  process.env.PREVIEW_SMOKE_OUTPUT_DIR?.trim()
  || path.join(
    'output/web-game/preview-readonly-smoke',
    sanitizePathSegment(new URL(targetUrl).host),
  );
const summary = {
  url: targetUrl,
  outputDir,
  preferredRoomId: preferredRoomId || null,
  startedAt: new Date().toISOString(),
  consoleErrors: [],
  consoleWarnings: [],
  pageErrors: [],
  steps: {},
};

mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
});
await context.addInitScript(() => {
  window.localStorage.setItem('wamp_install_help_dismissed_v1', '1');
});
const page = await context.newPage();
page.on('console', (message) => {
  const text = message.text();
  const record = {
    type: message.type(),
    text,
  };
  if (message.type() === 'warning') {
    summary.consoleWarnings.push(record);
    return;
  }

  if (message.type() === 'error' && !isIgnoredConsoleError(text)) {
    summary.consoleErrors.push(record);
  }
});
page.on('pageerror', (error) => {
  summary.pageErrors.push(error.message);
});

try {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  const bootState = await waitForAppState(
    page,
    (state) => state?.appFeedback?.ready === true && state?.activeScene?.scene === 'overworld-play',
    'overworld boot',
  );
  summary.steps.boot = {
    activeScene: bootState.activeScene,
    authAuthenticated: bootState.auth?.authenticated ?? null,
    chatReady: bootState.chat !== null,
    appReady: bootState.appFeedback?.ready ?? false,
  };
  await page.screenshot({ path: path.join(outputDir, 'browse.png') });

  const targetRoom = await page.evaluate(
    ({ requestedRoomId }) => window.run_preview_smoke_action?.('selectEditableRoom', {
      roomId: requestedRoomId || null,
    }) ?? null,
    { requestedRoomId: preferredRoomId },
  );
  if (!targetRoom?.ok) {
    throw new Error(
      `Failed to find an editable room in the loaded window: ${JSON.stringify(targetRoom)}`
    );
  }
  summary.steps.targetRoom = targetRoom;

  await page.click('#btn-world-play');
  const playState = await waitForAppState(
    page,
    (state) => state?.activeScene?.scene === 'overworld-play' && state?.activeScene?.mode === 'play',
    'play mode',
  );
  summary.steps.play = {
    activeScene: playState.activeScene,
  };
  await page.screenshot({ path: path.join(outputDir, 'play.png') });

  await page.click('#btn-world-play');
  const browseStateAfterPlay = await waitForAppState(
    page,
    (state) => state?.activeScene?.scene === 'overworld-play' && state?.activeScene?.mode === 'browse',
    'browse mode after play',
  );
  summary.steps.returnToWorld = {
    activeScene: browseStateAfterPlay.activeScene,
  };

  await page.click('#btn-world-edit');
  const editState = await waitForAppState(
    page,
    (state) => state?.activeScene?.scene === 'editor',
    'editor scene',
  );
  summary.steps.edit = {
    activeScene: editState.activeScene,
  };
  await page.screenshot({ path: path.join(outputDir, 'editor.png') });

  summary.finishedAt = new Date().toISOString();
  summary.ok = summary.consoleErrors.length === 0 && summary.pageErrors.length === 0;
} catch (error) {
  summary.error = error instanceof Error ? error.message : String(error);
  summary.failedAt = new Date().toISOString();
  summary.ok = false;
} finally {
  writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  await browser.close();
}

console.log(
  JSON.stringify(
    {
      ok: summary.ok,
      url: summary.url,
      outputDir: summary.outputDir,
      error: summary.error ?? null,
      steps: {
        bootScene: summary.steps.boot?.activeScene?.scene ?? null,
        playMode: summary.steps.play?.activeScene?.mode ?? null,
        editScene: summary.steps.edit?.activeScene?.scene ?? null,
      },
    },
    null,
    2,
  ),
);

if (!summary.ok) {
  process.exit(1);
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

function withPreviewSmokeQuery(value) {
  const url = new URL(value);
  url.searchParams.set('previewSmoke', '1');
  return url.toString();
}

function isIgnoredConsoleError(text) {
  return (
    text.includes('cloudflareinsights.com/cdn-cgi/rum')
    || text.includes('Failed to load resource: net::ERR_FAILED')
      && text.includes('cloudflareinsights.com')
  );
}

async function waitForAppState(page, predicate, label, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastState = null;
  let lastParseError = null;

  while (Date.now() - startedAt < timeoutMs) {
    const { state, parseError } = await page.evaluate(() => {
      const raw = window.render_game_to_text?.() ?? '';
      if (!raw) {
        return { state: null, parseError: null };
      }

      try {
        return {
          state: JSON.parse(raw),
          parseError: null,
        };
      } catch (error) {
        return {
          state: null,
          parseError: error instanceof Error ? error.message : String(error),
        };
      }
    });

    if (parseError) {
      lastParseError = parseError;
    }
    lastState = state;
    if (state && predicate(state)) {
      return state;
    }

    await page.waitForTimeout(250);
  }

  throw new Error(
    `Timed out waiting for ${label}. Last parse error: ${lastParseError ?? 'none'}. Last state: ${JSON.stringify(lastState)}`
  );
}
