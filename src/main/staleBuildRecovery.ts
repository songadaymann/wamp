import { reportClientError } from './clientErrorReporter';

/** Fired by code that loads its own files (the editor stylesheet) when one fails to download. */
export const STALE_ASSET_EVENT = 'wamp:stale-asset';

const ENTRY_CHECK_TIMEOUT_MS = 5_000;
const OFFER_RETRY_MS = 1_000;
const OFFER_RETRY_LIMIT = 120;

interface StaleBuildRecoveryOptions {
  /** True when the reload card would not cover a save in progress or a question being asked. */
  canShowOffer: () => boolean;
  showReloadOffer: () => void;
  win?: Pick<Window, 'addEventListener' | 'setTimeout'>;
  doc?: Pick<Document, 'querySelector'>;
  fetchImpl?: typeof fetch;
  buildId?: string;
  report?: (message: string) => void;
}

export interface StaleBuildRecoveryDebugState {
  failures: number;
  confirmedStale: boolean;
  offersShown: number;
}

/**
 * Each release replaces the files the game downloads on demand (the editor, most menus), so a tab
 * opened before a release can't load them (F374). When such a download fails, this checks whether
 * the tab's own build is gone (its entry script answers 404) rather than the network being down,
 * and if so offers a reload. It never reloads by itself: from outside it can't tell whether a
 * draft, run result or message is still unsaved.
 *
 * The failed import is never swallowed (no preventDefault), so its caller resets as usual. The
 * offer waits until the busy card is free, so it never covers a save or a choice.
 */
export function installStaleBuildRecovery(options: StaleBuildRecoveryOptions): { getDebugState(): StaleBuildRecoveryDebugState } {
  const win = options.win ?? window;
  const doc = options.doc ?? document;
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const buildId = options.buildId ?? import.meta.env.VITE_APP_BUILD_ID ?? 'unknown';
  const report = options.report ?? ((message: string) => { reportClientError({ type: 'error', message }); });
  const state: StaleBuildRecoveryDebugState = { failures: 0, confirmedStale: false, offersShown: 0 };
  let checking: Promise<void> | null = null;
  let offering = false;

  const offerWhenFree = (attempt = 0): void => {
    if (options.canShowOffer()) {
      offering = false;
      state.offersShown += 1;
      options.showReloadOffer();
    } else if (attempt < OFFER_RETRY_LIMIT) {
      win.setTimeout(() => offerWhenFree(attempt + 1), OFFER_RETRY_MS);
    } else {
      offering = false;
    }
  };
  const scheduleOffer = (): void => {
    if (offering) return;
    offering = true;
    // Let the caller show its own error first, then replace it with the offer.
    win.setTimeout(() => offerWhenFree(), 0);
  };

  const onFailure = (event: Event): void => {
    state.failures += 1;
    if (state.confirmedStale) {
      scheduleOffer();
      return;
    }
    checking ??= confirmStale(event).finally(() => { checking = null; });
  };

  async function confirmStale(event: Event): Promise<void> {
    const entry = doc.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
    if (!entry) return;
    try {
      const response = await fetchImpl(entry, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(ENTRY_CHECK_TIMEOUT_MS) });
      if (response.status !== 404) return;
    } catch {
      return; // Offline, slow or a network blip: the caller's own error and retry are right.
    }
    state.confirmedStale = true;
    const payload = (event as Event & { payload?: unknown }).payload ?? (event as CustomEvent).detail;
    report(`Stale build ${buildId}: ${payload instanceof Error ? payload.message : String(payload ?? event.type)}`);
    scheduleOffer();
  }

  win.addEventListener('vite:preloadError', onFailure);
  win.addEventListener(STALE_ASSET_EVENT, onFailure);
  return { getDebugState: () => ({ ...state }) };
}
