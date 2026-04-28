FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    imagemagick \
    python3 \
    python3-pip \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --break-system-packages --no-cache-dir Pillow==10.4.0

# Debian currently ships ImageMagick 6 where the executable is split across
# `convert` and `identify`; the generator expects ImageMagick 7's `magick`.
RUN printf '%s\n' \
  '#!/bin/sh' \
  'if [ "$1" = "-version" ]; then exec convert -version; fi' \
  'if [ "$1" = "identify" ]; then shift; exec identify "$@"; fi' \
  'exec convert "$@"' \
  > /usr/local/bin/magick \
  && chmod +x /usr/local/bin/magick

WORKDIR /app/repo

COPY build-input/repo/ /app/repo/
COPY build-input/assets/ /app/assets/
COPY runner/ /app/runner/

ENV NODE_ENV=production
ENV PORT=8080
ENV CRYPTOPUNK_METADATA_PATH=/app/assets/fling-punk/punks-metadata.json
ENV CRYPTOPUNK_PUNKS_DIR=/app/assets/fling-punk/punks
ENV PLAYER_SPRITES_SEPARATED_ROOT=/app/assets/player/SpritesSeparated

EXPOSE 8080

CMD ["node", "/app/runner/server.mjs"]
