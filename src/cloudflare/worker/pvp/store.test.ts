import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PvpMatchSnapshot } from '../../../pvp/model';
import { fixture, NOW } from '../activity/testDatabase';
import { recordPvpMatchResult } from './store';

const auth = vi.hoisted(() => ({ id: null as string | null }));
vi.mock('../auth/request', async actual => ({ ...await actual<object>(),
  requireAuthenticatedRequestAuth: async () => { if (!auth.id) throw new Error('Sign in'); return { user: { id: auth.id }, source: 'session' }; },
}));
import { handlePvpMatchSubmit } from './routes';

let f: ReturnType<typeof fixture>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  f = fixture();
  auth.id = null;
});
afterEach(() => {
  vi.useRealTimers();
  f.sqlite.close();
});

function snapshot(matchId: string, overrides: Partial<PvpMatchSnapshot> = {}): PvpMatchSnapshot {
  const startedAt = Date.parse(NOW) - 60_000;
  return {
    matchId, mode: 'arena', roomId: '0,0', roomCoordinates: { x: 0, y: 0 }, status: 'complete',
    participants: [
      { userId: 'p1', displayName: 'Token name', avatarId: 'default-player', hearts: 3, connected: true, invulnerableUntil: 0, losses: 2, hits: 5 },
      { userId: 'p2', displayName: 'Token name 2', avatarId: 'default-player', hearts: 0, connected: false, invulnerableUntil: 0, losses: 5, hits: 2 },
    ],
    startedAt, countdownEndsAt: null, finishedAt: startedAt + 45_000,
    winnerUserId: 'p1', loserUserId: 'p2', draw: false, lastEvent: 'p1 wins.',
    ...overrides,
  };
}

const count = (sql: string, ...values: string[]) => Number((f.sqlite.prepare(sql).get(...values) as { n: number }).n);
const players = (matchId: string) => f.sqlite.prepare(
  'SELECT user_id, user_display_name, result, hearts_remaining, lives_lost, hits, xp_awarded FROM pvp_match_players WHERE match_id = ? ORDER BY user_id',
).all(matchId);
const pxp = (userId: string) => count("SELECT COALESCE(SUM(amount), 0) AS n FROM pxp_events WHERE user_id = ? AND source_type = 'pvp_match'", userId);

describe('recordPvpMatchResult', () => {
  it('saves the room result once, with names from the users table', async () => {
    f.sqlite.prepare("UPDATE users SET display_name = 'Real P1' WHERE id = 'p1'").run();
    expect(await recordPvpMatchResult(f.env, snapshot('arena-1'))).toBe('recorded');
    expect(players('arena-1')).toEqual([
      { user_id: 'p1', user_display_name: 'Real P1', result: 'win', hearts_remaining: 3, lives_lost: 2, hits: 5, xp_awarded: 20 },
      { user_id: 'p2', user_display_name: 'p2', result: 'loss', hearts_remaining: 0, lives_lost: 5, hits: 2, xp_awarded: 6 },
    ]);
    expect(f.sqlite.prepare('SELECT user_id, user_display_name, pvp_wins, pvp_losses FROM user_stats ORDER BY user_id').all()).toEqual([
      { user_id: 'p1', user_display_name: 'Real P1', pvp_wins: 1, pvp_losses: 0 },
      { user_id: 'p2', user_display_name: 'p2', pvp_wins: 0, pvp_losses: 1 },
    ]);

    expect(await recordPvpMatchResult(f.env, snapshot('arena-1'))).toBe('duplicate');
    expect(pxp('p1')).toBe(20);
    expect(count('SELECT pvp_wins AS n FROM user_stats WHERE user_id = ?', 'p1')).toBe(1);
  });

  it('saves draws for every participant', async () => {
    const draw = snapshot('arena-draw', { draw: true, winnerUserId: null, loserUserId: null });
    expect(await recordPvpMatchResult(f.env, draw)).toBe('recorded');
    expect(players('arena-draw').map(row => (row as { result: string }).result)).toEqual(['draw', 'draw']);
    expect(pxp('p1')).toBe(10);
  });

  it.each([
    ['an unfinished match', { status: 'active' as const }],
    ['a match that never started', { startedAt: null }],
    ['a winner who did not play', { winnerUserId: 'p3' }],
    ['a single participant', { participants: snapshot('x').participants.slice(0, 1) }],
  ])('ignores %s', async (_label, overrides) => {
    expect(await recordPvpMatchResult(f.env, snapshot('arena-bad', overrides))).toBe('invalid');
    expect(count('SELECT COUNT(*) AS n FROM pvp_matches')).toBe(0);
  });

  it('does not save matches with a guest or a classroom account', async () => {
    const guest = snapshot('arena-guest');
    guest.participants[1] = { ...guest.participants[1], userId: 'guest-abcdefgh1234' };
    expect(await recordPvpMatchResult(f.env, { ...guest, loserUserId: 'guest-abcdefgh1234' })).toBe('ineligible');

    f.sqlite.prepare("INSERT INTO school_classrooms (id, slug, display_name, teacher_email, created_at, updated_at) VALUES ('c1', 'class', 'Class', 't@example.test', ?, ?)").run(NOW, NOW);
    f.sqlite.prepare("INSERT INTO school_students (id, classroom_id, user_id, username, password_hash, password_updated_at, created_at, updated_at) VALUES ('s1', 'c1', 'p2', 'kid', 'x', ?, ?, ?)").run(NOW, NOW, NOW);
    expect(await recordPvpMatchResult(f.env, snapshot('arena-school'))).toBe('ineligible');

    expect(count('SELECT COUNT(*) AS n FROM pvp_matches')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM user_stats')).toBe(0);
    expect(pxp('p1')).toBe(0);
  });

  it('caps PvP PXP per day and saved matches per hour', async () => {
    for (let index = 0; index < 11; index += 1) {
      expect(await recordPvpMatchResult(f.env, snapshot(`arena-cap-${index}`))).toBe('recorded');
    }
    expect(pxp('p1')).toBe(200);
    expect(count('SELECT xp_awarded AS n FROM pvp_match_players WHERE match_id = ? AND user_id = ?', 'arena-cap-10', 'p1')).toBe(0);
    expect(count('SELECT pvp_wins AS n FROM user_stats WHERE user_id = ?', 'p1')).toBe(11);

    for (let index = 11; index < 20; index += 1) {
      expect(await recordPvpMatchResult(f.env, snapshot(`arena-cap-${index}`))).toBe('recorded');
    }
    expect(await recordPvpMatchResult(f.env, snapshot('arena-cap-20'))).toBe('limited');
    expect(count('SELECT COUNT(*) AS n FROM pvp_matches')).toBe(20);

    vi.setSystemTime(Date.parse(NOW) + 61 * 60 * 1000);
    expect(await recordPvpMatchResult(f.env, snapshot('arena-cap-21'))).toBe('recorded');
  });
});

describe('POST /api/pvp/matches', () => {
  const post = (body: unknown) => handlePvpMatchSubmit(new Request('https://api.wamp.land/api/pvp/matches', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), f.env);

  it('reports the saved result and ignores results in the request body', async () => {
    auth.id = 'p2';
    const claimed = await post({ matchId: 'arena-claim', result: 'win', winnerUserId: 'p2', loserUserId: 'p1',
      participants: [{ userId: 'p2', userDisplayName: 'Someone else', result: 'win' }] });
    expect(await claimed.json()).toMatchObject({ saved: false, matchId: 'arena-claim', progressionDelta: { pxp: 0 } });
    expect(count('SELECT COUNT(*) AS n FROM pvp_matches')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM user_stats')).toBe(0);

    await recordPvpMatchResult(f.env, snapshot('arena-claim'));
    expect(await (await post({ matchId: 'arena-claim' })).json()).toMatchObject({ saved: true, progressionDelta: { pxp: 6 } });
    await expect(post({})).rejects.toMatchObject({ status: 400 });
  });
});
