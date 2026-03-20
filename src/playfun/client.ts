import {
  AUTH_STATE_CHANGED_EVENT,
  getAuthDebugState,
  refreshAuthSession,
  type AuthDebugState,
} from '../auth/client';
import { getApiBaseUrl } from '../api/baseUrl';
import {
  appendPlayfunRequestHeaders,
  getPlayfunSessionToken,
  isPlayfunMode,
  setPlayfunMode,
  setPlayfunSessionToken,
} from './state';

export {
  appendPlayfunRequestHeaders,
  getPlayfunSessionToken,
  isPlayfunMode,
} from './state';

export const PLAYFUN_GAME_PAUSE_EVENT = 'playfun-game-pause';
export const PLAYFUN_GAME_RESUME_EVENT = 'playfun-game-resume';

const PLAYFUN_MODE_QUERY_KEY = 'pf';
const PLAYFUN_MODE_SESSION_KEY = 'playfun_mode';
const PLAYFUN_FLUSH_INTERVAL_MS = 60_000;

interface OpenGameSDKInstance {
  init(options?: { gameId?: string }): Promise<unknown>;
  on(eventName: string, callback: (...args: unknown[]) => void): void;
  showPoints?(): void;
  hidePoints?(): void;
  refreshPointsAndMultiplier?(): Promise<unknown>;
  sessionToken?: string;
  playerId?: string;
}

declare global {
  interface Window {
    OpenGameSDK?: new (options?: {
      apiKey?: string;
      gameId?: string;
      logLevel?: 'debug' | 'info' | 'warn' | 'error';
      ui?: {
        usePointsWidget?: boolean;
        useCustomUI?: boolean;
        theme?: 'system' | 'light' | 'dark';
      };
      baseUrl?: string;
    }) => OpenGameSDKInstance;
  }
}

let playfunAuthenticated = false;
let playfunSdkPromise: Promise<OpenGameSDKInstance | null> | null = null;
let playfunSdk: OpenGameSDKInstance | null = null;
let playfunSdkReady = false;
let playfunClientInitialized = false;
let playfunFlushPromise: Promise<{ flushed: number; pending: number; failed: number } | null> | null = null;
let playfunFlushIntervalId: number | null = null;

export function bootstrapPlayfunModeFromUrl(): void {
  if (typeof window === 'undefined') {
    return;
  }

  let nextMode = false;

  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get(PLAYFUN_MODE_QUERY_KEY) === '1') {
      sessionStorage.setItem(PLAYFUN_MODE_SESSION_KEY, '1');
      url.searchParams.delete(PLAYFUN_MODE_QUERY_KEY);
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
      nextMode = true;
    } else {
      nextMode = sessionStorage.getItem(PLAYFUN_MODE_SESSION_KEY) === '1';
    }
  } catch {
    nextMode = false;
  }

  setPlayfunMode(nextMode);
  syncPlayfunBodyData();
}

export function canOpenPlayfunFullSite(): boolean {
  return isPlayfunMode() && isEmbeddedContext();
}

export async function setupPlayfunClient(): Promise<void> {
  if (playfunClientInitialized || typeof window === 'undefined') {
    return;
  }

  playfunClientInitialized = true;
  playfunAuthenticated = getAuthDebugState().authenticated;
  syncPlayfunBodyData();

  const openSiteButton = document.getElementById('btn-playfun-open-site') as HTMLButtonElement | null;
  openSiteButton?.addEventListener('click', () => {
    openPlayfunFullSite();
  });

  syncOpenSiteButton();

  const appModeObserver = new MutationObserver(() => {
    syncPlayfunWidgetVisibility();
  });
  appModeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['data-app-mode'],
  });

  window.addEventListener(AUTH_STATE_CHANGED_EVENT, (event) => {
    const detail = (event as CustomEvent<AuthDebugState | undefined>).detail;
    playfunAuthenticated = detail?.authenticated ?? false;
    if (isPlayfunMode() && playfunAuthenticated) {
      void flushPendingPlayfunPoints();
    }
  });

  if (!isPlayfunMode()) {
    return;
  }

  ensurePlayfunFlushTimer();
  try {
    await ensurePlayfunSdk();
  } catch (error) {
    console.warn('Failed to initialize Play.fun client', error);
  }
}

export async function flushPendingPlayfunPoints(): Promise<{ flushed: number; pending: number; failed: number } | null> {
  if (!isPlayfunMode() || !playfunAuthenticated) {
    return null;
  }

  if (playfunFlushPromise) {
    return playfunFlushPromise;
  }

  playfunFlushPromise = (async () => {
    try {
      const headers = new Headers();
      appendPlayfunRequestHeaders(headers);
      const response = await fetch(`${getApiBaseUrl()}/api/playfun/flush`, {
        method: 'POST',
        credentials: 'include',
        headers,
      });

      if (!response.ok) {
        if (response.status !== 401) {
          console.warn('Failed to flush Play.fun points', await response.text());
        }
        return null;
      }

      const summary = (await response.json()) as {
        flushed?: number;
        pending?: number;
        failed?: number;
      };

      if ((summary.flushed ?? 0) > 0) {
        await refreshPlayfunWidget();
      }

      return {
        flushed: Math.max(0, Number(summary.flushed ?? 0)),
        pending: Math.max(0, Number(summary.pending ?? 0)),
        failed: Math.max(0, Number(summary.failed ?? 0)),
      };
    } catch (error) {
      console.warn('Failed to flush Play.fun points', error);
      return null;
    } finally {
      playfunFlushPromise = null;
    }
  })();

  return playfunFlushPromise;
}

export function notifyPlayfunEligibleActionSuccess(): void {
  if (!isPlayfunMode()) {
    return;
  }

  void (async () => {
    await flushPendingPlayfunPoints();
    await refreshPlayfunWidget();
  })();
}

export async function refreshPlayfunWidget(): Promise<void> {
  if (!isPlayfunMode() || !playfunSdkReady || !playfunSdk?.refreshPointsAndMultiplier) {
    return;
  }

  try {
    await playfunSdk.refreshPointsAndMultiplier();
  } catch (error) {
    console.warn('Failed to refresh Play.fun widget', error);
  }
}

export function openPlayfunFullSite(): void {
  const url = new URL(window.location.href);
  url.searchParams.set(PLAYFUN_MODE_QUERY_KEY, '1');
  window.open(url.toString(), '_top');
}

export function getPlayfunDebugState(): Record<string, unknown> {
  return {
    mode: isPlayfunMode(),
    source: getAuthDebugState().source ?? null,
    authenticated: playfunAuthenticated,
    sdkReady: playfunSdkReady,
    hasSessionToken: Boolean(getPlayfunSessionToken()),
    embedded: isEmbeddedContext(),
  };
}

async function ensurePlayfunSdk(): Promise<OpenGameSDKInstance | null> {
  if (!isPlayfunMode()) {
    return null;
  }

  if (playfunSdkPromise) {
    return playfunSdkPromise;
  }

  playfunSdkPromise = (async () => {
    if (!window.OpenGameSDK) {
      console.warn('Play.fun SDK not loaded — is the script tag in <head>?');
      return null;
    }

    const sdk = new window.OpenGameSDK({
      ui: {
        usePointsWidget: true,
      },
      logLevel: 'warn',
    });

    sdk.on('OnReady', (...args: unknown[]) => {
      console.log('[Play.fun] OnReady fired', {
        sessionToken: sdk.sessionToken,
        playerId: sdk.playerId,
        args,
        sdkKeys: Object.keys(sdk),
      });
      playfunSdkReady = true;
      capturePlayfunSessionToken();
      syncPlayfunWidgetVisibility();
      void refreshAuthSession();
      if (playfunAuthenticated) {
        void flushPendingPlayfunPoints();
      }
    });
    sdk.on('LoginSuccess', (...args: unknown[]) => {
      console.log('[Play.fun] LoginSuccess fired', {
        sessionToken: sdk.sessionToken,
        playerId: sdk.playerId,
        args,
      });
      capturePlayfunSessionToken();
      void refreshAuthSession();
      void flushPendingPlayfunPoints();
    });
    sdk.on('SessionStarted', (...args: unknown[]) => {
      console.log('[Play.fun] SessionStarted fired', {
        sessionToken: sdk.sessionToken,
        playerId: sdk.playerId,
        args,
      });
      capturePlayfunSessionToken();
      void refreshAuthSession();
      void flushPendingPlayfunPoints();
    });
    sdk.on('GamePause', () => {
      window.dispatchEvent(new Event(PLAYFUN_GAME_PAUSE_EVENT));
    });
    sdk.on('GameResume', () => {
      window.dispatchEvent(new Event(PLAYFUN_GAME_RESUME_EVENT));
    });

    await sdk.init();

    console.log('[Play.fun] SDK initialized', {
      sessionToken: sdk.sessionToken,
      playerId: sdk.playerId,
      sdkKeys: Object.keys(sdk),
      sdkPrototypeKeys: Object.getOwnPropertyNames(Object.getPrototypeOf(sdk)),
    });

    playfunSdk = sdk;
    capturePlayfunSessionToken();
    syncPlayfunWidgetVisibility();
    void refreshAuthSession();
    return sdk;
  })();

  return playfunSdkPromise;
}

function capturePlayfunSessionToken(): void {
  setPlayfunSessionToken(playfunSdk?.sessionToken?.trim() || null);
}

function syncPlayfunWidgetVisibility(): void {
  if (!isPlayfunMode() || !playfunSdkReady || !playfunSdk) {
    return;
  }

  const appMode = document.body.dataset.appMode ?? '';
  const shouldShow = appMode !== 'editor';

  try {
    if (shouldShow) {
      playfunSdk.showPoints?.();
    } else {
      playfunSdk.hidePoints?.();
    }
  } catch (error) {
    console.warn('Failed to update Play.fun widget visibility', error);
  }
}

function syncOpenSiteButton(): void {
  const button = document.getElementById('btn-playfun-open-site');
  if (!button) {
    return;
  }

  button.classList.toggle('hidden', !canOpenPlayfunFullSite());
}

function ensurePlayfunFlushTimer(): void {
  if (playfunFlushIntervalId !== null) {
    return;
  }

  playfunFlushIntervalId = window.setInterval(() => {
    if (isPlayfunMode() && playfunAuthenticated) {
      void flushPendingPlayfunPoints();
    }
  }, PLAYFUN_FLUSH_INTERVAL_MS);
}

function syncPlayfunBodyData(): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.body.dataset.playfunMode = isPlayfunMode() ? 'true' : 'false';
  document.body.dataset.playfunEmbedded = isPlayfunMode() && isEmbeddedContext() ? 'true' : 'false';
}

function isEmbeddedContext(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

