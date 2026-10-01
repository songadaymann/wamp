import { describe, expect, it } from 'vitest';
import { planRoomCameraFit, resolveMusicRoomViewport } from './musicRoomFit';

const canvas = { left: 0, top: 0, right: 1000, bottom: 600 };

describe('resolveMusicRoomViewport', () => {
  it('keeps a margin when the music chrome is hidden', () => {
    expect(resolveMusicRoomViewport({
      canvas,
      gameWidth: 1000,
      gameHeight: 600,
      shell: null,
      workbench: null,
    })).toEqual({
      x: 10,
      y: 10,
      width: 980,
      height: 580,
    });
  });

  it('places the room below the toolbar and beside the phrase library', () => {
    expect(resolveMusicRoomViewport({
      canvas,
      gameWidth: 1000,
      gameHeight: 600,
      shell: { left: 20, top: 8, right: 980, bottom: 140 },
      workbench: { left: 12, top: 160, right: 272, bottom: 560 },
    })).toEqual({
      x: 282,
      y: 150,
      width: 708,
      height: 440,
    });
  });

  it('ignores a phrase library that is already inside the toolbar shell', () => {
    expect(resolveMusicRoomViewport({
      canvas,
      gameWidth: 1000,
      gameHeight: 600,
      shell: { left: 8, top: 8, right: 980, bottom: 320 },
      workbench: { left: 20, top: 180, right: 260, bottom: 300 },
    })).toEqual({
      x: 10,
      y: 330,
      width: 980,
      height: 260,
    });
  });
});

describe('planRoomCameraFit', () => {
  it('scales the room so its edges land inside the free editor area', () => {
    const viewport = { x: 280, y: 150, width: 700, height: 430 };
    const plan = planRoomCameraFit({
      cameraWidth: 1000,
      cameraHeight: 600,
      originX: 0.5,
      originY: 0.5,
      roomX: 0,
      roomY: 0,
      roomWidth: 640,
      roomHeight: 352,
      viewport,
    });

    const zoom = Math.min(viewport.width / 640, viewport.height / 352);
    expect(plan.zoom).toBeCloseTo(zoom);
    const screenX = viewport.x + (viewport.width - 640 * zoom) * 0.5;
    const screenY = viewport.y + (viewport.height - 352 * zoom) * 0.5;
    const displayWidth = 1000 / zoom;
    const displayHeight = 600 / zoom;
    const worldX = plan.scrollX + 1000 * 0.5 - displayWidth * 0.5 + screenX / zoom;
    const worldY = plan.scrollY + 600 * 0.5 - displayHeight * 0.5 + screenY / zoom;
    expect(worldX).toBeCloseTo(0, 0);
    expect(worldY).toBeCloseTo(0, 0);
  });
});
