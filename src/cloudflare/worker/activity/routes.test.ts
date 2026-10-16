import { afterEach, describe, expect, it } from 'vitest';
import { handleAllActivity, handleMyActivity } from './routes';
import { award, fixture, guestClear, top1 } from './testDatabase';
import { createSession } from '../auth/store';
const opened: ReturnType<typeof fixture>[] = [];
afterEach(() => { for (const f of opened.splice(0)) f.sqlite.close(); });
describe('community activity API', () => {
  it('serves guest activity through a public event reference without exposing the browser identity', async () => {
    const f = fixture(); opened.push(f); guestClear(f, 'g1');
    const listUrl = new URL('https://api.wamp.land/api/activity');
    const list = await (await handleAllActivity(new Request(listUrl), listUrl, f.env)).json() as { entries: { guestActivityRef: number }[] };
    const url = new URL(`https://api.wamp.land/api/activity?guest=${list.entries[0].guestActivityRef}`);
    const response = await handleAllActivity(new Request(url), url, f.env);
    const data = await response.json() as { entries: unknown[]; guestName: string };
    expect(data.entries).toHaveLength(1); expect(data.guestName).toMatch(/^Guest /);
    expect(JSON.stringify(data)).not.toContain('guest-fixture');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it.each(['0', '-1', 'NaN', '1.5', '9007199254740992', 'guest-private', ''])('rejects invalid guest reference %s', async guest => {
    const f = fixture(); opened.push(f);
    const url = new URL(`https://api.wamp.land/api/activity?guest=${guest}`);
    await expect(handleAllActivity(new Request(url), url, f.env)).rejects.toMatchObject({ status: 400 });
  });
  it('keeps someone else’s room leaderboard alert out of My activity', async () => {
    const f = fixture(); opened.push(f); top1(f, 'rank', 'p1');
    const token = await createSession(f.env, 'p1');
    const url = new URL('https://api.wamp.land/api/me/activity');
    const response = await handleMyActivity(new Request(url, { headers: { Cookie: `ep_session=${token}` } }), url, f.env);
    expect(await response.json()).toMatchObject({ entries: [], unreadCount: 0, latestId: 0 });
  });
  it('serves published events without a session or private preferences', async () => {
    const f = fixture(); opened.push(f); award(f, 'a');
    const url = new URL('https://api.wamp.land/api/activity');
    const response = await handleAllActivity(new Request(url), url, f.env);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const data = await response.json() as { entries: unknown[] };
    expect(data.entries).toHaveLength(1); expect(data).not.toHaveProperty('preferences');
  });
  it.each(['0', '-1', 'NaN', '1.5', '9007199254740992', ''])('rejects invalid cursor %s', async before => {
    const f = fixture(); opened.push(f);
    const url = new URL(`https://api.wamp.land/api/activity?before=${before}`);
    await expect(handleAllActivity(new Request(url), url, f.env)).rejects.toMatchObject({ status: 400 });
  });
});
