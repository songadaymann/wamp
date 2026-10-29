import type Phaser from 'phaser';
import { getScreenAnchorWorldPoint, getScrollForScreenAnchor } from './camera';

type Point = { x: number; y: number };

export function pointerPassedPanThreshold(start: Point, current: Point, threshold: number): boolean {
  return Math.hypot(start.x - current.x, start.y - current.y) >= threshold;
}

export function applyInspectPointerPan(
  camera: Phaser.Cameras.Scene2D.Camera, start: Point, scroll: Point, pointer: Point,
): void {
  camera.setScroll(scroll.x + (start.x - pointer.x) / camera.zoom,
    scroll.y + (start.y - pointer.y) / camera.zoom);
}

interface ZoomHost {
  camera: Phaser.Cameras.Scene2D.Camera;
  minZoom: number;
  maxZoom: number;
  sourceZoom?: number;
  normalize?: (zoom: number) => number;
  storeZoom(zoom: number): void;
  updateBounds?: () => void;
  constrain(): void;
}

/** Preserve the world point under the pointer across zoom and bounds changes. */
export function zoomInspectCamera(host: ZoomHost, factor: number, pointer: Point): boolean {
  const { camera } = host;
  const next = Math.min(host.maxZoom, Math.max(host.minZoom, (host.sourceZoom ?? camera.zoom) * factor));
  if (Math.abs(next - (host.sourceZoom ?? camera.zoom)) < 0.0001) return false;
  const anchor = getScreenAnchorWorldPoint(pointer.x, pointer.y, camera);
  const zoom = host.normalize?.(next) ?? next;
  host.storeZoom(zoom);
  camera.setZoom(zoom);
  host.updateBounds?.();
  const scroll = getScrollForScreenAnchor(anchor.x, anchor.y, pointer.x, pointer.y, camera);
  camera.setScroll(scroll.x, scroll.y);
  host.constrain();
  return true;
}
