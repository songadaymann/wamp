import { rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { Plugin } from 'vite';
import manifest from '../music/audioAssetManifest.json';

export const AUDIO_SOURCE_PATHS = [
  ...manifest.assets.map((asset) => asset.source.slice('public/'.length)),
  'assets/music/roland-mt32/snare-01.wav',
];

/** Pages' uploader does not read .assetsignore; remove source copies after Vite writes them. */
export function excludeAudioSources(outputDirectory: string): void {
  const root = resolve(outputDirectory);
  for (const source of AUDIO_SOURCE_PATHS) {
    const path = resolve(root, source);
    if (!source.startsWith('assets/') || !path.startsWith(root + sep)) {
      throw new Error(`Invalid audio source path: ${source}`);
    }
    rmSync(path, { force: true });
  }
}

export function audioSourceExclusionPlugin(): Plugin {
  let outputDirectory: string;
  return {
    name: 'wamp-audio-source-exclusion',
    apply: 'build',
    configResolved(config) { outputDirectory = resolve(config.root, config.build.outDir); },
    writeBundle() { excludeAudioSources(outputDirectory); },
  };
}
