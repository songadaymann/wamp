import type { RoomWeatherSettings } from './model';

export interface FogLayoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One soft fog blob: centre, size and opacity, in world pixels. */
export interface FogLobe {
  x: number;
  y: number;
  width: number;
  height: number;
  alpha: number;
}

/**
 * Where each fog blob sits this frame. Fills `out` in place (growing it as needed, never
 * shrinking it) and returns how many entries are in use, so a frame allocates nothing.
 * Bands drift on slow sine waves and their blobs stay inside the room.
 */
export function layoutFogLobes(
  bounds: FogLayoutBounds,
  roomId: string,
  weather: RoomWeatherSettings,
  timeMs: number,
  bandCount: number,
  out: FogLobe[],
): number {
  const intensity = weather.intensity / 100;
  const seed = hashString(`${roomId}:${weather.mode}:fog`);
  const timeSec = timeMs * 0.001;
  const fogOnly = weather.mode === 'fog';
  const maxAlpha = fogOnly ? 0.075 + intensity * 0.105 : 0.018 + intensity * 0.02;
  const minLobeHeight = fogOnly ? 14 + intensity * 8 : 7;
  const maxLobeHeight = fogOnly ? 34 + intensity * 20 : 14;
  const minLobeWidth = fogOnly ? 96 + intensity * 34 : 62;
  const maxLobeWidth = fogOnly ? 230 + intensity * 260 : 136;
  let count = 0;

  for (let index = 0; index < bandCount; index += 1) {
    const lobeCount = Math.round(
      (fogOnly ? 6 + intensity * 8 : 4) + randomUnit(seed, index, 1) * (fogOnly ? 5 + intensity * 7 : 3),
    );
    const clusterWidth = Math.min(
      bounds.width * (fogOnly ? 0.92 : 0.58),
      (fogOnly ? 230 + intensity * 180 : 112) +
        randomUnit(seed, index, 2) * (fogOnly ? 300 + intensity * 260 : 160),
    );
    const drift = Math.sin(timeSec * (fogOnly ? 0.11 : 0.16) + index * 1.7) * (fogOnly ? 18 : 10);
    const baseX = clamp(
      bounds.x + bounds.width * (0.16 + randomUnit(seed, index, 3) * 0.68) + drift,
      bounds.x + clusterWidth * 0.28,
      bounds.x + bounds.width - clusterWidth * 0.28,
    );
    const baseY = clamp(
      bounds.y + bounds.height * (0.12 + randomUnit(seed, index, 4) * 0.76) +
        Math.sin(timeSec * 0.14 + index) * (fogOnly ? 13 : 7),
      bounds.y + maxLobeHeight * 0.5,
      bounds.y + bounds.height - maxLobeHeight * 0.5,
    );

    for (let lobe = 0; lobe < lobeCount; lobe += 1) {
      const position = lobeCount === 1 ? 0 : lobe / (lobeCount - 1) - 0.5;
      const lobeWidth = minLobeWidth + randomUnit(seed, index * 19 + lobe, 5) * maxLobeWidth;
      const lobeHeight = minLobeHeight + randomUnit(seed, index * 19 + lobe, 6) * maxLobeHeight;
      const jitterX = (randomUnit(seed, index * 19 + lobe, 7) - 0.5) * lobeWidth * 0.42;
      const jitterY = (randomUnit(seed, index * 19 + lobe, 8) - 0.5) * lobeHeight * 0.78;
      const entry = out[count] ?? (out[count] = { x: 0, y: 0, width: 0, height: 0, alpha: 0 });
      entry.x = Math.round(clamp(
        baseX + position * clusterWidth + jitterX,
        bounds.x + lobeWidth * 0.5,
        bounds.x + bounds.width - lobeWidth * 0.5,
      ));
      entry.y = Math.round(clamp(
        baseY + jitterY,
        bounds.y + lobeHeight * 0.5,
        bounds.y + bounds.height - lobeHeight * 0.5,
      ));
      entry.width = Math.round(lobeWidth);
      entry.height = Math.round(lobeHeight);
      entry.alpha = maxAlpha * (0.22 + randomUnit(seed, index * 19 + lobe, 9) * 0.34);
      count += 1;
    }
  }
  return count;
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function randomUnit(seed: number, index: number, salt: number): number {
  let value = (seed + Math.imul(index + 1, 374761393) + Math.imul(salt + 1, 668265263)) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 4294967295;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
