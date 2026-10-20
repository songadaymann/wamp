import { AUTO_CAPTURE_CRON } from './config';
import type { MapScreenshotEnv } from './capture';
import { captureDailyMap } from './captureService';
import { buildGalleryHtml } from './galleryHtml';
import {
  formatEasternMonth,
  monthKeyFromFileName,
  shiftMonthKey,
} from './naming';
import { listScreenshots } from './storage';
import { screenshotObjectKey } from './naming';
import { screenshotArchive } from './archive';
import { ArchiveLimitError } from './zip';

export interface ScheduledController {
  cron: string;
  scheduledTime: number;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

const worker = {
  async fetch(request: Request, env: MapScreenshotEnv): Promise<Response> {
    if (request.method === 'HEAD') {
      const response = await worker.fetch(new Request(request, { method: 'GET' }), env);
      await response.body?.cancel(); return new Response(null, { status: response.status, headers: response.headers });
    }
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
          allFileNames: all.map((shot) => shot.fileName),
          publicBasePath,
          adminHref: publicBasePath ? '/launch-admin#map-capture' : env.MAP_SCREENSHOT_ADMIN_BASE_URL ? `${env.MAP_SCREENSHOT_ADMIN_BASE_URL.replace(/\/$/, '')}/launch-admin#map-capture` : null,
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

      if (path === '/api/capture' || path === '/api/capture/daily') {
        return jsonResponse({ ok: false, error: 'Capture is available only through Launch Admin.' }, 403);
      }

      if (request.method === 'GET' && path.startsWith('/files/')) {
        const fileName = decodeURIComponent(path.slice('/files/'.length));
        if (!isSafeScreenshotFileName(fileName)) {
          return jsonResponse({ ok: false, error: 'Invalid file name.' }, 400);
        }
        const object = await env.SCREENSHOTS.get(screenshotObjectKey(fileName));
        if (!object) {
          return jsonResponse({ ok: false, error: 'Not found.' }, 404);
        }
        return new Response(object.body, {
          headers: {
            'content-type': 'image/png',
            'content-length': String(object.size),
            'cache-control': 'public, max-age=3600',
            'content-disposition': `inline; filename="${fileName}"`,
          },
        });
      }

      if (request.method === 'GET' && path === '/archive.zip') {
        const monthParam = url.searchParams.get('month');
        let zipName = 'wamp-map-screenshots.zip';
        if (monthParam) {
          if (!isSafeMonthKey(monthParam)) {
            return jsonResponse({ ok: false, error: 'Invalid month.' }, 400);
          }
          zipName = `wamp-map-screenshots-${monthParam}.zip`;
        }
        return new Response(await screenshotArchive(env.SCREENSHOTS, monthParam), {
          headers: {
            'content-type': 'application/zip',
            'cache-control': 'no-store',
            'content-disposition': `attachment; filename="${zipName}"`,
          },
        });
      }

      return jsonResponse({ ok: false, error: 'Not found.' }, 404);
    } catch (error) {
      return jsonResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, error instanceof ArchiveLimitError ? 413 : 500);
    }
  },

  async scheduled(
    _controller: ScheduledController,
    env: MapScreenshotEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil((async () => {
      const result = await captureDailyMap(env);
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
