import { describe, expect, it, vi } from 'vitest';
import type { D1Database, Env, R2ObjectMetadata } from '../core/types';
import { handleAdminWorldTileRequest } from './routes';

const old = new Date(Date.now() - 90 * 86_400_000);
function setup(objects: R2ObjectMetadata[], referenced: string[] = []) {
  const list = vi.fn(async ({ cursor, limit }: { cursor?: string; limit: number }) => {
    const offset = Number(cursor ?? 0), next = offset + limit;
    return { objects: objects.slice(offset, next), truncated: next < objects.length, ...(next < objects.length ? { cursor: String(next) } : {}) };
  });
  const remove = vi.fn(async (_keys: string[]) => undefined);
  const database = { prepare: () => ({ all: async () => ({ results: referenced.map(r2_key => ({ r2_key })) }) }) } as unknown as D1Database;
  const env = { DB: database, ADMIN_API_KEY: 'local-fixture', WORLD_TILE_BUCKET: { list, delete: remove } } as unknown as Env;
  return { env, list, remove };
}
const object = (key: string, uploaded = old): R2ObjectMetadata => ({ key: 'world-tiles/' + key, uploaded, size: 7, etag: key });
function call(env: Env, body: unknown, authorized = true) {
  const request = new Request('https://api.wamp.land/api/admin/world-tiles/garbage-collect', {
    method: 'POST', headers: { Origin: 'https://wamp.land', 'Content-Type': 'application/json', ...(authorized ? { 'X-Admin-Key': 'local-fixture' } : {}) }, body: JSON.stringify(body),
  });
  return handleAdminWorldTileRequest(request, new URL(request.url), env);
}
describe('bounded authoritative world tile garbage collection', () => {
  it('defaults to a dry run capped at500 candidates without deleting anything', async () => {
    const f = setup(Array.from({ length: 501 }, (_, i) => object(String(i))));
    expect(await (await call(f.env, {})).json()).toMatchObject({ dryRun: true, candidates: 500, deleted: 0, truncated: true, maximumDeletes: 500, maximumScanned: 50_000 });
    expect(f.remove).not.toHaveBeenCalled();
  });
  it('preserves referenced and recent objects while limiting examined objects', async () => {
    const f = setup([object('referenced'), object('new', new Date()), object('old'), object('unexamined')], ['world-tiles/referenced']);
    expect(await (await call(f.env, { dryRun: false, confirm: true, maximumScanned: 3 })).json()).toMatchObject({ examined: 3, candidates: 1, deleted: 1, truncated: true });
    expect(f.remove.mock.calls).toEqual([[['world-tiles/old']]]);
    expect(f.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 3, prefix: 'world-tiles/' }));
  });
  it('clamps deletion/scan caps and deletes in bounded batches', async () => {
    const f = setup(Array.from({ length: 2100 }, (_, i) => object(String(i))));
    expect(await (await call(f.env, { dryRun: false, confirm: true, maximumDeletes: 999999, maximumScanned: 999999 })).json()).toMatchObject({ deleted: 2000, maximumDeletes: 2000, maximumScanned: 250000, truncated: true });
    expect(f.remove).toHaveBeenCalledTimes(20);
    expect(f.remove.mock.calls.every(call => (call[0] as string[]).length <= 100)).toBe(true);
  });
  it('retains authentication, explicit deletion confirmation and the30-day floor', async () => {
    const f = setup([object('old')]);
    await expect(call(f.env, {}, false)).rejects.toThrow('Admin key');
    await expect(call(f.env, { dryRun: false })).rejects.toThrow('confirm=true');
    await expect(call(f.env, { dryRun: false, confirm: true, olderThanDays: 29 })).rejects.toThrow('at least 30');
    expect(f.remove).not.toHaveBeenCalled();
  });
});
