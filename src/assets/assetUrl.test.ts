import { describe, expect, it } from 'vitest';
import { assetUrl, isContentVersionedAsset } from './assetUrl';

const hashes = { 'assets/objects/flag.png': '123456abcdef', 'assets/fonts/Font Name.ttf': 'abcdef123456' };

describe('public asset content versions', () => {
  it('replaces old manual versions, retains other query data and fragments, and is idempotent', () => {
    const path = 'assets/objects/flag.png?fit=wide&v=old#preview';
    const result = assetUrl(path, hashes);
    expect(result).toBe('assets/objects/flag.png?fit=wide&v=123456abcdef#preview');
    expect(assetUrl(result, hashes)).toBe(result);
    expect(assetUrl('/assets/fonts/Font%20Name.ttf', hashes)).toBe('/assets/fonts/Font%20Name.ttf?v=abcdef123456');
  });
  it('keeps external, uploaded, data, blob and unknown URLs intact', () => {
    for (const path of ['https://cdn.example/assets/objects/flag.png', '//cdn.example/art.png', '/api/background-images/id/image', 'data:image/png;base64,AAAA', 'blob:example', '/assets/unknown.png', '/assets/%broken', 'constructor']) expect(assetUrl(path, hashes)).toBe(path);
  });
  it('recognizes only the current content version for immutable responses', () => {
    expect(isContentVersionedAsset('/assets/objects/flag.png', '123456abcdef', hashes)).toBe(true);
    expect(isContentVersionedAsset('/assets/objects/flag.png', 'old', hashes)).toBe(false);
    expect(isContentVersionedAsset('/assets/unknown.png', '123456abcdef', hashes)).toBe(false);
    expect(isContentVersionedAsset('/assets/objects/flag.png', null, hashes)).toBe(false);
  });
});
