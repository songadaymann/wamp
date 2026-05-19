import Phaser from 'phaser';
import { getAuthDebugState, setupAuthUi } from './auth/client';
import {
  initializeGuestActivityTracking,
  type GuestActivityMode,
} from './analytics/guestActivity';
import { initSfx, globalSfxController } from './audio/sfx';
import { runOverworldLodStress } from './debug/overworldLodStress';
import { globalRoomMusicController, initRoomMusic } from './music/controller';
import {
  bootstrapPlayfunModeFromUrl,
  getPlayfunDebugState,
  setupPlayfunClient,
} from './playfun/client';
import { BootScene } from './scenes/BootScene';
import { CourseEditorScene } from './scenes/CourseEditorScene';
import { CourseComposerScene } from './scenes/CourseComposerScene';
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
import { getCaptureDebugInfo } from './main/captureDebug';
import {
  getBootDiagnostics,
  installBootDiagnosticsGlobal,
  logBootPhase,
} from './main/bootDiagnostics';
import { getGameDebugState, getSwordHunterDebugState } from './main/debugState';
import { installPreviewSmokeActions } from './main/previewSmoke';
import { normalizeRendererQuery, parseBooleanQuery, resolveRendererType } from './main/query';
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
  scene: [BootScene, EditorScene, OverworldPlayScene, CourseComposerScene, CourseEditorScene],
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
logBootPhase('phaser-game:create-start', {
  width: config.width,
  height: config.height,
});
const game = new Phaser.Game(config);
logBootPhase('phaser-game:created');
initSfx();
initRoomMusic();
const applyRuntimeSettings = (settings: GameSettings) => {
  globalSfxController.setVolume(settings.sfxVolume);
  globalRoomMusicController.setVolume(settings.musicVolume);
};
applyRuntimeSettings(getGameSettings());
subscribeGameSettings(applyRuntimeSettings);
initializeGameSettingsSync();

if (import.meta.env.DEV) {
  (window as Window & { __EVERYBODYS_PLATFORMER_GAME__?: Phaser.Game }).__EVERYBODYS_PLATFORMER_GAME__ = game;
  window.run_overworld_lod_stress = () => runOverworldLodStress(game);
}

// Set up HTML UI event handlers
setupUI(game);
logBootPhase('main:ui-ready');
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

const getDebugState = () => getGameDebugState(game);

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
    music: globalRoomMusicController.getDebugState(),
    settings: {
      values: getGameSettings(),
      sync: getGameSettingsSyncDebugState(),
    },
    appFeedback: {
      ready: isAppReady(),
      ...getAppFeedbackDebugState(),
    },
    bootDiagnostics: getBootDiagnostics(),
  });

window.get_room_music_debug_state = () => globalRoomMusicController.getDebugState();
window.get_sword_hunter_debug = () => getSwordHunterDebugState(game);
initializeGuestActivityTracking(getGuestActivitySnapshot);

if (query.get('previewSmoke') === '1') {
  installPreviewSmokeActions(game, getDebugState);
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
