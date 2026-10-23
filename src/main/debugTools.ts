import type Phaser from 'phaser';
import type { MobilePerformanceProfiler, MobilePerformanceProfilerOptions } from '../debug/mobilePerformanceProfiler';

// The resource logger and the phone profiler are developer tools switched on by the web
// address. They download only when that switch is on, so players never pay for them at
// startup (F319). Their window hooks stay, and scripts/check_bundle_budget.mjs keeps the
// tools themselves out of the startup download.

type ResourceDebugModule = typeof import('./resourceDebug');
type MobilePerformanceProfilerModule = typeof import('../debug/mobilePerformanceProfiler');

export const RESOURCE_DEBUG_STORAGE_KEY = 'wamp_resource_debug_enabled_v1';

/** One download per tool, shared by every caller. A failed download can be retried. */
export class LazyDebugModule<T> {
  private module: T | null = null;
  private loading: Promise<T> | null = null;

  constructor(private readonly load: () => Promise<T>) {}

  /** The tool once it has downloaded, for callers that must stay synchronous. */
  get current(): T | null {
    return this.module;
  }

  ensure(): Promise<T> {
    this.loading ??= this.load().then(
      (module) => {
        this.module = module;
        return module;
      },
      (error: unknown) => {
        this.loading = null;
        throw error;
      },
    );
    return this.loading;
  }
}

const resourceDebugTool = new LazyDebugModule<ResourceDebugModule>(() => import('./resourceDebug'));
const mobilePerformanceProfilerTool = new LazyDebugModule<MobilePerformanceProfilerModule>(
  () => import('../debug/mobilePerformanceProfiler'),
);

export function isTruthySearchValue(value: string | null): boolean {
  if (value === null) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '' || ['1', 'true', 'yes', 'on'].includes(normalized);
}

/** `?mobilePerf` or `?perf` turns on the phone profiler. */
export function isMobilePerformanceProfilerEnabled(search: string = window.location.search): boolean {
  const params = new URLSearchParams(search);
  return isTruthySearchValue(params.get('mobilePerf')) || isTruthySearchValue(params.get('perf'));
}

/**
 * `?resourceDebug=1` turns the resource logger on and remembers it on this device; any
 * `?resourceDebug` value loads it, because `?resourceDebug=0` is how the saved switch is cleared.
 */
export function isResourceDebugRequested(
  query: URLSearchParams,
  readSavedSwitch: () => string | null = () => window.localStorage.getItem(RESOURCE_DEBUG_STORAGE_KEY),
): boolean {
  if (query.has('resourceDebug')) {
    return true;
  }
  try {
    return readSavedSwitch() === '1';
  } catch {
    return false;
  }
}

interface ResourceDebugToolOptions {
  target?: Pick<Window, 'get_wamp_resource_debug'>;
  readSavedSwitch?: () => string | null;
  tool?: LazyDebugModule<ResourceDebugModule>;
}

/**
 * Keeps `window.get_wamp_resource_debug` for the console and scripts (it now answers with a
 * promise, which `page.evaluate` awaits) and starts the resource logger when it is switched on.
 */
export function installResourceDebugTools(
  game: Phaser.Game,
  query: URLSearchParams,
  getFrameCadence: () => unknown,
  options: ResourceDebugToolOptions = {},
): void {
  const tool = options.tool ?? resourceDebugTool;
  const target = options.target ?? window;
  target.get_wamp_resource_debug = async () => ({
    ...(await tool.ensure()).getRuntimeResourceDebugState(game),
    frameCadence: getFrameCadence(),
  });
  if (!isResourceDebugRequested(query, options.readSavedSwitch)) {
    return;
  }
  void tool.ensure().then(
    ({ installRuntimeResourceDebugLogger }) => {
      installRuntimeResourceDebugLogger(game, query);
    },
    (error: unknown) => {
      console.warn('[wamp-resource-debug] The resource logger could not load.', error);
    },
  );
}

interface MobilePerformanceProfilerToolOptions {
  search?: string;
  tool?: LazyDebugModule<MobilePerformanceProfilerModule>;
}

/** Starts the profiler download at boot, so it has usually arrived before the play scene starts. */
export function preloadMobilePerformanceProfiler(options: MobilePerformanceProfilerToolOptions = {}): void {
  if (!isMobilePerformanceProfilerEnabled(options.search)) {
    return;
  }
  void (options.tool ?? mobilePerformanceProfilerTool).ensure().catch(warnProfilerUnavailable);
}

/**
 * Creates the phone profiler when it is switched on. If its download has finished (the usual
 * case, since boot starts it), `onReady` runs before this returns, so the scene measures its
 * first frame. Otherwise it runs when the download arrives. The returned function cancels a
 * creation that has not happened yet.
 */
export function requestMobilePerformanceProfiler(
  profilerOptions: MobilePerformanceProfilerOptions,
  onReady: (profiler: MobilePerformanceProfiler) => void,
  options: MobilePerformanceProfilerToolOptions = {},
): () => void {
  if (!isMobilePerformanceProfilerEnabled(options.search)) {
    return () => {};
  }
  const tool = options.tool ?? mobilePerformanceProfilerTool;
  let cancelled = false;
  const create = ({ createMobilePerformanceProfiler }: MobilePerformanceProfilerModule): void => {
    const profiler = cancelled ? null : createMobilePerformanceProfiler(profilerOptions);
    if (profiler) {
      onReady(profiler);
    }
  };
  if (tool.current) {
    create(tool.current);
  } else {
    void tool.ensure().then(create, warnProfilerUnavailable);
  }
  return () => {
    cancelled = true;
  };
}

function warnProfilerUnavailable(error: unknown): void {
  console.warn('[wamp-mobile-perf] The profiler could not load.', error);
}
