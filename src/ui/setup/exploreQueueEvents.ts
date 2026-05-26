import type { RoomDiscoveryEntry } from '../../runs/model';
import { requestRoomSequenceStart } from './roomSequenceEvents';

export const EXPLORE_QUEUE_START_EVENT = 'explore-queue-start';

export type ExploreQueueMode = 'play' | 'rate';

export interface ExploreQueueStartDetail {
  mode: ExploreQueueMode;
  entries: RoomDiscoveryEntry[];
  sourceLabel: string;
}

export function requestExploreQueueStart(detail: ExploreQueueStartDetail): void {
  window.dispatchEvent(
    new CustomEvent<ExploreQueueStartDetail>(EXPLORE_QUEUE_START_EVENT, {
      detail,
    }),
  );
  requestRoomSequenceStart({
    mode: detail.mode,
    kind: 'explore',
    entries: detail.entries.map((entry) => ({
      roomId: entry.roomId,
      roomCoordinates: entry.roomCoordinates,
      roomVersion: entry.roomVersion,
      roomTitle: entry.roomTitle,
      expandedRoomId: entry.expandedRoom?.expandedRoomId ?? null,
      expandedRoomVersion: entry.expandedRoom?.expandedRoomVersion ?? null,
      expandedRoomCellCount: entry.expandedRoom?.cellCount ?? null,
      legacyCourseId: entry.expandedRoom?.legacyCourseId ?? null,
    })),
    sourceLabel: detail.sourceLabel,
    kickerLabel: detail.mode === 'play' ? 'Play All' : 'Rate All',
  });
}
