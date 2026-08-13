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

interface StitchEvaluateResult {
  ok: boolean;
  dataUrl?: string;
  /** Present when stitch generated a new composite starfield (cache miss). */
  starfieldDataUrl?: string;
  error?: string;
  debug?: Record<string, unknown>;
}

export interface StitchPngResult {
  pngBytes: ArrayBuffer;
  /** Starfield-only PNG bytes when newly generated; null when cache was used. */
  starfieldPngBytes: ArrayBuffer | null;
}

export async function stitchMapScreenshotPng(
  browserBinding: BrowserWorker,
  request: StitchRequest,
): Promise<StitchPngResult> {
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
    const result = await page.evaluate(async (input): Promise<StitchEvaluateResult> => {
      const api = (window as Window & {
        __MAP_SCREENSHOT_STITCH__?: {
          render(request: StitchRequest): Promise<StitchEvaluateResult>;
        };
      }).__MAP_SCREENSHOT_STITCH__;
      if (!api) return { ok: false, error: 'Stitch page contract missing.' };
      return api.render(input);
    }, request);

    if (!result.ok || !result.dataUrl) {
      const err = new Error(result.error || 'Stitch failed without error message.') as Error & {
        stitchDebug?: Record<string, unknown>;
      };
      err.stitchDebug = result.debug;
      throw err;
    }
    return {
      pngBytes: pngDataUrlToArrayBuffer(result.dataUrl),
      starfieldPngBytes: result.starfieldDataUrl
        ? pngDataUrlToArrayBuffer(result.starfieldDataUrl)
        : null,
    };
  } finally {
    await browser.close();
  }
}
