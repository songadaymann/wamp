import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';
import { handleAdminSnapshotImport, handleAdminSnapshotReset } from './snapshot';

function adminRequest(path: string): Request {
  return new Request(`https://api.wamp.land${path}`, {
    method: 'POST',
    headers: { 'X-Admin-Key': 'admin-key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: [] }),
  });
}

function envWith(vars: Partial<Env>): { env: Env; db: { prepare: ReturnType<typeof vi.fn>; batch: ReturnType<typeof vi.fn> } } {
  const db = { prepare: vi.fn(), batch: vi.fn() };
  return { env: { ADMIN_API_KEY: 'admin-key', DB: db, ...vars } as unknown as Env, db };
}

async function expectNotFound(promise: Promise<Response>): Promise<void> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).status).toBe(404);
}

describe('admin snapshot routes', () => {
  it('are hidden unless ENABLE_SNAPSHOT_ADMIN is on, even with a valid admin key', async () => {
    for (const flag of [undefined, '0', '']) {
      const { env, db } = envWith({ ENABLE_SNAPSHOT_ADMIN: flag });
      await expectNotFound(handleAdminSnapshotReset(adminRequest('/api/admin/snapshot/reset'), env));
      await expectNotFound(handleAdminSnapshotImport(adminRequest('/api/admin/snapshot/import/users'), env, 'users'));
      expect(db.prepare).not.toHaveBeenCalled();
      expect(db.batch).not.toHaveBeenCalled();
    }
  });
});
