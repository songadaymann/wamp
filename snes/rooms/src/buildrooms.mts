// SNESWAMP room authoring: builds genuine WAMP RoomSnapshot JSON for the milestone-1 world and
// the engine test rooms, using the repo's own TypeScript (roomModel, commandCore, smart autotiler,
// validators).  Not part of `make`; the JSON it writes is checked in.
//
//   WAMP_SRC=<scratch copy of /home/user/wamp/src> npx --yes tsx buildrooms.mts <snes/rooms dir>
//   (see build.sh, which prepares the scratch copy and runs this)
//
// Output: <dir>/world/<x>,<y>.json (world rooms), <dir>/test_*.json (test rooms), <dir>/world.json.
//
// Rooms are authored on a 40x22 character grid (see class Grid): terrain masks are autotiled with
// the repo's smart brush (forest, desert) or with the small 9-slice tiler below (snow, lava, water:
// those tilesets have no solid smart brush); special tiles, objects, spawn and goal are applied
// through the agent command API so every snapshot passes validateRoomSnapshotForWrite and the
// publish validator.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORLD_ROOMS, TEST_ROOMS, START_ROOM } from './roomdefs.mts';
import type { RoomDef } from './roomdefs.mts';

const R = process.env.WAMP_SRC;
if (!R) throw new Error('set WAMP_SRC to a scratch copy of the WAMP src/ directory (see build.sh)');
const OUT = process.argv[2];
if (!OUT) throw new Error('usage: buildrooms.mts <snes/rooms dir>');

const { createDefaultRoomSnapshot, cloneRoomSnapshot, getRoomPublishValidationError } =
  await import(`${R}/persistence/roomModel`);
const { createRoomSmartTerrainState } = await import(`${R}/autotiling/model`);
const { applyRegisteredSmartBrushCells } = await import(`${R}/autotiling/brushEngine`);
const { applyRoomDraftCommands, normalizeRoomDraftCommandsRequestBody } =
  await import(`${R}/cloudflare/worker/rooms/commandCore`);
const { validateRoomSnapshotForWrite } = await import(`${R}/cloudflare/worker/core/http`);
const { getTerrainCollisionProfileForGid, getTilesetByKey } = await import(`${R}/config.ts`);

const W = 40;
const H = 22;

// ---- legend -------------------------------------------------------------------------------
const SPECIAL: Record<string, number> = {   // char -> local index in the `special` tileset
  '=': 1, '<': 3, '>': 4, 'I': 5, 'B': 7, 'x': 8, 'C': 18,
};
const SOLID_SPECIAL = new Set(['<', '>', 'I', 'B', 'C']);
const OBJECTS: Record<string, string> = {
  'o': 'coin_gold', 's': 'coin_silver', 'g': 'gem', 'h': 'heart', 'k': 'key', '*': 'star',
  '^': 'spikes', 'S': 'saw', 'f': 'fire', 'P': 'bounce_pad', 'H': 'ladder', 'F': 'checkpoint_flag',
  'D': 'door_locked', '1': 'slime_blue', '2': 'slime_red', 'b': 'bat', 'c': 'crab', 'r': 'frog',
};

// ---- 9-slice tiler for the tilesets without a solid smart brush ---------------------------------
interface Slice {
  tl: number; t: number[]; tr: number; l: number; r: number; c: number[];
  bl: number; b: number[]; br: number; innerUL: number; innerUR: number;
  thinL: number; thinM: number; thinR: number; single: number;
}
const SLICES: Record<string, Slice> = {
  snow: { tl: 23, t: [14], tr: 27, l: 34, r: 38, c: [36, 36, 36, 35, 37, 36, 25], bl: 45, b: [46, 47, 48], br: 49,
    innerUL: 24, innerUR: 26, thinL: 40, thinM: 41, thinR: 42, single: 18 },
  lava: { tl: 31, t: [18], tr: 35, l: 46, r: 50, c: [48, 48, 48, 47, 49, 48, 33], bl: 61, b: [62, 63, 64], br: 65,
    innerUL: 32, innerUR: 34, thinL: 26, thinM: 27, thinR: 28, single: 24 },
  water: { tl: 14, t: [15, 16], tr: 17, l: 37, r: 42, c: [40, 40, 40, 27, 28, 38, 39, 41, 40], bl: 49, b: [50, 51, 52, 53], br: 54,
    innerUL: 26, innerUR: 29, thinL: 44, thinM: 45, thinR: 46, single: 20 },
};

function hash(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
const pick = (list: number[], x: number, y: number, salt: number) => list[hash(x, y, salt) % list.length];

function sliceTile(s: Slice, m: (x: number, y: number) => boolean, x: number, y: number): number {
  const U = m(x, y - 1), D = m(x, y + 1), L = m(x - 1, y), Rr = m(x + 1, y);
  if (!U && !D) {
    if (L && Rr) return s.thinM;
    if (!L && Rr) return s.thinL;
    if (L && !Rr) return s.thinR;
    return s.single;
  }
  if (!U) return !L ? s.tl : !Rr ? s.tr : pick(s.t, x, y, 1);
  if (!D) return !L ? s.bl : !Rr ? s.br : pick(s.b, x, y, 2);
  if (!L) return s.l;
  if (!Rr) return s.r;
  if (!m(x - 1, y - 1)) return s.innerUL;
  if (!m(x + 1, y - 1)) return s.innerUR;
  return pick(s.c, x, y, 3);
}

// ---- build one room ---------------------------------------------------------------------------
type TileWrite = { tileX: number; tileY: number; localIndex: number; flipX: boolean; flipY: boolean };

function buildRoom(def: RoomDef) {
  const g = def.grid;
  const id = `${def.x},${def.y}`;
  let room = createDefaultRoomSnapshot(id, { x: def.x, y: def.y });
  room.smartTerrain = createRoomSmartTerrainState();
  room.smartTerrain.detailsEnabled = def.details ?? true;

  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? '#' : g.cells[y][x]);
  // mask of themed solid terrain; solid special tiles embedded in the ground join the mask so the
  // autotiler does not draw an edge under/around them (they are overwritten below)
  const embedded = (x: number, y: number) => SOLID_SPECIAL.has(at(x, y)) && at(x, y) !== 'C' && at(x, y + 1) === '#';
  const inMask = (x: number, y: number) =>
    x < 0 || y < 0 || x >= W || y >= H ? true : at(x, y) === '#' || embedded(x, y);

  const commands: unknown[] = [];
  const setTiles = (tilesetKey: string, layer: string, tiles: TileWrite[]) => {
    if (tiles.length) commands.push({ type: 'set_tiles', tilesetKey, layer, tiles });
  };
  const tw = (x: number, y: number, localIndex: number, flipX = false): TileWrite =>
    ({ tileX: x, tileY: y, localIndex, flipX, flipY: false });

  // 1. themed terrain
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (inMask(x, y)) cells.push({ x, y });
  if (def.theme === 'forest' || def.theme === 'desert') {
    if (cells.length) {
      const doc = applyRegisteredSmartBrushCells(
        { tileData: room.tileData, smartTerrain: room.smartTerrain },
        { cells, mode: 'paint', brushId: `${def.theme}.ground`, styleId: def.theme, layer: 'terrain' },
      );
      room.tileData = doc.tileData;
      room.smartTerrain = doc.smartTerrain;
    }
  } else {
    const slice = SLICES[def.theme];
    if (!slice) throw new Error(`${id}: unknown theme ${def.theme}`);
    const ts = getTilesetByKey(def.theme);
    const tiles = cells.map(({ x, y }) => {
      const localIndex = sliceTile(slice, inMask, x, y);
      if (!getTerrainCollisionProfileForGid(ts.firstGid + localIndex).hasCollision) {
        throw new Error(`${def.theme} local ${localIndex} is not solid`);
      }
      return tw(x, y, localIndex);
    });
    setTiles(def.theme, 'terrain', tiles);
  }

  // 2. special tiles (terrain layer), extra tile stamps, water (background layer)
  const special: TileWrite[] = [];
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const ch = g.cells[y][x];
    if (ch in SPECIAL) special.push(tw(x, y, SPECIAL[ch]));
  }
  setTiles('special', 'terrain', special);
  const water: TileWrite[] = [];
  for (const [x1, y1, x2, y2] of g.waterRects) {
    for (let y = y1; y <= y2; y += 1) for (let x = x1; x <= x2; x += 1) {
      const ch = g.cells[y][x];
      if (ch !== '#' && !SOLID_SPECIAL.has(ch)) water.push(tw(x, y, 13));
    }
  }
  setTiles('special', 'background', water);
  const waterCells = new Set(water.map((t) => `${t.tileX},${t.tileY}`));
  const byKey = new Map<string, TileWrite[]>();
  for (const s of g.stamps) {
    if (s.layer === 'background' && waterCells.has(`${s.x},${s.y}`)) continue;   // water owns the cell
    const key = `${s.tileset}|${s.layer}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(tw(s.x, s.y, s.index, s.flipX ?? false));
  }
  for (const [key, tiles] of byKey) {
    const [tileset, layer] = key.split('|');
    setTiles(tileset, layer, tiles);
  }

  // 3. title, background, spawn, objects, goal
  commands.push({ type: 'set_title', title: def.title });
  commands.push({ type: 'set_background', background: def.background });
  let spawn: [number, number] | null = null;
  let exit: [number, number] | null = null;
  const cps: ([number, number] | null)[] = [null, null, null];
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const ch = g.cells[y][x];
    if (ch === '@') spawn = [x, y];
    else if (ch === 'E') exit = [x, y];
    else if (ch === '7' || ch === '8' || ch === '9') cps[Number(ch) - 7] = [x, y];
    else if (ch in OBJECTS) {
      const cmd: Record<string, unknown> = { type: 'place_object', objectId: OBJECTS[ch], tileX: x, tileY: y };
      const opt = g.objOpts.get(`${x},${y}`);
      if (opt?.facing) cmd.facing = opt.facing;
      if (opt?.layer) cmd.layer = opt.layer;
      commands.push(cmd);
    } else if (ch !== '.' && ch !== '#' && !(ch in SPECIAL)) {
      throw new Error(`${id}: unknown cell char '${ch}' at ${x},${y}`);
    }
  }
  if (spawn) commands.push({ type: 'set_spawn', tileX: spawn[0], tileY: spawn[1] });
  const pt = (p: [number, number]) => ({ tileX: p[0], tileY: p[1] });
  const timeLimitMs = def.goal && 'timeLimitS' in def.goal && def.goal.timeLimitS ? def.goal.timeLimitS * 1000 : null;
  if (def.goal) {
    if (def.goal.type === 'exit') {
      if (!exit) throw new Error(`${id}: reach_exit needs an E cell`);
      commands.push({ type: 'set_goal', goal: { type: 'reach_exit', exit: pt(exit), timeLimitMs } });
    } else if (def.goal.type === 'collect') {
      commands.push({ type: 'set_goal', goal: { type: 'collect_target', requiredCount: def.goal.count, timeLimitMs } });
    } else if (def.goal.type === 'defeat') {
      commands.push({ type: 'set_goal', goal: { type: 'defeat_all', timeLimitMs } });
    } else if (def.goal.type === 'sprint') {
      const list = cps.filter((p): p is [number, number] => p !== null);
      if (!exit || !list.length) throw new Error(`${id}: sprint needs 7/8/9 and E cells`);
      commands.push({ type: 'set_goal', goal: { type: 'checkpoint_sprint', checkpoints: list.map(pt), finish: pt(exit), timeLimitMs } });
    }
  }

  const body = normalizeRoomDraftCommandsRequestBody({ base: 'current_draft', commands });
  room = applyRoomDraftCommands(room, body.commands).snapshot;
  room.pitsAreDeadly = def.pitsAreDeadly ?? false;
  room.playerHearts = def.hearts ?? 1;

  // deterministic bookkeeping so the checked-in JSON only changes when the room does
  room.placedObjects.forEach((o: { instanceId: string }, i: number) => {
    const hx = (n: number) => hash(i, def.x * 131 + def.y, n).toString(16).padStart(8, '0');
    o.instanceId = `obj_${hx(1)}-${hx(2).slice(0, 4)}-4${hx(3).slice(0, 3)}-a${hx(4).slice(0, 3)}-${hx(5)}${hx(6).slice(0, 4)}`;
  });
  room.createdAt = room.updatedAt = '2026-01-01T00:00:00.000Z';

  validateRoomSnapshotForWrite(room, id);
  const publishError = getRoomPublishValidationError(room);
  if (publishError) throw new Error(`${id} (${def.title}): ${publishError}`);
  room = cloneRoomSnapshot(room);
  validateRoomSnapshotForWrite(room, id);
  return room;
}

function stringify(room: unknown): string {
  // one line per tile row / small array, readable diffs
  return JSON.stringify(room, null, 1)
    .replace(/\[\s+((?:-?\d+,\s+)*-?\d+)\s+\]/g, (_m, inner: string) => `[${inner.replace(/\s+/g, '')}]`) + '\n';
}

mkdirSync(join(OUT, 'world'), { recursive: true });
const manifest: { start: string; rooms: { file: string; x: number; y: number }[] } = { start: '', rooms: [] };
for (const def of WORLD_ROOMS) {
  const file = `world/${def.x},${def.y}.json`;
  writeFileSync(join(OUT, file), stringify(buildRoom(def)));
  manifest.rooms.push({ file, x: def.x, y: def.y });
  if (def.x === START_ROOM[0] && def.y === START_ROOM[1]) manifest.start = file;
}
for (const def of TEST_ROOMS) {
  const file = `${def.name}.json`;
  writeFileSync(join(OUT, file), stringify(buildRoom(def)));
  manifest.rooms.push({ file, x: def.x, y: def.y });
}
if (!manifest.start) throw new Error('start room missing');
writeFileSync(join(OUT, 'world.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log(`wrote ${manifest.rooms.length} rooms to ${OUT}`);
