import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, transformWithEsbuild, type PluginOption } from 'vite';
import {
  WORLD_TILE_BYTE_CACHE_HASH_PARAM,
  WORLD_TILE_BYTE_CACHE_NAME,
} from './src/scenes/overworld/worldTiles/byteCacheContract';

const EARLY_WORLD_TILE_BOOTSTRAP_MARKER = '<!-- wamp-early-world-tiles-bootstrap -->';
// One-time namespace bump after an immutable Pages fallback cached HTML at a
// handful of previously-issued asset URLs. Keep this stable: content hashes
// handle ordinary releases, while the Pages asset guard prevents recurrence.
const BUILD_ASSET_NAMESPACE = 'assets/cache-v2';

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
  const cloudflareWebAnalyticsToken = env.VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN?.trim() ?? '';

  return {
    base: './',
    plugins: [
      earlyWorldTileBootstrapPlugin(roomApiBaseUrl),
      cloudflareWebAnalyticsPlugin(cloudflareWebAnalyticsToken),
    ],
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
          jam: resolve(process.cwd(), 'jam.html'),
          dashboard: resolve(process.cwd(), 'dashboard.html'),
          launchAdmin: resolve(process.cwd(), 'launch-admin.html'),
          backgroundAdmin: resolve(process.cwd(), 'background-admin.html'),
          schoolAdmin: resolve(process.cwd(), 'school-admin.html'),
          schoolLogin: resolve(process.cwd(), 'school-login.html'),
          suspiciousAdmin: resolve(process.cwd(), 'suspicious-admin.html'),
          mintedRoom: resolve(process.cwd(), 'minted-room.html'),
          roomPreviewRender: resolve(process.cwd(), 'room-preview-render.html'),
          worldTileRender: resolve(process.cwd(), 'world-tile-render.html'),
          rewardStingsPreview: resolve(process.cwd(), 'reward-stings-preview.html'),
        },
        output: {
          entryFileNames: `${BUILD_ASSET_NAMESPACE}/[name]-[hash].js`,
          chunkFileNames: `${BUILD_ASSET_NAMESPACE}/[name]-[hash].js`,
          assetFileNames: `${BUILD_ASSET_NAMESPACE}/[name]-[hash][extname]`,
          manualChunks(id) {
            if (id.includes('/node_modules/phaser/')) return 'phaser-vendor';
            return undefined;
          },
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

function earlyWorldTileBootstrapPlugin(apiBaseUrl: string): PluginOption {
  const entryPath = resolve(process.cwd(), 'src/main/earlyWorldTileBootstrap.classic.ts');
  let compiledSource: Promise<string> | null = null;
  return {
    name: 'early-world-tile-bootstrap',
    enforce: 'pre',
    async transformIndexHtml(html, context) {
      if (context.filename && resolve(context.filename) !== resolve(process.cwd(), 'index.html')) {
        return html;
      }
      if (!html.includes(EARLY_WORLD_TILE_BOOTSTRAP_MARKER)) return html;
      compiledSource ??= transformWithEsbuild(readFileSync(entryPath, 'utf8'), entryPath, {
        loader: 'ts',
        target: 'es2020',
        format: 'iife',
        minify: true,
        define: {
          __WAMP_EARLY_WORLD_TILE_API_BASE__: JSON.stringify(apiBaseUrl),
          __WAMP_WORLD_TILE_BYTE_CACHE_NAME__: JSON.stringify(WORLD_TILE_BYTE_CACHE_NAME),
          __WAMP_WORLD_TILE_BYTE_CACHE_HASH_PARAM__: JSON.stringify(WORLD_TILE_BYTE_CACHE_HASH_PARAM),
        },
      }).then(({ code }) => code.replace(/<\/script/gi, '<\\/script'));
      const source = await compiledSource;
      return html.replace(
        EARLY_WORLD_TILE_BOOTSTRAP_MARKER,
        `<script data-wamp-early-world-tiles-bootstrap="v1">${source}</script>`,
      );
    },
  };
}

function cloudflareWebAnalyticsPlugin(token: string): PluginOption {
  return {
    name: 'cloudflare-web-analytics',
    transformIndexHtml() {
      if (!token) {
        return [];
      }

      return [
        {
          tag: 'script',
          attrs: {
            defer: true,
            src: 'https://static.cloudflareinsights.com/beacon.min.js',
            'data-cf-beacon': JSON.stringify({ token }),
          },
          injectTo: 'body',
        },
      ];
    },
  };
}

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
