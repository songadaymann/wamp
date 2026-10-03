import { describe, expect, it } from 'vitest';
import { resolveRequestedPublicUrl } from './routes';

const shareUrl = (target: string) => new URL(`https://api.wamp.land/api/share/rooms/0,0?url=${encodeURIComponent(target)}`);

describe('room share page ?url=', () => {
  it('ignores links to other sites, so the page cannot be used as an open redirect', () => {
    expect(resolveRequestedPublicUrl(shareUrl('https://example.com/phish'))).toBeNull();
    expect(resolveRequestedPublicUrl(shareUrl('https://wamp.land.evil.example/x'))).toBeNull();
    expect(resolveRequestedPublicUrl(shareUrl('javascript:alert(1)'))).toBeNull();
  });

  it("keeps WAMP's own hosts, previews and local dev", () => {
    expect(resolveRequestedPublicUrl(shareUrl('https://wamp.land/?x=0&y=0'))).toBe('https://wamp.land/?x=0&y=0');
    expect(resolveRequestedPublicUrl(shareUrl('https://preview.wamp.land/r'))).toBe('https://preview.wamp.land/r');
    expect(resolveRequestedPublicUrl(shareUrl('https://feat.wampland.pages.dev/'))).toBe('https://feat.wampland.pages.dev/');
    expect(resolveRequestedPublicUrl(shareUrl('http://localhost:3000/'))).toBe('http://localhost:3000/');
  });
});
