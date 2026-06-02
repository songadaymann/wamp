import type { OverworldPlaySceneData } from '../scenes/sceneData';
import { cloneRoomSnapshot } from '../persistence/roomModel';
import {
  getWampOGramDisplayTitle,
  WAMP_O_GRAM_LABEL,
  type WampOGramPublicRecord,
} from './model';
import { parseWampOGramSharePath } from './links';
import { createWampOGramRepository } from './repository';

export interface WampOGramLaunch {
  record: WampOGramPublicRecord;
  sceneData: OverworldPlaySceneData;
}

export function getWampOGramSlugFromCurrentPath(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return parseWampOGramSharePath(window.location.pathname);
}

export async function loadWampOGramLaunchFromCurrentUrl(): Promise<WampOGramLaunch | null> {
  const slug = getWampOGramSlugFromCurrentPath();
  if (!slug) {
    return null;
  }

  const record = await createWampOGramRepository().loadBySlug(slug);
  const roomSnapshot = cloneRoomSnapshot(record.roomSnapshot);
  roomSnapshot.status = 'draft';

  const sender = record.senderName || record.creatorDisplayName || null;
  const recipient = record.recipientName ? ` for ${record.recipientName}` : '';
  const from = sender ? ` from ${sender}` : '';
  const title = getWampOGramDisplayTitle(record);

  return {
    record,
    sceneData: {
      roomCoordinates: { ...roomSnapshot.coordinates },
      centerCoordinates: { ...roomSnapshot.coordinates },
      draftRoom: roomSnapshot,
      mode: 'play',
      statusMessage: `${WAMP_O_GRAM_LABEL}${recipient}${from}: ${title}`,
    },
  };
}
