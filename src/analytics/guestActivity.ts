import { getApiBaseUrl } from '../api/baseUrl';
import {
  AUTH_SESSION_REFRESHED_EVENT,
  AUTH_STATE_CHANGED_EVENT,
  getAuthDebugState,
} from '../auth/client';
import { resolveWorldPresenceIdentity } from '../presence/worldPresence';

export type GuestActivityMode = 'browse' | 'play' | 'edit';

export interface GuestActivitySnapshot {
  mode: GuestActivityMode;
  roomCoordinates: { x: number; y: number } | null;
}

const SESSION_STORAGE_KEY = 'ep_guest_visit_session_v1';
const HEARTBEAT_INTERVAL_MS = 15_000;

let initialized = false;
let sessionReady = false;
let heartbeatTimer: number | null = null;
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
  });
  window.addEventListener(AUTH_STATE_CHANGED_EVENT, () => {
    if (sessionReady) {
      scheduleHeartbeat(0);
    }
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

  heartbeatTimer = window.setInterval(() => {
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

export function getGuestVisitSessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing && /^[A-Za-z0-9_-]{8,80}$/.test(existing)) {
      return existing;
    }
  } catch {
    // Fall through to a new volatile id.
  }

  const next = createSessionId();
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, next);
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

export function stopGuestActivityTracking(): void {
  if (heartbeatTimer !== null) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (pendingHeartbeat !== null) {
    window.clearTimeout(pendingHeartbeat);
    pendingHeartbeat = null;
  }
  initialized = false;
  sessionReady = false;
  snapshotReader = null;
}
