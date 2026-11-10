#!/bin/sh
# Regenerates the checked-in room JSON (snes/rooms/world/*.json, snes/rooms/test_*.json,
# snes/rooms/world.json) and snes/tools/tilemeta.json from the WAMP TypeScript sources.
# Not part of `make`.  Needs node >= 22 and network access for `npx tsx` / npm.
#
# The WAMP import graph needs @tonaljs/key and tonal to be resolvable from src/, so the script
# works on a scratch COPY of /home/user/wamp/src (nothing is written to the repo outside snes/).
#   SCRATCH=/some/dir sh build.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
SNES=$(cd "$HERE/../.." && pwd)
REPO=$(cd "$SNES/.." && pwd)
SCRATCH=${SCRATCH:-${TMPDIR:-/tmp}/sneswamp-roomgen}
mkdir -p "$SCRATCH"
rm -rf "$SCRATCH/src"
cp -r "$REPO/src" "$SCRATCH/src"
if [ ! -d "$SCRATCH/node_modules/tonal" ]; then
  (cd "$SCRATCH" && printf '{"name":"scratch","private":true,"type":"module"}\n' > package.json \
    && npm install --no-audit --no-fund @tonaljs/key@4.11.2 tonal@6.4.3)
fi
export WAMP_SRC="$SCRATCH/src"
cd "$SCRATCH"
npx --yes tsx "$HERE/dump_tilemeta.mts" "$SNES/tools/tilemeta.json"
npx --yes tsx "$HERE/buildrooms.mts" "$SNES/rooms"
