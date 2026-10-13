import type { PluginOption } from 'vite';
import { assetUrl } from '../assets/assetUrl';

export function versionQuotedAssetUrls(source: string, hashes: Readonly<Record<string, string>>): string {
  return source.replace(/(["'])(\/?assets\/[^"']+)\1/g, (_match, quote: string, path: string) => `${quote}${assetUrl(path, hashes)}${quote}`);
}

export function publicAssetVersionPlugin(hashes: Readonly<Record<string, string>>): PluginOption {
  return {
    name: 'public-asset-content-versions',
    enforce: 'pre',
    transform(source, id) {
      if (!id.split('?')[0].endsWith('.css')) return null;
      // Limit CSS rewrites to url() values, rather than unrelated quoted content.
      const code = versionCssAssetUrls(source, hashes);
      return code === source ? null : { code, map: null };
    },
    transformIndexHtml: { order: 'pre', handler: html => versionQuotedAssetUrls(html, hashes) },
  };
}

export function versionCssAssetUrls(source: string, hashes: Readonly<Record<string, string>>): string {
  return source.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/g, (match, quote: string, path: string) => {
    const versioned = assetUrl(path.trim(), hashes);
    return versioned === path.trim() ? match : `url(${quote}${versioned}${quote})`;
  });
}

/** PostCSS import expands nested sheets without going through Vite's transform hook. */
export function publicAssetCssVersions(hashes: Readonly<Record<string, string>>) {
  return {
    postcssPlugin: 'public-asset-content-versions',
    Once(root: { walkDecls: (visit: (declaration: { value: string }) => void) => void }) {
      // Run before Vite replaces public URLs with production placeholders.
      root.walkDecls(declaration => { declaration.value = versionCssAssetUrls(declaration.value, hashes); });
    },
  };
}
