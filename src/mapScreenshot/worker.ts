import { AUTO_CAPTURE_CRON } from './config';
import { captureMapScreenshot, type MapScreenshotEnv } from './capture';
import { buildGalleryHtml } from './galleryHtml';
import {
  formatEasternMonth,
  monthKeyFromFileName,
  shiftMonthKey,
} from './naming';
import { listScreenshots, loadScreenshotPng } from './storage';
import { buildZipArchive } from './zip';

export interface ScheduledController {
  cron: string;
  scheduledTime: number;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

const worker = {
  async fetch(request: Request, env: MapScreenshotEnv): Promise<Response> {
    const url = new URL(request.url);
    const publicBasePath = resolvePublicBasePath(request);
    const path = normalizeWorkerPath(url.pathname, publicBasePath);

    try {
      if (request.method === 'GET' && (path === '/' || path === '/index.html')) {
        const all = await listScreenshots(env.SCREENSHOTS);
        const monthKey = resolveMonthKey(url.searchParams.get('month'), all);
        const monthShots = all.filter((shot) => monthKeyFromFileName(shot.fileName) === monthKey);
        const currentEasternMonth = formatEasternMonth();
        const nextMonth = shiftMonthKey(monthKey, 1);
        return htmlResponse(buildGalleryHtml({
          screenshots: monthShots,
          publicBasePath,
          monthKey,
          hasPrevMonth: true,
          hasNextMonth: nextMonth <= currentEasternMonth,
        }));
      }

      if (request.method === 'GET' && path === '/api/health') {
        return jsonResponse({
          ok: true,
          cron: AUTO_CAPTURE_CRON,
        });
      }

      if (request.method === 'GET' && path === '/api/screenshots') {
        const screenshots = await listScreenshots(env.SCREENSHOTS);
        return jsonResponse({
          ok: true,
          screenshots: screenshots.map((shot) => ({
            fileName: shot.fileName,
            size: shot.size,
            uploaded: shot.uploaded?.toISOString() ?? null,
            url: `${publicBasePath}/files/${encodeURIComponent(shot.fileName)}`,
          })),
        });
      }

      if (request.method === 'POST' && path === '/api/capture') {
        const result = await captureMapScreenshot(env, 'manual');
        return jsonResponse(result, result.ok || result.skipped ? 200 : 500);
      }

      if (request.method === 'POST' && path === '/api/capture/daily') {
        const result = await captureMapScreenshot(env, 'daily');
        return jsonResponse(result, result.ok || result.skipped ? 200 : 500);
      }

      if (request.method === 'GET' && path.startsWith('/files/')) {
        const fileName = decodeURIComponent(path.slice('/files/'.length));
        if (!isSafeScreenshotFileName(fileName)) {
          return jsonResponse({ ok: false, error: 'Invalid file name.' }, 400);
        }
        const bytes = await loadScreenshotPng(env.SCREENSHOTS, fileName);
        if (!bytes) {
          return jsonResponse({ ok: false, error: 'Not found.' }, 404);
        }
        return new Response(bytes, {
          headers: {
            'content-type': 'image/png',
            'cache-control': 'public, max-age=3600',
            'content-disposition': `inline; filename="${fileName}"`,
          },
        });
      }

      if (request.method === 'GET' && path === '/archive.zip') {
        const all = await listScreenshots(env.SCREENSHOTS);
        const monthParam = url.searchParams.get('month');
        let selected = all;
        let zipName = 'wamp-map-screenshots.zip';
        if (monthParam) {
          if (!isSafeMonthKey(monthParam)) {
            return jsonResponse({ ok: false, error: 'Invalid month.' }, 400);
          }
          selected = all.filter((shot) => monthKeyFromFileName(shot.fileName) === monthParam);
          zipName = `wamp-map-screenshots-${monthParam}.zip`;
        }
        const files = [];
        for (const shot of selected) {
          const bytes = await loadScreenshotPng(env.SCREENSHOTS, shot.fileName);
          if (!bytes) continue;
          files.push({ name: shot.fileName, bytes: new Uint8Array(bytes) });
        }
        const zip = buildZipArchive(files);
        const zipBytes = new Uint8Array(zip.byteLength);
        zipBytes.set(zip);
        return new Response(zipBytes.buffer, {
          headers: {
            'content-type': 'application/zip',
            'content-disposition': `attachment; filename="${zipName}"`,
          },
        });
      }

      return jsonResponse({ ok: false, error: 'Not found.' }, 404);
    } catch (error) {
      return jsonResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, 500);
    }
  },

  async scheduled(
    _controller: ScheduledController,
    env: MapScreenshotEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil((async () => {
      const result = await captureMapScreenshot(env, 'daily');
      console.log('map-screenshot daily capture', JSON.stringify(result));
    })());
  },
};

export default worker;

const PUBLIC_BASE_PATH_HEADER = 'x-wamp-public-base-path';

function resolvePublicBasePath(request: Request): string {
  const raw = request.headers.get(PUBLIC_BASE_PATH_HEADER)?.trim() ?? '';
  if (!raw || raw === '/') return '';
  return raw.replace(/\/+$/, '');
}

function normalizeWorkerPath(pathname: string, publicBasePath: string): string {
  let path = pathname;
  if (publicBasePath && (path === publicBasePath || path.startsWith(`${publicBasePath}/`))) {
    path = path.slice(publicBasePath.length) || '/';
  }
  return path.replace(/\/+$/, '') || '/';
}

/** Daily `_0` plus manuals `_1`…`_9`. */
function isSafeScreenshotFileName(fileName: string): boolean {
  return /^[0-9]{4}_[0-9]{2}_[0-9]{2}_[0-9]\.png$/.test(fileName);
}

function isSafeMonthKey(value: string): boolean {
  return /^[0-9]{4}_[0-9]{2}$/.test(value);
}

function collectMonthKeys(screenshots: Array<{ fileName: string }>): string[] {
  const months = new Set<string>();
  for (const shot of screenshots) {
    const month = monthKeyFromFileName(shot.fileName);
    if (month) months.add(month);
  }
  return Array.from(months).sort();
}

function resolveMonthKey(
  requested: string | null,
  screenshots: Array<{ fileName: string }>,
): string {
  if (requested && isSafeMonthKey(requested)) {
    return requested;
  }
  const current = formatEasternMonth();
  const months = collectMonthKeys(screenshots);
  if (months.includes(current)) return current;
  return months.length > 0 ? months[months.length - 1]! : current;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    },
  });
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
