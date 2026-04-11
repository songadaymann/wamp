import type { RoomCoordinates } from '../../persistence/roomModel';
import type { SelectedCellState } from './hudViewModel';

export interface AmbientRoomLightingBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AmbientRoomLightingBoundsOptions {
  roomCoordinates: RoomCoordinates;
  roomWidth: number;
  roomHeight: number;
  getCellStateAt: (coordinates: RoomCoordinates) => SelectedCellState;
  getRoomOrigin: (coordinates: RoomCoordinates) => { x: number; y: number };
}

export function buildAmbientRoomLightingBounds(
  options: AmbientRoomLightingBoundsOptions,
): AmbientRoomLightingBounds[] {
  const bounds: AmbientRoomLightingBounds[] = [];

  for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
    for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
      if (deltaX === 0 && deltaY === 0) {
        continue;
      }

      const coordinates = {
        x: options.roomCoordinates.x + deltaX,
        y: options.roomCoordinates.y + deltaY,
      };
      const state = options.getCellStateAt(coordinates);
      if (state !== 'published' && state !== 'draft') {
        continue;
      }

      const origin = options.getRoomOrigin(coordinates);
      bounds.push({
        x: origin.x,
        y: origin.y,
        width: options.roomWidth,
        height: options.roomHeight,
      });
    }
  }

  return bounds;
}
