; snes.inc -- SNES hardware register names and equates (ca65, 65816)
;
; Names follow the official/nesdev-wiki register mnemonics.

.ifndef SNES_INC
SNES_INC = 1

; ---------------------------------------------------------------------------
; PPU write registers ($2100-$2133)
; ---------------------------------------------------------------------------
INIDISP     = $2100     ; x---bbbb  force blank, brightness
OBSEL       = $2101     ; sssnnbbb  OBJ size, name select, name base (>>13 words)
OAMADDL     = $2102     ; OAM word address low
OAMADDH     = $2103     ; p------b  priority rotation, address high bit
OAMDATA     = $2104     ; OAM data write
BGMODE      = $2105     ; 4321pmmm  BG tile size, BG3 priority, mode
MOSAIC      = $2106     ; ssss4321
BG1SC       = $2107     ; aaaaaayx  tilemap base (>>10 words), mirroring
BG2SC       = $2108
BG3SC       = $2109
BG4SC       = $210A
BG12NBA     = $210B     ; 22221111  chr base (>>12 words)
BG34NBA     = $210C     ; 44443333
BG1HOFS     = $210D     ; write twice
BG1VOFS     = $210E     ; write twice
BG2HOFS     = $210F
BG2VOFS     = $2110
BG3HOFS     = $2111
BG3VOFS     = $2112
BG4HOFS     = $2113
BG4VOFS     = $2114
VMAIN       = $2115     ; i---mmii  increment mode
VMADDL      = $2116     ; VRAM word address
VMADDH      = $2117
VMDATAL     = $2118     ; VRAM data write
VMDATAH     = $2119
M7SEL       = $211A
M7A         = $211B     ; write twice (also multiplicand)
M7B         = $211C     ; write twice (also multiplier)
M7C         = $211D
M7D         = $211E
M7X         = $211F
M7Y         = $2120
CGADD       = $2121     ; CGRAM (palette) index
CGDATA      = $2122     ; write twice: low, high (-bbbbbgg gggrrrrr)
W12SEL      = $2123
W34SEL      = $2124
WOBJSEL     = $2125
WH0         = $2126
WH1         = $2127
WH2         = $2128
WH3         = $2129
WBGLOG      = $212A
WOBJLOG     = $212B
TM          = $212C     ; ---o4321  main screen designation
TS          = $212D     ; ---o4321  sub screen designation
TMW         = $212E
TSW         = $212F
CGWSEL      = $2130
CGADSUB     = $2131
COLDATA     = $2132
SETINI      = $2133

; ---------------------------------------------------------------------------
; PPU read registers ($2134-$213F)
; ---------------------------------------------------------------------------
MPYL        = $2134     ; signed multiply result (M7A * M7B>>8)
MPYM        = $2135
MPYH        = $2136
SLHV        = $2137     ; latch H/V counter
OAMDATAREAD = $2138
VMDATALREAD = $2139
VMDATAHREAD = $213A
CGDATAREAD  = $213B
OPHCT       = $213C
OPVCT       = $213D
STAT77      = $213E
STAT78      = $213F

; ---------------------------------------------------------------------------
; APU I/O ports
; ---------------------------------------------------------------------------
APUIO0      = $2140
APUIO1      = $2141
APUIO2      = $2142
APUIO3      = $2143

; ---------------------------------------------------------------------------
; WRAM access port
; ---------------------------------------------------------------------------
WMDATA      = $2180
WMADDL      = $2181
WMADDM      = $2182
WMADDH      = $2183

; ---------------------------------------------------------------------------
; Old-style joypad ports
; ---------------------------------------------------------------------------
JOYOUT      = $4016     ; write: latch
JOYSER0     = $4016     ; read: port 1 serial data
JOYSER1     = $4017     ; read: port 2 serial data

; ---------------------------------------------------------------------------
; CPU write registers ($4200-$420D)
; ---------------------------------------------------------------------------
NMITIMEN    = $4200     ; n-vh---j  NMI enable, V/H IRQ, auto-joypad
WRIO        = $4201
WRMPYA      = $4202
WRMPYB      = $4203
WRDIVL      = $4204
WRDIVH      = $4205
WRDIVB      = $4206
HTIMEL      = $4207
HTIMEH      = $4208
VTIMEL      = $4209
VTIMEH      = $420A
MDMAEN      = $420B     ; general-purpose DMA enable (one bit per channel)
HDMAEN      = $420C     ; HDMA enable
MEMSEL      = $420D     ; bit0: FastROM

; ---------------------------------------------------------------------------
; CPU read registers ($4210-$421F)
; ---------------------------------------------------------------------------
RDNMI       = $4210     ; n---vvvv  NMI flag (read to acknowledge), CPU version
TIMEUP      = $4211     ; i-------  IRQ flag (read to acknowledge)
HVBJOY      = $4212     ; vh-----a  vblank, hblank, auto-joypad busy
RDIO        = $4213
RDDIVL      = $4214
RDDIVH      = $4215
RDMPYL      = $4216
RDMPYH      = $4217
JOY1L       = $4218     ; auto-read joypad 1: AXLR----
JOY1H       = $4219     ;                     BYsSUDLR (select, Start)
JOY2L       = $421A
JOY2H       = $421B
JOY3L       = $421C
JOY3H       = $421D
JOY4L       = $421E
JOY4H       = $421F

; ---------------------------------------------------------------------------
; DMA / HDMA channel registers ($43x0-$43xA), x = channel 0-7
; ---------------------------------------------------------------------------
DMAP0       = $4300     ; da-ifttt  direction, HDMA indirect, fixed/dec, mode
BBAD0       = $4301     ; B-bus address ($21xx)
A1T0L       = $4302     ; A-bus address
A1T0H       = $4303
A1B0        = $4304     ; A-bus bank
DAS0L       = $4305     ; byte count (0 = 65536) / HDMA indirect address
DAS0H       = $4306
DASB0       = $4307     ; HDMA indirect bank
A2A0L       = $4308     ; HDMA table address
A2A0H       = $4309
NTRL0       = $430A     ; HDMA line counter

.define DMAP(ch)   $4300+((ch)<<4)
.define BBAD(ch)   $4301+((ch)<<4)
.define A1TL(ch)   $4302+((ch)<<4)
.define A1TH(ch)   $4303+((ch)<<4)
.define A1B(ch)    $4304+((ch)<<4)
.define DASL(ch)   $4305+((ch)<<4)
.define DASH(ch)   $4306+((ch)<<4)
.define DASB(ch)   $4307+((ch)<<4)
.define A2AL(ch)   $4308+((ch)<<4)
.define A2AH(ch)   $4309+((ch)<<4)
.define NTRL(ch)   $430A+((ch)<<4)

; ---------------------------------------------------------------------------
; Bit equates
; ---------------------------------------------------------------------------
INIDISP_BLANK   = $80
NMITIMEN_NMI    = $80
NMITIMEN_VIRQ   = $20
NMITIMEN_HIRQ   = $10
NMITIMEN_JOY    = $01
HVBJOY_VBLANK   = $80
HVBJOY_HBLANK   = $40
HVBJOY_JOYBUSY  = $01

TM_BG1  = $01
TM_BG2  = $02
TM_BG3  = $04
TM_BG4  = $08
TM_OBJ  = $10

VMAIN_INC_HIGH  = $80   ; increment VRAM address after writing $2119
VMAIN_INC_32    = $01   ; increment by 32 words (column writes)

; DMAP transfer modes (A-bus -> B-bus)
DMA_1REG        = $00   ; p               (e.g. OAMDATA, CGDATA, WMDATA)
DMA_2REG        = $01   ; p, p+1          (e.g. VMDATAL/H)
DMA_1REG_2X     = $02   ; p, p
DMA_FIXED       = $08   ; don't advance the A-bus address (fill)

; Joypad buttons as a 16-bit word read from JOYxL/JOYxH
JOY_B       = $8000
JOY_Y       = $4000
JOY_SELECT  = $2000
JOY_START   = $1000
JOY_UP      = $0800
JOY_DOWN    = $0400
JOY_LEFT    = $0200
JOY_RIGHT   = $0100
JOY_A       = $0080
JOY_X       = $0040
JOY_L       = $0020
JOY_R       = $0010

; Tilemap entry high-byte bits: vhopppcc
TILE_VFLIP  = $80
TILE_HFLIP  = $40
TILE_PRIO   = $20

; OAM attribute byte: vhoopppc
OBJ_VFLIP   = $80
OBJ_HFLIP   = $40
OBJ_PRIO0   = $00
OBJ_PRIO1   = $10
OBJ_PRIO2   = $20
OBJ_PRIO3   = $30

; ---------------------------------------------------------------------------
; Helpers
; ---------------------------------------------------------------------------
; RGB(r,g,b) with 5-bit components -> 15-bit SNES colour word
.define RGB(r,g,b) (((b)<<10)|((g)<<5)|(r))

; Register-width helpers: always change the CPU flags AND tell the assembler.
.macro A8
        sep #$20
        .a8
.endmacro
.macro A16
        rep #$20
        .a16
.endmacro
.macro I8
        sep #$10
        .i8
.endmacro
.macro I16
        rep #$10
        .i16
.endmacro
.macro AI8
        sep #$30
        .a8
        .i8
.endmacro
.macro AI16
        rep #$30
        .a16
        .i16
.endmacro

.endif
