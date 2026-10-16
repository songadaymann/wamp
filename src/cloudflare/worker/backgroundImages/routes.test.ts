import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleBackgroundImageRequest } from './routes';
import type { Env } from '../core/types';

function envWithApprovedImage(imageId = 'cf-image-1', status = 'approved'): Env {
  const row = {
    id: 'bg-1',
    status,
    cloudflare_image_id: imageId,
    cloudflare_deleted_at: null,
    mime_type: 'image/png',
  };
  return {
    DB: { prepare: () => ({ bind: () => ({ first: async () => row }) }) },
    CLOUDFLARE_IMAGES_ACCOUNT_HASH: 'hash',
    CLOUDFLARE_IMAGES_BACKGROUND_VARIANT: 'public',
  } as unknown as Env;
}

describe('background image delivery (F094)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('serves the exact selected derivative behind the existing approval gate', async () => {
    const fetcher = vi.fn(async () => new Response('selected-webp', { headers: { 'Content-Type': 'image/webp' } }));
    vi.stubGlobal('fetch', fetcher);
    const request = new Request('https://api.wamp.land/api/background-images/59f7f031-fba7-4447-550d-4f8b96bf4000/image?v=2');
    await handleBackgroundImageRequest(request, new URL(request.url), envWithApprovedImage('59f7f031-fba7-4447-550d-4f8b96bf4000'));
    expect(fetcher).toHaveBeenCalledWith('https://imagedelivery.net/hash/e38f4df1-02ed-4a55-3eb3-97264e9b8f00/public', expect.anything());
    fetcher.mockClear();
    await expect(handleBackgroundImageRequest(request, new URL(request.url), envWithApprovedImage('59f7f031-fba7-4447-550d-4f8b96bf4000', 'rejected'))).rejects.toMatchObject({ status: 404 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('forwards Accept to Cloudflare Images and tells caches the reply depends on it', async () => {
    const delivery = vi.fn(async () => new Response('webp-bytes', {
      status: 200,
      headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=172800', Vary: 'Accept' },
    }));
    vi.stubGlobal('fetch', delivery);
    const request = new Request('https://api.wamp.land/api/background-images/bg-1/image', {
      headers: { Accept: 'image/avif,image/webp,*/*', Origin: 'https://wamp.land' },
    });

    const response = await handleBackgroundImageRequest(request, new URL(request.url), envWithApprovedImage());

    expect(delivery).toHaveBeenCalledWith('https://imagedelivery.net/hash/cf-image-1/public', expect.anything());
    const forwarded = new Headers((delivery.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
    expect(forwarded.get('Accept')).toBe('image/avif,image/webp,*/*');
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    const vary = (response.headers.get('Vary') ?? '').split(',').map((value) => value.trim());
    expect(vary).toContain('Accept');
    expect(vary).toContain('Origin');
    expect(vary.filter((value) => value === 'Accept')).toHaveLength(1);
  });
});
