import { describe, expect, it } from 'vitest';
import { listCyberLetterMismatches, listCyberLetterMatches, listCyberVoidAViolations, resolveCyberLetterField } from './cyberEdgeMatcher';

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
    expect(matches.filter((pick) => pick.edges === 'CBBC' && [11, 33, 35].includes(pick.localIndex))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ localIndex: 11, flipX: true, flipY: false }),
        expect.objectContaining({ localIndex: 33, flipX: false, flipY: true }),
        expect.objectContaining({ localIndex: 35, flipX: true, flipY: true }),
      ]),
    );
  });

  it('uses CCCC fill, ABCB/BABC edges, and AABB-family corners on a solid block', () => {
    const picks = resolveCyberLetterField(concreteCells(rectangle(4, 6, 6, 4)), inBounds);

    expect(picks.get('4,6')?.edges).toBe('ABBA');
    expect(picks.get('9,6')?.edges).toBe('AABB');
    expect(picks.get('4,9')?.edges).toBe('BBAA');
    expect(picks.get('9,9')?.edges).toBe('BAAB');
    expect(picks.get('4,6')).toMatchObject({ localIndex: 14, flipX: false, flipY: false });
    expect(picks.get('9,6')).toMatchObject({ localIndex: 14, flipX: true, flipY: false });
    expect(picks.get('4,9')).toMatchObject({ localIndex: 25, flipX: false, flipY: true });
    expect(picks.get('9,9')).toMatchObject({ localIndex: 30, flipX: false, flipY: true });

    for (const x of [5, 6, 7, 8]) {
      expect(picks.get(`${x},6`)?.edges).toBe('ABCB');
      expect(picks.get(`${x},9`)?.edges).toBe('CBAB');
      expect(picks.get(`${x},6`)).toMatchObject({ localIndex: 15, flipX: false, flipY: false });
      expect(picks.get(`${x},9`)).toMatchObject({ localIndex: 62, flipX: false, flipY: false });
    }
    for (const y of [7, 8]) {
      expect(picks.get(`4,${y}`)?.edges).toBe('BCBA');
      expect(picks.get(`9,${y}`)?.edges).toBe('BABC');
      expect(picks.get(`4,${y}`)).toMatchObject({ localIndex: 21, flipX: true, flipY: false });
      expect(picks.get(`9,${y}`)).toMatchObject({ localIndex: 23, flipX: true, flipY: false });
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

  it('uses 55 / 70 at 1-cell-thick T-junctions and 43 at a 1-cell-thick cross', () => {
    const tee = resolveCyberLetterField(concreteCells([
      { x: 10, y: 8 }, { x: 10, y: 9 }, { x: 10, y: 10 }, { x: 10, y: 11 },
      { x: 11, y: 9 }, { x: 12, y: 9 },
    ]), inBounds);
    expect(tee.get('10,9')?.edges).toBe('EEEA');
    expect(tee.get('10,9')?.localIndex).toBe(55);
    expect(tee.get('11,9')?.edges).toBe('AEAE');
    expect(listCyberLetterMismatches(tee, inBounds)).toEqual([]);

    const floorTee = resolveCyberLetterField(concreteCells([
      { x: 10, y: 12 }, { x: 11, y: 12 }, { x: 12, y: 12 }, { x: 13, y: 12 },
      { x: 12, y: 10 }, { x: 12, y: 11 },
    ]), inBounds);
    expect(floorTee.get('12,12')?.edges).toBe('EEAE');
    expect(floorTee.get('12,12')).toMatchObject({ localIndex: 70, flipY: true });
    expect(listCyberLetterMismatches(floorTee, inBounds)).toEqual([]);

    const cross = resolveCyberLetterField(concreteCells([
      { x: 12, y: 10 }, { x: 12, y: 11 },
      { x: 10, y: 12 }, { x: 11, y: 12 }, { x: 12, y: 12 }, { x: 13, y: 12 }, { x: 14, y: 12 },
      { x: 12, y: 13 }, { x: 12, y: 14 },
    ]), inBounds);
    expect(cross.get('12,12')?.edges).toBe('EEEE');
    expect(cross.get('12,12')?.localIndex).toBe(43);
    expect(listCyberLetterMismatches(cross, inBounds)).toEqual([]);
  });

  it('uses 70 at a 1-cell chimney over an enclosed hole', () => {
    const hole = new Set(['12,11']);
    const cells = [
      ...rectangle(10, 10, 5, 5).filter((cell) => !hole.has(`${cell.x},${cell.y}`)),
      { x: 12, y: 9 },
    ];
    const picks = resolveCyberLetterField(concreteCells(cells), inBounds);

    expect(picks.get('12,10')?.edges).toBe('EEAE');
    expect(picks.get('12,10')).toMatchObject({ localIndex: 70, flipY: true });
    expect(picks.get('12,9')?.localIndex).toBe(19);
    expect(['21', '23', '34', '62', '64']).not.toContain(
      String(picks.get('12,10')?.localIndex),
    );
  });

  it('uses blob sides 21 / 23 / 34 / 62 next to a hole, not thin T tiles 55 / 70', () => {
    const rows = [
      '#####',
      '#.###',
      '#####',
      '..###',
    ];
    const cells = rows.flatMap((row, y) => [...row].flatMap((value, x) => (
      value === '#' ? [{ x: x + 10, y: y + 8 }] : []
    )));
    const picks = resolveCyberLetterField(concreteCells(cells), inBounds);
    const used = [...picks.values()].map((pick) => pick.localIndex);
    expect(used).not.toContain(55);
    expect(used).not.toContain(70);
    expect([21, 23]).toContain(picks.get('12,9')?.localIndex);
    expect(listCyberVoidAViolations(picks, inBounds)).toEqual([]);
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

  it('uses only neutral F9 middles in a horizontal Concrete platform', () => {
    const picks = resolveCyberLetterField(concreteCells(rectangle(8, 8, 5, 1)), inBounds);

    expect(picks.get('8,8')).toMatchObject({ localIndex: 71, flipX: true, flipY: false });
    for (const x of [9, 10, 11]) {
      expect(picks.get(`${x},8`)).toMatchObject({ localIndex: 68, flipX: false, flipY: false });
    }
    expect(picks.get('12,8')).toMatchObject({ localIndex: 71, flipX: false, flipY: false });
  });

  it('keeps F3 along the lower stair edge before the F12 end cap', () => {
    const picks = resolveCyberLetterField(concreteCells([
      { x: 20, y: 2 }, { x: 21, y: 2 },
      { x: 20, y: 3 }, { x: 21, y: 3 }, { x: 22, y: 3 },
      { x: 20, y: 4 }, { x: 21, y: 4 }, { x: 22, y: 4 }, { x: 23, y: 4 },
    ]), inBounds);

    expect(picks.get('21,4')).toMatchObject({ localIndex: 62, flipX: false, flipY: false });
    expect(picks.get('22,4')).toMatchObject({ localIndex: 62, flipX: false, flipY: false });
    expect(picks.get('23,4')).toMatchObject({ localIndex: 71, flipX: false, flipY: false });
  });

  it('uses BBCC-family concave corners around a 2x2 hole and a painted plus', () => {
    const hole = new Set(['12,12', '13,12', '12,13', '13,13']);
    const mass = resolveCyberLetterField(
      concreteCells(rectangle(10, 10, 6, 6).filter((cell) => !hole.has(`${cell.x},${cell.y}`))),
      inBounds,
    );
    expect(mass.get('11,11')?.edges).toBe('CBBC');
    expect(mass.get('14,11')?.edges).toBe('CCBB');
    expect(mass.get('11,14')?.edges).toBe('BBCC');
    expect(mass.get('14,14')?.edges).toBe('BCCB');
    expect([11, 33, 35]).toContain(mass.get('11,11')?.localIndex);
    expect([11, 33, 35]).toContain(mass.get('14,11')?.localIndex);
    expect([11, 33, 35]).toContain(mass.get('11,14')?.localIndex);
    expect([11, 33, 35]).toContain(mass.get('14,14')?.localIndex);

    const plus = resolveCyberLetterField(concreteCells(
      rectangle(10, 10, 7, 7).filter(({ x, y }) => {
        const localX = x - 10;
        const localY = y - 10;
        return !((localX < 2 || localX > 4) && (localY < 2 || localY > 4));
      }),
    ), inBounds);
    expect(plus.get('12,12')?.edges).toBe('BCCB');
    expect(plus.get('14,12')?.edges).toBe('BBCC');
    expect(plus.get('12,14')?.edges).toBe('CCBB');
    expect(plus.get('14,14')?.edges).toBe('CBBC');
    expect([11, 33, 35]).toContain(plus.get('12,12')?.localIndex);
    expect([11, 33, 35]).toContain(plus.get('14,12')?.localIndex);
    expect([11, 33, 35]).toContain(plus.get('12,14')?.localIndex);
    expect([11, 33, 35]).toContain(plus.get('14,14')?.localIndex);
  });

  it('does not propagate C10-family corner art into solid cells of an irregular blob', () => {
    const rows = [
      '.##..',
      '#####',
      '####.',
      '####.',
      '####.',
      '####.',
      '.##..',
    ];
    const cells = rows.flatMap((row, y) => [...row].flatMap((value, x) => (
      value === '#' ? [{ x: x + 10, y: y + 5 }] : []
    )));
    const picks = resolveCyberLetterField(concreteCells(cells), inBounds);

    for (const coordinate of ['11,7', '12,7', '11,8', '12,8', '11,9', '12,9']) {
      expect(picks.get(coordinate)?.edges).toBe('CCCC');
      expect([64, 82, 83]).toContain(picks.get(coordinate)?.localIndex);
    }
  });

  it('only lets A face empty, and matching non-A letters face each other', () => {
    const hole = new Set(['12,11', '13,11', '12,12', '13,12']);
    const pinch = rectangle(10, 8, 8, 10).filter(({ x, y }) => (
      !hole.has(`${x},${y}`) && !(x >= 14 && y >= 13 && y <= 14)
    ));
    const blockHole = new Set(['12,12', '13,12', '12,13', '13,13']);
    const shapes = [
      rectangle(4, 6, 6, 4),
      rectangle(10, 10, 3, 3).filter(({ x, y }) => !(x === 11 && y === 11)),
      rectangle(10, 10, 6, 6).filter((cell) => !blockHole.has(`${cell.x},${cell.y}`)),
      pinch,
    ];
    for (const cells of shapes) {
      const picks = resolveCyberLetterField(concreteCells(cells), inBounds);
      expect(listCyberLetterMismatches(picks, inBounds)).toEqual([]);
    }

    const pinchPicks = resolveCyberLetterField(concreteCells(pinch), inBounds);
    expect(pinchPicks.get('14,12')?.edges).toBe('BBAA');
    expect(pinchPicks.get('13,13')?.edges).toBe('AABB');
    expect([14, 25, 30, 61]).toContain(pinchPicks.get('14,12')?.localIndex);
    expect([14, 25, 30, 61]).toContain(pinchPicks.get('13,13')?.localIndex);
  });

  it('always puts A on every edge that faces a void', () => {
    const hole = new Set(['12,11']);
    const chimneyOverHole = [
      ...rectangle(10, 10, 5, 5).filter((cell) => !hole.has(`${cell.x},${cell.y}`)),
      { x: 12, y: 9 },
    ];
    const irregular = [
      '.##..',
      '#####',
      '####.',
      '####.',
      '####.',
      '####.',
      '.##..',
    ].flatMap((row, y) => [...row].flatMap((value, x) => (
      value === '#' ? [{ x: x + 10, y: y + 5 }] : []
    )));
    const staircase = [
      { x: 20, y: 2 }, { x: 21, y: 2 },
      { x: 20, y: 3 }, { x: 21, y: 3 }, { x: 22, y: 3 },
      { x: 20, y: 4 }, { x: 21, y: 4 }, { x: 22, y: 4 }, { x: 23, y: 4 },
    ];
    const shapes = [
      rectangle(4, 6, 6, 4),
      rectangle(10, 10, 6, 6).filter((cell) => !['12,12', '13,12', '12,13', '13,13'].includes(`${cell.x},${cell.y}`)),
      chimneyOverHole,
      irregular,
      staircase,
      [
        { x: 10, y: 8 }, { x: 10, y: 9 }, { x: 10, y: 10 }, { x: 10, y: 11 },
        { x: 11, y: 9 }, { x: 12, y: 9 },
      ],
    ];
    for (const cells of shapes) {
      const picks = resolveCyberLetterField(concreteCells(cells), inBounds);
      expect(listCyberVoidAViolations(picks, inBounds)).toEqual([]);
    }
  });
});
