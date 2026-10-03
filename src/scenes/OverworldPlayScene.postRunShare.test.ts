import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { OverworldPlayScene } from './OverworldPlayScene';

describe('OverworldPlayScene post-run share snapshot', () => {
  it('renders the completed room after the player has entered a different room', () => {
    const cloneRoomSnapshotForCoordinates = vi.fn((coordinates: { x: number; y: number }) => ({
      id: `${coordinates.x},${coordinates.y}`,
      coordinates: { ...coordinates },
    }));
    const harness = Object.assign(Object.create(OverworldPlayScene.prototype), {
      currentRoomCoordinates: { x: 4, y: 1 },
      goalRunController: {
        getCurrentRun: () => ({ roomCoordinates: { x: 4, y: 1 } }),
      },
      worldStreamingController: { cloneRoomSnapshotForCoordinates },
    });

    const snapshot = harness.getPostRunShareRoomSnapshot({ x: 3, y: 1 });

    expect(cloneRoomSnapshotForCoordinates).toHaveBeenCalledWith({ x: 3, y: 1 });
    expect(snapshot).toMatchObject({ id: '3,1', coordinates: { x: 3, y: 1 } });
    expect(harness.isViewingRoomCoordinates({ x: 3, y: 1 })).toBe(false);
    expect(harness.isViewingRoomCoordinates({ x: 4, y: 1 })).toBe(true);
  });
});
