import { roomVideoHeight, type RoomVideo } from './model';

/** Stored on a pressure plate's trigger target when that plate starts the room video. */
export const ROOM_VIDEO_LINK_TARGET_ID = 'room-video';

type VideoFrame = Pick<RoomVideo, 'x' | 'y' | 'width' | 'aspect'>;

export function isRoomVideoLinkTarget(instanceId: string | null | undefined): boolean {
  return instanceId === ROOM_VIDEO_LINK_TARGET_ID;
}

export function roomVideoFrameBounds(
  video: VideoFrame,
  originX = 0,
  originY = 0,
): { x: number; y: number; width: number; height: number } {
  return {
    x: originX + video.x,
    y: originY + video.y,
    width: video.width,
    height: roomVideoHeight(video),
  };
}

/** Center of the frame, where the connection dot sits. */
export function roomVideoAnchorPoint(
  video: VideoFrame,
  originX = 0,
  originY = 0,
): { x: number; y: number } {
  const bounds = roomVideoFrameBounds(video, originX, originY);
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

export function hitsRoomVideoAnchor(
  video: (VideoFrame & Pick<RoomVideo, 'trigger'>) | null | undefined,
  worldX: number,
  worldY: number,
  _zoom = 1,
  originX = 0,
  originY = 0,
): boolean {
  if (!video?.trigger) return false;
  const bounds = roomVideoFrameBounds(video, originX, originY);
  return worldX >= bounds.x
    && worldX <= bounds.x + bounds.width
    && worldY >= bounds.y
    && worldY <= bounds.y + bounds.height;
}
