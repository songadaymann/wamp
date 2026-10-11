import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

function fakeWindow() {
  const sendBeacon = vi.fn(() => true);
  return { sendBeacon, win: { location: { pathname: '/r/1/2' }, document: { body: { dataset: { appMode: 'play-world', deviceClass: 'phone' } } },
    navigator: { sendBeacon }, fetch: vi.fn() } as unknown as Window };
}

describe('client error reporter (F185)', () => {
  it('sends each distinct error once, at most ten per page load, as a text/plain beacon', async () => {
    vi.stubEnv('DEV', false);
    const { reportClientError } = await import('./clientErrorReporter');
    const { sendBeacon, win } = fakeWindow();
    expect(reportClientError({ type: 'error', message: 'boom', stack: 'Error: boom\n    at a (main.js:1:1)' }, win)).toBe(true);
    expect(reportClientError({ type: 'error', message: 'boom', stack: 'Error: boom\n    at a (main.js:1:1)' }, win)).toBe(false);
    const [, body] = sendBeacon.mock.calls[0] as unknown as [string, string];
    expect(typeof body).toBe('string');
    expect(JSON.parse(body)).toMatchObject({ type: 'error', message: 'boom', route: '/r/1/2', appMode: 'play-world', device: 'phone' });
    for (let index = 0; index < 20; index += 1) reportClientError({ type: 'error', message: `other ${index}` }, win);
    expect(sendBeacon).toHaveBeenCalledTimes(10);
  });

  it('ignores extension errors, opaque script errors and the ResizeObserver warning', async () => {
    vi.stubEnv('DEV', false);
    const { reportClientError } = await import('./clientErrorReporter');
    const { sendBeacon, win } = fakeWindow();
    reportClientError({ type: 'error', message: 'Script error.' }, win);
    reportClientError({ type: 'error', message: 'ResizeObserver loop completed with undelivered notifications.' }, win);
    reportClientError({ type: 'error', message: 'x', source: 'chrome-extension://abc/content.js' }, win);
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
