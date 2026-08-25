import { describe, expect, it } from 'vitest';
import { pickVariedCatalogCandidate, type CyberOrientedTile } from './cyberEdgeCatalog';

function pool(...localIndices: number[]): CyberOrientedTile[] {
  return localIndices.flatMap((localIndex) => (
    [false, true].flatMap((flipX) => (
      [false, true].map((flipY) => ({ localIndex, flipX, flipY }))
    ))
  ));
}

describe('pickVariedCatalogCandidate', () => {
  it('treats alternate tiles and each legal flip as a separate choice', () => {
    const candidates = pool(11, 33, 35);
    expect(candidates).toHaveLength(12);

    const seen = new Set<string>();
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const pick = pickVariedCatalogCandidate(candidates, x, y);
        seen.add(`${pick.localIndex}:${Number(pick.flipX)}${Number(pick.flipY)}`);
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

  it('re-rolls when the variety salt changes', () => {
    const candidates = pool(11, 33, 35);
    const seen = new Set<string>();
    for (let salt = 0; salt < 16; salt += 1) {
      const pick = pickVariedCatalogCandidate(candidates, 4, 7, { salt });
      seen.add(`${pick.localIndex}:${Number(pick.flipX)}${Number(pick.flipY)}`);
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(pickVariedCatalogCandidate(candidates, 4, 7, { salt: 3 })).toEqual(
      pickVariedCatalogCandidate(candidates, 4, 7, { salt: 3 }),
    );
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

  it('skips a neighboring look when another alternate exists', () => {
    const candidates = pool(11, 33);
    const first = pickVariedCatalogCandidate(candidates, 2, 3);
    const next = pickVariedCatalogCandidate(candidates, 3, 3, { avoid: [first] });
    expect(next).not.toEqual(first);
  });
});
