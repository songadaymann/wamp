import Phaser from 'phaser';
import { getAuthDebugState, setupAuthUi } from './auth/client';
import { initSfx, globalSfxController } from './audio/sfx';
import { applyPerfDebugBodyDataset, getPerfDebugState } from './debug/perfDebug';
import { runOverworldLodStress } from './debug/overworldLodStress';
import {
  bootstrapPlayfunModeFromUrl,
  getPlayfunDebugState,
  setupPlayfunClient,
} from './playfun/client';
import { BootScene } from './scenes/BootScene';
import { EditorScene } from './scenes/EditorScene';
import { OverworldPlayScene } from './scenes/OverworldPlayScene';
import {
  getAppFeedbackDebugState,
  initializeAppFeedback,
  isAppReady,
  showBootSplash,
} from './ui/appFeedback';
import { getDeviceLayoutState } from './ui/deviceLayout';
import { syncGameKeyboardFocus } from './ui/keyboardFocus';
import { getTouchInputDebugState } from './ui/mobile/touchControls';
import { setupUI } from './ui/setup';

const gameContainer = document.getElementById('game-container')!;
const query = new URLSearchParams(window.location.search);

const debug_options = {
  renderer: normalizeRendererQuery(query.get('renderer')),
  preserveDrawingBuffer: parseBooleanQuery(query.get('preserveDrawingBuffer')),
  captureDebug: parseBooleanQuery(query.get('captureDebug')),
} as const;

const config: Phaser.Types.Core.GameConfig = {
  type: resolveRendererType(debug_options.renderer),
  parent: gameContainer,
  width: gameContainer.clientWidth,
  height: gameContainer.clientHeight,
  pixelArt: true,
  preserveDrawingBuffer: debug_options.preserveDrawingBuffer,
  backgroundColor: '#050505',
  scene: [BootScene, EditorScene, OverworldPlayScene],
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    mouse: {
      preventDefaultWheel: true,
    },
  },
};

bootstrapPlayfunModeFromUrl();
initializeAppFeedback();
applyPerfDebugBodyDataset(document);
showBootSplash('Loading assets...', 0);
const game = new Phaser.Game(config);
initSfx();

if (import.meta.env.DEV) {
  (window as Window & { __EVERYBODYS_PLATFORMER_GAME__?: Phaser.Game }).__EVERYBODYS_PLATFORMER_GAME__ = game;
  window.run_overworld_lod_stress = () => runOverworldLodStress(game);
}

// Set up HTML UI event handlers
setupUI(game);
void setupAuthUi();
void setupPlayfunClient();
syncGameKeyboardFocus(game);
setupPerfDebugHud(game);

const resizeGameToContainer = () => {
  const width = Math.round(gameContainer.clientWidth);
  const height = Math.round(gameContainer.clientHeight);
  if (width <= 0 || height <= 0) {
    return;
  }

  if (game.scale.width === width && game.scale.height === height) {
    return;
  }

  game.scale.resize(width, height);
};

let resizeQueued = false;
const queueResizeGameToContainer = () => {
  if (resizeQueued) {
    return;
  }

  resizeQueued = true;
  window.requestAnimationFrame(() => {
    resizeQueued = false;
    resizeGameToContainer();
  });
};

const containerResizeObserver = new ResizeObserver(() => {
  queueResizeGameToContainer();
});
containerResizeObserver.observe(gameContainer);

const appModeObserver = new MutationObserver(() => {
  queueResizeGameToContainer();
  syncGameKeyboardFocus(game);
  window.setTimeout(() => {
    queueResizeGameToContainer();
    syncGameKeyboardFocus(game);
  }, 0);
});

appModeObserver.observe(document.body, {
  attributes: true,
  attributeFilter: ['data-app-mode'],
});

document.addEventListener('focusin', () => {
  syncGameKeyboardFocus(game);
});

document.addEventListener('focusout', () => {
  window.setTimeout(() => {
    syncGameKeyboardFocus(game);
  }, 0);
});

window.requestAnimationFrame(() => {
  queueResizeGameToContainer();
  syncGameKeyboardFocus(game);
});

function getDebugState(): Record<string, unknown> {
  const sceneOrder = ['OverworldPlayScene', 'EditorScene', 'BootScene'];

  for (const sceneKey of sceneOrder) {
    if (!game.scene.isActive(sceneKey)) continue;

    const scene = game.scene.getScene(sceneKey) as {
      describeState?: () => Record<string, unknown>;
    };

    if (scene.describeState) {
      return scene.describeState();
    }

    return { scene: sceneKey };
  }

  return { scene: 'none' };
}

window.render_game_to_text = () =>
  JSON.stringify({
    coordinateSystem: 'Top-left origin. X increases right. Y increases down.',
    activeScene: getDebugState(),
    auth: getAuthDebugState(),
    perfDebug: getPerfDebugState(),
    chat: window.get_chat_debug_state?.() ?? null,
    device: getDeviceLayoutState(),
    touch: getTouchInputDebugState(),
    playfun: getPlayfunDebugState(),
    sfx: window.get_sfx_debug_state?.() ?? globalSfxController.getDebugState(),
    appFeedback: {
      ready: isAppReady(),
      ...getAppFeedbackDebugState(),
    },
  });

window.capture_debug_info = () => getCaptureDebugInfo();
window.get_auth_debug_state = () => ({ ...getAuthDebugState() });
window.get_perf_debug_state = () => ({ ...getPerfDebugState() });

if (typeof window.advanceTime !== 'function') {
  window.advanceTime = async (ms: number) => {
    await new Promise((resolve) => window.setTimeout(resolve, ms));
  };
}

if (debug_options.captureDebug) {
  window.setTimeout(() => {
    console.info('[capture-debug]', getCaptureDebugInfo());
  }, 750);
}

// Handle window resize
window.addEventListener('resize', () => {
  queueResizeGameToContainer();
});

function parseBooleanQuery(value: string | null): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function normalizeRendererQuery(value: string | null): 'auto' | 'canvas' | 'webgl' {
  if (!value) return 'auto';

  switch (value.toLowerCase()) {
    case 'canvas':
      return 'canvas';
    case 'webgl':
      return 'webgl';
    default:
      return 'auto';
  }
}

function resolveRendererType(renderer: 'auto' | 'canvas' | 'webgl'): number {
  switch (renderer) {
    case 'canvas':
      return Phaser.CANVAS;
    case 'webgl':
      return Phaser.WEBGL;
    default:
      return Phaser.AUTO;
  }
}

function getRendererLabel(rendererType: number): string {
  switch (rendererType) {
    case Phaser.CANVAS:
      return 'canvas';
    case Phaser.WEBGL:
      return 'webgl';
    case Phaser.HEADLESS:
      return 'headless';
    default:
      return 'unknown';
  }
}

function getCaptureDebugInfo(): Record<string, unknown> {
  const canvas = game.canvas;
  const webglRenderer =
    game.renderer.type === Phaser.WEBGL
      ? (game.renderer as Phaser.Renderer.WebGL.WebGLRenderer)
      : null;
  const gl = webglRenderer?.gl ?? null;
  const dataUrlResult = getCanvasDataUrl(canvas);

  return {
    debugOptions: { ...debug_options },
    perfDebug: getPerfDebugState(),
    renderer: {
      requested: debug_options.renderer,
      active: getRendererLabel(game.renderer.type),
      type: game.renderer.type,
    },
    canvas: {
      width: canvas.width,
      height: canvas.height,
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      styleWidth: canvas.style.width || null,
      styleHeight: canvas.style.height || null,
      dataUrlOk: dataUrlResult.ok,
      dataUrlLength: dataUrlResult.value?.length ?? 0,
      dataUrlPrefix: dataUrlResult.value?.slice(0, 48) ?? null,
      dataUrlError: dataUrlResult.error,
      pixelProbe: sampleCanvasPixels(canvas),
    },
    webgl: gl ? getWebglDebugInfo(gl) : null,
    activeScene: getDebugState(),
  };
}

function setupPerfDebugHud(game: Phaser.Game): void {
  const perfDebug = getPerfDebugState();
  if (!perfDebug.showHud) {
    return;
  }

  const existing = document.getElementById('perf-debug-hud');
  existing?.remove();

  const hud = document.createElement('pre');
  hud.id = 'perf-debug-hud';
  document.body.appendChild(hud);

  const updateHud = () => {
    const activeScene = getDebugState();
    hud.textContent = formatPerfHud(game, activeScene, perfDebug);
  };

  updateHud();
  window.setInterval(updateHud, 250);
}

function formatPerfHud(
  game: Phaser.Game,
  activeScene: Record<string, unknown>,
  perfDebug: ReturnType<typeof getPerfDebugState>,
): string {
  const flagsLabel = perfDebug.flags.length > 0 ? perfDebug.flags.join(', ') : 'hud';
  const lines = [
    `PERF ${flagsLabel}`,
    `fps ${formatPerfNumber(game.loop.actualFps)} · renderer ${getRendererLabel(game.renderer.type)}`,
  ];

  const sceneName = readString(activeScene.scene) ?? 'unknown';
  lines.push(`scene ${sceneName}`);

  const mode = readString(activeScene.mode);
  const profile = readString(activeScene.performanceProfile);
  if (mode || profile) {
    lines.push(`mode ${mode ?? '-'} · profile ${profile ?? '-'}`);
  }

  const lodMetrics = readRecord(activeScene.lodMetrics);
  if (lodMetrics) {
    lines.push(
      `rooms vis ${formatPerfInt(readNumber(lodMetrics.visibleRoomCount))} · preview ${formatPerfInt(readNumber(lodMetrics.loadedPreviewRoomCount))}/${formatPerfInt(readNumber(lodMetrics.previewRoomBudget))} · full ${formatPerfInt(readNumber(lodMetrics.loadedFullRoomCount))}/${formatPerfInt(readNumber(lodMetrics.fullRoomBudget))} · chunkR ${formatPerfInt(readNumber(lodMetrics.activeChunkRadius))}`,
    );
  }

  const presence = readRecord(activeScene.presence);
  if (presence) {
    lines.push(
      `presence ghosts ${formatPerfInt(readNumber(presence.visibleGhostCount))}/${formatPerfInt(readNumber(presence.renderedGhostCount))} · dots ${formatPerfInt(readNumber(presence.browseDotCount))} · markers ${formatPerfInt(readNumber(presence.playRoomMarkerCount))}`,
    );
  }

  const liveObjects = Array.isArray(activeScene.liveObjects) ? activeScene.liveObjects.length : null;
  const currentRoom = readRecord(activeScene.currentRoom);
  if (liveObjects !== null || currentRoom) {
    lines.push(
      `room ${formatRoomCoordinates(currentRoom)} · live ${liveObjects ?? '-'}`,
    );
  }

  const currentRoomBackground = readRecord(activeScene.currentRoomBackground);
  if (currentRoomBackground) {
    const sampleTilePositionX = readNumber(currentRoomBackground.sampleTilePositionX);
    if (sampleTilePositionX !== null) {
      lines.push(`bg tileX ${formatPerfNumber(sampleTilePositionX)}`);
    }
  }

  const perf = readRecord(activeScene.perf);
  if (perf) {
    lines.push(
      `ms frame ${formatPerfNumber(readNumber(perf.frameMs))} · stream ${formatPerfNumber(readNumber(perf.streamingMs))} · parallax ${formatPerfNumber(readNumber(perf.parallaxMs))} · live ${formatPerfNumber(readNumber(perf.liveObjectsMs))} · presence ${formatPerfNumber(readNumber(perf.presenceMs))} · hud ${formatPerfNumber(readNumber(perf.hudMs))}`,
    );
  }

  return lines.join('\n');
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatPerfNumber(value: number | null): string {
  return value === null ? '-' : value.toFixed(1);
}

function formatPerfInt(value: number | null): string {
  return value === null ? '-' : `${Math.round(value)}`;
}

function formatRoomCoordinates(value: Record<string, unknown> | null): string {
  if (!value) {
    return '-';
  }

  const x = readNumber(value.x);
  const y = readNumber(value.y);
  return x === null || y === null ? '-' : `${Math.round(x)},${Math.round(y)}`;
}

function getCanvasDataUrl(canvas: HTMLCanvasElement): {
  ok: boolean;
  value: string | null;
  error: string | null;
} {
  try {
    return {
      ok: true,
      value: canvas.toDataURL('image/png'),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      value: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function sampleCanvasPixels(canvas: HTMLCanvasElement): Record<string, unknown> {
  try {
    const probeCanvas = document.createElement('canvas');
    const probeSize = 8;
    probeCanvas.width = probeSize;
    probeCanvas.height = probeSize;

    const context = probeCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return { ok: false, error: '2d probe context unavailable' };
    }

    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, probeSize, probeSize);
    context.drawImage(canvas, 0, 0, probeSize, probeSize);

    const imageData = context.getImageData(0, 0, probeSize, probeSize).data;
    let opaquePixels = 0;
    let visiblePixels = 0;
    let maxChannel = 0;
    const sample: number[][] = [];

    for (let index = 0; index < imageData.length; index += 4) {
      const rgba = [
        imageData[index],
        imageData[index + 1],
        imageData[index + 2],
        imageData[index + 3],
      ];

      if (sample.length < 6) {
        sample.push(rgba);
      }

      if (rgba[3] > 0) {
        opaquePixels += 1;
      }

      if (rgba[0] > 0 || rgba[1] > 0 || rgba[2] > 0) {
        visiblePixels += 1;
      }

      maxChannel = Math.max(maxChannel, rgba[0], rgba[1], rgba[2], rgba[3]);
    }

    return {
      ok: true,
      probeSize,
      opaquePixels,
      visiblePixels,
      maxChannel,
      sample,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getWebglDebugInfo(gl: WebGLRenderingContext | WebGL2RenderingContext): Record<string, unknown> {
  const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
  const contextAttributes = gl.getContextAttributes();

  return {
    isContextLost: gl.isContextLost(),
    drawingBufferWidth: gl.drawingBufferWidth,
    drawingBufferHeight: gl.drawingBufferHeight,
    contextAttributes,
    version: safeGlString(gl, gl.VERSION),
    shadingLanguageVersion: safeGlString(gl, gl.SHADING_LANGUAGE_VERSION),
    vendor: debugExt
      ? safeGlString(gl, debugExt.UNMASKED_VENDOR_WEBGL)
      : safeGlString(gl, gl.VENDOR),
    renderer: debugExt
      ? safeGlString(gl, debugExt.UNMASKED_RENDERER_WEBGL)
      : safeGlString(gl, gl.RENDERER),
    pixelProbe: sampleWebglPixels(gl),
  };
}

function sampleWebglPixels(gl: WebGLRenderingContext | WebGL2RenderingContext): Record<string, unknown> {
  try {
    const positions = [
      { label: 'topLeft', x: 0, y: gl.drawingBufferHeight - 1 },
      {
        label: 'center',
        x: Math.max(0, Math.floor(gl.drawingBufferWidth / 2)),
        y: Math.max(0, Math.floor(gl.drawingBufferHeight / 2)),
      },
      {
        label: 'bottomRight',
        x: Math.max(0, gl.drawingBufferWidth - 1),
        y: 0,
      },
    ];

    const samples = positions.map((position) => {
      const bytes = new Uint8Array(4);
      gl.readPixels(position.x, position.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);

      return {
        ...position,
        rgba: Array.from(bytes),
      };
    });

    return {
      ok: true,
      samples,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function safeGlString(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  key: number
): string | null {
  try {
    return gl.getParameter(key) as string | null;
  } catch {
    return null;
  }
}
