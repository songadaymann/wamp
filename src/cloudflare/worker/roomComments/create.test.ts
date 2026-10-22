import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/request', async (original) => ({
  ...await original<typeof import('../auth/request')>(),
  requireAuthenticatedRequestAuth: vi.fn(),
}));
vi.mock('../admin/reviewNotifications', async (original) => ({
  ...await original<typeof import('../admin/reviewNotifications')>(),
  sendAdminReviewNotificationEmail: vi.fn().mockResolvedValue({ sent: true }),
}));
vi.mock('./email', () => ({ sendRoomCommentApprovedEmail: vi.fn() }));

import { fixture } from '../activity/testDatabase';
import { loadActivity } from '../activity/store';
import { sendAdminReviewNotificationEmail } from '../admin/reviewNotifications';
import { requireAuthenticatedRequestAuth } from '../auth/request';
import type { RequestAuth } from '../core/types';
import { loadOrBackfillUserProgress } from '../progression/progressRows';
import { sendRoomCommentApprovedEmail } from './email';
import { handleAdminRoomCommentRequest, handleRoomCommentCreate, handleRoomCommentList } from './routes';

const NOW = '2026-10-19T21:00:00.000Z';
let f: ReturnType<typeof fixture>;
let auth: RequestAuth;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  vi.clearAllMocks();
  f = fixture();
  await loadOrBackfillUserProgress(f.env, 'p1');
  auth = {
    source: 'session', user: { id: 'p1', displayName: 'p1', email: 'p1@example.test', walletAddress: null },
    principal: { kind: 'user', id: 'p1', displayName: 'p1', ownerUserId: 'p1', agentId: null },
    agent: null, session: null, school: null, scopes: null, apiToken: null, agentToken: null, isAdmin: false,
  };
  vi.mocked(requireAuthenticatedRequestAuth).mockResolvedValue(auth);
  vi.mocked(sendRoomCommentApprovedEmail).mockResolvedValue({
    attempted: true, sent: true, skippedReason: null, error: null,
  });
});
afterEach(() => { f.sqlite.close(); vi.useRealTimers(); });

function setTrust(score: number) {
  f.sqlite.prepare('UPDATE user_progress SET hidden_trust_score = ? WHERE user_id = ?').run(score, 'p1');
}
function create(body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const request = new Request('https://api.wamp.land/api/rooms/0,0/comments', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ roomVersion: 1, body: 'Great room!', position: { x: 20, y: 40 }, ...body }),
  });
  return handleRoomCommentCreate(request, new URL(request.url), f.env, '0,0');
}
async function publicComments() {
  const request = new Request('https://api.wamp.land/api/rooms/0,0/comments');
  return (await handleRoomCommentList(request, new URL(request.url), f.env, '0,0')).json();
}

describe('room comment trust approval on the migrated database', () => {
  it.each([[40, 'T1'], [90, 'T2'], [160, 'T3'], [260, 'T4']])(
    'posts score %i immediately with %s audit and builder activity', async (score, tier) => {
      setTrust(Number(score));
      const response = await create();
      expect(response.status).toBe(201);
      const result = await response.json();
      expect(result).toMatchObject({ status: 'approved', message: 'Comment posted.' });
      expect(f.sqlite.prepare('SELECT status, reviewed_at, reviewed_by_label, review_reason, notified_at FROM room_comments').get())
        .toEqual({ status: 'approved', reviewed_at: NOW, reviewed_by_label: 'Automatic trust approval',
          review_reason: `Effective trust tier ${tier}`, notified_at: NOW });
      expect(await publicComments()).toMatchObject({ comments: [{ id: result.comment.id, body: 'Great room!' }] });
      expect((await loadActivity(f.env.DB, 'builder', true)).entries).toMatchObject([{ kind: 'comment' }]);
      expect(sendAdminReviewNotificationEmail).not.toHaveBeenCalled();
      expect(sendRoomCommentApprovedEmail).toHaveBeenCalledExactlyOnceWith(expect.any(Request), f.env,
        expect.objectContaining({ status: 'approved', builderUserId: 'builder' }));
    },
  );

  it.each([0, 39])('keeps T0 score %i pending and ignores client approval claims', async (score) => {
    setTrust(score);
    const result = await (await create({ status: 'approved', trustTier: 'T4' })).json();
    expect(result).toMatchObject({ status: 'pending_review', message: 'Comment submitted for review.' });
    expect(f.sqlite.prepare('SELECT status, reviewed_at, reviewed_by_label, review_reason FROM room_comments').get())
      .toEqual({ status: 'pending_review', reviewed_at: null, reviewed_by_label: null, review_reason: null });
    expect(await publicComments()).toMatchObject({ comments: [] });
    expect((await loadActivity(f.env.DB, 'builder', true)).entries).toEqual([]);
    expect(sendAdminReviewNotificationEmail).toHaveBeenCalledOnce();
    expect(sendRoomCommentApprovedEmail).not.toHaveBeenCalled();
  });

  it('links the admin review email to the site rather than the Origin a token request sends', async () => {
    setTrust(0);
    await create({}, { Authorization: 'Bearer epat_test-token', Origin: 'https://evil.example' });
    expect(sendAdminReviewNotificationEmail).toHaveBeenCalledExactlyOnceWith(f.env, expect.objectContaining({
      actionUrl: 'https://wamp.land/launch-admin.html',
      details: expect.arrayContaining(['Room link: https://wamp.land/r/0/0']),
    }));
  });

  it('keeps a high-score new account pending during the existing trust hold', async () => {
    setTrust(260);
    f.sqlite.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(NOW, 'p1');
    expect(await (await create()).json()).toMatchObject({ status: 'pending_review' });
  });

  it('keeps a high-score account with a recent ban penalty pending', async () => {
    setTrust(260);
    f.sqlite.prepare('INSERT INTO chat_ban_audit (id,user_id,banned_by_user_id,created_at) VALUES (?,?,?,?)')
      .run('old-ban', 'p1', 'builder', NOW);
    expect(await (await create()).json()).toMatchObject({ status: 'pending_review' });
  });

  it('blocks banned users before writing even at T4', async () => {
    setTrust(260);
    f.sqlite.prepare('INSERT INTO chat_bans (user_id,banned_by_user_id,created_at) VALUES (?,?,?)')
      .run('p1', 'builder', NOW);
    await expect(create()).rejects.toMatchObject({ status: 403 });
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM room_comments').get()).toEqual({ n: 0 });
  });

  it('keeps classroom restrictions at T4', async () => {
    setTrust(260);
    auth.school = { classroomId: 'class', classroomSlug: 'class', classroomName: 'Class', studentId: 'student', studentUsername: 'student' };
    await expect(create()).rejects.toMatchObject({ status: 403 });
  });

  it('keeps validation and rate limits for trusted authors', async () => {
    setTrust(40);
    await expect(create({ body: 'https://example.test' })).rejects.toMatchObject({ status: 400 });
    await expect(create({ body: '<script>' })).rejects.toMatchObject({ status: 400 });
    await create();
    await expect(create()).rejects.toMatchObject({ status: 429 });
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM room_comments').get()).toEqual({ n: 1 });
  });

  it('records builder notification failure without putting an approved comment back in review', async () => {
    setTrust(40);
    vi.mocked(sendRoomCommentApprovedEmail).mockResolvedValueOnce({
      attempted: true, sent: false, skippedReason: null, error: 'Provider rejected request',
    });
    expect(await (await create()).json()).toMatchObject({ status: 'approved' });
    expect(f.sqlite.prepare('SELECT status, notification_error FROM room_comments').get())
      .toEqual({ status: 'approved', notification_error: 'Provider rejected request' });
  });

  it('retains manual approval and rejection for pending comments', async () => {
    const result = await (await create()).json();
    f.env.ADMIN_API_KEY = 'local-test-admin';
    const review = async (decision: string) => {
      const request = new Request(`https://api.wamp.land/api/admin/room-comments/${result.comment.id}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': 'local-test-admin' },
        body: JSON.stringify({ decision }),
      });
      return handleAdminRoomCommentRequest(request, new URL(request.url), f.env);
    };
    expect((await review('approved')).status).toBe(200);
    expect(await publicComments()).toMatchObject({ comments: [{ id: result.comment.id }] });
    expect((await review('rejected')).status).toBe(200);
    expect(await publicComments()).toMatchObject({ comments: [] });
    expect(sendRoomCommentApprovedEmail).toHaveBeenCalledOnce();
  });
});
