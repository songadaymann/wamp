; header.s -- SNES internal ROM header ($00:FFC0) and CPU vectors ($00:FFE0)

.p816
.import Reset, NMI, IRQ, Unused

.segment "HEADER"               ; $00:FFC0
        ;      123456789012345678901
        .byte "SNESWAMP             "   ; $FFC0 title, 21 bytes, space padded
        .assert * = $FFD5, error, "title must be exactly 21 bytes"
        .byte $20               ; $FFD5 map mode: LoROM, SlowROM
        .byte $00               ; $FFD6 cartridge type: ROM only
        .byte $0A               ; $FFD7 ROM size: 2^10 KiB = 1 MiB
        .byte $00               ; $FFD8 RAM size: none
        .byte $01               ; $FFD9 destination: North America (NTSC)
        .byte $00               ; $FFDA developer id
        .byte $00               ; $FFDB version
        .word $FFFF             ; $FFDC checksum complement (tools/fixsum.py)
        .word $0000             ; $FFDE checksum            (tools/fixsum.py)

.segment "VECTORS"              ; $00:FFE0
        ; native mode
        .word $FFFF             ; $FFE0 (unused)
        .word $FFFF             ; $FFE2 (unused)
        .addr Unused            ; $FFE4 COP
        .addr Unused            ; $FFE6 BRK
        .addr Unused            ; $FFE8 ABORT
        .addr NMI               ; $FFEA NMI
        .word $FFFF             ; $FFEC (unused)
        .addr IRQ               ; $FFEE IRQ
        ; emulation mode
        .word $FFFF             ; $FFF0 (unused)
        .word $FFFF             ; $FFF2 (unused)
        .addr Unused            ; $FFF4 COP
        .word $FFFF             ; $FFF6 (unused)
        .addr Unused            ; $FFF8 ABORT
        .addr Unused            ; $FFFA NMI
        .addr Reset             ; $FFFC RESET
        .addr Unused            ; $FFFE IRQ/BRK
