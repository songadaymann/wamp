/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ROOM_API_BASE_URL?: string;
  readonly VITE_ROOM_STORAGE_BACKEND?: 'auto' | 'local' | 'remote';
  readonly VITE_REOWN_PROJECT_ID?: string;
  readonly VITE_WALLET_CONNECT_PROJECT_ID?: string;
  readonly VITE_ENABLE_TEST_RESET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  render_game_to_text?: () => string;
  capture_debug_info?: () => Record<string, unknown>;
  advanceTime?: (ms: number) => Promise<void>;
  get_auth_debug_state?: () => Record<string, unknown>;
}
