export async function renderRoomPreviewDataUrl(chromium, previewUrl) {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: {
        width: 960,
        height: 720,
      },
      deviceScaleFactor: 1,
    });
    await page.goto(previewUrl, {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });
    await page.waitForFunction(
      () => window.__ROOM_PREVIEW_READY__ === true || Boolean(window.__ROOM_PREVIEW_ERROR__),
      { timeout: 60_000 }
    );
    const result = await page.evaluate(() => ({
      ready: window.__ROOM_PREVIEW_READY__ === true,
      dataUrl: window.__ROOM_PREVIEW_DATA_URL__ ?? '',
      error: window.__ROOM_PREVIEW_ERROR__ ?? '',
    }));

    if (!result.ready || !result.dataUrl) {
      throw new Error(result.error || 'Room preview renderer did not produce a PNG.');
    }

    return result.dataUrl;
  } finally {
    await browser.close();
  }
}
