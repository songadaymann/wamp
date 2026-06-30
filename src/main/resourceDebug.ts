import Phaser from 'phaser';
import { globalSfxController } from '../audio/sfx';
import { getCustomSpriteRegistryDebugState } from '../customSprites/registry';
import { globalRoomMusicController } from '../music/controller';
import { getDynamicAvatarDebugState } from '../player/avatar/dynamic';
import { getRoomSnapshotTextureDebugState } from '../visuals/roomSnapshotTexture';
import { parseBooleanQuery } from './query';

const SCENE_KEYS = [
  'BootScene',
  'EditorScene',
  'OverworldPlayScene',
  'CourseComposerScene',
  'CourseEditorScene',
] as const;
const RESOURCE_DEBUG_STORAGE_KEY = 'wamp_resource_debug_enabled_v1';
const RESOURCE_DEBUG_LOG_STORAGE_KEY = 'wamp_resource_debug_log_v1';
const DEFAULT_CAPTURE_INTERVAL_MS = 15_000;
const MIN_CAPTURE_INTERVAL_MS = 5_000;
const MAX_LOG_ENTRIES = 240;
const RECENT_SOCKET_EVENT_LIMIT = 80;
const SENSITIVE_QUERY_KEY_PATTERNS = [
  'token',
  'key',
  'secret',
  'signature',
  'sig',
  'code',
  'state',
  'nonce',
  '_pk',
];

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

interface WebSocketResourceEvent {
  id: number;
  type: 'create' | 'open' | 'error' | 'close';
  at: string;
  ageMs: number;
  url: string;
  readyState: number;
  code?: number;
  reason?: string;
  wasClean?: boolean;
}

interface WebSocketResourceTracker {
  getState: () => Record<string, unknown>;
}

interface ResourceDebugLoggerOptions {
  captureIntervalMs: number;
  consoleLogging: boolean;
}

export interface ResourceDebugLoggerApi {
  capture: (reason?: string) => Record<string, unknown>;
  clear: () => void;
  download: () => void;
  getLog: () => Record<string, unknown>[];
  start: () => void;
  stop: () => void;
}

let webSocketTracker: WebSocketResourceTracker | null = null;

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

function getPageDebugState(): Record<string, unknown> {
  return {
    hidden: document.hidden,
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    online: navigator.onLine,
    href: sanitizeUrlForDebug(window.location.href),
    userAgent: navigator.userAgent,
  };
}

export function getRuntimeResourceDebugState(game: Phaser.Game): Record<string, unknown> {
  const textureKeys = getTextureKeys(game);
  const activeScene = getActiveScene(game);

  return {
    capturedAt: new Date().toISOString(),
    page: getPageDebugState(),
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
    webSockets: webSocketTracker?.getState() ?? null,
  };
}

export function installRuntimeResourceDebugLogger(
  game: Phaser.Game,
  query: URLSearchParams
): ResourceDebugLoggerApi | null {
  const options = resolveResourceDebugLoggerOptions(query);
  if (!options) {
    return null;
  }

  webSocketTracker = installWebSocketResourceTracker();
  const log = loadStoredResourceDebugLog();
  let sequence = readLastSequence(log);
  let intervalId: number | null = null;

  const capture = (reason = 'manual'): Record<string, unknown> => {
    sequence += 1;
    const snapshot = {
      sequence,
      reason,
      ...getRuntimeResourceDebugState(game),
    };
    log.push(snapshot);
    while (log.length > MAX_LOG_ENTRIES) {
      log.shift();
    }
    writeStoredResourceDebugLog(log);

    if (options.consoleLogging || reason !== 'interval') {
      console.info('[wamp-resource-debug]', summarizeResourceDebugSnapshot(snapshot), snapshot);
    }

    return snapshot;
  };

  const api: ResourceDebugLoggerApi = {
    capture,
    clear: () => {
      log.length = 0;
      sequence = 0;
      safeLocalStorageRemove(RESOURCE_DEBUG_LOG_STORAGE_KEY);
    },
    download: () => {
      downloadResourceDebugLog(log);
    },
    getLog: () => [...log],
    start: () => {
      if (intervalId !== null) {
        return;
      }
      intervalId = window.setInterval(() => capture('interval'), options.captureIntervalMs);
    },
    stop: () => {
      if (intervalId === null) {
        return;
      }
      window.clearInterval(intervalId);
      intervalId = null;
    },
  };

  window.wampResourceDebug = api;
  window.get_wamp_resource_log = api.getLog;
  window.download_wamp_resource_log = api.download;
  window.clear_wamp_resource_log = api.clear;

  api.start();
  capture('enabled');
  window.addEventListener('visibilitychange', () => {
    capture(`visibility:${document.visibilityState}`);
  });
  window.addEventListener('focus', () => {
    capture('window:focus');
  });
  window.addEventListener('blur', () => {
    capture('window:blur');
  });
  window.addEventListener('pagehide', () => {
    capture('pagehide');
  });
  window.addEventListener('error', (event) => {
    capture(`window:error:${event.message || 'unknown'}`);
  });
  window.addEventListener('unhandledrejection', () => {
    capture('window:unhandledrejection');
  });

  console.info(
    [
      '[wamp-resource-debug] enabled.',
      'Use window.wampResourceDebug.capture("slow") when it slows down,',
      'window.wampResourceDebug.getLog() to inspect,',
      'or window.wampResourceDebug.download() to save the log.',
    ].join(' ')
  );

  return api;
}

function resolveResourceDebugLoggerOptions(query: URLSearchParams): ResourceDebugLoggerOptions | null {
  const queryValue = query.get('resourceDebug');
  if (queryValue !== null) {
    const enabled = parseBooleanQuery(queryValue);
    if (enabled) {
      safeLocalStorageSet(RESOURCE_DEBUG_STORAGE_KEY, '1');
    } else {
      safeLocalStorageRemove(RESOURCE_DEBUG_STORAGE_KEY);
      safeLocalStorageRemove(RESOURCE_DEBUG_LOG_STORAGE_KEY);
      return null;
    }
  }

  const enabled = queryValue !== null
    ? parseBooleanQuery(queryValue)
    : safeLocalStorageGet(RESOURCE_DEBUG_STORAGE_KEY) === '1';
  if (!enabled) {
    return null;
  }

  return {
    captureIntervalMs: resolveCaptureIntervalMs(query),
    consoleLogging: parseBooleanQuery(query.get('resourceDebugConsole')),
  };
}

function resolveCaptureIntervalMs(query: URLSearchParams): number {
  const parsed = Number(query.get('resourceDebugMs'));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CAPTURE_INTERVAL_MS;
  }
  return Math.max(MIN_CAPTURE_INTERVAL_MS, Math.round(parsed));
}

function installWebSocketResourceTracker(): WebSocketResourceTracker {
  const existing = window.wampResourceWebSocketTracker;
  if (existing) {
    return existing;
  }

  const NativeWebSocket = window.WebSocket;
  const sockets = new Map<number, { url: string; createdAtMs: number; readyState: number }>();
  const events: WebSocketResourceEvent[] = [];
  let nextSocketId = 1;

  const recordEvent = (
    id: number,
    type: WebSocketResourceEvent['type'],
    socket: WebSocket,
    extra: Partial<WebSocketResourceEvent> = {}
  ) => {
    const tracked = sockets.get(id);
    if (tracked) {
      tracked.readyState = socket.readyState;
    }
    const createdAtMs = tracked?.createdAtMs ?? performance.now();
    events.push({
      id,
      type,
      at: new Date().toISOString(),
      ageMs: Math.round(performance.now() - createdAtMs),
      url: tracked?.url ?? 'unknown',
      readyState: socket.readyState,
      ...extra,
    });
    while (events.length > RECENT_SOCKET_EVENT_LIMIT) {
      events.shift();
    }
  };

  const TrackingWebSocket = function trackingWebSocket(
    this: WebSocket,
    url: string | URL,
    protocols?: string | string[]
  ): WebSocket {
    const socket = protocols === undefined
      ? new NativeWebSocket(url)
      : new NativeWebSocket(url, protocols);
    const id = nextSocketId;
    nextSocketId += 1;
    sockets.set(id, {
      url: sanitizeUrlForDebug(String(url)),
      createdAtMs: performance.now(),
      readyState: socket.readyState,
    });
    recordEvent(id, 'create', socket);
    socket.addEventListener('open', () => recordEvent(id, 'open', socket));
    socket.addEventListener('error', () => recordEvent(id, 'error', socket));
    socket.addEventListener('close', (event) => {
      recordEvent(id, 'close', socket, {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
      sockets.delete(id);
    });
    return socket;
  } as unknown as typeof WebSocket;

  TrackingWebSocket.prototype = NativeWebSocket.prototype;
  Object.defineProperties(TrackingWebSocket, {
    CONNECTING: { value: NativeWebSocket.CONNECTING },
    OPEN: { value: NativeWebSocket.OPEN },
    CLOSING: { value: NativeWebSocket.CLOSING },
    CLOSED: { value: NativeWebSocket.CLOSED },
  });

  window.WebSocket = TrackingWebSocket;
  const tracker: WebSocketResourceTracker = {
    getState: () => {
      const readyStates = {
        connecting: 0,
        open: 0,
        closing: 0,
        closed: 0,
        unknown: 0,
      };
      for (const socket of sockets.values()) {
        if (socket.readyState === NativeWebSocket.CONNECTING) {
          readyStates.connecting += 1;
        } else if (socket.readyState === NativeWebSocket.OPEN) {
          readyStates.open += 1;
        } else if (socket.readyState === NativeWebSocket.CLOSING) {
          readyStates.closing += 1;
        } else if (socket.readyState === NativeWebSocket.CLOSED) {
          readyStates.closed += 1;
        } else {
          readyStates.unknown += 1;
        }
      }

      return {
        activeCount: sockets.size,
        readyStates,
        recentEvents: [...events],
      };
    },
  };
  window.wampResourceWebSocketTracker = tracker;
  return tracker;
}

function summarizeResourceDebugSnapshot(snapshot: Record<string, unknown>): Record<string, unknown> {
  const memory = snapshot.memory as Record<string, unknown> | null | undefined;
  const loop = snapshot.loop as Record<string, unknown> | null | undefined;
  const textures = snapshot.textures as Record<string, unknown> | null | undefined;
  const webSockets = snapshot.webSockets as Record<string, unknown> | null | undefined;
  return {
    sequence: snapshot.sequence,
    reason: snapshot.reason,
    capturedAt: snapshot.capturedAt,
    fps: loop?.actualFps ?? null,
    usedMemoryMB: memory?.usedMB ?? null,
    totalTextures: textures?.total ?? null,
    activeWebSockets: webSockets?.activeCount ?? null,
  };
}

function sanitizeUrlForDebug(value: string): string {
  try {
    const url = new URL(value, window.location.href);
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitiveQueryKey(key)) {
        url.searchParams.set(key, '[redacted]');
      }
    }
    return url.toString();
  } catch {
    return value;
  }
}

function isSensitiveQueryKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_QUERY_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function loadStoredResourceDebugLog(): Record<string, unknown>[] {
  const raw = safeLocalStorageGet(RESOURCE_DEBUG_LOG_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'));
    }
  } catch {
    safeLocalStorageRemove(RESOURCE_DEBUG_LOG_STORAGE_KEY);
  }

  return [];
}

function writeStoredResourceDebugLog(log: Record<string, unknown>[]): void {
  try {
    window.localStorage.setItem(RESOURCE_DEBUG_LOG_STORAGE_KEY, JSON.stringify(log));
  } catch {
    while (log.length > Math.ceil(MAX_LOG_ENTRIES / 2)) {
      log.shift();
    }
    try {
      window.localStorage.setItem(RESOURCE_DEBUG_LOG_STORAGE_KEY, JSON.stringify(log));
    } catch {
      // Keep the in-memory log even if persistent storage is full or unavailable.
    }
  }
}

function downloadResourceDebugLog(log: Record<string, unknown>[]): void {
  const blob = new Blob([`${JSON.stringify(log, null, 2)}\n`], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `wamp-resource-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function readLastSequence(log: Record<string, unknown>[]): number {
  const last = log.at(-1);
  return typeof last?.sequence === 'number' ? last.sequence : 0;
}

function safeLocalStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Debug opt-in should not break startup when storage is blocked.
  }
}

function safeLocalStorageRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Debug opt-out should not break startup when storage is blocked.
  }
}
