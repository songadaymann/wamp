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

/** Empty side must be A. Occupied letter neighbor must not be A. */
export type CyberEdgeConstraint = CyberEdgeLetter | 'connected';

const SIDES = [
  { dx: 0, dy: -1, index: 0, opposite: 2 },
  { dx: 1, dy: 0, index: 1, opposite: 3 },
  { dx: 0, dy: 1, index: 2, opposite: 0 },
  { dx: -1, dy: 0, index: 3, opposite: 1 },
] as const;

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
 * mids). Solid blobs use B on outer corners and C toward a filled interior.
 * A 4-connected cell with one empty diagonal is an inner corner (BBCC / CCBB
 * family, including flipX+flipY). A 3-connected edge uses E toward a thin
 * stub or 1-cell frame instead of C, so a protrusion can T-junction into a ring.
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
    const thin = isFrameOrStubNeighbor(
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
    if (!inBounds(nx, ny)) return 'A';
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
    if (!neighbor.pick) return inferred;
    const letter = edgeAt(neighbor.pick.edges, opposite);
    if (letter === 'A') return inferred;
    // Fill CCCC neighbors would otherwise overwrite inner corners and
    // T-junction E edges. Keep topology letters (B/C at a bite, E on a
    // stub/frame) even when the opposite catalog edge is C.
    if (isInnerCornerCell(occupied, x, y, occupancy, inBounds) || inferred === 'E') {
      return inferred;
    }
    return letter;
  });
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
  const pool = exact.length > 0 ? exact : matches;
  const salt = occupancy.get(letterCellKey(x, y))?.varietySalt ?? 0;
  return pickVariedCatalogCandidate(pool, x, y, { avoid, salt });
}

export function seedCyberLetterPick(
  brushId: CyberLetterBrushId,
  x: number,
  y: number,
  occupancy: CyberLetterOccupancy,
  inBounds: (nx: number, ny: number) => boolean,
): CyberLetterPick {
  const constraints = constraintsFromLetterNeighbors(x, y, occupancy, inBounds, brushId);
  const matched = pickForConstraints(brushId, x, y, constraints, occupancy);
  if (matched) return matched;
  if (brushId === 'cyber.windows' || brushId === 'cyber.neon') {
    return seedWindowsOrNeon(brushId, x, y, occupancy);
  }
  if (brushId === 'cyber.shell') return seedShell();
  const isolated = constraints.every((constraint) => constraint === 'A');
  const fallback = isolated
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
  const matched = pickForConstraints(brushId, x, y, constraints, occupancy, avoid);
  if (matched) return matched;
  const occupancyOnly = constraints.map((constraint) => (
    constraint === 'A' ? 'A' : 'connected'
  ));
  const relaxed = pickForConstraints(brushId, x, y, occupancyOnly, occupancy, avoid);
  if (relaxed) return relaxed;
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
  const resolved = new Map<string, CyberLetterPick>();
  for (const [key, occupant] of occupancy) {
    if (occupant.pick) resolved.set(key, occupant.pick);
  }
  return resolved;
}

export { isCyberLetterBrushId };
export { isCyberLetterCatalogLocalIndex } from './cyberEdgeCatalog';
