import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from './request';

afterEach(() => vi.unstubAllGlobals());

describe('apiRequest errors', () => {
  it('shows the server\'s plain error message, with the status, instead of the raw JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Incorrect code. Check the email and try again.' }, { status: 400 })));
    const error = await apiRequest('/api/auth/code', { baseUrl: 'https://api.test' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: 'Incorrect code. Check the email and try again.', status: 400 });
  });

  it('keeps plain-text bodies and falls back to the status when the body is empty', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }))
      .mockResolvedValueOnce(new Response('', { status: 503 })));
    await expect(apiRequest('/x', { baseUrl: 'https://api.test' })).rejects.toMatchObject({ message: 'Bad gateway', status: 502 });
    await expect(apiRequest('/x', { baseUrl: 'https://api.test' })).rejects.toMatchObject({ message: 'Request failed with status 503.', status: 503 });
  });
});
