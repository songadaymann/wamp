#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const FLIP_X_FLAG = 1 << 20;
export const FLIP_Y_FLAG = 1 << 21;
const FLIP_MASK = FLIP_X_FLAG | FLIP_Y_FLAG;
const REPORT_SCHEMA_VERSION = 1;
const FIXTURE_SCHEMA_VERSION = 1;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURE_DIR = path.resolve(
  SCRIPT_DIR,
  '../test/fixtures/smart-autotiling/references',
);
export const DEFAULT_TILESET_ATLAS_DIR = path.resolve(SCRIPT_DIR, '../public/assets/tilesets');

const TILE_SIZE = 16;
// Mirrors the local raster path and geometry fields in src/config/tilesets.ts.
// Keep this script-only manifest explicit so fixture rendering never imports the
// browser runtime or resolves an asset URL over the network.
const LOCAL_TILESET_ATLASES = Object.freeze({
  forest: Object.freeze({ filename: 'tileset_forest.png', columns: 12, rows: 6 }),
  desert: Object.freeze({ filename: 'tileset_desert.png', columns: 12, rows: 6 }),
  cave: Object.freeze({ filename: 'tileset_cave.png', columns: 12, rows: 6 }),
  lava: Object.freeze({ filename: 'tileset_lava.png', columns: 15, rows: 7 }),
  snow: Object.freeze({ filename: 'tileset_snow.png', columns: 11, rows: 6 }),
  water: Object.freeze({ filename: 'tileset_water.png', columns: 12, rows: 6 }),
  smb_lvl1_3_5: Object.freeze({
    filename: 'tileset_smb_lvl1_3_5.png',
    columns: 8,
    rows: 4,
  }),
  essentials: Object.freeze({ filename: 'beginner.png', columns: 9, rows: 5 }),
  'text white': Object.freeze({ filename: 'text_white.png', columns: 8, rows: 6 }),
  'text black': Object.freeze({ filename: 'text_black.png', columns: 8, rows: 6 }),
  'signs and graffiti': Object.freeze({ filename: 'signs.png', columns: 6, rows: 6 }),
  special: Object.freeze({ filename: 'special.png', columns: 8, rows: 8 }),
  gothic: Object.freeze({ filename: 'gothic.png', columns: 12, rows: 6 }),
  backrooms: Object.freeze({ filename: 'backrooms.png', columns: 12, rows: 10 }),
  wampos95: Object.freeze({ filename: 'wampos95.png', columns: 12, rows: 27 }),
  micromono: Object.freeze({ filename: 'MicroMono.png', columns: 8, rows: 21 }),
  micromonobold: Object.freeze({ filename: 'MicroMonoBold.png', columns: 8, rows: 21 }),
  cybertext: Object.freeze({ filename: 'CyberText.png', columns: 8, rows: 6 }),
  'cybercity yellow': Object.freeze({
    filename: 'cybercity_yellow.png',
    columns: 12,
    rows: 7,
  }),
  'cybercity pink': Object.freeze({ filename: 'cybercity_pink.png', columns: 12, rows: 7 }),
  boygame: Object.freeze({ filename: 'boygame.png', columns: 8, rows: 7 }),
  'jungle-vines': Object.freeze({ filename: 'jungle-vines.png', columns: 9, rows: 8 }),
});

export const REFERENCE_ROOMS = Object.freeze([
  Object.freeze({ slug: 'desert', x: -7, y: -3, filename: 'desert-x-7-y-3.room.json' }),
  Object.freeze({ slug: 'cave', x: -3, y: -2, filename: 'cave-x-3-y-2.room.json' }),
  Object.freeze({ slug: 'gothic', x: -11, y: 8, filename: 'gothic-x-11-y8.room.json' }),
  Object.freeze({ slug: 'wampos', x: -11, y: 10, filename: 'wampos-x-11-y10.room.json' }),
  Object.freeze({ slug: 'backrooms', x: -11, y: 9, filename: 'backrooms-x-11-y9.room.json' }),
  Object.freeze({ slug: 'cyber', x: -10, y: 10, filename: 'cyber-x-10-y10.room.json' }),
]);

const DEFAULT_CATALOG_FILENAME = 'tilesets.catalog.json';

function sortForStableJson(value) {
  if (Array.isArray(value)) return value.map(sortForStableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortForStableJson(value[key])]),
    );
  }
  return value;
}

export function stableStringify(value, pretty = false) {
  return JSON.stringify(sortForStableJson(value), null, pretty ? 2 : undefined);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function decodeTileValue(encodedValue) {
  if (!Number.isSafeInteger(encodedValue)) {
    throw new Error(`Tile value must be a safe integer; received ${encodedValue}`);
  }
  // Published room snapshots use -1 for empty cells; a few older/local
  // serializers use 0. Both are absence, never a catalog GID.
  if (encodedValue <= 0) {
    return { encodedValue, gid: 0, flipX: false, flipY: false };
  }
  return {
    encodedValue,
    gid: encodedValue & ~FLIP_MASK,
    flipX: Boolean(encodedValue & FLIP_X_FLAG),
    flipY: Boolean(encodedValue & FLIP_Y_FLAG),
  };
}

function normalizeCatalogPayload(payload) {
  const catalog = payload?.catalog ?? payload;
  const tilesets = Array.isArray(catalog) ? catalog : catalog?.tilesets;
  if (!Array.isArray(tilesets) || tilesets.length === 0) {
    throw new Error('Tileset catalog must contain a non-empty tilesets array');
  }

  const normalized = tilesets
    .map((tileset) => {
      const gidStart = Number(tileset?.gidStart);
      const gidEnd = Number(tileset?.gidEnd);
      if (
        typeof tileset?.key !== 'string' ||
        !Number.isSafeInteger(gidStart) ||
        !Number.isSafeInteger(gidEnd) ||
        gidStart < 1 ||
        gidEnd < gidStart
      ) {
        throw new Error(`Invalid tileset catalog entry: ${JSON.stringify(tileset)}`);
      }
      return { ...tileset, gidStart, gidEnd };
    })
    .sort((a, b) => a.gidStart - b.gidStart || a.key.localeCompare(b.key));

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].gidStart <= normalized[index - 1].gidEnd) {
      throw new Error(
        `Overlapping catalog ranges: ${normalized[index - 1].key} and ${normalized[index].key}`,
      );
    }
  }
  return normalized;
}

function normalizeRoomPayload(payload) {
  const snapshot = payload?.snapshot ?? payload;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('Room input must be a room snapshot or a fixture containing snapshot');
  }
  if (typeof snapshot.id !== 'string' || !Number.isSafeInteger(snapshot.version)) {
    throw new Error('Room snapshot is missing a string id or integer version');
  }
  if (!snapshot.tileData || typeof snapshot.tileData !== 'object' || Array.isArray(snapshot.tileData)) {
    throw new Error(`Room ${snapshot.id} v${snapshot.version} is missing tileData`);
  }
  const layerEntries = Object.entries(snapshot.tileData);
  if (layerEntries.length === 0) throw new Error(`Room ${snapshot.id} v${snapshot.version} has no layers`);

  let expectedWidth = null;
  let expectedHeight = null;
  for (const [layerName, rows] of layerEntries) {
    if (!Array.isArray(rows) || rows.length === 0 || rows.some((row) => !Array.isArray(row))) {
      throw new Error(`Layer ${layerName} must be a non-empty rectangular matrix`);
    }
    const width = rows[0].length;
    if (width === 0 || rows.some((row) => row.length !== width)) {
      throw new Error(`Layer ${layerName} must be a non-empty rectangular matrix`);
    }
    for (const row of rows) {
      for (const value of row) decodeTileValue(value);
    }
    expectedWidth ??= width;
    expectedHeight ??= rows.length;
    if (width !== expectedWidth || rows.length !== expectedHeight) {
      throw new Error(`Layer ${layerName} dimensions do not match the other room layers`);
    }
  }
  return snapshot;
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function verifyCommonProvenance(provenance, kind) {
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    throw new Error(`${kind} fixture is missing provenance`);
  }
  if (!isSha256(provenance.sourceSha256)) {
    throw new Error(`${kind} fixture has an invalid raw-response SHA-256`);
  }
  if (typeof provenance.sourceUrl !== 'string' || !isHttpUrl(provenance.sourceUrl)) {
    throw new Error(`${kind} fixture has an invalid source URL`);
  }
  if (typeof provenance.fetchedAt !== 'string' || Number.isNaN(Date.parse(provenance.fetchedAt))) {
    throw new Error(`${kind} fixture has an invalid fetch timestamp`);
  }
}

function verifyRoomFixture(payload) {
  const snapshot = normalizeRoomPayload(payload);
  const provenance = payload?.snapshot ? payload.provenance : null;
  if (payload?.snapshot) {
    if (payload.schemaVersion !== FIXTURE_SCHEMA_VERSION) {
      throw new Error(`Unsupported room fixture schema version: ${payload.schemaVersion}`);
    }
    verifyCommonProvenance(provenance, 'Room');
    if (!isSha256(provenance.snapshotSha256)) {
      throw new Error('Room fixture has an invalid canonical snapshot SHA-256');
    }
    const canonicalHash = sha256(stableStringify(snapshot));
    if (canonicalHash !== provenance.snapshotSha256) {
      throw new Error(
        `Room fixture checksum mismatch for ${snapshot.id}: expected ${provenance.snapshotSha256}, got ${canonicalHash}`,
      );
    }
    if (provenance.roomId !== snapshot.id || provenance.roomVersion !== snapshot.version) {
      throw new Error(`Room fixture provenance does not match ${snapshot.id} v${snapshot.version}`);
    }
  }
  return { snapshot, provenance };
}

function verifyCatalogFixture(payload) {
  const catalogPayload = payload?.catalog ?? payload;
  const tilesets = normalizeCatalogPayload(catalogPayload);
  const provenance = payload?.catalog ? payload.provenance : null;
  if (payload?.catalog) {
    if (payload.schemaVersion !== FIXTURE_SCHEMA_VERSION) {
      throw new Error(`Unsupported catalog fixture schema version: ${payload.schemaVersion}`);
    }
    verifyCommonProvenance(provenance, 'Catalog');
    if (!isSha256(provenance.catalogSha256)) {
      throw new Error('Catalog fixture has an invalid canonical catalog SHA-256');
    }
    const canonicalHash = sha256(stableStringify(catalogPayload));
    if (canonicalHash !== provenance.catalogSha256) {
      throw new Error(
        `Catalog fixture checksum mismatch: expected ${provenance.catalogSha256}, got ${canonicalHash}`,
      );
    }
  }
  return { catalogPayload, tilesets, provenance };
}

function tilesetForGid(gid, tilesets) {
  if (gid <= 0) return null;
  let low = 0;
  let high = tilesets.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = tilesets[middle];
    if (gid < candidate.gidStart) high = middle - 1;
    else if (gid > candidate.gidEnd) low = middle + 1;
    else return candidate;
  }
  return null;
}

export function mapTileValue(encodedValue, tilesets) {
  const decoded = decodeTileValue(encodedValue);
  if (decoded.gid === 0) return { ...decoded, tilesetKey: null, tilesetName: null, localIndex: null };
  const tileset = tilesetForGid(decoded.gid, tilesets);
  return {
    ...decoded,
    tilesetKey: tileset?.key ?? null,
    tilesetName: tileset?.name ?? null,
    localIndex: tileset ? decoded.gid - tileset.gidStart : null,
  };
}

function flipKey(tile) {
  if (tile.flipX && tile.flipY) return 'xy';
  if (tile.flipX) return 'x';
  if (tile.flipY) return 'y';
  return 'none';
}

function tileToken(tile) {
  if (tile.gid === 0) return '.';
  const base = tile.tilesetKey ? `${tile.tilesetKey}:${tile.localIndex}` : `unknown-gid:${tile.gid}`;
  const flips = `${tile.flipX ? 'X' : ''}${tile.flipY ? 'Y' : ''}`;
  return flips ? `${base}:${flips}` : base;
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function sortedCountEntries(map, keyName, limit = null) {
  const values = [...map.entries()]
    .map(([key, count]) => ({ [keyName]: key, count }))
    .sort((a, b) => b.count - a.count || String(a[keyName]).localeCompare(String(b[keyName])));
  return limit === null ? values : values.slice(0, limit);
}

function summarizeTiles(mappedRows, tilesets) {
  const flips = { none: 0, x: 0, y: 0, xy: 0 };
  const signatureCounts = new Map();
  const unknownGids = new Map();
  const byTileset = new Map();
  let occupiedCells = 0;

  for (const row of mappedRows) {
    for (const tile of row) {
      if (tile.gid === 0) continue;
      occupiedCells += 1;
      flips[flipKey(tile)] += 1;
      increment(signatureCounts, tileToken(tile));
      if (!tile.tilesetKey) {
        increment(unknownGids, tile.gid);
        continue;
      }
      let summary = byTileset.get(tile.tilesetKey);
      if (!summary) {
        const catalogEntry = tilesets.find((entry) => entry.key === tile.tilesetKey);
        summary = {
          key: tile.tilesetKey,
          name: tile.tilesetName,
          gidStart: catalogEntry.gidStart,
          gidEnd: catalogEntry.gidEnd,
          count: 0,
          localIndices: new Map(),
        };
        byTileset.set(tile.tilesetKey, summary);
      }
      summary.count += 1;
      let local = summary.localIndices.get(tile.localIndex);
      if (!local) {
        local = { localIndex: tile.localIndex, gid: tile.gid, count: 0, flips: { none: 0, x: 0, y: 0, xy: 0 } };
        summary.localIndices.set(tile.localIndex, local);
      }
      local.count += 1;
      local.flips[flipKey(tile)] += 1;
    }
  }

  const tilesetSummaries = [...byTileset.values()]
    .map((summary) => ({
      ...summary,
      uniqueLocalIndices: summary.localIndices.size,
      localIndices: [...summary.localIndices.values()].sort(
        (a, b) => b.count - a.count || a.localIndex - b.localIndex,
      ),
    }))
    .sort((a, b) => b.count - a.count || a.gidStart - b.gidStart);

  return {
    occupiedCells,
    flips,
    tilesets: tilesetSummaries,
    unknownGids: sortedCountEntries(unknownGids, 'gid'),
    topTileSignatures: sortedCountEntries(signatureCounts, 'signature', 24),
  };
}

function summarizeComponents(mappedRows) {
  const height = mappedRows.length;
  const width = mappedRows[0].length;
  const visited = Array.from({ length: height }, () => Array(width).fill(false));
  const components = [];
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (visited[y][x] || mappedRows[y][x].gid === 0) continue;
      const queue = [[x, y]];
      visited[y][x] = true;
      let cursor = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      const tilesetCounts = new Map();
      const flipCounts = { none: 0, x: 0, y: 0, xy: 0 };

      while (cursor < queue.length) {
        const [currentX, currentY] = queue[cursor];
        cursor += 1;
        const tile = mappedRows[currentY][currentX];
        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);
        increment(tilesetCounts, tile.tilesetKey ?? `unknown-gid:${tile.gid}`);
        flipCounts[flipKey(tile)] += 1;

        for (const [dx, dy] of directions) {
          const nextX = currentX + dx;
          const nextY = currentY + dy;
          if (
            nextX < 0 ||
            nextY < 0 ||
            nextX >= width ||
            nextY >= height ||
            visited[nextY][nextX] ||
            mappedRows[nextY][nextX].gid === 0
          ) {
            continue;
          }
          visited[nextY][nextX] = true;
          queue.push([nextX, nextY]);
        }
      }

      components.push({
        size: queue.length,
        bounds: { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 },
        tilesets: sortedCountEntries(tilesetCounts, 'key'),
        flips: flipCounts,
      });
    }
  }

  components.sort(
    (a, b) =>
      b.size - a.size ||
      a.bounds.minY - b.bounds.minY ||
      a.bounds.minX - b.bounds.minX,
  );
  return { count: components.length, largest: components.slice(0, 16) };
}

function summarizeRuns(mappedRows) {
  const height = mappedRows.length;
  const width = mappedRows[0].length;
  const groups = new Map();

  function addRun(direction, token, length, x, y) {
    const key = `${direction}\u0000${token}\u0000${length}`;
    let group = groups.get(key);
    if (!group) {
      group = { direction, signature: token, length, count: 0, sampleOrigins: [] };
      groups.set(key, group);
    }
    group.count += 1;
    if (group.sampleOrigins.length < 6) group.sampleOrigins.push({ x, y });
  }

  for (let y = 0; y < height; y += 1) {
    let x = 0;
    while (x < width) {
      const token = tileToken(mappedRows[y][x]);
      let end = x + 1;
      while (end < width && tileToken(mappedRows[y][end]) === token) end += 1;
      if (token !== '.' && end - x >= 3) addRun('horizontal', token, end - x, x, y);
      x = end;
    }
  }

  for (let x = 0; x < width; x += 1) {
    let y = 0;
    while (y < height) {
      const token = tileToken(mappedRows[y][x]);
      let end = y + 1;
      while (end < height && tileToken(mappedRows[end][x]) === token) end += 1;
      if (token !== '.' && end - y >= 3) addRun('vertical', token, end - y, x, y);
      y = end;
    }
  }

  return [...groups.values()]
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.length - a.length ||
        a.direction.localeCompare(b.direction) ||
        a.signature.localeCompare(b.signature),
    )
    .slice(0, 32);
}

function summarizePatches(mappedRows, size) {
  const height = mappedRows.length;
  const width = mappedRows[0].length;
  const groups = new Map();
  const minimumOccupied = size === 2 ? 3 : 5;

  for (let y = 0; y <= height - size; y += 1) {
    for (let x = 0; x <= width - size; x += 1) {
      const tokens = [];
      let occupiedCells = 0;
      for (let dy = 0; dy < size; dy += 1) {
        const row = [];
        for (let dx = 0; dx < size; dx += 1) {
          const token = tileToken(mappedRows[y + dy][x + dx]);
          row.push(token);
          if (token !== '.') occupiedCells += 1;
        }
        tokens.push(row);
      }
      if (occupiedCells < minimumOccupied) continue;
      const signature = tokens.map((row) => row.join(',')).join('/');
      let group = groups.get(signature);
      if (!group) {
        group = { size: `${size}x${size}`, signature, occupiedCells, count: 0, sampleOrigins: [] };
        groups.set(signature, group);
      }
      group.count += 1;
      if (group.sampleOrigins.length < 6) group.sampleOrigins.push({ x, y });
    }
  }

  return [...groups.values()]
    .filter((group) => group.count >= 2)
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.occupiedCells - a.occupiedCells ||
        a.signature.localeCompare(b.signature),
    )
    .slice(0, 24);
}

function orderedLayerNames(tileData) {
  const conventional = ['background', 'terrain', 'foreground'];
  const names = Object.keys(tileData);
  return [
    ...conventional.filter((name) => names.includes(name)),
    ...names.filter((name) => !conventional.includes(name)).sort(),
  ];
}

function roomMetadata(snapshot) {
  const metadataKeys = [
    'id',
    'coordinates',
    'title',
    'version',
    'status',
    'createdAt',
    'updatedAt',
    'publishedAt',
    'background',
    'music',
    'weather',
    'lighting',
    'goal',
    'goalIntroText',
    'spawnPoint',
  ];
  return Object.fromEntries(
    metadataKeys.filter((key) => snapshot[key] !== undefined).map((key) => [key, snapshot[key]]),
  );
}

export function analyzeRoomSnapshot(snapshotInput, catalogInput, source = {}) {
  const snapshot = normalizeRoomPayload(snapshotInput);
  const tilesets = normalizeCatalogPayload(catalogInput);
  const layerNames = orderedLayerNames(snapshot.tileData);
  const layers = layerNames.map((name) => {
    const rows = snapshot.tileData[name];
    const mappedRows = rows.map((row) => row.map((value) => mapTileValue(value, tilesets)));
    const tileSummary = summarizeTiles(mappedRows, tilesets);
    return {
      name,
      width: rows[0].length,
      height: rows.length,
      cellCount: rows.length * rows[0].length,
      ...tileSummary,
      emptyCells: rows.length * rows[0].length - tileSummary.occupiedCells,
      components: summarizeComponents(mappedRows),
      repeatedPatterns: {
        exactRuns: summarizeRuns(mappedRows),
        patches2x2: summarizePatches(mappedRows, 2),
        patches3x3: summarizePatches(mappedRows, 3),
      },
    };
  });

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    source,
    room: roomMetadata(snapshot),
    tilesetHint: snapshot.tilesetHint ?? null,
    placedObjectCount: Array.isArray(snapshot.placedObjects) ? snapshot.placedObjects.length : 0,
    customTileCount: Array.isArray(snapshot.customTiles) ? snapshot.customTiles.length : 0,
    catalog: {
      tilesetCount: tilesets.length,
      gidRange: { start: tilesets[0].gidStart, end: tilesets.at(-1).gidEnd },
    },
    layers,
    totals: {
      layerCount: layers.length,
      occupiedCells: layers.reduce((sum, layer) => sum + layer.occupiedCells, 0),
      connectedComponents: layers.reduce((sum, layer) => sum + layer.components.count, 0),
    },
  };
}

function publishedRoomUrl({ x, y }) {
  const id = encodeURIComponent(`${x},${y}`);
  return `https://api.wamp.land/api/rooms/${id}/published?x=${x}&y=${y}`;
}

function normalizeRoomUrl(rawUrl) {
  const url = new URL(rawUrl);
  const pageMatch = url.hostname === 'wamp.land' && url.pathname.match(/^\/r\/(-?\d+)\/(-?\d+)\/?$/);
  if (pageMatch) return publishedRoomUrl({ x: Number(pageMatch[1]), y: Number(pageMatch[2]) });
  return url.href;
}

async function fetchJsonWithProvenance(rawUrl) {
  const url = normalizeRoomUrl(rawUrl);
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  const rawBytes = Buffer.from(await response.arrayBuffer());
  let payload;
  try {
    payload = JSON.parse(rawBytes.toString('utf8'));
  } catch {
    throw new Error(`GET ${url} did not return valid JSON`);
  }
  return {
    url,
    payload,
    sourceSha256: sha256(rawBytes),
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
  };
}

async function readJsonFile(filename) {
  let contents;
  try {
    contents = await readFile(filename, 'utf8');
  } catch (error) {
    throw new Error(`Could not read ${filename}: ${error.message}`);
  }
  try {
    return JSON.parse(contents);
  } catch {
    throw new Error(`Could not parse JSON from ${filename}`);
  }
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

async function loadCatalog(input) {
  if (isHttpUrl(input)) {
    const fetched = await fetchJsonWithProvenance(input);
    const verified = verifyCatalogFixture(fetched.payload);
    return {
      ...verified,
      source: { kind: 'url', url: fetched.url, sourceSha256: fetched.sourceSha256 },
    };
  }
  const resolvedPath = path.resolve(input);
  const payload = await readJsonFile(resolvedPath);
  const verified = verifyCatalogFixture(payload);
  return {
    ...verified,
    source: {
      kind: 'fixture',
      path: resolvedPath,
      provenance: verified.provenance,
    },
  };
}

async function loadRoom(input, kind) {
  if (kind === 'url') {
    const fetched = await fetchJsonWithProvenance(input);
    const verified = verifyRoomFixture(fetched.payload);
    return {
      ...verified,
      source: { kind: 'url', url: fetched.url, sourceSha256: fetched.sourceSha256 },
    };
  }
  const resolvedPath = path.resolve(input);
  const payload = await readJsonFile(resolvedPath);
  const verified = verifyRoomFixture(payload);
  return {
    ...verified,
    source: {
      kind: 'fixture',
      path: resolvedPath,
      provenance: verified.provenance,
    },
  };
}

function collectUsedTilesets(rooms, tilesets) {
  const used = new Map();
  for (const room of rooms) {
    for (const rows of Object.values(room.snapshot.tileData)) {
      for (const row of rows) {
        for (const encodedValue of row) {
          const tile = mapTileValue(encodedValue, tilesets);
          if (tile.gid === 0) continue;
          if (!tile.tilesetKey) {
            throw new Error(
              `Cannot render room ${room.snapshot.id}: GID ${tile.gid} is not in the frozen catalog`,
            );
          }
          used.set(tile.tilesetKey, tilesetForGid(tile.gid, tilesets));
        }
      }
    }
  }
  return used;
}

async function loadLocalTilesetAtlases(rooms, tilesets, atlasDir) {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch (error) {
    throw new Error(`Could not load sharp for PNG rendering: ${error.message}`);
  }

  const atlases = new Map();
  const usedTilesets = collectUsedTilesets(rooms, tilesets);
  for (const [key, tileset] of usedTilesets) {
    const atlasSpec = LOCAL_TILESET_ATLASES[key];
    if (!atlasSpec) {
      throw new Error(`No local tileset atlas is configured for catalog key ${JSON.stringify(key)}`);
    }
    const catalogTileCount = tileset.gidEnd - tileset.gidStart + 1;
    if (catalogTileCount > atlasSpec.columns * atlasSpec.rows) {
      throw new Error(
        `Local atlas ${atlasSpec.filename} cannot cover ${key} catalog range ${tileset.gidStart}-${tileset.gidEnd}`,
      );
    }

    const filename = path.join(atlasDir, atlasSpec.filename);
    let decoded;
    try {
      decoded = await sharp(filename).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    } catch (error) {
      throw new Error(`Could not decode local tileset atlas ${filename}: ${error.message}`);
    }
    const expectedWidth = atlasSpec.columns * TILE_SIZE;
    const expectedHeight = atlasSpec.rows * TILE_SIZE;
    if (
      decoded.info.width !== expectedWidth ||
      decoded.info.height !== expectedHeight ||
      decoded.info.channels !== 4
    ) {
      throw new Error(
        `Local atlas ${filename} must decode to ${expectedWidth}x${expectedHeight} RGBA; received ${decoded.info.width}x${decoded.info.height} with ${decoded.info.channels} channels`,
      );
    }
    atlases.set(key, {
      ...atlasSpec,
      filename,
      width: decoded.info.width,
      pixels: decoded.data,
    });
  }
  return { atlases, sharp };
}

function blitAtlasTile(target, targetWidth, tileX, tileY, atlas, tile) {
  const sourceLeft = (tile.localIndex % atlas.columns) * TILE_SIZE;
  const sourceTop = Math.floor(tile.localIndex / atlas.columns) * TILE_SIZE;
  for (let pixelY = 0; pixelY < TILE_SIZE; pixelY += 1) {
    const sourceY = sourceTop + (tile.flipY ? TILE_SIZE - 1 - pixelY : pixelY);
    const targetY = tileY * TILE_SIZE + pixelY;
    for (let pixelX = 0; pixelX < TILE_SIZE; pixelX += 1) {
      const sourceX = sourceLeft + (tile.flipX ? TILE_SIZE - 1 - pixelX : pixelX);
      const targetX = tileX * TILE_SIZE + pixelX;
      const sourceOffset = (sourceY * atlas.width + sourceX) * 4;
      const targetOffset = (targetY * targetWidth + targetX) * 4;
      target[targetOffset] = atlas.pixels[sourceOffset];
      target[targetOffset + 1] = atlas.pixels[sourceOffset + 1];
      target[targetOffset + 2] = atlas.pixels[sourceOffset + 2];
      target[targetOffset + 3] = atlas.pixels[sourceOffset + 3];
    }
  }
}

function renderLayerPixels(rows, tilesets, atlases) {
  const width = rows[0].length;
  const height = rows.length;
  const widthPixels = width * TILE_SIZE;
  const pixels = Buffer.alloc(widthPixels * height * TILE_SIZE * 4);
  for (let tileY = 0; tileY < height; tileY += 1) {
    for (let tileX = 0; tileX < width; tileX += 1) {
      const tile = mapTileValue(rows[tileY][tileX], tilesets);
      if (tile.gid === 0) continue;
      const atlas = atlases.get(tile.tilesetKey);
      if (!atlas || tile.localIndex < 0 || tile.localIndex >= atlas.columns * atlas.rows) {
        throw new Error(`Cannot render GID ${tile.gid} from tileset ${tile.tilesetKey}`);
      }
      blitAtlasTile(pixels, widthPixels, tileX, tileY, atlas, tile);
    }
  }
  return { pixels, width: widthPixels, height: height * TILE_SIZE };
}

function renderFileStem(room, index) {
  const sourcePath = room.source?.kind === 'fixture' ? room.source.path : null;
  const rawStem = sourcePath
    ? path.basename(sourcePath).replace(/(?:\.room)?\.json$/i, '')
    : `room-${room.snapshot.id || index + 1}`;
  const safeStem = rawStem.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
  return safeStem || `room-${index + 1}`;
}

export async function renderRoomLayers(
  roomInputs,
  catalogInput,
  renderDir,
  atlasDir = DEFAULT_TILESET_ATLAS_DIR,
) {
  const rooms = roomInputs.map((room) => ({
    snapshot: normalizeRoomPayload(room.snapshot ?? room),
    source: room.source ?? null,
  }));
  const tilesets = normalizeCatalogPayload(catalogInput);
  const resolvedRenderDir = path.resolve(renderDir);
  const resolvedAtlasDir = path.resolve(atlasDir);
  const { atlases, sharp } = await loadLocalTilesetAtlases(rooms, tilesets, resolvedAtlasDir);
  const preparedRooms = rooms.map((room, index) => {
    const stem = renderFileStem(room, index);
    const layers = orderedLayerNames(room.snapshot.tileData).map((name) => ({
      name,
      ...renderLayerPixels(room.snapshot.tileData[name], tilesets, atlases),
    }));
    return { room, stem, layers };
  });

  await mkdir(resolvedRenderDir, { recursive: true });
  const manifests = [];
  for (const prepared of preparedRooms) {
    const files = [];
    for (const layer of prepared.layers) {
      const filename = path.join(resolvedRenderDir, `${prepared.stem}.${layer.name}.png`);
      const png = await sharp(layer.pixels, {
        raw: { width: layer.width, height: layer.height, channels: 4 },
      }).png().toBuffer();
      await writeFile(filename, png);
      files.push({ kind: 'layer', layer: layer.name, filename });
    }
    const { width, height } = prepared.layers[0];
    const compositeFilename = path.join(resolvedRenderDir, `${prepared.stem}.composite.png`);
    const compositePng = await sharp({
      create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite(
        prepared.layers.map((layer) => ({
          input: layer.pixels,
          raw: { width, height, channels: 4 },
        })),
      )
      .png()
      .toBuffer();
    await writeFile(compositeFilename, compositePng);
    files.push({ kind: 'composite', filename: compositeFilename });
    manifests.push({
      roomId: prepared.room.snapshot.id,
      width,
      height,
      files,
    });
  }
  return { renderDir: resolvedRenderDir, rooms: manifests };
}

export async function refreshReferenceFixtures(fixtureDir = DEFAULT_FIXTURE_DIR) {
  const catalogUrl = 'https://api.wamp.land/api/tilesets';
  const [catalogFetch, ...roomFetches] = await Promise.all([
    fetchJsonWithProvenance(catalogUrl),
    ...REFERENCE_ROOMS.map((reference) => fetchJsonWithProvenance(publishedRoomUrl(reference))),
  ]);

  const catalogPayload = catalogFetch.payload;
  normalizeCatalogPayload(catalogPayload);
  const roomSnapshots = roomFetches.map((result, index) => {
    const snapshot = normalizeRoomPayload(result.payload);
    const reference = REFERENCE_ROOMS[index];
    const expectedId = `${reference.x},${reference.y}`;
    if (snapshot.id !== expectedId) {
      throw new Error(`Expected ${expectedId} from ${result.url}; received ${snapshot.id}`);
    }
    return snapshot;
  });

  const fetchedAt = new Date().toISOString();
  const catalogFixture = {
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    provenance: {
      sourceUrl: catalogFetch.url,
      fetchedAt,
      sourceSha256: catalogFetch.sourceSha256,
      catalogSha256: sha256(stableStringify(catalogPayload)),
      ...(catalogFetch.etag ? { etag: catalogFetch.etag } : {}),
      ...(catalogFetch.lastModified ? { lastModified: catalogFetch.lastModified } : {}),
    },
    catalog: catalogPayload,
  };
  const roomFixtures = roomSnapshots.map((snapshot, index) => {
    const fetched = roomFetches[index];
    return {
      schemaVersion: FIXTURE_SCHEMA_VERSION,
      provenance: {
        sourceUrl: fetched.url,
        fetchedAt,
        sourceSha256: fetched.sourceSha256,
        snapshotSha256: sha256(stableStringify(snapshot)),
        roomId: snapshot.id,
        roomVersion: snapshot.version,
        ...(fetched.etag ? { etag: fetched.etag } : {}),
        ...(fetched.lastModified ? { lastModified: fetched.lastModified } : {}),
      },
      snapshot,
    };
  });

  verifyCatalogFixture(catalogFixture);
  roomFixtures.forEach(verifyRoomFixture);
  await mkdir(fixtureDir, { recursive: true });
  const writes = [
    {
      filename: path.join(fixtureDir, DEFAULT_CATALOG_FILENAME),
      value: catalogFixture,
    },
    ...REFERENCE_ROOMS.map((reference, index) => ({
      filename: path.join(fixtureDir, reference.filename),
      value: roomFixtures[index],
    })),
  ];
  await Promise.all(
    writes.map(({ filename, value }) => writeFile(filename, `${stableStringify(value, true)}\n`, 'utf8')),
  );
  return {
    fixtureDir,
    catalog: {
      filename: DEFAULT_CATALOG_FILENAME,
      sourceSha256: catalogFixture.provenance.sourceSha256,
      catalogSha256: catalogFixture.provenance.catalogSha256,
    },
    rooms: roomFixtures.map((fixture, index) => ({
      slug: REFERENCE_ROOMS[index].slug,
      filename: REFERENCE_ROOMS[index].filename,
      id: fixture.snapshot.id,
      title: fixture.snapshot.title,
      version: fixture.snapshot.version,
      publishedAt: fixture.snapshot.publishedAt,
      sourceSha256: fixture.provenance.sourceSha256,
      snapshotSha256: fixture.provenance.snapshotSha256,
    })),
  };
}

function usage() {
  return `Usage:
  node scripts/analyze_smart_tile_reference.mjs [--all]
  node scripts/analyze_smart_tile_reference.mjs --fixture <room-fixture.json>
  node scripts/analyze_smart_tile_reference.mjs --url <published-room-api-or-wamp-room-url>
  node scripts/analyze_smart_tile_reference.mjs --refresh

Options:
  --catalog <path-or-url>  Catalog fixture/input (defaults to the frozen catalog)
  --fixture-dir <path>    Frozen fixture directory
  --output <path>         Write the JSON report instead of printing it
  --render-dir <path>     Write native-resolution layer and composite PNGs
  --refresh               Explicitly fetch and replace all frozen references
  --help                  Show this help

Normal --all/--fixture analysis is offline and read-only. Network access occurs only
with --url, a URL passed to --catalog, or --refresh. Files are written only with
--output, --render-dir, or --refresh.`;
}

function parseArgs(argv) {
  const options = {
    all: false,
    fixture: null,
    url: null,
    catalog: null,
    fixtureDir: DEFAULT_FIXTURE_DIR,
    output: null,
    renderDir: null,
    refresh: false,
    help: false,
  };
  const valueFlags = new Set([
    '--fixture',
    '--url',
    '--catalog',
    '--fixture-dir',
    '--output',
    '--render-dir',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (valueFlags.has(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
      const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      options[key] = value;
      index += 1;
    } else if (argument === '--all') options.all = true;
    else if (argument === '--refresh') options.refresh = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  const modes = [options.all, Boolean(options.fixture), Boolean(options.url), options.refresh].filter(Boolean);
  if (modes.length > 1) throw new Error('Choose only one of --all, --fixture, --url, or --refresh');
  if (options.refresh && (options.output || options.renderDir)) {
    throw new Error('--refresh writes fixtures and cannot use --output or --render-dir');
  }
  return options;
}

async function writeOrPrint(value, output) {
  const serialized = `${stableStringify(value, true)}\n`;
  if (!output) {
    process.stdout.write(serialized);
    return;
  }
  const outputPath = path.resolve(output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, 'utf8');
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const fixtureDir = path.resolve(options.fixtureDir);
  if (options.refresh) {
    await writeOrPrint(await refreshReferenceFixtures(fixtureDir), null);
    return;
  }

  const catalogInput = options.catalog ?? path.join(fixtureDir, DEFAULT_CATALOG_FILENAME);
  const catalog = await loadCatalog(catalogInput);
  let rooms;
  if (options.fixture) rooms = [await loadRoom(options.fixture, 'fixture')];
  else if (options.url) rooms = [await loadRoom(options.url, 'url')];
  else {
    rooms = await Promise.all(
      REFERENCE_ROOMS.map((reference) =>
        loadRoom(path.join(fixtureDir, reference.filename), 'fixture'),
      ),
    );
  }

  const reports = rooms.map((room) =>
    analyzeRoomSnapshot(room.snapshot, catalog.catalogPayload, {
      room: room.source,
      catalog: catalog.source,
    }),
  );
  if (options.renderDir) {
    await renderRoomLayers(rooms, catalog.catalogPayload, options.renderDir);
  }
  await writeOrPrint(
    reports.length === 1
      ? reports[0]
      : {
          schemaVersion: REPORT_SCHEMA_VERSION,
          fixtureSet: fixtureDir,
          roomCount: reports.length,
          rooms: reports,
        },
    options.output,
  );
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
