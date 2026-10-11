import { describe, expect, it } from 'vitest';
import { DEFAULT_JSON_BODY_MAX_BYTES, HttpError, parseJsonBody } from './http';

function post(body: string, headers: Record<string, string> = {}) {
  return new Request('https://api.wamp.land/api/x', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...headers } });
}
async function statusOf(promise: Promise<unknown>): Promise<number | 'ok'> {
  return promise.then(() => 'ok' as const, (error: unknown) => (error instanceof HttpError ? error.status : -1));
}

describe('JSON request body limits (F051)', () => {
  it('parses an ordinary body', async () => {
    await expect(parseJsonBody<{ a: number }>(post('{"a":1}'))).resolves.toEqual({ a: 1 });
  });

  it('refuses a body over the default cap with 413, by declared length or by actual bytes', async () => {
    const huge = `{"pad":"${'x'.repeat(DEFAULT_JSON_BODY_MAX_BYTES)}"}`;
    expect(await statusOf(parseJsonBody(post(huge)))).toBe(413);
    const lying = new Request('https://api.wamp.land/api/x', {
      method: 'POST',
      body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(huge)); controller.close(); } }),
      duplex: 'half',
    } as RequestInit);
    expect(await statusOf(parseJsonBody(lying))).toBe(413);
  });

  it('accepts a 1 MB body under the default cap, and an explicit tighter cap wins', async () => {
    const megabyte = `{"pad":"${'x'.repeat(1_000_000)}"}`;
    expect(await statusOf(parseJsonBody(post(megabyte)))).toBe('ok');
    expect(await statusOf(parseJsonBody(post(megabyte), { maxBytes: 16_384 }))).toBe(413);
  });

  it('still answers 400 for invalid JSON', async () => {
    expect(await statusOf(parseJsonBody(post('{not json')))).toBe(400);
    expect(await statusOf(parseJsonBody(post('')))).toBe(400);
  });
});
