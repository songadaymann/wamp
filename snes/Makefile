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

.PHONY: all clean test run check
all: $(ROM)

$(BUILD):
	@mkdir -p $@

$(BUILD)/font.bin: tools/mkfont.py | $(BUILD)
	$(PYTHON) tools/mkfont.py $@ --bpp 2

$(BUILD)/bgtiles.bin: assets/bgtiles.txt tools/mkchr.py | $(BUILD)
	$(PYTHON) tools/mkchr.py --bpp 4 $< $@

$(BUILD)/sprite.bin: assets/sprite.txt tools/mkchr.py | $(BUILD)
	$(PYTHON) tools/mkchr.py --bpp 4 --sheet-width 16 $< $@

$(BUILD)/%.o: src/%.s $(INCS) | $(BUILD)
	$(CA65) --cpu 65816 -g -I src --bin-include-dir $(BUILD) -l $(BUILD)/$*.lst -o $@ $<

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
	$(PYTHON) tests/test_harness.py

# Quick headless smoke run: 120 frames, screenshot to build/shots/run.png
run: $(ROM)
	$(PYTHON) tools/emu.py $(ROM) --frames 120 --shot 119:$(BUILD)/shots/run.png --scale 2 --peek frame_counter:2

clean:
	rm -rf $(BUILD)
