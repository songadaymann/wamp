import Phaser from 'phaser';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import { getDeviceLayoutState } from '../../ui/deviceLayout';
import type { RoomCoordinates, RoomSnapshotView } from '../../persistence/roomModel';
import type { WorldWindow } from '../../persistence/worldModel';
import type { OverworldMode } from '../sceneData';
import { OverworldFollowCameraMotion } from './followCameraMotion';
import {
  constrainInspectCamera,
  getFitZoomForRoom as calculateFitZoomForRoom,
  getMobilePlayFollowOffsetY as calculateMobilePlayFollowOffsetY,
  type CameraMode,
} from './camera';

const FOLLOW_CAMERA_VERTICAL_LERP = 0.3;

interface OverworldCameraControllerHost {
  scene: Phaser.Scene;
  getWorldWindow(): WorldWindow | null;
  getCurrentRoom(): RoomSnapshotView | null;
  getMode(): OverworldMode;
  getCameraMode(): CameraMode;
  setCameraMode(mode: CameraMode): void;
  getInspectZoom(): number;
  getPlayer(): Phaser.GameObjects.Rectangle | null;
  getPlayerBody(): Phaser.Physics.Arcade.Body | null;
  isPlayerGrounded(): boolean;
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
  private readonly followMotion = new OverworldFollowCameraMotion();
  private followedPlayer: Phaser.GameObjects.Rectangle | null = null;
  private followedCamera: Phaser.Cameras.Scene2D.Camera | null = null;
  private portraitCenterY: number | null = null;
  private readonly followTarget = {
    // Arcade updates the sprite after Scene.update; read X at camera preRender, as before.
    get x(): number { return this.controller.host.getPlayer()?.x ?? this.controller.followedPlayer?.x ?? 0; },
    get y(): number { return this.controller.portraitCenterY ?? this.controller.getFollowAnchorY(); },
    controller: this,
  };

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
    camera.setDeadzone();
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
    this.clearFollowMotion();
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
      this.clearFollowMotion();
      camera.setZoom(this.host.getInspectZoom());
      return;
    }

    if (this.host.getCameraMode() === 'follow') {
      this.syncBoundsUsage();
      camera.setZoom(this.host.getInspectZoom());
      this.startFollowCamera(camera, forceCenter);
      return;
    }

    this.syncBoundsUsage();
    camera.stopFollow();
    this.clearFollowMotion();
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
    this.clearFollowMotion();
    camera.centerOn(origin.x + ROOM_PX_WIDTH / 2, origin.y + ROOM_PX_HEIGHT / 2);
    this.constrainInspectCamera();
  }

  startFollowCamera(camera: Phaser.Cameras.Scene2D.Camera = this.host.scene.cameras.main, forceCenter = false): void {
    if (this.syncRoomCamera(false)) return;
    const player = this.host.getPlayer();
    if (!player) {
      return;
    }
    if (forceCenter || this.followedPlayer !== player) this.resetFollowAnchor();
    const preserveView = this.followedCamera === camera;
    const previousScrollX = camera.scrollX;
    const previousScrollY = camera.scrollY;

    camera.startFollow(
      this.followTarget,
      true,
      this.options.followCameraLerp,
      FOLLOW_CAMERA_VERTICAL_LERP,
      -this.followMotion.describe().leadX,
      calculateMobilePlayFollowOffsetY(
        camera,
        getDeviceLayoutState(),
        this.options.mobilePlayCameraTargetY,
        this.options.getMobilePortraitPlayCameraTargetY(),
      ),
    );
    camera.setDeadzone(Math.min(16, camera.width / camera.zoom * 0.06), 0);
    // Phaser recenters in both startFollow and setDeadzone; routine refreshes must keep the view.
    if (preserveView) {
      camera.setScroll(previousScrollX, previousScrollY);
      camera.midPoint.set(previousScrollX + camera.width / 2, previousScrollY + camera.height / 2);
    }
    this.followedCamera = camera;
  }

  updateFollowPacing(physicsSteps: number): void {
    if (this.host.getMode() !== 'play' || this.host.getCameraMode() !== 'follow' || this.isRoomCameraFixed()) return;
    const camera = this.host.scene.cameras.main;
    const player = this.host.getPlayer();
    if (!player) { camera.stopFollow(); this.clearFollowMotion(); return; }
    if (this.followedPlayer !== player) this.startFollowCamera(camera);
    const body = this.host.getPlayerBody();
    const grounded = this.host.isPlayerGrounded();
    // Match the Y Arcade will apply in postUpdate without moving its body or sprite.
    const playerY = player.y + (body ? body.y - body.prevFrame.y : 0);
    const motion = this.followMotion.update({ playerY, velocityX: body?.velocity.x ?? 0,
      grounded, visibleWidth: camera.width / camera.zoom,
      visibleHeight: camera.height / camera.zoom, physicsSteps });
    this.portraitCenterY = null;
    camera.setFollowOffset(-motion.leadX, calculateMobilePlayFollowOffsetY(camera,
      getDeviceLayoutState(), this.options.mobilePlayCameraTargetY,
      this.options.getMobilePortraitPlayCameraTargetY()));
    const steps = Math.max(0, physicsSteps);
    const lerp = 1 - Math.pow(1 - this.options.followCameraLerp, steps);
    const verticalLerp = 1 - Math.pow(1 - FOLLOW_CAMERA_VERTICAL_LERP, steps);
    // Finish catching up even if the player immediately jumps from a new landing.
    camera.setLerp(lerp, verticalLerp);
  }

  resetFollowAnchor(): void {
    if (this.isRoomCameraFixed() || this.host.getMode() !== 'play' || this.host.getCameraMode() !== 'follow') {
      this.clearFollowMotion();
      return;
    }
    const player = this.host.getPlayer();
    this.followedPlayer = player;
    this.followedCamera = null;
    this.followMotion.reset(player?.y);
    this.portraitCenterY = null;
  }

  getFollowAnchorY(): number {
    return this.followMotion.getAnchorY() ?? this.host.getPlayer()?.y ?? 0;
  }

  framePortraitRoom(centerY: number): void {
    this.portraitCenterY = centerY;
    this.host.scene.cameras.main.setFollowOffset(-this.followMotion.describe().leadX, 0);
  }

  describeFollowMotion() {
    const motion = this.followMotion.describe();
    return { anchorY: motion.anchorY === null ? null : Math.round(motion.anchorY),
      leadX: Number(motion.leadX.toFixed(2)) };
  }

  private clearFollowMotion(): void {
    this.followedPlayer = null;
    this.followedCamera = null;
    this.followMotion.reset();
    this.portraitCenterY = null;
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
