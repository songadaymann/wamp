# F220 live per-instrument mixing and slot-by-slot Arrange playback

Delivered 2026-10-09 in [PR #104](https://github.com/songadaymann/wamp/pull/104), merge `bdd4720e`, live on https://wamp.land through the Pages auto-build. This completes F220 together with the first slice from [PR #101](https://github.com/songadaymann/wamp/pull/101) (debounced previews, shared 50 MiB buffer cache). Frontend only: no API Worker, D1, PartyKit, renderer or room-data change. World play uses the same engine, so every room's music now plays through it.

## Behavior

- **Live mixing.** Pattern loops render one channel per sounding lane after that lane's own drive. Volume, pan and the final `tanh` soft clip run in Web Audio nodes (lane gain → StereoPanner → bus → WaveShaper → fade gain). Music that differs only in mix keeps playing and ramps to the new gains (15 ms time constant). The editor sends mix-only pattern edits straight to the loop, unless a note edit is still waiting on the 150 ms refresh.
- **Arrange slot by slot.** Each phrase is rendered once per lane in the arrangement's tempo, swing, key, pitch mode and octave, unfolded with its release and drum tails. A lookahead scheduler (1.5 s ahead, 250 ms tick) starts each slot's segments, including tails of earlier slots when starting mid-loop. Lane drive (triangle, drums) runs in the graph after neighbouring tails sum. An open hat that ends a phrase is played separately and choked by the next slot's first hat with the renderer's 10 ms fade. Edits reuse every segment already playing, so placing a phrase renders only that phrase. Slots and loops land on whole samples, and the loop repeats on the same rounded length as the old looped buffer. Arrange mix changes are live as well.
- **Close button.** The music and sprite editor Close button kept clear of the fixed menu button only below 1250 px; it now does up to 1439 px, the width at which the 1328 px shell leaves room beside it.

## Evidence

- `npm run check` on Node 22: lint, 411 files / 3,273 tests, typecheck, world-tile types and build. DOM contract 1,003 / 242.
- Real Chromium, OfflineAudioContext: the new graph matches the previous mixdown within 1e-6 (≈ −115 dB) for centered and panned 4-lane patterns and after a live mix change, with no new render. A 4-lane arrangement of real safety-library phrases (trailing open-hat choke, crash tails, 56% swing, panning) matches within 1e-6 over two loops at 120 and 100 BPM. At 97 BPM, where a 2-bar slot is 237,525.77 samples, each lane matches within ±1 sample per note (triangle 100% of 512-sample windows; others 89–99%, the rest where two overlapping notes shifted differently). Exact per-slot rounding was tried and dropped because it stops repeated phrases from sharing one render.
- Edit cost, Chromium on Apple silicon, 90 BPM: placing one phrase while previewing 7 ms (8 slots) / 4 ms (16 slots), versus 290 ms warm and 2.3 s cold for the old whole-arrangement render; a volume/pan change ≈ 0 ms.
- Headless editor runs on the safety API with all non-GET API requests blocked: live volume/pan keeps the same playback with updated lane gain/pan; placing a 4th phrase while Arrange previews renders exactly one new segment and the playhead keeps moving, in both the room and Expanded Room editors; Close is clickable at 1280×800, 1366×768, 1440×900 and 1920×1080. The F231 acceptance re-run passes. Zero page errors.

## Trade-offs and limits

- Live mixing needs each lane's audio separately, so memory grows for arrangements whose every slot in every lane holds a different phrase (≈64 MB of segments at 16 slots, 90 BPM, versus a 14 MB mixdown). Repeated phrases share one segment, and the shared 50 MiB cache still bounds what is retained beyond the playing arrangement.
- Not verified: listening by ear, physical phones, long world-play sessions.
