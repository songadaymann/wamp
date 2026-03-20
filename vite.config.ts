import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadMergedEnv(mode);
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

function loadMergedEnv(mode: string): Record<string, string> {
  const viteEnv = loadEnv(mode, process.cwd(), '');
  const repoEnv = loadRepoEnvFile('env.local');

  return {
    ...repoEnv,
    ...viteEnv,
  };
}

function loadRepoEnvFile(filename: string): Record<string, string> {
  const filepath = resolve(process.cwd(), filename);
  if (!existsSync(filepath)) {
    return {};
  }

  return parseEnvFile(readFileSync(filepath, 'utf8'));
}

function parseEnvFile(raw: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    env[key] = stripWrappingQuotes(value);
  }

  return env;
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
