import type { PagesWorkerEnv } from './model';
import type { RoomShareMetadata, ShareMetadata } from './shareMetadata';

export async function renderRoomAppShell(
  request: Request,
  env: PagesWorkerEnv,
  metadata: RoomShareMetadata,
): Promise<Response> {
  const indexResponse = await fetchAppShellAsset(request, env);
  if (!indexResponse.ok) {
    return fallbackHtmlResponse(request, metadata);
  }

  const headers = new Headers(indexResponse.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=60, s-maxage=300');
  headers.delete('Content-Length');

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers,
    });
  }

  const html = await indexResponse.text();
  return new Response(injectRoomMetadata(html, metadata), {
    status: 200,
    headers,
  });
}

export async function renderProfileAppShell(
  request: Request,
  env: PagesWorkerEnv,
  metadata: ShareMetadata,
): Promise<Response> {
  const indexResponse = await fetchAppShellAsset(request, env);
  if (!indexResponse.ok) {
    return fallbackProfileHtmlResponse(request, metadata);
  }

  const headers = new Headers(indexResponse.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=60, s-maxage=300');
  headers.delete('Content-Length');

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers,
    });
  }

  const html = await indexResponse.text();
  return new Response(injectProfileMetadata(html, metadata), {
    status: 200,
    headers,
  });
}

export async function renderPlaylistAppShell(
  request: Request,
  env: PagesWorkerEnv,
  metadata: ShareMetadata,
): Promise<Response> {
  const indexResponse = await fetchAppShellAsset(request, env);
  if (!indexResponse.ok) {
    return fallbackPlaylistHtmlResponse(request, metadata);
  }

  const headers = new Headers(indexResponse.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=60, s-maxage=300');
  headers.delete('Content-Length');

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers,
    });
  }

  const html = await indexResponse.text();
  return new Response(injectPlaylistMetadata(html, metadata), {
    status: 200,
    headers,
  });
}

export async function renderWampOGramAppShell(
  request: Request,
  env: PagesWorkerEnv,
  metadata: RoomShareMetadata,
): Promise<Response> {
  const indexResponse = await fetchAppShellAsset(request, env);
  if (!indexResponse.ok) {
    return fallbackWampOGramHtmlResponse(request, metadata);
  }

  const headers = new Headers(indexResponse.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=60, s-maxage=300');
  headers.delete('Content-Length');

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers,
    });
  }

  const html = await indexResponse.text();
  return new Response(injectWampOGramMetadata(html, metadata), {
    status: 200,
    headers,
  });
}

async function fetchAppShellAsset(request: Request, env: PagesWorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  for (const pathname of ['/index.html', '/']) {
    const assetUrl = new URL(pathname, url.origin);
    const response = await env.ASSETS.fetch(new Request(assetUrl, request));
    if (response.ok) {
      return response;
    }
  }

  return env.ASSETS.fetch(request);
}

function fallbackHtmlResponse(request: Request, metadata: RoomShareMetadata): Response {
  const body = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    buildRoomMetaTags(metadata),
    '</head>',
    '<body>',
    `  <p><a href="${escapeHtml(metadata.url)}">Open this WAMP room</a></p>`,
    '</body>',
    '</html>',
  ].join('\n');

  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300',
    },
  });
}

function fallbackProfileHtmlResponse(request: Request, metadata: ShareMetadata): Response {
  const body = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    buildProfileMetaTags(metadata),
    '</head>',
    '<body>',
    `  <p><a href="${escapeHtml(metadata.url)}">Open this WAMP profile</a></p>`,
    '</body>',
    '</html>',
  ].join('\n');

  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300',
    },
  });
}

function fallbackPlaylistHtmlResponse(request: Request, metadata: ShareMetadata): Response {
  const body = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    buildPlaylistMetaTags(metadata),
    '</head>',
    '<body>',
    `  <p><a href="${escapeHtml(metadata.url)}">Open this WAMP playlist</a></p>`,
    '</body>',
    '</html>',
  ].join('\n');

  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300',
    },
  });
}

function fallbackWampOGramHtmlResponse(request: Request, metadata: RoomShareMetadata): Response {
  const body = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    buildRoomMetaTags(metadata),
    '</head>',
    '<body>',
    `  <p><a href="${escapeHtml(metadata.url)}">Open this Wamp-O-Gram</a></p>`,
    '</body>',
    '</html>',
  ].join('\n');

  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300',
    },
  });
}

function injectRoomMetadata(html: string, metadata: RoomShareMetadata): string {
  let nextHtml = html;
  if (!/<base\s/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<head([^>]*)>/i, '<head$1>\n    <base href="/">');
  }

  if (/<title>[\s\S]*?<\/title>/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(metadata.title)}</title>`);
  }

  return nextHtml.replace(/<\/head>/i, `${buildRoomMetaTags(metadata)}\n  </head>`);
}

function injectProfileMetadata(html: string, metadata: ShareMetadata): string {
  let nextHtml = html;
  if (!/<base\s/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<head([^>]*)>/i, '<head$1>\n    <base href="/">');
  }

  if (/<title>[\s\S]*?<\/title>/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(metadata.title)}</title>`);
  }

  return nextHtml.replace(/<\/head>/i, `${buildProfileMetaTags(metadata)}\n  </head>`);
}

function injectPlaylistMetadata(html: string, metadata: ShareMetadata): string {
  let nextHtml = html;
  if (!/<base\s/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<head([^>]*)>/i, '<head$1>\n    <base href="/">');
  }

  if (/<title>[\s\S]*?<\/title>/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(metadata.title)}</title>`);
  }

  return nextHtml.replace(/<\/head>/i, `${buildPlaylistMetaTags(metadata)}\n  </head>`);
}

function injectWampOGramMetadata(html: string, metadata: RoomShareMetadata): string {
  let nextHtml = html;
  if (!/<base\s/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<head([^>]*)>/i, '<head$1>\n    <base href="/">');
  }

  if (/<title>[\s\S]*?<\/title>/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(metadata.title)}</title>`);
  }

  return nextHtml.replace(/<\/head>/i, `${buildRoomMetaTags(metadata)}\n  </head>`);
}

function buildRoomMetaTags(metadata: RoomShareMetadata): string {
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description);
  const pageUrl = escapeHtml(metadata.url);
  const imageUrl = escapeHtml(metadata.imageUrl);
  const imageWidth = escapeHtml(String(metadata.imageWidth));
  const imageHeight = escapeHtml(String(metadata.imageHeight));

  return [
    '    <meta name="robots" content="index,follow">',
    `    <link rel="canonical" href="${pageUrl}">`,
    '    <meta property="og:type" content="website">',
    '    <meta property="og:site_name" content="WAMP">',
    `    <meta property="og:title" content="${title}">`,
    `    <meta property="og:description" content="${description}">`,
    `    <meta property="og:url" content="${pageUrl}">`,
    `    <meta property="og:image" content="${imageUrl}">`,
    `    <meta property="og:image:secure_url" content="${imageUrl}">`,
    '    <meta property="og:image:type" content="image/png">',
    `    <meta property="og:image:width" content="${imageWidth}">`,
    `    <meta property="og:image:height" content="${imageHeight}">`,
    `    <meta property="og:image:alt" content="${title}">`,
    '    <meta name="twitter:card" content="summary_large_image">',
    `    <meta name="twitter:title" content="${title}">`,
    `    <meta name="twitter:description" content="${description}">`,
    `    <meta name="twitter:image" content="${imageUrl}">`,
    `    <meta name="twitter:image:alt" content="${title}">`,
  ].join('\n');
}

function buildProfileMetaTags(metadata: ShareMetadata): string {
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description);
  const pageUrl = escapeHtml(metadata.url);
  const imageUrl = escapeHtml(metadata.imageUrl);

  return [
    '    <meta name="robots" content="index,follow">',
    `    <link rel="canonical" href="${pageUrl}">`,
    '    <meta property="og:type" content="profile">',
    '    <meta property="og:site_name" content="WAMP">',
    `    <meta property="og:title" content="${title}">`,
    `    <meta property="og:description" content="${description}">`,
    `    <meta property="og:url" content="${pageUrl}">`,
    `    <meta property="og:image" content="${imageUrl}">`,
    `    <meta property="og:image:secure_url" content="${imageUrl}">`,
    '    <meta name="twitter:card" content="summary">',
    `    <meta name="twitter:title" content="${title}">`,
    `    <meta name="twitter:description" content="${description}">`,
    `    <meta name="twitter:image" content="${imageUrl}">`,
  ].join('\n');
}

function buildPlaylistMetaTags(metadata: ShareMetadata): string {
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description);
  const pageUrl = escapeHtml(metadata.url);
  const imageUrl = escapeHtml(metadata.imageUrl);

  return [
    '    <meta name="robots" content="index,follow">',
    `    <link rel="canonical" href="${pageUrl}">`,
    '    <meta property="og:type" content="website">',
    '    <meta property="og:site_name" content="WAMP">',
    `    <meta property="og:title" content="${title}">`,
    `    <meta property="og:description" content="${description}">`,
    `    <meta property="og:url" content="${pageUrl}">`,
    `    <meta property="og:image" content="${imageUrl}">`,
    `    <meta property="og:image:secure_url" content="${imageUrl}">`,
    '    <meta name="twitter:card" content="summary">',
    `    <meta name="twitter:title" content="${title}">`,
    `    <meta name="twitter:description" content="${description}">`,
    `    <meta name="twitter:image" content="${imageUrl}">`,
  ].join('\n');
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
