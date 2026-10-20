import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { bootModulePreloadPlugin } from './bootModulePreload';

describe('startup module hints in actual Vite output', () => {
  it.each(['./', '/demo/'])('preloads only the gated static game graph with base %s', async base => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'wamp-boot-preload-')));
    try {
      mkdirSync(join(root, 'src'));
      const files = {
        'index.html': '<script type="module" src="/src/entry.ts"></script>',
        'admin.html': '<script type="module">console.log("admin")</script>',
        'src/entry.ts': 'window.ready.then(() => import("./main"));',
        'src/main.ts': 'import { value } from "./vendor"; window.game = value; window.editor = () => import("./editor");',
        'src/vendor.ts': 'import { shared } from "./shared"; export const value = shared + 1;',
        'src/shared.ts': 'export const shared = 1;',
        'src/editor.ts': 'window.editorLoaded = true;',
      };
      for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text);
      const result = await build({
        configFile: false, root, base, logLevel: 'silent', plugins: [bootModulePreloadPlugin()],
        build: { write: false, minify: false, rollupOptions: {
          input: { main: join(root, 'index.html'), admin: join(root, 'admin.html') },
          output: { manualChunks(id) {
            if (id.endsWith('/vendor.ts')) return 'vendor';
            if (id.endsWith('/shared.ts')) return 'shared';
            return undefined;
          } },
        } },
      });
      if (Array.isArray(result) || !('output' in result)) throw new Error('Expected one Vite output');
      const html = result.output.find(output => output.fileName === 'index.html');
      if (!html || html.type !== 'asset') throw new Error('Missing game document');
      const text = String(html.source);
      const links = [...text.matchAll(/<link[^>]*data-wamp-boot-preload[^>]*>/g)].map(match => match[0]);
      const hinted = links.map(link => link.match(/href="([^"]+)"/)![1]);
      const staticGameChunks = result.output.filter(output => output.type === 'chunk'
        && Object.keys(output.modules).some(id => /\/(main|vendor|shared)\.ts$/.test(id)));
      expect(hinted.sort()).toEqual(staticGameChunks.map(chunk => base + chunk.fileName).sort());
      expect(new Set(hinted).size).toBe(hinted.length);
      expect(links.every(link => link.includes('fetchpriority="low"') && link.includes('crossorigin'))).toBe(true);
      const editor = result.output.find(output => output.type === 'chunk'
        && Object.keys(output.modules).some(id => id.endsWith('/editor.ts')))!;
      expect(hinted).not.toContain(base + editor.fileName);
      const admin = result.output.find(output => output.fileName === 'admin.html');
      expect(admin && admin.type === 'asset' ? String(admin.source) : '').not.toContain('data-wamp-boot-preload');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
