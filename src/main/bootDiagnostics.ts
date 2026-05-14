type BootLogLevel = 'info' | 'warn' | 'error';

export interface BootDiagnosticEntry {
  phase: string;
  elapsedMs: number;
  level: BootLogLevel;
  details?: Record<string, unknown>;
}

const MAX_BOOT_ENTRIES = 80;
const bootStartedAt = getNowMs();

let active = true;
let installed = false;
let entries: BootDiagnosticEntry[] = [];

function getNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function getElapsedMs(): number {
  return Math.round(getNowMs() - bootStartedAt);
}

function toDetails(details?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!details || Object.keys(details).length === 0) {
    return undefined;
  }

  return details;
}

function pushEntry(entry: BootDiagnosticEntry): void {
  entries.push(entry);
  if (entries.length > MAX_BOOT_ENTRIES) {
    entries = entries.slice(entries.length - MAX_BOOT_ENTRIES);
  }
}

function printEntry(entry: BootDiagnosticEntry): void {
  const method =
    entry.level === 'error'
      ? console.error
      : entry.level === 'warn'
        ? console.warn
        : console.info;
  const prefix = `[wamp boot] +${entry.elapsedMs}ms ${entry.phase}`;

  if (entry.details) {
    method(prefix, entry.details);
    return;
  }

  method(prefix);
}

export function isBootDiagnosticsActive(): boolean {
  return active;
}

export function logBootPhase(
  phase: string,
  details?: Record<string, unknown>,
  options: { level?: BootLogLevel; force?: boolean } = {}
): void {
  if (!active && !options.force) {
    return;
  }

  const entry: BootDiagnosticEntry = {
    phase,
    elapsedMs: getElapsedMs(),
    level: options.level ?? 'info',
    details: toDetails(details),
  };

  pushEntry(entry);
  printEntry(entry);
}

export function startBootStallWatch(
  label: string,
  timeoutMs: number,
  getDetails?: () => Record<string, unknown>
): () => void {
  if (!active || typeof window === 'undefined') {
    return () => {};
  }

  const startedAt = getNowMs();
  let cancelled = false;
  const timeoutId = window.setTimeout(() => {
    if (cancelled || !active) {
      return;
    }

    const details = getDetails?.() ?? {};
    logBootPhase(
      `still waiting: ${label}`,
      {
        ...details,
        waitedMs: Math.round(getNowMs() - startedAt),
        recentPhases: entries.slice(-8),
      },
      { level: 'warn', force: true }
    );
  }, timeoutMs);

  return () => {
    cancelled = true;
    window.clearTimeout(timeoutId);
  };
}

export function finishBootDiagnostics(details?: Record<string, unknown>): void {
  if (!active) {
    return;
  }

  logBootPhase('app-ready', details);
  active = false;
}

export function getBootDiagnostics(): Record<string, unknown> {
  return {
    active,
    elapsedMs: getElapsedMs(),
    entries: [...entries],
  };
}

export function installBootDiagnosticsGlobal(): void {
  if (installed || typeof window === 'undefined') {
    return;
  }

  installed = true;
  window.get_wamp_boot_debug_state = getBootDiagnostics;

  window.addEventListener('error', (event) => {
    logBootPhase(
      'window-error',
      {
        message: event.message,
        source: event.filename || null,
        line: event.lineno || null,
        column: event.colno || null,
      },
      { level: 'error' }
    );
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    logBootPhase(
      'unhandled-rejection',
      {
        message: reason instanceof Error ? reason.message : String(reason),
        name: reason instanceof Error ? reason.name : null,
      },
      { level: 'error' }
    );
  });

  logBootPhase('diagnostics-installed', {
    path: window.location.pathname,
    searchKeys: Array.from(new URLSearchParams(window.location.search).keys()),
  });
}
