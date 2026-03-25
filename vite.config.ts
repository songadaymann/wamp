import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const roomApiBaseUrl = env.VITE_ROOM_API_BASE_URL ?? '';
  const roomStorageBackend = env.VITE_ROOM_STORAGE_BACKEND ?? 'remote';
  const reownProjectId =
    env.VITE_REOWN_PROJECT_ID ?? env.VITE_WALLET_CONNECT_PROJECT_ID ?? '';
  const walletConnectProjectId =
    env.VITE_WALLET_CONNECT_PROJECT_ID ?? env.VITE_REOWN_PROJECT_ID ?? '';
  const enableTestReset = env.VITE_ENABLE_TEST_RESET ?? (mode === 'development' ? '1' : '');
  const partykitHost = env.VITE_PARTYKIT_HOST ?? '';
  const partykitParty = env.VITE_PARTYKIT_PARTY ?? '';

  return {
    base: './',
    define: {
      'import.meta.env.VITE_ROOM_API_BASE_URL': JSON.stringify(roomApiBaseUrl),
      'import.meta.env.VITE_ROOM_STORAGE_BACKEND': JSON.stringify(roomStorageBackend),
      'import.meta.env.VITE_REOWN_PROJECT_ID': JSON.stringify(reownProjectId),
      'import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID': JSON.stringify(walletConnectProjectId),
      'import.meta.env.VITE_ENABLE_TEST_RESET': JSON.stringify(enableTestReset),
      'import.meta.env.VITE_PARTYKIT_HOST': JSON.stringify(partykitHost),
      'import.meta.env.VITE_PARTYKIT_PARTY': JSON.stringify(partykitParty),
    },
    build: {
      outDir: 'dist',
      assetsInlineLimit: 0,
      rollupOptions: {
        input: {
          main: resolve(process.cwd(), 'index.html'),
          dashboard: resolve(process.cwd(), 'dashboard.html'),
          launchAdmin: resolve(process.cwd(), 'launch-admin.html'),
          suspiciousAdmin: resolve(process.cwd(), 'suspicious-admin.html'),
          mintedRoom: resolve(process.cwd(), 'minted-room.html'),
          roomPreviewRender: resolve(process.cwd(), 'room-preview-render.html'),
        },
      },
    },
    server: {
      port: 3000,
      strictPort: true,
      open: true,
      proxy: {
        '/api': {
          target: 'http://localhost:8787',
          changeOrigin: true,
        },
      },
    },
  };
});
