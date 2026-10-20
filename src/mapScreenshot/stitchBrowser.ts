import puppeteer, { type BrowserWorker } from '@cloudflare/puppeteer';
import { withCaptureBrowser } from './managedBrowser';
import type { StitchRequest } from './stitch';
import { renderStitchPage, type StitchPageBrowser, type StitchPngResult } from './stitchPageRenderer';
export type { StitchPngResult } from './stitchPageRenderer';
type BrowserLike = StitchPageBrowser & { close(): Promise<void>; disconnect(): Promise<void> };

export async function stitchMapScreenshotPng(browserBinding: BrowserWorker, request: StitchRequest, signal: AbortSignal): Promise<StitchPngResult> {
  const endpoint: BrowserWorker = { fetch: (input, init) => browserBinding.fetch(input, { ...init, signal }) };
  return withCaptureBrowser(() => puppeteer.launch(endpoint) as Promise<BrowserLike>, browser => renderStitchPage(browser, request), signal);
}
