import {
  cloneRoomSnapshot,
  createDefaultRoomRecord,
  createRoomSummaryFromRecord,
  DEFAULT_ROOM_COORDINATES,
  DEFAULT_ROOM_ID,
  type RoomCurrentRecord,
  type RoomRecord,
  type RoomSnapshot,
  type RoomSummary,
} from '../persistence/roomModel';
import type { WorldDetail, WorldEntitlementSummary } from './model';
import { setActiveWorldContext } from './clientContext';

interface SeedEditorSession {
  grantId: string;
  snapshot: RoomSnapshot;
}

interface SeedDraftResponse {
  entitlement: WorldEntitlementSummary;
}

interface ActivationResponse {
  world: WorldDetail;
  room: RoomRecord;
}

let session: SeedEditorSession | null = null;

export function beginWorldSeedEditor(grantId: string, source: RoomSnapshot): RoomSnapshot {
  const snapshot = normalizeSeedSnapshot(source);
  session = { grantId, snapshot };
  return cloneRoomSnapshot(snapshot);
}

export function isWorldSeedEditorRoom(roomId: string): boolean {
  return session !== null && roomId === session.snapshot.id;
}

export function loadWorldSeedEditorRecord(roomId: string): RoomRecord | null {
  if (!isWorldSeedEditorRoom(roomId) || !session) return null;
  return buildSeedRecord(session.snapshot);
}

export function loadWorldSeedEditorSummary(roomId: string): RoomSummary | null {
  const record = loadWorldSeedEditorRecord(roomId);
  return record ? createRoomSummaryFromRecord(record) : null;
}

export function loadWorldSeedEditorCurrent(roomId: string): RoomCurrentRecord | null {
  const record = loadWorldSeedEditorRecord(roomId);
  return record
    ? { summary: createRoomSummaryFromRecord(record), draft: record.draft, published: null }
    : null;
}

export async function saveWorldSeedEditorDraft(
  baseUrl: string,
  room: RoomSnapshot,
): Promise<RoomRecord | null> {
  if (!isWorldSeedEditorRoom(room.id) || !session) return null;
  const response = await request<SeedDraftResponse>(
    baseUrl,
    `/api/world-grants/${encodeURIComponent(session.grantId)}/seed-draft`,
    { method: 'PUT', body: JSON.stringify(normalizeSeedSnapshot(room)) },
  );
  const persisted = response.entitlement.seedDraft;
  if (!persisted) throw new Error('The World seed draft was not returned after saving.');
  session.snapshot = normalizeSeedSnapshot(persisted);
  return buildSeedRecord(session.snapshot);
}

export async function publishWorldSeedEditorDraft(
  baseUrl: string,
  room: RoomSnapshot,
): Promise<RoomRecord | null> {
  if (!isWorldSeedEditorRoom(room.id) || !session) return null;
  await saveWorldSeedEditorDraft(baseUrl, room);
  const response = await request<ActivationResponse>(
    baseUrl,
    `/api/world-grants/${encodeURIComponent(session.grantId)}/activate`,
    { method: 'POST' },
  );
  session = null;
  setActiveWorldContext({
    worldId: response.world.id,
    viewerRole: response.world.viewerRole,
    membershipStatus: response.world.viewerMembershipStatus,
  });
  if (typeof document !== 'undefined') delete document.body.dataset.worldSeedEditor;
  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      window.location.assign(response.world.sharePath);
    }, 0);
  }
  return response.room;
}

export function clearWorldSeedEditor(): void {
  session = null;
  if (typeof document !== 'undefined') delete document.body.dataset.worldSeedEditor;
}

function normalizeSeedSnapshot(source: RoomSnapshot): RoomSnapshot {
  return {
    ...cloneRoomSnapshot(source),
    id: DEFAULT_ROOM_ID,
    coordinates: { ...DEFAULT_ROOM_COORDINATES },
    status: 'draft',
    publishedAt: null,
  };
}

function buildSeedRecord(snapshot: RoomSnapshot): RoomRecord {
  const record = createDefaultRoomRecord(snapshot.id, snapshot.coordinates);
  return {
    ...record,
    draft: cloneRoomSnapshot(snapshot),
    claimerUserId: 'world-seed-owner',
    claimerPrincipalKind: 'user',
    claimerDisplayName: 'World owner',
    claimedAt: snapshot.createdAt,
    permissions: {
      canSaveDraft: true,
      canPublish: true,
      canRevert: false,
      canMint: false,
    },
  };
}

async function request<T>(baseUrl: string, path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, credentials: 'include' });
  if (!response.ok) {
    const body = await response.text();
    let parsed: { error?: unknown } | null = null;
    try {
      parsed = JSON.parse(body) as { error?: unknown };
    } catch {
      parsed = null;
    }
    if (typeof parsed?.error === 'string') throw new Error(parsed.error);
    throw new Error(body || `World request failed with status ${response.status}.`);
  }
  return response.json() as Promise<T>;
}
