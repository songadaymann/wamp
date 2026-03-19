const PLAYFUN_MODE_KEY = 'playfun_mode';
const PLAYFUN_SESSION_TOKEN_KEY = 'playfun_session_token';

let playfunMode = false;
let playfunSessionToken: string | null = null;

declare global {
  interface Window {
    __WAMP_PLAYFUN_MODE__?: boolean;
    __WAMP_PLAYFUN_SESSION_TOKEN__?: string | null;
  }
}

export function setPlayfunMode(nextMode: boolean): void {
  playfunMode = nextMode;
  if (typeof window !== 'undefined') {
    window.__WAMP_PLAYFUN_MODE__ = nextMode;
  }
}

export function isPlayfunMode(): boolean {
  return playfunMode;
}

export function setPlayfunSessionToken(token: string | null): void {
  playfunSessionToken = token?.trim() || null;
  if (typeof window !== 'undefined') {
    window.__WAMP_PLAYFUN_SESSION_TOKEN__ = playfunSessionToken;
  }
}

export function getPlayfunSessionToken(): string | null {
  return playfunSessionToken;
}

export function appendPlayfunRequestHeaders(headers: Headers): void {
  if (!playfunMode || !playfunSessionToken) {
    return;
  }

  headers.set('X-Playfun-Session-Token', playfunSessionToken);
}

export function syncPlayfunGlobalsFromWindow(): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (typeof window.__WAMP_PLAYFUN_MODE__ === 'boolean') {
    playfunMode = window.__WAMP_PLAYFUN_MODE__;
  }
  if (typeof window.__WAMP_PLAYFUN_SESSION_TOKEN__ === 'string' || window.__WAMP_PLAYFUN_SESSION_TOKEN__ === null) {
    playfunSessionToken = window.__WAMP_PLAYFUN_SESSION_TOKEN__ ?? null;
  }
}

export const PLAYFUN_SHARED_KEYS = {
  mode: PLAYFUN_MODE_KEY,
  sessionToken: PLAYFUN_SESSION_TOKEN_KEY,
} as const;
