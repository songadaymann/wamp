import { describe, expect, it } from 'vitest';
import { matchRoutePattern } from './router';

describe('worker route patterns', () => {
  it('matches exact and prefix routes without overmatching exact paths', () => {
    expect(matchRoutePattern('/api/health', '/api/health')).toBeNull();
    expect(matchRoutePattern('/api/health', '/api/healthcheck')).toBeUndefined();
    expect(matchRoutePattern({ prefix: '/api/auth' }, '/api/auth/session')).toBeNull();
  });

  it('returns regex captures for parameterized routes', () => {
    const match = matchRoutePattern(/^\/api\/profiles\/([^/]+)\/summary$/, '/api/profiles/user-1/summary');
    expect(match?.[1]).toBe('user-1');
  });
});
