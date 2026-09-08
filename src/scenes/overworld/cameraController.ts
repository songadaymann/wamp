import Phaser from 'phaser';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import { getDeviceLayoutState } from '../../ui/deviceLayout';
import type { RoomCoordinates, RoomSnapshotView } from '../../persistence/roomModel';
import type { WorldWindow } from '../../persistence/worldModel';
import type { OverworldMode } from '../sceneData';
import {
  constrainInspectCamera,
  getFitZoomForRoom as calculateFitZoomForRoom,
  getMobilePlayFollowOffsetY as calculateMobilePlayFollowOffsetY,
  type CameraMode,
} from './camera';

interface OverworldCameraControllerHost {
  scene: Phaser.Scene;
  getWorldWindow(): WorldWindow | null;
  getCurrentRoom(): RoomSnapshotView | null;
  getMode(): OverworldMode;
  getCameraMode(): CameraMode;
  setCameraMode(mode: CameraMode): void;
  getInspectZoom(): number;
  getPlayer(): Phaser.GameObjects.Rectangle | null;
  getRoomOrigin(coordinates: RoomCoordinates): { x: number; y: number };
  renderHud(): void;
}

interface OverworldCameraControllerOptions {
  minZoom: number;
  maxZoom: number;
  playRoomFitPadding: number;
  followCameraLerp: number;
  mobilePlayCameraTargetY: number;
  getMobilePortraitPlayCameraTargetY(): number;
}

export class OverworldCameraController {
  private fixedRoomKey: string | null = null;
  private cameraTransition: Phaser.Tweens.Tween | null = null;

  isRoomCameraFixed(): boolean {
    return this.host.getMode() === 'play'
      && this.host.getPlayer() !== null
      && this.host.getCurrentRoom()?.cameraMode === 'room';
  }

  /** Called after room transitions; reads the shared snapshot without cloning it. */
  syncRoomCamera(animate: boolean = true): boolean {
    if (!this.isRoomCameraFixed()) {
      if (this.fixedRoomKey !== null) {
        this.reset();
        this.applyCameraMode();
      }
      return false;
    }

    const room = this.host.getCurrentRoom()!;
    const camera = this.host.scene.cameras.main;
    const key = `${room.id}:${room.coordinates.x}:${room.coordinates.y}:${camera.width}:${camera.height}`;
    if (key === this.fixedRoomKey) return true;
    this.reset();
    this.fixedRoomKey = key;
    camera.stopFollow();
    camera.useBounds = false;
    const origin = this.host.getRoomOrigin(room.coordinates);
    // Do not clamp to the normal zoom floor: even narrow portrait screens must fit the whole room.
    const zoom = Math.min(camera.width / ROOM_PX_WIDTH, camera.height / ROOM_PX_HEIGHT);
    const scrollX = origin.x + ROOM_PX_WIDTH / 2 - camera.width * camera.originX;
    const scrollY = origin.y + ROOM_PX_HEIGHT / 2 - camera.height * camera.originY;
    if (animate) {
      this.cameraTransition = this.host.scene.tweens.add({
        targets: camera,
        scrollX,
        scrollY,
        zoom,
        duration: 250,
        ease: 'Sine.easeInOut',
      });
    } else {
      camera.setZoom(zoom);
      camera.setScroll(scrollX, scrollY);
    }
    return true;
  }

  reset(): void {
    this.cameraTransition?.remove();
    this.cameraTransition = null;
    this.fixedRoomKey = null;
  }

  constructor(
    private readonly host: OverworldCameraControllerHost,
    private readonly options: OverworldCameraControllerOptions,
  ) {}

  updateCameraBounds(): void {
    const worldWindow = this.host.getWorldWindow();
    if (!worldWindow) {
      return;
    }

    const left = (worldWindow.center.x - worldWindow.radius) * ROOM_PX_WIDTH;
    const top = (worldWindow.center.y - worldWindow.radius) * ROOM_PX_HEIGHT;
    const width = (worldWindow.radius * 2 + 1) * ROOM_PX_WIDTH;
    const height = (worldWindow.radius * 2 + 1) * ROOM_PX_HEIGHT;

    this.host.scene.cameras.main.setBounds(left, top, width, height);
    this.syncBoundsUsage();
  }

  toggleCameraMode(): void {
    if (this.host.getMode() !== 'play' || this.isRoomCameraFixed()) {
      return;
    }

    this.host.setCameraMode(
      this.host.getCameraMode() === 'inspect' ? 'follow' : 'inspect',
    );
    this.applyCameraMode(true);
    this.host.renderHud();
  }

  applyCameraMode(forceCenter: boolean = false): void {
    if (this.syncRoomCamera(false)) return;
    const camera = this.host.scene.cameras.main;
    const player = this.host.getPlayer();
    if (!player || this.host.getMode() !== 'play') {
      this.syncBoundsUsage();
      camera.stopFollow();
      camera.setZoom(this.host.getInspectZoom());
      return;
    }

    if (this.host.getCameraMode() === 'follow') {
      this.syncBoundsUsage();
      camera.setZoom(this.host.getInspectZoom());
      this.startFollowCamera(camera);
      return;
    }

    this.syncBoundsUsage();
    camera.stopFollow();
    camera.setZoom(this.host.getInspectZoom());
    if (forceCenter) {
      camera.centerOn(player.x, player.y);
    }
    this.constrainInspectCamera();
  }

  centerCameraOnCoordinates(coordinates: RoomCoordinates): void {
    if (this.syncRoomCamera(false)) return;
    const camera = this.host.scene.cameras.main;
    const origin = this.host.getRoomOrigin(coordinates);
    this.syncBoundsUsage();
    camera.setZoom(this.host.getInspectZoom());
    camera.stopFollow();
    camera.centerOn(origin.x + ROOM_PX_WIDTH / 2, origin.y + ROOM_PX_HEIGHT / 2);
    this.constrainInspectCamera();
  }

  startFollowCamera(camera: Phaser.Cameras.Scene2D.Camera = this.host.scene.cameras.main): void {
    if (this.syncRoomCamera(false)) return;
    const player = this.host.getPlayer();
    if (!player) {
      return;
    }

    camera.startFollow(
      player,
      true,
      this.options.followCameraLerp,
      this.options.followCameraLerp,
      0,
      calculateMobilePlayFollowOffsetY(
        camera,
        getDeviceLayoutState(),
        this.options.mobilePlayCameraTargetY,
        this.options.getMobilePortraitPlayCameraTargetY(),
      ),
    );
  }

  constrainInspectCamera(): void {
    if (!this.host.getWorldWindow()) {
      return;
    }

    constrainInspectCamera(this.host.scene.cameras.main);
  }

  getFitZoomForRoom(): number {
    return calculateFitZoomForRoom(
      this.host.scene.scale.width,
      this.host.scene.scale.height,
      ROOM_PX_WIDTH,
      ROOM_PX_HEIGHT,
      this.options.playRoomFitPadding,
      this.options.minZoom,
      this.options.maxZoom,
    );
  }

  syncBoundsUsage(): void {
    this.host.scene.cameras.main.useBounds =
      this.host.getMode() === 'play' && this.host.getCameraMode() === 'follow' && !this.isRoomCameraFixed();
  }
}
