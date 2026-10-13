import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'src/music/audioAssetManifest.json');
const ffmpeg = process.env.WAMP_FFMPEG || 'ffmpeg';
const drums = ['bassdrum', 'clap', 'cowbell', 'crash', 'fx-click', 'hat-closed', 'hat-open', 'ride', 'rimshot', 'shaker', 'snare-02', 'tambourine', 'tom-high', 'tom-low', 'tom-mid'];
const stems = ['Arp1', 'Arp2', 'Arp3', 'Bass1', 'Bass2', 'Bass3', 'Drums1', 'Drums2', 'Drums3', 'Hold1', 'Hold2', 'Melody1', 'Melody2', 'Melody3'];
const hash = (file) => createHash('sha256').update(readFileSync(join(root, file))).digest('hex');

if (process.argv.includes('--check')) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const asset of manifest.assets) {
    if (hash(asset.source) !== asset.sourceSha256 || hash(asset.output) !== asset.outputSha256) {
      throw new Error(`Audio source/output changed: ${asset.output}. Rebuild and repeat the listening check.`);
    }
  }
  console.log(`Audio assets: ${manifest.assets.length} source/output pairs match the reviewed manifest.`);
} else {
  const temporary = mkdtempSync(join(tmpdir(), 'wamp-audio-'));
  const assets = [];
  const run = (args) => execFileSync(ffmpeg, ['-v', 'error', ...args], { maxBuffer: 32 * 1024 * 1024 });
  const decode = (source, channels) => {
    const bytes = run(['-i', join(root, source), '-f', 'f32le', '-acodec', 'pcm_f32le', '-ar', '44100', '-ac', String(channels), 'pipe:1']);
    return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  };
  const encode = (source, output, samples, channels, options, processing) => {
    const pcm = join(temporary, 'input.f32');
    writeFileSync(pcm, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
    mkdirSync(dirname(join(root, output)), { recursive: true });
    run(['-f', 'f32le', '-ar', '44100', '-ac', String(channels), '-i', pcm, '-map_metadata', '-1', '-c:a', 'libmp3lame', ...options, '-write_xing', '1', '-y', join(root, output)]);
    assets.push({ source, output, sourceSha256: hash(source), outputSha256: hash(output), sampleRate: 44100, channels, frames: samples.length / channels, ...processing });
  };
  try {
    for (const name of drums) {
      const source = `public/assets/music/roland-mt32/${name}.wav`;
      const stereo = decode(source, 2);
      const mono = new Float32Array(stereo.length / 2);
      for (let i = 0; i < mono.length; i++) mono[i] = stereo[i * 2] / 2 + stereo[i * 2 + 1] / 2;
      let start = 0, end = mono.length - 1;
      while (start < mono.length && Math.abs(mono[start]) < 0.0025) start++;
      while (end > start && Math.abs(mono[end]) < 0.0025) end--;
      const trimStart = Math.max(0, start - 48);
      const trimmed = mono.slice(trimStart, Math.min(mono.length, end + 49));
      let peak = 0;
      for (const value of trimmed) peak = Math.max(peak, Math.abs(value));
      if (peak > 0.0001) for (let i = 0; i < trimmed.length; i++) trimmed[i] *= 0.92 / peak;
      // CoreAudio ignores LAME gapless padding for mono MP3. Two identical
      // channels retain the baked mono sound and decode without a delayed attack.
      const dualMono = new Float32Array(trimmed.length * 2);
      for (let i = 0; i < trimmed.length; i++) dualMono[i * 2] = dualMono[i * 2 + 1] = trimmed[i];
      encode(source, source.replace('.wav', '.mp3'), dualMono, 2, ['-q:a', '3'], { mono: true, trimStart, threshold: 0.0025, paddingFrames: 48, targetPeak: 0.92 });
    }
    for (const name of stems) {
      const source = `public/assets/music/wamp-v1/${name}.mp3`;
      // These Logic exports contain iTunSMPB, but FFmpeg/Chromium ignore it. The
      // measured 2,209-frame offset reproduces Safari's intended eight-second loop.
      // All 14 exports are checked against Safari's decoded PCM in the audio probe.
      const decoded = decode(source, 2);
      const trimStart = 2209, frames = 352800;
      if (decoded.length !== 355968 * 2) throw new Error(`Unexpected Logic export length: ${source}`);
      const metadata = readFileSync(join(root, source));
      if (!metadata.includes(Buffer.from('00000210 00000A50 0000000000056220'))) throw new Error(`Unexpected gapless metadata: ${source}`);
      encode(source, source.replace('.mp3', '.compact.mp3'), decoded.slice(trimStart * 2, (trimStart + frames) * 2), 2, ['-b:a', '112k'], { trimStart });
    }
    // Keep existing OGG/AAC effects; replace only their source-WAV rescue format.
    const { readdirSync } = await import('node:fs');
    const visit = (directory) => {
      for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
        const source = `${directory}/${entry.name}`;
        if (entry.isDirectory()) visit(source);
        else if (entry.name.endsWith('.wav')) {
          if (!existsSync(join(root, source.replace('.wav', '.ogg'))) || !existsSync(join(root, source.replace('.wav', '.m4a')))) throw new Error(`Missing compressed SFX counterpart: ${source}`);
          encode(source, source.replace('.wav', '.mp3'), decode(source, 2), 2, ['-q:a', '4'], {});
        }
      }
    };
    visit('public/assets/sfx');
    writeFileSync(manifestPath, JSON.stringify({ encoder: run(['-version']).toString().split('\n')[0], assets }, null, 2) + '\n');
    console.log(`Built ${assets.length} compressed audio assets. Listening and browser loop checks required.`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
