# F023 smaller audio assets — October 13, 2026

Status: verified candidate on `codex/wamp-audio-assets-2026-10-13`, based on main `d2edb340`. Listening acceptance and production delivery remain pending. F023 stays unticked; master remains 135/215. This finishes the asset work left after PRs #138, #162 and #164, preserving their parallel loading, hot-effect warming and shared Web Audio engine.

## What changes

| Playback files | Previous source bytes | New playback bytes | Reduction |
| --- | ---: | ---: | ---: |
| 15 MT-32 samples | 2,007,220 | 145,063 | 92.8% |
| 14 music stems | 2,544,780 | 1,582,686 | 37.8% |
| 31 SFX rescue files | 4,998,442 | 292,305 | 94.2% |

The drums have the same mono average, 0.0025 silence threshold, 48-frame padding and 0.92 peak target baked at 44.1 kHz. Playback decodes the baked sample and retains the existing tight-kick pitch variant. Each file still downloads once, with all 15 files loading together. The unused `snare-01.wav` is excluded too.

The music pack keeps its IDs, gains, 120 BPM and four two-second bars. It reads 112 kbps `.compact.mp3` files. Existing OGG/AAC SFX remain unchanged; the third fallback is now MP3 rather than WAV, with the existing successful-format preference retained.

Source WAVs and stem MP3s remain in Git. `.assetsignore` records the source-only exclusions for Workers asset uploads. Pages' current uploader ignores that file, so a Vite build plugin also removes the 61 source copies from the output before upload, retaining every playback file. A regression fixture checks all excluded sources, every compressed output and unrelated WAV/worker files. Accounting for the unused snare, 9,612,510 source bytes leave the deployment and 2,020,054 playback bytes enter it: **7,592,456 fewer bytes**. This is deployment hygiene; excluding SFX WAVs alone does not make normal player downloads faster.

## Decoder and loop handling

MP3 was selected after probing actual Chromium and WebKit decoders. This WebKit build rejects OGG and AAC, including the existing SFX files; its MP3 fallback decodes successfully. Physical iPhone playback still needs the requested listening check.

CoreAudio ignores gapless padding on mono MP3, shifting these drum attacks by 576 frames. The final drum files contain two identical channels of the baked mono signal; both decoders then preserve the attack and duration. Playback reads the first channel without another mix, trim or normalization.

The original Logic music exports have iTunes gapless metadata. Safari decodes exactly eight seconds; Chromium and FFmpeg decode 355,968 frames, with the intended starting point 2,209 frames later (50.09 ms). The offline import removes that padding and retains 352,800 intended frames. All 14 imports match Safari's original decoded PCM at zero lag, with correlation above 0.99999. The new MP3s decode to eight seconds in both browsers. Saved arrangements still slice the same bar offsets, including alternating clips and empty bars.

## Validation

- Full `npm run check`: 468 files / 3,522 tests pass; lint, types, DOM contract, world types, production build and PNG/tree/audio gates pass. Startup JavaScript: 649.0 KB brotli, under 670 KB.
- 356 real decoder operations: all 60 new files plus 29 original music files, in Chromium and WebKit at 44.1 and 48 kHz. All succeed. Every new duration is within one resampling frame of its declared duration, with the expected channel count.
- All drum/stem comparisons have zero measured lag; minimum original/candidate correlation is 0.98375. Stem alignment is checked independently against original Safari PCM. Correlation measures timing/similarity; it does not replace a listening check of lossy encoding or loop seams.
- Native phone game probes in both browsers: 16 drum rows use 15 compressed downloads; clip preview and mixed-bar lane loop have 384,000 frames at 48 kHz; copied bar samples and the empty bar match exactly. All observed audio URLs carry content hashes and none request WAV. SFX load and play successfully, including WebKit's MP3 fallback, with no page exceptions or audio errors. Real movement and the phone Jump button pass.
- Official game client gameplay capture inspected. Its first boot reported the absent local PartyKit service; the gameplay rerun passes without console errors.
- All 12 broader mobile CI scenarios pass with zero console/page errors and zero replay fixture misses. Hosted review checks remain pending.

## Rebuilding and listening

`npm run assets:audio:build` requires FFmpeg with libmp3lame (`WAMP_FFMPEG` can select it). The build records source/output SHA-256 values and exact processing settings in `src/music/audioAssetManifest.json`. `npm run assets:audio:check`, included in the full gate, detects source or generated-byte drift without requiring FFmpeg in CI. A changed source or output requires regeneration and another listening check.

Listening artifacts are in ignored `output/audio-review-2026-10-13/`: `original.wav` and `candidate.wav` each contain 16 seconds of drum hits, one second of silence and two iterations of a mixed four-bar music loop. The originals use Safari's intended gapless timing. Longer separate drum and two-mix music comparisons are alongside them. Local decoder/game proof is in `/tmp/wamp-f023-2026-10-13/`.

Next: Jonathan's listening check, then green hosted checks, merge, Pages delivery and verification of the actual custom-domain playback files and source exclusions. No API, D1, PartyKit or world renderer changes are required.
