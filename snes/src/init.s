; init.s -- canonical SNES reset: native mode, stack, registers, clear all RAM.
;
; Reset is entered from the emulation-mode RESET vector.  It never uses the
; stack for return addresses (the WRAM clear wipes it), and ends with
; `jmp Main` with:  A 8-bit, X/Y 16-bit, D=$0000, DB=$00, S=$1FFF,
; screen force-blanked, NMI/IRQ/auto-joypad off, WRAM/VRAM/CGRAM zeroed,
; all 128 OAM entries parked off-screen.

.p816
.include "snes.inc"

.export Reset, IRQ, Unused
.import Main

STACK_TOP = $1FFF

.segment "RODATA"
ZeroByte:
        .byte $00

.segment "CODE"

; Unhandled interrupts.
IRQ:
Unused:
        rti

.proc Reset
        sei                     ; no IRQs
        clc
        xce                     ; native mode
        rep #$38                ; A16, XY16, decimal off
        .a16
        .i16
        ldx #STACK_TOP
        txs
        lda #$0000
        tcd                     ; direct page = $0000
        A8
        phk
        plb                     ; data bank = $00

        ; --- display off, interrupts off -----------------------------------
        lda #INIDISP_BLANK | $0F
        sta INIDISP
        stz NMITIMEN
        stz HDMAEN
        stz MDMAEN

        ; --- PPU registers -------------------------------------------------
        ldx #$0001              ; $2101-$210C: OBSEL..BG34NBA
:       stz $2100,x
        inx
        cpx #$000D
        bne :-
:       stz $2100,x             ; $210D-$2114: scroll registers, write twice
        stz $2100,x
        inx
        cpx #$0015
        bne :-
        lda #VMAIN_INC_HIGH
        sta VMAIN
        stz VMADDL
        stz VMADDH
        stz M7SEL
        lda #$01                ; mode 7 matrix = identity
        stz M7A
        sta M7A
        stz M7B
        stz M7B
        stz M7C
        stz M7C
        stz M7D
        sta M7D
        stz M7X
        stz M7X
        stz M7Y
        stz M7Y
        stz CGADD
        ldx #$0023              ; $2123-$212F: windows, TM/TS
:       stz $2100,x
        inx
        cpx #$0030
        bne :-
        lda #$30
        sta CGWSEL
        stz CGADSUB
        lda #$E0
        sta COLDATA
        stz SETINI

        ; --- CPU registers -------------------------------------------------
        lda #$FF
        sta WRIO
        ldx #$0002              ; $4202-$420D
:       stz $4200,x
        inx
        cpx #$000E
        bne :-

        ; --- clear WRAM ($7E0000-$7FFFFF) via fixed-source DMA to WMDATA ---
        stz WMADDL
        stz WMADDM
        stz WMADDH
        lda #DMA_FIXED | DMA_1REG
        sta DMAP0
        lda #<WMDATA
        sta BBAD0
        ldx #.loword(ZeroByte)
        stx A1T0L
        lda #^ZeroByte
        sta A1B0
        stz DAS0L               ; count 0 = 65536 bytes
        stz DAS0H
        lda #$01
        sta MDMAEN              ; $7E0000-$7EFFFF
        sta MDMAEN              ; count is 0 again -> $7F0000-$7FFFFF

        ; --- clear VRAM (64 KiB) -------------------------------------------
        lda #VMAIN_INC_HIGH
        sta VMAIN
        stz VMADDL
        stz VMADDH
        lda #DMA_FIXED | DMA_2REG
        sta DMAP0
        lda #<VMDATAL
        sta BBAD0
        ldx #.loword(ZeroByte)
        stx A1T0L
        stz DAS0L               ; 65536 bytes
        stz DAS0H
        lda #$01
        sta MDMAEN

        ; --- clear CGRAM (512 bytes) ---------------------------------------
        stz CGADD
        lda #DMA_FIXED | DMA_1REG
        sta DMAP0
        lda #<CGDATA
        sta BBAD0
        ldx #.loword(ZeroByte)
        stx A1T0L
        ldx #$0200
        stx DAS0L
        lda #$01
        sta MDMAEN

        ; --- OAM: park all 128 sprites off-screen (Y=240), clear hi table --
        stz OAMADDL
        stz OAMADDH
        ldx #128
:       stz OAMDATA             ; X
        lda #240
        sta OAMDATA             ; Y
        stz OAMDATA             ; tile
        stz OAMDATA             ; attributes
        dex
        bne :-
        ldx #32
:       stz OAMDATA             ; X bit 8 = 0, size = small
        dex
        bne :-

        jmp Main
.endproc
