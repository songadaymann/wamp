import { getApiBaseUrl } from '../api/baseUrl';
import { readApiErrorMessage } from '../api/readApiErrorMessage';
import { resolveWorldPresenceGuestIdentity } from '../presence/worldPresence';
import type { RunFinishRequestBody } from '../runs/model';
import { resolveGuestRecoveryToken } from './identity';
import type {
  GuestRunClaimResponse, GuestRunClearListResponse, GuestRunClaimedListResponse, GuestRunFinishResponse,
  GuestRunStartBody, GuestRunStartResponse,
} from './runModel';

export interface GuestRunRecoveryIdentity { guestUserId: string; recoveryToken: string }
export interface GuestRunRepository {
  start(body: GuestRunStartBody, identity: GuestRunRecoveryIdentity): Promise<GuestRunStartResponse>;
  findStart(clientRunId: string, identity: GuestRunRecoveryIdentity): Promise<GuestRunStartResponse>;
  finish(attemptId: string, body: RunFinishRequestBody, identity: GuestRunRecoveryIdentity): Promise<GuestRunFinishResponse>;
  listPending(identity: GuestRunRecoveryIdentity): Promise<GuestRunClearListResponse>;
  claim(claimId: string, identity: GuestRunRecoveryIdentity, expectedUserId: string): Promise<GuestRunClaimResponse>;
  listClaimed(): Promise<GuestRunClaimedListResponse>;
}
export class GuestRunApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function captureGuestRunIdentity(): GuestRunRecoveryIdentity {
  return { guestUserId: resolveWorldPresenceGuestIdentity().userId, recoveryToken: resolveGuestRecoveryToken() };
}

export function createGuestRunRepository(baseUrl = getApiBaseUrl()): GuestRunRepository {
  async function request<T>(path: string, identity: GuestRunRecoveryIdentity | null, body?: unknown, authenticated = false): Promise<T> {
    const headers = new Headers();
    if (identity) {
      headers.set('X-Guest-User-Id', identity.guestUserId);
      headers.set('X-Guest-Recovery-Token', identity.recoveryToken);
    }
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: authenticated ? 'include' : 'omit', signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new GuestRunApiError(response.status,
      await readApiErrorMessage(response, `Guest progress request failed with status ${response.status}.`));
    return response.json() as Promise<T>;
  }
  return {
    start: (body, identity) => request('/api/guest-runs/start', identity, body),
    findStart: (clientRunId, identity) => request(`/api/guest-runs/by-client/${encodeURIComponent(clientRunId)}`, identity),
    finish: (id, body, identity) => request(`/api/guest-runs/${encodeURIComponent(id)}/finish`, identity, body),
    listPending: identity => request('/api/guest-runs/mine', identity),
    claim: (claimId, identity, expectedUserId) => request('/api/me/claim-guest', identity, { claimId, expectedUserId }, true),
    listClaimed: () => request('/api/me/guest-progress', null, undefined, true),
  };
}
