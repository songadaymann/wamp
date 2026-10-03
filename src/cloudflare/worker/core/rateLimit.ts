import type { Env } from './types';

/** A sliding-window limit: at most `limit` events per key in `windowMs`. */
export interface RateLimitRule {
  bucket: string;
  limit: number;
  windowMs: number;
}

const RATE_LIMIT_EVENT_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

/** The caller's IP as Cloudflare saw it. Not spoofable through request headers. */
export function getClientIp(request: Request): string | null {
  const ip = request.headers.get('CF-Connecting-IP')?.trim();
  return ip ? ip : null;
}

/** Keys are stored hashed so the table never holds raw IPs or email addresses. */
export async function hashRateLimitKey(env: Env, value: string): Promise<string> {
  const salt = env.RATE_LIMIT_HASH_SALT?.trim() || env.GUESTBOOK_IP_HASH_SALT?.trim() || 'wamp-rate-limit';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${value}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function isRateLimited(env: Env, rule: RateLimitRule, keyHash: string, now: number = Date.now()): Promise<boolean> {
  const since = new Date(now - rule.windowMs).toISOString();
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM rate_limit_events WHERE bucket = ? AND key_hash = ? AND created_at > ?'
  )
    .bind(rule.bucket, keyHash, since)
    .first<{ count: number | string | null }>();
  return Number(row?.count ?? 0) >= rule.limit;
}

export async function recordRateLimitEvent(env: Env, bucket: string, keyHash: string, now: number = Date.now()): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('INSERT INTO rate_limit_events (bucket, key_hash, created_at) VALUES (?, ?, ?)')
      .bind(bucket, keyHash, new Date(now).toISOString()),
  ]);
}

/** Called from the hourly cron; the longest window in use is one day. */
export async function pruneRateLimitEvents(env: Env, now: number = Date.now()): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limit_events WHERE created_at < ?')
      .bind(new Date(now - RATE_LIMIT_EVENT_RETENTION_MS).toISOString()),
  ]);
}
