import Phaser from 'phaser';
import { getAuthDebugState, setupAuthUi } from './auth/client';
import {
  initializeGuestActivityTracking,
  type GuestActivityMode,
} from './analytics/guestActivity';
import { initSfx, globalSfxController } from './audio/sfx';
import { runOverworldLodStress } from './debug/overworldLodStress';
import { globalRoomMusicController, initRoomMusic } from './music/controller';
import { BootScene } from './scenes/BootScene';
import { OverworldPlayScene } from './scenes/OverworldPlayScene';
import { ensureEditorScenesRegistered } from './scenes/editorSceneLoader';
import {
  getAppFeedbackDebugState,
  hideBusyOverlay,
  initializeAppFeedback,
  isAppReady,
  showBusyError,
  showBootSplash,
} from './ui/appFeedback';
import { getDeviceLayoutState } from './ui/deviceLayout';
import { syncGameKeyboardFocus } from './ui/keyboardFocus';
import { getTouchInputDebugState } from './ui/mobile/touchControls';
import { setupUI } from './ui/setup';
import { getCaptureDebugInfo } from './main/captureDebug';
import {
  getBootDiagnostics,
  installBootDiagnosticsGlobal,
  logBootPhase,
} from './main/bootDiagnostics';
import { getGameDebugState, getSwordHunterDebugState } from './main/debugState';
import { installEarlyWorldTileBootstrapHandoff } from './main/earlyWorldTileBootstrapHandoff';
import { installPreviewSmokeActions } from './main/previewSmoke';
import { normalizeRendererQuery, parseBooleanQuery, resolveRendererType } from './main/query';
import {
  getRuntimeResourceDebugState,
  installRuntimeResourceDebugLogger,
} from './main/resourceDebug';
import {
  type GraphicsDebugState,
  installWebglRecoveryMonitor,
} from './main/webglRecovery';
import { installRenderLoopRecoveryMonitor } from './main/renderLoopRecovery';
import { getGameSettings, subscribeGameSettings, type GameSettings } from './settings/userSettings';
import {
  getGameSettingsSyncDebugState,
  initializeGameSettingsSync,
} from './settings/userSettingsSync';

const gameContainer = document.getElementById('game-container')!;
const query = new URLSearchParams(window.location.search);

const debug_options = {
  renderer: normalizeRendererQuery(query.get('renderer')),
  preserveDrawingBuffer: parseBooleanQuery(query.get('preserveDrawingBuffer')),
  captureDebug: parseBooleanQuery(query.get('captureDebug')),
} as const;

installBootDiagnosticsGlobal();
logBootPhase('main:start', {
  renderer: debug_options.renderer ?? 'auto',
  preserveDrawingBuffer: debug_options.preserveDrawingBuffer,
  captureDebug: debug_options.captureDebug,
});

const config: Phaser.Types.Core.GameConfig = {
  type: resolveRendererType(debug_options.renderer),
  parent: gameContainer,
  width: gameContainer.clientWidth,
  height: gameContainer.clientHeight,
  pixelArt: true,
  roundPixels: true,
  preserveDrawingBuffer: debug_options.preserveDrawingBuffer,
  backgroundColor: '#050505',
  scene: [BootScene, OverworldPlayScene],
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

initializeAppFeedback();
installEarlyWorldTileBootstrapHandoff();
showBootSplash('Loading assets...', 0);
logBootPhase('phaser-game:create-start', {
  width: config.width,
  height: config.height,
});
const game = new Phaser.Game(config);
logBootPhase('phaser-game:created');
let gamePostStepCount = 0;
let rendererPostRenderCount = 0;
let lastGamePostStepAtMs: number | null = null;
let lastRendererPostRenderAtMs: number | null = null;
const restartPhaserRenderLoop = () => {
  const loop = game.loop as unknown as {
    running: boolean;
    focus(): void;
    wake(seamless?: boolean): void;
    raf: {
      isRunning: boolean;
      isSetTimeOut: boolean;
      timeOutID: number | null;
      stop(): void;
    };
  };
  loop.focus();
  loop.raf.stop();
  loop.running = false;
  loop.wake(true);
};
const renderLoopRecoveryMonitor = installRenderLoopRecoveryMonitor({
  restartLoop: restartPhaserRenderLoop,
  isEligible: () => (
    !document.hidden
    && !game.isPaused
    && getGameDebugState(game).mode === 'browse'
  ),
  log: (phase, details) => logBootPhase(
    `render-loop:${phase}`,
    details,
    {
      level: phase === 'restarted' ? 'info' : 'warn',
      force: true,
    },
  ),
});
game.events.on(Phaser.Core.Events.POST_STEP, () => {
  gamePostStepCount += 1;
  lastGamePostStepAtMs = performance.now();
});
game.renderer.on(Phaser.Renderer.Events.POST_RENDER, () => {
  rendererPostRenderCount += 1;
  lastRendererPostRenderAtMs = performance.now();
  renderLoopRecoveryMonitor.recordRender(lastRendererPostRenderAtMs);
});
const notifyRenderLoopUserActivity = () => renderLoopRecoveryMonitor.notifyUserActivity();
window.addEventListener('wheel', notifyRenderLoopUserActivity, { capture: true, passive: true });
window.addEventListener('pointerdown', notifyRenderLoopUserActivity, { capture: true, passive: true });
window.addEventListener('touchstart', notifyRenderLoopUserActivity, { capture: true, passive: true });
window.addEventListener('keydown', notifyRenderLoopUserActivity, { capture: true });
window.addEventListener('focus', () => renderLoopRecoveryMonitor.notifyVisibilityResume());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) renderLoopRecoveryMonitor.notifyVisibilityResume();
});
window.addEventListener('error', (event) => {
  renderLoopRecoveryMonitor.notifyRuntimeError({
    message: event.message,
    source: event.filename || null,
    line: event.lineno || null,
    column: event.colno || null,
  });
});
initSfx();
initRoomMusic();
const applyRuntimeSettings = (settings: GameSettings) => {
  globalSfxController.setVolume(settings.sfxVolume);
  globalRoomMusicController.setVolume(settings.musicVolume);
};
applyRuntimeSettings(getGameSettings());
subscribeGameSettings(applyRuntimeSettings);
initializeGameSettingsSync();
window.get_wamp_resource_debug = () => getRuntimeResourceDebugState(game);
installRuntimeResourceDebugLogger(game, query);

if (import.meta.env.DEV) {
  (window as Window & { __EVERYBODYS_PLATFORMER_GAME__?: Phaser.Game }).__EVERYBODYS_PLATFORMER_GAME__ = game;
  window.run_overworld_lod_stress = () => runOverworldLodStress(game);
}

// Set up HTML UI event handlers
setupUI(game);
logBootPhase('main:ui-ready');
void setupAuthUi();
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

const getDebugState = () => getGameDebugState(game);
let webglRecoveryStorage: Storage | null = null;
try {
  webglRecoveryStorage = window.sessionStorage;
} catch {
  // Storage access is optional; graphics recovery still works without it.
}
const webglRecoveryMonitor = installWebglRecoveryMonitor({
  renderer: game.renderer,
  storage: webglRecoveryStorage,
  getMode: () => getDebugState().mode === 'browse' ? 'browse' : 'protected',
  reloadPage: () => window.location.reload(),
  showManualRecovery: () => showBusyError(
    'The browser paused the game graphics. Your current room is still here; reload to restore the picture.',
    {
      title: 'Graphics paused',
      closeLabel: 'Keep waiting',
      retryHandler: () => window.location.reload(),
    },
  ),
  hideManualRecovery: () => hideBusyOverlay(),
  log: (phase, details) => logBootPhase(
    `webgl-context:${phase}`,
    details,
    {
      level: phase === 'restored' ? 'info' : 'warn',
      force: true,
    },
  ),
});
const getGraphicsDebugState = (): GraphicsDebugState => {
  const nowMs = performance.now();
  const renderer = game.renderer as typeof game.renderer & {
    contextLost?: boolean;
    gl?: WebGLRenderingContext | WebGL2RenderingContext;
  };
  const loop = game.loop as typeof game.loop & {
    raf?: {
      isRunning?: boolean;
      isSetTimeOut?: boolean;
      timeOutID?: number | null;
    };
  };
  const canvasRect = game.canvas.getBoundingClientRect();
  let browserReportsContextLost: boolean | null = null;
  try {
    browserReportsContextLost = renderer.gl?.isContextLost() ?? null;
  } catch {
    browserReportsContextLost = null;
  }
  return {
    ...webglRecoveryMonitor.getDebugState(),
    heartbeat: {
      gameFrame: game.loop.frame,
      gamePostStepCount,
      rendererPostRenderCount,
      lastGamePostStepAtMs,
      lastRendererPostRenderAtMs,
      gamePostStepAgeMs: lastGamePostStepAtMs === null
        ? null
        : Math.max(0, Math.round(nowMs - lastGamePostStepAtMs)),
      rendererPostRenderAgeMs: lastRendererPostRenderAtMs === null
        ? null
        : Math.max(0, Math.round(nowMs - lastRendererPostRenderAtMs)),
      loopRunning: game.loop.running,
      loopStarted: game.loop.started,
      loopInFocus: game.loop.inFocus,
      rafRunning: loop.raf?.isRunning === true,
      rafUsesSetTimeout: loop.raf?.isSetTimeOut === true,
      rafRequestId: typeof loop.raf?.timeOutID === 'number' ? loop.raf.timeOutID : null,
      gamePaused: game.isPaused,
      documentHidden: document.hidden,
      documentVisibilityState: document.visibilityState,
      documentHasFocus: document.hasFocus(),
    },
    renderLoopRecovery: renderLoopRecoveryMonitor.getDebugState(),
    renderer: {
      type: game.renderer.type,
      contextLost: renderer.contextLost ?? null,
      browserReportsContextLost,
      canvasConnected: game.canvas.isConnected,
      canvasWidth: game.canvas.width,
      canvasHeight: game.canvas.height,
      cssWidth: Math.round(canvasRect.width),
      cssHeight: Math.round(canvasRect.height),
    },
  };
};
window.get_wamp_graphics_debug = getGraphicsDebugState;

window.render_game_to_text = () =>
  JSON.stringify({
    coordinateSystem: 'Top-left origin. X increases right. Y increases down.',
    activeScene: getDebugState(),
    auth: getAuthDebugState(),
    chat: window.get_chat_debug_state?.() ?? null,
    device: getDeviceLayoutState(),
    touch: getTouchInputDebugState(),
    sfx: window.get_sfx_debug_state?.() ?? globalSfxController.getDebugState(),
    music: globalRoomMusicController.getDebugState(),
    settings: {
      values: getGameSettings(),
      sync: getGameSettingsSyncDebugState(),
    },
    appFeedback: {
      ready: isAppReady(),
      ...getAppFeedbackDebugState(),
    },
    graphics: getGraphicsDebugState(),
    bootDiagnostics: getBootDiagnostics(),
  });

window.get_room_music_debug_state = () => globalRoomMusicController.getDebugState();
window.get_sword_hunter_debug = () => getSwordHunterDebugState(game);
initializeGuestActivityTracking(getGuestActivitySnapshot);

if (query.get('previewSmoke') === '1') {
  void ensureEditorScenesRegistered(game).then(() => installPreviewSmokeActions(game, getDebugState));
}

window.capture_debug_info = () => getCaptureDebugInfo(game, debug_options, getDebugState);
window.get_auth_debug_state = () => ({ ...getAuthDebugState() });

if (typeof window.advanceTime !== 'function') {
  window.advanceTime = async (ms: number) => {
    await new Promise((resolve) => window.setTimeout(resolve, ms));
  };
}

if (debug_options.captureDebug) {
  window.setTimeout(() => {
    console.info('[capture-debug]', getCaptureDebugInfo(game, debug_options, getDebugState));
  }, 750);
}

// Handle window resize
window.addEventListener('resize', () => {
  queueResizeGameToContainer();
});

function getGuestActivitySnapshot(): {
  mode: GuestActivityMode;
  roomCoordinates: { x: number; y: number } | null;
} {
  const state = getDebugState();
  return {
    mode: resolveGuestActivityMode(state),
    roomCoordinates: readDebugRoomCoordinates(state),
  };
}

function resolveGuestActivityMode(state: Record<string, unknown>): GuestActivityMode {
  const appMode = document.body.dataset.appMode;
  if (appMode === 'play-world') {
    return 'play';
  }
  if (appMode === 'editor' || appMode === 'course-composer') {
    return 'edit';
  }

  return state.mode === 'play' ? 'play' : 'browse';
}

function readDebugRoomCoordinates(state: Record<string, unknown>): { x: number; y: number } | null {
  return (
    normalizeDebugCoordinates(state.currentRoom) ??
    normalizeDebugCoordinates(state.coordinates) ??
    normalizeDebugCoordinates(state.selectedCoordinates) ??
    normalizeDebugCoordinates(state.selected)
  );
}

function normalizeDebugCoordinates(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const coordinates = value as { x?: unknown; y?: unknown };
  if (!Number.isInteger(coordinates.x) || !Number.isInteger(coordinates.y)) {
    return null;
  }

  return {
    x: Number(coordinates.x),
    y: Number(coordinates.y),
  };
}
