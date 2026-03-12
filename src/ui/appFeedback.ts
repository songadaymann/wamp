const APP_READY_EVENT = 'wamp:app-ready';

type FeedbackElements = {
  bootRoot: HTMLElement | null;
  bootStatus: HTMLElement | null;
  bootProgressBar: HTMLElement | null;
  bootRetry: HTMLButtonElement | null;
  busyRoot: HTMLElement | null;
  busyTitle: HTMLElement | null;
  busyStatus: HTMLElement | null;
  busySpinner: HTMLElement | null;
  busyRetry: HTMLButtonElement | null;
  busyClose: HTMLButtonElement | null;
};

let elements: FeedbackElements | null = null;
let initialized = false;
let appReady = false;
let bootRetryHandler: (() => void | Promise<void>) | null = null;
let busyRetryHandler: (() => void | Promise<void>) | null = null;
let busyCloseHandler: (() => void | Promise<void>) | null = null;

function getElements(doc: Document = document): FeedbackElements {
  if (elements) {
    return elements;
  }

  elements = {
    bootRoot: doc.getElementById('boot-splash'),
    bootStatus: doc.getElementById('boot-splash-status'),
    bootProgressBar: doc.getElementById('boot-splash-progress-bar'),
    bootRetry: doc.getElementById('btn-boot-retry') as HTMLButtonElement | null,
    busyRoot: doc.getElementById('busy-overlay'),
    busyTitle: doc.getElementById('busy-overlay-title'),
    busyStatus: doc.getElementById('busy-overlay-status'),
    busySpinner: doc.getElementById('busy-overlay-spinner'),
    busyRetry: doc.getElementById('btn-busy-retry') as HTMLButtonElement | null,
    busyClose: doc.getElementById('btn-busy-close') as HTMLButtonElement | null,
  };

  return elements;
}

async function runHandler(handler: (() => void | Promise<void>) | null): Promise<void> {
  if (!handler) {
    return;
  }

  await handler();
}

export function initializeAppFeedback(doc: Document = document): void {
  if (initialized) {
    return;
  }

  const refs = getElements(doc);

  refs.bootRetry?.addEventListener('click', () => {
    void runHandler(bootRetryHandler);
  });

  refs.busyRetry?.addEventListener('click', () => {
    void runHandler(busyRetryHandler);
  });

  refs.busyClose?.addEventListener('click', () => {
    void runHandler(busyCloseHandler);
  });

  doc.body.dataset.appReady = 'false';
  initialized = true;
}

export function isAppReady(): boolean {
  return appReady;
}

export function showBootSplash(status: string, progress = 0): void {
  const refs = getElements();
  refs.bootRoot?.classList.remove('hidden');
  refs.bootRoot?.removeAttribute('data-boot-state');
  refs.bootRetry?.classList.add('hidden');
  setBootStatus(status);
  setBootProgress(progress);
}

export function setBootProgress(progress: number): void {
  const refs = getElements();
  const clamped = Math.max(0, Math.min(1, progress));
  refs.bootProgressBar?.setAttribute('style', `transform: scaleX(${clamped.toFixed(4)})`);
}

export function setBootStatus(status: string): void {
  const refs = getElements();
  if (refs.bootStatus) {
    refs.bootStatus.textContent = status;
  }
}

export function showBootFailure(
  message: string,
  retryHandler: (() => void | Promise<void>) | null = null
): void {
  const refs = getElements();
  refs.bootRoot?.classList.remove('hidden');
  refs.bootRoot?.setAttribute('data-boot-state', 'failed');
  if (refs.bootStatus) {
    refs.bootStatus.textContent = message;
  }
  bootRetryHandler = retryHandler;
  refs.bootRetry?.classList.toggle('hidden', !retryHandler);
}

export function markAppReady(): void {
  if (appReady) {
    return;
  }

  appReady = true;
  const refs = getElements();
  refs.bootRoot?.classList.add('hidden');
  refs.bootRoot?.removeAttribute('data-boot-state');
  document.body.dataset.appReady = 'true';
  window.dispatchEvent(new CustomEvent(APP_READY_EVENT));
}

export function hideBootSplash(): void {
  getElements().bootRoot?.classList.add('hidden');
}

export function showBusyOverlay(title: string, status = 'Please wait...'): void {
  const refs = getElements();
  refs.busyRoot?.classList.remove('hidden');
  refs.busyRoot?.removeAttribute('data-busy-state');
  if (refs.busyTitle) {
    refs.busyTitle.textContent = title;
  }
  if (refs.busyStatus) {
    refs.busyStatus.textContent = status;
  }
  refs.busySpinner?.classList.remove('hidden');
  refs.busyRetry?.classList.add('hidden');
  refs.busyClose?.classList.add('hidden');
  busyRetryHandler = null;
  busyCloseHandler = null;
}

export function updateBusyOverlay(title: string, status = 'Please wait...'): void {
  const refs = getElements();
  if (refs.busyTitle) {
    refs.busyTitle.textContent = title;
  }
  if (refs.busyStatus) {
    refs.busyStatus.textContent = status;
  }
}

export function showBusyError(
  message: string,
  options: {
    retryHandler?: (() => void | Promise<void>) | null;
    closeHandler?: (() => void | Promise<void>) | null;
  } = {}
): void {
  const refs = getElements();
  refs.busyRoot?.classList.remove('hidden');
  refs.busyRoot?.setAttribute('data-busy-state', 'error');
  if (refs.busyTitle) {
    refs.busyTitle.textContent = 'Something went wrong';
  }
  if (refs.busyStatus) {
    refs.busyStatus.textContent = message;
  }
  refs.busySpinner?.classList.add('hidden');
  busyRetryHandler = options.retryHandler ?? null;
  busyCloseHandler = options.closeHandler ?? (() => hideBusyOverlay());
  refs.busyRetry?.classList.toggle('hidden', !busyRetryHandler);
  refs.busyClose?.classList.toggle('hidden', !busyCloseHandler);
}

export function hideBusyOverlay(): void {
  const refs = getElements();
  refs.busyRoot?.classList.add('hidden');
  refs.busyRoot?.removeAttribute('data-busy-state');
  busyRetryHandler = null;
  busyCloseHandler = null;
}

export function isBusyOverlayVisible(): boolean {
  const root = getElements().busyRoot;
  return Boolean(root && !root.classList.contains('hidden'));
}

export function getAppFeedbackDebugState(): Record<string, unknown> {
  const refs = getElements();
  return {
    appReady,
    bootVisible: Boolean(refs.bootRoot && !refs.bootRoot.classList.contains('hidden')),
    busyVisible: Boolean(refs.busyRoot && !refs.busyRoot.classList.contains('hidden')),
    bootState: refs.bootRoot?.getAttribute('data-boot-state') ?? null,
    busyState: refs.busyRoot?.getAttribute('data-busy-state') ?? null,
    bootStatus: refs.bootStatus?.textContent ?? null,
    busyTitle: refs.busyTitle?.textContent ?? null,
    busyStatus: refs.busyStatus?.textContent ?? null,
  };
}

export { APP_READY_EVENT };
