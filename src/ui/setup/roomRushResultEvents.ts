import type { ActiveRoomRushRunState } from '../../scenes/overworld/roomRushRuns';

export const ROOM_RUSH_RESULT_REQUEST_EVENT = 'room-rush-result-request';

export interface RoomRushResultRequestDetail {
  run: ActiveRoomRushRunState;
}

export function requestRoomRushResultShare(run: ActiveRoomRushRunState): void {
  window.dispatchEvent(
    new CustomEvent<RoomRushResultRequestDetail>(ROOM_RUSH_RESULT_REQUEST_EVENT, {
      detail: { run },
    }),
  );
}
