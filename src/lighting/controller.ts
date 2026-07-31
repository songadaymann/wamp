import Phaser from 'phaser';
import {
  DEFAULT_ROOM_LIGHTING_DARKNESS,
  DEFAULT_ROOM_LIGHTING_RADIUS,
  cloneRoomLightingSettings,
  roomLightingUsesDynamicOverlay,
  type RoomLightingEmitter,
  type RoomLightingSettings,
} from './model';
import {
  resolvePlayerAuraDarkAmbientAlpha,
  resolvePlayerAuraDarkAuraDiameter,
} from './presets';
import { RETRO_COLORS } from '../visuals/starfield';

const ROOM_LIGHT_AURA_TEXTURE_KEY_PREFIX = '__room_light_aura';
const ROOM_LIGHT_GLOW_TEXTURE_KEY_PREFIX = '__room_light_glow';

export interface RoomLightingBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoomLightingFrameDebugCounts {
  playerGhostEmitterCount: number;
  staticObjectEmitterCount: number;
  staticTileEmitterCount: number;
}

export interface RoomLightingFrameInput {
  roomId: string | null;
  bounds: RoomLightingBounds | null;
  lighting: RoomLightingSettings | null | undefined;
  emitters: readonly RoomLightingEmitter[];
  ambientBounds?: readonly RoomLightingBounds[];
  debugCounts?: Partial<RoomLightingFrameDebugCounts>;
}

export interface RoomLightingEmitterSlot {
  key: string;
  emitter: RoomLightingEmitter;
}

export interface RoomLightingStructureInput {
  roomId: string | null;
  bounds: RoomLightingBounds | null;
  lighting: RoomLightingSettings | null | undefined;
  emitters: readonly RoomLightingEmitterSlot[];
  ambientBounds?: readonly RoomLightingBounds[];
  debugCounts?: Partial<RoomLightingFrameDebugCounts>;
}

export interface RoomLightingDebugState {
  mode: RoomLightingSettings['mode'];
  darkness: number;
  radius: number;
  rendererPath: 'off' | 'webgl' | 'canvas-disabled';
  activeRoomId: string | null;
  emitterCount: number;
  playerGhostEmitterCount: number;
  staticObjectEmitterCount: number;
  staticTileEmitterCount: number;
  glowEmitterCount: number;
  ambientOverlayCount: number;
  fallbackReason: string | null;
}

interface ResolvedEmitterState {
  revealRadiusPx: number;
  glowRadiusPx: number;
  glowAlpha: number;
}

interface RoomLightingControllerOptions {
  scene: Phaser.Scene;
  overlayDepth: number;
}

export class RoomLightingController {
  private overlay: Phaser.GameObjects.RenderTexture | null = null;
  private glowOverlay: Phaser.GameObjects.RenderTexture | null = null;
  private ambientOverlays: Phaser.GameObjects.Rectangle[] = [];
  private activeBounds: RoomLightingBounds | null = null;
  private activeLighting = cloneRoomLightingSettings(null);
  private activeEmitters: RoomLightingEmitter[] = [];
  private readonly emittersByKey = new Map<string, RoomLightingEmitter>();
  private frameRenderingEnabled = false;
  private debugState: RoomLightingDebugState = {
    mode: 'off',
    darkness: DEFAULT_ROOM_LIGHTING_DARKNESS,
    radius: DEFAULT_ROOM_LIGHTING_RADIUS,
    rendererPath: 'off',
    activeRoomId: null,
    emitterCount: 0,
    playerGhostEmitterCount: 0,
    staticObjectEmitterCount: 0,
    staticTileEmitterCount: 0,
    glowEmitterCount: 0,
    ambientOverlayCount: 0,
    fallbackReason: null,
  };

  constructor(private readonly options: RoomLightingControllerOptions) {}

  reset(): boolean {
    const structureChanged = this.destroyOverlays();
    this.activeBounds = null;
    this.activeLighting = cloneRoomLightingSettings(null);
    this.activeEmitters.length = 0;
    this.emittersByKey.clear();
    this.frameRenderingEnabled = false;
    this.debugState = {
      mode: 'off',
      darkness: DEFAULT_ROOM_LIGHTING_DARKNESS,
      radius: DEFAULT_ROOM_LIGHTING_RADIUS,
      rendererPath: 'off',
      activeRoomId: null,
      emitterCount: 0,
      playerGhostEmitterCount: 0,
      staticObjectEmitterCount: 0,
      staticTileEmitterCount: 0,
      glowEmitterCount: 0,
      ambientOverlayCount: 0,
      fallbackReason: null,
    };
    return structureChanged;
  }

  destroy(): void {
    this.reset();
  }

  sync(input: RoomLightingFrameInput): boolean {
    const structureChanged = this.reconcileStructure({
      ...input,
      emitters: input.emitters.map((emitter, index) => ({
        key: `legacy:${index}`,
        emitter,
      })),
    });
    this.renderFrame();
    return structureChanged;
  }

  reconcileStructure(input: RoomLightingStructureInput): boolean {
    const lighting = cloneRoomLightingSettings(input.lighting ?? null);
    const activeRoomId = input.roomId ?? null;
    const ambientBounds = input.ambientBounds ?? [];
    this.reconcileEmitterSlots(input.emitters);
    const emitterCount = this.activeEmitters.length;
    const debugCounts = resolveDebugCounts(this.activeEmitters, input.debugCounts);
    let structureChanged = false;
    this.activeBounds = input.bounds ? { ...input.bounds } : null;
    this.activeLighting = lighting;
    this.frameRenderingEnabled = false;

    if (!activeRoomId || !input.bounds) {
      structureChanged = this.destroyOverlays();
      this.debugState = {
        mode: lighting.mode,
        darkness: lighting.darkness,
        radius: lighting.radius,
        rendererPath: 'off',
        activeRoomId,
        emitterCount: 0,
        playerGhostEmitterCount: 0,
        staticObjectEmitterCount: 0,
        staticTileEmitterCount: 0,
        glowEmitterCount: 0,
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
        playerGhostEmitterCount: debugCounts.playerGhostEmitterCount,
        staticObjectEmitterCount: debugCounts.staticObjectEmitterCount,
        staticTileEmitterCount: debugCounts.staticTileEmitterCount,
        glowEmitterCount: 0,
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
        playerGhostEmitterCount: debugCounts.playerGhostEmitterCount,
        staticObjectEmitterCount: debugCounts.staticObjectEmitterCount,
        staticTileEmitterCount: debugCounts.staticTileEmitterCount,
        glowEmitterCount: 0,
        ambientOverlayCount: 0,
        fallbackReason: 'Dynamic room lighting requires WebGL.',
      };
      return structureChanged;
    }

    structureChanged = this.ensureOverlays(input.bounds);
    if (!this.overlay || !this.glowOverlay) {
      this.debugState = {
        mode: lighting.mode,
        darkness: lighting.darkness,
        radius: lighting.radius,
        rendererPath: 'canvas-disabled',
        activeRoomId,
        emitterCount,
        playerGhostEmitterCount: debugCounts.playerGhostEmitterCount,
        staticObjectEmitterCount: debugCounts.staticObjectEmitterCount,
        staticTileEmitterCount: debugCounts.staticTileEmitterCount,
        glowEmitterCount: 0,
        ambientOverlayCount: 0,
        fallbackReason: 'Unable to create lighting overlay.',
      };
      return structureChanged;
    }

    const ambientAlpha = resolvePlayerAuraDarkAmbientAlpha(lighting.darkness);
    structureChanged = this.syncAmbientOverlays(ambientBounds, ambientAlpha) || structureChanged;
    this.frameRenderingEnabled = true;
    this.debugState = {
      mode: lighting.mode,
      darkness: lighting.darkness,
      radius: lighting.radius,
      rendererPath: 'webgl',
      activeRoomId,
      emitterCount,
      playerGhostEmitterCount: debugCounts.playerGhostEmitterCount,
      staticObjectEmitterCount: debugCounts.staticObjectEmitterCount,
      staticTileEmitterCount: debugCounts.staticTileEmitterCount,
      glowEmitterCount: 0,
      ambientOverlayCount: ambientBounds.length,
      fallbackReason: null,
    };
    return structureChanged;
  }

  updateEmitterPosition(key: string, x: number, y: number): boolean {
    const emitter = this.emittersByKey.get(key);
    if (!emitter) return false;
    emitter.x = x;
    emitter.y = y;
    return true;
  }

  hasEmitter(key: string): boolean {
    return this.emittersByKey.has(key);
  }

  getEmitterIdentity(key: string): RoomLightingEmitter | null {
    return this.emittersByKey.get(key) ?? null;
  }

  renderFrame(): void {
    const bounds = this.activeBounds;
    const lighting = this.activeLighting;
    if (!this.frameRenderingEnabled || !bounds || !this.overlay || !this.glowOverlay) {
      return;
    }

    const defaultRevealRadiusPx = resolvePlayerAuraDarkAuraDiameter(lighting.radius) * 0.5;
    const ambientAlpha = resolvePlayerAuraDarkAmbientAlpha(lighting.darkness);
    this.overlay.clear();
    this.overlay.fill(
      RETRO_COLORS.backgroundNumber,
      ambientAlpha,
      0,
      0,
      bounds.width,
      bounds.height,
    );
    this.glowOverlay.clear();

    let glowEmitterCount = 0;
    for (const emitter of this.activeEmitters) {
      const resolved = resolveEmitterState(
        emitter,
        defaultRevealRadiusPx,
        this.options.scene.time.now * 0.001,
      );
      const revealDiameter = Math.max(2, Math.round(resolved.revealRadiusPx * 2));
      const auraTextureKey = ensureRoomLightTexture(
        this.options.scene,
        ROOM_LIGHT_AURA_TEXTURE_KEY_PREFIX,
        revealDiameter,
        [
          [0, 'rgba(255, 255, 255, 1)'],
          [0.32, 'rgba(255, 255, 255, 0.98)'],
          [0.62, 'rgba(255, 255, 255, 0.55)'],
          [1, 'rgba(255, 255, 255, 0)'],
        ],
      );
      const localRevealX = emitter.x - bounds.x - revealDiameter * 0.5;
      const localRevealY = emitter.y - bounds.y - revealDiameter * 0.5;
      this.overlay.erase(auraTextureKey, localRevealX, localRevealY);

      if (
        typeof emitter.glowColor === 'number'
        && resolved.glowRadiusPx > 0
        && resolved.glowAlpha > 0.001
      ) {
        const glowDiameter = Math.max(2, Math.round(resolved.glowRadiusPx * 2));
        const glowTextureKey = ensureRoomLightTexture(
          this.options.scene,
          ROOM_LIGHT_GLOW_TEXTURE_KEY_PREFIX,
          glowDiameter,
          [
            [0, 'rgba(255, 255, 255, 1)'],
            [0.2, 'rgba(255, 255, 255, 0.92)'],
            [0.58, 'rgba(255, 255, 255, 0.36)'],
            [1, 'rgba(255, 255, 255, 0)'],
          ],
        );
        const localGlowX = emitter.x - bounds.x - glowDiameter * 0.5;
        const localGlowY = emitter.y - bounds.y - glowDiameter * 0.5;
        this.glowOverlay.drawFrame(
          glowTextureKey,
          undefined,
          localGlowX,
          localGlowY,
          resolved.glowAlpha,
          emitter.glowColor,
        );
        glowEmitterCount += 1;
      }
    }

    this.debugState.glowEmitterCount = glowEmitterCount;
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    const objects: Phaser.GameObjects.GameObject[] = [];
    if (this.overlay) {
      objects.push(this.overlay);
    }
    if (this.glowOverlay) {
      objects.push(this.glowOverlay);
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

  private reconcileEmitterSlots(slots: readonly RoomLightingEmitterSlot[]): void {
    const retainedKeys = new Set<string>();
    this.activeEmitters.length = 0;
    for (const slot of slots) {
      retainedKeys.add(slot.key);
      let emitter = this.emittersByKey.get(slot.key);
      if (!emitter) {
        emitter = { ...slot.emitter };
        this.emittersByKey.set(slot.key, emitter);
      } else {
        copyEmitterState(emitter, slot.emitter);
      }
      this.activeEmitters.push(emitter);
    }
    for (const key of this.emittersByKey.keys()) {
      if (!retainedKeys.has(key)) {
        this.emittersByKey.delete(key);
      }
    }
  }

  private ensureOverlays(bounds: RoomLightingBounds): boolean {
    let structureChanged = false;

    if (
      this.overlay
      && Math.round(this.overlay.width) === Math.round(bounds.width)
      && Math.round(this.overlay.height) === Math.round(bounds.height)
    ) {
      this.overlay.setPosition(bounds.x, bounds.y);
      this.overlay.setVisible(true);
    } else {
      this.overlay?.destroy();
      this.overlay = this.options.scene.add.renderTexture(bounds.x, bounds.y, bounds.width, bounds.height);
      this.overlay.setOrigin(0, 0);
      this.overlay.setDepth(this.options.overlayDepth + 1);
      structureChanged = true;
    }

    if (
      this.glowOverlay
      && Math.round(this.glowOverlay.width) === Math.round(bounds.width)
      && Math.round(this.glowOverlay.height) === Math.round(bounds.height)
    ) {
      this.glowOverlay.setPosition(bounds.x, bounds.y);
      this.glowOverlay.setVisible(true);
    } else {
      this.glowOverlay?.destroy();
      this.glowOverlay = this.options.scene.add.renderTexture(
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
      );
      this.glowOverlay.setOrigin(0, 0);
      this.glowOverlay.setDepth(this.options.overlayDepth + 2);
      this.glowOverlay.setBlendMode(Phaser.BlendModes.ADD);
      structureChanged = true;
    }

    return structureChanged;
  }

  private syncAmbientOverlays(
    boundsList: readonly RoomLightingBounds[],
    ambientAlpha: number,
  ): boolean {
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

    if (this.glowOverlay) {
      this.glowOverlay.destroy();
      this.glowOverlay = null;
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

function resolveDebugCounts(
  emitters: readonly RoomLightingEmitter[],
  input?: Partial<RoomLightingFrameDebugCounts>,
): RoomLightingFrameDebugCounts {
  return {
    playerGhostEmitterCount:
      input?.playerGhostEmitterCount
      ?? emitters.filter((emitter) => emitter.sourceType === 'player' || emitter.sourceType === 'ghost').length,
    staticObjectEmitterCount:
      input?.staticObjectEmitterCount
      ?? emitters.filter((emitter) => emitter.sourceType === 'object').length,
    staticTileEmitterCount:
      input?.staticTileEmitterCount
      ?? emitters.filter((emitter) => emitter.sourceType === 'tile').length,
  };
}

function copyEmitterState(
  target: RoomLightingEmitter,
  source: RoomLightingEmitter,
): void {
  target.x = source.x;
  target.y = source.y;
  target.sourceType = source.sourceType;
  target.revealRadiusPx = source.revealRadiusPx;
  target.glowRadiusPx = source.glowRadiusPx;
  target.glowColor = source.glowColor;
  target.glowAlpha = source.glowAlpha;
  target.flicker = source.flicker;
}

function resolveEmitterState(
  emitter: RoomLightingEmitter,
  defaultRevealRadiusPx: number,
  nowSeconds: number,
): ResolvedEmitterState {
  const baseRevealRadiusPx = Math.max(2, emitter.revealRadiusPx ?? defaultRevealRadiusPx);
  const baseGlowRadiusPx = Math.max(0, emitter.glowRadiusPx ?? 0);
  const baseGlowAlpha = Math.max(0, Math.min(1, emitter.glowAlpha ?? 0));
  if (!emitter.flicker) {
    return {
      revealRadiusPx: baseRevealRadiusPx,
      glowRadiusPx: baseGlowRadiusPx,
      glowAlpha: baseGlowAlpha,
    };
  }

  const { flicker } = emitter;
  const primaryWave = Math.sin(nowSeconds * flicker.speedHz * Math.PI * 2 + flicker.phaseSeed);
  const secondaryWave = Math.sin(
    nowSeconds * flicker.speedHz * Math.PI * 2 * 1.73 + flicker.phaseSeed * 1.61,
  );
  const wave = primaryWave * 0.65 + secondaryWave * 0.35;
  const radiusScale = Math.max(0.6, 1 + wave * flicker.radiusAmplitude);
  const alphaScale = Math.max(0.45, 1 + wave * flicker.alphaAmplitude);

  return {
    revealRadiusPx: baseRevealRadiusPx * radiusScale,
    glowRadiusPx: baseGlowRadiusPx * radiusScale,
    glowAlpha: Math.max(0, Math.min(1, baseGlowAlpha * alphaScale)),
  };
}

function ensureRoomLightTexture(
  scene: Phaser.Scene,
  prefix: string,
  diameter: number,
  colorStops: Array<[number, string]>,
): string {
  const roundedDiameter = Math.max(2, Math.round(diameter));
  const textureKey = `${prefix}_${roundedDiameter}`;
  if (scene.textures.exists(textureKey)) {
    return textureKey;
  }

  const canvasTexture = scene.textures.createCanvas(
    textureKey,
    roundedDiameter,
    roundedDiameter,
  );
  if (!canvasTexture) {
    return textureKey;
  }

  const canvas = canvasTexture.getSourceImage() as HTMLCanvasElement;
  const context = canvas.getContext('2d');
  if (!context) {
    return textureKey;
  }

  const center = roundedDiameter * 0.5;
  const gradient = context.createRadialGradient(center, center, center * 0.1, center, center, center);
  for (const [offset, color] of colorStops) {
    gradient.addColorStop(offset, color);
  }
  context.clearRect(0, 0, roundedDiameter, roundedDiameter);
  context.fillStyle = gradient;
  context.fillRect(0, 0, roundedDiameter, roundedDiameter);
  canvasTexture.refresh();

  return textureKey;
}
