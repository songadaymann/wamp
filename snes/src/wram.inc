; wram.inc -- SNESWAMP shared WRAM map (binding; see docs/ARCHITECTURE.md 1.2)
;
; Every shared variable is a FIXED-ADDRESS EQUATE.  Including this file emits
; no bytes and reserves nothing with the linker, so:
;   * never .res shared state in ZEROPAGE/BSS/BSS7E -- those segments are the
;     small module-private pools ($00-$1F, $0200-$08FF, $7E2000-$7E3FFF);
;   * a variable is added HERE (with its owner) or it is module-private.
; src/wram.s defines WRAM_EXPORT and includes this file, which exports every
; name so it appears in build/sneswamp.lbl for the tests (emu.peek16("pl_x")).
;
; Addressing: names below $0100 assemble as direct page (D is always $0000),
; names below $2000 as absolute (DB is always $00), names at $7Exxxx as long.
; Multi-byte values are little endian.  "(w)" = 16-bit, "(3)" = 24-bit.
;
; The W_AT / W macros keep a running address; the .assert lines pin the layout.

.ifndef WRAM_INC
WRAM_INC = 1

.macro W_AT addr
        _wram_pc .set addr
.endmacro

.macro W name, size
        name = _wram_pc
        .ifdef WRAM_EXPORT
                .export name
        .endif
        _wram_pc .set _wram_pc + (size)
.endmacro

; ===========================================================================
; DIRECT PAGE  $20-$FF   ($00-$1F is the linker's module-private ZEROPAGE pool)
; ===========================================================================
        W_AT $0020

; --- scratch (owner: whoever is running; MAIN THREAD ONLY) ------------------
; Not preserved across any JSR to an exported routine unless that routine's
; contract says so.  The NMI handler never touches $20-$2F.
        W tmp0, 2               ; $20
        W tmp1, 2               ; $22
        W tmp2, 2               ; $24
        W tmp3, 2               ; $26
        W tmp4, 2               ; $28
        W tmp5, 2               ; $2A
        W ptr0, 3               ; $2C  24-bit pointer for [ptr0],y  (room blob, tables)
        W tmp6, 1               ; $2F

; --- NMI-only scratch (owner: nmi.s) ----------------------------------------
        W nmi_tmp, 4            ; $30

; --- frame / input (owner: nmi.s writes frame_counter + joy1_raw; input.s the rest)
        W frame_counter, 2      ; $34  +1 every NMI, never reset
        W nmi_ready, 1          ; $36  main sets 1 when all shadows are final; NMI uploads and clears
        W lag_frames, 1         ; $37  NMIs that found nmi_ready = 0 during GS_PLAY (perf tests)
        W joy1_raw, 2           ; $38  pad as latched by the last NMI
        W joy1, 2               ; $3A  held, sampled once per main-loop frame (JOY_* bits)
        W joy1_prev, 2          ; $3C
        W joy1_pressed, 2       ; $3E  LATCHED edges: |= joy1 & ~joy1_prev; main.s clears it at the end
                                ;      of every frame except a hitstop frame (see input_keep, 4.2)

; --- game state (owner: main.s) ---------------------------------------------
        W game_state, 1         ; $40  GS_*
        W input_keep, 1         ; $41  set by GS_PLAY on a hitstop frame: joy1_pressed is not cleared
        W state_timer, 2        ; $42  state-private countdown
        W game_frame, 2         ; $44  +1 per simulated GS_PLAY step (not during hitstop/pause)
        W hitstop, 1            ; $46  >0: GS_PLAY skips simulation, still draws
        W main_reserved, 2      ; $47  reserved (0)

; --- PPU shadows (owner: ppu.s; written to hardware by nmi.s) ---------------
        W ppu_inidisp, 1        ; $49  brightness / force blank
        W cam_x, 2              ; $4A  0..384  (owner: camera.s)  -> BG1/BG2 HOFS
        W cam_y, 2              ; $4C  0..128                      -> BG1/BG2 VOFS = cam_y - 1
        W oam_ptr, 2            ; $4E  next free byte offset in oam_shadow, 0..512 step 4 (owner: oam.s)

; --- mover block (owner: collision.s; in/out for Coll_MoveX / Coll_MoveY) ---
        W mv_xsub, 1            ; $50  x position 16.8: sub-pixel byte ...
        W mv_x, 2               ; $51  ... + signed pixel word (centre x)
        W mv_ysub, 1            ; $53
        W mv_y, 2               ; $54  bottom edge y (feet)
        W mv_vx, 2              ; $56  signed 8.8 px/frame
        W mv_vy, 2              ; $58
        W mv_hw, 1              ; $5A  half width: body = [x-hw, x+hw)
        W mv_h, 1               ; $5B  height:     body = [y-h, y)
        W mv_opts, 1            ; $5C  MVO_*
        W mv_blocked, 1         ; $5D  BLK_*, OR-ed in by the move routines (caller clears)
        W mv_prev_y, 2          ; $5E  y before Coll_MoveY (one-way rule)

        .assert _wram_pc = $60, error, "wram.inc: direct page layout moved"

; --- player block (owner: player.s) -----------------------------------------
        W pl_xsub, 1            ; $60  position 16.8; pl_x is the body CENTRE x in room px
        W pl_x, 2               ; $61
        W pl_ysub, 1            ; $63  pl_y is the FEET y (bottom edge of the body) in room px
        W pl_y, 2               ; $64
        W pl_vx, 2              ; $66  signed 8.8 px/frame
        W pl_vy, 2              ; $68
        W pl_h, 1               ; $6A  current body height: PL_H_STAND or PL_H_SMALL
        W pl_facing, 1          ; $6B  DIR_RIGHT / DIR_LEFT
        W pl_state, 1           ; $6C  PF_*
        W pl_blocked, 1         ; $6D  BLK_* from this frame's Player_Integrate
        W pl_contact, 1         ; $6E  CT_* under the feet this frame
        W pl_prev_vy, 2         ; $6F  vy at the end of the previous Player_Control (corner correction)
        W pl_coyote, 1          ; $71  timers, frames (see ARCHITECTURE.md 5.6)
        W pl_jumpbuf, 1         ; $72
        W pl_wjbuf, 1           ; $73  wall-jump buffer
        W pl_protect, 1         ; $74  protected minimum rise
        W pl_wall_side, 1       ; $75  raw wall contact this frame: DIR_LEFT/DIR_RIGHT/DIR_NONE
        W pl_wall_grace, 1      ; $76  contact grace timer
        W pl_wall_grace_side, 1 ; $77
        W pl_wj_lock, 1         ; $78  wall-jump input lock timer
        W pl_wj_dir, 1          ; $79  DIR_* of the active wall jump
        W pl_stomp_flip, 1      ; $7A  butt-stomp hover timer
        W pl_land_timer, 1      ; $7B  PA_LAND display timer (Player_Animate)
        W pl_kb_timer, 1        ; $7C  knockback (hurt or weapon): vx forced to pl_kb_vx
        W pl_kb_vx, 2           ; $7D
        W pl_invuln, 1          ; $7F  hurt invulnerability timer
        W pl_drop, 1            ; $80  one-way drop-through timer
        W pl_bounce_grace, 1    ; $81  bounce launch grace (suppresses release cut; tile cooldown)
        W pl_sword_cd, 1        ; $82  cooldown until the next slash
        W pl_sword_active, 1    ; $83  hit window timer
        W pl_sword_anim, 1      ; $84  animation lock timer
        W pl_sword_flags, 1     ; $85  bit 0 downward, bit 1 already connected, bit 2 latched facing
                                ;      left, bits 4-7 enemies hit this swing
        W pl_ladder, 1          ; $86  object slot offset >> 5 of the overlapped ladder, $FF = none
        W pl_hearts, 1          ; $87
        W pl_hearts_max, 1      ; $88
        W pl_dead, 1            ; $89  non-zero while death is pending (GS_DYING)
        W pl_anim, 1            ; $8A  PA_*
        W pl_anim_pos, 1        ; $8B  position in the animation's frame list
        W pl_anim_timer, 1      ; $8C
        W pl_frame, 1           ; $8D  frame index wanted this frame (PlayerFrameTable)
        W pl_frame_loaded, 1    ; $8E  frame index whose chr is in VRAM ($FF = none)
        W pl_visible, 1         ; $8F  0 = do not draw (death beat, invulnerability blink)
        W pl_respawn_x, 2       ; $90  respawn feet point (spawn or last checkpoint)
        W pl_respawn_y, 2       ; $92
        W pl_was_grounded, 1    ; $94  PF_GROUNDED as seen by the previous Player_Animate (landing edge)
        W pl_reserved, 11       ; $95  future player state

        .assert _wram_pc = $A0, error, "wram.inc: player block layout moved"

; --- player chr upload request (owner: player.s fills, nmi.s consumes) ------
        W plchr_req, 1          ; $A0  1 = upload pending (NMI clears, sets pl_frame_loaded)
        W plchr_bank, 1         ; $A1
        W plchr_addr, 2         ; $A2  frame chr: A top, A bottom, B top, B bottom (contiguous)
        W plchr_len, 2          ; $A4  bytes per strip of group A = min(cells, 8) * 64 (-> chars 0, 16)
        W plchr_len2, 2         ; $A6  bytes per strip of group B = (cells - 8) * 64 or 0 (-> chars 32, 48)

; --- $A8-$FF free (reserved for the contract; ask before using) -------------
        .assert _wram_pc <= $100, error, "wram.inc: direct page overflow"

; ===========================================================================
; LOW RAM  $0900-$1EFF   ($0200-$08FF is the linker's module-private BSS pool)
; ===========================================================================
        W_AT $0900

; --- OAM shadow (owner: oam.s; DMA'd by nmi.s) ------------------------------
        W oam_shadow, 512       ; $0900  128 x (x, y, tile, attr)
        W oam_shadow_hi, 32     ; $0B00  2 bits per sprite: bit0 = x bit 8, bit1 = large (32x32);
                                ;        zeroed by Oam_Begin, OR-ed by Oam_Add

        .assert _wram_pc = $0B20, error, "wram.inc: low RAM layout moved"

; --- room state (owner: room.s) ---------------------------------------------
        W room_index, 1         ; $0B20  world index entry of the loaded room
        W room_next, 1          ; $0B21  entry to load in GS_ROOM_LOAD
        W room_entry, 1         ; $0B22  RE_*
        W room_flags, 1         ; $0B23  RF_* from the blob
        W room_x, 1             ; $0B24  signed grid coords
        W room_y, 1             ; $0B25
        W room_nbr, 4           ; $0B26  world index of the L, R, U, D neighbour or NBR_NONE
        W room_ptr, 3           ; $0B2A  24-bit address of the blob
        W room_tile_count, 1    ; $0B2D
        W room_obj_count, 1     ; $0B2E
        W room_hearts, 1        ; $0B2F
        W room_backdrop, 2      ; $0B30  BGR555
        W room_spawn_x, 2       ; $0B32  feet point
        W room_spawn_y, 2       ; $0B34
        W room_title, 24        ; $0B36  copy of the blob title
        W room_load_count, 2    ; $0B4E  +1 per completed Room_Load (tests wait on this)

; --- goal + session stats (owner: goal.s) -----------------------------------
        W goal_type, 1          ; $0B50  GOAL_*
        W goal_param, 1         ; $0B51
        W goal_result, 1        ; $0B52  GR_*
        W goal_progress, 1      ; $0B53  collected / defeated / checkpoints reached
        W goal_target, 1        ; $0B54  required count for the HUD "n/m"
        W goal_cp_next, 1       ; $0B55  next sprint checkpoint order index
        W goal_ticks, 2         ; $0B56  frames elapsed while GR_ACTIVE (saturates at $FFFF)
        W goal_limit, 2         ; $0B58  time limit in frames, 0 = none
        W score, 2              ; $0B5A  binary, saturates at 65535 (carried across rooms)
        W keys, 1               ; $0B5C  held key count (carried across rooms)
        W deaths, 1             ; $0B5D
        W enemies_left, 1       ; $0B5E  live enemy objects in the room         (owner: objects.s)
        W collect_left, 1       ; $0B5F  uncollected collectibles in the room   (owner: objects.s)

; --- HUD state (owner: hud.s) -----------------------------------------------
        W hud_dirty, 1          ; $0B60  HUD_DIRTY_*: hud_buf / hud_msg_buf / hud_intro_buf need upload (NMI clears)
        W hud_redraw, 1         ; $0B61  HUD_RD_* fields to re-render into hud_buf
        W hud_msg_id, 1         ; $0B62  MSG_*
        W hud_msg_timer, 1      ; $0B63
        W hud_last_tenths, 2    ; $0B64  last rendered timer value

; --- debug hooks (owner: main.s; see ARCHITECTURE.md 7.2) -------------------
        W dbg_warp_room, 1      ; $0B66  poke N+1: load world room N with RE_SPAWN, then self-clears
        W dbg_flags, 1          ; $0B67  DBG_*
        W dbg_last_death, 1     ; $0B68  MSG_* reason of the last death/hurt
        W dbg_checksum, 2       ; $0B69  16-bit sum of coll_map after Room_Load

; --- tile effects (owner: room.s) -------------------------------------------
        W crumble_count, 1      ; $0B6B  active entries in crumble_tab
        W crumble_tab, 24 * 4   ; $0B6C  CRUMBLE_MAX entries: cell index (w), timer, phase (1 shake, 2 gone; 0 = free)
        W needkey_timer, 1      ; $0BCC  MSG_NEED_KEY throttle                    (owner: objects.s)
        W room_keys_taken, 1    ; $0BCD  keys picked up in this room and not yet spent here (owner: goal.s)

        .assert _wram_pc <= $0C00, error, "wram.inc: state block overflow"

; --- upload buffers ---------------------------------------------------------
        W_AT $0C00
        W hud_buf, 128          ; $0C00  2 rows x 32 tilemap words (owner: hud.s)
        W hud_msg_buf, 64       ; $0C80  1 row
        W vq_count, 1           ; $0CC0  VRAM write queue (owner: ppu.s): entries used
        W vq_pad, 3
        W vq_data, 15 * 4       ; $0CC4  entries: VRAM word address (w), data (w)

        .assert _wram_pc = $0D00, error, "wram.inc: upload buffers moved"

; --- object table (owner: objects.s) ----------------------------------------
        W obj_table, 64 * 32    ; $0D00  MAX_OBJECTS slots of OBJ_SIZE bytes; X = slot offset

        .assert _wram_pc = $1500, error, "wram.inc: object table moved"

; --- collision map (owner: room.s writes; collision.s reads) ----------------
        W coll_map, 880         ; $1500  TC_* per cell, index = row * 40 + col

; --- per-room object graphics (owner: objects.s) ----------------------------
        W objgfx_base, 32 * 2   ; $1870  per OT_*: first OBJ char number (w), 0 = not loaded
        W objgfx_next_row, 1    ; $18B0  next free OBJ char row (4..32)
        W obj_draw_start, 1     ; $18B1  rotating first slot for Obj_DrawAll
        W band_load, 16         ; $18B2  object slivers per 16-px screen band this frame; only bands
                                ;        0..OAM_BANDS-1 are used (owner: oam.s, cleared by Oam_Begin)

; --- neighbour edge strips (owner: room.s writes at Room_Load; collision.s reads)
; TC_* of the one-cell ring outside the room; TC_EMPTY where there is no neighbour.
        W nbr_edge_l, 22        ; $18C2  column 39 of the left neighbour, by row   (cell col -1)
        W nbr_edge_r, 22        ; $18D8  column 0 of the right neighbour, by row   (cell col 40)
        W nbr_edge_u, 40        ; $18EE  row 21 of the upper neighbour, by column  (cell row -1)
        W nbr_edge_d, 40        ; $1916  row 0 of the lower neighbour, by column   (cell row 22)

        .assert _wram_pc = $193E, error, "wram.inc: objects/edge block moved"

; --- room intro upload buffer (owner: hud.s; DMA'd by nmi.s on HUD_DIRTY_INTRO)
        W_AT $1A00
        W hud_intro_buf, 256    ; $1A00  BG3 rows 11-14, 4 x 32 tilemap words

        .assert _wram_pc <= $1F00, error, "wram.inc: low RAM overflow"

; ===========================================================================
; HIGH WRAM  $7E4000-$7E7FFF   (long addressing: lda f:bg1_map_buf,x)
; ===========================================================================
        W_AT $7E4000
        W bg1_map_buf, 4096     ; $7E4000  BG1 tilemap image: screen A (32x32 words) then screen B
        W bg2_map_buf, 4096     ; $7E5000  BG2 tilemap image        (owner: room.s)
        W slot_attr, 256        ; $7E6000  per tile slot: tilemap high byte (palette << 2 | char bit 8-9)
        W slot_char, 256        ; $7E6100  per tile slot: tilemap low byte (char number bits 0-7)
        W plane_tile, 880       ; $7E6200  RLE decode scratch: slot plane
        W plane_attr, 880       ; $7E6570  RLE decode scratch: attr plane

        .assert _wram_pc <= $7E8000, error, "wram.inc: high WRAM overflow"

; ===========================================================================
; Object slot layout (obj_table + slot * OBJ_SIZE; X = slot * OBJ_SIZE)
;   lda obj_table + OBJ_TYPE,x
; ===========================================================================
OBJ_TYPE        = 0             ; OT_*; 0 = free slot
OBJ_FLAGS       = 1             ; OF_*
OBJ_STATE       = 2             ; type-specific state number
OBJ_XSUB        = 3             ; position 16.8: anchor = body bottom-centre, room px
OBJ_X           = 4             ; (w)
OBJ_YSUB        = 6
OBJ_Y           = 7             ; (w)
OBJ_VX          = 9             ; (w) signed 8.8
OBJ_VY          = 11            ; (w)
OBJ_HW          = 13            ; body half width (from ObjTypeTable at spawn)
OBJ_H           = 14            ; body height
OBJ_ANIM        = 15            ; position in the type's frame sequence
OBJ_ANIM_T      = 16            ; frames until the next sequence step
OBJ_TIMER       = 17            ; general timer (frog hop, pad cooldown, ...)
OBJ_HOME_X      = 18            ; (w) spawn anchor (bat base, enemy respawn)
OBJ_HOME_Y      = 20            ; (w)
OBJ_PARAM       = 22            ; blob param byte
OBJ_BLOCKED     = 23            ; BLK_* from the last move
OBJ_PHASE       = 24            ; bat sine phase / crumble / misc
OBJ_ID          = 25            ; index of the record in the blob object list
OBJ_VAR0        = 26            ; 26-31: type-private
OBJ_SIZE        = 32
OBJ_SHIFT       = 5             ; slot offset = slot << 5

; ===========================================================================
; Bit names for variables above
; ===========================================================================
HUD_RD_TITLE    = $01           ; hud_redraw
HUD_RD_HEARTS   = $02
HUD_RD_TIMER    = $04
HUD_RD_GOAL     = $08
HUD_RD_KEYS     = $10
HUD_RD_SCORE    = $20
HUD_RD_ALL      = $3F

HUD_DIRTY_MAIN  = $01           ; hud_dirty
HUD_DIRTY_MSG   = $02
HUD_DIRTY_INTRO = $04

DBG_GODMODE     = $01           ; dbg_flags: damage and death are ignored
DBG_FREEZE_OBJ  = $02           ; Obj_UpdateAll does nothing
DBG_SKIP_INTRO  = $04           ; GS_ROOM_INTRO lasts 1 frame, title screen auto-starts
DBG_NO_TIMER    = $08           ; goal_ticks does not advance

.endif
