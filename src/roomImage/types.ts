import type { RoomImageData } from './roomImagePrimitives';
export const ROOM_SHARE_IMAGE_WIDTH = 1200;
export const ROOM_SHARE_IMAGE_HEIGHT = 630;
export interface RoomCoordinates { x: number; y: number }
export interface PublishedRoomSnapshot { title?: unknown; version?: number; [key: string]: unknown }
export interface RoomImageEnvironment {
  ASSETS: { fetch(request: Request): Promise<Response> };
  ROOM_SHARE_API_BASE_URL?: string;
  loadCustomBackground?: (id: string) => Promise<RoomImageData>;
}
