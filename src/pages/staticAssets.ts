import type { PagesWorkerEnv } from './model';

const STANDALONE_PAGE_ALIASES = new Map<string, string>([
  ['/jam', '/__standalone/jam.asset'],
  ['/jam.html', '/__standalone/jam.asset'],
  ['/school-admin', '/__standalone/school-admin.asset'],
  ['/school-admin/', '/__standalone/school-admin.asset'],
  ['/school-admin.html', '/__standalone/school-admin.asset'],
  ['/school-login', '/__standalone/school-login.asset'],
  ['/school-login/', '/__standalone/school-login.asset'],
  ['/school-login.html', '/__standalone/school-login.asset'],
  ['/world-tile-render', '/__standalone/world-tile-render.asset'],
  ['/world-tile-render/', '/__standalone/world-tile-render.asset'],
  ['/world-tile-render.html', '/__standalone/world-tile-render.asset'],
]);

export async function handleStaticAssetRequest(
  request: Request,
  env: PagesWorkerEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/jam/' && (request.method === 'GET' || request.method === 'HEAD')) {
    url.pathname = '/jam';
    return new Response(null, {
      status: 308,
      headers: { Location: url.toString() },
    });
  }

  const standalonePage = STANDALONE_PAGE_ALIASES.get(url.pathname);
  if (standalonePage) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' },
      });
    }

    return fetchStandalonePageAsset(request, env, standalonePage);
  }

  if (url.pathname.startsWith('/assets/')) {
    return fetchHashedAsset(request, env);
  }

  return null;
}

async function fetchHashedAsset(request: Request, env: PagesWorkerEnv): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: {
        Allow: 'GET, HEAD',
        'Cache-Control': 'no-store',
      },
    });
  }

  const response = await env.ASSETS.fetch(request);
  const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
  if (response.ok && !contentType.includes('text/html')) return response;

  // Pages can briefly route a just-deployed hashed asset to the SPA fallback
  // while the custom-domain deployment pointer propagates. Never let that HTML
  // response inherit the immutable /assets/* cache policy.
  return new Response(request.method === 'HEAD' ? null : 'Asset Not Found', {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function fetchStandalonePageAsset(
  request: Request,
  env: PagesWorkerEnv,
  pathname: string,
): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = pathname;
  const assetRequest = new Request(url.toString(), request);
  const response = await env.ASSETS.fetch(assetRequest);
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=60, s-maxage=300');
  headers.delete('Content-Length');

  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    headers,
  });
}
