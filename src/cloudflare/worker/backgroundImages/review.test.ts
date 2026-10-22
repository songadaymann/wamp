import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/request', async (original) => ({
  ...await original<typeof import('../auth/request')>(),
  requireAuthenticatedRequestAuth: vi.fn(async () => ({ user: { id: 'p1' }, source: 'session', school: null, isAdmin: false })),
}));

import { fixture, NOW } from '../activity/testDatabase';
import type { Env } from '../core/types';
import { handleAdminBackgroundImageRequest, handleBackgroundImageRequest } from './routes';

let f: ReturnType<typeof fixture>;
let env: Env;
let fetcher: ReturnType<typeof vi.fn>;

beforeEach(() => {
  f = fixture();
  env = { ...f.env, ADMIN_API_KEY: 'test-admin-key', CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_IMAGES_API_TOKEN: 'token',
    CLOUDFLARE_IMAGES_ACCOUNT_HASH: 'hash' } as Env;
  fetcher = vi.fn(async () => Response.json({ success: true }));
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { f.sqlite.close(); vi.unstubAllGlobals(); });

function insertUpload(status: string): void {
  f.sqlite.prepare(`INSERT INTO background_image_uploads (id, cloudflare_image_id, owner_user_id, owner_display_name,
    original_filename, mime_type, size_bytes, status, upload_requested_at, created_at, updated_at)
    VALUES ('bg-1', 'cf-1', 'p1', 'p1', 'photo.webp', 'image/webp', 1000, ?, ?, ?, ?)`).run(status, NOW, NOW, NOW);
}
function finalize() {
  const url = new URL('https://api.wamp.land/api/background-images/bg-1/finalize');
  return handleBackgroundImageRequest(new Request(url, { method: 'POST' }), url, env);
}
const upload = () => f.sqlite.prepare('SELECT status, cloudflare_deleted_at FROM background_image_uploads WHERE id = ?')
  .get('bg-1') as { status: string; cloudflare_deleted_at: string | null };
function review(decision: 'approved' | 'rejected') {
  const url = new URL('https://api.wamp.land/api/admin/background-images/bg-1/review');
  const request = new Request(url, { method: 'POST', headers: { 'x-admin-key': 'test-admin-key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }) });
  return handleAdminBackgroundImageRequest(request, url, env);
}

describe('background photo finalize and review (F409)', () => {
  it.each(['pending_review', 'approved', 'rejected', 'blocked'])('refuses to finalize an upload that is %s', async (status) => {
    insertUpload(status);
    await expect(finalize()).rejects.toMatchObject({ status: 409 });
    expect(upload().status).toBe(status);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('finalizes a pending upload once', async () => {
    const webp = new Uint8Array(readFileSync(new URL('../../../../docs/review/assets/wamp-background-choice-240px-32colors-2026-10-13.webp', import.meta.url)));
    fetcher.mockImplementation(async (input: string) => input.endsWith('/blob')
      ? new Response(webp)
      : Response.json({ success: true, result: { id: 'cf-1', uploaded: NOW, draft: false } }));
    env.BACKGROUND_UPLOAD_SKIP_AI_MODERATION = '1';
    insertUpload('upload_pending');
    expect((await finalize()).status).toBe(200);
    expect(upload().status).toBe('pending_review');
    await expect(finalize()).rejects.toMatchObject({ status: 409 });
  });

  it('deletes the Cloudflare image when an admin rejects a photo, and then refuses to approve it', async () => {
    insertUpload('pending_review');
    expect((await review('rejected')).status).toBe(200);
    expect(fetcher).toHaveBeenCalledWith('https://api.cloudflare.com/client/v4/accounts/acct/images/v1/cf-1',
      expect.objectContaining({ method: 'DELETE' }));
    expect(upload()).toEqual({ status: 'rejected', cloudflare_deleted_at: expect.any(String) });
    await expect(review('approved')).rejects.toMatchObject({ status: 409 });
    expect(upload().status).toBe('rejected');
  });

  it('keeps a rejected photo marked as not deleted when the delete fails, so rejecting again retries', async () => {
    insertUpload('pending_review');
    fetcher.mockResolvedValueOnce(new Response('error', { status: 500 }));
    expect((await review('rejected')).status).toBe(200);
    expect(upload()).toEqual({ status: 'rejected', cloudflare_deleted_at: null });
    expect((await review('rejected')).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(upload().cloudflare_deleted_at).not.toBeNull();
  });

  it('approves without deleting anything', async () => {
    insertUpload('pending_review');
    expect((await review('approved')).status).toBe(200);
    expect(fetcher).not.toHaveBeenCalled();
    expect(upload()).toEqual({ status: 'approved', cloudflare_deleted_at: null });
  });
});
