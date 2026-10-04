import { afterEach, describe, expect, it, vi } from 'vitest';
import { award, fixture, NOW, top1 } from './testDatabase';
import { loadActivityPreferences, saveActivityPreferences } from './store';
import { digestWindow, runActivityEmails } from './emails';
import { createActivityUnsubscribeToken, handleActivityUnsubscribe } from './unsubscribe';
import { handleMyActivity } from './routes';
import { createSession } from '../auth/store';
const opened: ReturnType<typeof fixture>[] = [];
function setup() { const f = fixture(); f.env.RESEND_API_KEY = 'local-test-key'; opened.push(f); return f; }
const ENABLED = '2026-10-03T10:00:00.000Z';
function sender() { return vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ id: 'fake-provider-id' }), { headers: { 'Content-Type': 'application/json' } })); }
afterEach(() => { for (const f of opened.splice(0)) f.sqlite.close(); vi.restoreAllMocks(); });
describe('opt-in, durable activity delivery', () => {
  it('sends nothing by default and excludes historical activity before opt-in', async () => {
    const f = setup(), send = sender(); top1(f, 'old');
    await runActivityEmails(f.env, { now: NOW, fetcher: send }); expect(send).not.toHaveBeenCalled();
    await saveActivityPreferences(f.env.DB, 'p1', { weeklyDigest: true, dethroneAlerts: true }, '2026-10-04T18:00:00.000Z');
    await runActivityEmails(f.env, { now: '2026-10-04T18:01:00.000Z', fetcher: send }); expect(send).not.toHaveBeenCalled();
  });
  it('sends immediately for a verified run, limits daily sends, and does not resend yesterday’s event', async () => {
    const f = setup(), send = sender(); await saveActivityPreferences(f.env.DB, 'p1', { weeklyDigest: false, dethroneAlerts: true }, ENABLED);
    top1(f, 'a'); expect(await runActivityEmails(f.env, { now: NOW, fetcher: send, attemptId: 'a' })).toEqual({ sent: 1 });
    top1(f, 'b', 'p1', '2026-10-04T18:00:00.000Z');
    await runActivityEmails(f.env, { now: '2026-10-04T18:01:00.000Z', fetcher: send, attemptId: 'b' }); expect(send).toHaveBeenCalledTimes(1);
    await runActivityEmails(f.env, { now: '2026-10-05T00:01:00.000Z', fetcher: send }); expect(send).toHaveBeenCalledTimes(2);
    const body = JSON.parse(String(send.mock.calls[1][1]?.body)); expect(body.text.match(/took your #1 on/g)?.length).toBe(2); // Heading plus one new event.
    await runActivityEmails(f.env, { now: '2026-10-05T00:02:00.000Z', fetcher: send }); expect(send).toHaveBeenCalledTimes(2);
  });
  it('leases delivery against overlapping immediate and cron dispatches', async () => {
    const f = setup(); await saveActivityPreferences(f.env.DB, 'p1', { weeklyDigest: false, dethroneAlerts: true }, ENABLED); top1(f, 'a');
    let finish!: (value: Response) => void; let started!: () => void;
    const active = new Promise<void>(resolve => { started = resolve; });
    const send = vi.fn<typeof fetch>().mockImplementation(() => { started(); return new Promise(resolve => { finish = resolve; }); });
    const first = runActivityEmails(f.env, { now: NOW, fetcher: send, attemptId: 'a' }); await active;
    expect(await runActivityEmails(f.env, { now: NOW, fetcher: send })).toEqual({ sent: 0 });
    finish(new Response(JSON.stringify({ id: 'fake' }))); await first; expect(send).toHaveBeenCalledTimes(1);
  });
  it('retries provider errors with the exact stored payload/key inside the provider’s idempotency window', async () => {
    const f = setup(), send = sender(); await saveActivityPreferences(f.env.DB, 'p1', { weeklyDigest: false, dethroneAlerts: true }, ENABLED); top1(f, 'a');
    send.mockResolvedValueOnce(new Response('failure', { status: 503 })); vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runActivityEmails(f.env, { now: NOW, fetcher: send })).toEqual({ sent: 0 });
    await runActivityEmails(f.env, { now: '2026-10-04T17:01:00.000Z', fetcher: send }); expect(send).toHaveBeenCalledTimes(1);
    expect(await runActivityEmails(f.env, { now: '2026-10-04T17:16:00.000Z', fetcher: send })).toEqual({ sent: 1 });
    expect(send.mock.calls[0][1]?.body).toBe(send.mock.calls[1][1]?.body);
    expect(new Headers(send.mock.calls[0][1]?.headers).get('Idempotency-Key')).toBe(new Headers(send.mock.calls[1][1]?.headers).get('Idempotency-Key'));
  });
  it('keeps idempotency after the provider succeeds but the database acknowledgement fails', async () => {
    const f = setup(), send = sender(); await saveActivityPreferences(f.env.DB, 'p1', { weeklyDigest: false, dethroneAlerts: true }, ENABLED); top1(f, 'a');
    const original = f.env.DB.prepare.bind(f.env.DB); let failed = false;
    vi.spyOn(f.env.DB, 'prepare').mockImplementation(sql => { if (!failed && sql.includes('SET sent_at = ?')) { failed = true; throw new Error('Temporary acknowledgement outage'); } return original(sql); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await runActivityEmails(f.env, { now: NOW, fetcher: send }); await runActivityEmails(f.env, { now: '2026-10-04T17:16:00.000Z', fetcher: send });
    expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[0][1]?.body).toBe(send.mock.calls[1][1]?.body);
    expect(f.sqlite.prepare('SELECT sent_at FROM builder_activity_emails').get()).toMatchObject({ sent_at: '2026-10-04T17:16:00.000Z' });
  });
  it('cancels pending mail on opt-out and never revives it after opting back in', async () => {
    const f = setup(), send = sender(); await saveActivityPreferences(f.env.DB, 'p1', { weeklyDigest: false, dethroneAlerts: true }, ENABLED); top1(f, 'a');
    send.mockResolvedValueOnce(new Response('', { status: 429 })); vi.spyOn(console, 'error').mockImplementation(() => {});
    await runActivityEmails(f.env, { now: NOW, fetcher: send });
    await saveActivityPreferences(f.env.DB, 'p1', { weeklyDigest: false, dethroneAlerts: false }, NOW);
    await saveActivityPreferences(f.env.DB, 'p1', { weeklyDigest: false, dethroneAlerts: true }, '2026-10-04T17:10:00.000Z');
    await runActivityEmails(f.env, { now: '2026-10-04T17:20:00.000Z', fetcher: send }); expect(send).toHaveBeenCalledTimes(1);
  });
  it('stops old delivery retries before idempotency expires and avoids school-managed recipients', async () => {
    const f = setup(), send = sender(); await saveActivityPreferences(f.env.DB, 'p1', { weeklyDigest: false, dethroneAlerts: true }, ENABLED); top1(f, 'a');
    send.mockResolvedValueOnce(new Response('', { status: 503 })); vi.spyOn(console, 'error').mockImplementation(() => {});
    await runActivityEmails(f.env, { now: NOW, fetcher: send });
    await runActivityEmails(f.env, { now: '2026-10-05T17:01:00.000Z', fetcher: send }); expect(send).toHaveBeenCalledTimes(1);
    f.sqlite.exec("INSERT INTO school_classrooms (id,slug,display_name,teacher_email,created_at,updated_at) VALUES ('s','s','School','teacher@example.test','2026','2026'); INSERT INTO school_students (id,classroom_id,user_id,username,password_hash,password_updated_at,created_at,updated_at) VALUES ('s','s','p1','student','hash','2026','2026','2026')");
    top1(f, 'new', 'p1', '2026-10-05T17:02:00.000Z'); await runActivityEmails(f.env, { now: '2026-10-05T17:03:00.000Z', fetcher: send }); expect(send).toHaveBeenCalledTimes(1);
  });
  it('guards the weekly schedule, sends an escaped concrete digest once, and supports one-click unsubscribe', async () => {
    const f = setup(), send = sender(); await saveActivityPreferences(f.env.DB, 'builder', { weeklyDigest: true, dethroneAlerts: true }, ENABLED);
    award(f, 'a'); award(f, 'b', 'unique_rating_room'); f.sqlite.exec("UPDATE users SET display_name = '<img src=x>' WHERE id = 'p1'");
    expect(digestWindow(NOW)).toBeNull(); expect(digestWindow('2026-10-05T11:59:00.000Z')).toBeNull();
    await runActivityEmails(f.env, { now: '2026-10-05T12:17:00.000Z', fetcher: send }); expect(send).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(send.mock.calls[0][1]?.body)); expect(body.html).toContain('&lt;img src=x&gt;'); expect(body.html).not.toContain('<img src=x>');
    expect(body.text).toContain('rated 4/5 Lava Gauntlet'); expect(body.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    await runActivityEmails(f.env, { now: '2026-10-05T12:22:00.000Z', fetcher: send }); expect(send).toHaveBeenCalledTimes(1);
    const url = new URL(body.headers['List-Unsubscribe'].slice(1, -1));
    await handleActivityUnsubscribe(new Request(url), url, f.env.DB, Date.parse('2026-10-05T12:30:00Z'));
    expect((await loadActivityPreferences(f.env.DB, 'builder')).weekly_digest).toBe(1); // GET cannot unsubscribe via a mail scanner.
    await handleActivityUnsubscribe(new Request(url, { method: 'POST', body: 'List-Unsubscribe=One-Click' }), url, f.env.DB, Date.parse('2026-10-05T12:30:00Z'));
    const prefs = await loadActivityPreferences(f.env.DB, 'builder'); expect(prefs.weekly_digest).toBe(0); expect(prefs.dethrone_alerts).toBe(1);
  });
  it('rejects expired, tampered and cross-user unsubscribe tokens', async () => {
    const f = setup(); const prefs = await loadActivityPreferences(f.env.DB, 'p1');
    const token = await createActivityUnsubscribeToken(prefs, 'dethroned', NOW);
    for (const [value, when] of [[token.slice(0, -6) + 'AAAAAA', NOW], [token, '2027-10-05T00:00:00Z']] as const) {
      const url = new URL('https://api.wamp.land/api/activity/unsubscribe?token=' + value);
      await expect(handleActivityUnsubscribe(new Request(url, { method: 'POST' }), url, f.env.DB, Date.parse(when))).rejects.toMatchObject({ status: 400 });
    }
    const parts = token.split('.'); const claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const altered = Buffer.from(JSON.stringify({ ...claims, userId: 'p2' })).toString('base64url') + '.' + parts[1];
    const url = new URL('https://api.wamp.land/api/activity/unsubscribe?token=' + altered);
    await expect(handleActivityUnsubscribe(new Request(url, { method: 'POST' }), url, f.env.DB, Date.parse(NOW))).rejects.toMatchObject({ status: 400 });
  });
  it('preserves both independent opt-outs when one-click requests arrive concurrently', async () => {
    const f = setup(); await saveActivityPreferences(f.env.DB, 'p1', { weeklyDigest: true, dethroneAlerts: true }, ENABLED);
    const prefs = await loadActivityPreferences(f.env.DB, 'p1');
    const tokens = await Promise.all(['digest', 'dethroned'].map(scope => createActivityUnsubscribeToken(prefs, scope as 'digest' | 'dethroned', NOW)));
    await Promise.all(tokens.map(token => {
      const url = new URL('https://api.wamp.land/api/activity/unsubscribe?token=' + token);
      return handleActivityUnsubscribe(new Request(url, { method: 'POST' }), url, f.env.DB, Date.parse(NOW));
    }));
    expect(await loadActivityPreferences(f.env.DB, 'p1')).toMatchObject({ weekly_digest: 0, dethrone_alerts: 0 });
  });
  it('requires authentication, trusted mutation origins and correct owned watermarks', async () => {
    const f = setup(); const url = new URL('https://api.wamp.land/api/me/activity');
    await expect(handleMyActivity(new Request(url), url, f.env)).rejects.toMatchObject({ status: 401 });
    const token = await createSession(f.env, 'builder'); const headers = { Cookie: `ep_session=${token}`, Origin: 'https://wamp.land' };
    const result = await handleMyActivity(new Request(url, { headers }), url, f.env); expect(result.headers.get('Cache-Control')).toBe('no-store');
    const prefsUrl = new URL(url + '/preferences');
    await expect(handleMyActivity(new Request(prefsUrl, { method: 'PUT', headers: { ...headers, Origin: 'https://untrusted.test' }, body: '{"weeklyDigest":true,"dethroneAlerts":true}' }), prefsUrl, f.env)).rejects.toMatchObject({ status: 403 });
    await expect(handleMyActivity(new Request(prefsUrl, { method: 'PUT', headers, body: 'null' }), prefsUrl, f.env)).rejects.toMatchObject({ status: 400 });
  });
});
