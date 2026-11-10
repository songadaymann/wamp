# SNESWAMP -- SNES (65816) build.   make | make test | make run | make clean
#
# Requires: ca65/ld65 (cc65), python3.  See README.md.

NAME    := sneswamp
BUILD   := build
ROM     := $(BUILD)/$(NAME).sfc

CA65    ?= ca65
LD65    ?= ld65
PYTHON  ?= python3

SRCS    := header init main
OBJS    := $(SRCS:%=$(BUILD)/%.o)
INCS    := $(wildcard src/*.inc)

# Generated binary assets (.incbin'd by src/main.s)
ASSETS  := $(BUILD)/font.bin $(BUILD)/bgtiles.bin $(BUILD)/sprite.bin

# Generated art (contract docs/ARCHITECTURE.md section 2): tools/mkassets.py converts
# the WAMP art into build/gen/{tilelib,gfxsys,player,objects}.inc + binaries + JSON.
GEN        := $(BUILD)/gen
GEN_STAMP  := $(GEN)/.assets.stamp
WAMP_ASSETS ?= ../public/assets

.PHONY: all clean test run check assets preview rooms roomshots roomcheck
all: $(ROM)

assets: $(GEN_STAMP)
$(GEN_STAMP): tools/mkassets.py tools/mkfont.py $(wildcard tools/tilemeta.json)
	@mkdir -p $(GEN)
	$(PYTHON) tools/mkassets.py --assets $(WAMP_ASSETS) --out $(GEN) --stamp $@ -q

# Contact sheets decoded from the generated SNES data -> build/preview/*.png
preview: $(GEN_STAMP)
	$(PYTHON) tools/mkassets.py --assets $(WAMP_ASSETS) --out $(GEN) --preview $(BUILD)/preview -q

# Rooms (contract section 3): tools/mkrooms.py compiles the checked-in WAMP RoomSnapshot JSON
# (rooms/world.json + the files it lists) into room blobs v1 + the world index:
# build/gen/rooms/*.bin, build/gen/rooms.inc (Room_<i>, WorldIndex, ROOM_COUNT), build/gen/rooms.json.
# The JSON itself is authored offline with rooms/src/build.sh (needs Node; not part of make).
ROOM_SRC   := rooms/world.json $(wildcard rooms/*.json rooms/world/*.json)
ROOM_STAMP := $(GEN)/.rooms.stamp

rooms: $(ROOM_STAMP)
$(ROOM_STAMP): tools/mkrooms.py tools/tilemeta.json $(ROOM_SRC) $(GEN_STAMP)
	$(PYTHON) tools/mkrooms.py --rooms rooms --gen $(GEN) -q
	@touch $@

# PNG of every compiled room, drawn from the blobs -> build/gen/rooms/png/*.png
roomshots: $(ROOM_STAMP)
	$(PYTHON) tools/mkrooms.py --gen $(GEN) --render-all

# Reachability report (goal + seam-to-seam traversal under the contract physics)
roomcheck: $(ROOM_STAMP)
	$(PYTHON) tools/roomsim.py --gen $(GEN)

$(BUILD):
	@mkdir -p $@

$(BUILD)/font.bin: tools/mkfont.py | $(BUILD)
	$(PYTHON) tools/mkfont.py $@ --bpp 2

$(BUILD)/bgtiles.bin: assets/bgtiles.txt tools/mkchr.py | $(BUILD)
	$(PYTHON) tools/mkchr.py --bpp 4 $< $@

$(BUILD)/sprite.bin: assets/sprite.txt tools/mkchr.py | $(BUILD)
	$(PYTHON) tools/mkchr.py --bpp 4 --sheet-width 16 $< $@

$(BUILD)/%.o: src/%.s $(INCS) $(GEN_STAMP) $(ROOM_STAMP) | $(BUILD)
	$(CA65) --cpu 65816 -g -I src -I $(BUILD) --bin-include-dir $(BUILD) -l $(BUILD)/$*.lst -o $@ $<

$(BUILD)/main.o: $(ASSETS)

# Link, then patch the header checksum.  Outputs:
#   .sfc ROM, .map link map, .lbl VICE-style labels (al 00XXXX .name), .dbg debug info
$(ROM): $(OBJS) lorom.cfg tools/fixsum.py
	$(LD65) -C lorom.cfg -o $@.tmp -m $(BUILD)/$(NAME).map -Ln $(BUILD)/$(NAME).lbl \
		--dbgfile $(BUILD)/$(NAME).dbg $(OBJS)
	$(PYTHON) tools/fixsum.py $@.tmp
	@mv $@.tmp $@

check: $(ROM)
	$(PYTHON) tools/fixsum.py --check $(ROM)

test: $(ROM)
	$(PYTHON) tests/test_assets.py
	$(PYTHON) tests/test_rooms.py
	$(PYTHON) tests/test_harness.py

# Quick headless smoke run: 120 frames, screenshot to build/shots/run.png
run: $(ROM)
	$(PYTHON) tools/emu.py $(ROM) --frames 120 --shot 119:$(BUILD)/shots/run.png --scale 2 --peek frame_counter:2

clean:
	rm -rf $(BUILD)
