import { describe, expect, it } from 'vitest';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../config/room';
import { TILE_SIZE } from '../config/room';
import {
  createDefaultRoomVideo,
  normalizeRoomVideo,
  parseYouTubeVideoUrl,
  placeRoomVideo,
  roomVideoHeight,
} from './model';

describe('room video links', () => {
  it('reads common YouTube urls', () => {
    expect(parseYouTubeVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12')).toEqual({
      id: 'dQw4w9WgXcQ',
      kind: 'video',
    });
    expect(parseYouTubeVideoUrl('https://youtu.be/dQw4w9WgXcQ')).toEqual({
      id: 'dQw4w9WgXcQ',
      kind: 'video',
    });
    expect(parseYouTubeVideoUrl('https://www.youtube.com/shorts/abcdefghijk')).toEqual({
      id: 'abcdefghijk',
      kind: 'short',
    });
    expect(parseYouTubeVideoUrl('https://vimeo.com/123456')).toBeNull();
  });

  it('keeps the frame inside the room and preserves aspect', () => {
    const video = createDefaultRoomVideo('dQw4w9WgXcQ', 16 / 9);
    expect(video.x).toBeGreaterThanOrEqual(0);
    expect(video.y).toBeGreaterThanOrEqual(0);
    expect(video.x + video.width).toBeLessThanOrEqual(ROOM_PX_WIDTH);
    expect(video.y + roomVideoHeight(video)).toBeLessThanOrEqual(ROOM_PX_HEIGHT);
    expect(video.width / roomVideoHeight(video)).toBeCloseTo(16 / 9, 5);

    const moved = placeRoomVideo(video, -40, 900, 2000, 16 / 9);
    expect(moved.x).toBe(0);
    expect(moved.y + roomVideoHeight(moved)).toBeLessThanOrEqual(ROOM_PX_HEIGHT);
    expect(moved.width).toBeLessThanOrEqual(ROOM_PX_WIDTH);
  });

  it('drops invalid saved videos and keeps playback options', () => {
    expect(normalizeRoomVideo(null)).toBeNull();
    expect(normalizeRoomVideo({ youtubeId: 'nope' })).toBeNull();
    const normalized = normalizeRoomVideo({
      youtubeId: 'dQw4w9WgXcQ',
      x: 12,
      y: 8,
      width: 160,
      aspect: 16 / 9,
      loop: false,
      autoplay: true,
      trigger: true,
      volume: 0.4,
      muteMusic: true,
    });
    expect(normalized).toMatchObject({
      youtubeId: 'dQw4w9WgXcQ',
      loop: false,
      autoplay: true,
      trigger: true,
      volume: 0.4,
      muteMusic: true,
      snap: false,
    });
  });

  it('snaps every frame edge onto the tile grid', () => {
    const video = { ...createDefaultRoomVideo('dQw4w9WgXcQ', 16 / 9), snap: true };
    const snapped = placeRoomVideo(video, 13, 27, 180, 16 / 9);
    const height = roomVideoHeight(snapped);
    expect(snapped.x % TILE_SIZE).toBe(0);
    expect(snapped.y % TILE_SIZE).toBe(0);
    expect(snapped.width % TILE_SIZE).toBe(0);
    expect(height % TILE_SIZE).toBe(0);
    expect(snapped.aspect).toBeCloseTo(16 / 9, 5);
  });
});
