export const PERFORMANCE_ADVISOR_COOLDOWN_STORAGE_KEY = 'wamp.performanceAdvisor.cooldown.v1';
export const PERFORMANCE_ADVISOR_COOLDOWN_STORAGE_VERSION = 1;
export const PERFORMANCE_ADVISOR_DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1_000;

interface StoredPerformanceAdvisorCooldown {
  version: typeof PERFORMANCE_ADVISOR_COOLDOWN_STORAGE_VERSION;
  dismissedUntilMs: number;
}

export class PerformanceAdvisorCooldownStore {
  private dismissedUntilMs: number;

  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = getBrowserStorage(),
  ) {
    this.dismissedUntilMs = readCooldown(this.storage);
  }

  isCoolingDown(nowMs: number): boolean {
    return normalizeTime(nowMs) < this.dismissedUntilMs;
  }

  dismiss(nowMs: number): number {
    this.dismissedUntilMs = normalizeTime(nowMs) + PERFORMANCE_ADVISOR_DISMISS_COOLDOWN_MS;
    writeCooldown(this.storage, this.dismissedUntilMs);
    return this.dismissedUntilMs;
  }

  getDismissedUntilMs(): number {
    return this.dismissedUntilMs;
  }
}

export function parsePerformanceAdvisorCooldown(rawValue: string | null): number {
  if (rawValue === null) {
    return 0;
  }
  try {
    const parsed = JSON.parse(rawValue) as Partial<StoredPerformanceAdvisorCooldown> | null;
    if (
      !parsed
      || parsed.version !== PERFORMANCE_ADVISOR_COOLDOWN_STORAGE_VERSION
      || typeof parsed.dismissedUntilMs !== 'number'
      || !Number.isFinite(parsed.dismissedUntilMs)
      || parsed.dismissedUntilMs < 0
    ) {
      return 0;
    }
    return parsed.dismissedUntilMs;
  } catch {
    return 0;
  }
}

function getBrowserStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readCooldown(storage: Pick<Storage, 'getItem' | 'setItem'> | null): number {
  if (!storage) {
    return 0;
  }
  try {
    return parsePerformanceAdvisorCooldown(
      storage.getItem(PERFORMANCE_ADVISOR_COOLDOWN_STORAGE_KEY),
    );
  } catch {
    return 0;
  }
}

function writeCooldown(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  dismissedUntilMs: number,
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(PERFORMANCE_ADVISOR_COOLDOWN_STORAGE_KEY, JSON.stringify({
      version: PERFORMANCE_ADVISOR_COOLDOWN_STORAGE_VERSION,
      dismissedUntilMs,
    } satisfies StoredPerformanceAdvisorCooldown));
  } catch {
    // The in-memory cooldown still protects this session when storage is unavailable.
  }
}

function normalizeTime(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export const performanceAdvisorCooldownStore = new PerformanceAdvisorCooldownStore();
