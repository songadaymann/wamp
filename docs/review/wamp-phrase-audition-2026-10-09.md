# F231 phrase audition and Arrange playhead

Delivered 2026-10-09 in [PR #103](https://github.com/songadaymann/wamp/pull/103), merge `bcb7af6a`, live on https://wamp.land through the Pages auto-build. Frontend only: no API Worker, D1, PartyKit, renderer or room-data change.

## Behavior

- **Audition.** Each Phrase Library item has a ▶ button beside it. It renders the phrase alone exactly as placing it would sound and loops it on the existing preview voice, without committing. The render uses the room's tempo, swing, key, pitch mode and octave, or the phrase's own timing/key where placing into an empty sequencer or arrangement adopts them. It plays at the default lane mix so a muted lane still auditions. Tapping ⏹ stops it. Starting the room preview, placing a phrase, switching instrument or composer mode, closing Music, scene reset and muting also stop it, and auditioning stops a playing room preview. With music volume at 0 the library status says so.
- **Arrange playhead.** While Arrange previews, the playing slot column is highlighted (cream bar and border across the four lanes). It is computed from the shared transport and the DOM is touched only when the slot changes.
- **Playhead timing.** The sequencer playhead follows the renderer's swung step pairs and subtracts `AudioContext.outputLatency` (clamped to 0.5 s).
- **Arrange library layout (existing bug).** On desktop the workbench tracked the room frame that Arrange covers, squeezing the Phrase Library to zero height (confirmed on unchanged `acb5ac53`). In Arrange it is now a wide tray beneath the slot grid in both editors, with heading and status on one row. Phone and touch layouts are unchanged.

## Evidence

- `npm run check` on Node 22 (CI version): lint, 410 files / 3,258 tests, typecheck, world-tile types and production build. DOM contract 1,003 IDs / 242 required. On this Mac's default Node 23, `draftLifecycle.test.ts` reports an unhandled `Event.returnValue` error; it reproduces on unchanged `origin/main` and does not occur on Node 22.
- Headless Chromium against the safety API, with every non-GET API request blocked, at 1440×900, 390×844 and 768×1024: audition start, switch, stop, room-preview exclusivity, place, Arrange playhead moving across slots in agreement with the transport, and Arrange audition tempo. The Expanded Room editor and the Arrange tray were checked at 1280×800, 1440×900 and 1920×1080. Zero page exceptions. Blocked requests were only presence tokens and snapshot queries.
- Live: the current wamp.land `main` CSS contains `.editor-music-library-audition` and its JS chunks contain the audition handler and `preview-sequence` voice.

## Not verified

Listening by ear and physical phone hardware. The checks confirm audio sources start, stop and loop as intended and that the highlight follows the audio clock, not how they sound.
