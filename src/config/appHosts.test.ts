import { describe, expect, it } from 'vitest';
import { getKnownProductionApiBase, isTrustedAppHostname } from './appHosts';

describe('trusted app hosts', () => {
  it('points Cloudflare Pages preview hosts at the production API', () => {
    expect(getKnownProductionApiBase('7637d1e5.wamp-9i6.pages.dev')).toBe('https://api.wamp.land');
    expect(getKnownProductionApiBase('wamp-9i6.pages.dev')).toBe('https://api.wamp.land');
    expect(getKnownProductionApiBase('feat.wampland.pages.dev')).toBe('https://api.wamp.land');
    expect(getKnownProductionApiBase('localhost')).toBe('');
  });

  it('trusts Workers and Pages preview hostnames for credentialed CORS', () => {
    expect(isTrustedAppHostname('7637d1e5.wamp-9i6.pages.dev')).toBe(true);
    expect(isTrustedAppHostname('a1b2c3d4-everybodys-platformer.novox-robot.workers.dev')).toBe(true);
    expect(isTrustedAppHostname('unrelated.pages.dev')).toBe(false);
  });
});
