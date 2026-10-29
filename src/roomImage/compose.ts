import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../config/room';
import { blitImageNearest, createCanvas, fillRect, type RoomImageData } from './roomImagePrimitives';
import { ROOM_SHARE_IMAGE_HEIGHT, ROOM_SHARE_IMAGE_WIDTH, type RoomCoordinates } from './types';

/** Shared geometry for real-art room cells and cropped world-map leaves, including footprint holes. */
export function composeRoomImages(cells: Array<{ coordinates: RoomCoordinates; image: RoomImageData;
  crop?: { x: number; y: number; width: number; height: number } }>): RoomImageData {
  const canvas = createCanvas(ROOM_SHARE_IMAGE_WIDTH, ROOM_SHARE_IMAGE_HEIGHT);
  fillRect(canvas, 0, 0, canvas.width, canvas.height, 0x0e1524);
  if (!cells.length) return canvas;
  const minX = Math.min(...cells.map(c => c.coordinates.x)), minY = Math.min(...cells.map(c => c.coordinates.y));
  const columns = Math.max(...cells.map(c => c.coordinates.x)) - minX + 1;
  const rows = Math.max(...cells.map(c => c.coordinates.y)) - minY + 1;
  const scale = Math.min((canvas.width - 48) / (columns * ROOM_PX_WIDTH), (canvas.height - 48) / (rows * ROOM_PX_HEIGHT));
  const width = ROOM_PX_WIDTH * scale, height = ROOM_PX_HEIGHT * scale;
  const left = (canvas.width - columns * width) / 2, top = (canvas.height - rows * height) / 2;
  for (const cell of cells) {
    const crop = cell.crop ?? { x: 0, y: 0, width: cell.image.width, height: cell.image.height };
    blitImageNearest(canvas, cell.image, crop.x, crop.y, crop.width, crop.height,
      left + (cell.coordinates.x - minX) * width, top + (cell.coordinates.y - minY) * height, width, height);
  }
  return canvas;
}
