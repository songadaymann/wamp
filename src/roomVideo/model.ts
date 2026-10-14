import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH, TILE_SIZE } from '../config/room';

const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const MIN_FRAME_WIDTH = 48;

export interface RoomVideo {
  youtubeId: string;
  /** Room-local left edge, in pixels. */
  x: number;
  /** Room-local top edge, in pixels. */
  y: number;
  /** Frame width in room pixels. Height is width / aspect. */
  width: number;
  /** Width divided by height. */
  aspect: number;
  loop: boolean;
  autoplay: boolean;
  /** Start playback when a linked pressure plate is pressed. */
  trigger: boolean;
  /** 0 to 1. */
  volume: number;
  muteMusic: boolean;
  /** Keep the frame edges on the tile grid while it is moved or scaled. */
  snap: boolean;
}

export interface ParsedYouTubeUrl {
  id: string;
  kind: 'video' | 'short';
}

export function roomVideoHeight(video: Pick<RoomVideo, 'width' | 'aspect'> & { snap?: boolean }): number {
  const height = video.width / video.aspect;
  if (!video.snap) return height;
  return Math.max(TILE_SIZE, Math.round(height / TILE_SIZE) * TILE_SIZE);
}

export function youtubeWatchUrl(youtubeId: string): string {
  return `https://youtu.be/${youtubeId}`;
}

export function parseYouTubeVideoUrl(value: string): ParsedYouTubeUrl | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (YOUTUBE_ID_PATTERN.test(trimmed)) return { id: trimmed, kind: 'video' };

  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const allowed = host === 'youtu.be'
    || host === 'youtube.com'
    || host === 'm.youtube.com'
    || host === 'music.youtube.com'
    || host === 'youtube-nocookie.com';
  if (!allowed) return null;

  if (host === 'youtu.be') {
    return asVideo(url.pathname.split('/').filter(Boolean)[0] ?? '');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'shorts') {
    const parsed = asVideo(parts[1] ?? '');
    return parsed ? { ...parsed, kind: 'short' } : null;
  }
  if (parts[0] === 'embed' || parts[0] === 'live' || parts[0] === 'v') {
    return asVideo(parts[1] ?? '');
  }

  return asVideo(url.searchParams.get('v') ?? '');
}

export function guessYouTubeAspect(kind: ParsedYouTubeUrl['kind']): number {
  return kind === 'short' ? 9 / 16 : 16 / 9;
}

export async function fetchYouTubeAspectRatio(parsed: ParsedYouTubeUrl): Promise<number | null> {
  const watchUrl = parsed.kind === 'short'
    ? `https://www.youtube.com/shorts/${parsed.id}`
    : `https://www.youtube.com/watch?v=${parsed.id}`;
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
    );
    if (!response.ok) return null;
    const payload = await response.json() as { width?: unknown; height?: unknown };
    const width = typeof payload.width === 'number' ? payload.width : Number(payload.width);
    const height = typeof payload.height === 'number' ? payload.height : Number(payload.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return width / height;
  } catch {
    return null;
  }
}

export function createDefaultRoomVideo(youtubeId: string, aspect: number): RoomVideo {
  const safeAspect = sanitizeAspect(aspect);
  const width = Math.min(ROOM_PX_WIDTH * 0.72, ROOM_PX_HEIGHT * safeAspect * 0.8);
  const placed = placeRoomVideo(draftVideo(youtubeId, safeAspect), 0, 0, width, safeAspect);
  const height = roomVideoHeight(placed);
  return placeRoomVideo(
    placed,
    (ROOM_PX_WIDTH - placed.width) / 2,
    (ROOM_PX_HEIGHT - height) / 2,
    placed.width,
    placed.aspect,
  );
}

export function placeRoomVideo(
  video: RoomVideo,
  x: number,
  y: number,
  width: number,
  aspect: number = video.aspect,
): RoomVideo {
  const safeAspect = sanitizeAspect(aspect);
  const snap = video.snap === true;
  let nextWidth = Math.max(MIN_FRAME_WIDTH, finiteNumber(width, MIN_FRAME_WIDTH));
  if (snap) {
    nextWidth = Math.max(Math.ceil(MIN_FRAME_WIDTH / TILE_SIZE) * TILE_SIZE, snapToTile(nextWidth));
    nextWidth = Math.min(nextWidth, ROOM_PX_WIDTH);
  }
  let nextHeight = roomVideoHeight({ width: nextWidth, aspect: safeAspect, snap });
  if (nextHeight > ROOM_PX_HEIGHT) {
    if (snap) {
      while (nextWidth > TILE_SIZE && roomVideoHeight({ width: nextWidth, aspect: safeAspect, snap: true }) > ROOM_PX_HEIGHT) {
        nextWidth -= TILE_SIZE;
      }
      nextHeight = roomVideoHeight({ width: nextWidth, aspect: safeAspect, snap: true });
    } else {
      nextHeight = ROOM_PX_HEIGHT;
      nextWidth = nextHeight * safeAspect;
    }
  }
  if (nextWidth > ROOM_PX_WIDTH) {
    nextWidth = snap ? Math.floor(ROOM_PX_WIDTH / TILE_SIZE) * TILE_SIZE : ROOM_PX_WIDTH;
    nextHeight = roomVideoHeight({ width: nextWidth, aspect: safeAspect, snap });
  }
  const maxX = Math.max(0, ROOM_PX_WIDTH - nextWidth);
  const maxY = Math.max(0, ROOM_PX_HEIGHT - nextHeight);
  return {
    ...video,
    snap,
    aspect: safeAspect,
    width: nextWidth,
    x: snap ? snapAxis(finiteNumber(x, 0), maxX) : clamp(finiteNumber(x, 0), 0, maxX),
    y: snap ? snapAxis(finiteNumber(y, 0), maxY) : clamp(finiteNumber(y, 0), 0, maxY),
  };
}

export function resizeRoomVideoAspect(video: RoomVideo, aspect: number): RoomVideo {
  return placeRoomVideo(video, video.x, video.y, video.width, aspect);
}

export function normalizeRoomVideo(value: unknown): RoomVideo | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<RoomVideo>;
  const youtubeId = typeof raw.youtubeId === 'string' ? raw.youtubeId.trim() : '';
  if (!YOUTUBE_ID_PATTERN.test(youtubeId)) return null;
  const aspect = sanitizeAspect(typeof raw.aspect === 'number' ? raw.aspect : 16 / 9);
  return placeRoomVideo({
    youtubeId,
    x: finiteNumber(raw.x, 0),
    y: finiteNumber(raw.y, 0),
    width: finiteNumber(raw.width, ROOM_PX_WIDTH * 0.72),
    aspect,
    loop: raw.loop !== false,
    autoplay: raw.autoplay === true,
    trigger: raw.trigger === true,
    volume: clamp(finiteNumber(raw.volume, 0.8), 0, 1),
    muteMusic: raw.muteMusic === true,
    snap: raw.snap === true,
  }, finiteNumber(raw.x, 0), finiteNumber(raw.y, 0), finiteNumber(raw.width, ROOM_PX_WIDTH * 0.72), aspect);
}

export function roomVideosEqual(left: RoomVideo | null, right: RoomVideo | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.youtubeId === right.youtubeId
    && near(left.x, right.x)
    && near(left.y, right.y)
    && near(left.width, right.width)
    && near(left.aspect, right.aspect)
    && left.loop === right.loop
    && left.autoplay === right.autoplay
    && left.trigger === right.trigger
    && near(left.volume, right.volume)
    && left.muteMusic === right.muteMusic
    && left.snap === right.snap;
}

export function describeRoomVideo(video: RoomVideo | null, error: string | null): string {
  if (error) return error;
  if (!video) {
    return 'Paste one YouTube link. It plays only while a player is in this room.';
  }
  const snapNote = video.snap ? ' Edges sit on the tile grid.' : '';
  if (video.trigger && !video.autoplay) {
    return `A pressure plate in this room starts playback. Drag the frame while this menu is open.${snapNote}`;
  }
  return `Drag and scale the frame while this menu is open. Tiles on the back layer draw over it.${snapNote}`;
}

function draftVideo(youtubeId: string, aspect: number): RoomVideo {
  return {
    youtubeId,
    x: 0,
    y: 0,
    width: MIN_FRAME_WIDTH,
    aspect,
    loop: true,
    autoplay: true,
    trigger: false,
    volume: 0.8,
    muteMusic: false,
    snap: false,
  };
}

function asVideo(id: string): ParsedYouTubeUrl | null {
  const trimmed = id.trim();
  return YOUTUBE_ID_PATTERN.test(trimmed) ? { id: trimmed, kind: 'video' } : null;
}

function sanitizeAspect(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 16 / 9;
  return clamp(value, 0.2, 5);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function snapToTile(value: number): number {
  return Math.round(value / TILE_SIZE) * TILE_SIZE;
}

function snapAxis(value: number, max: number): number {
  const snapped = clamp(snapToTile(value), 0, max);
  return snapped % TILE_SIZE === 0 ? snapped : Math.floor(max / TILE_SIZE) * TILE_SIZE;
}

function near(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.05;
}
