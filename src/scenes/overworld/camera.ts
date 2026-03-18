import Phaser from 'phaser';
import type { DeviceLayoutState } from '../../ui/deviceLayout';

export type CameraMode = 'inspect' | 'follow';

export function getScreenAnchorWorldPoint(
  screenX: number,
  screenY: number,
  camera: Phaser.Cameras.Scene2D.Camera,
): Phaser.Math.Vector2 {
  const localX = screenX - camera.x;
  const localY = screenY - camera.y;
  return new Phaser.Math.Vector2(
    camera.scrollX + camera.width * camera.originX - camera.displayWidth * 0.5 + localX / camera.zoom,
    camera.scrollY + camera.height * camera.originY - camera.displayHeight * 0.5 + localY / camera.zoom,
  );
}

export function getScrollForScreenAnchor(
  worldX: number,
  worldY: number,
  screenX: number,
  screenY: number,
  camera: Phaser.Cameras.Scene2D.Camera,
): Phaser.Math.Vector2 {
  const localX = screenX - camera.x;
  const localY = screenY - camera.y;
  return new Phaser.Math.Vector2(
    worldX - camera.width * camera.originX + camera.displayWidth * 0.5 - localX / camera.zoom,
    worldY - camera.height * camera.originY + camera.displayHeight * 0.5 - localY / camera.zoom,
  );
}

export function getMobilePlayFollowOffsetY(
  camera: Phaser.Cameras.Scene2D.Camera,
  layout: DeviceLayoutState,
  mobilePlayCameraTargetY: number,
): number {
  if (layout.deviceClass !== 'phone' || !layout.coarsePointer || layout.mobileLandscapeBlocked) {
    return 0;
  }

  const visibleWorldHeight = camera.height / Math.max(camera.zoom, 0.001);
  return Math.round((mobilePlayCameraTargetY - 0.5) * visibleWorldHeight);
}

export function constrainInspectCamera(camera: Phaser.Cameras.Scene2D.Camera): void {
  const bounds = camera.getBounds();
  const minScrollX = bounds.x + (camera.displayWidth - camera.width) * 0.5;
  const maxScrollX = minScrollX + bounds.width - camera.displayWidth;
  const minScrollY = bounds.y + (camera.displayHeight - camera.height) * 0.5;
  const maxScrollY = minScrollY + bounds.height - camera.displayHeight;
  const boundsFitWithinViewportX = bounds.width <= camera.displayWidth;
  const boundsFitWithinViewportY = bounds.height <= camera.displayHeight;

  const nextScrollX = boundsFitWithinViewportX
    ? bounds.centerX - camera.width * camera.originX
    : Phaser.Math.Clamp(camera.scrollX, minScrollX, maxScrollX);
  const nextScrollY = boundsFitWithinViewportY
    ? bounds.centerY - camera.height * camera.originY
    : Phaser.Math.Clamp(camera.scrollY, minScrollY, maxScrollY);

  camera.setScroll(nextScrollX, nextScrollY);
}

export function getFitZoomForRoom(
  viewportWidth: number,
  viewportHeight: number,
  roomWidth: number,
  roomHeight: number,
  padding: number,
  minZoom: number,
  maxZoom: number,
): number {
  const fitZoom = Math.min(
    (viewportWidth - padding) / roomWidth,
    (viewportHeight - padding) / roomHeight,
  );
  return Phaser.Math.Clamp(fitZoom, minZoom, maxZoom);
}
