import {
  CYBER_BRUSH_SEEDS,
  CYBER_EDGE_CATALOG,
  CYBER_SHELL_CLADDING_LOCAL_INDEX,
  CYBER_SUPPORT_ONLY_LOCAL_INDICES,
  catalogEntriesForBrush,
  flipCatalogEdges,
  isCyberLetterBrushId,
  pickCanonicalCatalogCandidate,
  pickVariedCatalogCandidate,
  type CyberEdgeLetter,
  type CyberLetterBrushId,
  type CyberOrientedTile,
} from './cyberEdgeCatalog';

export interface CyberLetterOccupant {
  brushId: CyberLetterBrushId;
  varietySalt?: number;
  pick?: CyberLetterPick;
}

export interface CyberLetterPick extends CyberOrientedTile {
  edges: `${CyberEdgeLetter}${CyberEdgeLetter}${CyberEdgeLetter}${CyberEdgeLetter}`;
}

export type CyberLetterOccupancy = ReadonlyMap<string, CyberLetterOccupant>;

/**
 * Empty side must be A. Occupied letter neighbor must not be A.
 * Adjacent occupied cells must share the same letter on the shared edge.
 */
export type CyberEdgeConstraint = CyberEdgeLetter | 'connected';

const SIDE_NAMES = ['top', 'right', 'bottom', 'left'] as const;

export interface CyberLetterMismatch {
  x: number;
  y: number;
  side: typeof SIDE_NAMES[number];
  cellLetter: CyberEdgeLetter;
  neighborLetter: CyberEdgeLetter | null;
}

const SIDES = [
  { dx: 0, dy: -1, index: 0, opposite: 2 },
  { dx: 1, dy: 0, index: 1, opposite: 3 },
  { dx: 0, dy: 1, index: 2, opposite: 0 },
  { dx: -1, dy: 0, index: 3, opposite: 1 },
] as const;

interface CanonicalConcretePick {
  localIndex: number;
  flipX: boolean;
  flipY: boolean;
}

/**
 * Cyber has many letter-compatible cells that are not visually neutral. Keep
 * the audited Concrete vocabulary by socket. Side tiles may swap left/right
 * art (21 vs 23) as long as A still faces the void, and may flip along the
 * wall. Top and bottom swap 15 / 62 the same way, flipping vertically so A
 * stays on the exterior, and may also flip horizontally. Convex outer
 * corners shuffle 14 / 25 / 30, flipped so A stays on the two void sides.
 * CCCC fill uses 64, with rare 82 (flips allowed). 64 is a flat fill so
 * it does not cycle through flips.
 */
function concreteConvexCornerPicks(flipX: boolean, flipY: boolean): readonly CanonicalConcretePick[] {
  return [
    { localIndex: 14, flipX, flipY },
    { localIndex: 25, flipX, flipY },
    { localIndex: 30, flipX: !flipX, flipY },
  ];
}

const CANONICAL_CONCRETE_PICKS: Readonly<Partial<Record<string, readonly CanonicalConcretePick[]>>> = {
  AAAA: [{ localIndex: 20, flipX: false, flipY: false }],
  AAEA: [{ localIndex: 19, flipX: false, flipY: false }],
  EAAA: [{ localIndex: 19, flipX: false, flipY: true }],
  AAAE: [{ localIndex: 71, flipX: false, flipY: false }],
  AEAA: [{ localIndex: 71, flipX: true, flipY: false }],
  AEAE: [{ localIndex: 68, flipX: false, flipY: false }],
  EAEA: [{ localIndex: 31, flipX: false, flipY: false }],
  AEEA: [{ localIndex: 67, flipX: false, flipY: true }],
  AAEE: [{ localIndex: 67, flipX: true, flipY: true }],
  EEAA: [{ localIndex: 67, flipX: false, flipY: false }],
  EAAE: [{ localIndex: 67, flipX: true, flipY: false }],
  ABBA: concreteConvexCornerPicks(false, false),
  AABB: concreteConvexCornerPicks(true, false),
  ABCB: [
    { localIndex: 15, flipX: false, flipY: false },
    { localIndex: 15, flipX: true, flipY: false },
    { localIndex: 16, flipX: false, flipY: false },
    { localIndex: 16, flipX: true, flipY: false },
    { localIndex: 62, flipX: false, flipY: true },
    { localIndex: 62, flipX: true, flipY: true },
  ],
  CBAB: [
    { localIndex: 62, flipX: false, flipY: false },
    { localIndex: 62, flipX: true, flipY: false },
    { localIndex: 15, flipX: false, flipY: true },
    { localIndex: 15, flipX: true, flipY: true },
    { localIndex: 16, flipX: false, flipY: true },
    { localIndex: 16, flipX: true, flipY: true },
  ],
  BCBA: [
    { localIndex: 21, flipX: true, flipY: false },
    { localIndex: 21, flipX: true, flipY: true },
    { localIndex: 23, flipX: false, flipY: false },
    { localIndex: 23, flipX: false, flipY: true },
  ],
  BABC: [
    { localIndex: 23, flipX: true, flipY: false },
    { localIndex: 23, flipX: true, flipY: true },
    { localIndex: 21, flipX: false, flipY: false },
    { localIndex: 21, flipX: false, flipY: true },
  ],
  BBAA: concreteConvexCornerPicks(false, true),
  BAAB: concreteConvexCornerPicks(true, true),
  BBCC: [
    { localIndex: 33, flipX: false, flipY: false },
    { localIndex: 35, flipX: true, flipY: false },
    { localIndex: 11, flipX: true, flipY: true },
  ],
  BCCB: [
    { localIndex: 35, flipX: false, flipY: false },
    { localIndex: 33, flipX: true, flipY: false },
    { localIndex: 11, flipX: false, flipY: true },
  ],
  CCBB: [
    { localIndex: 11, flipX: false, flipY: false },
    { localIndex: 33, flipX: true, flipY: true },
    { localIndex: 35, flipX: false, flipY: true },
  ],
  CBBC: [
    { localIndex: 11, flipX: true, flipY: false },
    { localIndex: 33, flipX: false, flipY: true },
    { localIndex: 35, flipX: true, flipY: true },
  ],
  CCCC: [
    { localIndex: 64, flipX: false, flipY: false },
    { localIndex: 82, flipX: false, flipY: false },
    { localIndex: 82, flipX: true, flipY: false },
    { localIndex: 82, flipX: false, flipY: true },
    { localIndex: 82, flipX: true, flipY: true },
  ],
  EEEE: [{ localIndex: 43, flipX: false, flipY: false }],
  AEEE: [{ localIndex: 70, flipX: false, flipY: false }],
  EEAE: [{ localIndex: 70, flipX: false, flipY: true }],
  EEEA: [{ localIndex: 55, flipX: false, flipY: false }],
  EAEE: [{ localIndex: 55, flipX: true, flipY: false }],
  ACCC: [{ localIndex: 81, flipX: false, flipY: false }],
  CCAC: [{ localIndex: 81, flipX: false, flipY: true }],
};

function canonicalConcreteMatches(
  edgeKey: string,
  matches: readonly CyberLetterPick[],
): CyberLetterPick[] {
  const preferred = CANONICAL_CONCRETE_PICKS[edgeKey];
  if (!preferred) return [];
  return matches.filter((candidate) => preferred.some((pick) => (
    candidate.localIndex === pick.localIndex
    && candidate.flipX === pick.flipX
    && candidate.flipY === pick.flipY
  )));
}

export function letterCellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function edgeAt(
  edges: `${CyberEdgeLetter}${CyberEdgeLetter}${CyberEdgeLetter}${CyberEdgeLetter}`,
  index: number,
): CyberEdgeLetter {
  return edges[index] as CyberEdgeLetter;
}

function matchesConstraints(
  edges: `${CyberEdgeLetter}${CyberEdgeLetter}${CyberEdgeLetter}${CyberEdgeLetter}`,
  constraints: ReadonlyArray<CyberEdgeConstraint>,
): boolean {
  return constraints.every((constraint, index) => {
    const letter = edgeAt(edges, index);
    if (constraint === 'connected') return letter !== 'A';
    return letter === constraint;
  });
}

export function listCyberLetterMatches(
  brushId: CyberLetterBrushId,
  constraints: ReadonlyArray<CyberEdgeConstraint>,
): CyberLetterPick[] {
  const matches: CyberLetterPick[] = [];
  for (const entry of catalogEntriesForBrush(brushId)) {
    if (CYBER_SUPPORT_ONLY_LOCAL_INDICES.has(entry.localIndex)) continue;
    for (const flipX of [false, true]) {
      for (const flipY of [false, true]) {
        const edges = flipCatalogEdges(entry.edges, flipX, flipY);
        if (!matchesConstraints(edges, constraints)) continue;
        matches.push({
          localIndex: entry.localIndex,
          flipX,
          flipY,
          rare: entry.rare,
          edges,
        });
      }
    }
  }
  return matches;
}

const enclosedConcreteCache = new WeakMap<CyberLetterOccupancy, ReadonlySet<string>>();

/**
 * Concrete components whose every non-Concrete cardinal neighbor is Shell.
 * Those blobs sit in a yellow Shell field, so they autotile like an isolated
 * Concrete shape (14-family diamond / octagon) and the Shell stays yellow.
 * Only solid blobs (every cell has 2+ Concrete neighbors) count, so 1-wide
 * tips and plus-arms keep Shell cladding.
 */
function enclosedConcreteCellKeys(occupancy: CyberLetterOccupancy): ReadonlySet<string> {
  const cached = enclosedConcreteCache.get(occupancy);
  if (cached) return cached;
  const enclosed = new Set<string>();
  const visited = new Set<string>();
  for (const [start, occupant] of occupancy) {
    if (occupant.brushId !== 'cyber.concrete' || visited.has(start)) continue;
    const component: string[] = [];
    const stack = [start];
    visited.add(start);
    while (stack.length > 0) {
      const key = stack.pop()!;
      component.push(key);
      const [cx, cy] = key.split(',').map(Number);
      for (const side of SIDES) {
        const nextKey = letterCellKey(cx + side.dx, cy + side.dy);
        const next = occupancy.get(nextKey);
        if (next?.brushId !== 'cyber.concrete' || visited.has(nextKey)) continue;
        visited.add(nextKey);
        stack.push(nextKey);
      }
    }
    const wrapped = component.every((key) => {
      const [cx, cy] = key.split(',').map(Number);
      return SIDES.every((side) => {
        const neighbor = occupancy.get(letterCellKey(cx + side.dx, cy + side.dy));
        return neighbor?.brushId === 'cyber.concrete' || neighbor?.brushId === 'cyber.shell';
      });
    });
    const solid = component.every((key) => {
      const [cx, cy] = key.split(',').map(Number);
      const concreteNeighbors = SIDES.filter((side) => (
        occupancy.get(letterCellKey(cx + side.dx, cy + side.dy))?.brushId === 'cyber.concrete'
      )).length;
      return concreteNeighbors >= 2;
    });
    if (wrapped && solid) {
      for (const key of component) enclosed.add(key);
    }
  }
  enclosedConcreteCache.set(occupancy, enclosed);
  return enclosed;
}

function isOccupiedLetterNeighbor(
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
  inBounds: (x: number, y: number) => boolean,
  selfX = x,
  selfY = y,
): boolean {
  if (!inBounds(x, y)) return false;
  const neighbor = occupancy.get(letterCellKey(x, y));
  if (!neighbor) return false;
  const self = occupancy.get(letterCellKey(selfX, selfY));
  if (
    self?.brushId === 'cyber.concrete'
    && neighbor.brushId === 'cyber.shell'
    && enclosedConcreteCellKeys(occupancy).has(letterCellKey(selfX, selfY))
  ) {
    return false;
  }
  return true;
}

function occupiedSides(
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
  inBounds: (x: number, y: number) => boolean,
): boolean[] {
  return SIDES.map(({ dx, dy }) => (
    isOccupiedLetterNeighbor(x + dx, y + dy, occupancy, inBounds, x, y)
  ));
}

function emptyDiagonalFlags(
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
  inBounds: (x: number, y: number) => boolean,
): { se: boolean; sw: boolean; ne: boolean; nw: boolean } {
  return {
    se: !isOccupiedLetterNeighbor(x + 1, y + 1, occupancy, inBounds, x, y),
    sw: !isOccupiedLetterNeighbor(x - 1, y + 1, occupancy, inBounds, x, y),
    ne: !isOccupiedLetterNeighbor(x + 1, y - 1, occupancy, inBounds, x, y),
    nw: !isOccupiedLetterNeighbor(x - 1, y - 1, occupancy, inBounds, x, y),
  };
}

function isInnerCornerCell(
  occupied: readonly boolean[],
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
  inBounds: (x: number, y: number) => boolean,
): boolean {
  if (occupied.filter(Boolean).length !== 4) return false;
  const flags = emptyDiagonalFlags(x, y, occupancy, inBounds);
  return [flags.se, flags.sw, flags.ne, flags.nw].filter(Boolean).length === 1;
}

/** 1-cell stubs, opposite-edge strips, and hollow-frame corners — not blob corners. */
function isFrameOrStubNeighbor(
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
  inBounds: (x: number, y: number) => boolean,
): boolean {
  if (!isOccupiedLetterNeighbor(x, y, occupancy, inBounds)) return false;
  const occupied = occupiedSides(x, y, occupancy, inBounds);
  const count = occupied.filter(Boolean).length;
  if (count <= 1) return true;
  if (count >= 3) return false;
  const opposite = occupied[0] === occupied[2] && occupied[1] === occupied[3] && occupied[0] !== occupied[1];
  if (opposite) return true;
  const dirs = SIDES.filter((_, index) => occupied[index]);
  const diagonalX = x + dirs[0]!.dx + dirs[1]!.dx;
  const diagonalY = y + dirs[0]!.dy + dirs[1]!.dy;
  return !isOccupiedLetterNeighbor(diagonalX, diagonalY, occupancy, inBounds, x, y);
}

/**
 * Concrete 1-wide frames use E on occupied sides (AAEE corners, AEAE / EAEA
 * mids, EEEA / AEEE T-junctions, EEEE crosses). Solid blobs use B on outer
 * corners and C toward a filled interior.
 * Four-connected Concrete with one empty diagonal is a concave corner
 * (BBCC / CCBB / BCCB / CBBC; tiles 11, 33, 35), whether that bite is an
 * enclosed hole or an exterior armpit of a plus.
 * Cyber A10 is a foreground corner bit aimed at a missing diagonal.
 * A 3-connected edge uses E toward a thin stub or 1-cell frame instead of C,
 * so a protrusion can T-junction into a ring. A 1-cell stub or chimney over an
 * enclosed hole is the same socket (void opposite a thin arm): 55 / 70.
 */
function inferConcreteOccupiedLetter(
  occupied: readonly boolean[],
  sideIndex: number,
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
  inBounds: (x: number, y: number) => boolean,
): CyberEdgeLetter {
  const count = occupied.filter(Boolean).length;
  const opposite = occupied[SIDES[sideIndex]!.opposite] === true;
  if (count === 4) {
    const flags = emptyDiagonalFlags(x, y, occupancy, inBounds);
    const emptyDiagonals = [flags.se, flags.sw, flags.ne, flags.nw].filter(Boolean).length;
    if (emptyDiagonals === 4) return 'E';
    if (emptyDiagonals === 1) {
      const towardBite = flags.se && (sideIndex === 1 || sideIndex === 2)
        || flags.sw && (sideIndex === 2 || sideIndex === 3)
        || flags.ne && (sideIndex === 0 || sideIndex === 1)
        || flags.nw && (sideIndex === 0 || sideIndex === 3);
      return towardBite ? 'B' : 'C';
    }
    return 'C';
  }
  if (count === 3) {
    const emptyIndex = occupied.findIndex((side) => !side);
    const interiorIndex = SIDES[emptyIndex]!.opposite;
    if (isFrameOrStubNeighbor(
      x + SIDES[interiorIndex]!.dx,
      y + SIDES[interiorIndex]!.dy,
      occupancy,
      inBounds,
    )) {
      return 'E';
    }
    const flags = emptyDiagonalFlags(x, y, occupancy, inBounds);
    const hasFilledDiagonalBesideEmptySide = emptyIndex === 0
      ? !flags.nw || !flags.ne
      : emptyIndex === 1
        ? !flags.ne || !flags.se
        : emptyIndex === 2
          ? !flags.se || !flags.sw
          : !flags.sw || !flags.nw;
    const thin = hasFilledDiagonalBesideEmptySide && isFrameOrStubNeighbor(
      x + SIDES[sideIndex]!.dx,
      y + SIDES[sideIndex]!.dy,
      occupancy,
      inBounds,
    );
    if (sideIndex === interiorIndex) return thin ? 'E' : 'C';
    return thin ? 'E' : 'B';
  }
  if (count === 2 && opposite) return 'E';
  if (count === 2 && !opposite) {
    const dirs = SIDES.filter((_, index) => occupied[index]);
    const diagonalX = x + dirs[0]!.dx + dirs[1]!.dx;
    const diagonalY = y + dirs[0]!.dy + dirs[1]!.dy;
    const filledCorner = isOccupiedLetterNeighbor(diagonalX, diagonalY, occupancy, inBounds, x, y);
    return filledCorner ? 'B' : 'E';
  }
  if (count === 1) return 'E';
  return 'B';
}

function inferOccupiedLetter(
  brushId: CyberLetterBrushId,
  neighborBrushId: CyberLetterBrushId | undefined,
  occupied: readonly boolean[],
  sideIndex: number,
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
  inBounds: (x: number, y: number) => boolean,
): CyberEdgeLetter {
  if (neighborBrushId === 'cyber.windows' || brushId === 'cyber.windows') return 'I';
  // Neon infers J for itself. Concrete still treats a Neon neighbor as filled
  // occupancy (B/C/E) so armpits next to a pipe stay 11 / 33 / 35, not J-gap 64.
  if (brushId === 'cyber.neon') return 'J';
  if (brushId === 'cyber.shell' || neighborBrushId === 'cyber.shell') {
    const count = occupied.filter(Boolean).length;
    const opposite = occupied[SIDES[sideIndex]!.opposite] === true;
    if (count >= 3) return 'H';
    if (count === 2 && !opposite) return 'H';
    return 'G';
  }
  return inferConcreteOccupiedLetter(occupied, sideIndex, x, y, occupancy, inBounds);
}

export function constraintsFromLetterNeighbors(
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
  inBounds: (x: number, y: number) => boolean,
  brushId: CyberLetterBrushId,
): CyberEdgeConstraint[] {
  const occupied = occupiedSides(x, y, occupancy, inBounds);
  return SIDES.map(({ dx, dy, opposite }, sideIndex) => {
    const nx = x + dx;
    const ny = y + dy;
    if (!occupied[sideIndex] || !inBounds(nx, ny)) return 'A';
    const neighbor = occupancy.get(letterCellKey(nx, ny));
    if (!neighbor) return 'A';
    const inferred = inferOccupiedLetter(
      brushId,
      neighbor.brushId,
      occupied,
      sideIndex,
      x,
      y,
      occupancy,
      inBounds,
    );
    // Concrete letters come from occupancy so both sides of a shared edge
    // independently get the same B/C/E. Copying a neighbor pick lets E caps
    // and CCCC fill overwrite those sockets, then the fallback stamps 64
    // (C against a void). Window / Neon runs copy Concrete's B/C so a 1-high
    // strip can stay CICI / CJCJ, but two Window (or Neon) cells must keep I
    // (or J) on the shared edge or stacked strokes stay locked to the 1-high
    // cap. Shell still matches the neighbor's opposite letter so G/H abut.
    if (brushId === 'cyber.concrete' && neighbor.brushId === 'cyber.concrete') {
      return inferred;
    }
    if (
      (brushId === 'cyber.windows' && neighbor.brushId === 'cyber.windows')
      || (brushId === 'cyber.neon' && neighbor.brushId === 'cyber.neon')
      || (brushId === 'cyber.shell' && neighbor.brushId === 'cyber.shell')
    ) {
      return inferred;
    }
    if (!neighbor.pick) {
      if (brushId === 'cyber.shell' && neighbor.brushId === 'cyber.concrete') {
        return inferConcreteOccupiedLetter(
          occupiedSides(nx, ny, occupancy, inBounds),
          opposite,
          nx,
          ny,
          occupancy,
          inBounds,
        );
      }
      return inferred;
    }
    const letter = edgeAt(neighbor.pick.edges, opposite);
    if (letter === 'A') return inferred;
    if (isInnerCornerCell(occupied, x, y, occupancy, inBounds) || inferred === 'E') {
      return inferred;
    }
    if (
      brushId === 'cyber.shell'
      && neighbor.brushId === 'cyber.concrete'
      && letter !== 'B'
      && letter !== 'C'
      && letter !== 'E'
    ) {
      return 'C';
    }
    return letter;
  });
}

/** Empty sides must be A; occupied shared edges must be the same non-A letter. */
export function listCyberLetterMismatches(
  picks: ReadonlyMap<string, CyberLetterPick>,
  inBounds: (x: number, y: number) => boolean,
): CyberLetterMismatch[] {
  const mismatches: CyberLetterMismatch[] = [];
  for (const [key, pick] of picks) {
    const [x, y] = key.split(',').map(Number);
    for (const side of SIDES) {
      const mine = edgeAt(pick.edges, side.index);
      const neighbor = inBounds(x + side.dx, y + side.dy)
        ? picks.get(letterCellKey(x + side.dx, y + side.dy))
        : undefined;
      if (!neighbor) {
        if (mine !== 'A') {
          mismatches.push({
            x,
            y,
            side: SIDE_NAMES[side.index],
            cellLetter: mine,
            neighborLetter: null,
          });
        }
        continue;
      }
      const theirs = edgeAt(neighbor.edges, side.opposite);
      if (mine === 'A' || theirs === 'A' || mine !== theirs) {
        mismatches.push({
          x,
          y,
          side: SIDE_NAMES[side.index],
          cellLetter: mine,
          neighborLetter: theirs,
        });
      }
    }
  }
  return mismatches;
}

/** Any edge that faces empty (or out of bounds) must be A. */
export function listCyberVoidAViolations(
  picks: ReadonlyMap<string, CyberLetterPick>,
  inBounds: (x: number, y: number) => boolean,
): CyberLetterMismatch[] {
  return listCyberLetterMismatches(picks, inBounds).filter((mismatch) => mismatch.neighborLetter === null);
}

/**
 * Cyber A10 (index 9) is a foreground corner bit. Unflipped it is ZBBZ:
 * B on the right and bottom, Z (ignored) on top and left. Flips aim that
 * BB corner at a missing diagonal so two yellow edges can meet. That includes
 * 11 / 33 / 35 (enclosed tunnels and exterior bites) and solid sides / fill
 * with the same socket (stepped holes, paired-tunnel fill, stair treads).
 * Skip 1-cell nubs and hallway T-junctions in every direction: those empty
 * diagonals are open air beside a straight wall. Skip thin E frames; those
 * edges are already the whole cell.
 * extras 0 (index 7) uses A10 as a convex overlay: the tile already has the
 * straight orange socket, and A10 adds the L when exactly two adjacent sides
 * are void. Straight corridor ends and open void columns do not get it.
 */
const A10_SOCKETS = [
  { flipX: false, flipY: false, b: [1, 2], ddx: 1, ddy: 1 },
  { flipX: true, flipY: false, b: [3, 2], ddx: -1, ddy: 1 },
  { flipX: false, flipY: true, b: [1, 0], ddx: 1, ddy: -1 },
  { flipX: true, flipY: true, b: [3, 0], ddx: -1, ddy: -1 },
] as const;

function occupiedCardinals(
  x: number,
  y: number,
  picks: ReadonlyMap<string, CyberLetterPick>,
) {
  return SIDES.filter((side) => picks.has(letterCellKey(x + side.dx, y + side.dy)));
}

function isOneCellStub(
  x: number,
  y: number,
  picks: ReadonlyMap<string, CyberLetterPick>,
): boolean {
  if (!picks.has(letterCellKey(x, y))) return false;
  return occupiedCardinals(x, y, picks).length <= 1;
}

const INNER_CORNER_INDICES = new Set([11, 33, 35]);

function occupancyBounds(
  picks: ReadonlyMap<string, CyberLetterPick>,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (picks.size === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const key of picks.keys()) {
    const comma = key.indexOf(',');
    const x = Number(key.slice(0, comma));
    const y = Number(key.slice(comma + 1));
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function voidEscapesOccupancy(
  x: number,
  y: number,
  picks: ReadonlyMap<string, CyberLetterPick>,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  if (picks.has(letterCellKey(x, y))) return false;
  const visited = new Set<string>();
  const stack = [x, y];
  while (stack.length > 0) {
    const cy = stack.pop()!;
    const cx = stack.pop()!;
    if (cx < bounds.minX || cx > bounds.maxX || cy < bounds.minY || cy > bounds.maxY) {
      return true;
    }
    const key = letterCellKey(cx, cy);
    if (visited.has(key) || picks.has(key)) continue;
    visited.add(key);
    for (const side of SIDES) {
      stack.push(cx + side.dx, cy + side.dy);
    }
  }
  return false;
}

function classicA10Allowed(
  x: number,
  y: number,
  pick: CyberLetterPick,
  picks: ReadonlyMap<string, CyberLetterPick>,
  diagonalX: number,
  diagonalY: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  socketIndexes: readonly number[],
): boolean {
  if (INNER_CORNER_INDICES.has(pick.localIndex)) return true;
  const diagExterior = voidEscapesOccupancy(diagonalX, diagonalY, picks, bounds);
  if (!diagExterior) return true;
  const aEnclosed = SIDES.some((side, index) => (
    edgeAt(pick.edges, index) === 'A'
    && !picks.has(letterCellKey(x + side.dx, y + side.dy))
    && !voidEscapesOccupancy(x + side.dx, y + side.dy, picks, bounds)
  ));
  if (aEnclosed) return true;
  const aIndexes = SIDES
    .map((side) => side.index)
    .filter((index) => edgeAt(pick.edges, index) === 'A');
  if (aIndexes.length === 0) return false;
  return socketIndexes.some((sideIndex) => {
    const side = SIDES[sideIndex]!;
    if (!isOneCellStub(x + side.dx, y + side.dy, picks)) return false;
    return aIndexes.some((aIndex) => (SIDES[aIndex]!.dx === 0) !== (side.dx === 0));
  });
}

function occupiedLetterNeighbor(
  x: number,
  y: number,
  picks: ReadonlyMap<string, CyberLetterPick>,
): boolean {
  return picks.has(letterCellKey(x, y));
}

/**
 * extras 0 (index 7) already has the straight orange socket. When that cell is
 * also a convex drop-off (exactly two adjacent voids), A10 supplies the L.
 */
function orientNeonExtras0CornerOverlay(
  x: number,
  y: number,
  picks: ReadonlyMap<string, CyberLetterPick>,
): { flipX: boolean; flipY: boolean } | null {
  const top = occupiedLetterNeighbor(x, y - 1, picks);
  const right = occupiedLetterNeighbor(x + 1, y, picks);
  const bot = occupiedLetterNeighbor(x, y + 1, picks);
  const left = occupiedLetterNeighbor(x - 1, y, picks);
  const voidCount = Number(!top) + Number(!right) + Number(!bot) + Number(!left);
  if (voidCount !== 2) return null;
  if (!bot && !right && top && left) return { flipX: false, flipY: false };
  if (!bot && !left && top && right) return { flipX: true, flipY: false };
  if (!top && !right && bot && left) return { flipX: false, flipY: true };
  if (!top && !left && bot && right) return { flipX: true, flipY: true };
  return null;
}

export function orientCyberA10Overlay(
  x: number,
  y: number,
  pick: CyberLetterPick,
  picks: ReadonlyMap<string, CyberLetterPick>,
): { flipX: boolean; flipY: boolean } | null {
  if (pick.localIndex === 7) return orientNeonExtras0CornerOverlay(x, y, picks);
  const bounds = occupancyBounds(picks);
  if (!bounds) return null;
  for (const socket of A10_SOCKETS) {
    const diagonalX = x + socket.ddx;
    const diagonalY = y + socket.ddy;
    const diagonalOccupied = picks.has(letterCellKey(diagonalX, diagonalY));
    const sides = socket.b.map((sideIndex) => {
      const side = SIDES[sideIndex];
      return {
        letter: edgeAt(pick.edges, sideIndex),
        occupied: picks.has(letterCellKey(x + side.dx, y + side.dy)),
      };
    });
    if (!diagonalOccupied) {
      const fits = sides.every((side) => side.letter !== 'E' && side.occupied);
      if (
        fits
        && classicA10Allowed(x, y, pick, picks, diagonalX, diagonalY, bounds, socket.b)
      ) {
        return { flipX: socket.flipX, flipY: socket.flipY };
      }
      continue;
    }
  }
  return null;
}

function neonTouchesConcrete(
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
): boolean {
  return SIDES.some((side) => (
    occupancy.get(letterCellKey(x + side.dx, y + side.dy))?.brushId === 'cyber.concrete'
  ));
}

function concreteNearCell(
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
): boolean {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      if (occupancy.get(letterCellKey(x + dx, y + dy))?.brushId === 'cyber.concrete') return true;
    }
  }
  return false;
}

/** Empty side that faces a Concrete hole, so 49/7 should socket into that edge. */
function neonConcreteHoleSide(
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
): number | null {
  let winner: number | null = null;
  for (const side of SIDES) {
    const nx = x + side.dx;
    const ny = y + side.dy;
    if (occupancy.has(letterCellKey(nx, ny))) continue;
    if (!concreteNearCell(nx, ny, occupancy)) continue;
    if (winner !== null) return null;
    winner = side.index;
  }
  return winner;
}

function seedWindowsOrNeon(
  brushId: 'cyber.windows' | 'cyber.neon',
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
): CyberLetterPick {
  const top = occupancy.has(letterCellKey(x, y - 1));
  const right = occupancy.has(letterCellKey(x + 1, y));
  const bottom = occupancy.has(letterCellKey(x, y + 1));
  const left = occupancy.has(letterCellKey(x - 1, y));
  if (brushId === 'cyber.neon') {
    const onConcreteEdge = neonTouchesConcrete(x, y, occupancy) && !(top && right && bottom && left);
    if (onConcreteEdge) {
      const flipX = left && !right;
      return {
        localIndex: 49,
        flipX,
        flipY: false,
        edges: flipCatalogEdges('BJBA', flipX, false),
      };
    }
    const seed = CYBER_BRUSH_SEEDS['cyber.neon'];
    return {
      localIndex: seed.localIndex,
      flipX: false,
      flipY: false,
      edges: seed.edges,
    };
  }
  const seed = CYBER_BRUSH_SEEDS[brushId];
  const flipX = left && !right;
  const edges = flipCatalogEdges(seed.edges, flipX, false);
  return {
    localIndex: seed.localIndex,
    flipX,
    flipY: false,
    edges,
  };
}

function seedShell(): CyberLetterPick {
  const seed = CYBER_BRUSH_SEEDS['cyber.shell'];
  return {
    localIndex: seed.localIndex,
    flipX: false,
    flipY: false,
    edges: seed.edges,
  };
}

function voidLockedConstraints(
  constraints: readonly CyberEdgeConstraint[],
): CyberEdgeConstraint[] {
  return constraints.map((constraint) => (constraint === 'A' ? 'A' : 'connected'));
}

function letterAgreementScore(
  edges: `${CyberEdgeLetter}${CyberEdgeLetter}${CyberEdgeLetter}${CyberEdgeLetter}`,
  constraints: readonly CyberEdgeConstraint[],
): number {
  let score = 0;
  for (let index = 0; index < 4; index += 1) {
    const constraint = constraints[index]!;
    const letter = edgeAt(edges, index);
    if (constraint === 'A') {
      if (letter !== 'A') return Number.NEGATIVE_INFINITY;
      continue;
    }
    if (constraint === 'connected') {
      if (letter === 'A') return Number.NEGATIVE_INFINITY;
      continue;
    }
    if (letter === 'A') return Number.NEGATIVE_INFINITY;
    if (letter === constraint) score += 2;
  }
  return score;
}

function mergeShellFillCycle(
  brushId: CyberLetterBrushId,
  constraints: readonly CyberEdgeConstraint[],
  pool: readonly CyberLetterPick[],
  salt: number,
): readonly CyberLetterPick[] {
  if (brushId !== 'cyber.shell' || salt === 0) return pool;
  if (pool.some((candidate) => candidate.localIndex === 52)) return pool;
  const fill = listCyberLetterMatches(brushId, voidLockedConstraints(constraints))
    .filter((candidate) => candidate.localIndex === 40 || candidate.localIndex === 53);
  return fill.length > 0 ? [...pool, ...fill] : pool;
}

function catalogOrientedPick(
  localIndex: number,
  flipX: boolean,
  flipY: boolean,
  brushId: CyberLetterBrushId,
): CyberLetterPick | null {
  const entry = catalogEntriesForBrush(brushId).find((row) => row.localIndex === localIndex);
  if (!entry) return null;
  return {
    localIndex,
    flipX,
    flipY,
    edges: flipCatalogEdges(entry.edges, flipX, flipY),
  };
}

function pickShellCatalogLook(
  brushId: CyberLetterBrushId,
  x: number,
  y: number,
  constraints: readonly CyberEdgeConstraint[],
  occupancy: CyberLetterOccupancy,
  pool: readonly CyberLetterPick[],
  avoid: readonly CyberOrientedTile[],
): CyberLetterPick {
  if (brushId === 'cyber.neon') {
    return pickCanonicalCatalogCandidate(pool);
  }
  const salt = occupancy.get(letterCellKey(x, y))?.varietySalt ?? 0;
  const edgeKey = `${constraints[0]}${constraints[1]}${constraints[2]}${constraints[3]}`;
  const neighborAvoid = edgeKey === 'CCCC' || edgeKey === 'HHHH' ? [] : avoid;
  return pickVariedCatalogCandidate(
    mergeShellFillCycle(brushId, constraints, pool, salt),
    x,
    y,
    { avoid: neighborAvoid, salt },
  );
}

function pickForConstraints(
  brushId: CyberLetterBrushId,
  x: number,
  y: number,
  constraints: readonly CyberEdgeConstraint[],
  occupancy: CyberLetterOccupancy,
  avoid: readonly CyberOrientedTile[] = [],
): CyberLetterPick | null {
  const matches = listCyberLetterMatches(brushId, constraints);
  if (matches.length === 0) return null;
  const edgeKey = `${constraints[0]}${constraints[1]}${constraints[2]}${constraints[3]}`;
  const exact = matches.filter((candidate) => candidate.edges === edgeKey);
  const canonical = brushId === 'cyber.concrete'
    ? canonicalConcreteMatches(edgeKey, exact)
    : [];
  const pool = canonical.length > 0
    ? canonical
    : exact.length > 0
      ? exact
      : matches;
  const chosen = preferShellCladdingArt(
    brushId,
    x,
    y,
    occupancy,
    preferWindowOrNeonStackArt(brushId, x, y, constraints, occupancy, pool),
  );
  return pickShellCatalogLook(brushId, x, y, constraints, occupancy, chosen, avoid);
}

/** Catalog pick that always keeps A on void sides. Occupied letters may relax. */
function pickRespectingVoids(
  brushId: CyberLetterBrushId,
  x: number,
  y: number,
  constraints: readonly CyberEdgeConstraint[],
  occupancy: CyberLetterOccupancy,
  avoid: readonly CyberOrientedTile[] = [],
): CyberLetterPick | null {
  if (brushId === 'cyber.shell') {
    const voidMatches = listCyberLetterMatches(brushId, voidLockedConstraints(constraints));
    const cladding = preferShellCladdingArt(brushId, x, y, occupancy, voidMatches);
    if (cladding !== voidMatches && cladding.length > 0) {
      let claddingBest = Number.NEGATIVE_INFINITY;
      for (const candidate of cladding) {
        claddingBest = Math.max(claddingBest, letterAgreementScore(candidate.edges, constraints));
      }
      const rankedCladding = cladding.filter((candidate) => (
        letterAgreementScore(candidate.edges, constraints) === claddingBest
      ));
      return pickShellCatalogLook(brushId, x, y, constraints, occupancy, rankedCladding, avoid);
    }
  }
  const exact = pickForConstraints(brushId, x, y, constraints, occupancy, avoid);
  if (exact) return exact;
  const relaxOccupied = brushId === 'cyber.windows' || brushId === 'cyber.neon' || brushId === 'cyber.shell';
  if (!relaxOccupied && !constraints.some((constraint) => constraint === 'A')) return null;
  const matches = listCyberLetterMatches(brushId, voidLockedConstraints(constraints));
  if (matches.length === 0) return null;
  let best = Number.NEGATIVE_INFINITY;
  for (const candidate of matches) {
    best = Math.max(best, letterAgreementScore(candidate.edges, constraints));
  }
  const ranked = matches.filter((candidate) => (
    letterAgreementScore(candidate.edges, constraints) === best
  ));
  const edgeKey = `${constraints[0]}${constraints[1]}${constraints[2]}${constraints[3]}`;
  const canonical = brushId === 'cyber.concrete'
    ? canonicalConcreteMatches(edgeKey, ranked.filter((candidate) => candidate.edges === edgeKey))
    : [];
  const pool = canonical.length > 0 ? canonical : ranked;
  const chosen = preferShellCladdingArt(
    brushId,
    x,
    y,
    occupancy,
    preferWindowOrNeonStackArt(brushId, x, y, constraints, occupancy, pool),
  );
  return pickShellCatalogLook(brushId, x, y, constraints, occupancy, chosen, avoid);
}

function neighborBrush(
  x: number,
  y: number,
  dx: number,
  dy: number,
  occupancy: CyberLetterOccupancy,
): CyberLetterBrushId | undefined {
  return occupancy.get(letterCellKey(x + dx, y + dy))?.brushId;
}

type ShellNeighbor = CyberLetterBrushId | undefined;

/**
 * Unflipped 17 is voids on top+right, Concrete on the left, Shell below.
 * FlipX for a left void, flipY for a bottom void.
 */
function preferSeventeenOuterCorner(
  _pool: readonly CyberLetterPick[],
  top: ShellNeighbor,
  right: ShellNeighbor,
  bottom: ShellNeighbor,
  left: ShellNeighbor,
): readonly CyberLetterPick[] | null {
  const usesSeventeen = (
    (!top && !right && left === 'cyber.concrete' && bottom === 'cyber.shell')
    || (!top && !left && right === 'cyber.concrete' && bottom === 'cyber.shell')
    || (!bottom && !right && left === 'cyber.concrete' && top === 'cyber.shell')
    || (!bottom && !left && right === 'cyber.concrete' && top === 'cyber.shell')
  );
  if (!usesSeventeen) return null;
  const pick = catalogOrientedPick(17, !left, !bottom, 'cyber.shell');
  return pick ? [pick] : null;
}

/**
 * Unflipped 83 is ADBA: voids on top+left, Shell on the right, Concrete below.
 * That is a 90° rotation of 17; flips cannot produce it, so 83 is its own tile.
 * FlipX for a right void, flipY for a bottom void. 82 is flat CCCC fill, not this art.
 */
function preferRotatedOuterCorner(
  _pool: readonly CyberLetterPick[],
  top: ShellNeighbor,
  right: ShellNeighbor,
  bottom: ShellNeighbor,
  left: ShellNeighbor,
): readonly CyberLetterPick[] | null {
  const usesRotated = (
    (!top && !left && right === 'cyber.shell' && bottom === 'cyber.concrete')
    || (!top && !right && left === 'cyber.shell' && bottom === 'cyber.concrete')
    || (!bottom && !left && right === 'cyber.shell' && top === 'cyber.concrete')
    || (!bottom && !right && left === 'cyber.shell' && top === 'cyber.concrete')
  );
  if (!usesRotated) return null;
  const pick = catalogOrientedPick(83, !right, !bottom, 'cyber.shell');
  return pick ? [pick] : null;
}

/**
 * 61 sits on a Shell cell at the corner of a ≥3x3 blob whose Concrete
 * cells form a cross (center plus cardinals) and whose four corners are
 * Shell. The same chamfer wraps a Concrete rectangle that is missing its
 * four outer corners (Shell on the eight edge cells): 17/83 would cut a
 * yellow triangle through those cells; 61 keeps grey fill with a yellow
 * bite toward the two voids. Unflipped 61 is BBAA: voids on bottom+left,
 * Concrete on top+right. Support is 36 / 48 / 60 / 72 and is never this pick.
 */
function shellCornerHasCementCross(
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
  occupied: readonly { dx: number; dy: number }[],
): boolean {
  if (occupied.length !== 2) return false;
  const cx = x + occupied[0]!.dx + occupied[1]!.dx;
  const cy = y + occupied[0]!.dy + occupied[1]!.dy;
  if (occupancy.get(letterCellKey(cx, cy))?.brushId !== 'cyber.concrete') return false;
  const pocket = new Set([
    letterCellKey(x + occupied[0]!.dx, y + occupied[0]!.dy),
    letterCellKey(x + occupied[1]!.dx, y + occupied[1]!.dy),
  ]);
  return SIDES.some((side) => {
    const key = letterCellKey(cx + side.dx, cy + side.dy);
    if (pocket.has(key) || (cx + side.dx === x && cy + side.dy === y)) return false;
    return occupancy.get(key)?.brushId === 'cyber.concrete';
  });
}

/**
 * Shell that wraps an enclosed Concrete blob is a yellow field, not cladding.
 * Outer edges use 27 / 54 (the same rim as a solid Shell blob) so a 1-thick
 * frame keeps a continuous outline. Fully surrounded cells (armpits) use 53.
 */
function preferEnclosedShellFill(
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
  top: ShellNeighbor,
  right: ShellNeighbor,
  bottom: ShellNeighbor,
  left: ShellNeighbor,
): readonly CyberLetterPick[] | null {
  const enclosed = enclosedConcreteCellKeys(occupancy);
  if (enclosed.size === 0) return null;
  const touchesEnclosedConcrete = SIDES.some((side) => (
    occupancy.get(letterCellKey(x + side.dx, y + side.dy))?.brushId === 'cyber.concrete'
    && enclosed.has(letterCellKey(x + side.dx, y + side.dy))
  ));
  if (!touchesEnclosedConcrete) return null;
  const letterFor = (neighbor: ShellNeighbor) => (neighbor ? 'H' : 'A');
  const edges = `${letterFor(top)}${letterFor(right)}${letterFor(bottom)}${letterFor(left)}` as const;
  const withEdges = (pick: CyberLetterPick | null) => (pick ? [{ ...pick, edges }] : null);
  if (!top && !left && right && bottom) {
    return withEdges(catalogOrientedPick(66, true, true, 'cyber.shell'));
  }
  if (!top && !right && left && bottom) {
    return withEdges(catalogOrientedPick(66, false, true, 'cyber.shell'));
  }
  if (!bottom && !left && right && top) {
    return withEdges(catalogOrientedPick(66, true, false, 'cyber.shell'));
  }
  if (!bottom && !right && left && top) {
    return withEdges(catalogOrientedPick(66, false, false, 'cyber.shell'));
  }
  if (!top && left && right) return withEdges(catalogOrientedPick(27, false, false, 'cyber.shell'));
  if (!bottom && left && right) return withEdges(catalogOrientedPick(27, false, true, 'cyber.shell'));
  if (!left && top && bottom) return withEdges(catalogOrientedPick(54, true, false, 'cyber.shell'));
  if (!right && top && bottom) return withEdges(catalogOrientedPick(54, false, false, 'cyber.shell'));
  return [{
    localIndex: 53,
    flipX: false,
    flipY: false,
    edges,
  }];
}

/**
 * 29 is the yellow stair meeting the blob's top or bottom edge. 17 is that
 * same meeting when it is also an outer void corner. 83 is the 90° rotation
 * of that corner (ADBA) for the other Concrete/Shell pairing. 52 has no A
 * sides, so it never sits on a void. 78 is a 1-cell point beside a 1-high
 * Concrete tip. Two mirrored 52s make the 2-wide valley.
 */
function preferShellCladdingArt(
  brushId: CyberLetterBrushId,
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
  pool: readonly CyberLetterPick[],
): readonly CyberLetterPick[] {
  if (brushId !== 'cyber.shell' || pool.length === 0) return pool;
  const top = neighborBrush(x, y, 0, -1, occupancy);
  const right = neighborBrush(x, y, 1, 0, occupancy);
  const bottom = neighborBrush(x, y, 0, 1, occupancy);
  const left = neighborBrush(x, y, -1, 0, occupancy);
  const sides = [top, right, bottom, left];
  const voidCount = sides.filter((side) => !side).length;
  const concreteCount = sides.filter((side) => side === 'cyber.concrete').length;
  const shellCount = sides.filter((side) => side === 'cyber.shell').length;
  const horizontalVoid = !top || !bottom;
  const verticalVoid = !left || !right;

  const enclosedFill = preferEnclosedShellFill(x, y, occupancy, top, right, bottom, left);
  if (enclosedFill) return enclosedFill;

  if (voidCount === 2 && concreteCount === 2 && shellCount === 0) {
    const occupied = SIDES.filter((_, index) => sides[index]);
    if (shellCornerHasCementCross(x, y, occupancy, occupied)) {
      const pick = catalogOrientedPick(
        CYBER_SHELL_CLADDING_LOCAL_INDEX,
        left === 'cyber.concrete',
        bottom === 'cyber.concrete',
        'cyber.shell',
      );
      if (pick) return [pick];
    }
    const withoutCladding = pool.filter((candidate) => (
      candidate.localIndex !== CYBER_SHELL_CLADDING_LOCAL_INDEX
      && !CYBER_SUPPORT_ONLY_LOCAL_INDICES.has(candidate.localIndex)
    ));
    if (withoutCladding.length > 0) return withoutCladding;
  }
  if (voidCount === 2 && concreteCount === 1 && shellCount === 1) {
    const occupied = SIDES.filter((_, index) => sides[index]);
    if (occupied.length === 2) {
      const pocketX = x + occupied[0]!.dx + occupied[1]!.dx;
      const pocketY = y + occupied[0]!.dy + occupied[1]!.dy;
      if (occupancy.get(letterCellKey(pocketX, pocketY))?.brushId === 'cyber.concrete') {
        const chamfer = catalogOrientedPick(
          CYBER_SHELL_CLADDING_LOCAL_INDEX,
          !right,
          !top,
          'cyber.shell',
        );
        if (chamfer) return [chamfer];
      }
    }
    const seventeen = preferSeventeenOuterCorner(pool, top, right, bottom, left);
    if (seventeen) return seventeen;
    const rotated = preferRotatedOuterCorner(pool, top, right, bottom, left);
    if (rotated) return rotated;
  }
  if (voidCount === 1 && concreteCount === 2 && shellCount === 1 && horizontalVoid && !verticalVoid) {
    const preferred = pool.filter((candidate) => candidate.localIndex === 26);
    if (preferred.length > 0) return preferred;
  }
  if (voidCount === 1 && concreteCount === 1 && shellCount === 2 && verticalVoid && !horizontalVoid) {
    const flipX = !left;
    const flipY = bottom === 'cyber.concrete';
    const oriented = shellOrientation(pool, 42, flipX, flipY);
    if (oriented) return oriented;
  }
  if (voidCount === 1 && concreteCount === 1 && shellCount === 2 && horizontalVoid && !verticalVoid) {
    const preferred = pool.filter((candidate) => candidate.localIndex === 29);
    if (preferred.length > 0) return preferred;
  }
  if (voidCount === 0 && concreteCount === 2 && shellCount === 2) {
    const stair = catalogOrientedPick(52, right === 'cyber.concrete', top === 'cyber.concrete', 'cyber.shell');
    if (stair) return [stair];
  }
  if (voidCount === 0 && concreteCount === 1 && shellCount === 3) {
    const point = preferShellPointTile(x, y, occupancy, pool, right, left);
    if (point) return point;
    const valley = preferShellStairValley(x, y, occupancy, pool, top, right, bottom, left);
    if (valley) return valley;
    const fill = pool.filter((candidate) => candidate.localIndex === 53 || candidate.localIndex === 40);
    if (fill.length > 0) return fill;
  }
  return pool;
}

function isConcreteAt(
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
): boolean {
  return occupancy.get(letterCellKey(x, y))?.brushId === 'cyber.concrete';
}

function shellOrientation(
  pool: readonly CyberLetterPick[],
  localIndex: number,
  flipX: boolean,
  flipY: boolean,
): readonly CyberLetterPick[] | null {
  const preferred = pool.filter((candidate) => (
    candidate.localIndex === localIndex
    && candidate.flipX === flipX
    && candidate.flipY === flipY
  ));
  return preferred.length > 0 ? preferred : null;
}

/** 78 / 78X: Shell beside a 1-high Concrete tip, so both stairs meet in one cell. */
function preferShellPointTile(
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
  pool: readonly CyberLetterPick[],
  right: CyberLetterBrushId | undefined,
  left: CyberLetterBrushId | undefined,
): readonly CyberLetterPick[] | null {
  if (left === 'cyber.concrete' && !isConcreteAt(x - 1, y - 1, occupancy) && !isConcreteAt(x - 1, y + 1, occupancy)) {
    return shellOrientation(pool, 78, false, false);
  }
  if (right === 'cyber.concrete' && !isConcreteAt(x + 1, y - 1, occupancy) && !isConcreteAt(x + 1, y + 1, occupancy)) {
    return shellOrientation(pool, 78, true, false);
  }
  return null;
}

/**
 * Two mirrored 52s under (or over) a 2-wide Concrete pinch. Longer flats stay 53.
 */
function preferShellStairValley(
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
  pool: readonly CyberLetterPick[],
  top: CyberLetterBrushId | undefined,
  right: CyberLetterBrushId | undefined,
  bottom: CyberLetterBrushId | undefined,
  left: CyberLetterBrushId | undefined,
): readonly CyberLetterPick[] | null {
  if (top === 'cyber.concrete' && bottom === 'cyber.shell') {
    const aboveLeft = isConcreteAt(x - 1, y - 1, occupancy);
    const aboveRight = isConcreteAt(x + 1, y - 1, occupancy);
    if (right === 'cyber.shell' && aboveRight && !aboveLeft && !isConcreteAt(x + 2, y - 1, occupancy)) {
      return shellOrientation(pool, 52, true, true);
    }
    if (left === 'cyber.shell' && aboveLeft && !aboveRight && !isConcreteAt(x - 2, y - 1, occupancy)) {
      return shellOrientation(pool, 52, false, true);
    }
  }
  if (bottom === 'cyber.concrete' && top === 'cyber.shell') {
    const belowLeft = isConcreteAt(x - 1, y + 1, occupancy);
    const belowRight = isConcreteAt(x + 1, y + 1, occupancy);
    if (right === 'cyber.shell' && belowRight && !belowLeft && !isConcreteAt(x + 2, y + 1, occupancy)) {
      return shellOrientation(pool, 52, true, false);
    }
    if (left === 'cyber.shell' && belowLeft && !belowRight && !isConcreteAt(x - 2, y + 1, occupancy)) {
      return shellOrientation(pool, 52, false, false);
    }
  }
  return null;
}

/** Open A side of a 3-connected neon cell on a filled blob (both inward diagonals occupied). */
function neonFilledBlobOpenSide(
  x: number,
  y: number,
  constraints: readonly CyberEdgeConstraint[],
  occupancy: CyberLetterOccupancy,
): number | null {
  const open = constraints.findIndex((constraint) => constraint === 'A');
  if (open < 0) return null;
  if (constraints.filter((constraint) => constraint === 'A').length !== 1) return null;
  if (constraints.filter((constraint) => constraint === 'J').length !== 3) return null;
  const inward = SIDES[SIDES[open]!.opposite]!;
  const along = SIDES.filter((side) => side.index !== open && side.index !== inward.index);
  const filled = along.every((side) => occupancy.has(
    letterCellKey(x + inward.dx + side.dx, y + inward.dy + side.dy),
  ));
  return filled ? open : null;
}

function preferWindowOrNeonStackArt(
  brushId: CyberLetterBrushId,
  x: number,
  y: number,
  constraints: readonly CyberEdgeConstraint[],
  occupancy: CyberLetterOccupancy,
  pool: readonly CyberLetterPick[],
): readonly CyberLetterPick[] {
  if (pool.length === 0) return pool;
  if (brushId === 'cyber.windows') {
    const endCap = constraints[1] === 'A' || constraints[3] === 'A';
    const stacked = constraints[0] === 'I' && constraints[2] === 'I';
    const preferredIndex = endCap || !stacked ? 37 : 38;
    const preferred = pool.filter((candidate) => candidate.localIndex === preferredIndex);
    return preferred.length > 0 ? preferred : pool;
  }
  if (brushId === 'cyber.neon') {
    const jTop = constraints[0] === 'J';
    const jRight = constraints[1] === 'J';
    const jBot = constraints[2] === 'J';
    const jLeft = constraints[3] === 'J';
    const jCount = Number(jTop) + Number(jRight) + Number(jBot) + Number(jLeft);
    const hasA = constraints.some((constraint) => constraint === 'A');
    const onConcrete = constraints.some((constraint) => constraint === 'B' || constraint === 'C');
    const blobOpen = neonFilledBlobOpenSide(x, y, constraints, occupancy);
    const holeSide = neonConcreteHoleSide(x, y, occupancy);
    const openA = constraints.findIndex((constraint) => constraint === 'A');
    const edgeOpen = blobOpen
      ?? holeSide
      ?? (
        hasA && neonTouchesConcrete(x, y, occupancy) && openA >= 0
          ? openA
          : null
      );
    let preferredIndex: number;
    if (jCount === 4) preferredIndex = 73;
    else if (edgeOpen === 1 || edgeOpen === 3) preferredIndex = 49;
    else if (edgeOpen === 0 || edgeOpen === 2) preferredIndex = 7;
    else if (jCount === 3) preferredIndex = (!jLeft || !jRight) ? 4 : 74;
    else if (jCount === 2 && jTop && jBot) preferredIndex = 6;
    else if (jCount === 2 && jLeft && jRight) preferredIndex = 50;
    else if (jCount === 2) preferredIndex = 75;
    else if (jCount === 1 && (jTop || jBot)) preferredIndex = 7;
    else if (jCount === 1) preferredIndex = 51;
    else preferredIndex = hasA && onConcrete ? 49 : 51;
    let preferred = pool.filter((candidate) => candidate.localIndex === preferredIndex);
    if (preferredIndex === 49 && (edgeOpen === 1 || edgeOpen === 3)) {
      const towardHole = preferred.filter((candidate) => candidate.flipX === (edgeOpen === 1));
      if (towardHole.length > 0) preferred = towardHole;
    }
    return preferred.length > 0 ? preferred : pool;
  }
  return pool;
}

export function seedCyberLetterPick(
  brushId: CyberLetterBrushId,
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
  inBounds: (nx: number, ny: number) => boolean,
): CyberLetterPick {
  const constraints = constraintsFromLetterNeighbors(x, y, occupancy, inBounds, brushId);
  const matched = pickRespectingVoids(brushId, x, y, constraints, occupancy);
  if (matched) return matched;
  if (brushId === 'cyber.windows' || brushId === 'cyber.neon') {
    return seedWindowsOrNeon(brushId, x, y, occupancy);
  }
  if (brushId === 'cyber.shell') return seedShell();
  const isolated = constraints.every((constraint) => constraint === 'A');
  const facesVoid = constraints.some((constraint) => constraint === 'A');
  const fallback = isolated || facesVoid
    ? CYBER_EDGE_CATALOG.find((entry) => entry.localIndex === 20 && entry.brushId === 'cyber.concrete')
    : CYBER_EDGE_CATALOG.find((entry) => entry.localIndex === 64 && entry.brushId === 'cyber.concrete');
  const entry = fallback ?? CYBER_EDGE_CATALOG.find((row) => row.brushId === 'cyber.concrete')!;
  return {
    localIndex: entry.localIndex,
    flipX: false,
    flipY: false,
    rare: entry.rare,
    edges: entry.edges,
  };
}

export function resolveCyberLetterPick(
  brushId: CyberLetterBrushId,
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
  inBounds: (nx: number, ny: number) => boolean,
  avoid: readonly CyberOrientedTile[] = [],
): CyberLetterPick {
  const constraints = constraintsFromLetterNeighbors(x, y, occupancy, inBounds, brushId);
  const matched = pickRespectingVoids(brushId, x, y, constraints, occupancy, avoid);
  if (matched) return matched;
  return seedCyberLetterPick(brushId, x, y, occupancy, inBounds);
}

export function resolveCyberLetterField(
  cells: ReadonlyArray<{ x: number; y: number; brushId: CyberLetterBrushId; varietySalt?: number }>,
  inBounds: (x: number, y: number) => boolean,
  passes = 4,
): Map<string, CyberLetterPick> {
  const occupancy = new Map<string, CyberLetterOccupant>();
  for (const cell of cells) {
    occupancy.set(letterCellKey(cell.x, cell.y), {
      brushId: cell.brushId,
      varietySalt: cell.varietySalt,
    });
  }
  for (const cell of cells) {
    const occupant = occupancy.get(letterCellKey(cell.x, cell.y))!;
    occupant.pick = seedCyberLetterPick(cell.brushId, cell.x, cell.y, occupancy, inBounds);
  }
  for (let pass = 0; pass < passes; pass += 1) {
    for (const cell of cells) {
      const key = letterCellKey(cell.x, cell.y);
      const avoid = SIDES
        .map(({ dx, dy }) => occupancy.get(letterCellKey(cell.x + dx, cell.y + dy))?.pick)
        .filter((pick): pick is CyberLetterPick => Boolean(pick));
      occupancy.get(key)!.pick = resolveCyberLetterPick(
        cell.brushId,
        cell.x,
        cell.y,
        occupancy,
        inBounds,
        avoid,
      );
    }
  }
  for (const cell of cells) {
    const occupant = occupancy.get(letterCellKey(cell.x, cell.y))!;
    const constraints = constraintsFromLetterNeighbors(
      cell.x, cell.y, occupancy, inBounds, cell.brushId,
    );
    if (
      occupant.pick
      && constraints.every((constraint, index) => (
        constraint !== 'A' || edgeAt(occupant.pick!.edges, index) === 'A'
      ))
    ) continue;
    occupant.pick = resolveCyberLetterPick(cell.brushId, cell.x, cell.y, occupancy, inBounds);
  }
  const resolved = new Map<string, CyberLetterPick>();
  for (const [key, occupant] of occupancy) {
    if (occupant.pick) resolved.set(key, occupant.pick);
  }
  return resolved;
}

export { isCyberLetterBrushId };
export { isCyberLetterCatalogLocalIndex } from './cyberEdgeCatalog';
