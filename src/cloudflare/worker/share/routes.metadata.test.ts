import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExpandedRoomSource, ResolvedExpandedRoomTarget } from '../../../expandedRooms/model';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import type { Env } from '../core/types';
import { resolveExpandedRoomAtCoordinates } from '../expandedRooms/store';
import { loadPublishedRoom, loadRoomSnapshotsByReferences } from '../rooms/store';
import { handleRoomShareRequest } from './routes';

vi.mock('../expandedRooms/store', () => ({ resolveExpandedRoomAtCoordinates: vi.fn() }));
vi.mock('../rooms/store', () => ({ loadPublishedRoom: vi.fn(), loadRoomSnapshotsByReferences: vi.fn() }));

const env = { EXPANDED_ROOMS_ENABLED: '1' } as Env;
const anchor = { ...createDefaultRoomSnapshot('11,-12', { x: 11, y: -12 }), title: 'Anchor cell', version: 7 };
const member = { ...createDefaultRoomSnapshot('12,-12', { x: 12, y: -12 }), title: 'Individual cell title', version: 9 };

function target(source: ExpandedRoomSource = 'native_expanded_room'): ResolvedExpandedRoomTarget {
  return {
    expandedRoomId: 'course:fixture', title: '  Whole\n Adventure  ', goalType: 'reach_exit',
    cellCount: 2, source, legacyCourseId: 'fixture', ownerUserId: 'private-owner-id',
    ownerDisplayName: '  Farès\n Builder <Public>  ', anchorRoomId: anchor.id,
    anchorCoordinates: anchor.coordinates, focusedCoordinates: member.coordinates,
    version: 3, publishedAt: '2026-10-05T00:00:00.000Z',
    cells: [anchor, member].map(snapshot => ({ roomId: snapshot.id, coordinates: snapshot.coordinates,
      roomVersion: snapshot.version, roomTitle: snapshot.title, protectedMinted: false })),
  };
}

async function requestShare(kind = 'meta', method = 'GET'): Promise<Response> {
  const url = new URL(`https://api.wamp.land/api/share/rooms/12%2C-12${kind ? `/${kind}` : ''}`);
  url.searchParams.set('url', 'https://wamp.land/r/12/-12');
  return handleRoomShareRequest(new Request(url, { method }), url, env);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(resolveExpandedRoomAtCoordinates).mockResolvedValue(target());
  vi.mocked(loadPublishedRoom).mockResolvedValue(member);
  vi.mocked(loadRoomSnapshotsByReferences).mockImplementation(async (_env, references) => ({
    snapshots: references.map(reference => ({ reference,
      key: `version:${reference.roomId}:${reference.kind === 'version' ? reference.version : ''}`,
      snapshot: reference.roomId === anchor.id ? anchor : member })), missing: [],
  }));
});

describe('published room share metadata builder credit', () => {
  it.each(['native_expanded_room', 'legacy_course'] as const)(
    'credits the published %s owner and preserves the focused member footprint image',
    async source => {
      vi.mocked(resolveExpandedRoomAtCoordinates).mockResolvedValue(target(source));
      const response = await requestShare();
      const metadata = await response.json();

      expect(metadata).toMatchObject({ title: 'Whole Adventure by Farès Builder <Public> on WAMP',
        builderDisplayName: 'Farès Builder <Public>', coordinates: member.coordinates,
        roomVersion: 9, url: 'https://wamp.land/r/12/-12',
        expandedRoom: { expandedRoomId: 'course:fixture', source, cellCount: 2 } });
      expect(metadata.description).toBe('Whole Adventure by Farès Builder <Public> is a 2-cell Expanded Room in WAMP. Beat the reach exit challenge.');
      const image = new URL(metadata.imageUrl);
      expect(image.pathname).toBe('/api/share/rooms/12%2C-12/image');
      expect(image.searchParams.get('area')).toBe('course:fixture');
      expect(image.searchParams.get('av')).toBe('3');
      expect(image.searchParams.get('v')).toBe('9');
      expect(metadata).not.toHaveProperty('ownerUserId');
      expect(metadata.expandedRoom).not.toHaveProperty('ownerUserId');
      expect(loadPublishedRoom).not.toHaveBeenCalled();
      expect(resolveExpandedRoomAtCoordinates).toHaveBeenCalledOnce();
    },
  );

  it('credits a standalone published room without treating it as a footprint', async () => {
    const standalone = { ...target('standalone_room'), expandedRoomId: 'room:12,-12',
      cellCount: 1, cells: [target().cells[1]], anchorRoomId: member.id, anchorCoordinates: member.coordinates };
    vi.mocked(resolveExpandedRoomAtCoordinates).mockResolvedValue(standalone);
    const metadata = await (await requestShare()).json();
    expect(metadata.title).toBe('Individual cell title by Farès Builder <Public> on WAMP');
    expect(metadata.builderDisplayName).toBe('Farès Builder <Public>');
    expect(metadata.expandedRoom).toBeNull();
    expect(new URL(metadata.imageUrl).searchParams.has('area')).toBe(false);
    expect(loadRoomSnapshotsByReferences).not.toHaveBeenCalled();
  });

  it('omits unknown builder credit instead of inventing a name', async () => {
    vi.mocked(resolveExpandedRoomAtCoordinates).mockResolvedValue({ ...target(), ownerDisplayName: ' \n ' });
    const metadata = await (await requestShare()).json();
    expect(metadata.builderDisplayName).toBeNull();
    expect(metadata.title).toBe('Whole Adventure on WAMP');
    expect(metadata.description).not.toContain(' by ');
  });

  it('does not expose a draft when no published target exists', async () => {
    vi.mocked(resolveExpandedRoomAtCoordinates).mockResolvedValue(null);
    vi.mocked(loadPublishedRoom).mockResolvedValue(null);
    await expect(requestShare()).rejects.toMatchObject({ status: 404 });
  });

  it('retains published single-cell behavior when Expanded Rooms are disabled', async () => {
    const url = new URL('https://api.wamp.land/api/share/rooms/12%2C-12/meta');
    const response = await handleRoomShareRequest(new Request(url), url, { ...env, EXPANDED_ROOMS_ENABLED: '0' });
    expect(await response.json()).toMatchObject({ title: 'Individual cell title on WAMP',
      builderDisplayName: null, expandedRoom: null });
    expect(resolveExpandedRoomAtCoordinates).not.toHaveBeenCalled();
  });

  it.each(['GET', 'HEAD'])('escapes public builder names in the share HTML and retains %s behavior', async method => {
    const response = await requestShare('', method);
    expect(response.status).toBe(200);
    const html = await response.text();
    if (method === 'HEAD') expect(html).toBe('');
    else expect(html).toContain('Whole Adventure by Farès Builder &lt;Public&gt; on WAMP');
  });
});
