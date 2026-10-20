import { createServer } from 'vite';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

export async function verifyMapCaptureRender(output) {
  mkdirSync(output, { recursive: true });
  const loader = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: false } });
  let browser;
  try {
    const { renderStitchPage } = await loader.ssrLoadModule('/src/mapScreenshot/stitchPageRenderer.ts');
    const { withCaptureBrowser } = await loader.ssrLoadModule('/src/mapScreenshot/managedBrowser.ts');
    const { buildStitchRequest } = await loader.ssrLoadModule('/src/mapScreenshot/stitch.ts');
    const { fillInfoOverlayTemplate } = await loader.ssrLoadModule('/src/mapScreenshot/infoOverlay.ts');
    const tile = await sharp({ create: { width: 640, height: 352, channels: 4, background: '#79ccde' } }).composite([{ input: Buffer.from('<svg width="640" height="352"><rect y="288" width="640" height="64" fill="#277b30"/><rect x="300" y="220" width="80" height="68" fill="#fcea7c"/></svg>') }]).png().toBuffer();
    const font = name => `data:font/ttf;base64,${readFileSync('public/assets/fonts/' + name + '.ttf').toString('base64')}`;
    const data = { date: 'October 20, 2026', players: 5, builders: 1, rooms: 1 };
    const request = buildStitchRequest({ zoom: 1, centerWorldX: 320, centerWorldY: 176,
      tiles: [{ level: 0, tileX: 0, tileY: 0, worldX: 0, worldY: 0, worldWidth: 640, worldHeight: 352, url: 'data:image/png;base64,' + tile.toString('base64') }],
      publishedRooms: [{ x: 0, y: 0 }], gridRoomBounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
      infoHtml: fillInfoOverlayTemplate(data), infoOverlay: { date: data.date, players: '5', builders: '1', rooms: '1' },
      earlyGameboyDataUrl: font('early-gameboy'), homeVideoDataUrl: font('HomeVideo-Regular'), generateStarfield: true,
    });
    browser = await chromium.launch({ args: ['--mute-audio'] }); const errors = [], outbound = [];
    const adapter = { close: () => browser.close(), async newPage() {
      const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.route(/^https?:/, route => { outbound.push(route.request().url()); return route.abort(); });
      return { setContent: (html, options) => page.setContent(html, { ...options, waitUntil: 'networkidle' }),
        waitForFunction: (callback, options) => page.waitForFunction(callback, undefined, options), evaluate: (callback, argument) => page.evaluate(callback, argument) };
    } };
    const result = await withCaptureBrowser(async () => adapter, handle => renderStitchPage(handle, request), new AbortController().signal);
    assert(!browser.isConnected()); assert.deepEqual(errors, []); assert.deepEqual(outbound, []);
    const bytes = Buffer.from(result.pngBytes), metadata = await sharp(bytes).metadata(), stats = await sharp(bytes).stats();
    assert.equal(metadata.width, 3840); assert.equal(metadata.height, 2160); assert(stats.entropy > 0.1); assert(result.starfieldPngBytes?.byteLength > 0);
    writeFileSync(output + '/map-4k.png', bytes);
    writeFileSync(output + '/report.json', JSON.stringify({ ok: true, width: metadata.width, height: metadata.height, bytes: bytes.length, entropy: stats.entropy, starfieldBytes: result.starfieldPngBytes.byteLength, browserClosed: true, errors, outbound, productionCaptures: 0 }, null, 2));
    console.log('map capture renderer: 4K PNG passed');
  } finally { if (browser?.isConnected()) await browser.close(); await loader.close(); }
}
