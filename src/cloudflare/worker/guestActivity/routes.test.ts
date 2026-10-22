import { afterEach, describe, expect, it } from 'vitest';
import { fixture } from '../activity/testDatabase';
import { handleGuestActivityHeartbeat } from './routes';

const opened: ReturnType<typeof fixture>[] = [];
function setup() { const f = fixture(); opened.push(f); return f; }
afterEach(() => { for (const f of opened.splice(0)) f.sqlite.close(); });

const guest = 'guest-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function heartbeat(f: ReturnType<typeof fixture>, sessionId: string, ip: string | null = '203.0.113.9') {
  const request = new Request('https://api.wamp.land/api/guest-activity/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://wamp.land', ...(ip ? { 'CF-Connecting-IP': ip } : {}) },
    body: JSON.stringify({ sessionId, guestUserId: guest, guestDisplayName: 'Guest', mode: 'browse', path: '/' }),
  });
  return handleGuestActivityHeartbeat(request, f.env);
}

const visits = (f: ReturnType<typeof fixture>) =>
  f.sqlite.prepare('SELECT session_id, heartbeat_count FROM guest_visits ORDER BY session_id').all() as Array<{ session_id: string; heartbeat_count: number }>;

describe('guest visit heartbeats (F415)', () => {
  it('caps new visits per network but keeps recorded visits beating', async () => {
    const f = setup();
    for (let index = 0; index < 120; index += 1) {
      expect((await heartbeat(f, `visit-${String(index).padStart(3, '0')}`)).status).toBe(200);
    }
    await expect(heartbeat(f, 'visit-extra')).rejects.toMatchObject({ status: 429 });
    expect((await heartbeat(f, 'visit-000')).status).toBe(200);
    expect((await heartbeat(f, 'visit-other-network', '198.51.100.20')).status).toBe(200);
    const rows = visits(f);
    expect(rows).toHaveLength(121);
    expect(rows.find((row) => row.session_id === 'visit-000')?.heartbeat_count).toBe(2);
    expect(rows.some((row) => row.session_id === 'visit-extra')).toBe(false);
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM rate_limit_events WHERE bucket = 'guest-visit-create:network'").get())
      .toEqual({ n: 121 });
  });

  it('counts an IPv6 /64 as one network and requests without an address as one more', async () => {
    const f = setup();
    const insert = f.sqlite.prepare('INSERT INTO rate_limit_events (bucket, key_hash, created_at) VALUES (?, ?, ?)');
    expect((await heartbeat(f, 'visit-ipv6-a', '2001:db8:1:2::9')).status).toBe(200);
    expect((await heartbeat(f, 'visit-unknown', null)).status).toBe(200);
    const keys = f.sqlite.prepare("SELECT key_hash FROM rate_limit_events WHERE bucket = 'guest-visit-create:network' ORDER BY id").all() as Array<{ key_hash: string }>;
    const now = new Date().toISOString();
    for (let index = 0; index < 119; index += 1) insert.run('guest-visit-create:network', keys[0].key_hash, now);
    await expect(heartbeat(f, 'visit-ipv6-b', '2001:db8:1:2::77')).rejects.toMatchObject({ status: 429 });
    expect((await heartbeat(f, 'visit-ipv6-a', '2001:db8:1:2::77')).status).toBe(200);
    for (let index = 0; index < 119; index += 1) insert.run('guest-visit-create:network', keys[1].key_hash, now);
    await expect(heartbeat(f, 'visit-unknown-b', null)).rejects.toMatchObject({ status: 429 });
  });

  it('stops new visits sitewide past the hourly ceiling and keeps recorded visits beating', async () => {
    const f = setup();
    expect((await heartbeat(f, 'visit-recorded')).status).toBe(200);
    const insert = f.sqlite.prepare("INSERT INTO rate_limit_events (bucket, key_hash, created_at) VALUES ('guest-visit-create:all', 'all', ?)");
    const now = new Date().toISOString();
    for (let index = 0; index < 4999; index += 1) insert.run(now);
    await expect(heartbeat(f, 'visit-new', '198.51.100.30')).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/right now/) });
    expect((await heartbeat(f, 'visit-recorded', '198.51.100.30')).status).toBe(200);
    expect(visits(f)).toEqual([{ session_id: 'visit-recorded', heartbeat_count: 2 }]);
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM rate_limit_events WHERE bucket = 'guest-visit-create:network'").get()).toEqual({ n: 1 });
  });
});
