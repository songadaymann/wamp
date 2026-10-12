import Phaser from 'phaser';
import {
  DEFAULT_ROOM_WEATHER_INTENSITY,
  cloneRoomWeatherSettings,
  roomWeatherUsesOverlay,
  type RoomWeatherMode,
  type RoomWeatherSettings,
} from './model';
import type { RoomWeatherSurfaceSegment } from './surfaces';
import { hashString, layoutFogLobes, randomUnit, type FogLobe } from './fogLayout';
import { getDevicePerformanceMode } from '../performance/devicePerformanceMode';

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
/**
 * Fog blobs are images of one pre-drawn ellipse, stretched and tinted per blob. Drawing
 * them as Graphics ellipses re-cut 270-600 polygons into triangles every frame (F004).
 */
const FOG_LOBE_TEXTURE_KEY = 'weather-fog-lobe';
const FOG_LOBE_TEXTURE_SIZE = 256;
/** Phaser.Textures.FilterMode.LINEAR, so the stretched ellipse keeps a smooth edge in a pixel-art game. */
const LINEAR_FILTER = 0 as Phaser.Textures.FilterMode;

export class RoomWeatherController {
  private graphics: Phaser.GameObjects.Graphics | null = null;
  private fogLayer: Phaser.GameObjects.Container | null = null;
  private readonly fogImages: Phaser.GameObjects.Image[] = [];
  private readonly fogLobes: FogLobe[] = [];
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
    const activeRoomId = input.roomId ?? null;
    // Most rooms have no weather: once nothing is drawn for this room, skip the settings
    // clone and a new debug object every frame (F012).
    const inputWeather = input.weather ?? null;
    if (
      !this.graphics
      && (inputWeather === null || (inputWeather.mode === 'off' && inputWeather.intensity === this.debugState.intensity))
      && this.debugState.rendererPath === 'off'
      && this.debugState.mode === 'off'
      && this.debugState.activeRoomId === activeRoomId
    ) {
      return false;
    }
    const weather = cloneRoomWeatherSettings(input.weather ?? null);

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
    const fogLobeCount = fogBandCount > 0
      ? layoutFogLobes(input.bounds, activeRoomId, weather, this.options.scene.time.now, fogBandCount, this.fogLobes)
      : 0;
    this.renderFog(fogLobeCount);
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

  getDebugState(): RoomWeatherDebugState {
    return { ...this.debugState };
  }

  private ensureGraphics(): boolean {
    if (this.graphics) {
      this.graphics.setVisible(true);
      this.graphics.setDepth(this.options.depth);
      this.fogLayer?.setDepth(this.options.depth);
      return false;
    }

    // Added first, so at the same depth the fog stays under the rain and snow.
    this.fogLayer = this.options.scene.add.container(0, 0);
    this.fogLayer.setDepth(this.options.depth);
    this.graphics = this.options.scene.add.graphics();
    this.graphics.setDepth(this.options.depth);
    return true;
  }

  private renderFog(lobeCount: number): void {
    const layer = this.fogLayer;
    if (!layer) {
      return;
    }
    if (lobeCount > this.fogImages.length) {
      const textureKey = ensureFogLobeTexture(this.options.scene);
      while (this.fogImages.length < lobeCount) {
        const image = this.options.scene.make.image({ key: textureKey }, false);
        image.setTint(FOG_COLOR);
        layer.add(image);
        this.fogImages.push(image);
      }
    }
    for (let index = 0; index < this.fogImages.length; index += 1) {
      const image = this.fogImages[index];
      if (index >= lobeCount) {
        image.setVisible(false);
        continue;
      }
      const lobe = this.fogLobes[index];
      image.setVisible(true);
      image.setPosition(lobe.x, lobe.y);
      image.setDisplaySize(lobe.width, lobe.height);
      image.setAlpha(lobe.alpha);
    }
  }

  private destroyGraphics(): boolean {
    if (!this.graphics) {
      return false;
    }

    this.fogLayer?.destroy();
    this.fogLayer = null;
    this.fogImages.length = 0;
    this.graphics.destroy();
    this.graphics = null;
    return true;
  }
}

function ensureFogLobeTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(FOG_LOBE_TEXTURE_KEY)) {
    return FOG_LOBE_TEXTURE_KEY;
  }
  const texture = scene.textures.createCanvas(FOG_LOBE_TEXTURE_KEY, FOG_LOBE_TEXTURE_SIZE, FOG_LOBE_TEXTURE_SIZE);
  if (!texture) {
    return FOG_LOBE_TEXTURE_KEY;
  }
  const radius = FOG_LOBE_TEXTURE_SIZE / 2;
  const context = texture.getContext();
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.ellipse(radius, radius, radius, radius, 0, 0, Math.PI * 2);
  context.fill();
  texture.refresh();
  texture.setFilter(LINEAR_FILTER);
  return FOG_LOBE_TEXTURE_KEY;
}

/** Battery Saver draws half the weather: fewer drops, flakes and fog bands (F011). */
function weatherDetailScale(): number {
  return getDevicePerformanceMode() === 'battery-saver' ? 0.5 : 1;
}

export function resolveWeatherParticleCount(weather: RoomWeatherSettings): number {
  const intensity = weather.intensity / 100;
  if (weather.mode === 'rain') {
    return Math.round((34 + intensity * 96) * weatherDetailScale());
  }
  if (weather.mode === 'snow') {
    return Math.round((18 + intensity * 82) * weatherDetailScale());
  }
  return 0;
}

export function resolveWeatherFogBandCount(weather: RoomWeatherSettings): number {
  const intensity = weather.intensity / 100;
  if (weather.mode === 'fog') {
    return Math.max(1, Math.round((8 + intensity * 22) * weatherDetailScale()));
  }
  if (weather.mode === 'rain') {
    return Math.max(1, Math.round((1 + intensity * 3) * weatherDetailScale()));
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

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

