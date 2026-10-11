/**
 * Wraps an async handler for APIs that expect a plain callback, such as addEventListener.
 * The same wrapped function must be passed to removeEventListener, so wrap where the handler is
 * defined. A rejection still reaches the page's unhandledrejection handler (and the client error
 * report) instead of being silently dropped by a void callback.
 */
export function asyncListener<Args extends unknown[]>(
  handler: (...args: Args) => Promise<unknown>,
): (...args: Args) => void {
  return (...args) => {
    void handler(...args);
  };
}
