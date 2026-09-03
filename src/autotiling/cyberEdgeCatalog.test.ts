import { describe, expect, it } from 'vitest';
import { catalogLocalIndicesForBrush, pickCanonicalCatalogCandidate, pickVariedCatalogCandidate, type CyberOrientedTile } from './cyberEdgeCatalog';

function pool(...localIndices: number[]): CyberOrientedTile[] {
  return localIndices.flatMap((localIndex) => (
    [false, true].flatMap((flipX) => (
      [false, true].map((flipY) => ({ localIndex, flipX, flipY }))
    ))
  ));
}

function lookKey(tile: CyberOrientedTile): string {
  return `${tile.localIndex}:${Number(tile.flipX)}${Number(tile.flipY)}`;
}

describe('pickVariedCatalogCandidate', () => {
  it('treats alternate tiles and each legal flip as a separate choice', () => {
    const candidates = pool(11, 33, 35);
    expect(candidates).toHaveLength(12);

    const seen = new Set<string>();
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const pick = pickVariedCatalogCandidate(candidates, x, y);
        seen.add(lookKey(pick));
      }
    }
    expect(seen.size).toBeGreaterThan(6);
    expect([...seen].some((key) => key.startsWith('11:'))).toBe(true);
    expect([...seen].some((key) => key.startsWith('33:'))).toBe(true);
    expect([...seen].some((key) => key.startsWith('35:'))).toBe(true);
  });

  it('is stable for the same cell so a re-solve does not flicker', () => {
    const candidates = pool(11, 33, 35);
    expect(pickVariedCatalogCandidate(candidates, 4, 7)).toEqual(
      pickVariedCatalogCandidate(candidates, 4, 7),
    );
  });

  it('cycles to a different look on each salt step when several tiles fit', () => {
    const candidates = pool(11, 33, 35);
    const seen = new Set<string>();
    let previous = '';
    for (let salt = 0; salt < 12; salt += 1) {
      const pick = pickVariedCatalogCandidate(candidates, 4, 7, { salt });
      const key = lookKey(pick);
      expect(key).not.toBe(previous);
      seen.add(key);
      previous = key;
    }
    expect(seen.size).toBe(12);
    expect(pickVariedCatalogCandidate(candidates, 4, 7, { salt: 3 })).toEqual(
      pickVariedCatalogCandidate(candidates, 4, 7, { salt: 3 }),
    );
    expect(pickVariedCatalogCandidate(candidates, 4, 7, { salt: 12 })).toEqual(
      pickVariedCatalogCandidate(candidates, 4, 7),
    );
  });

  it('cycles shell fill between flat 53 and rare 40, without flipping either', () => {
    const candidates: CyberOrientedTile[] = [
      ...pool(53),
      ...pool(40).map((tile) => ({ ...tile, rare: true })),
    ];
    const order = Array.from({ length: 4 }, (_, salt) => (
      pickVariedCatalogCandidate(candidates, 2, 3, { salt })
    ));
    for (const pick of order) {
      expect(pick.flipX).toBe(false);
      expect(pick.flipY).toBe(false);
    }
    expect(new Set(order.map((pick) => pick.localIndex))).toEqual(new Set([53, 40]));
    expect(order[0]?.localIndex).not.toBe(order[1]?.localIndex);
    expect(order[2]?.localIndex).toBe(order[0]?.localIndex);
  });

  it('cycles rare edge splash 28 against flat 27 and keeps 28 flipped with A', () => {
    const candidates: CyberOrientedTile[] = [
      { localIndex: 27, flipX: false, flipY: true },
      { localIndex: 28, flipX: false, flipY: true, rare: true },
    ];
    const order = Array.from({ length: 4 }, (_, salt) => (
      pickVariedCatalogCandidate(candidates, 2, 3, { salt })
    ));
    for (const pick of order) {
      expect(pick.flipY).toBe(true);
      expect(pick.flipX).toBe(false);
    }
    expect(new Set(order.map((pick) => pick.localIndex))).toEqual(new Set([27, 28]));
  });

  it('does not change a solid-color tile that has no other look', () => {
    const candidates = pool(53);
    for (let salt = 0; salt < 4; salt += 1) {
      expect(pickVariedCatalogCandidate(candidates, 0, 0, { salt })).toEqual({
        localIndex: 53, flipX: false, flipY: false,
      });
    }
  });

  it('cycles CCCC fill as 64, then 82, then each 82 flip', () => {
    const candidates: CyberOrientedTile[] = [
      ...pool(64),
      ...pool(82).map((tile) => ({ ...tile, rare: true })),
    ];
    const order = Array.from({ length: 5 }, (_, salt) => (
      pickVariedCatalogCandidate(candidates, 1, 2, { salt })
    ));
    for (const pick of order) {
      if (pick.localIndex === 64) {
        expect(pick.flipX).toBe(false);
        expect(pick.flipY).toBe(false);
      }
    }
    const keys = order.map(lookKey);
    expect(new Set(keys).size).toBe(5);
    expect(keys[0]).toBe('64:00');
    expect(keys.slice(1).every((key) => key.startsWith('82:'))).toBe(true);
  });

  it('includes rare splashes in the click cycle so they are not only a lucky roll', () => {
    const candidates: CyberOrientedTile[] = [
      ...pool(33, 35),
      ...pool(11).map((tile) => ({ ...tile, rare: true })),
    ];
    const seen = new Set<number>();
    for (let salt = 0; salt < 12; salt += 1) {
      seen.add(pickVariedCatalogCandidate(candidates, 4, 7, { salt }).localIndex);
    }
    expect(seen.has(11)).toBe(true);
    expect(seen.has(33)).toBe(true);
    expect(seen.has(35)).toBe(true);
  });

  it('picks flat 64 far more often than a rare CCCC alternate on the first paint', () => {
    const candidates: CyberOrientedTile[] = [
      ...pool(64),
      ...pool(20).map((tile) => ({ ...tile, rare: true })),
    ];
    let textured = 0;
    const samples = 40 * 22;
    for (let i = 0; i < samples; i += 1) {
      const pick = pickVariedCatalogCandidate(candidates, i % 40, Math.floor(i / 40));
      if (pick.localIndex !== 64) textured += 1;
    }
    expect(textured).toBeGreaterThan(0);
    expect(textured).toBeLessThan(Math.floor(samples * 0.08));
  });

  it('uses rare paint-splash alternates much less often than common art', () => {
    const candidates: CyberOrientedTile[] = [
      ...pool(33, 35),
      ...pool(11).map((tile) => ({ ...tile, rare: true })),
    ];
    let rareCount = 0;
    const samples = 40 * 22;
    for (let i = 0; i < samples; i += 1) {
      const pick = pickVariedCatalogCandidate(candidates, i % 40, Math.floor(i / 40));
      if (pick.localIndex === 11) rareCount += 1;
    }
    expect(rareCount).toBeGreaterThan(0);
    expect(rareCount).toBeLessThan(Math.floor(samples * 0.08));
  });

  it('still picks a rare tile when it is the only match', () => {
    const rares = pool(11).map((tile) => ({ ...tile, rare: true }));
    expect(pickVariedCatalogCandidate(rares, 0, 0).localIndex).toBe(11);
  });

  it('does not fall into a two-color checkerboard across a grid', () => {
    const candidates = pool(11, 33);
    let even11 = 0;
    let odd11 = 0;
    let total11 = 0;
    const looks = new Set<string>();
    for (let y = 0; y < 12; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const pick = pickVariedCatalogCandidate(candidates, x, y);
        looks.add(lookKey(pick));
        if (pick.localIndex !== 11) continue;
        total11 += 1;
        if ((x + y) % 2 === 0) even11 += 1;
        else odd11 += 1;
      }
    }
    expect(looks.size).toBeGreaterThan(3);
    expect(total11).toBeGreaterThan(20);
    expect(even11 / total11).toBeGreaterThan(0.25);
    expect(even11 / total11).toBeLessThan(0.75);
  });

  it('skips a neighboring look when another alternate exists', () => {
    const candidates = pool(11, 33);
    const first = pickVariedCatalogCandidate(candidates, 2, 3);
    const next = pickVariedCatalogCandidate(candidates, 3, 3, { avoid: [first] });
    expect(next).not.toEqual(first);
  });
});

describe('pickCanonicalCatalogCandidate', () => {
  it('keeps the unflipped look when several flips all match', () => {
    expect(pickCanonicalCatalogCandidate(pool(50))).toEqual({
      localIndex: 50,
      flipX: false,
      flipY: false,
    });
  });

  it('keeps a connecting flip when that is the only match', () => {
    expect(pickCanonicalCatalogCandidate([
      { localIndex: 51, flipX: true, flipY: false },
    ])).toEqual({
      localIndex: 51,
      flipX: true,
      flipY: false,
    });
  });
});

describe('cyber shell catalog', () => {
  it('only authors blob tiles plus diagonal cladding on Concrete', () => {
    expect(catalogLocalIndicesForBrush('cyber.shell').sort((a, b) => a - b)).toEqual([
      17, 26, 27, 28, 29, 40, 42, 52, 53, 54, 61, 66, 78, 79, 83,
    ]);
  });
});
