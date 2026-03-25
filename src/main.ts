import Phaser from 'phaser';
import { getAuthDebugState, setupAuthUi } from './auth/client';
import { initSfx, globalSfxController } from './audio/sfx';
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

if (query.get('previewSmoke') === '1') {
  window.run_preview_smoke_action = async (
    action: 'selectEditableRoom' | 'playSelectedRoom' | 'returnToWorld' | 'editSelectedRoom',
    payload?: { roomId?: string | null },
  ) => {
    switch (action) {
      case 'selectEditableRoom':
        return selectEditableRoomForPreviewSmoke(payload?.roomId ?? null);
      case 'playSelectedRoom':
        return runOverworldPreviewSmokeAction((scene) => {
          scene.playSelectedRoom();
        });
      case 'returnToWorld':
        return runOverworldPreviewSmokeAction((scene) => {
          scene.returnToWorld();
        });
      case 'editSelectedRoom':
        return runOverworldPreviewSmokeAction((scene) => {
          scene.editSelectedRoom();
        }, 1200);
      default:
        return { ok: false, reason: `unsupported-action:${action}` };
    }
  };
}

window.capture_debug_info = () => getCaptureDebugInfo();
window.get_auth_debug_state = () => ({ ...getAuthDebugState() });

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

type PreviewSmokeScene = {
  describeState: () => Record<string, unknown>;
  jumpToCoordinates: (coordinates: { x: number; y: number }) => Promise<void> | void;
  playSelectedRoom: () => void;
  returnToWorld: () => void;
  editSelectedRoom: () => void;
  roomSummariesById?: Map<string, { id?: string; coordinates?: { x: number; y: number }; state?: string }>;
  draftRoomsById?: Map<string, { id: string; coordinates: { x: number; y: number } }>;
};

async function selectEditableRoomForPreviewSmoke(roomId: string | null): Promise<Record<string, unknown>> {
  const scene = getOverworldSceneForPreviewSmoke();
  if (!scene) {
    return { ok: false, reason: 'overworld-scene-missing' };
  }

  const requestedCoordinates = parsePreviewSmokeRoomId(roomId);
  const currentState = scene.describeState();
  const currentSelectedCoordinates = currentState.selected as { x: number; y: number } | undefined;
  const currentSelectedState = currentState.selectedState;
  const currentSelectionIsEditable =
    currentSelectedCoordinates
    && (currentSelectedState === 'published' || currentSelectedState === 'draft')
    && requestedCoordinates === null;
  const target =
    currentSelectionIsEditable
      ? {
          roomId: `${currentSelectedCoordinates.x},${currentSelectedCoordinates.y}`,
          coordinates: { ...currentSelectedCoordinates },
          selectedState: currentSelectedState,
        }
      : findEditableRoomCandidate(scene, requestedCoordinates);
  if (!target) {
    return {
      ok: false,
      reason: 'no-editable-room-loaded',
    };
  }

  await scene.jumpToCoordinates(target.coordinates);
  await waitForPreviewSmoke(1200);

  const selectedState = scene.describeState().selectedState;
  return {
    ok: true,
    roomId: target.roomId,
    coordinates: target.coordinates,
    selectedState,
  };
}

async function runOverworldPreviewSmokeAction(
  action: (scene: PreviewSmokeScene) => void,
  waitMs = 900,
): Promise<Record<string, unknown>> {
  const scene = getOverworldSceneForPreviewSmoke();
  if (!scene) {
    return { ok: false, reason: 'overworld-scene-missing' };
  }

  action(scene);
  await waitForPreviewSmoke(waitMs);
  return {
    ok: true,
    activeScene: getDebugState(),
  };
}

function getOverworldSceneForPreviewSmoke(): PreviewSmokeScene | null {
  try {
    return game.scene.getScene('OverworldPlayScene') as unknown as PreviewSmokeScene;
  } catch {
    return null;
  }
}

function findEditableRoomCandidate(
  scene: PreviewSmokeScene,
  requestedCoordinates: { x: number; y: number } | null,
): {
  roomId: string;
  coordinates: { x: number; y: number };
} | null {
  const summaryCandidates = Array.from(scene.roomSummariesById?.values() ?? [])
    .filter((candidate) => candidate.coordinates && (candidate.state === 'published' || candidate.state === 'draft'))
    .map((candidate) => ({
      roomId: candidate.id ?? `${candidate.coordinates!.x},${candidate.coordinates!.y}`,
      coordinates: { ...candidate.coordinates! },
    }));
  const draftCandidates = Array.from(scene.draftRoomsById?.values() ?? []).map((candidate) => ({
    roomId: candidate.id,
    coordinates: { ...candidate.coordinates },
  }));
  const allCandidates = [...summaryCandidates, ...draftCandidates];
  if (requestedCoordinates) {
    return (
      allCandidates.find(
        (candidate) =>
          candidate.coordinates.x === requestedCoordinates.x
          && candidate.coordinates.y === requestedCoordinates.y
      ) ?? null
    );
  }

  return allCandidates[0] ?? null;
}

function parsePreviewSmokeRoomId(value: string | null): { x: number; y: number } | null {
  if (!value || !value.trim()) {
    return null;
  }

  const match = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/.exec(value);
  if (!match) {
    return null;
  }

  return {
    x: Number(match[1]),
    y: Number(match[2]),
  };
}

function waitForPreviewSmoke(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
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
