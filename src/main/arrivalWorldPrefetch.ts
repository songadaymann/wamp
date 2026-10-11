import { getFocusedCoordinatesFromUrl } from '../navigation/worldNavigation';
import { roomToChunkCoordinates } from '../persistence/worldModel';
import { prefetchArrivalCompactWorldWindow } from '../persistence/worldRepository';

/** Phones open a 3x3-chunk window around the arrival room; larger screens up to 5x5. */
const PHONE_CHUNK_RADIUS = 1;
const DEFAULT_CHUNK_RADIUS = 2;

/**
 * Starts the arrival area's world request before the game boots, so it downloads while
 * the art does instead of after it (F018). The first world load uses it when it covers
 * the window the camera actually needs; very large screens that need more load normally.
 */
export function startArrivalWorldPrefetch(windowObj: Window = window): void {
  const chunk = roomToChunkCoordinates(getFocusedCoordinatesFromUrl());
  // The screen, not the layout viewport: before the viewport meta applies, phones report 980 px.
  const phone = Boolean(windowObj.matchMedia?.('(pointer: coarse)').matches)
    && Math.min(windowObj.screen.width, windowObj.screen.height) < 600;
  const radius = phone ? PHONE_CHUNK_RADIUS : DEFAULT_CHUNK_RADIUS;
  prefetchArrivalCompactWorldWindow({
    minChunkX: chunk.x - radius,
    maxChunkX: chunk.x + radius,
    minChunkY: chunk.y - radius,
    maxChunkY: chunk.y + radius,
  });
}
