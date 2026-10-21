import { afterEach, describe, expect, it } from 'vitest';
import { fixture } from '../activity/testDatabase';
import { handleAuthRequest } from './routes';

const opened: ReturnType<typeof fixture>[] = [];
afterEach(() => { for (const f of opened.splice(0)) f.sqlite.close(); });

describe('wallet approval requests (F188)', () => {
  it('limits wallet approvals per network so anonymous requests cannot fill the database', async () => {
    const f = fixture(); opened.push(f);
    const challenge = (ip: string) => {
      const request = new Request('https://api.wamp.land/api/auth/wallet/challenge', {
        method: 'POST', headers: { Origin: 'https://wamp.land', 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
        body: JSON.stringify({ address: '0x00000000000000000000000000000000000000a1' }),
      });
      return handleAuthRequest(request, new URL(request.url), f.env);
    };
    const crossSite = new Request('https://api.wamp.land/api/auth/wallet/challenge', {
      method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.5' },
      body: JSON.stringify({ address: '0x00000000000000000000000000000000000000a1' }),
    });
    await expect(handleAuthRequest(crossSite, new URL(crossSite.url), f.env)).rejects.toMatchObject({ status: 403 });
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM rate_limit_events').get()).toEqual({ n: 0 });
    for (let index = 0; index < 60; index += 1) expect((await challenge('203.0.113.5')).status).toBe(200);
    await expect(challenge('203.0.113.5')).rejects.toMatchObject({ status: 429 });
    expect((await challenge('198.51.100.5')).status).toBe(200);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM wallet_challenges').get()).toEqual({ n: 61 });
  });
});
