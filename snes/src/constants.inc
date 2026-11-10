; constants.inc -- SNESWAMP shared constants (binding; see docs/ARCHITECTURE.md)
;
; Everything here is an assembly-time equate; including this file emits no
; bytes.  Hardware register names, JOY_* masks, TILE_*/OBJ_* attribute bits and
; the A8/A16/I8/I16 width macros live in snes.inc (included below).
;
; Fixed point: velocities are signed 8.8 px/frame words ("V_" constants are
; magnitudes unless the name ends in _NEG, which is the two's-complement word).
; Timers are unsigned bytes in 60 Hz frames.  "T_" values are the value to
; STORE; see ARCHITECTURE.md 5.6 for the tick rule that makes them exact.

.ifndef CONSTANTS_INC
CONSTANTS_INC = 1

.include "snes.inc"

; ===========================================================================
; Room geometry
; ===========================================================================
TILE_SIZE       = 16
ROOM_W          = 40            ; tiles
ROOM_H          = 22
ROOM_CELLS      = ROOM_W * ROOM_H       ; 880
ROOM_PX_W       = 640
ROOM_PX_H       = 352
SCREEN_W        = 256
SCREEN_H        = 224
CAM_MAX_X       = ROOM_PX_W - SCREEN_W  ; 384
CAM_MAX_Y       = ROOM_PX_H - SCREEN_H  ; 128
EDGE_WALL       = 12            ; invisible wall thickness on edges with no neighbour

; ===========================================================================
; Limits
; ===========================================================================
MAX_OBJECTS     = 64            ; object slots == max objects per room blob
MAX_ROOM_TILES  = 255           ; library tiles per room (slots 1..255; slot 0 = empty)
MAX_ROOMS       = 64            ; world index entries
MAX_TITLE       = 24            ; room title bytes in the blob header
PL_MAX_CELLS    = 12            ; 16x16 OBJ cells per player frame (slash frames need 10-12)
PL_CELLS_A      = 8             ; cells 0-7 = upload group A (OBJ char rows 0-1), 8-11 = group B (rows 2-3)
PL_MAX_LINE_CELLS = 5           ; converter limit: player cells on any one scanline
OBJ_GFX_FIRST_ROW = 4           ; first OBJ char row of the per-room object strips
OBJ_GFX_ROWS    = 28            ; OBJ char rows (16 chars each) available per room: rows 4..31
VQ_MAX          = 15            ; VRAM word-write queue entries per frame
NMI_DMA_BUDGET  = 2560          ; hard cap, bytes of DMA per vblank (see 4.5)
CRUMBLE_MAX     = 24            ; crumble_tab entries
OAM_BANDS       = 14            ; 16-px screen bands 0..13 tracked in band_load (lines 0..223)
BAND_OBJ_MAX    = 24            ; object slivers (8 px) allowed per band; the player keeps 10 of 34

; ===========================================================================
; Tile collision classes (collision map bytes).  Bit 7 set = solid box.
; ===========================================================================
TC_EMPTY        = $00
TC_DAMAGE       = $01           ; special 677: non-solid, kills/hurts on overlap or contact
TC_WATER        = $02           ; special 682: swim zone
TC_ONEWAY       = $03           ; special 670: solid from above only
TC_ONEWAY_WATER = $04           ; 670 on terrain + 682 on another layer: one-way AND water
TC_SOLID        = $80
TC_ICE          = $81           ; special 674
TC_BOUNCE       = $82           ; special 676
TC_CRUMBLE      = $83           ; special 687
TC_CONV_L       = $84           ; special 672
TC_CONV_R       = $85           ; special 673
TC_SOLID_DAMAGE = $86           ; plain solid terrain + 677 on another layer: CT_DAMAGE on contact
TC_SOLID_BIT    = $80

; Contact-kind bitmask (pl_contact): OR of the classes under the feet.
CT_ICE          = $01
CT_BOUNCE       = $02
CT_CRUMBLE      = $04
CT_CONV_L       = $08
CT_CONV_R       = $10
CT_DAMAGE       = $20
CT_ONEWAY       = $40           ; standing on a one-way cell

; Blocked flags (pl_blocked, mv_blocked, OBJ_BLOCKED)
BLK_DOWN        = $01
BLK_UP          = $02
BLK_LEFT        = $04
BLK_RIGHT       = $08

; Mover options (mv_opts)
MVO_ONEWAY      = $01           ; one-way cells collide (subject to the one-way rule)
MVO_EDGEWALLS   = $02           ; room edges without a neighbour are walls (player)
MVO_SOLIDOBJ    = $04           ; collide with solid objects (door; ladder top for the player)
MVO_DROPTHRU    = $08           ; ignore one-way cells and ladder tops this pass
MVO_PLAYER      = $10           ; the mover is the player: door unlock + ladder-top rules apply

; ===========================================================================
; Object type ids (room blob object records, OBJ_TYPE).  0 = free slot.
; ===========================================================================
OT_NONE             = 0
OT_COIN_GOLD        = 1
OT_COIN_SILVER      = 2
OT_GEM              = 3
OT_HEART            = 4
OT_KEY              = 5
OT_STAR             = 6
OT_SPIKES           = 7
OT_SAW              = 8
OT_FIRE             = 9
OT_BOUNCE_PAD       = 10
OT_LADDER           = 11
OT_CHECKPOINT_FLAG  = 12
OT_DOOR_LOCKED      = 13
OT_CRATE            = 14        ; RESERVED id: not in milestone 1 (converter drops it with a warning)
OT_SLIME_BLUE       = 15
OT_SLIME_RED        = 16
OT_BAT              = 17
OT_CRAB             = 18
OT_FROG             = 19
OT_EXIT             = 20        ; goal marker: reach_exit exit / sprint finish (param 1)
OT_SPRINT_CP        = 21        ; goal marker: sprint checkpoint, param = order (0-based)
OT_COUNT            = 22
OT_FIRST_COLLECT    = OT_COIN_GOLD      ; collectibles are 1..6
OT_LAST_COLLECT     = OT_STAR
OT_FIRST_HAZARD     = OT_SPIKES         ; hazards are 7..9
OT_LAST_HAZARD      = OT_FIRE
OT_FIRST_ENEMY      = OT_SLIME_BLUE     ; enemies are 15..19
OT_LAST_ENEMY       = OT_FROG

; Object flags (OBJ_FLAGS)
OF_LEFT         = $01           ; facing/moving left (art is stored facing right)
OF_HIDDEN       = $02           ; not drawn, no interaction (collected, defeated, opened)
OF_FG           = $04           ; WAMP layer 'foreground': OBJ priority 3
OF_ONFLOOR      = $08           ; BLK_DOWN was set by the last move
OF_ACTIVE       = $10           ; type-specific "active" (pad squashed, flag reached)
OF_SOLID        = $20           ; blocks movers (door).  OF_SOLID objects never move in M1
OF_BG           = $40           ; WAMP layer 'background': OBJ priority 1 (behind BG1/BG2 tiles)

; Score values (WAMP pickups.ts / enemyLifecycle.ts)
SCORE_COIN_GOLD     = 3
SCORE_COIN_SILVER   = 2
SCORE_GEM           = 5
SCORE_STAR          = 5
SCORE_HEART         = 1
SCORE_KEY           = 1
SCORE_ENEMY         = 10

; ===========================================================================
; Goals
; ===========================================================================
GOAL_NONE               = 0
GOAL_REACH_EXIT         = 1
GOAL_COLLECT_TARGET     = 2     ; param = requiredCount
GOAL_DEFEAT_ALL         = 3     ; param = enemy count (baked)
GOAL_CHECKPOINT_SPRINT  = 4     ; param = checkpoint count (finish not included)
GOAL_COUNT              = 5

GR_ACTIVE       = 0             ; goal_result
GR_COMPLETE     = 1
GR_FAILED       = 2             ; time limit expired

GOAL_TOUCH_R    = 18            ; marker touch radius (px): |dx| <= 18 and |dy| <= 18 ...
GOAL_TOUCH_DIAG = 25            ; ... and |dx| + |dy| <= 25 (octagon test, ARCHITECTURE 6.3)

; ===========================================================================
; Game states (game_state)
; ===========================================================================
GS_BOOT         = 0
GS_TITLE        = 1
GS_ROOM_LOAD    = 2             ; force blank, load room_next
GS_ROOM_INTRO   = 3
GS_PLAY         = 4
GS_DYING        = 5
GS_TRANSITION   = 6             ; fade out before GS_ROOM_LOAD (edge crossing)
GS_GOAL         = 7             ; goal-complete beat
GS_PAUSE        = 8
GS_COUNT        = 9

; room_entry: how the player enters the room being loaded
RE_SPAWN        = 0             ; at the room spawn point (boot, restart, debug warp)
RE_FROM_LEFT    = 1             ; walked off the previous room's RIGHT edge: x -= 640
RE_FROM_RIGHT   = 2             ; x += 640
RE_FROM_TOP     = 3             ; fell out of the room above: y -= 352
RE_FROM_BOTTOM  = 4             ; y += 352

; room_nbr indices
NBR_LEFT        = 0
NBR_RIGHT       = 1
NBR_UP          = 2
NBR_DOWN        = 3
NBR_NONE        = $FF

; ===========================================================================
; Input mapping (masks into joy1 / joy1_pressed; JOY_* from snes.inc)
; ===========================================================================
BTN_JUMP        = JOY_B | JOY_A
BTN_SLASH       = JOY_Y | JOY_X
BTN_LEFT        = JOY_LEFT
BTN_RIGHT       = JOY_RIGHT
BTN_UP          = JOY_UP        ; also jumps when not overlapping a ladder
BTN_DOWN        = JOY_DOWN
BTN_PAUSE       = JOY_START
BTN_RESTART     = JOY_SELECT    ; while paused: restart the room

; ===========================================================================
; Player
; ===========================================================================
PL_HALF_W       = 5             ; body is 10 px wide: [x-5, x+5)
PL_H_STAND      = 26
PL_H_SMALL      = 14            ; airborne, crouching, no headroom
PL_ANCHOR_H     = 13            ; body-centre y = feet - 13 (room membership test)
PL_SENSOR_EXTRA = 15            ; pickup sensor = body + 15 px upward
PL_GFX_FEET_OFS = 2             ; art bottom is 2 px below the feet (folded into frame dy)

; pl_state bits
PF_GROUNDED     = $01
PF_CROUCH       = $02
PF_CLIMB        = $04
PF_WATER        = $08
PF_WALLSLIDE    = $10
PF_STOMP        = $20
PF_JUMPCHAIN    = $40           ; wall jumpChainActive
PF_WJ_ACTIVE    = $80           ; wall jumpActive (until vy >= 0)

; pl_facing / pl_wj_dir / wall sides
DIR_RIGHT       = $01
DIR_LEFT        = $FF
DIR_NONE        = $00

; Player animation ids (index into PlayerAnimTable)
PA_IDLE         = 0
PA_RUN          = 1
PA_JUMP_RISE    = 2
PA_JUMP_FALL    = 3
PA_LAND         = 4
PA_WALL_SLIDE   = 5
PA_WALL_JUMP    = 6
PA_STOMP_FLIP   = 7
PA_LADDER       = 8
PA_CROUCH       = 9
PA_CRAWL        = 10
PA_SLASH        = 11
PA_SLASH_DOWN   = 12
PA_COUNT        = 13

; --- velocities, signed 8.8 px/frame (research-physics.md section 17) -------
V_GRAVITY           = $0032     ; 700 px/s^2  (per frame^2)
V_MAX_Y             = $0855     ; 500 px/s    symmetric clamp on vy
V_MAX_Y_NEG         = $F7AB
V_RUN               = $0280     ; 150
V_CRAWL             = $012B     ; 70
V_JUMP_NEG          = $FB55     ; -280  (-$04AB)
V_WALL_SLIDE        = $012B     ; 70    cap, applied before gravity
V_WALL_JUMP_X       = $036B     ; 205
V_WALL_JUMP_Y_NEG   = $FB95     ; -265  (-$046B)
V_LADDER            = $0180     ; 90
V_LADDER_CENTER     = $00C0     ; 45    max auto-centring speed
V_STOMP             = $0855     ; 520 set -> clamped to 500
V_WATER_RUN         = $018D     ; 93
V_WATER_CRAWL       = $00B9     ; 43.4
V_SWIM_KICK_NEG     = $FD33     ; -168  (-$02CD)
V_WATER_SINK        = $01F7     ; 118   cap, applied before gravity
V_BOUNCE_NEG        = $F977     ; -392  (-$0689) bounce pad and bounce tile
V_BOUNCE_MIN_NEG    = $FF9A     ; -24   (-$0066) launch only if vy >= this
V_STOMP_BOUNCE_NEG  = $FD4B     ; -162.4 (-$02B5) enemy stomp, jump not held
V_STOMP_MIN         = $00AB     ; 40    enemy is stomped only if vy > this
V_POGO_NEG          = $FC80     ; -210  (-$0380) down-slash hit
V_SLASH_DOWN_MIN    = $0200     ; 120   down-slash forces vy >= this
V_SLASH_LUNGE       = $0180     ; 90    added to vx on a forward hit
V_WEAPON_KB_MAX     = $0360     ; 202.5 clamp for the lunge
V_HURT_X            = $01AB     ; 100   knockback, away from facing
V_HURT_Y_NEG        = $FE00     ; -120  (-$0200)
V_DROP_THROUGH      = $016F     ; 86    one-way drop-through push
V_CONVEYOR          = $00CD     ; 48    added to vx while grounded
V_GAP_ASSIST_MIN_NEG= $FFFC     ; -1    single-tile gap assist only if vy >= this (5.5 C4b)
V_ANIM_RISE_NEG     = $FFD5     ; -10   airborne: vy < this = PA_JUMP_RISE, else PA_JUMP_FALL
V_ANIM_CRAWL_MIN    = $0022     ; 8     crouching: |vx| > this = PA_CRAWL
V_ANIM_RUN_MIN      = $0033     ; 12    no input: |vx| > this = PA_RUN
JUMP_CUT_MUL        = $DA       ; x218/256 (0.85) per frame while rising, jump released
ICE_COAST_MUL       = $FC       ; x252/256 (0.985) per frame, no input
; Ice: vx += (target - vx) * k/256 with k = 256 * 15 / speed(px/s); one constant per speed
ICE_LERP_RUN        = $1A       ; 0.100  (speed 150)
ICE_LERP_CRAWL      = $37       ; 0.214  (70)
ICE_LERP_WATER_RUN  = $29       ; 0.161  (93)
ICE_LERP_WATER_CRAWL= $58       ; 0.346  (43.4)
ICE_SNAP            = 10        ; if |target - vx| < this many raw 8.8 units: vx = target

; One-way / ladder-top / gap-assist tolerances (px).  One-way cells and ladder
; tops are tested only in the vy >= 0 branch of Coll_MoveY (normative, 5.3).
ONEWAY_PREV_TOL     = 6         ; previous bottom <= top + 6
ONEWAY_CUR_TOL      = 12        ; current bottom  <= top + 12
LADDER_TOP_INSET    = 2         ; support top = ladder body top + 2
LADDER_TOP_TOL      = 10        ; top <= current bottom <= top + 10
LADDER_TOP_HW       = 9         ; support is 18 px wide, centred on the ladder
GAP_ASSIST_SINK_MAX = 4         ; -1 <= feet - floorTop <= 4

; --- timers (value to store; frames) ----------------------------------------
T_COYOTE            = 7         ; jump allowed on airborne frames 1..6
T_JUMP_BUFFER       = 8         ; press frame + next 7
T_WALLJUMP_BUFFER   = 15        ; press frame + next 14
T_PROTECT           = 5         ; launch frame + next 4: no release cut
T_WALL_GRACE        = 9         ; wall jump allowed up to 8 frames after last contact
T_WALLJUMP_LOCK     = 15        ; vx forced on the 14 frames after the jump frame
T_WALLJUMP_STEER    = 7         ; opposite input cancels the lock once lock timer <= this
T_STOMP_FLIP        = 12        ; hover: start frame + 11
T_HURT_KNOCKBACK    = 13        ; vx forced on 12 Player_Control calls (set before the tick)
T_INVULN            = 60        ; immune on the next 59 frames
T_WEAPON_KB         = 6         ; set by Player_Sword (after the tick): next 5 frames
T_SWORD_ACTIVE      = 6         ; hit test on press frame + next 5
T_SWORD_ANIM        = 11
T_SWORD_COOLDOWN    = 14
T_DROP_THROUGH      = 14        ; one-way ignored by the next 14 Player_Integrate calls
T_BOUNCE_GRACE      = 12        ; bounce cooldown + release-cut suppression (set before the tick)
T_PAD_COOLDOWN      = 14        ; bounce pad (220 ms)
T_PAD_ACTIVE        = 9         ; bounce pad shows frame 1 (140 ms)
T_HITSTOP           = 3         ; enemy kill
T_DEATH_BEAT        = 11        ; frozen + hidden before respawn
T_LAND_ANIM         = 7         ; PA_LAND shown for 120 ms after a landing
T_CRUMBLE_SHAKE     = 24        ; 400 ms
T_CRUMBLE_RETURN    = 120       ; 2000 ms
T_NEED_KEY_MSG      = 54        ; 900 ms throttle
T_FADE_STEP         = 1         ; frames per brightness step (step size 2 -> 8 frames)
T_STATUS_MSG        = 120
T_ROOM_INTRO        = 90
T_GOAL_BEAT         = 60

; --- sword hitboxes (px, relative to feet point; facing right) --------------
SWORD_FWD_X0    = -6            ; x in [cx-6, cx+22) facing right; mirror for left
SWORD_FWD_W     = 28
SWORD_FWD_Y0    = -26           ; y in [feet-26, feet+4)
SWORD_FWD_H     = 30
SWORD_DOWN_X0   = -12           ; x in [cx-12, cx+12)
SWORD_DOWN_W    = 24
SWORD_DOWN_Y0   = -2            ; y in [feet-2, feet+26)
SWORD_DOWN_H    = 28
SWORD_MAX_HITS  = 3

; ===========================================================================
; Enemies (research-objects.md section 6)
; ===========================================================================
V_SLIME         = $0080         ; 30 px/s
V_CRAB          = $009A         ; 36
V_BAT           = $0133         ; 72
V_BAT_MAX_Y     = $01CD         ; 108   clamp of the bat's sine-tracking vy
V_FROG_X        = $0122         ; 68
V_FROG_HOP_NEG  = $FC11         ; -236 (-$03EF)
T_FROG_FIRST    = 15            ; 250 ms before the first hop
T_FROG_DELAY    = 43            ; 720 ms between take-offs
BAT_AMPLITUDE   = 6             ; px; BatSine table has 32 entries (period 32 frames)
ENEMY_STOMP_TOL = 10            ; player.bottom <= enemy.top + 10
PAD_TOP_TOL     = 12            ; player.bottom <= pad.top + 12
LEDGE_PROBE_X   = 4             ; probe at centre + dir*(halfWidth + 4)
LEDGE_PROBE_Y   = 2             ; ... and body.bottom + 2
LEDGE_STEP_MAX  = 18            ; floor within [feet, feet+18) below the probe = no ledge

; ===========================================================================
; VRAM layout (WORD addresses) and PPU register values
; ===========================================================================
VRAM_BG_CHR     = $0000         ; BG1+BG2 4bpp chr, 1024 chars = 256 16x16 tile slots
VRAM_BG3_CHR    = $4000         ; BG3 2bpp chr, 384 chars
VRAM_BG3_MAP    = $4C00         ; 32x32
VRAM_BG1_MAP    = $5000         ; 64x32 (screen A $5000, screen B $5400)
VRAM_BG2_MAP    = $5800         ; 64x32 (screen A $5800, screen B $5C00)
VRAM_OBJ_CHR    = $6000         ; 512 chars 4bpp

PPU_BGMODE      = $39           ; mode 1, BG3 priority, BG1+BG2 16x16 tiles
PPU_BG1SC       = $51           ; $5000, 64x32
PPU_BG2SC       = $59           ; $5800, 64x32
PPU_BG3SC       = $4C           ; $4C00, 32x32
PPU_BG12NBA     = $00
PPU_BG34NBA     = $04
PPU_OBSEL       = $63           ; 16x16 / 32x32, base $6000
PPU_TM          = TM_BG1 | TM_BG2 | TM_BG3 | TM_OBJ

; BG 16x16 tile slot s (0..255) -> first char number = (s & 7) * 2 + (s >> 3) * 32
; (chars c, c+1, c+16, c+17).  VRAM word address of char c = VRAM_BG_CHR + c * 16.
TILE_BYTES      = 128           ; library tile: TL, TR, BL, BR chars, 32 bytes each
TILE_HALF_BYTES = 64            ; one DMA: top pair or bottom pair
BGCHAR_ROW_WORDS= 256           ; word distance from a slot's top pair to its bottom pair

; OBJ chr allocation (char numbers 0..511; word address = VRAM_OBJ_CHR + c * 16)
; Player cell k is the 16x16 sprite with tile number 2k (k < 8) or $20 + 2(k-8) (k >= 8).
OBJCHR_PLAYER       = 0         ; group A (cells 0-7): top pairs -> chars 0-15 ...
OBJCHR_PLAYER_BOT   = 16        ; ... bottom pairs -> chars 16-31
OBJCHR_PLAYER2      = 32        ; group B (cells 8-11): top pairs -> chars 32-39 ...
OBJCHR_PLAYER2_BOT  = 48        ; ... bottom pairs -> chars 48-55
OBJCHR_ROOM         = 64        ; per-room object strips: rows 4..31 (28 rows of 16 chars)
OBJ_ROW_BYTES       = 512       ; one row of 16 4bpp chars

; BG3 tile numbers
HT_FONT         = 0             ; tiles 0-95 = ASCII $20-$7F (tile = ch - $20)
HT_HEART_FULL   = 96
HT_HEART_EMPTY  = 97
HT_KEY          = 98
HT_COIN         = 99
HT_CLOCK        = 100
HT_ENEMY        = 101
HT_FLAG         = 102
HT_ICON_COUNT   = 16            ; hudchr.bin holds tiles 96..111

; ===========================================================================
; CGRAM layout (colour indices)
; ===========================================================================
CG_BACKDROP     = 0             ; per-room backdrop colour (blob header)
CG_BG3          = 0             ; BG3 2bpp sub-palettes 0-7 = entries 0-31
CG_BGPAL        = 32            ; BG 4bpp palettes 2-7 (bgpal.bin, 192 bytes)
CG_OBJPAL       = 128           ; OBJ palettes 0-7 (objpal.bin, 256 bytes)
BGPAL_FIRST     = 2             ; tile library palette numbers are 2..7
BGPAL_LAST      = 7
OBJPAL_PLAYER   = 0             ; OBJ palettes 1..5 are assigned by the converter (OG_PALETTE)
OBJPAL_ALT_GOLD = 6             ; completed exit flag: recolour of the exit flag's palette
OBJPAL_ALT_GREEN= 7             ; reached checkpoint flag: recolour of the flag's palette

; BG3 sub-palettes (tilemap high byte = TILE_PRIO | (n << 2))
HP_TEXT         = 0             ; 1 white, 2 shadow, 3 yellow
HP_DIM          = 1             ; 1 grey
HP_HEART        = 2
HP_ICON         = 3
HUD_ATTR_TEXT   = TILE_PRIO | (HP_TEXT << 2)
HUD_ATTR_DIM    = TILE_PRIO | (HP_DIM << 2)
HUD_ATTR_HEART  = TILE_PRIO | (HP_HEART << 2)
HUD_ATTR_ICON   = TILE_PRIO | (HP_ICON << 2)

; ===========================================================================
; HUD layout (BG3 tilemap cells; 32 x 28 visible)
; ===========================================================================
HUD_ROW0        = 1             ; hud_buf row 0 -> BG3 row 1
HUD_ROW1        = 2             ; hud_buf row 1 -> BG3 row 2
HUD_MSG_ROW     = 25            ; hud_msg_buf -> BG3 row 25
HUD_TITLE_COL   = 1             ; row 0, 16 chars
HUD_TITLE_LEN   = 16
HUD_HEART_COL   = 18            ; row 0, 3 cells
HUD_TIMER_COL   = 23            ; row 0, 8 cells: clock icon, "MM:SS.t"
HUD_GOAL_COL    = 1             ; row 1, 12 cells: icon + progress text
HUD_GOAL_LEN    = 12
HUD_KEY_COL     = 14            ; row 1, 3 cells: key icon, 'x', digit (blank when 0)
HUD_SCORE_COL   = 20            ; row 1, 11 cells: "SCORE 00000"
INTRO_ROW       = 11            ; room intro box: BG3 rows 11-14 = hud_intro_buf (4 full rows)
INTRO_ROWS      = 4

; Status message ids (hud.s MsgTable)
MSG_NONE        = 0
MSG_GOAL_START  = 1
MSG_GOAL_DONE   = 2
MSG_TIME_UP     = 3
MSG_CHECKPOINT  = 4
MSG_NEED_KEY    = 5
MSG_UNLOCKED    = 6
MSG_LOST_HEART  = 7
MSG_HEART       = 8
MSG_KEY         = 9
MSG_YOU_FELL    = 10
MSG_HIT         = 11
MSG_PAUSED      = 12
MSG_COUNT       = 13

; ===========================================================================
; ROM banks (lorom.cfg segments)
; ===========================================================================
BANK_CODE       = $00
BANK_DATA1      = $01
BANK_TILELIB    = $02           ; +0..3: tile id t -> bank BANK_TILELIB + (t >> 8),
                                ;        address $8000 + (t & $FF) * 128
BANK_PLAYERGFX  = $06           ; +0..3
BANK_OBJGFX     = $0A           ; +0..1
BANK_ROOMS      = $0C           ; +0..3

; ===========================================================================
; Room blob v1 (docs/ARCHITECTURE.md section 3) -- header field offsets
; ===========================================================================
RB_MAGIC        = $00           ; 4  "WSR1"
RB_VERSION      = $04           ; 1  = 1
RB_RULESET      = $05           ; 1  = 0 (SNES ruleset v0)
RB_SIZE         = $06           ; 2  total blob bytes
RB_ROOM_X       = $08           ; 1  signed
RB_ROOM_Y       = $09           ; 1  signed
RB_FLAGS        = $0A           ; 1  RF_*
RB_HEARTS       = $0B           ; 1  1..3
RB_BACKDROP     = $0C           ; 2  BGR555
RB_SPAWN_X      = $0E           ; 2  feet x, room px
RB_SPAWN_Y      = $10           ; 2  feet y, room px
RB_GOAL_TYPE    = $12           ; 1  GOAL_*
RB_GOAL_PARAM   = $13           ; 1
RB_GOAL_TIME    = $14           ; 2  time limit in seconds, 0 = none
RB_TILE_COUNT   = $16           ; 1  N = 0..255
RB_OBJ_COUNT    = $17           ; 1  M = 0..64
RB_LIB_VERSION  = $18           ; 1  must equal TILELIB_VERSION
RB_RESERVED19   = $19           ; 1  reserved, 0
RB_OFS_TILES    = $1A           ; 2  -> N * 2 bytes of library tile ids
RB_OFS_BG1_TILE = $1C           ; 2  -> RLE plane, 880 slot bytes
RB_OFS_BG1_ATTR = $1E           ; 2  -> RLE plane, 880 attr bytes (0 = all zero)
RB_OFS_BG2_TILE = $20           ; 2  -> RLE plane (0 = layer empty)
RB_OFS_BG2_ATTR = $22           ; 2  -> RLE plane (0 = all zero)
RB_OFS_COLL     = $24           ; 2  -> RLE plane, 880 TC_* bytes
RB_OFS_OBJS     = $26           ; 2  -> M * 6 bytes
RB_TITLE        = $28           ; 24 ASCII $20-$7E, space padded
RB_HEADER_SIZE  = $40

RB_VERSION_1    = 1
RB_RULESET_V0   = 0

; RB_FLAGS
RF_PITS_DEADLY  = $01
RF_CAMERA_ROOM  = $02           ; WAMP cameraMode 'room' (recorded; the engine always follows)
                                ; bits 2-7 reserved, 0

; Plane attr bytes == tilemap high-byte flag bits (TILE_VFLIP/TILE_HFLIP/TILE_PRIO)
RA_VFLIP        = $80
RA_HFLIP        = $40
RA_PRIO         = $20           ; BG1: cell came from the 'foreground' layer

; Object record (6 bytes)
RO_TYPE         = 0             ; 1  OT_*
RO_XW           = 1             ; 2  bits 0-9 x (0..1023), 10-12 zero, 13-14 layer (0 bg, 1 terrain, 2 fg), 15 facing left
RO_Y            = 3             ; 2  signed y (-128..511)
RO_PARAM        = 5             ; 1
RO_SIZE         = 6
RO_X_MASK       = $03FF
RO_LAYER_MASK   = $6000
RO_LAYER_BG     = $0000
RO_LAYER_TERRAIN= $2000
RO_LAYER_FG     = $4000
RO_LEFT         = $8000

; World index (label WorldIndex in DATA1)
WI_MAGIC        = 0             ; 4  "WSW1"
WI_COUNT        = 4             ; 1
WI_START        = 5             ; 1  start room index
WI_ENTRIES      = 8             ; count * 6
WE_X            = 0             ; 1  signed
WE_Y            = 1             ; 1  signed
WE_ADDR         = 2             ; 3  lo, hi, bank
WE_FLAGS        = 5             ; 1  reserved (0)
WE_SIZE         = 6

; ===========================================================================
; Generated table record layouts (section 2)
; ===========================================================================
; PlayerFrameTable entry -> record: n, bank index, addr.w, then n * (dx, dy)
PFR_CELLS       = 0             ; 1  n = 1..PL_MAX_CELLS
PFR_BANK        = 1             ; 1  + BANK_PLAYERGFX
PFR_ADDR        = 2             ; 2  $8000-$FFFF; chr = a*64 top bytes, a*64 bottom bytes (a = min(n, 8)),
                                ;    then b*64 top bytes, b*64 bottom bytes (b = n - a); n*128 in all
PFR_OFFSETS     = 4             ; n * 2 signed bytes: dx, dy of each cell's top-left

; PlayerAnimTable entry (4 bytes) -> frame index list
PAN_COUNT       = 0             ; 1
PAN_HOLD        = 1             ; 1  60 Hz frames per animation frame
PAN_FLAGS       = 2             ; 1  bit 0 = loop
PAN_FIRST       = 3             ; 1  index into PlayerAnimFrames
PAN_SIZE        = 4

; ObjGfxTable entry (12 bytes, indexed by OT_*)
OG_BANK         = 0             ; 1  + BANK_OBJGFX
OG_ADDR         = 1             ; 2
OG_ROWS         = 3             ; 1  char rows 2 or 4 (x 512 bytes); 0 = no graphics;
                                ;    OG_ALIAS | t = no strip of its own, uses the strip of type t
OG_PALETTE      = 4             ; 1  OBJ palette 1..5
OG_STRIDE       = 5             ; 1  chars between consecutive strip frames (2 or 4)
OG_SEQ_LEN      = 6             ; 1  1..8
OG_HOLD         = 7             ; 1  60 Hz frames per sequence step; 0 = code driven
OG_SEQ          = 8             ; 2  -> seq_len bytes (strip frame numbers), bank DATA1
OG_PIECES       = 10            ; 2  -> count, count * (dx, dy, char, flags), bank DATA1
OG_SIZE         = 12
OG_ALIAS        = $80           ; OG_ROWS flag (see above); OG_ROWS & $1F = OT_* of the strip owner
OGP_LARGE       = $01           ; piece flags: 32x32 (else 16x16)

; ObjTypeTable entry (objects.s, 4 bytes, indexed by OT_* << 2)
OTT_HW          = 0             ; 1  body half width
OTT_H           = 1             ; 1  body height
OTT_FLAGS       = 2             ; 1  initial OF_* (OF_SOLID for the door); OF_LEFT/OF_FG/OF_BG come from the record
OTT_SIZE        = 4             ; byte 3 = 0

.endif
