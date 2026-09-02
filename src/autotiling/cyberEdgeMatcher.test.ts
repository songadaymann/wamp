import { describe, expect, it } from 'vitest';
import { listCyberLetterMismatches, listCyberLetterMatches, listCyberVoidAViolations, orientCyberA10Overlay, resolveCyberLetterField } from './cyberEdgeMatcher';

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
      const top = picks.get(`${x},6`)!;
      const bottom = picks.get(`${x},9`)!;
      expect(top.edges).toBe('ABCB');
      expect([15, 16, 62]).toContain(top.localIndex);
      expect(top.flipY).toBe(top.localIndex === 62);
      expect(bottom.edges).toBe('CBAB');
      expect([15, 16, 62]).toContain(bottom.localIndex);
      expect(bottom.flipY).toBe(bottom.localIndex !== 62);
    }
    for (const y of [7, 8]) {
      const left = picks.get(`4,${y}`)!;
      const right = picks.get(`9,${y}`)!;
      expect(left.edges).toBe('BCBA');
      expect([21, 23]).toContain(left.localIndex);
      expect(left.flipX).toBe(left.localIndex === 21);
      expect(right.edges).toBe('BABC');
      expect([21, 23]).toContain(right.localIndex);
      expect(right.flipX).toBe(right.localIndex === 23);
    }
    for (const y of [7, 8]) {
      for (const x of [5, 6, 7, 8]) {
        expect(picks.get(`${x},${y}`)?.edges).toBe('CCCC');
        expect([64, 82]).toContain(picks.get(`${x},${y}`)?.localIndex);
      }
    }
  });

  it('joins two 2x2 blobs into one 4x2 with edge tiles at the seam, not extra corners', () => {
    const picks = resolveCyberLetterField(concreteCells(rectangle(0, 0, 4, 2)), inBounds);
    expect(picks.get('0,0')).toMatchObject({ localIndex: 14, flipX: false, flipY: false });
    expect(picks.get('3,0')).toMatchObject({ localIndex: 14, flipX: true, flipY: false });
    expect(picks.get('0,1')).toMatchObject({ localIndex: 25, flipX: false, flipY: true });
    expect(picks.get('3,1')).toMatchObject({ localIndex: 30, flipX: false, flipY: true });
    for (const x of [1, 2]) {
      expect(picks.get(`${x},0`)?.edges).toBe('ABCB');
      expect([15, 16, 62]).toContain(picks.get(`${x},0`)?.localIndex);
      expect(picks.get(`${x},1`)?.edges).toBe('CBAB');
      expect([15, 16, 62]).toContain(picks.get(`${x},1`)?.localIndex);
    }
  });

  it('varies side and fill flips without turning A away from the void', () => {
    const picks = resolveCyberLetterField(concreteCells(rectangle(4, 4, 16, 14)), inBounds);
    const leftLooks = new Set<string>();
    const rightLooks = new Set<string>();
    const topLooks = new Set<string>();
    const bottomLooks = new Set<string>();
    const fillLooks = new Set<string>();
    let fill64Even = 0;
    let fill64 = 0;

    for (let y = 5; y <= 16; y += 1) {
      const left = picks.get(`4,${y}`)!;
      const right = picks.get(`19,${y}`)!;
      expect(left.edges).toBe('BCBA');
      expect(right.edges).toBe('BABC');
      expect(left.flipX).toBe(left.localIndex === 21);
      expect(right.flipX).toBe(right.localIndex === 23);
      leftLooks.add(`${left.localIndex}:${Number(left.flipX)}${Number(left.flipY)}`);
      rightLooks.add(`${right.localIndex}:${Number(right.flipX)}${Number(right.flipY)}`);
    }
    for (let x = 5; x <= 18; x += 1) {
      const top = picks.get(`${x},4`)!;
      const bottom = picks.get(`${x},17`)!;
      expect(top.edges).toBe('ABCB');
      expect([15, 16, 62]).toContain(top.localIndex);
      expect(top.flipY).toBe(top.localIndex === 62);
      expect(bottom.edges).toBe('CBAB');
      expect([15, 16, 62]).toContain(bottom.localIndex);
      expect(bottom.flipY).toBe(bottom.localIndex !== 62);
      topLooks.add(String(top.localIndex));
      bottomLooks.add(String(bottom.localIndex));
    }
    for (let y = 5; y <= 16; y += 1) {
      for (let x = 5; x <= 18; x += 1) {
        const fill = picks.get(`${x},${y}`)!;
        expect(fill.edges).toBe('CCCC');
        fillLooks.add(`${fill.localIndex}:${Number(fill.flipX)}${Number(fill.flipY)}`);
        if (fill.localIndex !== 64) continue;
        fill64 += 1;
        if ((x + y) % 2 === 0) fill64Even += 1;
      }
    }

    expect(leftLooks.size).toBeGreaterThan(1);
    expect(rightLooks.size).toBeGreaterThan(1);
    expect([...leftLooks, ...rightLooks].some((key) => key.endsWith('1'))).toBe(true);
    expect(topLooks.has('15') || topLooks.has('16')).toBe(true);
    expect(topLooks.has('62')).toBe(true);
    expect(bottomLooks.has('62')).toBe(true);
    expect(bottomLooks.has('15') || bottomLooks.has('16')).toBe(true);
    expect([...fillLooks].every((key) => key.startsWith('64:') || key.startsWith('82:'))).toBe(true);
    expect([...fillLooks].some((key) => key.startsWith('64:'))).toBe(true);
    expect(fill64).toBeGreaterThan(8);
    expect(fill64Even / fill64).toBeGreaterThan(0.2);
    expect(fill64Even / fill64).toBeLessThan(0.8);
    expect(listCyberVoidAViolations(picks, inBounds)).toEqual([]);
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

  it('orients A10 as ZBBZ toward a missing diagonal beside a stepped hole', () => {
    const hole = new Set(['11,9']);
    const cells = [
      ...rectangle(10, 8, 3, 1),
      ...rectangle(10, 9, 4, 2).filter((cell) => !hole.has(`${cell.x},${cell.y}`)),
    ];
    const picks = resolveCyberLetterField(concreteCells(cells), inBounds);
    expect(orientCyberA10Overlay(12, 9, picks.get('12,9')!, picks)).toEqual({
      flipX: false,
      flipY: true,
    });
    expect(orientCyberA10Overlay(12, 10, picks.get('12,10')!, picks)).toEqual({
      flipX: true,
      flipY: true,
    });
    expect(orientCyberA10Overlay(10, 8, picks.get('10,8')!, picks)).toBeNull();
  });

  it('overlays A10 on enclosed 1-cell tunnel corners', () => {
    const cells = rectangle(8, 8, 5, 5).filter(({ x, y }) => !(x === 10 && y === 10));
    const picks = resolveCyberLetterField(concreteCells(cells), inBounds);
    expect(orientCyberA10Overlay(9, 9, picks.get('9,9')!, picks)).toEqual({
      flipX: false,
      flipY: false,
    });
    expect(orientCyberA10Overlay(11, 9, picks.get('11,9')!, picks)).toEqual({
      flipX: true,
      flipY: false,
    });
    expect(orientCyberA10Overlay(9, 11, picks.get('9,11')!, picks)).toEqual({
      flipX: false,
      flipY: true,
    });
    expect(orientCyberA10Overlay(11, 11, picks.get('11,11')!, picks)).toEqual({
      flipX: true,
      flipY: true,
    });
    expect(orientCyberA10Overlay(10, 9, picks.get('10,9')!, picks)).toBeNull();
  });

  it('overlays A10 on fill beside paired 1-cell tunnels', () => {
    const holes = new Set(['12,10', '14,10']);
    const cells = rectangle(10, 8, 7, 5).filter((cell) => !holes.has(`${cell.x},${cell.y}`));
    const picks = resolveCyberLetterField(concreteCells(cells), inBounds);
    expect(orientCyberA10Overlay(13, 9, picks.get('13,9')!, picks)).toEqual({
      flipX: false,
      flipY: false,
    });
    expect(orientCyberA10Overlay(13, 11, picks.get('13,11')!, picks)).toEqual({
      flipX: false,
      flipY: true,
    });
    expect(orientCyberA10Overlay(11, 9, picks.get('11,9')!, picks)).toEqual({
      flipX: false,
      flipY: false,
    });
  });

  it('overlays A10 where a U-notch vertical and horizontal edges meet', () => {
    const notch = new Set(['12,8', '13,8']);
    const cells = rectangle(10, 8, 6, 4).filter((cell) => !notch.has(`${cell.x},${cell.y}`));
    const picks = resolveCyberLetterField(concreteCells(cells), inBounds);
    expect(orientCyberA10Overlay(11, 9, picks.get('11,9')!, picks)).toEqual({
      flipX: false,
      flipY: true,
    });
    expect(orientCyberA10Overlay(14, 9, picks.get('14,9')!, picks)).toEqual({
      flipX: true,
      flipY: true,
    });
  });

  it('overlays A10 where a hole sits beside a top-right cut-out', () => {
    const omitted = new Set(['15,7', '12,9', '14,9']);
    const cells = rectangle(10, 7, 6, 5).filter((cell) => !omitted.has(`${cell.x},${cell.y}`));
    const picks = resolveCyberLetterField(concreteCells(cells), inBounds);
    expect(orientCyberA10Overlay(11, 8, picks.get('11,8')!, picks)).toEqual({
      flipX: false,
      flipY: false,
    });
    expect(orientCyberA10Overlay(13, 8, picks.get('13,8')!, picks)).toEqual({
      flipX: false,
      flipY: false,
    });
    expect(orientCyberA10Overlay(14, 8, picks.get('14,8')!, picks)).toEqual({
      flipX: false,
      flipY: true,
    });
    expect(orientCyberA10Overlay(11, 10, picks.get('11,10')!, picks)).toEqual({
      flipX: false,
      flipY: true,
    });
  });

  it('does not overlay A10 on top, bottom, or side notches', () => {
    const bottomNotch = resolveCyberLetterField(
      concreteCells(rectangle(10, 8, 4, 2).filter((cell) => !(cell.x === 12 && cell.y === 9))),
      inBounds,
    );
    const topNotch = resolveCyberLetterField(
      concreteCells(rectangle(10, 8, 4, 2).filter((cell) => !(cell.x === 12 && cell.y === 8))),
      inBounds,
    );
    const rightHall = resolveCyberLetterField(
      concreteCells([...rectangle(10, 8, 6, 6), { x: 16, y: 10 }, { x: 17, y: 10 }, { x: 18, y: 10 }]),
      inBounds,
    );
    const leftHall = resolveCyberLetterField(
      concreteCells([...rectangle(10, 8, 6, 6), { x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }]),
      inBounds,
    );
    const sideNubs = resolveCyberLetterField(
      concreteCells([
        ...rectangle(10, 8, 6, 6),
        { x: 16, y: 9 },
        { x: 16, y: 11 },
        { x: 9, y: 9 },
        { x: 9, y: 11 },
      ]),
      inBounds,
    );
    const verticalNubs = resolveCyberLetterField(
      concreteCells([
        ...rectangle(10, 8, 6, 6),
        { x: 12, y: 7 },
        { x: 14, y: 7 },
        { x: 12, y: 14 },
        { x: 14, y: 14 },
      ]),
      inBounds,
    );
    for (const picks of [bottomNotch, topNotch, rightHall, leftHall, sideNubs, verticalNubs]) {
      for (const [key, pick] of picks) {
        const [x, y] = key.split(',').map(Number);
        expect(orientCyberA10Overlay(x, y, pick, picks)).toBeNull();
      }
    }
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

    expect([15, 16, 62]).toContain(picks.get('21,4')?.localIndex);
    expect(picks.get('21,4')?.flipY).toBe(picks.get('21,4')?.localIndex !== 62);
    expect([15, 16, 62]).toContain(picks.get('22,4')?.localIndex);
    expect(picks.get('22,4')?.flipY).toBe(picks.get('22,4')?.localIndex !== 62);
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
      expect([64, 82]).toContain(picks.get(coordinate)?.localIndex);
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

describe('resolveCyberLetterField windows', () => {
  it('keeps a 1-high window strip as 38 mids and 37 caps', () => {
    const band = new Set(rectangle(8, 8, 8, 1).map((cell) => `${cell.x},${cell.y}`));
    const cells = rectangle(8, 7, 8, 3).map((cell) => ({
      ...cell,
      brushId: (band.has(`${cell.x},${cell.y}`) ? 'cyber.windows' : 'cyber.concrete') as 'cyber.windows' | 'cyber.concrete',
    }));
    const picks = resolveCyberLetterField(cells, inBounds);
    expect(picks.get('8,8')?.localIndex).toBe(37);
    expect(picks.get('15,8')?.localIndex).toBe(37);
    expect(picks.get('11,8')?.localIndex).toBe(38);
    expect(picks.get('11,8')?.edges).toBe('CICI');
  });

  it('uses pane 38 inside stacked window strips and tile 37 on every end', () => {
    const band = new Set(rectangle(8, 7, 8, 4).map((cell) => `${cell.x},${cell.y}`));
    const cells = rectangle(8, 6, 8, 6).map((cell) => ({
      ...cell,
      brushId: (band.has(`${cell.x},${cell.y}`) ? 'cyber.windows' : 'cyber.concrete') as 'cyber.windows' | 'cyber.concrete',
    }));
    const picks = resolveCyberLetterField(cells, inBounds);
    for (const y of [7, 8, 9, 10]) {
      expect(picks.get(`11,${y}`)?.localIndex).toBe(38);
      expect(picks.get(`8,${y}`)?.localIndex).toBe(37);
      expect(picks.get(`15,${y}`)?.localIndex).toBe(37);
    }
  });
});

describe('resolveCyberLetterField shell', () => {
  const SHELL_TILES = new Set([17, 26, 27, 28, 29, 40, 42, 52, 53, 54, 61, 66, 78, 79, 83]);

  function shellCells(cells: ReadonlyArray<{ x: number; y: number }>) {
    return cells.map((cell) => ({ ...cell, brushId: 'cyber.shell' as const }));
  }

  it('builds a 3x3 blob from 54, 66, 27, and 53', () => {
    const picks = resolveCyberLetterField(shellCells(rectangle(9, 9, 3, 3)), inBounds);
    for (const pick of picks.values()) {
      expect(SHELL_TILES.has(pick.localIndex)).toBe(true);
    }
    expect([53, 40]).toContain(picks.get('10,10')?.localIndex);
    expect([27, 28]).toContain(picks.get('10,9')?.localIndex);
    expect(picks.get('10,9')?.flipY).toBe(false);
    expect([27, 28]).toContain(picks.get('10,11')?.localIndex);
    expect(picks.get('10,11')?.flipY).toBe(true);
    expect(picks.get('10,11')?.flipX).toBe(false);
    expect(picks.get('11,10')?.localIndex).toBe(54);
    expect(picks.get('11,10')?.flipX).toBe(false);
    expect(picks.get('9,10')?.localIndex).toBe(54);
    expect(picks.get('9,10')?.flipX).toBe(true);
    expect(picks.get('11,11')?.localIndex).toBe(66);
    expect(picks.get('9,9')?.localIndex).toBe(66);
  });

  it('keeps A on the void when rare 28 stamps a Shell edge', () => {
    const picks = resolveCyberLetterField(shellCells(rectangle(4, 8, 12, 2)), inBounds);
    for (let x = 5; x <= 14; x += 1) {
      const top = picks.get(`${x},8`);
      const bottom = picks.get(`${x},9`);
      expect([27, 28]).toContain(top?.localIndex);
      expect(top?.flipY).toBe(false);
      expect([27, 28]).toContain(bottom?.localIndex);
      expect(bottom?.flipY).toBe(true);
    }
  });

  it('does not pick retired Shell atlas cells on a larger blob', () => {
    const picks = resolveCyberLetterField(shellCells(rectangle(8, 6, 8, 8)), inBounds);
    for (const pick of picks.values()) {
      expect(SHELL_TILES.has(pick.localIndex)).toBe(true);
    }
  });

  it('uses 79Y, 52Y, and 26Y along a bottom-right Shell triangle on Concrete', () => {
    const shell = new Set([
      '17,9',
      '16,10', '17,10',
      '15,11', '16,11', '17,11',
      '13,12', '14,12', '15,12', '16,12', '17,12',
    ]);
    const cells = rectangle(10, 7, 8, 6).map((cell) => ({
      ...cell,
      brushId: (shell.has(`${cell.x},${cell.y}`) ? 'cyber.shell' : 'cyber.concrete') as 'cyber.shell' | 'cyber.concrete',
    }));
    const picks = resolveCyberLetterField(cells, inBounds);
    expect(picks.get('17,9')).toMatchObject({ localIndex: 79, flipX: false, flipY: true });
    expect(picks.get('13,12')).toMatchObject({ localIndex: 26, flipX: false, flipY: true });
    expect(picks.get('16,10')).toMatchObject({ localIndex: 52, flipX: false, flipY: true });
    expect(picks.get('15,11')).toMatchObject({ localIndex: 52, flipX: false, flipY: true });
  });

  it('uses 42 where a Shell stair meets the right Concrete wall', () => {
    const shell = new Set([
      '15,9',
      '14,10', '15,10', '16,10',
      '13,11', '14,11', '15,11', '16,11', '17,11',
      '13,12', '14,12', '15,12', '16,12', '17,12',
    ]);
    const cells = rectangle(10, 7, 8, 6).map((cell) => ({
      ...cell,
      brushId: (shell.has(`${cell.x},${cell.y}`) ? 'cyber.shell' : 'cyber.concrete') as 'cyber.shell' | 'cyber.concrete',
    }));
    const picks = resolveCyberLetterField(cells, inBounds);
    expect(picks.get('17,11')).toMatchObject({ localIndex: 42, flipX: false, flipY: false });
  });

  it('uses 29X where a Shell stair meets the top Concrete edge', () => {
    const shell = new Set([
      '14,7', '15,7', '16,7', '17,7',
      '13,8', '14,8', '15,8', '16,8', '17,8',
      '12,9', '13,9', '14,9', '15,9', '16,9', '17,9',
      '11,10', '12,10', '13,10', '14,10', '15,10', '16,10', '17,10',
      '10,11', '11,11', '12,11', '13,11', '14,11', '15,11', '16,11', '17,11',
      '10,12', '11,12', '12,12', '13,12', '14,12', '15,12', '16,12', '17,12',
    ]);
    const cells = rectangle(10, 7, 8, 6).map((cell) => ({
      ...cell,
      brushId: (shell.has(`${cell.x},${cell.y}`) ? 'cyber.shell' : 'cyber.concrete') as 'cyber.shell' | 'cyber.concrete',
    }));
    const picks = resolveCyberLetterField(cells, inBounds);
    expect(picks.get('14,7')).toMatchObject({ localIndex: 29, flipX: true, flipY: false });
    expect(picks.get('17,7')).toMatchObject({ localIndex: 66, flipY: true });
  });

  it('uses 29 where a Shell stair meets the top edge on the opposite diagonal', () => {
    const shell = new Set([
      '10,7', '11,7', '12,7', '13,7',
      '10,8', '11,8', '12,8', '13,8', '14,8',
      '10,9', '11,9', '12,9', '13,9', '14,9', '15,9',
      '10,10', '11,10', '12,10', '13,10', '14,10', '15,10', '16,10',
      '10,11', '11,11', '12,11', '13,11', '14,11', '15,11', '16,11', '17,11',
      '10,12', '11,12', '12,12', '13,12', '14,12', '15,12', '16,12', '17,12',
    ]);
    const cells = rectangle(10, 7, 8, 6).map((cell) => ({
      ...cell,
      brushId: (shell.has(`${cell.x},${cell.y}`) ? 'cyber.shell' : 'cyber.concrete') as 'cyber.shell' | 'cyber.concrete',
    }));
    const picks = resolveCyberLetterField(cells, inBounds);
    expect(picks.get('13,7')).toMatchObject({ localIndex: 29, flipX: false, flipY: false });
    expect(picks.get('10,7')).toMatchObject({ localIndex: 66, flipX: true, flipY: true });
  });

  it('uses 17 where that top-edge meeting is also the outer void corner', () => {
    const shell = new Set([
      '17,7',
      '16,8', '17,8',
      '15,9', '16,9', '17,9',
      '14,10', '15,10', '16,10', '17,10',
      '13,11', '14,11', '15,11', '16,11', '17,11',
      '12,12', '13,12', '14,12', '15,12', '16,12', '17,12',
    ]);
    const cells = rectangle(10, 7, 8, 6).map((cell) => ({
      ...cell,
      brushId: (shell.has(`${cell.x},${cell.y}`) ? 'cyber.shell' : 'cyber.concrete') as 'cyber.shell' | 'cyber.concrete',
    }));
    const picks = resolveCyberLetterField(cells, inBounds);
    expect(picks.get('17,7')).toMatchObject({ localIndex: 17, flipX: false, flipY: false });
  });

  it('uses 17X for the outer top-left void corner on the opposite diagonal', () => {
    const shell = new Set([
      '10,7',
      '10,8', '11,8',
      '10,9', '11,9', '12,9',
      '10,10', '11,10', '12,10', '13,10',
      '10,11', '11,11', '12,11', '13,11', '14,11',
      '10,12', '11,12', '12,12', '13,12', '14,12', '15,12',
    ]);
    const cells = rectangle(10, 7, 8, 6).map((cell) => ({
      ...cell,
      brushId: (shell.has(`${cell.x},${cell.y}`) ? 'cyber.shell' : 'cyber.concrete') as 'cyber.shell' | 'cyber.concrete',
    }));
    const picks = resolveCyberLetterField(cells, inBounds);
    expect(picks.get('10,7')).toMatchObject({ localIndex: 17, flipX: true, flipY: false });
  });

  it('uses 83Y at the bottom-left outer corner of a Concrete NW / Shell SE diagonal', () => {
    const cells = rectangle(10, 7, 6, 6).map((cell) => ({
      ...cell,
      brushId: ((cell.x - 10) + (cell.y - 7) >= 5 ? 'cyber.shell' : 'cyber.concrete') as 'cyber.shell' | 'cyber.concrete',
    }));
    const picks = resolveCyberLetterField(cells, inBounds);
    expect(picks.get('10,12')).toMatchObject({ localIndex: 83, flipX: false, flipY: true });
    expect(picks.get('10,12')?.edges[2]).toBe('A');
    expect(picks.get('10,12')?.edges[3]).toBe('A');
    expect(picks.get('15,7')).toMatchObject({ localIndex: 17, flipX: false, flipY: false });
  });

  it('uses 52 along the top-left to bottom-right diagonal of a 5x5 Shell / Concrete split', () => {
    const cells = rectangle(0, 0, 5, 5).map((cell) => ({
      ...cell,
      brushId: (cell.x >= cell.y ? 'cyber.shell' : 'cyber.concrete') as 'cyber.shell' | 'cyber.concrete',
    }));
    const picks = resolveCyberLetterField(cells, inBounds);
    expect(picks.get('0,0')?.localIndex).toBe(83);
    for (const key of ['1,1', '2,2', '3,3'] as const) {
      expect(picks.get(key)).toMatchObject({ localIndex: 52, flipX: false, flipY: false });
      expect([40, 53]).not.toContain(picks.get(key)?.localIndex);
    }
  });

  it('uses 14-family corners on a filled Concrete blob, not 61', () => {
    const picks = resolveCyberLetterField(concreteCells(rectangle(0, 0, 5, 5)), inBounds);
    expect(picks.get('0,0')).toMatchObject({ localIndex: 14, flipX: false, flipY: false });
    expect(picks.get('4,0')).toMatchObject({ localIndex: 14, flipX: true, flipY: false });
    expect(picks.get('0,4')).toMatchObject({ localIndex: 25, flipX: false, flipY: true });
    expect(picks.get('4,4')).toMatchObject({ localIndex: 30, flipX: false, flipY: true });
  });

  it('uses 61 on Shell corners of a 3x3 Concrete cross, never Support 36/48/60/72', () => {
    const cells = rectangle(0, 0, 3, 3).map((cell) => ({
      ...cell,
      brushId: (
        cell.x === 1 || cell.y === 1
          ? 'cyber.concrete'
          : 'cyber.shell'
      ) as 'cyber.shell' | 'cyber.concrete',
    }));
    const picks = resolveCyberLetterField(cells, inBounds);
    expect(picks.get('0,0')).toMatchObject({ localIndex: 61, flipX: false, flipY: true });
    expect(picks.get('2,0')).toMatchObject({ localIndex: 61, flipX: true, flipY: true });
    expect(picks.get('0,2')).toMatchObject({ localIndex: 61, flipX: false, flipY: false });
    expect(picks.get('2,2')).toMatchObject({ localIndex: 61, flipX: true, flipY: false });
    for (const key of ['0,0', '2,0', '0,2', '2,2'] as const) {
      expect([36, 48, 60, 72]).not.toContain(picks.get(key)?.localIndex);
    }
  });

  it('uses 14-family Concrete and yellow Shell fill on a 4x4 Shell ring around 2x2 Concrete', () => {
    const cells: Array<{ x: number; y: number; brushId: 'cyber.shell' | 'cyber.concrete' }> = [];
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        if ((x === 0 || x === 3) && (y === 0 || y === 3)) continue;
        cells.push({
          x,
          y,
          brushId: x === 0 || x === 3 || y === 0 || y === 3 ? 'cyber.shell' : 'cyber.concrete',
        });
      }
    }
    const picks = resolveCyberLetterField(cells, inBounds);
    expect(picks.get('1,1')).toMatchObject({ localIndex: 14, flipX: false, flipY: false });
    expect(picks.get('2,1')).toMatchObject({ localIndex: 14, flipX: true, flipY: false });
    expect(picks.get('1,2')).toMatchObject({ localIndex: 25, flipX: false, flipY: true });
    expect(picks.get('2,2')).toMatchObject({ localIndex: 30, flipX: false, flipY: true });
    expect(picks.get('1,0')).toMatchObject({ localIndex: 66, flipX: true, flipY: true });
    expect(picks.get('2,0')).toMatchObject({ localIndex: 66, flipX: false, flipY: true });
    expect(picks.get('0,1')).toMatchObject({ localIndex: 66, flipX: true, flipY: true });
    expect(picks.get('3,1')).toMatchObject({ localIndex: 66, flipX: false, flipY: true });
    expect(picks.get('0,2')).toMatchObject({ localIndex: 66, flipX: true, flipY: false });
    expect(picks.get('3,2')).toMatchObject({ localIndex: 66, flipX: false, flipY: false });
    expect(picks.get('1,3')).toMatchObject({ localIndex: 66, flipX: true, flipY: false });
    expect(picks.get('2,3')).toMatchObject({ localIndex: 66, flipX: false, flipY: false });
    for (const key of ['1,0', '2,0', '0,1', '3,1', '0,2', '3,2', '1,3', '2,3'] as const) {
      expect([17, 27, 29, 42, 53, 61, 82, 83]).not.toContain(picks.get(key)?.localIndex);
    }
  });

  it('uses 14-family Concrete and yellow Shell fill on a 4x4 Shell frame around 2x2 Concrete', () => {
    const cells = rectangle(0, 0, 4, 4).map((cell) => ({
      ...cell,
      brushId: (
        cell.x === 0 || cell.x === 3 || cell.y === 0 || cell.y === 3
          ? 'cyber.shell'
          : 'cyber.concrete'
      ) as 'cyber.shell' | 'cyber.concrete',
    }));
    const picks = resolveCyberLetterField(cells, inBounds);
    expect(picks.get('1,1')).toMatchObject({ localIndex: 14, flipX: false, flipY: false });
    expect(picks.get('2,1')).toMatchObject({ localIndex: 14, flipX: true, flipY: false });
    expect(picks.get('1,2')).toMatchObject({ localIndex: 25, flipX: false, flipY: true });
    expect(picks.get('2,2')).toMatchObject({ localIndex: 30, flipX: false, flipY: true });
    expect(picks.get('0,0')?.localIndex).toBe(66);
    expect(picks.get('3,0')?.localIndex).toBe(66);
    expect(picks.get('0,3')?.localIndex).toBe(66);
    expect(picks.get('3,3')?.localIndex).toBe(66);
    expect(picks.get('1,0')?.localIndex).toBe(27);
    expect(picks.get('2,0')?.localIndex).toBe(27);
    expect(picks.get('1,3')?.localIndex).toBe(27);
    expect(picks.get('2,3')?.localIndex).toBe(27);
    expect(picks.get('0,1')?.localIndex).toBe(54);
    expect(picks.get('0,2')?.localIndex).toBe(54);
    expect(picks.get('3,1')?.localIndex).toBe(54);
    expect(picks.get('3,2')?.localIndex).toBe(54);
    for (const key of ['1,0', '2,0', '0,1', '3,1', '0,2', '3,2', '1,3', '2,3'] as const) {
      expect([17, 29, 42, 53, 61, 82, 83]).not.toContain(picks.get(key)?.localIndex);
    }
  });

  it('uses 14-family Concrete and yellow Shell fill on a 6x6 enclosed octagon', () => {
    const rows = [
      'SSSSSS',
      'SSCCSS',
      'SCCCCS',
      'SCCCCS',
      'SSCCSS',
      'SSSSSS',
    ];
    const cells: Array<{ x: number; y: number; brushId: 'cyber.shell' | 'cyber.concrete' }> = [];
    for (let y = 0; y < rows.length; y += 1) {
      for (let x = 0; x < rows[y]!.length; x += 1) {
        cells.push({
          x,
          y,
          brushId: rows[y]![x] === 'C' ? 'cyber.concrete' : 'cyber.shell',
        });
      }
    }
    const picks = resolveCyberLetterField(cells, inBounds);
    expect(picks.get('2,1')).toMatchObject({ localIndex: 14, flipX: false, flipY: false });
    expect(picks.get('3,1')).toMatchObject({ localIndex: 14, flipX: true, flipY: false });
    expect(picks.get('1,2')).toMatchObject({ localIndex: 14, flipX: false, flipY: false });
    expect(picks.get('4,2')).toMatchObject({ localIndex: 14, flipX: true, flipY: false });
    expect(picks.get('1,3')).toMatchObject({ localIndex: 25, flipX: false, flipY: true });
    expect(picks.get('4,3')).toMatchObject({ localIndex: 30, flipX: false, flipY: true });
    expect(picks.get('2,4')).toMatchObject({ localIndex: 25, flipX: false, flipY: true });
    expect(picks.get('3,4')).toMatchObject({ localIndex: 30, flipX: false, flipY: true });
    expect([11, 33, 35]).toContain(picks.get('2,2')?.localIndex);
    expect([11, 33, 35]).toContain(picks.get('3,2')?.localIndex);
    expect([11, 33, 35]).toContain(picks.get('2,3')?.localIndex);
    expect([11, 33, 35]).toContain(picks.get('3,3')?.localIndex);
    expect(picks.get('1,1')?.localIndex).toBe(53);
    expect(picks.get('4,1')?.localIndex).toBe(53);
    expect(picks.get('1,4')?.localIndex).toBe(53);
    expect(picks.get('4,4')?.localIndex).toBe(53);
    for (const key of ['2,0', '3,0', '2,5', '3,5'] as const) {
      expect(picks.get(key)?.localIndex).toBe(27);
    }
    for (const key of ['0,2', '0,3', '5,2', '5,3'] as const) {
      expect(picks.get(key)?.localIndex).toBe(54);
    }
    for (const key of ['2,0', '3,0', '1,1', '4,1', '0,2', '5,2', '0,3', '5,3', '1,4', '4,4', '2,5', '3,5'] as const) {
      expect([17, 29, 42, 61, 82, 83]).not.toContain(picks.get(key)?.localIndex);
    }
  });

  it('uses 61 on Shell corners of a 4x4 Concrete rectangle, never Support tiles', () => {
    const cells = rectangle(0, 0, 4, 4).map((cell) => ({
      ...cell,
      brushId: (
        (cell.x === 0 || cell.x === 3) && (cell.y === 0 || cell.y === 3)
          ? 'cyber.shell'
          : 'cyber.concrete'
      ) as 'cyber.shell' | 'cyber.concrete',
    }));
    const picks = resolveCyberLetterField(cells, inBounds);
    expect(picks.get('0,0')).toMatchObject({ localIndex: 61, flipX: false, flipY: true });
    expect(picks.get('3,0')).toMatchObject({ localIndex: 61, flipX: true, flipY: true });
    expect(picks.get('0,3')).toMatchObject({ localIndex: 61, flipX: false, flipY: false });
    expect(picks.get('3,3')).toMatchObject({ localIndex: 61, flipX: true, flipY: false });
    for (const key of ['0,0', '3,0', '0,3', '3,3'] as const) {
      expect([36, 48, 60, 72]).not.toContain(picks.get(key)?.localIndex);
    }
  });

  it('does not use 60 or 61 on a 2x2 Shell corner against Concrete', () => {
    const cells = [
      { x: 0, y: 0, brushId: 'cyber.shell' as const },
      { x: 1, y: 0, brushId: 'cyber.concrete' as const },
      { x: 0, y: 1, brushId: 'cyber.concrete' as const },
      { x: 1, y: 1, brushId: 'cyber.concrete' as const },
    ];
    const picks = resolveCyberLetterField(cells, inBounds);
    expect(picks.get('0,0')?.localIndex).not.toBe(60);
    expect(picks.get('0,0')?.localIndex).not.toBe(61);
  });

  it('never letter-matches Support 36/48/60/72 onto Shell BBAA', () => {
    const matches = listCyberLetterMatches('cyber.shell', ['B', 'B', 'A', 'A']);
    expect(matches.some((pick) => pick.localIndex === 61)).toBe(true);
    expect(matches.every((pick) => ![36, 48, 60, 72].includes(pick.localIndex))).toBe(true);
  });

  it('keeps 66 on a solid Shell blob corner', () => {
    const cells = rectangle(0, 0, 3, 3).map((cell) => ({
      ...cell,
      brushId: 'cyber.shell' as const,
    }));
    const picks = resolveCyberLetterField(cells, inBounds);
    expect(picks.get('0,0')?.localIndex).toBe(66);
    expect(picks.get('2,0')?.localIndex).toBe(66);
    expect(picks.get('0,2')?.localIndex).toBe(66);
    expect(picks.get('2,2')?.localIndex).toBe(66);
  });

  it('does not cycle a Shell stair to HHHH fill', () => {
    const cells = rectangle(10, 7, 4, 4).map((cell) => ({
      ...cell,
      brushId: ((cell.x - 10) + (cell.y - 7) >= 3 ? 'cyber.shell' : 'cyber.concrete') as 'cyber.shell' | 'cyber.concrete',
      varietySalt: cell.x === 12 && cell.y === 8 ? 1 : 0,
    }));
    const picks = resolveCyberLetterField(cells, inBounds);
    expect(picks.get('12,8')?.localIndex).toBe(52);
    expect([40, 53]).not.toContain(picks.get('12,8')?.localIndex);
  });

  it('uses 78 where two Shell stairs meet beside a 1-high Concrete tip', () => {
    const concrete = new Set([
      '10,8', '11,8', '12,8',
      '10,9', '11,9', '12,9', '13,9',
      '10,10', '11,10', '12,10',
    ]);
    const cells = rectangle(10, 7, 8, 6).map((cell) => ({
      ...cell,
      brushId: (concrete.has(`${cell.x},${cell.y}`) ? 'cyber.concrete' : 'cyber.shell') as 'cyber.shell' | 'cyber.concrete',
    }));
    const picks = resolveCyberLetterField(cells, inBounds);
    expect(picks.get('14,9')).toMatchObject({ localIndex: 78, flipX: false, flipY: false });
  });

  it('uses 78X for the opposite 1-high Concrete tip', () => {
    const concrete = new Set([
      '15,8', '16,8', '17,8',
      '14,9', '15,9', '16,9', '17,9',
      '15,10', '16,10', '17,10',
    ]);
    const cells = rectangle(10, 7, 8, 6).map((cell) => ({
      ...cell,
      brushId: (concrete.has(`${cell.x},${cell.y}`) ? 'cyber.concrete' : 'cyber.shell') as 'cyber.shell' | 'cyber.concrete',
    }));
    const picks = resolveCyberLetterField(cells, inBounds);
    expect(picks.get('13,9')).toMatchObject({ localIndex: 78, flipX: true, flipY: false });
  });

  it('does not use 78 along a straight Concrete wall', () => {
    const concrete = new Set([
      '10,8', '11,8', '12,8',
      '10,9', '11,9', '12,9',
      '10,10', '11,10', '12,10',
    ]);
    const cells = rectangle(10, 7, 8, 6).map((cell) => ({
      ...cell,
      brushId: (concrete.has(`${cell.x},${cell.y}`) ? 'cyber.concrete' : 'cyber.shell') as 'cyber.shell' | 'cyber.concrete',
    }));
    const picks = resolveCyberLetterField(cells, inBounds);
    expect([53, 40]).toContain(picks.get('13,9')?.localIndex);
  });

  it('uses mirrored 52s where Shell stairs meet under a 2-wide Concrete valley', () => {
    const concrete = new Set([
      '12,8', '13,8', '14,8', '15,8',
      '13,9', '14,9',
    ]);
    const cells = rectangle(10, 7, 8, 6).map((cell) => ({
      ...cell,
      brushId: (concrete.has(`${cell.x},${cell.y}`) ? 'cyber.concrete' : 'cyber.shell') as 'cyber.shell' | 'cyber.concrete',
    }));
    const picks = resolveCyberLetterField(cells, inBounds);
    expect(picks.get('13,10')).toMatchObject({ localIndex: 52, flipX: true, flipY: true });
    expect(picks.get('14,10')).toMatchObject({ localIndex: 52, flipX: false, flipY: true });
  });
});
