import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiWorldRepository, buildWorldTileManifestRequestPath } from './worldRepository';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('world tile repository request paths', () => {
  const bounds = { minTileX: -1, maxTileX: 2, minTileY: -3, maxTileY: 4 };

  it('preserves the compatible room-summary default', () => {
    const url = new URL(buildWorldTileManifestRequestPath(2, bounds), 'https://game.example');
    expect(url.searchParams.has('includeRooms')).toBe(false);
  });

  it('encodes explicit room-summary inclusion without sharing cache keys', () => {
    const withoutRooms = buildWorldTileManifestRequestPath(2, bounds, { includeRooms: false });
    const withRooms = buildWorldTileManifestRequestPath(2, bounds, { includeRooms: true });
    expect(new URL(withoutRooms, 'https://game.example').searchParams.get('includeRooms')).toBe('0');
    expect(new URL(withRooms, 'https://game.example').searchParams.get('includeRooms')).toBe('1');
    expect(withoutRooms).not.toBe(withRooms);
  });
});

describe('world tile repository credentials', () => {
  it('loads public tile config and manifests without credentials', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      {
        schemaVersion: 1,
        available: true,
        rolloutPercentage: 100,
        activeRendererVersion: 'renderer-1',
      },
      {
        schemaVersion: 1,
        rendererVersion: 'renderer-1',
        level: 0,
        targetBounds: { minTileX: 0, maxTileX: 0, minTileY: 0, maxTileY: 0 },
        entries: [],
        rooms: [],
      },
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return Response.json(responses.shift());
    }));

    const repository = new ApiWorldRepository('https://api.example', null);
    await repository.loadWorldTileConfig();
    await repository.loadWorldTileManifest(0, {
      minTileX: 0,
      maxTileX: 0,
      minTileY: 0,
      maxTileY: 0,
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.init).toMatchObject({ credentials: 'omit', mode: 'cors' });
    expect(requests[1]?.init).toMatchObject({ credentials: 'omit', mode: 'cors' });
  });

  it('loads public world windows without credentials so preview origins can use wildcard CORS', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      center: { x: 0, y: 0 },
      radius: 0,
      rooms: [],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const repository = new ApiWorldRepository('https://api.example', null);
    await repository.loadWorldWindow({ x: 0, y: 0 }, 0);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example/api/world?centerX=0&centerY=0&radius=0',
      { credentials: 'omit', mode: 'cors' },
    );
  });
});
