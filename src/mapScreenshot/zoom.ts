import {
  MAX_ZOOM_DELTA_PER_DAY,
  SCREENSHOT_HEIGHT,
  SCREENSHOT_WIDTH,
} from './config';
import type { WorldPixelRect } from './bounds';

export interface ScreenshotZoomState {
  zoom: number;
  updatedAt: string;
  easternDate: string;
}

export function computeIdealFitZoom(world: WorldPixelRect): number {
  if (world.width <= 0 || world.height <= 0) {
    throw new RangeError('World pixel bounds must be positive.');
  }
  return Math.min(SCREENSHOT_WIDTH / world.width, SCREENSHOT_HEIGHT / world.height);
}

/**
 * Move toward idealZoom by at most MAX_ZOOM_DELTA_PER_DAY.
 * First capture (no previous) uses idealZoom directly.
 */
export function applyGradualZoom(
  idealZoom: number,
  previousZoom: number | null,
  maxDelta: number = MAX_ZOOM_DELTA_PER_DAY,
): number {
  if (previousZoom === null || !Number.isFinite(previousZoom)) {
    return idealZoom;
  }
  const delta = idealZoom - previousZoom;
  if (Math.abs(delta) <= maxDelta) {
    return idealZoom;
  }
  return previousZoom + Math.sign(delta) * maxDelta;
}
