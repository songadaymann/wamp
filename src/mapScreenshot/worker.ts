import { AUTO_CAPTURE_CRON } from './config';
import { captureMapScreenshot, type MapScreenshotEnv } from './capture';
import { buildGalleryHtml } from './galleryHtml';
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
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (request.method === 'GET' && (path === '/' || path === '/index.html')) {
        const screenshots = await listScreenshots(env.SCREENSHOTS);
        return htmlResponse(buildGalleryHtml({
          screenshots,
          publicBasePath: '',
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
            url: `/files/${encodeURIComponent(shot.fileName)}`,
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
        const screenshots = await listScreenshots(env.SCREENSHOTS);
        const files = [];
        for (const shot of screenshots) {
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
            'content-disposition': 'attachment; filename="wamp-map-screenshots.zip"',
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

function isSafeScreenshotFileName(fileName: string): boolean {
  return /^[0-9]{4}_[0-9]{2}_[0-9]{2}(?:_[1-9])?\.png$/.test(fileName);
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
