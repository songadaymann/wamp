import Phaser from 'phaser';
import { getCustomSpriteRegistryDebugState } from '../customSprites/registry';
import { globalRoomMusicController } from '../music/controller';
import { getDynamicAvatarDebugState } from '../player/avatar/dynamic';
import { getRoomSnapshotTextureDebugState } from '../visuals/roomSnapshotTexture';
import { globalSfxController } from '../audio/sfx';

const SCENE_KEYS = [
  'BootScene',
  'EditorScene',
  'OverworldPlayScene',
  'CourseComposerScene',
  'CourseEditorScene',
] as const;

type TextureCategory =
  | 'chunkPreviews'
  | 'roomSnapshots'
  | 'customSprites'
  | 'customBackgrounds'
  | 'playerAvatars'
  | 'starfield'
  | 'other';

interface ChromePerformanceMemory {
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
  usedJSHeapSize: number;
}

function getChromeMemoryDebugState(): Record<string, unknown> | null {
  const memory = (performance as Performance & { memory?: ChromePerformanceMemory }).memory;
  if (!memory) {
    return null;
  }

  return {
    usedMB: roundMegabytes(memory.usedJSHeapSize),
    totalMB: roundMegabytes(memory.totalJSHeapSize),
    limitMB: roundMegabytes(memory.jsHeapSizeLimit),
  };
}

function roundMegabytes(bytes: number): number {
  return Math.round((bytes / 1_048_576) * 10) / 10;
}

function getTextureKeys(game: Phaser.Game): string[] {
  const textureManager = game.textures as Phaser.Textures.TextureManager & {
    list?: Record<string, unknown>;
  };
  return Object.keys(textureManager.list ?? {}).sort();
}

function classifyTextureKey(textureKey: string): TextureCategory {
  if (textureKey.startsWith('chunk-preview-')) {
    return 'chunkPreviews';
  }
  if (textureKey.startsWith('room-')) {
    return 'roomSnapshots';
  }
  if (textureKey.startsWith('custom_sprite:')) {
    return 'customSprites';
  }
  if (textureKey.includes('custom-background') || textureKey.includes('custom_background')) {
    return 'customBackgrounds';
  }
  if (textureKey.startsWith('player-') || textureKey.includes('cryptopunk')) {
    return 'playerAvatars';
  }
  if (textureKey.includes('starfield')) {
    return 'starfield';
  }
  return 'other';
}

function summarizeTextures(textureKeys: string[]): Record<string, unknown> {
  const countsByCategory: Record<TextureCategory, number> = {
    chunkPreviews: 0,
    roomSnapshots: 0,
    customSprites: 0,
    customBackgrounds: 0,
    playerAvatars: 0,
    starfield: 0,
    other: 0,
  };

  for (const textureKey of textureKeys) {
    countsByCategory[classifyTextureKey(textureKey)] += 1;
  }

  return {
    total: textureKeys.length,
    countsByCategory,
    sampleDynamicKeys: textureKeys
      .filter((textureKey) => classifyTextureKey(textureKey) !== 'other')
      .slice(-40),
  };
}

function getSceneDebugState(game: Phaser.Game): Record<string, unknown>[] {
  return SCENE_KEYS.map((sceneKey) => ({
    key: sceneKey,
    active: game.scene.isActive(sceneKey),
    paused: game.scene.isPaused(sceneKey),
    sleeping: game.scene.isSleeping(sceneKey),
  }));
}

function getActiveScene(game: Phaser.Game): Phaser.Scene | null {
  for (const sceneKey of SCENE_KEYS) {
    if (game.scene.isActive(sceneKey)) {
      return game.scene.getScene(sceneKey);
    }
  }
  return null;
}

function getLoopDebugState(game: Phaser.Game): Record<string, unknown> {
  const loop = game.loop as Phaser.Core.TimeStep & {
    rawDelta?: number;
    _coolDown?: number;
  };

  return {
    actualFps: Number(loop.actualFps.toFixed(1)),
    targetFps: loop.targetFps,
    delta: Number(loop.delta.toFixed(2)),
    rawDelta: typeof loop.rawDelta === 'number' ? Number(loop.rawDelta.toFixed(2)) : null,
    inFocus: loop.inFocus,
    running: loop.running,
    started: loop.started,
    cooldownFrames: typeof loop._coolDown === 'number' ? loop._coolDown : null,
    gameHasFocus: game.hasFocus,
    gameIsPaused: game.isPaused,
  };
}

function getRendererDebugState(game: Phaser.Game): Record<string, unknown> {
  const renderer = game.renderer as Phaser.Renderer.Canvas.CanvasRenderer & Phaser.Renderer.WebGL.WebGLRenderer & {
    type?: number;
  };

  return {
    type: renderer.type ?? null,
    name:
      renderer.type === Phaser.CANVAS
        ? 'canvas'
        : renderer.type === Phaser.WEBGL
          ? 'webgl'
          : 'unknown',
  };
}

export function getRuntimeResourceDebugState(game: Phaser.Game): Record<string, unknown> {
  const textureKeys = getTextureKeys(game);
  const activeScene = getActiveScene(game);

  return {
    capturedAt: new Date().toISOString(),
    memory: getChromeMemoryDebugState(),
    renderer: getRendererDebugState(game),
    loop: getLoopDebugState(game),
    scenes: getSceneDebugState(game),
    textures: summarizeTextures(textureKeys),
    customSprites: getCustomSpriteRegistryDebugState(),
    dynamicAvatars: getDynamicAvatarDebugState(activeScene),
    roomSnapshotTextures: getRoomSnapshotTextureDebugState(),
    music: globalRoomMusicController.getDebugState(),
    sfx: globalSfxController.getDebugState(),
  };
}
