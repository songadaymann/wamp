import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetUrl } from '../assets/assetUrl';
import { createPublicAssetHashes } from './publicAssetHashes';
import { build } from 'vite';
import { publicAssetCssVersions, publicAssetVersionPlugin, versionQuotedAssetUrls } from './publicAssetVersionPlugin';

describe('build-time public asset versions', () => {
  it('changes the URL only for changed bytes, independent of file ordering or code releases', () => {
    const root = mkdtempSync(join(tmpdir(), 'wamp-assets-'));
    try {
      mkdirSync(join(root, 'assets/fonts'), { recursive: true });
      writeFileSync(join(root, 'assets/art.png'), 'first pixels'); writeFileSync(join(root, 'assets/fonts/font.ttf'), 'font');
      const before = createPublicAssetHashes(root);
      expect(createPublicAssetHashes(root)).toEqual(before);
      writeFileSync(join(root, 'assets/art.png'), 'new pixels');
      const after = createPublicAssetHashes(root);
      expect(assetUrl('assets/art.png', after)).not.toBe(assetUrl('assets/art.png', before));
      expect(assetUrl('assets/fonts/font.ttf', after)).toBe(assetUrl('assets/fonts/font.ttf', before));
    } finally { rmSync(root, { recursive: true }); }
  });
  it('versions HTML images, preload/data attributes and inline background cards', () => {
    const hashes = { 'assets/art.png': '123456abcdef' };
    expect(versionQuotedAssetUrls(`<link href="/assets/art.png"><img data-icon-src="/assets/art.png"><div style="--image:url('/assets/art.png')"></div>`, hashes))
      .toBe(`<link href="/assets/art.png?v=123456abcdef"><img data-icon-src="/assets/art.png?v=123456abcdef"><div style="--image:url('/assets/art.png?v=123456abcdef')"></div>`);
  });
  it('versions quoted and unquoted CSS URLs including font names with spaces', () => {
    const plugin = publicAssetVersionPlugin({ 'assets/fonts/Font Name.ttf': '123456abcdef', 'assets/art.png': 'abcdef123456' }) as { transform: (source: string, id: string) => { code: string } };
    expect(plugin.transform(`src:url('/assets/fonts/Font Name.ttf');background:url(/assets/art.png);content:"/assets/art.png";`, 'style.css').code)
      .toBe(`src:url('/assets/fonts/Font Name.ttf?v=123456abcdef');background:url(/assets/art.png?v=abcdef123456);content:"/assets/art.png";`);
  });  it('keeps versions through Vite production processing of nested CSS imports', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'wamp-css-')));
    try {
      mkdirSync(join(root, 'public/assets'), { recursive: true });
      writeFileSync(join(root, 'public/assets/icon.png'), 'pixels');
      writeFileSync(join(root, 'index.html'), '<link rel="stylesheet" href="/style.css">');
      writeFileSync(join(root, 'style.css'), "@import './nested.css';");
      writeFileSync(join(root, 'nested.css'), "body{background:url('/assets/icon.png')}");
      const hashes = createPublicAssetHashes(join(root, 'public'));
      const result = await build({ root, configFile: false, logLevel: 'silent', base: './', css: { postcss: { plugins: [publicAssetCssVersions(hashes)] } }, build: { write: false } });
      const output = (Array.isArray(result) ? result[0] : result) as { output: Array<{ fileName: string; source?: string | Uint8Array }> };
      const css = output.output.find(asset => asset.fileName.endsWith('.css'));
      expect(String(css?.source)).toContain(`icon.png?v=${hashes['assets/icon.png']}`);
    } finally { rmSync(root, { recursive: true }); }
  });

});
