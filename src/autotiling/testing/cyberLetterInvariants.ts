import { letterCellKey, type CyberLetterPick } from '../cyberEdgeMatcher';
import type { CyberEdgeLetter } from '../cyberEdgeCatalog';


const SIDES = [
  { dx: 0, dy: -1, index: 0, opposite: 2 },
  { dx: 1, dy: 0, index: 1, opposite: 3 },
  { dx: 0, dy: 1, index: 2, opposite: 0 },
  { dx: -1, dy: 0, index: 3, opposite: 1 },
] as const;


function edgeAt(
  edges: `${CyberEdgeLetter}${CyberEdgeLetter}${CyberEdgeLetter}${CyberEdgeLetter}`,
  index: number,
): CyberEdgeLetter {
  return edges[index] as CyberEdgeLetter;
}


const SIDE_NAMES = ['top', 'right', 'bottom', 'left'] as const;


export interface CyberLetterMismatch {
  x: number;
  y: number;
  side: typeof SIDE_NAMES[number];
  cellLetter: CyberEdgeLetter;
  neighborLetter: CyberEdgeLetter | null;
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
