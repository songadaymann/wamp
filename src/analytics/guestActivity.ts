import { getApiBaseUrl } from '../api/baseUrl';
import {
  AUTH_SESSION_REFRESHED_EVENT,
  AUTH_STATE_CHANGED_EVENT,
  getAuthDebugState,
} from '../auth/client';
import { resolveWorldPresenceGuestIdentity, resolveWorldPresenceIdentity } from '../presence/worldPresence';

export type GuestActivityMode = 'browse' | 'play' | 'edit';

export interface GuestActivitySnapshot {
  mode: GuestActivityMode;
  roomCoordinates: { x: number; y: number } | null;
}

const SESSION_STORAGE_KEY = 'ep_guest_visit_session_v1';
const LANDING_STORAGE_KEY = 'ep_guest_visit_landing_v1';
const LINKED_ACCOUNTS_STORAGE_KEY = 'ep_guest_account_links_v1';
const SESSION_SEEN_STORAGE_KEY = 'ep_guest_visit_seen_v1';
const VISIT_IDLE_MS = 30 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 15_000;

let volatileSessionId: string | null = null;
let volatileSessionSeenAt = 0;
let initialized = false;
let sessionReady = false;
let pendingHeartbeat: number | null = null;
let snapshotReader: (() => GuestActivitySnapshot | null) | null = null;

export function initializeGuestActivityTracking(
  getSnapshot: () => GuestActivitySnapshot | null,
): void {
  if (initialized) {
    snapshotReader = getSnapshot;
    return;
  }

  initialized = true;
  snapshotReader = getSnapshot;

  window.addEventListener(AUTH_SESSION_REFRESHED_EVENT, () => {
    sessionReady = true;
    scheduleHeartbeat(0);
    void linkAccountToGuestVisit();
  });
  window.addEventListener(AUTH_STATE_CHANGED_EVENT, () => {
    if (sessionReady) {
      scheduleHeartbeat(0);
    }
    void linkAccountToGuestVisit();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      scheduleHeartbeat(0);
      return;
    }

    void sendHeartbeat(true);
  });
  window.addEventListener('pagehide', () => {
    void sendHeartbeat(true);
  });

  window.setInterval(() => {
    void sendHeartbeat(false);
  }, HEARTBEAT_INTERVAL_MS);
}

function scheduleHeartbeat(delayMs: number): void {
  if (pendingHeartbeat !== null) {
    window.clearTimeout(pendingHeartbeat);
  }

  pendingHeartbeat = window.setTimeout(() => {
    pendingHeartbeat = null;
    void sendHeartbeat(false);
  }, delayMs);
}

async function sendHeartbeat(keepalive: boolean): Promise<void> {
  if (!sessionReady || (!keepalive && document.visibilityState === 'hidden')) {
    return;
  }

  const authState = getAuthDebugState();
  if (authState.loading || authState.authenticated) {
    return;
  }

  const identity = resolveWorldPresenceIdentity();
  if (!identity.userId.startsWith('guest-')) {
    return;
  }

  const snapshot = snapshotReader?.() ?? null;
  const apiBaseUrl = getApiBaseUrl();
  if (import.meta.env.DEV && apiBaseUrl.startsWith('https://')) {
    return;
  }

  const body = {
    sessionId: getGuestVisitSessionId(),
    guestUserId: identity.userId,
    guestDisplayName: identity.displayName,
    mode: snapshot?.mode ?? 'browse',
    roomCoordinates: snapshot?.roomCoordinates ?? null,
    path: `${window.location.pathname}${window.location.search}`,
    landing: getVisitLanding(),
  };

  try {
    await fetch(`${apiBaseUrl}/api/guest-activity/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      credentials: 'omit',
      keepalive,
    });
  } catch {
    // Guest activity is best-effort and must never interrupt play.
  }
}

const SIGNUP_LINK_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const linkAttemptedThisPage = new Set<string>();

/**
 * Once a browser that played as a guest is signed in to a new account (under two days old), tell
 * the server which guest it came from. Tried once per page load until the server answers, so
 * sign-ins finished in another tab (a magic link) are linked too; the server links each account once.
 */
async function linkAccountToGuestVisit(): Promise<void> {
  const authState = getAuthDebugState();
  const accountId = authState.user?.id;
  const createdMs = Date.parse(authState.user?.createdAt ?? '');
  if (!authState.authenticated || !accountId || !Number.isFinite(createdMs) || Date.now() - createdMs > SIGNUP_LINK_WINDOW_MS
    || linkAttemptedThisPage.has(accountId) || readLinkedAccounts().includes(accountId)) return;
  linkAttemptedThisPage.add(accountId);
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/guest-activity/link-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestUserId: resolveWorldPresenceGuestIdentity().userId }),
      credentials: 'include',
    });
    if (response.ok) {
      window.localStorage.setItem(LINKED_ACCOUNTS_STORAGE_KEY, JSON.stringify([...readLinkedAccounts(), accountId].slice(-20)));
    }
  } catch {
    // Attribution is best-effort; the next signed-in load tries again.
  }
}

function readLinkedAccounts(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LINKED_ACCOUNTS_STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

interface VisitLanding { path: string; referrerHost: string | null; source: string | null }
let volatileLanding: VisitLanding | null = null;

/**
 * Where this visit began, read from the original navigation (the game rewrites the address as the
 * player moves) and kept for the tab session. Only the path, the referring site's host and a short
 * source tag (`?from=` or `utm_source`) leave the browser.
 */
export function getVisitLanding(): VisitLanding {
  try {
    const saved = window.sessionStorage.getItem(LANDING_STORAGE_KEY);
    if (saved) return JSON.parse(saved) as VisitLanding;
  } catch {
    // Fall through.
  }
  if (volatileLanding) return volatileLanding;
  const navigation = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
  const url = new URL(navigation?.name || window.location.href);
  let referrerHost: string | null = null;
  try {
    const referrer = document.referrer ? new URL(document.referrer).hostname : '';
    referrerHost = referrer && referrer !== window.location.hostname ? referrer : null;
  } catch {
    referrerHost = null;
  }
  volatileLanding = {
    path: url.pathname,
    referrerHost,
    // The daily room link (and /today) carries from=share for the player; count it as its own source.
    source: url.searchParams.has('daily') ? 'daily' : url.searchParams.get('from') || url.searchParams.get('utm_source') || null,
  };
  try {
    window.sessionStorage.setItem(LANDING_STORAGE_KEY, JSON.stringify(volatileLanding));
  } catch {
    // Best effort.
  }
  return volatileLanding;
}

/**
 * The current visit's id, kept for the tab. A tab left idle for half an hour starts a new visit,
 * so someone who comes back to the same tab the next day counts as returning (F127).
 */
export function getGuestVisitSessionId(): string {
  const now = Date.now();
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    const seenAt = Number(window.sessionStorage.getItem(SESSION_SEEN_STORAGE_KEY) ?? now);
    if (existing && /^[A-Za-z0-9_-]{8,80}$/.test(existing) && now - seenAt < VISIT_IDLE_MS) {
      window.sessionStorage.setItem(SESSION_SEEN_STORAGE_KEY, String(now));
      return existing;
    }
  } catch {
    // Fall through to a new volatile id.
  }

  if (volatileSessionId && now - volatileSessionSeenAt >= VISIT_IDLE_MS) volatileSessionId = null;
  volatileSessionSeenAt = now;
  const next = volatileSessionId ??= createSessionId();
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, next);
    window.sessionStorage.setItem(SESSION_SEEN_STORAGE_KEY, String(now));
  } catch {
    // Ignore storage failures.
  }
  return next;
}

function createSessionId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}
