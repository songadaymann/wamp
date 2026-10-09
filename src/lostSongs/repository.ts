import { getApiBaseUrl } from '../api/baseUrl';
import { readApiErrorMessage } from '../api/readApiErrorMessage';
import { captureGuestRunIdentity, type GuestRunRecoveryIdentity } from '../guestRooms/runRepository';
import type { LostSongFindBody, LostSongFindReceipt, LostSongPlaySession, LostSongProgress, LostSongTarget } from './model';

export interface LostSongIdentity { userId: string | null; guest: GuestRunRecoveryIdentity }
export interface LostSongRepository {
  progress(cursor: string): Promise<LostSongProgress & { nextCursor: string | null }>;
  play(target: LostSongTarget, identity: LostSongIdentity): Promise<LostSongPlaySession>;
  find(body: LostSongFindBody, identity: LostSongIdentity): Promise<LostSongFindReceipt>;
  claim(roomIds: string[], identity: LostSongIdentity): Promise<{ claimed: string[]; skipped: string[]; xp: number }>;
}
export class LostSongApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function captureLostSongIdentity(userId: string | null): LostSongIdentity {
  return { userId, guest: captureGuestRunIdentity() };
}
export function createLostSongRepository(baseUrl = getApiBaseUrl()): LostSongRepository {
  async function request<T>(path: string, body?: object, identity?: LostSongIdentity, claim = false): Promise<T> {
    const headers = new Headers();
    if (identity && (!identity.userId || claim)) {
      headers.set('X-Guest-User-Id', identity.guest.guestUserId);
      headers.set('X-Guest-Recovery-Token', identity.guest.recoveryToken);
    }
    if (body) headers.set('Content-Type', 'application/json');
    const response = await fetch(baseUrl + path, {
      method: body ? 'POST' : 'GET', headers, credentials: identity?.userId === null ? 'omit' : 'include',
      body: body ? JSON.stringify({ ...body, expectedUserId: identity?.userId ?? null }) : undefined,
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new LostSongApiError(response.status,
      await readApiErrorMessage(response, 'Lost Song progress could not be saved.'));
    return response.json() as Promise<T>;
  }
  return {
    progress: cursor => request('/api/lost-songs/progress?cursor=' + encodeURIComponent(cursor)),
    play: (target, identity) => request('/api/lost-songs/play', target, identity),
    find: (body, identity) => request('/api/lost-songs/find', body, identity),
    claim: (roomIds, identity) => request('/api/lost-songs/claim', { roomIds }, identity, true),
  };
}
