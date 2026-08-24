import { describe, expect, it } from 'vitest';
import { corsHeaders, isTrustedAppHostname, isTrustedOrigin } from './http';

const API_URL = 'https://everybodys-platformer.novox-robot.workers.dev/api/auth/session';

function allowOrigin(origin: string, requestUrl = API_URL): string | undefined {
  return (corsHeaders(new Request(requestUrl, { headers: { Origin: origin } })) as Record<string, string>)[
    'Access-Control-Allow-Origin'
  ];
}

function allowsCredentials(origin: string, requestUrl = API_URL): boolean {
  return (
    (corsHeaders(new Request(requestUrl, { headers: { Origin: origin } })) as Record<string, string>)[
      'Access-Control-Allow-Credentials'
    ] === 'true'
  );
}

describe('worker CORS trusted origins', () => {
  it('reflects Cloudflare Workers version and env preview hosts for credentialed requests', () => {
    const previewOrigins = [
      'https://a1b2c3d4-everybodys-platformer.novox-robot.workers.dev',
      'https://deadbeef.everybodys-platformer.novox-robot.workers.dev',
      'https://a1b2c3d4-everybodys-platformer-safety.novox-robot.workers.dev',
      'https://preview.everybodys-platformer-safety.novox-robot.workers.dev',
      'https://feat-ellipse.wampland.pages.dev',
      'https://abc123.wamp.pages.dev',
      'https://7637d1e5.wamp-9i6.pages.dev',
    ];

    for (const origin of previewOrigins) {
      expect(isTrustedOrigin(origin, API_URL), origin).toBe(true);
      expect(allowOrigin(origin), origin).toBe(origin);
      expect(allowsCredentials(origin), origin).toBe(true);
    }
  });

  it('does not treat unrelated workers.dev hosts as credentialed app origins', () => {
    expect(isTrustedAppHostname('unrelated.novox-robot.workers.dev')).toBe(false);
    expect(allowOrigin('https://evil.example')).toBe('*');
    expect(allowsCredentials('https://evil.example')).toBe(false);
  });
});
