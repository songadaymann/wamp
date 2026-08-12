import puppeteer, { type BrowserWorker } from '@cloudflare/puppeteer';
import {
  buildStitchPageHtml,
  pngDataUrlToArrayBuffer,
  type StitchRequest,
} from './stitch';

interface PageLike {
  setContent(html: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  waitForFunction(callback: () => boolean, options?: { timeout?: number }): Promise<unknown>;
  evaluate<TResult, TArgument>(
    callback: (argument: TArgument) => TResult | Promise<TResult>,
    argument: TArgument,
  ): Promise<TResult>;
}

interface BrowserLike {
  close(): Promise<void>;
  newPage(): Promise<PageLike>;
}

export async function stitchMapScreenshotPng(
  browserBinding: BrowserWorker,
  request: StitchRequest,
): Promise<ArrayBuffer> {
  const browser = await puppeteer.launch(browserBinding) as BrowserLike;
  try {
    const page = await browser.newPage();
    await page.setContent(buildStitchPageHtml(), {
      waitUntil: 'networkidle0',
      timeout: 60_000,
    });
    await page.waitForFunction(
      () => (window as Window & { __MAP_SCREENSHOT_STITCH_READY__?: boolean }).__MAP_SCREENSHOT_STITCH_READY__ === true,
      { timeout: 30_000 },
    );
    const dataUrl = await page.evaluate(async (input) => {
      const api = (window as Window & {
        __MAP_SCREENSHOT_STITCH__?: {
          render(request: StitchRequest): Promise<string>;
        };
      }).__MAP_SCREENSHOT_STITCH__;
      if (!api) throw new Error('Stitch page contract missing.');
      return api.render(input);
    }, request);
    return pngDataUrlToArrayBuffer(dataUrl);
  } finally {
    await browser.close();
  }
}
