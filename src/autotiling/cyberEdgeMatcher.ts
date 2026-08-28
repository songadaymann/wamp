import {
  CYBER_BRUSH_SEEDS,
  CYBER_EDGE_CATALOG,
  catalogEntriesForBrush,
  flipCatalogEdges,
  isCyberLetterBrushId,
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
 * stays on the exterior, and may also flip horizontally. CCCC fill uses
 * 64 / 82 / 83 at every orientation.
 */
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
  ABBA: [{ localIndex: 14, flipX: false, flipY: false }],
  AABB: [{ localIndex: 14, flipX: true, flipY: false }],
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
  BBAA: [{ localIndex: 25, flipX: false, flipY: true }],
  BAAB: [{ localIndex: 30, flipX: false, flipY: true }],
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
  CCCC: [64, 82, 83].flatMap((localIndex) => (
    [false, true].flatMap((flipX) => (
      [false, true].map((flipY) => ({ localIndex, flipX, flipY }))
    ))
  )),
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

function isOccupiedLetterNeighbor(
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
  inBounds: (x: number, y: number) => boolean,
): boolean {
  if (!inBounds(x, y)) return false;
  return occupancy.has(letterCellKey(x, y));
}

function occupiedSides(
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
  inBounds: (x: number, y: number) => boolean,
): boolean[] {
  return SIDES.map(({ dx, dy }) => isOccupiedLetterNeighbor(x + dx, y + dy, occupancy, inBounds));
}

function emptyDiagonalFlags(
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
  inBounds: (x: number, y: number) => boolean,
): { se: boolean; sw: boolean; ne: boolean; nw: boolean } {
  return {
    se: !isOccupiedLetterNeighbor(x + 1, y + 1, occupancy, inBounds),
    sw: !isOccupiedLetterNeighbor(x - 1, y + 1, occupancy, inBounds),
    ne: !isOccupiedLetterNeighbor(x + 1, y - 1, occupancy, inBounds),
    nw: !isOccupiedLetterNeighbor(x - 1, y - 1, occupancy, inBounds),
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
  return !isOccupiedLetterNeighbor(diagonalX, diagonalY, occupancy, inBounds);
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
    const filledCorner = isOccupiedLetterNeighbor(diagonalX, diagonalY, occupancy, inBounds);
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
  if (neighborBrushId === 'cyber.neon' || brushId === 'cyber.neon') return 'J';
  if (brushId === 'cyber.shell' || neighborBrushId === 'cyber.shell') {
    const count = occupied.filter(Boolean).length;
    return count >= 3 ? 'H' : 'G';
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
    // (C against a void). Windows / Shell / Neon still match the neighbor's
    // opposite letter so I/J/G/H abut.
    if (brushId === 'cyber.concrete' && neighbor.brushId === 'cyber.concrete') {
      return inferred;
    }
    if (!neighbor.pick) return inferred;
    const letter = edgeAt(neighbor.pick.edges, opposite);
    if (letter === 'A') return inferred;
    if (isInnerCornerCell(occupied, x, y, occupancy, inBounds) || inferred === 'E') {
      return inferred;
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

export function orientCyberA10Overlay(
  x: number,
  y: number,
  pick: CyberLetterPick,
  picks: ReadonlyMap<string, CyberLetterPick>,
): { flipX: boolean; flipY: boolean } | null {
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

function seedWindowsOrNeon(
  brushId: 'cyber.windows' | 'cyber.neon',
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
): CyberLetterPick {
  const seed = CYBER_BRUSH_SEEDS[brushId];
  const left = occupancy.has(letterCellKey(x - 1, y));
  const right = occupancy.has(letterCellKey(x + 1, y));
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
  const salt = occupancy.get(letterCellKey(x, y))?.varietySalt ?? 0;
  const neighborAvoid = edgeKey === 'CCCC' ? [] : avoid;
  return pickVariedCatalogCandidate(pool, x, y, { avoid: neighborAvoid, salt });
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
  const exact = pickForConstraints(brushId, x, y, constraints, occupancy, avoid);
  if (exact) return exact;
  if (!constraints.some((constraint) => constraint === 'A')) return null;
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
  const salt = occupancy.get(letterCellKey(x, y))?.varietySalt ?? 0;
  const neighborAvoid = edgeKey === 'CCCC' ? [] : avoid;
  return pickVariedCatalogCandidate(pool, x, y, { avoid: neighborAvoid, salt });
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
