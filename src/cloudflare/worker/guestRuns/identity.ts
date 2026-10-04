import { HttpError } from '../core/http';
import { getClientIp, hashRateLimitKey, networkKeyForIp, takeRateLimitSlots } from '../core/rateLimit';
import type { Env } from '../core/types';

export interface GuestRunIdentity { guestUserId: string; recoveryTokenHash: string }
export async function hashGuestRunValue(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function guestRunIdentity(request: Request): Promise<GuestRunIdentity> {
  const id = request.headers.get('X-Guest-User-Id')?.trim();
  const token = request.headers.get('X-Guest-Recovery-Token')?.trim();
  if (!id || !/^guest-[A-Za-z0-9_-]{1,74}$/.test(id) || !token || !/^[A-Za-z0-9_-]{32,160}$/.test(token)) {
    throw new HttpError(400, 'A valid guest recovery identity is required.');
  }
  return { guestUserId: id, recoveryTokenHash: await hashGuestRunValue(token) };
}
export async function limitGuestRunRequest(env: Env, request: Request, identity: GuestRunIdentity, action: 'start' | 'finish' | 'claim'): Promise<void> {
  const ip = getClientIp(request);
  const windowMs = 60_000;
  const checks = [{ rule: { bucket: `guest_run_${action}_identity`, limit: action === 'claim' ? 10 : 30, windowMs },
    keyHash: await hashRateLimitKey(env, `${identity.guestUserId}:${identity.recoveryTokenHash}`) }];
  if (ip) checks.push({ rule: { bucket: `guest_run_${action}_network`, limit: action === 'claim' ? 30 : 120, windowMs },
    keyHash: await hashRateLimitKey(env, networkKeyForIp(ip)) });
  if ((await takeRateLimitSlots(env, checks)).limitedBy) throw new HttpError(429, 'Please wait before saving more guest progress.');
}
