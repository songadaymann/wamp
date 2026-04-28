export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_ROOM_API_BASE_URL?.trim();
  if (configured) {
    return normalizeConfiguredApiBaseUrl(configured);
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return '';
  }

  const hostname = window.location.hostname.toLowerCase();
  if (isSameOriginApiHost(hostname)) {
    return '';
  }

  const metaBase = document
    .querySelector('meta[name="ai-api-base"]')
    ?.getAttribute('content')
    ?.trim();

  if (metaBase) {
    return metaBase.replace(/\/+$/, '');
  }

  const knownProductionApiBase = getKnownProductionApiBase(hostname);
  return knownProductionApiBase ? knownProductionApiBase.replace(/\/+$/, '') : '';
}

function normalizeConfiguredApiBaseUrl(configured: string): string {
  const normalized = configured.replace(/\/+$/, '');
  if (typeof window === 'undefined') {
    return normalized;
  }

  try {
    const apiUrl = new URL(normalized);
    const apiHostname = apiUrl.hostname.toLowerCase();
    const pageHostname = window.location.hostname.toLowerCase();
    if (isLocalLoopbackHost(apiHostname) && isLocalLoopbackHost(pageHostname)) {
      apiUrl.hostname = pageHostname === '::1' ? '[::1]' : window.location.hostname;
      return apiUrl.toString().replace(/\/+$/, '');
    }
  } catch {
    return normalized;
  }

  return normalized;
}

function isSameOriginApiHost(hostname: string): boolean {
  return (
    isLocalLoopbackHost(hostname) ||
    hostname.endsWith('.workers.dev') ||
    hostname === 'api.wamp.land'
  );
}

function isLocalLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

function getKnownProductionApiBase(hostname: string): string {
  if (
    hostname === 'wamp.land' ||
    hostname === 'wampland.pages.dev' ||
    hostname.endsWith('.wampland.pages.dev')
  ) {
    return 'https://api.wamp.land';
  }

  return '';
}
