import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildTutorialAccountReturnUrl,
  requestEmailMagicLink,
} from './emailMagicLink';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestEmailMagicLink', () => {
  it('normalizes the email and preserves an explicit tutorial return URL', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      delivery: 'email',
      purpose: 'sign_in',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await expect(requestEmailMagicLink(
      '  NewPlayer@Example.com ',
      { returnTo: 'https://wamp.land/r/4/5' },
    )).resolves.toMatchObject({ ok: true, delivery: 'email' });

    expect(fetch).toHaveBeenCalledOnce();
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'newplayer@example.com',
      returnTo: 'https://wamp.land/r/4/5',
    });
  });

  it('rejects an invalid address before making a request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(requestEmailMagicLink('not-an-email'))
      .rejects.toThrow('Please enter a valid email address.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('removes replay and stale auth flags without losing the current room route', () => {
    expect(buildTutorialAccountReturnUrl(
      'https://wamp.land/r/4/5?tutorial=replay&auth=invalid&view=world',
    )).toBe('https://wamp.land/r/4/5?view=world');
  });
});
