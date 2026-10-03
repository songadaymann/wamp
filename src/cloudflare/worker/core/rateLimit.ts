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

/**
 * Network identity for per-network limits. An IPv6 client usually controls a whole /64, so
 * limits key on that prefix; IPv4 (and IPv4-mapped IPv6) stays per address.
 */
export function networkKeyForIp(ip: string): string {
  const lower = ip.trim().toLowerCase().split('%')[0];
  if (!lower.includes(':')) return `ip:${lower}`;
  const mapped = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return `ip:${mapped[1]}`;
  const hasGap = lower.includes('::');
  const [head, tail = ''] = hasGap ? lower.split('::') : [lower, ''];
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const fill = hasGap ? Math.max(0, 8 - headParts.length - tailParts.length) : 0;
  const parts = [...headParts, ...Array<string>(fill).fill('0'), ...tailParts];
  const prefix = parts.slice(0, 4).map((part) => (parseInt(part, 16) || 0).toString(16)).join(':');
  return `ip6:${prefix}::/64`;
}

/** Plus-tags and Gmail dots deliver to the same inbox, so inbox-flood limits treat them as one. */
export function canonicalMailbox(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return email;
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

/** Keys are stored hashed so the table never holds raw IPs or email addresses. */
export async function hashRateLimitKey(env: Env, value: string): Promise<string> {
  const salt = env.RATE_LIMIT_HASH_SALT?.trim() || env.GUESTBOOK_IP_HASH_SALT?.trim() || 'wamp-rate-limit';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${value}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Takes one slot under the rule in a single statement, so a burst of parallel requests cannot
 * all pass the count before any of them records. Returns the slot id, or null when limited.
 */
export async function takeRateLimitSlot(
  env: Env,
  rule: RateLimitRule,
  keyHash: string,
  now: number = Date.now(),
): Promise<number | null> {
  const row = await env.DB.prepare(
    `INSERT INTO rate_limit_events (bucket, key_hash, created_at)
     SELECT ?, ?, ?
     WHERE (SELECT COUNT(*) FROM rate_limit_events WHERE bucket = ? AND key_hash = ? AND created_at > ?) < ?
     RETURNING id`
  )
    .bind(
      rule.bucket, keyHash, new Date(now).toISOString(),
      rule.bucket, keyHash, new Date(now - rule.windowMs).toISOString(), rule.limit,
    )
    .first<{ id: number | string }>();
  return row ? Number(row.id) : null;
}

/** Gives back slots for an action that did not happen or should not count. */
export async function releaseRateLimitSlots(env: Env, ids: Array<number | null>): Promise<void> {
  const taken = ids.filter((id): id is number => id !== null);
  if (taken.length === 0) return;
  await env.DB.batch(taken.map((id) => env.DB.prepare('DELETE FROM rate_limit_events WHERE id = ?').bind(id)));
}

/** Takes a slot under every rule, or none: if any rule is full, the others are given back. */
export async function takeRateLimitSlots(
  env: Env,
  checks: Array<{ rule: RateLimitRule; keyHash: string }>,
): Promise<{ ids: number[]; limitedBy: RateLimitRule | null }> {
  const ids: number[] = [];
  for (const { rule, keyHash } of checks) {
    const id = await takeRateLimitSlot(env, rule, keyHash);
    if (id === null) {
      await releaseRateLimitSlots(env, ids);
      return { ids: [], limitedBy: rule };
    }
    ids.push(id);
  }
  return { ids, limitedBy: null };
}

export async function clearRateLimitEvents(env: Env, bucket: string, keyHash: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limit_events WHERE bucket = ? AND key_hash = ?').bind(bucket, keyHash),
  ]);
}

/** Clears every key in a bucket (for buckets scoped to one account, keyed per network). */
export async function clearRateLimitBucket(env: Env, bucket: string): Promise<void> {
  await env.DB.batch([env.DB.prepare('DELETE FROM rate_limit_events WHERE bucket = ?').bind(bucket)]);
}

/** Called from the hourly cron; the longest window in use is one day. */
export async function pruneRateLimitEvents(env: Env, now: number = Date.now()): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limit_events WHERE created_at < ?')
      .bind(new Date(now - RATE_LIMIT_EVENT_RETENTION_MS).toISOString()),
  ]);
}
