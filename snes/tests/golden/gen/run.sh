#!/bin/sh
# Regenerate the SNESWAMP golden physics traces from the real web-game code.
#
#   snes/tests/golden/gen/run.sh [SCRATCH_DIR]
#
# Copies the web game's sources into SCRATCH_DIR (default: $TMPDIR/sneswamp-golden), installs its
# dependencies THERE (never in the repo), drops the generator into src/scenes/overworld/ of the copy
# and runs it with vitest. Traces are written to snes/tests/golden/*.json.
# Needs: node >= 22, npm, network access for `npm ci` on the first run.
set -eu
GEN_DIR=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$GEN_DIR/../../../.." && pwd)
OUT=${GOLDEN_OUT:-$GEN_DIR/..}
SCRATCH=${1:-${TMPDIR:-/tmp}/sneswamp-golden}

mkdir -p "$SCRATCH"
cp "$REPO/package.json" "$REPO/package-lock.json" "$REPO/tsconfig.json" "$REPO/vitest.config.ts" "$SCRATCH/"
rm -rf "$SCRATCH/src"
cp -R "$REPO/src" "$SCRATCH/src"
cp "$GEN_DIR/snesGolden.gen.test.ts" "$SCRATCH/src/scenes/overworld/"
cd "$SCRATCH"
[ -d node_modules/phaser ] || npm ci --ignore-scripts
GOLDEN_OUT="$OUT" npx vitest run src/scenes/overworld/snesGolden.gen.test.ts
