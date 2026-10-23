import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../../worker';
import { fixture } from '../activity/testDatabase';
import { cleanDisplayText, displayNameKey } from '../core/displayText';
import { createSession } from './store';

describe('display text helpers', () => {
  it('stores text without invisible characters, keeping the joiners emoji and scripts need', () => {
    expect(cleanDisplayText(' A\u200Bd\u00ADa\u061C  L\u2060o\u202Eve\u3164\u115F\u1160\uFFA0 ')).toBe('Ada Love');
    const kept = '\u{1F469}\u200D\u{1F4BB} \u0645\u06CC\u200C\u062E \u{1F3F4}\u{E0067}\u{E0062}\u{E007F} \u2764\uFE0F';
    expect(cleanDisplayText(kept)).toBe(kept);
  });

  it('compares names by how they read', () => {
    const ada = displayNameKey('Ada');
    for (const lookalike of ['ADA', '\uFF21\uFF24\uFF21', 'A\u200Dda', 'A\u200Cda', 'Ada\uFE0F', 'A\u034Fda', 'Ad\u{E0061}a', ' Ada ']) {
      expect(displayNameKey(lookalike)).toBe(ada);
    }
    expect(displayNameKey('\u00C9LODIE')).toBe(displayNameKey('\u00E9lodie'));
    expect(displayNameKey('Ada Lovelace')).not.toBe(displayNameKey('AdaLovelace'));
    expect(displayNameKey('\u200B\u3164')).toBe('');
  });
});

describe('account display names', () => {
  let f: ReturnType<typeof fixture>;
  let sessions: Map<string, string>;
  beforeEach(() => { f = fixture(); sessions = new Map(); });
  afterEach(() => f.sqlite.close());

  async function call(method: string, path: string, as: string, body?: unknown) {
    if (!sessions.has(as)) sessions.set(as, await createSession(f.env, as));
    const response = await worker.fetch(new Request(`https://api.wamp.land${path}`, {
      method,
      headers: { Origin: 'https://wamp.land', Cookie: `ep_session=${sessions.get(as)}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), f.env);
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  const rename = (as: string, displayName: string) => call('POST', '/api/auth/display-name', as, { displayName });
  const available = (as: string, displayName: string) =>
    call('GET', `/api/auth/display-name-availability?displayName=${encodeURIComponent(displayName)}`, as);
  const storedName = (id: string) => (f.sqlite.prepare('SELECT display_name FROM users WHERE id = ?').get(id) as { display_name: string }).display_name;

  it('are stored without invisible characters and with single spaces', async () => {
    expect(await rename('p1', '  Ada\u200B  Lovelace\u202E ')).toMatchObject({ status: 200, body: { user: { displayName: 'Ada Lovelace' } } });
    expect(storedName('p1')).toBe('Ada Lovelace');
    expect((await rename('p1', '\u200B\u2060')).status).toBe(400);
    expect((await call('PATCH', '/api/profiles/me', 'p1', { displayName: 'Ada\u00AD  L.' })).status).toBe(200);
    expect(storedName('p1')).toBe('Ada L.');
  });

  it('treat a name that reads the same as one already claimed as taken', async () => {
    expect((await rename('p1', 'Ada')).status).toBe(200);
    for (const lookalike of ['ADA', '\uFF21\uFF24\uFF21', 'A\u200Dda', 'Ada\uFE0F', 'A\u00ADda', 'Ada\u3164']) {
      expect(await rename('p2', lookalike)).toMatchObject({ status: 409, body: { error: 'That display name has already been claimed.' } });
      expect((await available('p2', lookalike)).body).toEqual({ available: false, claimedByCurrentUser: false });
    }
    expect((await call('PATCH', '/api/profiles/me', 'p2', { displayName: '\uFF41\uFF44\uFF41' })).status).toBe(409);
    expect(storedName('p2')).toBe('p2');
    expect((await rename('p1', 'ADA')).status).toBe(200);
    expect((await available('p1', 'ada')).body).toEqual({ available: true, claimedByCurrentUser: true });
  });

  it('find a clash with another account even when the current name also matches', async () => {
    f.sqlite.prepare("UPDATE users SET display_name = 'Ada' WHERE id = 'p1'").run();
    f.sqlite.prepare("UPDATE users SET display_name = 'ada\u200B' WHERE id = 'p2'").run();
    expect((await rename('p1', 'ADA')).status).toBe(409);
    expect((await available('p1', 'Ada')).body).toEqual({ available: false, claimedByCurrentUser: false });
  });
});
