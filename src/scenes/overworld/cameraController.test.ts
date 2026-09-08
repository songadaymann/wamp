import { describe, expect, it, vi } from 'vitest';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../persistence/roomModel';
import type { OverworldMode } from '../sceneData';
import type { CameraMode } from './camera';
import { OverworldCameraController } from './cameraController';

vi.mock('phaser', () => ({ default: { Math: { Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)) } } }));
vi.mock('../../ui/deviceLayout', () => ({ getDeviceLayoutState: () => ({ deviceClass: 'desktop', coarsePointer: false }) }));

function harness() {
  let room: RoomSnapshot | null = createDefaultRoomSnapshot('-2,3', { x: -2, y: 3 });
  let mode: OverworldMode = 'play';
  let cameraMode: CameraMode = 'follow';
  const player = { x: 40, y: 50 };
  const camera = {
    width: 1200, height: 700, originX: 0.5, originY: 0.5,
    scrollX: 0, scrollY: 0, zoom: 2, useBounds: true,
    stopFollow: vi.fn(), startFollow: vi.fn(), centerOn: vi.fn(),
    setZoom(value: number) { this.zoom = value; },
    setScroll(x: number, y: number) { this.scrollX = x; this.scrollY = y; },
  };
  const remove = vi.fn();
  const add = vi.fn((target: { scrollX: number; scrollY: number; zoom: number }) => {
    camera.scrollX = target.scrollX; camera.scrollY = target.scrollY; camera.zoom = target.zoom;
    return { remove };
  });
  const controller = new OverworldCameraController({
    scene: { cameras: { main: camera }, tweens: { add } } as never,
    getCurrentRoom: () => room, getWorldWindow: () => null,
    getMode: () => mode, getCameraMode: () => cameraMode,
    setCameraMode: (value) => { cameraMode = value; }, getInspectZoom: () => 2,
    getPlayer: () => player as never,
    getRoomOrigin: (coordinates) => ({ x: coordinates.x * ROOM_PX_WIDTH, y: coordinates.y * ROOM_PX_HEIGHT }),
    renderHud: vi.fn(),
  }, { minZoom: 0.5, maxZoom: 4, playRoomFitPadding: 40, followCameraLerp: 0.1,
    mobilePlayCameraTargetY: 0.5, getMobilePortraitPlayCameraTargetY: () => 0.34 });
  return { controller, camera, player, add, remove,
    setRoom: (value: RoomSnapshot | null) => { room = value; },
    setMode: (value: OverworldMode) => { mode = value; },
    setCameraMode: (value: CameraMode) => { cameraMode = value; },
  };
}

function fixedRoom(x = -2, y = 3): RoomSnapshot {
  return { ...createDefaultRoomSnapshot(`${x},${y}`, { x, y }), cameraMode: 'room' };
}

function expectCentered(camera: ReturnType<typeof harness>['camera'], room: RoomSnapshot) {
  expect(camera.scrollX + camera.width / 2).toBe(room.coordinates.x * ROOM_PX_WIDTH + ROOM_PX_WIDTH / 2);
  expect(camera.scrollY + camera.height / 2).toBe(room.coordinates.y * ROOM_PX_HEIGHT + ROOM_PX_HEIGHT / 2);
  expect(camera.width / camera.zoom).toBeGreaterThanOrEqual(ROOM_PX_WIDTH - 0.001);
  expect(camera.height / camera.zoom).toBeGreaterThanOrEqual(ROOM_PX_HEIGHT - 0.001);
}

describe('room-centered play camera', () => {
  it('centers on entry, stays still as the player moves, then restores follow and normal zoom on exit', () => {
    const h = harness();
    h.setRoom(fixedRoom());
    expect(h.controller.syncRoomCamera()).toBe(true);
    expectCentered(h.camera, fixedRoom());
    expect(h.camera.useBounds).toBe(false);
    h.player.x += 200;
    h.controller.syncRoomCamera();
    expect(h.add).toHaveBeenCalledTimes(1);
    expectCentered(h.camera, fixedRoom());
    h.setRoom(createDefaultRoomSnapshot('-1,3', { x: -1, y: 3 }));
    expect(h.controller.syncRoomCamera()).toBe(false);
    expect(h.camera.zoom).toBe(2);
    expect(h.camera.useBounds).toBe(true);
    expect(h.camera.startFollow).toHaveBeenCalledWith(h.player, true, 0.1, 0.1, 0, 0);
    expect(h.remove).toHaveBeenCalledOnce();
  });

  it('refits portrait viewports below the normal zoom floor, including adjacent fixed rooms', () => {
    const h = harness();
    h.setRoom(fixedRoom());
    h.controller.syncRoomCamera(false);
    h.camera.width = 180;
    h.camera.height = 700;
    h.controller.syncRoomCamera(false);
    expectCentered(h.camera, fixedRoom());
    expect(h.camera.zoom).toBeLessThan(0.5);
    h.setRoom(fixedRoom(-1, 3));
    h.controller.syncRoomCamera();
    expectCentered(h.camera, fixedRoom(-1, 3));
  });

  it('restores inspect mode on exit and releases the fixed camera when returning to Browse', () => {
    const h = harness();
    h.setCameraMode('inspect');
    h.setRoom(fixedRoom());
    h.controller.applyCameraMode();
    h.controller.toggleCameraMode();
    h.setRoom(createDefaultRoomSnapshot('0,0', { x: 0, y: 0 }));
    h.controller.syncRoomCamera();
    expect(h.camera.startFollow).not.toHaveBeenCalled();
    expect(h.camera.zoom).toBe(2);
    h.setRoom(fixedRoom());
    h.controller.syncRoomCamera();
    h.setMode('browse');
    h.controller.applyCameraMode();
    expect(h.controller.isRoomCameraFixed()).toBe(false);
    expect(h.camera.zoom).toBe(2);
    expect(h.camera.useBounds).toBe(false);
  });

  it('retains the room framing when respawn or streaming reapplies camera mode', () => {
    const h = harness();
    h.setRoom(fixedRoom());
    h.controller.syncRoomCamera(false);
    h.controller.applyCameraMode(true);
    h.controller.startFollowCamera();
    h.controller.centerCameraOnCoordinates({ x: 8, y: 8 });
    expectCentered(h.camera, fixedRoom());
    expect(h.camera.startFollow).not.toHaveBeenCalled();
  });
});
