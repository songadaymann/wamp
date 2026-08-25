/**
 * Cyber v2 edge catalog.
 *
 * localIndex: atlas cell, 0 = top-left, `row * 12 + col` (same as collision).
 * brushId: which paint brush owns this tile.
 * edges: four letters, clockwise from the top: Top, Right, Bottom, Left.
 *
 * Example: 49, cyber.neon, BCBA  →  top B, right C, bottom B, left A.
 *
 * Horizontal flip swaps Left/Right.
 * Vertical flip swaps Top/Bottom.
 * The matcher tries those flips; you do not need extra rows per orientation.
 * Alternates that fit the same four sides (e.g. 11, 33, 35 after flips) are one
 * pool. Every legal (tile, flipX, flipY) is a distinct choice so fills look
 * varied instead of repeating the first matching row. Set `rare: true` on paint
 * splashes so they stay in that pool but appear only occasionally.
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
 * passes retile as neighbors appear.
 *
 * Window / Neon: meant to start on a Concrete edge and run into it. Seed the
 * outer-end piece (BIBA / BJBA), then flipX so A stays on the outer/start side
 * and the run (I or J) continues toward more Window/Neon or interior Concrete.
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
export const CYBER_COMMON_ALTERNATE_WEIGHT = 32;
export const CYBER_RARE_ALTERNATE_WEIGHT = 1;

function catalogCandidateWeight(tile: CyberOrientedTile): number {
  return tile.rare ? CYBER_RARE_ALTERNATE_WEIGHT : CYBER_COMMON_ALTERNATE_WEIGHT;
}

function catalogVarietyHash(x: number, y: number, salt: number): number {
  return Math.abs(
    Math.imul(x + 31, 73856093)
    ^ Math.imul(y + 17, 19349663)
    ^ Math.imul(salt + 7, 83492791),
  );
}

function orientedTileKey(tile: CyberOrientedTile): string {
  return `${tile.localIndex}:${Number(tile.flipX)}:${Number(tile.flipY)}`;
}

/**
 * Picks among equally valid catalog hits. Includes alternate art and every
 * legal flip as its own slot. Deterministic per (x, y) so re-solves do not
 * flicker; mixed enough that a run of the same socket uses several looks.
 * When `avoid` is set (already-chosen neighbors), those looks are skipped if
 * anything else remains in the pool. Catalog rows with `rare: true` (paint
 * splashes) stay in the pool but are weighted much lower than common art.
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
  for (const candidate of candidates) {
    const key = orientedTileKey(candidate);
    if (!unique.has(key)) unique.set(key, candidate);
  }
  const all = [...unique.values()];
  const avoided = new Set((options?.avoid ?? []).map(orientedTileKey));
  const preferred = all.filter((candidate) => !avoided.has(orientedTileKey(candidate)));
  const pool = preferred.length > 0 ? preferred : all;
  const totalWeight = pool.reduce((sum, candidate) => sum + catalogCandidateWeight(candidate), 0);
  const salt = options?.salt ?? 0;
  let roll = catalogVarietyHash(x, y, totalWeight + salt * 1_000_003) % totalWeight;
  for (const candidate of pool) {
    roll -= catalogCandidateWeight(candidate);
    if (roll < 0) return candidate;
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

export function isCyberLetterCatalogLocalIndex(localIndex: number): boolean {
  return CYBER_EDGE_CATALOG.some((entry) => entry.localIndex === localIndex);
}

export const CYBER_EDGE_CATALOG: readonly CyberEdgeCatalogEntry[] = [
  { localIndex: 11, brushId: 'cyber.concrete', edges: 'CCBB', rare: true },
  { localIndex: 14, brushId: 'cyber.concrete', edges: 'ABBA' },
  { localIndex: 15, brushId: 'cyber.concrete', edges: 'ABCB' },
  { localIndex: 16, brushId: 'cyber.concrete', edges: 'ABCB', rare: true },
  { localIndex: 17, brushId: 'cyber.shell', edges: 'AADB' },
  { localIndex: 19, brushId: 'cyber.concrete', edges: 'AAEA' },
  { localIndex: 20, brushId: 'cyber.concrete', edges: 'AAAA' }, /** solo concrete */
  { localIndex: 21, brushId: 'cyber.concrete', edges: 'BABC' },
  { localIndex: 23, brushId: 'cyber.concrete', edges: 'BCBA' },
  { localIndex: 25, brushId: 'cyber.concrete', edges: 'ABBA' },
  { localIndex: 26, brushId: 'cyber.shell', edges: 'AGCB' },
  { localIndex: 27, brushId: 'cyber.shell', edges: 'AGHG' },
  { localIndex: 28, brushId: 'cyber.shell', edges: 'AGHG', rare: true },
  { localIndex: 29, brushId: 'cyber.shell', edges: 'ABHG' },
  { localIndex: 30, brushId: 'cyber.concrete', edges: 'AABB' },
  { localIndex: 31, brushId: 'cyber.concrete', edges: 'EAEA' },
  { localIndex: 33, brushId: 'cyber.concrete', edges: 'BBCC' },
  { localIndex: 34, brushId: 'cyber.concrete', edges: 'ABCB' },
  { localIndex: 35, brushId: 'cyber.concrete', edges: 'BCCB' },
  { localIndex: 37, brushId: 'cyber.windows', edges: 'BIBA' },
  { localIndex: 38, brushId: 'cyber.windows', edges: 'CICI' },
  { localIndex: 39, brushId: 'cyber.windows', edges: 'HHCI' },
  { localIndex: 39, brushId: 'cyber.shell', edges: 'HHCI' },
  { localIndex: 40, brushId: 'cyber.shell', edges: 'HHHH', rare: true },
/**{ localIndex: 41, brushId: 'cyber.shell', edges: 'HHHH' }, skipping this one for manual only */
  { localIndex: 42, brushId: 'cyber.shell', edges: 'BAGH' },
  { localIndex: 43, brushId: 'cyber.concrete', edges: 'EEEE' },
  { localIndex: 49, brushId: 'cyber.neon', edges: 'BJBA' },
  { localIndex: 50, brushId: 'cyber.neon', edges: 'CJCJ' },
  { localIndex: 51, brushId: 'cyber.neon', edges: 'CCCJ' },
  { localIndex: 52, brushId: 'cyber.shell', edges: 'HHCC' },
  { localIndex: 53, brushId: 'cyber.shell', edges: 'HHHH' }, /** full shell */
  { localIndex: 54, brushId: 'cyber.shell', edges: 'HHHH' },
  { localIndex: 55, brushId: 'cyber.concrete', edges: 'EEEA' },
  { localIndex: 61, brushId: 'cyber.concrete', edges: 'BBAA' },
  { localIndex: 62, brushId: 'cyber.concrete', edges: 'CBAB' },
  { localIndex: 63, brushId: 'cyber.concrete', edges: 'CCAB' },
  { localIndex: 64, brushId: 'cyber.concrete', edges: 'CCCC' }, /** blank concrete */
  { localIndex: 65, brushId: 'cyber.shell', edges: 'HHGC' },
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
  { localIndex: 77, brushId: 'cyber.shell', edges: 'HHHI' },
  { localIndex: 77, brushId: 'cyber.windows', edges: 'HHHI' },
  { localIndex: 78, brushId: 'cyber.shell', edges: 'HHHC' },
  { localIndex: 79, brushId: 'cyber.shell', edges: 'HABC' },
  { localIndex: 80, brushId: 'cyber.shell', edges: 'HHCB' },
  { localIndex: 81, brushId: 'cyber.concrete', edges: 'ACCC' },
  { localIndex: 81, brushId: 'cyber.shell', edges: 'ACCC' },
  { localIndex: 82, brushId: 'cyber.concrete', edges: 'CCCC' },
  { localIndex: 83, brushId: 'cyber.concrete', edges: 'CCCC' },
];

/*
 * Not in the letter matcher (no catalog rows). Names for your notes:
 *
 *   cyber.fence    — 2-row stamp, not flippable
 *   cyber.rubble   — Feature twin; yellow/pink mix; chaos flips
 *   cyber.support  — background columns, unchanged connectivity
 */
