import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '../music/audioAssetManifest.json';
import { AUDIO_SOURCE_PATHS, excludeAudioSources } from './audioSourceExclusion';

describe('audio source build exclusion', () => {
  it('removes every source copy while retaining every playback file and unrelated WAVs', () => {
    const output = mkdtempSync(join(tmpdir(), 'wamp-audio-output-'));
    try {
      const playback = manifest.assets.map((asset) => asset.output.slice('public/'.length));
      const retained = [...playback, 'assets/other/demo.wav', '_worker.js'];
      for (const path of [...AUDIO_SOURCE_PATHS, ...retained]) {
        mkdirSync(dirname(join(output, path)), { recursive: true });
        writeFileSync(join(output, path), 'fixture');
      }
      excludeAudioSources(output);
      for (const source of AUDIO_SOURCE_PATHS) expect(existsSync(join(output, source))).toBe(false);
      for (const path of retained) expect(existsSync(join(output, path))).toBe(true);
    } finally { rmSync(output, { recursive: true, force: true }); }
  });
});
