export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_ROOM_API_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
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

  return metaBase ? metaBase.replace(/\/+$/, '') : '';
}

function isSameOriginApiHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.workers.dev') ||
    hostname === 'api.wamp.land'
  );
}
