import { HttpError } from '../core/http';
import type { D1DatabaseSession } from '../core/types';
import { unsubscribeActivityEmail, type PreferenceRow } from './store';
import { escapeEmailHtml } from '../email/delivery';

type Scope = 'digest' | 'dethroned';
interface Claims { userId: string; scope: Scope; expiresAt: number }
const bytes = (value: string) => new TextEncoder().encode(value);
function encode(value: Uint8Array): string { return btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function decode(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)); }
async function key(secret: string): Promise<CryptoKey> { return crypto.subtle.importKey('raw', bytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
export async function createActivityUnsubscribeToken(prefs: PreferenceRow, scope: Scope, now: string): Promise<string> {
  const payload = encode(bytes(JSON.stringify({ userId: prefs.user_id, scope, expiresAt: Date.parse(now) + 365 * 86400000 })));
  const signature = await crypto.subtle.sign('HMAC', await key(prefs.unsubscribe_secret), bytes(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function handleActivityUnsubscribe(request: Request, url: URL, db: D1DatabaseSession, now = Date.now()): Promise<Response> {
  const token = url.searchParams.get('token') ?? '';
  let claims: Claims;
  let prefs: PreferenceRow | null;
  try {
    if (token.length > 2048) throw new Error('Token too long');
    const parts = token.split('.');
    if (parts.length !== 2) throw new Error('Invalid token');
    claims = JSON.parse(new TextDecoder().decode(decode(parts[0]))) as Claims;
    if (typeof claims.userId !== 'string' || !['digest', 'dethroned'].includes(claims.scope)
      || !Number.isSafeInteger(claims.expiresAt) || claims.expiresAt <= now) throw new Error('Expired token');
    prefs = await db.prepare('SELECT * FROM builder_activity_preferences WHERE user_id = ?').bind(claims.userId).first<PreferenceRow>();
    if (!prefs || !await crypto.subtle.verify('HMAC', await key(prefs.unsubscribe_secret), decode(parts[1]), bytes(parts[0]))) throw new Error('Invalid signature');
  } catch { throw new HttpError(400, 'This unsubscribe link is invalid or expired. Change your preferences in Activity.'); }
  const label = claims.scope === 'digest' ? 'weekly activity emails' : 'lost #1 emails';
  if (request.method === 'POST') {
    await unsubscribeActivityEmail(db, claims.userId, claims.scope, new Date(now).toISOString());
  }
  const body = request.method === 'POST' ? `<p>You have unsubscribed from ${label}.</p>`
    : `<p>Stop receiving ${label}?</p><form method="post" action="${escapeEmailHtml(url.pathname + url.search)}"><button type="submit">Unsubscribe</button></form>`;
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WAMP email preferences</title><body><h1>WAMP email preferences</h1>${body}<p><a href="https://wamp.land/?activity=1">Open Activity</a></p></body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" },
  });
}
