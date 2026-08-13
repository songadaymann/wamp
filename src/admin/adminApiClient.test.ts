import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminApiClient, createAdminResponseClient } from './adminApiClient';

afterEach(() => vi.unstubAllGlobals());

describe('admin API client', () => {
  it('adds the shared admin key and JSON content type without replacing caller headers', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createAdminApiClient(() => 'fixture-key');

    await expect(client.request('/api/admin/fixture', {
      method: 'POST',
      headers: { 'x-fixture': 'yes' },
      body: '{}',
    })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/fixture'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-fixture': 'yes',
          'x-admin-key': 'fixture-key',
        },
        body: '{}',
      },
    );
  });

  it('preserves the invalid-key and response-text errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })));
    const client = createAdminApiClient(() => 'bad-key');
    await expect(client.request('/api/admin/fixture')).rejects.toThrow('Invalid admin key.');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('fixture failed', { status: 500 })));
    await expect(client.request('/api/admin/fixture')).rejects.toThrow('fixture failed');
  });

  it('provides the raw response client used by endpoint-specific launch errors', async () => {
    const response = new Response('fixture', { status: 409 });
    const fetchMock = vi.fn(async () => response);
    vi.stubGlobal('fetch', fetchMock);
    const client = createAdminResponseClient(() => 'fixture-key');

    await expect(client.request('/api/admin/fixture')).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/admin/fixture'), {
      headers: { 'x-admin-key': 'fixture-key' },
    });
  });
});
