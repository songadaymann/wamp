import { afterEach, describe, expect, it } from 'vitest';
import type { LaunchFunnelResponse } from '../../../admin/model';
import { fixture } from '../activity/testDatabase';
import { createSession } from '../auth/store';
import { handleGuestActivityHeartbeat, handleGuestActivityLinkAccount } from '../guestActivity/routes';
import { handleAdminLaunchFunnel } from './launchFunnel';

const opened: ReturnType<typeof fixture>[] = [];
function setup() { const f = fixture(); f.env.ADMIN_API_KEY = 'test-admin-key'; opened.push(f); return f; }
afterEach(() => { for (const f of opened.splice(0)) f.sqlite.close(); });

const guestA = 'guest-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const guestB = 'guest-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function heartbeat(f: ReturnType<typeof fixture>, body: Record<string, unknown>, agent = 'Mozilla/5.0 (Macintosh)') {
  const request = new Request('https://api.wamp.land/api/guest-activity/heartbeat', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://wamp.land', 'User-Agent': agent },
    body: JSON.stringify({ guestDisplayName: 'Guest', mode: 'browse', path: '/', ...body }),
  });
  return handleGuestActivityHeartbeat(request, f.env);
}

describe('visit attribution (F127)', () => {
  it('keeps the first landing path, referring host and source tag, and never a query string', async () => {
    const f = setup();
    await heartbeat(f, { sessionId: 'session-a1', guestUserId: guestA,
      landing: { path: '/auth/verify?token=secret#x', referrerHost: 'www.Reddit.com', source: 'Share' } });
    await heartbeat(f, { sessionId: 'session-a1', guestUserId: guestA, landing: { path: '/r/1/1', referrerHost: 'evil.example', source: 'x' } });
    await heartbeat(f, { sessionId: 'session-b1', guestUserId: guestB, landing: { path: '/', referrerHost: 'not a host/', source: 'bad source!' } });
    expect(f.sqlite.prepare('SELECT first_landing_path, first_referrer_host, first_source FROM guest_visits ORDER BY session_id').all()).toEqual([
      { first_landing_path: '/auth/verify', first_referrer_host: 'reddit.com', first_source: 'share' },
      { first_landing_path: '/', first_referrer_host: null, first_source: null },
    ]);
  });

  it('links a new account to the guest visit it came from, once', async () => {
    const f = setup();
    await heartbeat(f, { sessionId: 'session-a1', guestUserId: guestA, landing: { path: '/', referrerHost: 'reddit.com' } });
    f.sqlite.prepare("UPDATE users SET created_at = ? WHERE id = 'p1'").run(new Date().toISOString());
    const link = async (user: string, guestUserId: string) => {
      const session = await createSession(f.env, user);
      const request = new Request('https://api.wamp.land/api/guest-activity/link-account', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://wamp.land', Cookie: `ep_session=${session}` },
        body: JSON.stringify({ guestUserId }),
      });
      return (await handleGuestActivityLinkAccount(request, f.env)).json() as Promise<{ linked: boolean }>;
    };
    expect(await link('p1', guestA)).toEqual({ linked: true });
    expect(await link('p1', guestB)).toEqual({ linked: false });
    expect(await link('p2', guestA)).toEqual({ linked: false });
    expect(f.sqlite.prepare("SELECT signup_guest_user_id, signup_source FROM users WHERE id = 'p1'").get())
      .toEqual({ signup_guest_user_id: guestA, signup_source: 'reddit.com' });
  });

  it('follows new guests through play, building, sign-up and publishing, by source', async () => {
    const f = setup();
    await heartbeat(f, { sessionId: 'session-a1', guestUserId: guestA, landing: { path: '/', source: 'share' } }, 'Mozilla/5.0 (iPhone)');
    await heartbeat(f, { sessionId: 'session-b1', guestUserId: guestB, landing: { path: '/' } });
    f.sqlite.exec(`UPDATE guest_visits SET play_seconds = 30, edit_seconds = 5 WHERE guest_user_id = '${guestA}';
      UPDATE users SET signup_guest_user_id = '${guestA}' WHERE id IN ('builder', 'p1');`);
    const request = new Request('https://api.wamp.land/api/admin/launch-funnel?days=7', { headers: { 'x-admin-key': 'test-admin-key' } });
    const funnel = await (await handleAdminLaunchFunnel(request, new URL(request.url), f.env)).json() as LaunchFunnelResponse;
    expect(funnel.steps).toEqual({ visitors: 2, played: 1, built: 1, cleared: 0, signedUp: 1, published: 1 });
    expect(funnel.phoneVisitors).toBe(1);
    expect(funnel.sources).toEqual(expect.arrayContaining([
      { source: 'share', visitors: 1, played: 1, built: 1, signedUp: 1 },
      { source: 'direct', visitors: 1, played: 0, built: 0, signedUp: 0 },
    ]));
    await expect(handleAdminLaunchFunnel(new Request('https://api.wamp.land/api/admin/launch-funnel?days=3',
      { headers: { 'x-admin-key': 'test-admin-key' } }), new URL('https://api.wamp.land/api/admin/launch-funnel?days=3'), f.env))
      .rejects.toMatchObject({ status: 400 });
  });

  it('counts only first visits by people, and a return only as a later, separate visit', async () => {
    const f = setup();
    const day = 24 * 60 * 60 * 1000;
    const at = (daysAgo: number, hours = 0) => new Date(Date.now() - daysAgo * day + hours * 60 * 60 * 1000).toISOString();
    const visit = (session: string, guest: string, first: string, last: string, extra = '') => f.sqlite.exec(`INSERT INTO guest_visits
      (session_id, guest_user_id, guest_display_name, first_seen_at, last_seen_at, mode, user_agent, first_landing_path${extra ? ', first_source' : ''})
      VALUES ('${session}', '${guest}', 'Guest', '${first}', '${last}', 'browse', 'Mozilla/5.0 (Macintosh)', '/'${extra ? `, '${extra}'` : ''})`);
    const guest = (n: number) => `guest-${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
    visit('s1', guest(1), at(10), at(10, 1));
    visit('s1b', guest(1), at(9), at(9, 1));         // came back the next day, in a new visit
    visit('s2', guest(2), at(10, 23.5), at(9, 0.5)); // one sitting across midnight is not a return
    visit('s3', guest(3), at(12), at(12, 1));
    visit('s3b', guest(3), at(8), at(8, 1));         // came back within the week, not the next day
    visit('s4', guest(4), at(40), at(40, 1));
    visit('s4b', guest(4), at(1), at(1, 1));         // first visit is outside the window
    visit('s5', guest(5), at(1), at(1, 1), 'reddit');
    f.sqlite.exec(`INSERT INTO guest_visits (session_id, guest_user_id, guest_display_name, first_seen_at, last_seen_at, mode, user_agent)
      VALUES ('s6', '${guest(6)}', 'Guest', '${at(1)}', '${at(1)}', 'browse', 'Mozilla/5.0 (Linux; Android 6.0.1) Googlebot/2.1'),
             ('s7', '${guest(7)}', 'Guest', '${at(1)}', '${at(1)}', 'browse', 'Mozilla/5.0 (Macintosh)')`);
    const load = async (days: number) => {
      const request = new Request(`https://api.wamp.land/api/admin/launch-funnel?days=${days}`, { headers: { 'x-admin-key': 'test-admin-key' } });
      return (await handleAdminLaunchFunnel(request, new URL(request.url), f.env)).json() as Promise<LaunchFunnelResponse>;
    };
    const week = await load(7);
    expect(week.steps.visitors).toBe(2);
    expect(week.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'reddit', visitors: 1 }), expect.objectContaining({ source: 'unknown', visitors: 1 }),
    ]));
    expect(week.returns).toEqual({ d1: { eligible: 3, returned: 1 }, d7: { eligible: 3, returned: 2 } });
    const month = await load(30);
    expect(month.steps.visitors).toBe(5);
  });
});
