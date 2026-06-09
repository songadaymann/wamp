import Phaser from 'phaser';
import {
  DEFAULT_ROOM_WEATHER_INTENSITY,
  cloneRoomWeatherSettings,
  roomWeatherUsesOverlay,
  type RoomWeatherMode,
  type RoomWeatherSettings,
} from './model';
import type { RoomWeatherSurfaceSegment } from './surfaces';

export interface RoomWeatherBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoomWeatherFrameInput {
  roomId: string | null;
  bounds: RoomWeatherBounds | null;
  weather: RoomWeatherSettings | null | undefined;
  surfaces?: RoomWeatherSurfaceSegment[];
}

export interface RoomWeatherDebugState {
  mode: RoomWeatherMode;
  intensity: number;
  rendererPath: 'off' | 'graphics';
  activeRoomId: string | null;
  particleCount: number;
  splashCount: number;
  fogBandCount: number;
}

interface RoomWeatherControllerOptions {
  scene: Phaser.Scene;
  depth: number;
}

const RAIN_COLOR = 0xbddfff;
const RAIN_BRIGHT_COLOR = 0xf0f6ff;
const RAIN_SPLASH_COLOR = 0xdff2ff;
const SNOW_COLOR = 0xf8fbff;
const FOG_COLOR = 0x82a7b7;

export class RoomWeatherController {
  private graphics: Phaser.GameObjects.Graphics | null = null;
  private debugState: RoomWeatherDebugState = {
    mode: 'off',
    intensity: DEFAULT_ROOM_WEATHER_INTENSITY,
    rendererPath: 'off',
    activeRoomId: null,
    particleCount: 0,
    splashCount: 0,
    fogBandCount: 0,
  };

  constructor(private readonly options: RoomWeatherControllerOptions) {}

  reset(): boolean {
    const structureChanged = this.destroyGraphics();
    this.debugState = {
      mode: 'off',
      intensity: DEFAULT_ROOM_WEATHER_INTENSITY,
      rendererPath: 'off',
      activeRoomId: null,
      particleCount: 0,
      splashCount: 0,
      fogBandCount: 0,
    };
    return structureChanged;
  }

  destroy(): void {
    this.reset();
  }

  sync(input: RoomWeatherFrameInput): boolean {
    const weather = cloneRoomWeatherSettings(input.weather ?? null);
    const activeRoomId = input.roomId ?? null;

    if (!activeRoomId || !input.bounds || !roomWeatherUsesOverlay(weather)) {
      const structureChanged = this.destroyGraphics();
      this.debugState = {
        mode: weather.mode,
        intensity: weather.intensity,
        rendererPath: 'off',
        activeRoomId,
        particleCount: 0,
        splashCount: 0,
        fogBandCount: 0,
      };
      return structureChanged;
    }

    const structureChanged = this.ensureGraphics();
    if (!this.graphics) {
      this.debugState = {
        mode: weather.mode,
        intensity: weather.intensity,
        rendererPath: 'off',
        activeRoomId,
        particleCount: 0,
        splashCount: 0,
        fogBandCount: 0,
      };
      return structureChanged;
    }

    const particleCount = resolveWeatherParticleCount(weather);
    const fogBandCount = resolveWeatherFogBandCount(weather);
    let splashCount = 0;
    this.graphics.clear();
    if (fogBandCount > 0) {
      drawFog(this.graphics, input.bounds, activeRoomId, weather, this.options.scene.time.now, fogBandCount);
    }
    if (weather.mode === 'rain') {
      splashCount = drawRain(
        this.graphics,
        input.bounds,
        input.surfaces ?? [],
        activeRoomId,
        weather,
        this.options.scene.time.now,
        particleCount,
      );
    } else if (weather.mode === 'snow') {
      drawSnow(this.graphics, input.bounds, activeRoomId, weather, this.options.scene.time.now, particleCount);
    }

    this.debugState = {
      mode: weather.mode,
      intensity: weather.intensity,
      rendererPath: 'graphics',
      activeRoomId,
      particleCount,
      splashCount,
      fogBandCount,
    };
    return structureChanged;
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return this.graphics ? [this.graphics] : [];
  }

  getDebugState(): RoomWeatherDebugState {
    return { ...this.debugState };
  }

  private ensureGraphics(): boolean {
    if (this.graphics) {
      this.graphics.setVisible(true);
      this.graphics.setDepth(this.options.depth);
      return false;
    }

    this.graphics = this.options.scene.add.graphics();
    this.graphics.setDepth(this.options.depth);
    return true;
  }

  private destroyGraphics(): boolean {
    if (!this.graphics) {
      return false;
    }

    this.graphics.destroy();
    this.graphics = null;
    return true;
  }
}

function resolveWeatherParticleCount(weather: RoomWeatherSettings): number {
  const intensity = weather.intensity / 100;
  if (weather.mode === 'rain') {
    return Math.round(34 + intensity * 96);
  }
  if (weather.mode === 'snow') {
    return Math.round(18 + intensity * 82);
  }
  return 0;
}

function resolveWeatherFogBandCount(weather: RoomWeatherSettings): number {
  const intensity = weather.intensity / 100;
  if (weather.mode === 'fog') {
    return Math.round(8 + intensity * 22);
  }
  if (weather.mode === 'rain') {
    return Math.round(1 + intensity * 3);
  }
  return 0;
}

function drawRain(
  graphics: Phaser.GameObjects.Graphics,
  bounds: RoomWeatherBounds,
  surfaces: RoomWeatherSurfaceSegment[],
  roomId: string,
  weather: RoomWeatherSettings,
  timeMs: number,
  particleCount: number,
): number {
  const intensity = weather.intensity / 100;
  const seed = hashString(`${roomId}:rain`);
  const timeSec = timeMs * 0.001;
  const overscan = 18;
  const width = bounds.width + overscan * 2;
  const height = bounds.height + overscan * 2;
  let splashCount = 0;

  for (let index = 0; index < particleCount; index += 1) {
    const baseX = randomUnit(seed, index, 1) * width;
    const baseY = randomUnit(seed, index, 2) * height;
    const speed = 190 + randomUnit(seed, index, 3) * 150 + intensity * 120;
    const length = 4 + randomUnit(seed, index, 4) * 7 + intensity * 2;
    const drift = Math.sin(timeSec * 0.95 + randomUnit(seed, index, 9) * Math.PI * 2) * 1.2;
    const x = bounds.x - overscan + wrap(baseX + timeSec * speed * 0.035 + drift, width);
    const y = bounds.y - overscan + wrap(baseY + timeSec * speed, height);
    const endX = x + (randomUnit(seed, index, 5) > 0.84 ? 1 : 0);
    const endY = y + length;
    const surfaceY = findRainSurfaceYAtX(x, surfaces);
    const surfaceReactive = randomUnit(seed, index, 12) < 0.62;
    const impactY = surfaceReactive && surfaceY !== null && surfaceY >= y - 1 && surfaceY <= endY + 1
      ? surfaceY
      : null;
    const splashLingerDistance = 6 + intensity * 12;

    if (surfaceReactive && surfaceY !== null && y > surfaceY && y <= surfaceY + splashLingerDistance) {
      drawRainSplash(graphics, x, surfaceY, seed, index, intensity);
      splashCount += 1;
      continue;
    }

    if (surfaceReactive && surfaceY !== null && y > surfaceY) {
      continue;
    }

    const visibleEndY = impactY === null ? endY : Math.max(y + 1, impactY - 1);

    if (
      endX < bounds.x - 2 ||
      x > bounds.x + bounds.width + 2 ||
      visibleEndY < bounds.y ||
      y > bounds.y + bounds.height
    ) {
      continue;
    }

    const brightDrop = randomUnit(seed, index, 6) > 0.64;
    const passThroughDrop = !surfaceReactive && surfaceY !== null;
    const foregroundDrop = passThroughDrop && randomUnit(seed, index, 13) > 0.54;
    const alpha = brightDrop
      ? 0.56 + intensity * 0.34
      : 0.32 + intensity * 0.28;
    const layeredAlpha = passThroughDrop
      ? alpha * (foregroundDrop ? 0.9 : 0.42)
      : alpha;
    graphics.lineStyle(1, brightDrop || foregroundDrop ? RAIN_BRIGHT_COLOR : RAIN_COLOR, layeredAlpha);
    graphics.beginPath();
    graphics.moveTo(Math.round(x), Math.round(y));
    graphics.lineTo(Math.round(endX), Math.round(visibleEndY));
    graphics.strokePath();

    if (impactY !== null) {
      drawRainSplash(graphics, x, impactY, seed, index, intensity);
      splashCount += 1;
    }
  }

  return splashCount;
}

function findRainSurfaceYAtX(
  x: number,
  surfaces: RoomWeatherSurfaceSegment[],
): number | null {
  let surfaceY: number | null = null;

  for (const surface of surfaces) {
    if (x < surface.x1 - 1 || x > surface.x2 + 1) {
      continue;
    }

    if (surfaceY === null || surface.y < surfaceY) {
      surfaceY = surface.y;
    }
  }

  return surfaceY;
}

function drawRainSplash(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  seed: number,
  index: number,
  intensity: number,
): void {
  const width = 2 + Math.round(randomUnit(seed, index, 10) * 3);
  const splashX = Math.round(x - width * 0.5);
  const splashY = Math.round(y);
  const alpha = 0.42 + intensity * 0.36;

  graphics.fillStyle(RAIN_SPLASH_COLOR, alpha);
  graphics.fillRect(splashX, splashY, width, 1);
  if (randomUnit(seed, index, 11) > 0.42) {
    graphics.fillRect(splashX - 1, splashY - 1, 1, 1);
    graphics.fillRect(splashX + width, splashY - 1, 1, 1);
  }
}

function drawFog(
  graphics: Phaser.GameObjects.Graphics,
  bounds: RoomWeatherBounds,
  roomId: string,
  weather: RoomWeatherSettings,
  timeMs: number,
  bandCount: number,
): void {
  const intensity = weather.intensity / 100;
  const seed = hashString(`${roomId}:${weather.mode}:fog`);
  const timeSec = timeMs * 0.001;
  const fogOnly = weather.mode === 'fog';
  const maxAlpha = fogOnly ? 0.075 + intensity * 0.105 : 0.018 + intensity * 0.02;
  const minLobeHeight = fogOnly ? 14 + intensity * 8 : 7;
  const maxLobeHeight = fogOnly ? 34 + intensity * 20 : 14;
  const minLobeWidth = fogOnly ? 96 + intensity * 34 : 62;
  const maxLobeWidth = fogOnly ? 230 + intensity * 260 : 136;

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
      const x = clamp(
        baseX + position * clusterWidth + jitterX,
        bounds.x + lobeWidth * 0.5,
        bounds.x + bounds.width - lobeWidth * 0.5,
      );
      const y = clamp(
        baseY + jitterY,
        bounds.y + lobeHeight * 0.5,
        bounds.y + bounds.height - lobeHeight * 0.5,
      );
      const alpha = maxAlpha * (0.22 + randomUnit(seed, index * 19 + lobe, 9) * 0.34);

      graphics.fillStyle(FOG_COLOR, alpha);
      graphics.fillEllipse(
        Math.round(x),
        Math.round(y),
        Math.round(lobeWidth),
        Math.round(lobeHeight),
        18,
      );
    }
  }
}

function drawSnow(
  graphics: Phaser.GameObjects.Graphics,
  bounds: RoomWeatherBounds,
  roomId: string,
  weather: RoomWeatherSettings,
  timeMs: number,
  particleCount: number,
): void {
  const intensity = weather.intensity / 100;
  const seed = hashString(`${roomId}:snow`);
  const timeSec = timeMs * 0.001;
  const overscan = 12;
  const height = bounds.height + overscan * 2;

  for (let index = 0; index < particleCount; index += 1) {
    const baseX = randomUnit(seed, index, 1) * bounds.width;
    const baseY = randomUnit(seed, index, 2) * height;
    const speed = 18 + randomUnit(seed, index, 3) * 28 + intensity * 24;
    const driftAmplitude = 4 + randomUnit(seed, index, 4) * 12;
    const driftSpeed = 0.55 + randomUnit(seed, index, 5) * 0.9;
    const phase = randomUnit(seed, index, 6) * Math.PI * 2;
    const size = randomUnit(seed, index, 7) > 0.78 ? 2 : 1;
    const alpha = 0.42 + randomUnit(seed, index, 8) * 0.34 + intensity * 0.16;
    const y = bounds.y - overscan + wrap(baseY + timeSec * speed, height);
    const x = bounds.x + wrap(
      baseX + Math.sin(timeSec * driftSpeed + phase) * driftAmplitude,
      bounds.width,
    );

    if (y < bounds.y || y > bounds.y + bounds.height) {
      continue;
    }

    graphics.fillStyle(SNOW_COLOR, Math.min(0.95, alpha));
    graphics.fillRect(Math.round(x), Math.round(y), size, size);
  }
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomUnit(seed: number, index: number, salt: number): number {
  let value = (seed + Math.imul(index + 1, 374761393) + Math.imul(salt + 1, 668265263)) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 4294967295;
}

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
