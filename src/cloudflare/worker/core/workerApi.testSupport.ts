import worker from '../../worker';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import { fixture } from '../activity/testDatabase';
import { createSession } from '../auth/store';
import type { Env } from './types';

/**
 * The whole API Worker on the real migrated database (activity/testDatabase), called the way the
 * browser and bots call it: by URL, with a session cookie or a bearer token. Tests written against
 * this keep working when the handlers behind a URL are moved or merged.
 */
export const ADMIN_KEY = 'fixture-admin-key';
const ORIGIN = 'https://wamp.land';

export interface ApiOptions {
  method?: string;
  body?: unknown;
  /** A session token from signIn(). */
  session?: string | null;
  /** An API or agent token. */
  bearer?: string | null;
  /** null sends no Origin header. */
  origin?: string | null;
  admin?: boolean;
}

export interface ApiResponse {
  status: number;
  /** Loosely typed JSON: each assertion names the fields it needs. */
  body: any;
  headers: Headers;
}

export function workerApi(envOverrides: Partial<Env> = {}) {
  const f = fixture();
  Object.assign(f.env, { ADMIN_API_KEY: ADMIN_KEY }, envOverrides);
  const deferred: Promise<unknown>[] = [];
  const context = { waitUntil: (promise: Promise<unknown>) => { deferred.push(promise); } };

  async function call(path: string, options: ApiOptions = {}): Promise<ApiResponse> {
    const headers = new Headers();
    if (options.origin !== null) headers.set('Origin', options.origin ?? ORIGIN);
    if (options.session) headers.set('Cookie', `ep_session=${options.session}`);
    if (options.bearer) headers.set('Authorization', `Bearer ${options.bearer}`);
    if (options.admin) headers.set('x-admin-key', ADMIN_KEY);
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const method = options.method ?? (body === undefined ? 'GET' : 'POST');
    const response = await worker.fetch(new Request(`https://api.wamp.land${path}`, { method, headers, body }), f.env, context);
    // Deferred work (the playable-content index) finishes before the next call, as it would in production.
    await Promise.all(deferred.splice(0));
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  }

  return {
    ...f,
    call,
    signIn: (userId: string) => createSession(f.env, userId),
    /** Admin builder-cap overrides, as the progression admin page sets them. */
    setBuilderCaps: async (userId: string, caps: Record<string, number | null>) => {
      const response = await call(`/api/admin/progression/users/${encodeURIComponent(userId)}/caps`, {
        admin: true,
        body: { claimLimitPerDay: null, publishLimitPerDay: null, objectLimit: null, collectibleLimit: null,
          expandedRoomCellLimit: null, reason: 'fixture', operatorLabel: 'fixture', ...caps },
      });
      if (response.status !== 200) throw new Error(`setBuilderCaps failed: ${JSON.stringify(response.body)}`);
    },
    close: () => f.sqlite.close(),
  };
}

export type WorkerApi = ReturnType<typeof workerApi>;

/** A publishable room at x,y: a title and a reach-the-exit goal. */
export function roomSnapshot(x: number, y: number, changes: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    ...createDefaultRoomSnapshot(`${x},${y}`, { x, y }),
    title: `Room ${x},${y}`,
    goal: { type: 'reach_exit', exit: { x: 700, y: 320 }, timeLimitMs: null },
    ...changes,
  };
}

const roomPath = (x: number, y: number, action: string, query = '') =>
  `/api/rooms/${encodeURIComponent(`${x},${y}`)}/${action}${query ? `?${query}` : ''}`;

export function saveRoomDraft(api: WorkerApi, session: string, snapshot: RoomSnapshot, query = '') {
  return api.call(roomPath(snapshot.coordinates.x, snapshot.coordinates.y, 'draft', query), { method: 'PUT', body: snapshot, session });
}

export function publishRoomSnapshot(api: WorkerApi, session: string, snapshot: RoomSnapshot, query = '') {
  return api.call(roomPath(snapshot.coordinates.x, snapshot.coordinates.y, 'publish', query), { body: snapshot, session });
}

/** Claims and publishes a room the way the room editor does (draft save, then publish), or throws. */
export async function publishRoomAs(api: WorkerApi, session: string, x: number, y: number, changes: Partial<RoomSnapshot> = {}) {
  const snapshot = roomSnapshot(x, y, changes);
  const saved = await saveRoomDraft(api, session, snapshot);
  if (saved.status !== 200) throw new Error(`draft ${x},${y} failed: ${JSON.stringify(saved.body)}`);
  const published = await publishRoomSnapshot(api, session, snapshot);
  if (published.status !== 200) throw new Error(`publish ${x},${y} failed: ${JSON.stringify(published.body)}`);
  return published.body;
}
