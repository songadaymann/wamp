import { mkdir } from 'node:fs/promises';
import './lib/mutedBrowsers.mjs';
import { chromium } from 'playwright';

// Needs a test-hook build (VITE_ENABLE_TEST_RESET=1, or Vite dev): it opens the synthetic editor.
// By default the Community catalog is answered from the two fixture sprites below; set
// COMMUNITY_SPRITE_SMOKE_LIVE=1 to read the real catalog the frontend's API serves.
const targetUrl = new URL(process.env.COMMUNITY_SPRITE_SMOKE_URL || 'http://127.0.0.1:3000/?renderer=canvas');
targetUrl.searchParams.set('previewSmoke', '1');
const url = targetUrl.toString();
const liveMode = process.env.COMMUNITY_SPRITE_SMOKE_LIVE === '1';
const outputDir = 'output/web-game/community-sprites';
await mkdir(outputDir, { recursive: true });

const fixtureSprite = (id, name, kind, color, filled, displayName) => ({
  sprite: {
    id, name, size: 16, kind, status: 'active',
    pixels: Array.from({ length: 256 }, (_, index) => (filled(index % 16, Math.floor(index / 16)) ? color : null)),
    createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
  },
  revision: 1,
  status: 'active',
  creator: { userId: `${id}-creator`, displayName, username: null, legacy: false },
  remixedFrom: null,
});
const FIXTURE_SPRITES = [
  fixtureSprite('smoke-blue-friend', 'Blue Friend', 'decoration', '#2f6fdf',
    (x, y) => x >= 4 && x <= 11 && y >= 3 && y <= 13, 'Pixel Pilot'),
  fixtureSprite('smoke-red-block', 'Red Block', 'solid', '#d23c3c', () => true, 'Brick Builder'),
];

async function routeFixtureCatalog(page) {
  await page.route((routeUrl) => routeUrl.pathname.startsWith('/api/custom-sprites'), (route) => {
    const requestUrl = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (route.request().method() !== 'GET') return json({ error: 'Fixture catalog is read-only.' }, 403);
    if (requestUrl.pathname === '/api/custom-sprites') {
      const query = requestUrl.searchParams.get('query')?.toLowerCase() ?? '';
      return json({ sprites: FIXTURE_SPRITES.filter((entry) => entry.sprite.name.toLowerCase().includes(query)), nextCursor: null });
    }
    if (requestUrl.pathname === '/api/custom-sprites/mine') return json({ sprites: [], nextCursor: null });
    const entry = FIXTURE_SPRITES.find((candidate) => requestUrl.pathname === `/api/custom-sprites/${candidate.sprite.id}`);
    return entry ? json({ sprite: entry }) : json({ error: 'Not in the fixture catalog.' }, 404);
  });
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
const catalogResponses = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));
page.on('response', (response) => {
  if (new URL(response.url()).pathname.startsWith('/api/custom-sprites')) {
    catalogResponses.push({ url: response.url(), status: response.status() });
  }
});
await page.addInitScript(() => {
  window.localStorage.setItem('wamp_welcome_modal_seen_v1', '1');
  window.localStorage.setItem('wamp_replay_opt_out', '1');
});
if (!liveMode) await routeFixtureCatalog(page);

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => document.body.dataset.appReady === 'true'
    && typeof window.run_preview_smoke_action === 'function', null, { timeout: 120_000 });
  assert(catalogResponses.length === 0, 'Community catalog must not load during normal startup.');

  // Build Here only appears next to published rooms, so open the synthetic editor instead.
  const opened = await page.evaluate(() => window.run_preview_smoke_action('openSyntheticEditor'));
  assert(opened?.ok === true, `Synthetic editor did not open: ${JSON.stringify(opened)}`);
  await page.waitForFunction(() => document.body.dataset.appMode === 'editor', null, { timeout: 20_000 });
  // Community sprites are a tab of the Stuff dock.
  await page.locator('[data-editor-dock="stuff"]').click();
  await page.locator('.obj-cat-tab[data-category="custom"]').click();
  await page.locator('.community-sprite-card').first().waitFor({ timeout: 10_000 });

  assert(catalogResponses.length === 1, 'Opening Community should make exactly one initial catalog request.');
  assert(catalogResponses[0]?.status === 200, 'The Community catalog request should succeed.');
  if (liveMode) {
    assert(await page.locator('.community-sprite-card').count() > 0, 'The live Community should render sprites.');
    assert(
      await page.locator('.community-sprite-card .community-sprite-card-credit').first().isVisible(),
      'Creator credit should be visible.',
    );
    await page.screenshot({ path: `${outputDir}/community-live.png`, fullPage: true });
    await page.locator('.community-sprite-card').first().getByRole('button', { name: 'Remix' }).click();
    await page.locator('#editor-sprite-overlay:not(.hidden)').waitFor();
    assert(
      (await page.locator('#editor-sprite-name').inputValue()).endsWith(' Remix'),
      'Remix should open a new named copy in the pixel editor.',
    );
    await page.screenshot({ path: `${outputDir}/remix-live.png`, fullPage: true });
    await page.locator('#btn-editor-sprite-close').click();
  } else {
    assert(await page.locator('.community-sprite-card').count() === 2, 'Seeded Community sprites should render.');
    assert(await page.getByText('by Pixel Pilot').count() === 1, 'Creator credit should be visible.');
    await page.screenshot({ path: `${outputDir}/community.png`, fullPage: true });

    await page.locator('#object-search-input').fill('Blue');
    await page.waitForResponse((response) => (
      new URL(response.url()).pathname === '/api/custom-sprites'
      && new URL(response.url()).searchParams.get('query') === 'blue'
    ));
    await page.waitForFunction(() => document.querySelectorAll('.community-sprite-card').length === 1);
    assert(await page.getByText('Blue Friend', { exact: true }).count() === 1, 'Server search should filter sprites.');

    await page.locator('.community-sprite-card').getByRole('button', { name: 'Remix' }).click();
    await page.locator('#editor-sprite-overlay:not(.hidden)').waitFor();
    assert(
      (await page.locator('#editor-sprite-name').inputValue()) === 'Blue Friend Remix',
      'Remix should open a new named copy in the pixel editor.',
    );
    await page.screenshot({ path: `${outputDir}/remix.png`, fullPage: true });
    await page.locator('#btn-editor-sprite-close').click();

    await page.locator('#object-search-input').fill('Red');
    await page.waitForResponse((response) => (
      new URL(response.url()).pathname === '/api/custom-sprites'
      && new URL(response.url()).searchParams.get('query') === 'red'
    ));
    await page.waitForFunction(() => document.querySelectorAll('.community-sprite-card').length === 1);
    await page.locator('.community-sprite-card').getByRole('button', { name: 'Use' }).click();
    assert(
      documentMode(await page.evaluate(() => document.body.dataset.editorPaletteMode)) === 'tiles',
      'A 16x16 solid sprite should enter the tile-paint flow.',
    );
  }

  assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(' | ')}`);
  assert(
    catalogResponses.every(({ status }) => status >= 200 && status < 300),
    'All custom sprite catalog responses should succeed.',
  );
  const adminPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await adminPage.goto(new URL('/launch-admin.html#sprite-review', url).toString(), {
    waitUntil: 'domcontentloaded',
  });
  await adminPage.locator('#custom-sprite-admin-list').getByText('Community sprite review is locked.').waitFor();
  await adminPage.locator('#sprite-review').screenshot({ path: `${outputDir}/admin.png` });
  await adminPage.close();

  console.log(JSON.stringify({ ok: true, liveMode, catalogResponses, screenshots: 3 }));
} finally {
  await browser.close();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function documentMode(value) {
  return typeof value === 'string' ? value : '';
}
