import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../activity/testDatabase';
import type { Env } from '../core/types';
import { handleAdminRequest } from './routes';
let f: ReturnType<typeof fixture>;
beforeEach(() => { f = fixture(); f.env.ADMIN_API_KEY = 'fixture-map-admin-key'; });
afterEach(() => f.sqlite.close());
function request(key = 'fixture-map-admin-key', origin = 'https://wamp.land', body = {}) {
  return new Request('https://api.wamp.land/api/admin/map-screenshot/capture', { method: 'POST', headers: { 'x-admin-key': key, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
describe('admin map capture capability', () => {
  it('denies wrong/missing admin keys and untrusted browser origins before calling the service', async () => {
    const captureManual = vi.fn(); f.env.MAP_SCREENSHOTS = { captureManual } as unknown as Env['MAP_SCREENSHOTS'];
    for (const req of [request(''), request('wrong'), request('fixture-map-admin-key', 'https://untrusted.example')])
      await expect(handleAdminRequest(req, new URL(req.url), f.env)).rejects.toMatchObject({ status: 403 });
    expect(captureManual).not.toHaveBeenCalled();
  });
  it('only invokes the manual capability and returns a private success response', async () => {
    const captureManual = vi.fn(async () => ({ ok: true, fileName: '2026_10_19_2.png' }));
    f.env.MAP_SCREENSHOTS = { captureManual } as unknown as Env['MAP_SCREENSHOTS'];
    const req = request(undefined, undefined, { mode: 'daily' });
    const response = await handleAdminRequest(req, new URL(req.url), f.env);
    expect(response.status).toBe(201); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ ok: true, fileName: '2026_10_19_2.png' }); expect(captureManual).toHaveBeenCalledOnce();
  });
  it.each([{ busy: true, reason: 'Capture busy' }, { skipped: true, reason: 'All attempts used' }])('returns a readable bounded rejection (%j)', async result => {
    f.env.MAP_SCREENSHOTS = { captureManual: async () => ({ ok: false, ...result }) } as unknown as Env['MAP_SCREENSHOTS'];
    const req = request(), response = await handleAdminRequest(req, new URL(req.url), f.env);
    expect(response.status).toBe(429); expect(await response.json()).toMatchObject({ error: result.reason });
  });
  it('fails closed when its service binding is unavailable', async () => {
    const req = request(); await expect(handleAdminRequest(req, new URL(req.url), f.env)).rejects.toMatchObject({ status: 503 });
  });
});
