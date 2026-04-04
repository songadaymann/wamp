const FRONTEND_URL = getUrlFromEnv('PROD_FRONTEND_URL', 'https://wamp.land');
const API_BASE_URL = getBaseUrlFromEnv('PROD_API_BASE_URL', 'https://api.wamp.land');
const EXPECTED_PARTYKIT_HOST =
  process.env.PROD_PARTYKIT_HOST?.trim() ||
  'everybodys-platformer-presence.songadaymann.partykit.dev';

const frontendResponse = await fetch(FRONTEND_URL, {
  headers: {
    'Cache-Control': 'no-cache',
  },
});

assert(frontendResponse.ok, `Frontend request failed: ${frontendResponse.status} ${frontendResponse.statusText}`);
assert(
  (frontendResponse.headers.get('content-type') || '').includes('text/html'),
  `Expected HTML from ${FRONTEND_URL}, got ${frontendResponse.headers.get('content-type') || 'unknown content type'}.`
);

const frontendHtml = await frontendResponse.text();
const metaApiBase = extractMetaContent(frontendHtml, 'ai-api-base');
const mainScriptUrl = extractMainScriptUrl(frontendHtml, FRONTEND_URL);

if (new URL(FRONTEND_URL).hostname !== new URL(API_BASE_URL).hostname) {
  assert(
    metaApiBase === API_BASE_URL,
    `Expected <meta name="ai-api-base"> to equal ${API_BASE_URL}, got ${metaApiBase ?? 'missing'}.`
  );
}

const sessionResponse = await fetch(`${API_BASE_URL}/api/auth/session`, {
  headers: {
    Accept: 'application/json',
    Origin: new URL(FRONTEND_URL).origin,
  },
});
const sessionContentType = sessionResponse.headers.get('content-type') || '';
assert(sessionResponse.ok, `Auth session request failed: ${sessionResponse.status} ${sessionResponse.statusText}`);
assert(
  sessionContentType.includes('application/json'),
  `Expected JSON from auth session, got ${sessionContentType || 'unknown content type'}.`
);
const sessionJson = await sessionResponse.json();

const healthResponse = await fetch(`${API_BASE_URL}/api/health`, {
  headers: {
    Accept: 'application/json',
    Origin: new URL(FRONTEND_URL).origin,
  },
});
const healthContentType = healthResponse.headers.get('content-type') || '';
assert(healthResponse.ok, `Health request failed: ${healthResponse.status} ${healthResponse.statusText}`);
assert(
  healthContentType.includes('application/json'),
  `Expected JSON from health endpoint, got ${healthContentType || 'unknown content type'}.`
);
const healthJson = await healthResponse.json();
assert(healthJson?.ok === true, 'Health endpoint did not report ok: true.');
assert(healthJson?.storage === 'd1', `Expected storage=d1, got ${String(healthJson?.storage)}`);

let mainBundleContainsPartyKitHost = null;
let mainBundleUrl = null;
if (mainScriptUrl) {
  mainBundleUrl = new URL(mainScriptUrl, FRONTEND_URL).toString();
  const mainBundleResponse = await fetch(mainBundleUrl, {
    headers: {
      'Cache-Control': 'no-cache',
    },
  });
  assert(mainBundleResponse.ok, `Main bundle request failed: ${mainBundleResponse.status} ${mainBundleResponse.statusText}`);
  const mainBundleText = await mainBundleResponse.text();
  mainBundleContainsPartyKitHost = mainBundleText.includes(EXPECTED_PARTYKIT_HOST);
}

const summary = {
  ok: true,
  frontendUrl: FRONTEND_URL,
  apiBaseUrl: API_BASE_URL,
  metaApiBase,
  mainBundleUrl,
  mainBundleContainsPartyKitHost,
  expectedPartykitHost: EXPECTED_PARTYKIT_HOST,
  sessionAuthenticated: sessionJson?.authenticated ?? null,
  health: healthJson,
  checkedAt: new Date().toISOString(),
};

console.log(JSON.stringify(summary, null, 2));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getUrlFromEnv(key, fallback) {
  const raw = process.env[key]?.trim() || fallback;
  return new URL(raw).toString().replace(/\/$/, '');
}

function getBaseUrlFromEnv(key, fallback) {
  const raw = process.env[key]?.trim() || fallback;
  return raw.replace(/\/+$/, '');
}

function extractMetaContent(html, name) {
  const escapedName = escapeRegExp(name);
  const pattern = new RegExp(
    `<meta[^>]*name=["']${escapedName}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  return html.match(pattern)?.[1]?.trim() ?? null;
}

function extractMainScriptUrl(html, baseUrl) {
  const scripts = [...html.matchAll(/<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*>/gi)];
  const chosen =
    scripts.find((match) => /\/assets\/main-[^"']+\.js$/i.test(match[1]))?.[1] ||
    scripts[0]?.[1] ||
    null;
  return chosen ? new URL(chosen, baseUrl).toString() : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
