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
  ambientBounds?: RoomLightingBounds[];
}

export interface RoomLightingDebugState {
  mode: RoomLightingSettings['mode'];
  darkness: number;
  radius: number;
  rendererPath: 'off' | 'webgl' | 'canvas-disabled';
  activeRoomId: string | null;
  emitterCount: number;
  ambientOverlayCount: number;
  fallbackReason: string | null;
}

interface RoomLightingControllerOptions {
  scene: Phaser.Scene;
  overlayDepth: number;
}

export class RoomLightingController {
  private overlay: Phaser.GameObjects.RenderTexture | null = null;
  private ambientOverlays: Phaser.GameObjects.Rectangle[] = [];
  private debugState: RoomLightingDebugState = {
    mode: 'off',
    darkness: DEFAULT_ROOM_LIGHTING_DARKNESS,
    radius: DEFAULT_ROOM_LIGHTING_RADIUS,
    rendererPath: 'off',
    activeRoomId: null,
    emitterCount: 0,
    ambientOverlayCount: 0,
    fallbackReason: null,
  };

  constructor(private readonly options: RoomLightingControllerOptions) {}

  reset(): boolean {
    const structureChanged = this.destroyOverlays();
    this.debugState = {
      mode: 'off',
      darkness: DEFAULT_ROOM_LIGHTING_DARKNESS,
      radius: DEFAULT_ROOM_LIGHTING_RADIUS,
      rendererPath: 'off',
      activeRoomId: null,
      emitterCount: 0,
      ambientOverlayCount: 0,
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
    const ambientBounds = input.ambientBounds ?? [];
    let structureChanged = false;

    if (!activeRoomId || !input.bounds) {
      structureChanged = this.destroyOverlays();
      this.debugState = {
        mode: lighting.mode,
        darkness: lighting.darkness,
        radius: lighting.radius,
        rendererPath: 'off',
        activeRoomId,
        emitterCount: 0,
        ambientOverlayCount: 0,
        fallbackReason: null,
      };
      return structureChanged;
    }

    if (!roomLightingUsesDynamicOverlay(lighting)) {
      structureChanged = this.destroyOverlays();
      this.debugState = {
        mode: lighting.mode,
        darkness: lighting.darkness,
        radius: lighting.radius,
        rendererPath: 'off',
        activeRoomId,
        emitterCount,
        ambientOverlayCount: 0,
        fallbackReason: null,
      };
      return structureChanged;
    }

    if (!this.supportsDynamicLighting()) {
      structureChanged = this.destroyOverlays();
      this.debugState = {
        mode: lighting.mode,
        darkness: lighting.darkness,
        radius: lighting.radius,
        rendererPath: 'canvas-disabled',
        activeRoomId,
        emitterCount,
        ambientOverlayCount: 0,
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
        ambientOverlayCount: 0,
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
    structureChanged = this.syncAmbientOverlays(ambientBounds, ambientAlpha) || structureChanged;

    this.debugState = {
      mode: lighting.mode,
      darkness: lighting.darkness,
      radius: lighting.radius,
      rendererPath: 'webgl',
      activeRoomId,
      emitterCount,
      ambientOverlayCount: ambientBounds.length,
      fallbackReason: null,
    };
    return structureChanged;
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    const objects: Phaser.GameObjects.GameObject[] = [];
    if (this.overlay) {
      objects.push(this.overlay);
    }
    objects.push(...this.ambientOverlays);
    return objects;
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

    if (this.overlay) {
      this.overlay.destroy();
      this.overlay = null;
    }
    this.overlay = this.options.scene.add.renderTexture(bounds.x, bounds.y, bounds.width, bounds.height);
    this.overlay.setOrigin(0, 0);
    this.overlay.setDepth(this.options.overlayDepth + 1);
    return true;
  }

  private syncAmbientOverlays(boundsList: RoomLightingBounds[], ambientAlpha: number): boolean {
    let structureChanged = false;

    while (this.ambientOverlays.length > boundsList.length) {
      const overlay = this.ambientOverlays.pop();
      overlay?.destroy();
      structureChanged = true;
    }

    while (this.ambientOverlays.length < boundsList.length) {
      const bounds = boundsList[this.ambientOverlays.length];
      const overlay = this.options.scene.add.rectangle(
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        RETRO_COLORS.backgroundNumber,
        ambientAlpha,
      );
      overlay.setOrigin(0, 0);
      overlay.setDepth(this.options.overlayDepth);
      this.ambientOverlays.push(overlay);
      structureChanged = true;
    }

    for (let index = 0; index < boundsList.length; index += 1) {
      const bounds = boundsList[index];
      const overlay = this.ambientOverlays[index];
      if (!overlay) {
        continue;
      }
      overlay.setPosition(bounds.x, bounds.y);
      if (
        Math.round(overlay.width) !== Math.round(bounds.width)
        || Math.round(overlay.height) !== Math.round(bounds.height)
      ) {
        overlay.setSize(bounds.width, bounds.height);
      }
      overlay.setFillStyle(RETRO_COLORS.backgroundNumber, ambientAlpha);
      overlay.setVisible(true);
    }

    return structureChanged;
  }

  private destroyOverlays(): boolean {
    let structureChanged = false;

    if (this.overlay) {
      this.overlay.destroy();
      this.overlay = null;
      structureChanged = true;
    }

    for (const overlay of this.ambientOverlays) {
      overlay.destroy();
      structureChanged = true;
    }
    this.ambientOverlays = [];

    return structureChanged;
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
