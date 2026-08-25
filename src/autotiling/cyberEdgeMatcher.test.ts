import { describe, expect, it } from 'vitest';
import { listCyberLetterMatches, resolveCyberLetterField } from './cyberEdgeMatcher';

const inBounds = (x: number, y: number): boolean => x >= 0 && x < 40 && y >= 0 && y < 22;

function concreteCells(
  cells: ReadonlyArray<{ x: number; y: number }>,
): Array<{ x: number; y: number; brushId: 'cyber.concrete' }> {
  return cells.map((cell) => ({ ...cell, brushId: 'cyber.concrete' }));
}

function rectangle(x: number, y: number, width: number, height: number): Array<{ x: number; y: number }> {
  return Array.from({ length: width * height }, (_, index) => ({
    x: x + (index % width),
    y: y + Math.floor(index / width),
  }));
}

describe('resolveCyberLetterField concrete', () => {
  it('uses AAEE-family corners and AEAE / EAEA mids for a 3x3 ring', () => {
    const picks = resolveCyberLetterField(concreteCells([
      { x: 10, y: 10 }, { x: 11, y: 10 }, { x: 12, y: 10 },
      { x: 10, y: 11 }, { x: 12, y: 11 },
      { x: 10, y: 12 }, { x: 11, y: 12 }, { x: 12, y: 12 },
    ]), inBounds);

    expect(picks.get('10,10')?.edges).toBe('AEEA');
    expect(picks.get('11,10')?.edges).toBe('AEAE');
    expect(picks.get('12,10')?.edges).toBe('AAEE');
    expect(picks.get('10,11')?.edges).toBe('EAEA');
    expect(picks.get('12,11')?.edges).toBe('EAEA');
    expect(picks.get('10,12')?.edges).toBe('EEAA');
    expect(picks.get('11,12')?.edges).toBe('AEAE');
    expect(picks.get('12,12')?.edges).toBe('EAAE');

    expect(picks.get('10,10')?.localIndex).toBe(67);
    expect([68, 69]).toContain(picks.get('11,10')?.localIndex);
    expect(picks.get('10,11')?.localIndex).toBe(31);
  });

  it('matches inner-corner sockets with independent flipX and flipY, including both', () => {
    const matches = listCyberLetterMatches('cyber.concrete', ['C', 'B', 'B', 'C']);
    expect(matches.some((pick) => pick.edges === 'CBBC' && pick.flipX && pick.flipY)).toBe(true);
    expect(matches.some((pick) => pick.edges === 'CBBC' && pick.localIndex === 11 && pick.flipX && !pick.flipY)).toBe(true);
  });

  it('uses CCCC fill, ABCB/BABC edges, and AABB-family corners on a solid block', () => {
    const picks = resolveCyberLetterField(concreteCells(rectangle(4, 6, 6, 4)), inBounds);

    expect(picks.get('4,6')?.edges).toBe('ABBA');
    expect(picks.get('9,6')?.edges).toBe('AABB');
    expect(picks.get('4,9')?.edges).toBe('BBAA');
    expect(picks.get('9,9')?.edges).toBe('BAAB');

    for (const x of [5, 6, 7, 8]) {
      expect(picks.get(`${x},6`)?.edges).toBe('ABCB');
      expect(picks.get(`${x},9`)?.edges).toBe('CBAB');
    }
    for (const y of [7, 8]) {
      expect(picks.get(`4,${y}`)?.edges).toBe('BCBA');
      expect(picks.get(`9,${y}`)?.edges).toBe('BABC');
    }
    for (const y of [7, 8]) {
      for (const x of [5, 6, 7, 8]) {
        expect(picks.get(`${x},${y}`)?.edges).toBe('CCCC');
        expect([64, 82, 83]).toContain(picks.get(`${x},${y}`)?.localIndex);
      }
    }
  });

  it('uses an E T-junction when a stub meets a 1-cell-thick frame', () => {
    const hole = new Set(['11,11', '12,11', '11,12', '12,12']);
    const cells = [
      ...rectangle(10, 10, 4, 4).filter((cell) => !hole.has(`${cell.x},${cell.y}`)),
      { x: 11, y: 9 },
    ];
    const picks = resolveCyberLetterField(concreteCells(cells), inBounds);

    expect(picks.get('10,10')?.edges).toBe('AEEA');
    expect(picks.get('11,9')?.edges).toBe('AAEA');
    expect(picks.get('11,9')?.localIndex).toBe(19);
    expect(picks.get('11,10')?.edges).toBe('EEAE');
    expect(picks.get('12,10')?.edges).toBe('AEAE');
    expect(picks.get('11,10')?.localIndex).toBe(70);
    expect(picks.get('13,11')?.edges).toBe('EAEA');
  });

  it('uses tile 71 (AAAE) for a 1-cell cap on the left or right', () => {
    const horizontal = resolveCyberLetterField(concreteCells([
      { x: 8, y: 8 },
      { x: 9, y: 8 },
    ]), inBounds);
    expect(horizontal.get('8,8')?.edges).toBe('AEAA');
    expect(horizontal.get('8,8')?.localIndex).toBe(71);
    expect(horizontal.get('8,8')?.flipX).toBe(true);
    expect(horizontal.get('9,8')?.edges).toBe('AAAE');
    expect(horizontal.get('9,8')?.localIndex).toBe(71);
    expect(horizontal.get('9,8')?.flipX).toBe(false);

    const vertical = resolveCyberLetterField(concreteCells([
      { x: 8, y: 8 },
      { x: 8, y: 9 },
    ]), inBounds);
    expect(vertical.get('8,8')?.edges).toBe('AAEA');
    expect(vertical.get('8,8')?.localIndex).toBe(19);
    expect(vertical.get('8,9')?.edges).toBe('EAAA');
    expect(vertical.get('8,9')?.localIndex).toBe(19);
  });

  it('uses BBCC-family inner corners around a 2x2 hole in a thick mass', () => {
    const hole = new Set(['12,12', '13,12', '12,13', '13,13']);
    const cells = rectangle(10, 10, 6, 6).filter((cell) => !hole.has(`${cell.x},${cell.y}`));
    const picks = resolveCyberLetterField(concreteCells(cells), inBounds);

    expect(picks.get('11,11')?.edges).toBe('CBBC');
    expect(picks.get('14,11')?.edges).toBe('CCBB');
    expect(picks.get('11,14')?.edges).toBe('BBCC');
    expect(picks.get('14,14')?.edges).toBe('BCCB');
    expect([11, 33, 35]).toContain(picks.get('11,11')?.localIndex);
    expect([11, 33, 35]).toContain(picks.get('14,11')?.localIndex);
  });
});
