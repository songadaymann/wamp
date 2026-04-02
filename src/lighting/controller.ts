import Phaser from 'phaser';
import {
  DEFAULT_ROOM_LIGHTING_DARKNESS,
  DEFAULT_ROOM_LIGHTING_RADIUS,
  cloneRoomLightingSettings,
  roomLightingUsesDynamicOverlay,
  type RoomLightingSettings,
} from './model';
import {
  resolvePlayerAuraDarkAmbientAlpha,
  resolvePlayerAuraDarkAuraDiameter,
} from './presets';
import { RETRO_COLORS } from '../visuals/starfield';

const ROOM_LIGHT_AURA_TEXTURE_KEY_PREFIX = '__room_light_aura';

export interface RoomLightingBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoomLightingEmitter {
  x: number;
  y: number;
}

export interface RoomLightingFrameInput {
  roomId: string | null;
  bounds: RoomLightingBounds | null;
  lighting: RoomLightingSettings | null | undefined;
  emitters: RoomLightingEmitter[];
}

export interface RoomLightingDebugState {
  mode: RoomLightingSettings['mode'];
  darkness: number;
  radius: number;
  rendererPath: 'off' | 'webgl' | 'canvas-disabled';
  activeRoomId: string | null;
  emitterCount: number;
  fallbackReason: string | null;
}

interface RoomLightingControllerOptions {
  scene: Phaser.Scene;
  overlayDepth: number;
}

export class RoomLightingController {
  private overlay: Phaser.GameObjects.RenderTexture | null = null;
  private debugState: RoomLightingDebugState = {
    mode: 'off',
    darkness: DEFAULT_ROOM_LIGHTING_DARKNESS,
    radius: DEFAULT_ROOM_LIGHTING_RADIUS,
    rendererPath: 'off',
    activeRoomId: null,
    emitterCount: 0,
    fallbackReason: null,
  };

  constructor(private readonly options: RoomLightingControllerOptions) {}

  reset(): boolean {
    const structureChanged = this.destroyOverlay();
    this.debugState = {
      mode: 'off',
      darkness: DEFAULT_ROOM_LIGHTING_DARKNESS,
      radius: DEFAULT_ROOM_LIGHTING_RADIUS,
      rendererPath: 'off',
      activeRoomId: null,
      emitterCount: 0,
      fallbackReason: null,
    };
    return structureChanged;
  }

  destroy(): void {
    this.reset();
  }

  sync(input: RoomLightingFrameInput): boolean {
    const lighting = cloneRoomLightingSettings(input.lighting ?? null);
    const activeRoomId = input.roomId ?? null;
    const emitterCount = input.emitters.length;
    let structureChanged = false;

    if (!activeRoomId || !input.bounds) {
      structureChanged = this.destroyOverlay();
      this.debugState = {
        mode: lighting.mode,
        darkness: lighting.darkness,
        radius: lighting.radius,
        rendererPath: 'off',
        activeRoomId,
        emitterCount: 0,
        fallbackReason: null,
      };
      return structureChanged;
    }

    if (!roomLightingUsesDynamicOverlay(lighting)) {
      structureChanged = this.destroyOverlay();
      this.debugState = {
        mode: lighting.mode,
        darkness: lighting.darkness,
        radius: lighting.radius,
        rendererPath: 'off',
        activeRoomId,
        emitterCount,
        fallbackReason: null,
      };
      return structureChanged;
    }

    if (!this.supportsDynamicLighting()) {
      structureChanged = this.destroyOverlay();
      this.debugState = {
        mode: lighting.mode,
        darkness: lighting.darkness,
        radius: lighting.radius,
        rendererPath: 'canvas-disabled',
        activeRoomId,
        emitterCount,
        fallbackReason: 'Dynamic room lighting requires WebGL.',
      };
      return structureChanged;
    }

    structureChanged = this.ensureOverlay(input.bounds);
    if (!this.overlay) {
      this.debugState = {
        mode: lighting.mode,
        darkness: lighting.darkness,
        radius: lighting.radius,
        rendererPath: 'canvas-disabled',
        activeRoomId,
        emitterCount,
        fallbackReason: 'Unable to create lighting overlay.',
      };
      return structureChanged;
    }

    const auraDiameter = resolvePlayerAuraDarkAuraDiameter(lighting.radius);
    const auraRadius = auraDiameter * 0.5;
    const ambientAlpha = resolvePlayerAuraDarkAmbientAlpha(lighting.darkness);
    const auraTextureKey = ensureRoomLightAuraTexture(this.options.scene, auraDiameter);
    this.overlay.clear();
    this.overlay.fill(
      RETRO_COLORS.backgroundNumber,
      ambientAlpha,
      0,
      0,
      input.bounds.width,
      input.bounds.height,
    );

    for (const emitter of input.emitters) {
      const localX = emitter.x - input.bounds.x - auraRadius;
      const localY = emitter.y - input.bounds.y - auraRadius;
      this.overlay.erase(auraTextureKey, localX, localY);
    }

    this.debugState = {
      mode: lighting.mode,
      darkness: lighting.darkness,
      radius: lighting.radius,
      rendererPath: 'webgl',
      activeRoomId,
      emitterCount,
      fallbackReason: null,
    };
    return structureChanged;
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return this.overlay ? [this.overlay] : [];
  }

  getDebugState(): RoomLightingDebugState {
    return {
      ...this.debugState,
    };
  }

  private supportsDynamicLighting(): boolean {
    return this.options.scene.game.renderer.type === Phaser.WEBGL;
  }

  private ensureOverlay(bounds: RoomLightingBounds): boolean {
    if (
      this.overlay &&
      Math.round(this.overlay.width) === Math.round(bounds.width) &&
      Math.round(this.overlay.height) === Math.round(bounds.height)
    ) {
      this.overlay.setPosition(bounds.x, bounds.y);
      this.overlay.setVisible(true);
      return false;
    }

    this.destroyOverlay();
    this.overlay = this.options.scene.add.renderTexture(bounds.x, bounds.y, bounds.width, bounds.height);
    this.overlay.setOrigin(0, 0);
    this.overlay.setDepth(this.options.overlayDepth);
    return true;
  }

  private destroyOverlay(): boolean {
    if (!this.overlay) {
      return false;
    }

    this.overlay.destroy();
    this.overlay = null;
    return true;
  }
}

function ensureRoomLightAuraTexture(
  scene: Phaser.Scene,
  diameter: number,
): string {
  const textureKey = `${ROOM_LIGHT_AURA_TEXTURE_KEY_PREFIX}_${Math.max(1, Math.round(diameter))}`;
  if (scene.textures.exists(textureKey)) {
    return textureKey;
  }

  const canvasTexture = scene.textures.createCanvas(
    textureKey,
    diameter,
    diameter,
  );
  if (!canvasTexture) {
    return textureKey;
  }

  const canvas = canvasTexture.getSourceImage() as HTMLCanvasElement;
  const context = canvas.getContext('2d');
  if (!context) {
    return textureKey;
  }

  const center = diameter * 0.5;
  const gradient = context.createRadialGradient(center, center, center * 0.1, center, center, center);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.32, 'rgba(255, 255, 255, 0.98)');
  gradient.addColorStop(0.62, 'rgba(255, 255, 255, 0.55)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.clearRect(0, 0, diameter, diameter);
  context.fillStyle = gradient;
  context.fillRect(0, 0, diameter, diameter);
  canvasTexture.refresh();

  return textureKey;
}
