import type { PagesWorkerHandler } from './model';
import { handleRoomImageRequest } from './roomImageRenderer';
import { handleSharePageRequest, parseRoomImageCoordinates } from './shareRoutes';
import { handleStaticAssetRequest } from './staticAssets';

const MAP_SCREENSHOT_ORIGIN =
  'https://everybodys-platformer-map-screenshots.novox-robot.workers.dev';
const CAPTURE_PATH_PREFIX = '/capture';

function isCapturePath(pathname: string): boolean {
  return pathname === CAPTURE_PATH_PREFIX
    || pathname === `${CAPTURE_PATH_PREFIX}/`
    || pathname.startsWith(`${CAPTURE_PATH_PREFIX}/`);
}

async function proxyMapScreenshotGallery(request: Request, url: URL): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD, POST' },
    });
  }

  const upstreamPath = url.pathname.slice(CAPTURE_PATH_PREFIX.length) || '/';
  const upstreamUrl = new URL(upstreamPath + url.search, MAP_SCREENSHOT_ORIGIN);
  const headers = new Headers({
    'X-WAMP-Public-Base-Path': CAPTURE_PATH_PREFIX,
  });
  const accept = request.headers.get('Accept');
  const userAgent = request.headers.get('User-Agent');
  if (accept) headers.set('Accept', accept);
  if (userAgent) headers.set('User-Agent', userAgent);

  return fetch(new Request(upstreamUrl, {
    method: request.method,
    headers,
    redirect: 'manual',
  }));
}

export function createPagesWorker(): PagesWorkerHandler {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (isCapturePath(url.pathname)) {
        return proxyMapScreenshotGallery(request, url);
      }

      const staticAssetResponse = await handleStaticAssetRequest(request, env);
      if (staticAssetResponse) {
        return staticAssetResponse;
      }

      const imageCoordinates = parseRoomImageCoordinates(url.pathname);
      if (imageCoordinates) {
        return handleRoomImageRequest(request, env, url, imageCoordinates);
      }

      const sharePageResponse = await handleSharePageRequest(request, env, url);
      return sharePageResponse ?? env.ASSETS.fetch(request);
    },
  };
}
