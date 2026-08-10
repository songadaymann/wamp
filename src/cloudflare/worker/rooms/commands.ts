import {
  cloneRoomSnapshot,
  createDefaultRoomSnapshot,
  type RoomCoordinates,
  type RoomRecord,
  type RoomSnapshot,
} from '../../../persistence/roomModel';
import { HttpError, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';
import { type RoomMutationActor, loadRoomRecordForMutation, saveDraft } from './store';
import {
  MAX_ROOM_DRAFT_COMMAND_BODY_BYTES,
  applyRoomDraftCommands,
  normalizeRoomDraftCommandsRequestBody,
  type RoomDraftCommandBase,
  type RoomDraftCommandsRequestBody,
} from './commandCore';

export type { RoomDraftCommandBase, RoomDraftCommandsRequestBody } from './commandCore';

export interface SaveDraftFromCommandRequestResult {
  record: RoomRecord;
  commandRefs: Record<string, string>;
}

export async function parseRoomDraftCommandsRequest(request: Request): Promise<RoomDraftCommandsRequestBody> {
  const body = await parseJsonBody<unknown>(request, { maxBytes: MAX_ROOM_DRAFT_COMMAND_BODY_BYTES });
  return normalizeRoomDraftCommandsRequestBody(body);
}

function selectBaseSnapshot(
  roomId: string,
  coordinates: RoomCoordinates,
  record: RoomRecord,
  base: RoomDraftCommandBase,
): RoomSnapshot {
  switch (base) {
    case 'current_draft': return cloneRoomSnapshot(record.draft);
    case 'published':
      if (!record.published) throw new HttpError(409, 'Cannot use base=published because this room has no published version.');
      return cloneRoomSnapshot(record.published);
    case 'blank': return createDefaultRoomSnapshot(roomId, coordinates);
  }
}

export async function saveDraftFromCommandRequest(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates,
  requestBody: RoomDraftCommandsRequestBody,
  actor: RoomMutationActor,
  actorIsAdmin = false,
): Promise<SaveDraftFromCommandRequestResult> {
  const existing = await loadRoomRecordForMutation(env, roomId, coordinates, actor.ownerUser, actorIsAdmin);
  if (!existing.permissions.canSaveDraft) throw new HttpError(403, 'Only the room token owner can save drafts for this minted room.');
  const base = selectBaseSnapshot(roomId, coordinates, existing, requestBody.base);
  base.id = roomId;
  base.coordinates = { ...coordinates };
  const applied = applyRoomDraftCommands(base, requestBody.commands);
  const record = await saveDraft(env, applied.snapshot, actor, actorIsAdmin);
  const persistedIds = new Set(record.draft.placedObjects.map((placed) => placed.instanceId));
  return {
    record,
    commandRefs: Object.fromEntries(Object.entries(applied.commandRefs).filter(([, instanceId]) => persistedIds.has(instanceId))),
  };
}
