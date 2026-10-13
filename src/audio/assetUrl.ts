import { assetUrl } from '../assets/assetUrl';
/** Relative Vite builds still serve public sound assets from the deployment root. */
export function resolveAudioAssetUrl(path: string, configuredBase: string, pageUrl: string): string {
  const base = !configuredBase || configuredBase === '.' || configuredBase === './' ? '/' : configuredBase;
  const origin = `${new URL(pageUrl).origin}/`;
  return new URL(assetUrl(path).replace(/^\/+/, ''), new URL(base, origin)).toString();
}

export const resolveSfxAssetUrl = resolveAudioAssetUrl;
