import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleBackgroundImageRequest } from './routes';
import type { Env } from '../core/types';

function envWithApprovedImage(): Env {
  const row = {
    id: 'bg-1',
    status: 'approved',
    cloudflare_image_id: 'cf-image-1',
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
