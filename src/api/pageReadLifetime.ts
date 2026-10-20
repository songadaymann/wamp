interface PageReads { controller: AbortController }
const pages = new WeakMap<Window, PageReads>();

/** Stop background reads before WebKit stops the outgoing document's network context. */
export function installPageReadLifecycle(): PageReads | null {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return null;
  const existing = pages.get(window);
  if (existing) return existing;
  const state = { controller: new AbortController() };
  pages.set(window, state);
  const stop = () => state.controller.abort();
  const resume = () => {
    if (state.controller.signal.aborted && !window.document?.hidden) state.controller = new AbortController();
  };
  window.addEventListener('beforeunload', stop);
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', resume);
  // A cancelled draft warning has no pageshow. The next user gesture restores reads.
  for (const event of ['pointerdown', 'keydown']) window.addEventListener(event, resume, { capture: true, passive: true });
  return state;
}

/** Mutations (including draft flushes) retain their existing lifetime and keepalive policy. */
export function fetchWithPageReadLifetime(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const page = ['GET', 'HEAD'].includes(method) && !init.keepalive ? installPageReadLifecycle() : null;
  if (!page) return fetch(input, init);
  const signal = init.signal ? AbortSignal.any([init.signal, page.controller.signal]) : page.controller.signal;
  if (signal.aborted) return Promise.reject(signal.reason);
  return fetch(input, { ...init, signal });
}
