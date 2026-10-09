# F221 periodic music tails and hat choke review

Tested local candidate on F224 `42714ad6` / draft #94. Primary and production unchanged; master stays unticked for review/release.

Tonal releases and full drum tails fold directly into fixed-length mono tracks before soft drive, panning and final shaping. Loop duration/retained size stay unchanged, without an extra tail array. Contributions can wrap more than once at fast tempos. The beginning includes the prior repetition's tails; F224's entry fade applies.

Open hats use the next open/closed event in cyclic swung timing as their choke point, with a 10 ms fade. A simultaneous closed hat wins. Other drums retain polyphonic tails. PolyBLEP and generalized monophonic drum rows remain optional separate sound changes.

## Evidence

- Full quality check: 403 files / 3,185 tests, lint, types, bindings and build. DOM 992/242, Worker safety and diff pass.
- Eleven new renderer tests compare all three tonal releases and crash tails with uncut longer references; tails longer than a 200 BPM loop match repeated longer content. Choke, cyclic/simultaneous hats, swing, pan, silence and duration pass.
- Real Web Audio at 48 kHz: triangle, saw, square, crash and cyclic-hat seam windows have **zero maximum sample difference** against the longer uncut reference in both channels. Nonzero stereo buffers retain 192,000 frames at 120 BPM.
- Three complete native cases: real reference/preview proof and two-loop WAV export; tonal edit, exact Undo/Redo, draft save and world handoff; phone portrait preview/Stop clears active and retiring ownership. Native page errors are zero; construction-preview 404s retained.
- Desktop/phone/world and unchanged installed-client screenshots inspected. The installed client has loaded collision state/no error artifact but shows the existing performance-pressure prompt; no benchmark is claimed.
- Published 212/42 is exactly unchanged v1. Published 211/42 remains v1 with unchanged authored notes/mix/room content; the existing legacy canonicalization fills triangle MIDI step 31 from its original row note. That raw-fixture delta is recorded, and publication equals the initial normalized native snapshot. Its draft saves the actual edit. Primary hashes match F224.

Evidence: `/tmp/wamp-music-loop-tails-2026-10-09/`, including real-reference metrics, source fingerprints, DB/primary proof and `native/periodic-preview-two-loops.wav`. The WAV is the actual preview buffer repeated twice, exported as 16-bit PCM. No subjective listening, production incidence/hiss claim or phone performance benchmark is made. Existing phone portrait overlay obstruction remains; no touch-grid proof is claimed. Initial raw-fixture preservation assertion was corrected to include the documented MIDI canonicalization; no published authored change is concealed.

No migration, saved/replay format, catalog, renderer service or PartyKit change. Frontend-only by itself. Inherited coordinated API/Pages, migrations 0060–0062 and matching catalog/renderer requirements remain; the existing release catalog mismatch is unresolved. No release performed.
