import type {
  RoomCoordinates,
  RoomSnapshot,
} from '../../persistence/roomModel';
import type { WorldRoomSummary } from '../../persistence/worldModel';

export type PlayableRoomSource =
  | 'published'
  | 'local_draft'
  | 'live_construction_preview'
  | 'saved_construction_draft';

export interface StreamingRoomCandidate {
  id: string;
  coordinates: RoomCoordinates;
  summary: WorldRoomSummary | null;
  draft: RoomSnapshot | null;
  sharedPreview: RoomSnapshot | null;
  allowFullRoomLoad: boolean;
  source: PlayableRoomSource;
}

export interface RenderableRoom {
  id: string;
  coordinates: RoomCoordinates;
  room: RoomSnapshot;
  source: PlayableRoomSource;
}

export function isStreamingRoomCandidateRenderable(
  roomCandidate: Pick<StreamingRoomCandidate, 'draft' | 'sharedPreview' | 'summary'>,
): boolean {
  return (
    roomCandidate.draft !== null ||
    roomCandidate.sharedPreview !== null ||
    roomCandidate.summary?.state === 'published' ||
    roomCandidate.summary?.state === 'claimed_unpublished'
  );
}
