import Phaser from 'phaser';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import { getDeviceLayoutState } from '../../ui/deviceLayout';
import type { RoomCoordinates } from '../../persistence/roomModel';
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
}

export class OverworldCameraController {
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
    if (this.host.getMode() !== 'play') {
      return;
    }

    this.host.setCameraMode(
      this.host.getCameraMode() === 'inspect' ? 'follow' : 'inspect',
    );
    this.applyCameraMode(true);
    this.host.renderHud();
  }

  applyCameraMode(forceCenter: boolean = false): void {
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
      this.startFollowCamera(camera);
      camera.setZoom(this.host.getInspectZoom());
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
    const camera = this.host.scene.cameras.main;
    const origin = this.host.getRoomOrigin(coordinates);
    this.syncBoundsUsage();
    camera.setZoom(this.host.getInspectZoom());
    camera.stopFollow();
    camera.centerOn(origin.x + ROOM_PX_WIDTH / 2, origin.y + ROOM_PX_HEIGHT / 2);
    this.constrainInspectCamera();
  }

  startFollowCamera(camera: Phaser.Cameras.Scene2D.Camera = this.host.scene.cameras.main): void {
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
      this.host.getMode() === 'play' && this.host.getCameraMode() === 'follow';
  }
}
