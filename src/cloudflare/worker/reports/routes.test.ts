import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminContentReportsResponse, ContentReportRequestBody } from '../../../reports/model';
import { fixture } from '../activity/testDatabase';
import { createSession } from '../auth/store';
import { handleContentReports, pruneClosedContentReports } from './routes';

const sendAdminReviewNotificationEmail = vi.hoisted(() => vi.fn(async () => ({ attempted: true, sent: true, skippedReason: null, error: null })));
vi.mock('../admin/reviewNotifications', () => ({ sendAdminReviewNotificationEmail }));

const opened: ReturnType<typeof fixture>[] = [];
function setup() {
  const f = fixture();
  f.env.ADMIN_API_KEY = 'test-admin-key';
  f.sqlite.exec(`INSERT INTO chat_messages (id, user_id, user_display_name, body, created_at)
    VALUES ('msg-1', 'p1', 'p1', 'a rude message', '2026-10-04T16:00:00.000Z')`);
  opened.push(f);
  return f;
}
afterEach(() => { sendAdminReviewNotificationEmail.mockClear(); for (const f of opened.splice(0)) f.sqlite.close(); });

function report(f: ReturnType<typeof fixture>, body: Partial<ContentReportRequestBody> & { visitor?: string }, headers: Record<string, string> = {}) {
  const request = new Request('https://api.wamp.land/api/reports', {
    method: 'POST',
    headers: { Origin: 'https://wamp.land', 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9', ...headers },
    body: JSON.stringify({ targetType: 'room', targetId: '0,0', reason: 'offensive', details: '', ...body }),
  });
  return handleContentReports(request, new URL(request.url), f.env);
}
function admin(f: ReturnType<typeof fixture>, path: string, body?: unknown) {
  const request = new Request(`https://api.wamp.land${path}`, {
    method: body === undefined ? 'GET' : 'PATCH',
    headers: { Origin: 'https://wamp.land', 'x-admin-key': 'test-admin-key', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handleContentReports(request, new URL(request.url), f.env);
}

describe('player reports', () => {
  it('stores what the reporter saw, once per reporter, and emails only the first report on a target', async () => {
    const f = setup();
    expect((await report(f, { details: 'Swastika drawn in tiles' })).status).toBe(201);
    expect(await (await report(f, {})).json()).toEqual({ ok: true, alreadyReported: true });
    const session = await createSession(f.env, 'p2');
    expect((await report(f, { reason: 'spam' }, { Cookie: `ep_session=${session}` })).status).toBe(201);
    expect(sendAdminReviewNotificationEmail).toHaveBeenCalledTimes(1);
    const list = await (await admin(f, '/api/admin/reports')).json() as AdminContentReportsResponse;
    expect(list.reports).toHaveLength(2);
    expect(list.reports[0]).toMatchObject({
      targetType: 'room', targetId: '0,0', targetLabel: 'Lava Gauntlet (0, 0)', targetUserId: 'builder',
      openReportsForTarget: 2, status: 'open',
    });
    expect(list.reports.map((entry) => entry.reporterSignedIn).sort()).toEqual([false, true]);
  });

  it('reads chat, player and guest room targets on the server and refuses missing ones', async () => {
    const f = setup();
    expect((await report(f, { targetType: 'chat_message', targetId: 'msg-1', reason: 'harassment' })).status).toBe(201);
    expect((await report(f, { targetType: 'user', targetId: 'p3', reason: 'harassment' })).status).toBe(201);
    await expect(report(f, { targetType: 'chat_message', targetId: 'missing' })).rejects.toMatchObject({ status: 404 });
    await expect(report(f, { targetType: 'guest_room', targetId: 'missing' })).rejects.toMatchObject({ status: 404 });
    await expect(report(f, { targetType: 'user', targetId: 'p3', reason: 'nope' as never })).rejects.toMatchObject({ status: 400 });
    const labels = (await (await admin(f, '/api/admin/reports')).json() as AdminContentReportsResponse).reports.map((entry) => entry.targetLabel);
    expect(labels).toEqual(expect.arrayContaining(['p1: a rude message', 'p3']));
  });

  it('counts guests by network, so a changed browser id neither repeats a report nor escapes the limit', async () => {
    const f = setup();
    expect((await report(f, { visitor: crypto.randomUUID() })).status).toBe(201);
    expect(await (await report(f, { visitor: crypto.randomUUID() })).json()).toEqual({ ok: true, alreadyReported: true });
    expect((await report(f, {}, { 'CF-Connecting-IP': '2001:db8:1:2::9' })).status).toBe(201);
    expect(await (await report(f, {}, { 'CF-Connecting-IP': '2001:db8:1:2::77' })).json()).toMatchObject({ alreadyReported: true });
  });

  it('emails at most 20 first reports a day and never blocks signed-in reporters with the guest day cap', async () => {
    const f = setup();
    const now = new Date().toISOString();
    const insert = f.sqlite.prepare('INSERT INTO rate_limit_events (bucket, key_hash, created_at) VALUES (?, ?, ?)');
    for (let index = 0; index < 20; index += 1) insert.run('content-report:email', 'email', now);
    for (let index = 0; index < 1000; index += 1) insert.run('content-report:all', 'all', now);
    await expect(report(f, {})).rejects.toMatchObject({ status: 429 });
    const session = await createSession(f.env, 'p2');
    expect((await report(f, {}, { Cookie: `ep_session=${session}` })).status).toBe(201);
    expect(sendAdminReviewNotificationEmail).not.toHaveBeenCalled();
  });

  it('does not let players report themselves', async () => {
    const f = setup();
    const session = await createSession(f.env, 'builder');
    await expect(report(f, {}, { Cookie: `ep_session=${session}` })).rejects.toMatchObject({ status: 400 });
  });

  it('limits each reporter to ten reports a day', async () => {
    const f = setup();
    for (let index = 0; index < 10; index += 1) {
      f.sqlite.prepare("INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES (?,?,?,?,?)")
        .run(`target-${index}`, `t${index}@example.test`, `Target ${index}`, '2026-10-01', '2026-10-01');
      expect((await report(f, { targetType: 'user', targetId: `target-${index}` })).status).toBe(201);
    }
    await expect(report(f, { targetType: 'user', targetId: 'p3' })).rejects.toMatchObject({ status: 429 });
  });

  it('closes every open report on a target and prunes closed reports after 90 days', async () => {
    const f = setup();
    await report(f, {});
    await report(f, {}, { 'CF-Connecting-IP': '198.51.100.20' });
    const [first] = (await (await admin(f, '/api/admin/reports')).json() as AdminContentReportsResponse).reports;
    await expect(admin(f, `/api/admin/reports/${first.id}`, { status: 'open' })).rejects.toMatchObject({ status: 400 });
    expect((await admin(f, `/api/admin/reports/${first.id}`, { status: 'resolved', allForTarget: true, operatorLabel: 'jm' })).status).toBe(200);
    expect((await (await admin(f, '/api/admin/reports')).json() as AdminContentReportsResponse).reports).toEqual([]);
    expect((await (await admin(f, '/api/admin/reports?status=resolved')).json() as AdminContentReportsResponse).reports).toHaveLength(2);
    expect((await report(f, {})).status).toBe(201);
    await pruneClosedContentReports(f.env, new Date(Date.now() + 91 * 86_400_000));
    expect(f.sqlite.prepare('SELECT status FROM content_reports').all()).toEqual([{ status: 'open' }]);
  });

  it('requires the admin key for the review list', async () => {
    const f = setup();
    const request = new Request('https://api.wamp.land/api/admin/reports', { headers: { 'x-admin-key': 'wrong' } });
    await expect(handleContentReports(request, new URL(request.url), f.env)).rejects.toMatchObject({ status: 403 });
  });
});
