/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ROOM_API_BASE_URL?: string;
  readonly VITE_ROOM_STORAGE_BACKEND?: 'auto' | 'local' | 'remote';
  readonly VITE_REOWN_PROJECT_ID?: string;
  readonly VITE_WALLET_CONNECT_PROJECT_ID?: string;
  readonly VITE_ENABLE_TEST_RESET?: string;
  readonly VITE_PARTYKIT_HOST?: string;
  readonly VITE_PARTYKIT_PARTY?: string;
  readonly VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  render_game_to_text?: () => string;
  capture_debug_info?: () => Record<string, unknown>;
  advanceTime?: (ms: number) => Promise<void>;
  get_auth_debug_state?: () => Record<string, unknown>;
  get_room_music_debug_state?: () => Record<string, unknown>;
  get_sword_hunter_debug?: () => Record<string, unknown>;
  get_sfx_debug_state?: () => Record<string, unknown>;
  play_sfx_debug?: (
    cue: import('./audio/sfx').SfxCue,
    playbackOptions?: import('./audio/sfx').SfxPlaybackOptions,
  ) => void;
  run_overworld_lod_stress?: () => Promise<Record<string, unknown>>;
  wampMobilePerf?: import('./debug/mobilePerformanceProfiler').MobilePerformanceProfilerApi;
  wampMobileCameraTuner?: {
    get: () => import('./ui/setup/sceneBridge').MobilePortraitCameraTuningSnapshot;
    log: (reason?: string) => import('./ui/setup/sceneBridge').MobilePortraitCameraTuningSnapshot;
    set: (
      input: import('./ui/setup/sceneBridge').MobilePortraitCameraTuningInput,
      reason?: string,
    ) => import('./ui/setup/sceneBridge').MobilePortraitCameraTuningSnapshot;
    adjust: (
      adjustment: import('./ui/setup/sceneBridge').MobilePortraitCameraTuningAdjustment,
      reason?: string,
    ) => import('./ui/setup/sceneBridge').MobilePortraitCameraTuningSnapshot;
    reset: () => import('./ui/setup/sceneBridge').MobilePortraitCameraTuningSnapshot;
  };
  run_preview_smoke_action?: (
    action:
      | 'selectEditableRoom'
      | 'playSelectedRoom'
      | 'returnToWorld'
      | 'editSelectedRoom'
      | 'openSyntheticEditor'
      | 'setPlayerPosition',
    payload?: {
      roomId?: string | null;
      x?: number;
      y?: number;
      velocityX?: number;
      velocityY?: number;
      bodyEnabled?: boolean;
    },
  ) => Promise<Record<string, unknown>>;
  __EVERYBODYS_PLATFORMER_GAME__?: import('phaser').Game;
}
