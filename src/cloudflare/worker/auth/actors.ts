import type { MusicPhrasePublishActor } from '../music/store';
import type { RoomMutationActor } from '../rooms/store';
import type { RequestAuth } from '../core/types';

export function buildRoomMutationActor(auth: RequestAuth): RoomMutationActor {
  return {
    ownerUser: auth.user,
    principalKind: auth.principal.kind,
    principalAgentId: auth.principal.agentId,
    principalDisplayName: auth.principal.displayName,
    requestAuthSource: auth.source,
  };
}

export function buildMusicPhraseActor(auth: RequestAuth): MusicPhrasePublishActor {
  const roomActor = buildRoomMutationActor(auth);
  return {
    userId: roomActor.ownerUser?.id ?? null,
    principalKind: roomActor.principalKind === 'agent' ? 'agent' : 'user',
    agentId: roomActor.principalAgentId,
    displayName: roomActor.principalDisplayName || roomActor.ownerUser?.displayName || 'Guest',
  };
}
