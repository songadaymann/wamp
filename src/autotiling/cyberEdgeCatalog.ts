/**
 * Cyber v2 edge catalog.
 *
 * Each row is one atlas cell plus the four edge letters it is compatible with.
 * Letters are sockets, not a tile type: they say which neighbor edges may
 * touch this cell. You list every compatible combination; the matcher does
 * not invent extra B/C or G/H/D rows.
 *
 * localIndex is always 0-based: 0 is the top-left atlas cell,
 * `row * 12 + col`, identical to collision-map indices. Never add 1.
 * brushId: which paint brush owns this tile.
 * edges: Top, Right, Bottom, Left.
 *
 * Example: 49, cyber.neon, BCBA  →  top B, right C, bottom B, left A.
 *
 * Horizontal flip swaps Left/Right. Vertical flip swaps Top/Bottom.
 * The matcher tries those flips; you do not need extra rows per orientation.
 * Two rows with the same localIndex are two compatible edge tuples you listed
 * (e.g. window pane 38). Alternates that fit the same four sides after flips
 * (e.g. 11, 33, 35) are one pool. Set `rare: true` on paint splashes so they
 * appear only occasionally on the first paint. CCCC fill is 64, with rare 82.
 */

export const CYBER_LETTER_BRUSH_IDS = [
  'cyber.concrete',
  'cyber.windows',
  'cyber.shell',
  'cyber.neon',
] as const;
export type CyberLetterBrushId = typeof CYBER_LETTER_BRUSH_IDS[number];

export function isCyberLetterBrushId(brushId: string): brushId is CyberLetterBrushId {
  return (CYBER_LETTER_BRUSH_IDS as readonly string[]).includes(brushId);
}

/** Names for brushes that are not letter-matched. Kept here so labels stay consistent. */
export const CYBER_V2_BRUSH_IDS = [
  ...CYBER_LETTER_BRUSH_IDS,
  'cyber.fence',
  'cyber.rubble',
  'cyber.support',
] as const;
export type CyberV2BrushId = typeof CYBER_V2_BRUSH_IDS[number];

/**
 * A: exterior. Faces empty space, or a brush outside the letter set (Fence, Rubble, Support).
 *     Only A may touch a void, and a void may only touch A.
 *     Occupied neighbors must share the same non-A letter on the shared edge.
 * B: exterior adjacent concrete
 * C: interior concrete
 * D: exterior adjacent shell
 * E: narrow concrete
 * F: reserved for future use
 * G: exterior adjacent shell
 * H: interior shell
 * I: window
 * J: neon
 */
export type CyberEdgeLetter =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';

/**
 * Used when no catalog row (plus flips) matches all four sides.
 *
 * Shell: no AAAA piece exists. Paint 53 (HHHH) as the seed, then let later
 * passes retile as neighbors appear. Solid blobs use 54 (right edge), 66
 * (convex corner), 27 (top edge), 53 (fill), and rarely 28 / 40. A blob of
 * at least 3x3 with a Concrete cross and Shell on the four corners uses 61
 * (BBAA yellow chamfer) on those Shell cells, flipped to the corner.
 * Support is 36 / 48 / 60 / 72 only — never letter-match those onto Shell.
 * Diagonal cladding across Concrete uses 52 (inland long stair, no A sides), 26
 * (bottom-left point),
 * 79 (top point), 42 (stair meeting a Concrete wall), 29 (stair meeting the
 * blob's top or bottom edge), 17 (that meeting when it is also an outer
 * void corner), 83 (ADBA; the 90° rotation 17 cannot flip to), and 78
 * (a 1-cell point where two stairs meet), flipped to the stair direction.
 *
 * Window / Neon: meant to start on a Concrete edge and run into it. Seed the
 * outer-end piece (BIBA / BJBA), then flipX so A stays on the outer/start side
 * and the run (I or J) continues toward more Window/Neon or interior Concrete.
 * Stacked Window strokes reuse pane 38 with I on the shared vertical sides.
 * End caps stay tile 37, including the middle rows of a 3+ row band.
 */
export const CYBER_BRUSH_SEEDS = {
  'cyber.shell': {
    localIndex: 53,
    edges: 'HHHH',
    fallback: 'isolated-then-adapt',
  },
  'cyber.windows': {
    localIndex: 37,
    edges: 'BIBA',
    fallback: 'outer-edge-flip-x',
  },
  'cyber.neon': {
    localIndex: 49,
    edges: 'BJBA',
    fallback: 'outer-edge-flip-x',
  },
} as const satisfies Partial<Record<CyberLetterBrushId, {
  localIndex: number;
  edges: `${CyberEdgeLetter}${CyberEdgeLetter}${CyberEdgeLetter}${CyberEdgeLetter}`;
  fallback: 'isolated-then-adapt' | 'outer-edge-flip-x';
}>>;

export interface CyberOrientedTile {
  localIndex: number;
  flipX: boolean;
  flipY: boolean;
  rare?: boolean;
}

/** Common alternates are this many times more likely than a `rare` paint-splash. */
export const CYBER_COMMON_ALTERNATE_WEIGHT = 64;
export const CYBER_RARE_ALTERNATE_WEIGHT = 1;

function catalogCandidateWeight(tile: CyberOrientedTile): number {
  return tile.rare ? CYBER_RARE_ALTERNATE_WEIGHT : CYBER_COMMON_ALTERNATE_WEIGHT;
}

function catalogVarietyHash(x: number, y: number, salt: number): number {
  let h = 0x9e3779b9 ^ salt;
  h = Math.imul(h ^ Math.imul(x + 0x7f4a7c15, 0x85ebca6b), 0xc2b2ae35);
  h = Math.imul(h ^ Math.imul(y + 0x27d4eb2f, 0x165667b1), 0x27d4eb2f);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb9d58);
  h ^= h >>> 13;
  return h >>> 0;
}

function orientedTileKey(tile: CyberOrientedTile): string {
  return `${tile.localIndex}:${Number(tile.flipX)}:${Number(tile.flipY)}`;
}

/** Atlas cells whose flips are the same look. Variety keeps one orientation.
 *  28 is the AHHH splash of 27: the drip sits on the A side, so it must flip. */
export const CYBER_FLIP_INVARIANT_LOCAL_INDICES: ReadonlySet<number> = new Set([40, 53, 64]);

function collapseFlipInvariantLook<T extends CyberOrientedTile>(tile: T): T {
  if (!CYBER_FLIP_INVARIANT_LOCAL_INDICES.has(tile.localIndex)) return tile;
  if (!tile.flipX && !tile.flipY) return tile;
  return { ...tile, flipX: false, flipY: false };
}

function flipCycleRank(tile: CyberOrientedTile): number {
  if (tile.flipX && tile.flipY) return 3;
  if (tile.flipY) return 2;
  if (tile.flipX) return 1;
  return 0;
}

function compareCycleLooks(a: CyberOrientedTile, b: CyberOrientedTile): number {
  const rank = flipCycleRank(a) - flipCycleRank(b);
  if (rank !== 0) return rank;
  return a.localIndex - b.localIndex;
}

/**
 * Picks among equally valid catalog hits. Includes alternate art and every
 * legal flip as its own slot. Deterministic per (x, y) so re-solves do not
 * flicker; mixed enough that a run of the same socket uses several looks.
 * When `avoid` is set (already-chosen neighbors), those looks are skipped if
 * anything else remains in the pool. Catalog rows with `rare: true` (paint
 * splashes) stay in the pool but are weighted much lower than common art on
 * the first paint. Re-paints (`salt` > 0) cycle every distinct look in order
 * so each click changes the tile whenever more than one look fits.
 */
export function pickVariedCatalogCandidate<T extends CyberOrientedTile>(
  candidates: readonly T[],
  x: number,
  y: number,
  options?: { avoid?: readonly CyberOrientedTile[]; salt?: number },
): T {
  if (candidates.length === 0) {
    throw new RangeError('Cyber catalog pick requires at least one candidate.');
  }
  const unique = new Map<string, T>();
  const weights = new Map<string, number>();
  for (const candidate of candidates) {
    const look = collapseFlipInvariantLook(candidate);
    const key = orientedTileKey(look);
    if (!unique.has(key)) unique.set(key, look);
    weights.set(key, (weights.get(key) ?? 0) + catalogCandidateWeight(candidate));
  }
  const looks = [...unique.values()].sort(compareCycleLooks);
  const avoided = new Set(
    (options?.avoid ?? []).map((tile) => orientedTileKey(collapseFlipInvariantLook(tile))),
  );
  const unavoids = looks.filter((look) => !avoided.has(orientedTileKey(look)));
  const initialPool = unavoids.length > 0 ? unavoids : looks;
  const initial = pickWeightedCatalogLook(initialPool, weights, x, y);
  const salt = options?.salt ?? 0;
  if (salt === 0 || looks.length === 1) return initial;
  const startIndex = looks.findIndex((look) => orientedTileKey(look) === orientedTileKey(initial));
  return looks[(Math.max(startIndex, 0) + salt) % looks.length]!;
}

function pickWeightedCatalogLook<T extends CyberOrientedTile>(
  pool: readonly T[],
  weights: ReadonlyMap<string, number>,
  x: number,
  y: number,
): T {
  const totalWeight = pool.reduce((sum, look) => sum + (weights.get(orientedTileKey(look)) ?? 0), 0);
  let roll = catalogVarietyHash(x, y, totalWeight) % Math.max(totalWeight, 1);
  for (const look of pool) {
    roll -= weights.get(orientedTileKey(look)) ?? 0;
    if (roll < 0) return look;
  }
  return pool[pool.length - 1]!;
}

export function flipCatalogEdges(
  edges: `${CyberEdgeLetter}${CyberEdgeLetter}${CyberEdgeLetter}${CyberEdgeLetter}`,
  flipX: boolean,
  flipY: boolean,
): `${CyberEdgeLetter}${CyberEdgeLetter}${CyberEdgeLetter}${CyberEdgeLetter}` {
  let [top, right, bottom, left] = edges.split('') as CyberEdgeLetter[];
  if (flipX) [left, right] = [right, left];
  if (flipY) [top, bottom] = [bottom, top];
  return `${top}${right}${bottom}${left}`;
}

export interface CyberEdgeCatalogEntry {
  localIndex: number;
  brushId: CyberLetterBrushId;
  /** Clockwise from top: Top, Right, Bottom, Left. */
  edges: `${CyberEdgeLetter}${CyberEdgeLetter}${CyberEdgeLetter}${CyberEdgeLetter}`;
  /** Paint-splash / accent art. Weighted far below common alternates. */
  rare?: true;
}

export function catalogEntriesForBrush(brushId: CyberLetterBrushId): readonly CyberEdgeCatalogEntry[] {
  return CYBER_EDGE_CATALOG.filter((entry) => entry.brushId === brushId);
}

export function catalogLocalIndicesForBrush(brushId: CyberLetterBrushId): number[] {
  return [...new Set(catalogEntriesForBrush(brushId).map((entry) => entry.localIndex))];
}

export function edgesForOrientedCatalogTile(
  localIndex: number,
  flipX: boolean,
  flipY: boolean,
  brushId: CyberLetterBrushId = 'cyber.concrete',
): `${CyberEdgeLetter}${CyberEdgeLetter}${CyberEdgeLetter}${CyberEdgeLetter}` | null {
  const entry = catalogEntriesForBrush(brushId).find((row) => row.localIndex === localIndex);
  if (!entry) return null;
  return flipCatalogEdges(entry.edges, flipX, flipY);
}

export function isCyberLetterCatalogLocalIndex(localIndex: number): boolean {
  return CYBER_EDGE_CATALOG.some((entry) => entry.localIndex === localIndex);
}

/** Support brush only. Never letter-match these onto Concrete or Shell. */
export const CYBER_SUPPORT_ONLY_LOCAL_INDICES: ReadonlySet<number> = new Set([
  36, 48, 60, 72,
]);

/** Yellow chamfer. Unflipped is BBAA (voids bottom+left). */
export const CYBER_SHELL_CLADDING_LOCAL_INDEX = 61;

export const CYBER_EDGE_CATALOG: readonly CyberEdgeCatalogEntry[] = [
  { localIndex: 11, brushId: 'cyber.concrete', edges: 'CCBB', rare: true },
  { localIndex: 14, brushId: 'cyber.concrete', edges: 'ABBA' },
  { localIndex: 15, brushId: 'cyber.concrete', edges: 'ABCB' },
  { localIndex: 16, brushId: 'cyber.concrete', edges: 'ABCB', rare: true },
  { localIndex: 17, brushId: 'cyber.shell', edges: 'AAHC' },
  { localIndex: 19, brushId: 'cyber.concrete', edges: 'AAEA' },
  { localIndex: 20, brushId: 'cyber.concrete', edges: 'AAAA' }, /** solo concrete */
  { localIndex: 21, brushId: 'cyber.concrete', edges: 'BABC' },
  { localIndex: 23, brushId: 'cyber.concrete', edges: 'BCBA' },
  { localIndex: 25, brushId: 'cyber.concrete', edges: 'ABBA' },
  { localIndex: 26, brushId: 'cyber.shell', edges: 'AGCB' },
  { localIndex: 27, brushId: 'cyber.shell', edges: 'AHHH' },
  { localIndex: 28, brushId: 'cyber.shell', edges: 'AHHH', rare: true },
  { localIndex: 29, brushId: 'cyber.shell', edges: 'ACHH' },
  { localIndex: 30, brushId: 'cyber.concrete', edges: 'AABB' },
  { localIndex: 31, brushId: 'cyber.concrete', edges: 'EAEA' },
  { localIndex: 33, brushId: 'cyber.concrete', edges: 'BBCC' },
  { localIndex: 34, brushId: 'cyber.concrete', edges: 'ABCB' },
  { localIndex: 35, brushId: 'cyber.concrete', edges: 'BCCB' },
  { localIndex: 37, brushId: 'cyber.windows', edges: 'BIBA' },
  { localIndex: 38, brushId: 'cyber.windows', edges: 'CICI' },
  { localIndex: 38, brushId: 'cyber.windows', edges: 'IIII' },
  { localIndex: 38, brushId: 'cyber.windows', edges: 'CIII' },
  { localIndex: 38, brushId: 'cyber.windows', edges: 'IIIC' },
  { localIndex: 38, brushId: 'cyber.windows', edges: 'CIIC' },
  { localIndex: 37, brushId: 'cyber.windows', edges: 'IIIA' },
  { localIndex: 39, brushId: 'cyber.windows', edges: 'HHCI' },
  { localIndex: 40, brushId: 'cyber.shell', edges: 'HHHH', rare: true },
  { localIndex: 42, brushId: 'cyber.shell', edges: 'BAGH' },
  { localIndex: 43, brushId: 'cyber.concrete', edges: 'EEEE' },
  { localIndex: 49, brushId: 'cyber.neon', edges: 'BJBA' },
  { localIndex: 50, brushId: 'cyber.neon', edges: 'CJCJ' },
  { localIndex: 51, brushId: 'cyber.neon', edges: 'CCCJ' },
  { localIndex: 52, brushId: 'cyber.shell', edges: 'HHCC' },
  { localIndex: 53, brushId: 'cyber.shell', edges: 'HHHH' }, /** full shell */
  { localIndex: 54, brushId: 'cyber.shell', edges: 'HAHH' },
  { localIndex: 55, brushId: 'cyber.concrete', edges: 'EEEA' },
  { localIndex: 61, brushId: 'cyber.shell', edges: 'BBAA' }, /** 3x3+ concrete cross, yellow chamfer */
  { localIndex: 62, brushId: 'cyber.concrete', edges: 'CBAB' },
  { localIndex: 63, brushId: 'cyber.concrete', edges: 'CCAB' },
  { localIndex: 64, brushId: 'cyber.concrete', edges: 'CCCC' }, /** blank concrete */
  { localIndex: 82, brushId: 'cyber.concrete', edges: 'CCCC', rare: true },
  { localIndex: 66, brushId: 'cyber.shell', edges: 'HAAH' },
  { localIndex: 67, brushId: 'cyber.concrete', edges: 'EEAA' },
  { localIndex: 68, brushId: 'cyber.concrete', edges: 'AEAE' },
  { localIndex: 69, brushId: 'cyber.concrete', edges: 'AEAE', rare: true },
  { localIndex: 70, brushId: 'cyber.concrete', edges: 'AEEE' },
  { localIndex: 71, brushId: 'cyber.concrete', edges: 'AAAE' },
  { localIndex: 73, brushId: 'cyber.neon', edges: 'JJJJ' }, /** neon cross */
  { localIndex: 74, brushId: 'cyber.neon', edges: 'CJJJ' },
  { localIndex: 75, brushId: 'cyber.neon', edges: 'JCCJ' },
  { localIndex: 76, brushId: 'cyber.neon', edges: 'CCJC' },
  { localIndex: 77, brushId: 'cyber.windows', edges: 'HHHI' },
  { localIndex: 78, brushId: 'cyber.shell', edges: 'HHHC' },
  { localIndex: 79, brushId: 'cyber.shell', edges: 'HABC' },
  { localIndex: 81, brushId: 'cyber.concrete', edges: 'ACCC' },
  { localIndex: 83, brushId: 'cyber.shell', edges: 'ADBA' },
];

/*
 * Not in the letter matcher (no catalog rows). Names for your notes:
 *
 *   cyber.fence    — 2-row stamp, not flippable
 *   cyber.rubble   — Feature twin; yellow/pink mix; chaos flips
 *   cyber.support  — background columns: 36, 48, 60, 72
 */
