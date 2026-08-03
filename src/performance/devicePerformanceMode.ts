export const DEVICE_PERFORMANCE_MODE_STORAGE_KEY = 'wamp.devicePerformanceMode.v1';
export const DEVICE_PERFORMANCE_MODE_STORAGE_VERSION = 1;
export const DEVICE_PERFORMANCE_MODE_CHANGED_EVENT = 'device-performance-mode-changed';

export type DevicePerformanceMode = 'auto' | 'battery-saver' | 'full-quality';

export interface DevicePerformanceModeChange {
  previousMode: DevicePerformanceMode;
  mode: DevicePerformanceMode;
}

type DevicePerformanceModeListener = (change: DevicePerformanceModeChange) => void;

interface StoredDevicePerformanceMode {
  version: typeof DEVICE_PERFORMANCE_MODE_STORAGE_VERSION;
  mode: DevicePerformanceMode;
}

export interface DevicePerformanceModeStoreOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  dispatchChange?: (change: DevicePerformanceModeChange) => void;
}

export class DevicePerformanceModeStore {
  private mode: DevicePerformanceMode;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  private readonly dispatchChange: ((change: DevicePerformanceModeChange) => void) | null;
  private readonly listeners = new Set<DevicePerformanceModeListener>();

  constructor(options: DevicePerformanceModeStoreOptions = {}) {
    this.storage = options.storage === undefined ? getBrowserStorage() : options.storage;
    this.dispatchChange = options.dispatchChange ?? null;
    this.mode = readStoredDevicePerformanceMode(this.storage);
  }

  get(): DevicePerformanceMode {
    return this.mode;
  }

  set(value: unknown): DevicePerformanceMode {
    const nextMode = normalizeDevicePerformanceMode(value);
    if (nextMode === this.mode) {
      return this.mode;
    }

    const change: DevicePerformanceModeChange = {
      previousMode: this.mode,
      mode: nextMode,
    };
    this.mode = nextMode;
    writeStoredDevicePerformanceMode(this.storage, nextMode);
    for (const listener of this.listeners) {
      listener(change);
    }
    this.dispatchChange?.(change);
    return this.mode;
  }

  subscribe(listener: DevicePerformanceModeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export function normalizeDevicePerformanceMode(value: unknown): DevicePerformanceMode {
  return value === 'battery-saver' || value === 'full-quality' ? value : 'auto';
}

export function parseStoredDevicePerformanceMode(rawValue: string | null): DevicePerformanceMode {
  if (rawValue === null) {
    return 'auto';
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<StoredDevicePerformanceMode> | null;
    if (
      !parsed
      || parsed.version !== DEVICE_PERFORMANCE_MODE_STORAGE_VERSION
    ) {
      return 'auto';
    }
    return normalizeDevicePerformanceMode(parsed.mode);
  } catch {
    return 'auto';
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

function readStoredDevicePerformanceMode(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
): DevicePerformanceMode {
  if (!storage) {
    return 'auto';
  }
  try {
    return parseStoredDevicePerformanceMode(storage.getItem(DEVICE_PERFORMANCE_MODE_STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

function writeStoredDevicePerformanceMode(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  mode: DevicePerformanceMode,
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(
      DEVICE_PERFORMANCE_MODE_STORAGE_KEY,
      JSON.stringify({
        version: DEVICE_PERFORMANCE_MODE_STORAGE_VERSION,
        mode,
      } satisfies StoredDevicePerformanceMode),
    );
  } catch {
    // The in-memory choice remains active for this session when storage is unavailable.
  }
}

const devicePerformanceModeStore = new DevicePerformanceModeStore({
  dispatchChange: (change) => {
    if (typeof window === 'undefined') {
      return;
    }
    window.dispatchEvent(new CustomEvent<DevicePerformanceModeChange>(
      DEVICE_PERFORMANCE_MODE_CHANGED_EVENT,
      { detail: change },
    ));
  },
});

export function getDevicePerformanceMode(): DevicePerformanceMode {
  return devicePerformanceModeStore.get();
}

export function setDevicePerformanceMode(value: unknown): DevicePerformanceMode {
  return devicePerformanceModeStore.set(value);
}

export function subscribeDevicePerformanceMode(listener: DevicePerformanceModeListener): () => void {
  return devicePerformanceModeStore.subscribe(listener);
}
