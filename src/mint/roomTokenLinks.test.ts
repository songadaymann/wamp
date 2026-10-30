import { describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import { buildRoomTokenMetadata, parseRoomTokenMetadataUri } from './roomMetadata';
import { buildRoomTokenPlayUrl, buildRoomTokenViewerUrl, parseRoomPreviewTokenId } from './roomTokenLinks';

describe('collectible room links', () => {
  it('pins play links to the public game, including negative and boundary coordinates', () => {
    expect(buildRoomTokenPlayUrl([-3, 7])).toBe('https://wamp.land/r/-3/7');
    expect(buildRoomTokenPlayUrl([-2147483648, 2147483647])).toBe('https://wamp.land/r/-2147483648/2147483647');
    for (const coordinates of [[NaN, 0], [Infinity, 0], [1.5, 2], [2147483648, 0], [0], [0, 1, 2]]) {
      expect(() => buildRoomTokenPlayUrl(coordinates)).toThrow('Invalid room coordinates.');
    }
  });

  it('opens only the confirmed token identity on the local viewer', () => {
    const room = { mintedChainId: 8453, mintedContractAddress: '0x1111111111111111111111111111111111111111', mintedTokenId: '42' };
    const url = new URL(buildRoomTokenViewerUrl(room)!, 'https://preview.example.test');
    expect(url.origin).toBe('https://preview.example.test');
    expect(url.pathname).toBe('/minted-room.html');
    expect(Object.fromEntries(url.searchParams)).toEqual({ chainId: '8453', contract: room.mintedContractAddress, tokenId: '42' });
    for (const invalid of [{ mintedChainId: null }, { mintedChainId: 0 }, { mintedChainId: NaN },
      { mintedContractAddress: null }, { mintedContractAddress: 'javascript:alert(1)' },
      { mintedTokenId: null }, { mintedTokenId: '0' }, { mintedTokenId: '42&contract=other' }]) {
      expect(buildRoomTokenViewerUrl({ ...room, ...invalid })).toBeNull();
    }
  });

  it('adds a canonical marketplace URL without inheriting preview origins or tracking', async () => {
    const snapshot = createDefaultRoomSnapshot('-3,7', { x: -3, y: 7 });
    const built = await buildRoomTokenMetadata(snapshot, 'data:image/png;base64,AA==', {
      origin: 'https://preview.example.test/?qa=1', chainId: 8453,
      contractAddress: '0x1111111111111111111111111111111111111111', tokenId: '42',
    });
    expect(built.metadata.external_url).toBe('https://wamp.land/r/-3/7');
    expect(new URL(built.metadata.animation_url).origin).toBe('https://preview.example.test');
    for (const external_url of [undefined, 'javascript:alert(1)', 'https://other.example/r/0/0']) {
      const metadata = { ...JSON.parse(built.metadataJson), external_url };
      const uri = `data:application/json;base64,${btoa(JSON.stringify(metadata))}`;
      expect(parseRoomTokenMetadataUri(uri).external_url).toBe('https://wamp.land/r/-3/7');
    }
  });

  it('rejects malformed token identities before a contract read', () => {
    expect(parseRoomPreviewTokenId('42')).toBe(42n);
    expect(parseRoomPreviewTokenId((2n ** 256n - 1n).toString())).toBe(2n ** 256n - 1n);
    for (const value of [null, '', '0', '-1', '01', '1.5', '0x2a', '42junk', ' 42', (2n ** 256n).toString()]) {
      expect(() => parseRoomPreviewTokenId(value)).toThrow('invalid token ID');
    }
  });
});
