import { getApiBaseUrl } from '../api/baseUrl';

export interface ClientErrorReport {
  type: 'error' | 'unhandledrejection';
  message: string;
  source?: string | null;
  line?: number | null;
  column?: number | null;
  stack?: string | null;
}

const MAX_REPORTS_PER_SESSION = 10;
const reported = new Set<string>();

/** Noise that is not WAMP's: extensions, opaque cross-origin scripts, a benign browser warning. */
export function isReportableClientError(report: Pick<ClientErrorReport, 'message' | 'source'>): boolean {
  if (!report.message || report.message === 'Script error.') return false;
  if (/^ResizeObserver loop/.test(report.message)) return false;
  return !/^(chrome|moz|safari|safari-web)-extension:/.test(report.source ?? '');
}

/**
 * Sends an uncaught error home (POST /api/client-errors) so it shows up in Workers Logs.
 * At most ten distinct errors per page load; no account or visitor id is attached.
 */
export function reportClientError(report: ClientErrorReport, win: Window = window): boolean {
  if (import.meta.env.DEV || reported.size >= MAX_REPORTS_PER_SESSION || !isReportableClientError(report)) return false;
  const firstFrame = report.stack?.split('\n').find((line) => line.includes('at ') || line.includes('@')) ?? '';
  const key = `${report.message}|${firstFrame}`;
  if (reported.has(key)) return false;
  reported.add(key);
  const body = JSON.stringify({
    ...report,
    stack: report.stack?.slice(0, 2_000) ?? null,
    build: import.meta.env.VITE_APP_BUILD_ID ?? null,
    route: win.location.pathname,
    appMode: win.document.body?.dataset.appMode ?? null,
    device: win.document.body?.dataset.deviceClass ?? null,
  });
  const url = `${getApiBaseUrl()}/api/client-errors`;
  try {
    // A string body is sent as text/plain, which needs no CORS preflight.
    if (win.navigator.sendBeacon?.(url, body)) return true;
    void win.fetch(url, { method: 'POST', body, keepalive: true, credentials: 'omit' }).catch(() => {});
  } catch {
    // Reporting must never throw from an error handler.
  }
  return true;
}
