import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import { buildRoomTokenArtwork, buildPixelSharpRoomImage } from './roomTokenArtwork';
import { renderRoomSnapshotToPngDataUrl } from './roomMetadataRender';
import { parseRoomTokenMetadataUri } from './roomMetadata';

vi.mock('./roomMetadataRender', () => ({ renderRoomSnapshotToPngDataUrl: vi.fn() }));
const snapshot = createDefaultRoomSnapshot('-3,7', { x: -3, y: 7 });
const options = { origin: 'https://wamp.land', chainId: 8453,
  contractAddress: '0x1111111111111111111111111111111111111111', tokenId: '42' };

describe('bounded embedded room artwork', () => {
  beforeEach(() => vi.resetAllMocks());

  it('keeps embedded PNG pixels and explicit sharp 640×352 display dimensions', () => {
    const png = 'data:image/png;base64,YQ==';
    const svg = decodeURIComponent(buildPixelSharpRoomImage(png).split(',').slice(1).join(','));
    expect(svg).toContain('width="640" height="352"');
    expect(svg).toContain(`href="${png}"`);
    expect(svg).toContain('image-rendering:pixelated');
    for (const value of ['https://example.test/room.png', 'data:image/png;base64,AA=="/><script/>', 'data:image/svg+xml,<svg/>']) {
      expect(() => buildPixelSharpRoomImage(value)).toThrow('embedded PNG');
    }
  });

  it('selects the clearest fitting strict render without dropping the playable room payload', async () => {
    vi.mocked(renderRoomSnapshotToPngDataUrl).mockResolvedValueOnce('data:image/png;base64,' + 'A'.repeat(20000))
      .mockResolvedValueOnce('data:image/png;base64,YQ==');
    const built = await buildRoomTokenArtwork(snapshot, options);
    expect(vi.mocked(renderRoomSnapshotToPngDataUrl).mock.calls.map(call => call[1])).toEqual([
      { tilePixelSize: 16, strictAssets: true }, { tilePixelSize: 8, strictAssets: true },
    ]);
    expect(built.tokenUri.length).toBeLessThanOrEqual(20000);
    const parsed = parseRoomTokenMetadataUri(built.tokenUri);
    expect(parsed.wamp_room.roomId).toBe('-3,7');
    expect(parsed.wamp_room.coordinates).toEqual([-3, 7]);
    expect(parsed.external_url).toBe('https://wamp.land/r/-3/7');
    expect(parsed.image).toContain('data:image/svg+xml,');
  });

  it('fails closed for missing assets and never substitutes approximate artwork', async () => {
    vi.mocked(renderRoomSnapshotToPngDataUrl).mockRejectedValue(new Error('Missing custom asset'));
    await expect(buildRoomTokenArtwork(snapshot, options)).rejects.toThrow('Missing custom asset');
    expect(renderRoomSnapshotToPngDataUrl).toHaveBeenCalledOnce();
  });

  it('refuses oversized complete metadata before any wallet request', async () => {
    vi.mocked(renderRoomSnapshotToPngDataUrl).mockResolvedValue('data:image/png;base64,' + 'A'.repeat(20000));
    await expect(buildRoomTokenArtwork(snapshot, options)).rejects.toThrow('too large');
    expect(vi.mocked(renderRoomSnapshotToPngDataUrl).mock.calls.map(call => call[1]?.tilePixelSize)).toEqual([16, 8, 4, 2]);
  });
});
