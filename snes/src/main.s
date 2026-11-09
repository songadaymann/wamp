; main.s -- SNESWAMP harness demo.
;
; Proves the build + headless-test pipeline:
;   * Mode 1, BG1 = 4bpp checkerboard of two tiles (gfx DMA'd from bank 1)
;   * BG3 = 2bpp 8x8 ASCII font, prints "SNESWAMP HARNESS OK"
;   * one 16x16 sprite moved with the D-pad
;   * NMI: OAM DMA, auto-joypad read, frame counter
;
; WRAM variables the tests look up by name in build/sneswamp.lbl:
;   frame_counter (word)  +1 every NMI
;   joy1, joy1_pressed (word)
;   sprite_x, sprite_y (word)
;
; Register-width convention: every routine documents the widths it expects;
; widths are only ever changed through the A8/A16/I8/I16 macros so the
; assembler's idea always matches the CPU.

.p816
.include "snes.inc"

.export Main, NMI
.exportzp frame_counter, joy1, joy1_prev, joy1_pressed, sprite_x, sprite_y
.export oam_shadow

; VRAM layout (word addresses)
VRAM_BG1_MAP  = $0000
VRAM_BG3_MAP  = $0400
VRAM_BG1_CHR  = $1000
VRAM_BG3_CHR  = $2000
VRAM_OBJ_CHR  = $4000

SPRITE_X_MAX  = 256 - 16
SPRITE_Y_MAX  = 224 - 16

; ---------------------------------------------------------------------------
.segment "ZEROPAGE"
frame_counter:  .res 2          ; $0000
joy1:           .res 2          ; held buttons (JOY_* bits)
joy1_prev:      .res 2
joy1_pressed:   .res 2          ; newly pressed this frame
sprite_x:       .res 2
sprite_y:       .res 2
tmp:            .res 2

.segment "BSS"
oam_shadow:     .res 544        ; 128 * 4 + 32, copied to OAM every NMI

; ---------------------------------------------------------------------------
; Graphics live in a data bank to exercise far DMA sources.
.segment "BANK1"
BgTiles:        .incbin "bgtiles.bin"
BgTilesEnd:
Font:           .incbin "font.bin"
FontEnd:
SpriteGfx:      .incbin "sprite.bin"
SpriteGfxEnd:

Bg3Palette:     ; CGRAM 0-3 (BG3 palette 0; colour 0 is also the backdrop)
        .word RGB(2,2,6), RGB(31,31,31), RGB(16,16,16), RGB(0,0,0)
Bg3PaletteEnd:
Bg1Palette:     ; CGRAM 32-47 (BG1 palette 2)
        .word RGB(0,0,0),   RGB(2,4,12),  RGB(5,10,20), RGB(10,18,28)
        .word RGB(8,3,2),   RGB(17,6,4),  RGB(11,11,11), RGB(0,0,0)
        .res 16, $00
Bg1PaletteEnd:
ObjPalette:     ; CGRAM 128-143 (OBJ palette 0)
        .word RGB(0,0,0),   RGB(1,1,1),   RGB(31,27,3), RGB(31,31,31)
        .res 24, $00
ObjPaletteEnd:

.segment "RODATA"
MsgTitle:       .asciiz "SNESWAMP HARNESS OK"
MsgHelp:        .asciiz "D-PAD MOVES THE SPRITE"

; ---------------------------------------------------------------------------
; DMA helpers.  Require A8/I16, DB=$00.  Clobber A, X.  Only use them with
; NMI disabled (the NMI handler uses DMA channel 0 too).

.macro DMA_TO_VRAM vaddr, src, len
        ldx #(vaddr)
        stx VMADDL
        lda #DMA_2REG
        sta DMAP0
        lda #<VMDATAL
        sta BBAD0
        ldx #.loword(src)
        stx A1T0L
        lda #^src
        sta A1B0
        ldx #(len)
        stx DAS0L
        lda #$01
        sta MDMAEN
.endmacro

.macro DMA_TO_CGRAM index, src, len
        lda #(index)
        sta CGADD
        lda #DMA_1REG
        sta DMAP0
        lda #<CGDATA
        sta BBAD0
        ldx #.loword(src)
        stx A1T0L
        lda #^src
        sta A1B0
        ldx #(len)
        stx DAS0L
        lda #$01
        sta MDMAEN
.endmacro

; ---------------------------------------------------------------------------
.segment "CODE"

; Entered from Reset: A8, I16, D=0, DB=0, force blank on, NMI off.
.proc Main
        AI16
        A8
        lda #INIDISP_BLANK | $0F        ; (still) force blank during setup
        sta INIDISP

        ; --- graphics + palettes -------------------------------------------
        lda #VMAIN_INC_HIGH
        sta VMAIN
        DMA_TO_VRAM VRAM_BG1_CHR, BgTiles,   BgTilesEnd - BgTiles
        DMA_TO_VRAM VRAM_BG3_CHR, Font,      FontEnd - Font
        DMA_TO_VRAM VRAM_OBJ_CHR, SpriteGfx, SpriteGfxEnd - SpriteGfx
        DMA_TO_CGRAM 0,   Bg3Palette, Bg3PaletteEnd - Bg3Palette
        DMA_TO_CGRAM 32,  Bg1Palette, Bg1PaletteEnd - Bg1Palette
        DMA_TO_CGRAM 128, ObjPalette, ObjPaletteEnd - ObjPalette

        ; --- BG1 tilemap: 2x2-tile checkerboard of tiles 1 and 2, palette 2 -
        ldx #VRAM_BG1_MAP
        stx VMADDL
        A16
        ldx #$0000              ; X = cell index = row*32 + col
@cell:  txa
        lsr a                   ; bit 0 = (col >> 1) & 1
        sta tmp
        txa
        lsr a
        lsr a
        lsr a
        lsr a
        lsr a
        lsr a                   ; bit 0 = (row >> 1) & 1
        eor tmp
        and #$0001
        clc
        adc #$0801              ; tile 1 or 2, palette 2 (2 << 10)
        sta VMDATAL             ; 16-bit write: $2118 then $2119
        inx
        cpx #32 * 32
        bne @cell
        A8

        ; --- BG3 text ------------------------------------------------------
        ldx #VRAM_BG3_MAP + 3 * 32 + 6
        ldy #.loword(MsgTitle)
        jsr PutStr
        ldx #VRAM_BG3_MAP + 24 * 32 + 5
        ldy #.loword(MsgHelp)
        jsr PutStr

        ; --- PPU configuration ---------------------------------------------
        lda #$09                ; mode 1, BG3 priority
        sta BGMODE
        lda #(VRAM_BG1_MAP >> 10) << 2  ; 32x32
        sta BG1SC
        lda #(VRAM_BG3_MAP >> 10) << 2
        sta BG3SC
        lda #VRAM_BG1_CHR >> 12         ; BG2 nibble unused
        sta BG12NBA
        lda #VRAM_BG3_CHR >> 12         ; BG4 nibble unused
        sta BG34NBA
        lda #VRAM_OBJ_CHR >> 13         ; 8x8 / 16x16 sprites
        sta OBSEL
        lda #$FF                ; V scroll = -1: first visible scanline is 1,
                                ; so this puts BG row 0 on screen row 0
        sta BG1VOFS
        sta BG1VOFS
        sta BG3VOFS
        sta BG3VOFS
        lda #TM_BG1 | TM_BG3 | TM_OBJ
        sta TM

        ; --- game state + OAM shadow ---------------------------------------
        A16
        lda #120
        sta sprite_x
        lda #104
        sta sprite_y
        A8
        ldx #$0000
        lda #240                ; park every sprite below the screen
@park:  sta oam_shadow + 1,x
        inx
        inx
        inx
        inx
        cpx #128 * 4
        bne @park
        jsr DrawSprite

        ; --- go ------------------------------------------------------------
        lda RDNMI               ; clear any pending NMI flag
        lda #NMITIMEN_NMI | NMITIMEN_JOY
        sta NMITIMEN
        jsr WaitFrame           ; first NMI uploads OAM
        lda #$0F                ; screen on, full brightness
        sta INIDISP

@loop:  jsr WaitFrame
        jsr UpdateSprite
        jsr DrawSprite
        bra @loop
.endproc

; Wait for the next NMI.  A8.  Clobbers A.
.proc WaitFrame
        .a8
        lda frame_counter
:       wai
        cmp frame_counter
        beq :-
        rts
.endproc

; Write a NUL-terminated ASCII string to the BG3 tilemap.
; In: X = VRAM word address, Y = string address (bank 0).  A8, I16.
; Only call during force blank or vblank.  Clobbers A, Y.
.proc PutStr
        .a8
        .i16
        stx VMADDL
@next:  lda a:$0000,y
        beq @done
        sec
        sbc #$20                ; font tile 0 = ' '
        sta VMDATAL
        lda #TILE_PRIO          ; palette 0, high priority
        sta VMDATAH
        iny
        bra @next
@done:  rts
.endproc

; Move the sprite 1 px/frame per held direction, clamped to the screen.
; A8/I16 in and out.
.proc UpdateSprite
        A16
        lda joy1
        bit #JOY_RIGHT
        beq :+
        lda sprite_x
        cmp #SPRITE_X_MAX
        bcs :+
        inc sprite_x
:       lda joy1
        bit #JOY_LEFT
        beq :+
        lda sprite_x
        beq :+
        dec sprite_x
:       lda joy1
        bit #JOY_DOWN
        beq :+
        lda sprite_y
        cmp #SPRITE_Y_MAX
        bcs :+
        inc sprite_y
:       lda joy1
        bit #JOY_UP
        beq :+
        lda sprite_y
        beq :+
        dec sprite_y
:       A8
        rts
.endproc

; Put the player sprite in OAM slot 0 of the shadow table.  A8 in and out.
.proc DrawSprite
        .a8
        lda sprite_x
        sta oam_shadow + 0
        lda sprite_y            ; OAM Y=n -> scanline n+1 = visible row n,
        sta oam_shadow + 1      ; so no adjustment (unlike the BG V scroll)
        stz oam_shadow + 2      ; tile 0
        lda #OBJ_PRIO3          ; palette 0, in front of BG1
        sta oam_shadow + 3
        lda #$02                ; hi table: sprite 0 large (16x16), X bit 8 = 0
        sta oam_shadow + 512
        rts
.endproc

; ---------------------------------------------------------------------------
; NMI (vblank): OAM DMA, joypad, frame counter.  Preserves everything.
.proc NMI
        rep #$30
        .a16
        .i16
        pha
        phx
        phy
        phb
        phd
        phk
        plb                     ; DB = $00
        lda #$0000
        tcd                     ; D = $0000
        A8
        lda RDNMI               ; acknowledge

        ; --- OAM shadow -> OAM ---------------------------------------------
        stz OAMADDL
        stz OAMADDH
        lda #DMA_1REG
        sta DMAP0
        lda #<OAMDATA
        sta BBAD0
        ldx #.loword(oam_shadow)
        stx A1T0L
        lda #^oam_shadow
        sta A1B0
        ldx #544
        stx DAS0L
        lda #$01
        sta MDMAEN

        ; --- joypad --------------------------------------------------------
        ; Auto-read starts shortly after vblank begins and takes ~3 lines.
        ; The OAM DMA above (~3.3 lines) guarantees it has started; now wait
        ; for it to finish before touching JOY1L/H.
:       lda HVBJOY
        and #HVBJOY_JOYBUSY
        bne :-
        A16
        lda joy1
        sta joy1_prev
        lda JOY1L
        sta joy1
        eor joy1_prev
        and joy1
        sta joy1_pressed

        inc frame_counter

        pld
        plb
        ply
        plx
        pla
        rti
.endproc
