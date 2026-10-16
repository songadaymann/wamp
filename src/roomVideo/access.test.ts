import { describe, expect, it } from 'vitest';
import { createDefaultRoomVideo } from './model';
import { builderCanUseRoomVideo, roomVideoChangeNeedsTrust } from './access';

const video = createDefaultRoomVideo('dQw4w9WgXcQ', 16 / 9);

describe('room video trust', () => {
  it('allows builder trust level 1 and above', () => {
    expect(builderCanUseRoomVideo('T0')).toBe(false);
    expect(builderCanUseRoomVideo(null)).toBe(false);
    expect(builderCanUseRoomVideo('T1')).toBe(true);
    expect(builderCanUseRoomVideo('T4')).toBe(true);
  });

  it('requires trust only when the video link changes', () => {
    expect(roomVideoChangeNeedsTrust(video, null)).toBe(true);
    expect(roomVideoChangeNeedsTrust(video, video)).toBe(false);
    expect(roomVideoChangeNeedsTrust(null, video)).toBe(false);
    expect(roomVideoChangeNeedsTrust({ ...video, snap: true }, video)).toBe(true);
  });
});
