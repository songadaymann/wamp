// Room definitions for buildrooms.mts: the 12-room milestone-1 world and the engine test rooms.
// Pure data + a tiny grid DSL (no WAMP imports).
//
// Grid cell characters (one per 16x16 tile, 40x22):
//   .  empty            #  themed solid terrain (autotiled)
//   =  one-way (670)    <  >  conveyors (672/673)    I  ice (674)    B  bounce (676)
//   x  damage (677)     C  crumbling (687)           water (682) is added with g.water(rect)
//   o coin_gold  s coin_silver  g gem  h heart  k key  * star
//   ^ spikes  S saw  f fire  P bounce_pad  H ladder  F checkpoint_flag  D door_locked
//   1 slime_blue  2 slime_red  b bat  c crab  r frog
//   @ spawn  E exit / sprint finish  7 8 9 sprint checkpoints 1..3
// Objects are placed like the WAMP editor does: the sprite frame is left/bottom aligned to the cell.
//
// World layout (y grows downward, like WAMP); see snes/README or docs for the map:
//   y=-1                                  (2,-1) (3,-1)
//   y= 0   (-2,0) (-1,0) (0,0) (1,0) (2,0) (3,0)
//   y= 1                 (0,1) (1,1) (2,1) (3,1)
// Seam conventions (checked by tests/test_rooms.py):
//   outdoor seams: ground top at row 18, rows 0..17 open;  tunnel seams: rows 14..17 open;
//   floor enemies are fenced in so that none can get within 3 tiles of an open seam (a player
//   walking into a room is never hit on the first frame): 16 px curbs or pits for slimes and crabs,
//   48 px walls for frogs (a frog hop peaks at 39 px, so it clears 2-tile steps);
//   vertical links are "hatches": one-way tiles in row 21 of the upper room over an open row 0 of
//   the lower room, with a ladder top / block at y = 16 below so a normal jump (apex 53 px) carries
//   the player through and onto the one-way tiles; down+jump drops back.

export type Layer = 'background' | 'terrain' | 'foreground';
export type Theme = 'forest' | 'desert' | 'snow' | 'lava' | 'water';
export type GoalDef =
  | { type: 'exit'; timeLimitS?: number }
  | { type: 'collect'; count: number; timeLimitS?: number }
  | { type: 'defeat'; timeLimitS?: number }
  | { type: 'sprint'; timeLimitS?: number };

const W = 40;
const H = 22;

function hash(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export class Grid {
  cells: string[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => '.'));
  waterRects: [number, number, number, number][] = [];
  stamps: { tileset: string; layer: Layer; index: number; x: number; y: number; flipX?: boolean }[] = [];
  objOpts = new Map<string, { facing?: 'left' | 'right'; layer?: Layer }>();

  fill(ch: string, x1: number, y1: number, x2: number, y2: number) {
    if (x1 < 0 || y1 < 0 || x2 >= W || y2 >= H || x2 < x1 || y2 < y1) throw new Error(`bad rect ${x1},${y1},${x2},${y2}`);
    for (let y = y1; y <= y2; y += 1) for (let x = x1; x <= x2; x += 1) this.cells[y][x] = ch;
    return this;
  }
  clear(x1: number, y1: number, x2: number, y2: number) { return this.fill('.', x1, y1, x2, y2); }
  row(ch: string, y: number, x1: number, x2: number) { return this.fill(ch, x1, y, x2, y); }
  col(ch: string, x: number, y1: number, y2: number) { return this.fill(ch, x, y1, x, y2); }
  put(ch: string, ...pts: [number, number][]) {
    for (const [x, y] of pts) this.fill(ch, x, y, x, y);
    return this;
  }
  opt(x: number, y: number, o: { facing?: 'left' | 'right'; layer?: Layer }) { this.objOpts.set(`${x},${y}`, o); return this; }
  water(x1: number, y1: number, x2: number, y2: number) { this.waterRects.push([x1, y1, x2, y2]); return this; }

  solid(x: number, y: number) {
    if (x < 0 || y < 0 || x >= W || y >= H) return true;
    return '#<>IBC'.includes(this.cells[y][x]);
  }
  free(x: number, y: number) { return x >= 0 && y >= 0 && x < W && y < H && this.cells[y][x] === '.'; }
  stamp(tileset: string, layer: Layer, index: number, x: number, y: number, flipX = false, force = false) {
    if (x < 0 || y < 0 || x >= W || y >= H) return this;
    if (!force && layer === 'background' && this.cells[y][x] === '#') return this;   // hidden behind terrain
    this.stamps = this.stamps.filter((s) => !(s.layer === layer && s.x === x && s.y === y));
    this.stamps.push({ tileset, layer, index, x, y, flipX });
    return this;
  }
  stamped(layer: Layer, x: number, y: number) { return this.stamps.some((s) => s.layer === layer && s.x === x && s.y === y); }
  /** decorate free cells standing on plain terrain (density 0..1, deterministic) */
  onGround(tileset: string, layer: Layer, indices: number[], density: number, salt: number) {
    for (let y = 0; y < H - 1; y += 1) for (let x = 0; x < W; x += 1) {
      if (!this.free(x, y) || this.cells[y + 1][x] !== '#' || this.stamped(layer, x, y)) continue;
      const h = hash(x, y, salt);
      if ((h & 0xffff) / 65536 < density) this.stamp(tileset, layer, indices[(h >>> 16) % indices.length], x, y);
    }
    return this;
  }
  /** decorate free cells hanging under plain terrain */
  hanging(tileset: string, layer: Layer, indices: number[], density: number, salt: number) {
    for (let y = 1; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      if (!this.free(x, y) || this.cells[y - 1][x] !== '#' || this.stamped(layer, x, y)) continue;
      const h = hash(x, y, salt);
      if ((h & 0xffff) / 65536 < density) this.stamp(tileset, layer, indices[(h >>> 16) % indices.length], x, y);
    }
    return this;
  }
  /** forest tree on the background layer: trunk from baseRow upward, 3x2 canopy on top */
  tree(x: number, baseRow: number, height: number) {
    for (let i = 0; i < height; i += 1) this.stamp('forest', 'background', i === 0 ? 60 : i % 2 ? 36 : 48, x, baseRow - i);
    const top = baseRow - height;
    for (let dy = -1; dy <= 0; dy += 1) for (let dx = -1; dx <= 1; dx += 1) this.stamp('forest', 'background', 12, x + dx, top + dy);
    return this;
  }
  /** bark / stone pillar on the background layer between two rows */
  pillar(tileset: string, indices: number[], x: number, y1: number, y2: number) {
    for (let y = y1; y <= y2; y += 1) this.stamp(tileset, 'background', indices[(y - y1) % indices.length], x, y);
    return this;
  }
  cactus(x: number, baseRow: number, height: number) {
    for (let i = 0; i < height; i += 1) {
      this.stamp('desert', 'background', i === height - 1 ? 36 : i === 0 ? 60 : 48, x, baseRow - i);
    }
    return this;
  }
}

export interface RoomDef {
  x: number; y: number; name: string; title: string; theme: Theme; background: string;
  hearts?: number; pitsAreDeadly?: boolean; details?: boolean; goal: GoalDef | null; grid: Grid;
}

function room(meta: Omit<RoomDef, 'grid' | 'name'> & { name?: string }, build: (g: Grid) => void): RoomDef {
  const grid = new Grid();
  build(grid);
  return { name: meta.name ?? `${meta.x},${meta.y}`, ...meta, grid };
}

const P = (...pts: [number, number][]) => pts;
const outdoor = (g: Grid) => g.fill('#', 0, 18, 39, 21);
const cave = (g: Grid, x1: number, y1: number, x2: number, y2: number) => g.fill('#', 0, 0, 39, 21).clear(x1, y1, x2, y2);
const tunnelL = (g: Grid) => g.clear(0, 14, 1, 17);
const tunnelR = (g: Grid) => g.clear(38, 14, 39, 17);
/** well with stairs on the left leading down to a 2-wide one-way hatch in row 21 (cols x, x+1) */
const hatchWell = (g: Grid, x: number) => {
  g.clear(x - 2, 18, x - 2, 18).clear(x - 1, 18, x - 1, 19).clear(x, 18, x + 1, 20).row('=', 21, x, x + 1);
};
/** ceiling shaft under a hatch at cols x, x+1 (2-thick ceiling): ladder in col x, block top at y=16 in col x+1 */
const hatchShaft = (g: Grid, x: number, ladderRows: number[]) => {
  g.clear(x, 0, x, 1).clear(x + 1, 0, x + 1, 0);
  for (const r of ladderRows) g.put('H', [x, r]);
};

export const START_ROOM: [number, number] = [0, 0];

// ================================================================================================
// The world
// ================================================================================================
export const WORLD_ROOMS: RoomDef[] = [
  // ---------------------------------------------------------------- (0,0) start: gentle forest
  room({ x: 0, y: 0, title: 'Wamp Woods', theme: 'forest', background: 'forest', hearts: 3,
    goal: { type: 'collect', count: 8 } }, (g) => {
    outdoor(g);
    g.row('#', 16, 6, 10);                       // A
    g.row('#', 14, 14, 18);                      // B
    g.fill('#', 22, 16, 29, 17).row('#', 17, 30, 31);   // hill
    g.row('=', 14, 24, 28);                      // C (one-way over the hill)
    g.row('#', 12, 31, 35);                      // D
    g.row('=', 10, 23, 27);                      // E
    g.put('@', [3, 17]);
    g.put('o', ...P([7, 15], [9, 15], [15, 13], [17, 13], [20, 17], [25, 15], [27, 15], [30, 13]));
    g.put('g', [33, 11]).put('*', [25, 9]).put('s', [34, 17], [36, 17]);
    g.tree(1, 17, 6).tree(12, 17, 8).tree(20, 17, 5).tree(37, 17, 7);
    g.onGround('forest', 'foreground', [0, 4, 4], 0.22, 11);
    g.onGround('forest', 'background', [58, 59, 56, 3], 0.12, 12);
  }),

  // ---------------------------------------------------------------- (1,0) first enemies, hatch down
  room({ x: 1, y: 0, title: 'Slime Meadow', theme: 'forest', background: 'forest', hearts: 3,
    goal: { type: 'defeat' } }, (g) => {
    outdoor(g);
    hatchWell(g, 11);                            // -> (1,1) Crab Cove
    g.fill('#', 36, 0, 39, 13);                  // cliff face with the cave mouth to (2,0) below it
    g.row('#', 16, 20, 25);                      // P
    g.row('#', 14, 28, 31);                      // Q
    g.put('#', [35, 17]);                        // curb: keeps the slimes away from the east seam
    g.put('@', [3, 17]);
    g.put('1', [16, 17], [22, 15]).put('2', [30, 17]);
    g.put('h', [29, 13]).put('o', ...P([6, 17], [21, 15], [24, 15], [30, 13], [33, 17]));
    g.tree(2, 17, 7).tree(15, 17, 5).tree(27, 17, 6);
    g.onGround('forest', 'foreground', [0, 4, 4], 0.22, 21);
    g.onGround('forest', 'background', [58, 59, 56], 0.1, 22);
    g.hanging('forest', 'background', [24], 0.6, 23);
  }),

  // ---------------------------------------------------------------- (2,0) cave climb, hatch up
  room({ x: 2, y: 0, title: 'Hollow Hill', theme: 'forest', background: 'cave', hearts: 3,
    goal: { type: 'exit' } }, (g) => {
    cave(g, 2, 2, 37, 17);
    tunnelL(g); tunnelR(g);
    hatchShaft(g, 30, [3, 6, 9]);                // -> (2,-1) Frozen Steps
    g.fill('#', 8, 16, 11, 17).fill('#', 12, 14, 15, 17);     // steps
    g.row('#', 12, 18, 22);
    g.row('#', 10, 26, 33);                      // ladder base
    g.fill('#', 35, 8, 37, 9);                   // exit alcove
    g.put('@', [3, 17]).put('E', [36, 7]);
    g.put('F', [13, 13]).put('P', [24, 17]).put('^', [18, 17], [19, 17]);
    g.put('b', [26, 15]);
    g.put('o', ...P([9, 15], [10, 15], [19, 11], [21, 11], [27, 9], [28, 9], [33, 17], [35, 17])).put('g', [35, 7]);
    g.pillar('forest', [36, 48], 5, 2, 17).pillar('forest', [48, 36], 17, 2, 11).pillar('forest', [36, 48], 34, 10, 17);
    g.stamp('forest', 'background', 7, 2, 2).stamp('forest', 'background', 8, 37, 2).stamp('forest', 'background', 8, 16, 2);
    g.hanging('forest', 'background', [24], 0.35, 31);
    g.onGround('forest', 'foreground', [56, 3, 57], 0.15, 32);
  }),

  // ---------------------------------------------------------------- (3,0) ice cave arena
  room({ x: 3, y: 0, title: 'Frost Cavern', theme: 'snow', background: 'cave', hearts: 3,
    goal: { type: 'defeat' } }, (g) => {
    cave(g, 2, 3, 37, 17);
    tunnelL(g);
    g.row('I', 18, 6, 19);
    g.fill('#', 4, 17, 5, 17);                   // curb: keeps the slime away from the west seam
    g.fill('#', 21, 16, 23, 17).fill('#', 22, 15, 23, 15);   // 48 px on the frog's side: a frog hop peaks at 39 px
    g.row('I', 14, 25, 29);
    g.row('#', 12, 31, 36);
    g.put('@', [3, 17]);
    g.put('2', [12, 17]).put('b', [8, 13], [28, 10]).put('r', [33, 17]);
    g.put('h', [34, 11]).put('o', ...P([9, 17], [15, 17], [26, 13], [28, 13], [32, 11]));
    g.hanging('snow', 'background', [62, 63, 64, 65], 0.45, 41);
    g.onGround('snow', 'foreground', [2, 3, 4], 0.18, 42);
  }),

  // ---------------------------------------------------------------- (2,-1) snow, crumbling bridge
  room({ x: 2, y: -1, title: 'Frozen Steps', theme: 'snow', background: 'mountains', hearts: 3,
    goal: { type: 'collect', count: 6 } }, (g) => {
    outdoor(g);
    g.fill('#', 0, 0, 1, 17);                    // west cliff (no neighbour)
    hatchWell(g, 30);                            // -> (2,0) Hollow Hill
    g.clear(12, 18, 19, 19).row('^', 19, 12, 19).row('C', 18, 12, 19);   // spike pit + crumbling bridge
    g.row('I', 18, 4, 10);
    g.fill('#', 21, 16, 24, 17);
    g.row('=', 14, 16, 19);
    g.row('#', 12, 10, 13);
    g.row('I', 10, 4, 7);
    g.put('@', [26, 17]);
    g.put('g', ...P([7, 17], [13, 17], [18, 17], [17, 13], [18, 13], [11, 11], [5, 9], [36, 17]));
    g.put('1', [35, 17]);
    g.fill('#', 37, 17, 38, 17);                 // curb: keeps the slime away from the east seam
    g.stamp('snow', 'background', 31, 3, 17).stamp('snow', 'background', 31, 22, 15);
    g.onGround('snow', 'foreground', [2, 3, 4], 0.2, 51);
    g.hanging('snow', 'background', [62, 63, 64, 65], 0.5, 52);
  }),

  // ---------------------------------------------------------------- (3,-1) summit sprint
  room({ x: 3, y: -1, title: 'Summit Glacier', theme: 'snow', background: 'mountains', hearts: 3,
    goal: { type: 'sprint', timeLimitS: 60 } }, (g) => {
    outdoor(g);
    g.fill('#', 10, 16, 39, 17).fill('#', 18, 14, 39, 15).fill('#', 26, 12, 39, 13);
    g.fill('#', 33, 7, 37, 11);                  // summit
    g.fill('#', 38, 0, 39, 11);                  // east wall (no neighbour)
    g.row('I', 16, 12, 17);
    g.put('B', [30, 12]);
    g.put('@', [3, 17]).put('7', [13, 15]).put('8', [24, 13]).put('E', [35, 6]);
    g.put('S', [20, 13]).put('b', [22, 9]);
    g.put('*', [36, 6]).put('o', ...P([6, 17], [8, 17], [15, 15], [23, 13], [28, 11], [30, 8]));
    g.stamp('snow', 'background', 31, 5, 17);
    g.onGround('snow', 'foreground', [2, 3, 4], 0.2, 61);
  }),

  // ---------------------------------------------------------------- (-1,0) desert sprint (runs west)
  room({ x: -1, y: 0, title: 'Dune Dash', theme: 'desert', background: 'desert', hearts: 3, pitsAreDeadly: true,
    goal: { type: 'sprint' } }, (g) => {
    outdoor(g);
    g.clear(20, 18, 22, 21);                     // deadly pit
    g.row('>', 18, 29, 34).row('<', 18, 5, 10);
    g.fill('#', 12, 16, 18, 17).fill('#', 14, 14, 16, 15);   // mesa
    g.put('#', [27, 17]);                        // curb: keeps the crab away from the spawn
    g.put('@', [36, 17]).put('7', [31, 17]).put('8', [15, 13]).put('E', [3, 17]);
    g.put('c', [23, 17]);
    g.put('o', ...P([33, 17], [29, 17], [21, 15], [17, 15], [13, 15], [8, 17], [6, 17])).put('s', [15, 11]);
    g.cactus(38, 17, 3).cactus(25, 17, 2).cactus(11, 17, 3).cactus(1, 17, 2);
    g.stamp('desert', 'background', 7, 35, 17).stamp('desert', 'background', 2, 19, 17).stamp('desert', 'background', 6, 4, 17);
    g.onGround('desert', 'foreground', [3, 4, 0], 0.12, 71);
  }),

  // ---------------------------------------------------------------- (-2,0) key + locked door
  room({ x: -2, y: 0, title: 'Mesa Keep', theme: 'desert', background: 'desert', hearts: 3,
    goal: { type: 'exit' } }, (g) => {
    outdoor(g);
    g.fill('#', 0, 0, 1, 17);                    // west cliff (no neighbour)
    g.fill('#', 2, 9, 13, 10).fill('#', 12, 11, 13, 14);     // keep roof + gate wall
    g.put('D', [12, 17]);
    g.fill('#', 30, 16, 33, 17).fill('#', 30, 15, 31, 15);   // stair; 48 px on the frog's side (a hop peaks at 39 px)
    g.row('#', 14, 24, 27);
    g.put('@', [36, 17]).put('E', [6, 17]);
    g.put('k', [25, 13]).put('^', [25, 17], [26, 17]).put('r', [17, 17]);
    g.put('h', [9, 17]).put('*', [4, 17]).put('o', ...P([31, 14], [32, 15], [27, 13], [21, 17], [15, 17]));
    g.cactus(35, 17, 3).cactus(22, 17, 2).cactus(15, 17, 4);
    g.pillar('desert', [57, 58], 4, 11, 12).pillar('desert', [57, 58], 9, 11, 12);
    g.stamp('desert', 'background', 6, 3, 17).stamp('desert', 'background', 8, 29, 17).stamp('desert', 'background', 1, 38, 17);
    g.onGround('desert', 'foreground', [3, 4, 0], 0.1, 81);
  }),

  // ---------------------------------------------------------------- (1,1) under the meadow
  room({ x: 1, y: 1, title: 'Crab Cove', theme: 'water', background: 'cave', hearts: 3,
    goal: { type: 'defeat' } }, (g) => {
    cave(g, 2, 2, 37, 17);
    tunnelL(g); tunnelR(g);
    hatchShaft(g, 11, [3, 6, 9]);                // -> (1,0) Slime Meadow
    g.row('#', 10, 7, 12);
    g.fill('#', 3, 17, 4, 17);                   // curb: keeps the crab away from the west seam
    g.put('H', [13, 11], [13, 14], [13, 17]);
    g.clear(20, 18, 31, 19).water(20, 18, 31, 19);     // pool, flush with the floor on both sides
    g.fill('#', 33, 16, 34, 17);
    g.row('#', 14, 26, 30);
    g.put('@', [37, 17]);
    g.put('c', [16, 17], [27, 13]).put('2', [8, 9]);
    g.put('g', [22, 19], [26, 19], [29, 19]).put('o', ...P([5, 17], [9, 17], [10, 9], [29, 13], [30, 13]));
    g.hanging('water', 'background', [13, 1, 5], 0.3, 91);
    g.onGround('water', 'foreground', [2, 3, 18], 0.15, 92);
  }),

  // ---------------------------------------------------------------- (0,1) flooded cavern
  room({ x: 0, y: 1, title: 'Sunken Grotto', theme: 'water', background: 'cave', hearts: 3,
    goal: { type: 'collect', count: 6 } }, (g) => {
    cave(g, 2, 2, 37, 19);
    g.fill('#', 26, 18, 37, 19);                 // dry floor at the tunnel
    tunnelR(g);
    g.fill('#', 28, 16, 29, 17).fill('#', 26, 14, 27, 17).fill('#', 24, 12, 25, 19);   // steps up to the dam
    g.fill('#', 8, 15, 10, 19).fill('#', 15, 13, 17, 19);    // pillars
    g.fill('#', 12, 2, 14, 5).fill('#', 20, 2, 22, 6);       // stalactites
    g.row('=', 16, 12, 13);                      // free-standing: not touching the pillars
    g.water(2, 12, 23, 19);
    g.put('@', [35, 17]);
    g.put('^', [4, 19], [5, 19], [6, 19]);
    g.put('g', ...P([9, 14], [16, 12], [12, 15], [20, 19], [12, 19], [22, 14], [3, 17], [5, 13]));
    g.put('h', [33, 17]);
    g.hanging('water', 'background', [13, 1, 5], 0.3, 101);
    g.onGround('water', 'foreground', [2, 3, 18], 0.2, 102);
  }),

  // ---------------------------------------------------------------- (2,1) lava pits
  room({ x: 2, y: 1, title: 'Ember Depths', theme: 'lava', background: 'cave', hearts: 3,
    goal: { type: 'exit' } }, (g) => {
    cave(g, 2, 4, 37, 17);
    tunnelL(g); tunnelR(g);
    g.fill('x', 8, 18, 11, 19).fill('x', 16, 18, 20, 19).fill('x', 26, 18, 29, 19);
    g.put('C', [18, 18]);
    // platforms: floor (y 288) -> row 15 (y 240, 48 px up) -> row 13 (y 208, 32 px up): both steps
    // are inside the 53 px jump apex, so the coins do not need a wall jump
    g.row('#', 15, 12, 15).row('#', 13, 18, 23);
    g.put('@', [3, 17]).put('E', [36, 17]);
    g.fill('#', 34, 17, 35, 17);                 // curb: keeps the slime away from the exit and the east seam
    g.put('F', [13, 17]).put('f', [23, 17]).put('S', [20, 10]).put('2', [31, 17]);
    g.put('o', ...P([9, 15], [10, 15], [13, 14], [14, 14], [19, 12], [22, 12], [27, 15], [28, 15])).put('g', [5, 17]);
    g.hanging('lava', 'background', [53, 54, 55, 56, 57], 0.4, 111);
    g.onGround('lava', 'foreground', [2, 4, 20], 0.25, 112);
  }),

  // ---------------------------------------------------------------- (3,1) hardest: lava sprint
  room({ x: 3, y: 1, title: 'Magma Run', theme: 'lava', background: 'cave', hearts: 3,
    goal: { type: 'sprint', timeLimitS: 90 } }, (g) => {
    cave(g, 2, 3, 37, 19);
    tunnelL(g);
    g.fill('#', 2, 18, 5, 19);                   // entry shelf
    g.fill('x', 6, 18, 33, 19);                  // lava sea
    g.fill('#', 34, 18, 37, 19);                 // finish island
    g.row('C', 18, 7, 10);
    g.fill('#', 12, 18, 14, 19);
    g.row('<', 18, 16, 20);
    g.fill('#', 22, 18, 24, 19);
    g.put('B', [26, 18], [27, 18]);
    g.row('#', 13, 29, 33);
    g.put('@', [3, 17]).put('7', [13, 17]).put('8', [31, 12]).put('E', [36, 17]);
    g.put('f', [18, 17]).put('S', [22, 13]);
    g.put('o', ...P([8, 16], [9, 16], [17, 15], [19, 15], [26, 14], [30, 12], [32, 12])).put('*', [35, 17]);
    g.hanging('lava', 'background', [53, 54, 55, 56, 57], 0.4, 121);
    g.onGround('lava', 'foreground', [2, 4, 20], 0.25, 122);
  }),
];

// ================================================================================================
// Engine test rooms (ARCHITECTURE.md 7.2), isolated at x >= 100.  No decoration: the terrain is
// what the tests assert on.
// ================================================================================================
const testFloor = (g: Grid) => g.fill('#', 0, 20, 39, 21);

export const TEST_ROOMS: RoomDef[] = [
  // floor at row 20, walls at both ends, 3- and 4-tile steps, a ledge, a 1-tile hole
  room({ x: 100, y: 0, name: 'test_flat', title: 'Test Flat', theme: 'forest', background: 'none', details: false, goal: null }, (g) => {
    testFloor(g);
    g.col('#', 0, 0, 19).col('#', 39, 0, 19);
    g.clear(20, 20, 20, 20);                     // 1-tile hole (gap assist)
    g.fill('#', 24, 17, 26, 19);                 // 3-tile step
    g.fill('#', 30, 16, 32, 19);                 // 4-tile step
    g.row('#', 16, 35, 37);                      // ledge
    g.put('@', [3, 19]);
  }),
  // 3-wide shaft, ceiling with a 1-tile notch, 1-tile-high tunnel
  room({ x: 102, y: 0, name: 'test_walls', title: 'Test Walls', theme: 'forest', background: 'none', details: false, goal: null }, (g) => {
    testFloor(g);
    g.col('#', 0, 0, 19).col('#', 39, 0, 19);
    g.col('#', 8, 4, 19).col('#', 12, 4, 16);    // shaft cols 9..11 (door at the bottom right: rows 17..19)
    g.row('#', 16, 18, 26).clear(22, 16, 22, 16);    // ceiling 3 tiles above the floor, notch at col 22
    g.fill('#', 30, 17, 36, 18);                 // low tunnel: row 19 is the only gap
    g.put('@', [10, 19]);
  }),
  // every special tile kind
  room({ x: 104, y: 0, name: 'test_tiles', title: 'Test Tiles', theme: 'forest', background: 'none', details: false, goal: null }, (g) => {
    testFloor(g);
    g.col('#', 0, 0, 19).col('#', 39, 0, 19);
    g.row('=', 17, 4, 7);                        // one-way
    g.put('B', [10, 20]);                        // bounce (embedded in the floor)
    g.put('x', [13, 19]);                        // damage, non-solid
    g.stamp('special', 'background', 8, 16, 20, false, true); // damage on the background layer over solid ground
    g.row('I', 20, 19, 24);                      // ice
    g.clear(26, 20, 35, 21).row('C', 20, 26, 35);    // 10-cell crumbling bridge over a hole
    g.row('#', 10, 2, 16).row('<', 10, 4, 8).row('>', 10, 10, 14);   // conveyors on an upper deck
    g.fill('#', 19, 10, 24, 10).col('#', 19, 5, 9).col('#', 24, 5, 9);   // water tank
    g.water(20, 5, 23, 9);
    g.row('=', 7, 21, 22);                       // one-way inside water
    g.put('@', [2, 19]);
  }),
  // objects, set A (26 strip rows), collect_target
  room({ x: 106, y: 0, name: 'test_objects_a', title: 'Test Objects A', theme: 'forest', background: 'none', details: false,
    hearts: 3, goal: { type: 'collect', count: 6 } }, (g) => {
    testFloor(g);
    g.col('#', 0, 0, 19).col('#', 39, 0, 19);
    g.put('#', [22, 19], [30, 19]);              // curbs: slimes in 23..29, crab in 31..38
    g.row('#', 14, 16, 20);                      // ladder landing
    g.put('@', [2, 19]);
    g.put('o', [4, 19]).put('s', [5, 19]).put('g', [6, 19]).put('h', [7, 19]).put('k', [8, 19]).put('*', [9, 19]);
    g.put('^', [11, 19]).put('f', [13, 19]).put('P', [15, 19]);
    g.put('H', [18, 19], [18, 16]);              // top of the ladder body = y 221, landing top = 224
    g.clear(18, 14, 18, 14);
    g.put('1', [24, 19]).put('2', [27, 19]).put('c', [33, 19]);
  }),
  // objects, set B (26 strip rows with the key), reach_exit
  room({ x: 108, y: 0, name: 'test_objects_b', title: 'Test Objects B', theme: 'forest', background: 'none', details: false,
    hearts: 3, goal: { type: 'exit' } }, (g) => {
    testFloor(g);
    g.col('#', 0, 0, 19).col('#', 39, 0, 19);
    g.fill('#', 20, 0, 21, 16);                  // wall above the door (door fills rows 17..19)
    g.put('#', [14, 19]);                        // curb: frog stays in 15..19
    g.put('@', [2, 19]);
    g.put('F', [4, 19]).put('k', [7, 19]).put('S', [9, 19]).put('b', [10, 13]).put('r', [16, 19]);
    g.put('D', [20, 19]).put('E', [30, 19]);
  }),
  // two horizontal neighbours: transitions, seam collision
  room({ x: 110, y: 0, name: 'test_edge_a', title: 'Test Edge A', theme: 'forest', background: 'none', details: false,
    hearts: 3, goal: { type: 'defeat' } }, (g) => {
    testFloor(g);
    g.col('#', 0, 0, 19);
    g.put('#', [8, 19], [20, 19]);               // curbs: slimes stay in 9..19
    g.put('@', [30, 19]);
    g.put('1', [12, 19]).put('2', [16, 19]);
  }),
  room({ x: 111, y: 0, name: 'test_edge_b', title: 'Test Edge B', theme: 'forest', background: 'none', details: false,
    hearts: 3, pitsAreDeadly: true, goal: { type: 'sprint' } }, (g) => {
    testFloor(g);
    g.col('#', 39, 0, 19);
    g.put('#', [0, 19]);                         // seam block at floor level (faces open column 39 of A)
    g.clear(16, 20, 19, 21);                     // deadly pit
    g.put('@', [6, 19]).put('7', [10, 19]).put('8', [24, 19]).put('E', [32, 19]);
  }),
];
