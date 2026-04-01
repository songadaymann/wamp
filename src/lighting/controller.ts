import Phaser from 'phaser';
import {
  cloneRoomLightingSettings,
  roomLightingUsesDynamicOverlay,
  type RoomLightingSettings,
} from './model';
import { PLAYER_AURA_DARK_LIGHTING_PRESET } from './presets';
import { RETRO_COLORS } from '../visuals/starfield';

const ROOM_LIGHT_AURA_TEXTURE_KEY = '__room_light_aura';
const ROOM_LIGHT_AURA_DIAMETER = PLAYER_AURA_DARK_LIGHTING_PRESET.auraDiameter;
const ROOM_LIGHT_AURA_RADIUS = ROOM_LIGHT_AURA_DIAMETER * 0.5;
const ROOM_LIGHT_AMBIENT_ALPHA = PLAYER_AURA_DARK_LIGHTING_PRESET.ambientAlpha;

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
        rendererPath: 'canvas-disabled',
        activeRoomId,
        emitterCount,
        fallbackReason: 'Unable to create lighting overlay.',
      };
      return structureChanged;
    }

    const auraTextureKey = ensureRoomLightAuraTexture(this.options.scene);
    this.overlay.clear();
    this.overlay.fill(
      RETRO_COLORS.backgroundNumber,
      ROOM_LIGHT_AMBIENT_ALPHA,
      0,
      0,
      input.bounds.width,
      input.bounds.height,
    );

    for (const emitter of input.emitters) {
      const localX = emitter.x - input.bounds.x - ROOM_LIGHT_AURA_RADIUS;
      const localY = emitter.y - input.bounds.y - ROOM_LIGHT_AURA_RADIUS;
      this.overlay.erase(auraTextureKey, localX, localY);
    }

    this.debugState = {
      mode: lighting.mode,
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
  textureKey: string = ROOM_LIGHT_AURA_TEXTURE_KEY,
): string {
  if (scene.textures.exists(textureKey)) {
    return textureKey;
  }

  const canvasTexture = scene.textures.createCanvas(
    textureKey,
    ROOM_LIGHT_AURA_DIAMETER,
    ROOM_LIGHT_AURA_DIAMETER,
  );
  if (!canvasTexture) {
    return textureKey;
  }

  const canvas = canvasTexture.getSourceImage() as HTMLCanvasElement;
  const context = canvas.getContext('2d');
  if (!context) {
    return textureKey;
  }

  const center = ROOM_LIGHT_AURA_DIAMETER * 0.5;
  const gradient = context.createRadialGradient(center, center, center * 0.1, center, center, center);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.32, 'rgba(255, 255, 255, 0.98)');
  gradient.addColorStop(0.62, 'rgba(255, 255, 255, 0.55)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.clearRect(0, 0, ROOM_LIGHT_AURA_DIAMETER, ROOM_LIGHT_AURA_DIAMETER);
  context.fillStyle = gradient;
  context.fillRect(0, 0, ROOM_LIGHT_AURA_DIAMETER, ROOM_LIGHT_AURA_DIAMETER);
  canvasTexture.refresh();

  return textureKey;
}
