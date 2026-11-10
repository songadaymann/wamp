; wram.s -- exports every wram.inc equate so the names land in
; build/sneswamp.lbl (tests look WRAM up by name).  No code, no data.
;
; Add `wram` to SRCS in the Makefile when the pipeline demo in main.s is
; replaced by the engine (the demo defines its own frame_counter/joy1/
; oam_shadow, so the two cannot be linked together).

.p816
WRAM_EXPORT = 1
.include "wram.inc"
