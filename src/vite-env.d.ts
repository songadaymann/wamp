/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ROOM_API_BASE_URL?: string;
  readonly VITE_ROOM_STORAGE_BACKEND?: 'auto' | 'local' | 'remote';
  readonly VITE_REOWN_PROJECT_ID?: string;
  readonly VITE_WALLET_CONNECT_PROJECT_ID?: string;
  readonly VITE_ENABLE_TEST_RESET?: string;
  readonly VITE_PARTYKIT_HOST?: string;
  readonly VITE_PARTYKIT_PARTY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  render_game_to_text?: () => string;
  capture_debug_info?: () => Record<string, unknown>;
  advanceTime?: (ms: number) => Promise<void>;
  get_auth_debug_state?: () => Record<string, unknown>;
  get_sfx_debug_state?: () => Record<string, unknown>;
  play_sfx_debug?: (cue: import('./audio/sfx').SfxCue) => void;
  run_overworld_lod_stress?: () => Promise<Record<string, unknown>>;
  run_preview_smoke_action?: (
    action:
      | 'selectEditableRoom'
      | 'playSelectedRoom'
      | 'returnToWorld'
      | 'editSelectedRoom'
      | 'openSyntheticEditor',
    payload?: { roomId?: string | null },
  ) => Promise<Record<string, unknown>>;
  __EVERYBODYS_PLATFORMER_GAME__?: import('phaser').Game;
}
