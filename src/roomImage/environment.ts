import type { RoomImageEnvironment } from './types';
const DEFAULT_API_BASE_URL = 'https://api.wamp.land';

export function resolveApiBaseUrl(env: RoomImageEnvironment, url: URL): string {
  const configured = typeof env.ROOM_SHARE_API_BASE_URL === 'string'
    ? env.ROOM_SHARE_API_BASE_URL.trim()
    : '';
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return `${url.protocol}//${url.hostname}:8787`;
  }

  return DEFAULT_API_BASE_URL;
}

