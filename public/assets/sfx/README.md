Drop sound effects here.

Suggested subfolders:
- `ui/`
- `movement/`
- `combat/`
- `goals/`
- `pickups/`
- `chat/`
- `world/`

Current code-level cue names already wired:
- `ui-click`
- `collect`
- `enemy-kill`
- `sword-slash`
- `gun-shot`
- `bullet-impact`
- `goal-start`
- `goal-checkpoint`
- `goal-success`
- `goal-fail`
- `bounce`
- `jump`
- `land`

WAV files are retained authoring sources and excluded from Pages. Playback tries OGG/AAC and then the generated MP3 rescue file. Generate/check MP3 files with `npm run assets:audio:build` / `npm run assets:audio:check`; see `docs/review/wamp-audio-assets-2026-10-13.md`.
