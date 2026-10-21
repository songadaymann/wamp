import { describe, expect, it } from 'vitest';
import { roomProtectionLabel } from './roomProtection';

describe('public protection labels', () => {
  it('distinguishes a cell from a partially or fully protected Expanded Room', () => {
    expect(roomProtectionLabel({ protectedCellCount: 1 })).toBe('Protected');
    expect(roomProtectionLabel({ protectedCellCount: 1, expandedRoom: { cellCount: 2 } })).toBe('1/2 cells protected');
    expect(roomProtectionLabel({ protectedCellCount: 2, expandedRoom: { cellCount: 2 } })).toBe('2/2 cells protected');
  });
  it.each([undefined, 0, -1, 0.5, NaN, Infinity, 3])('omits absent or invalid protection %s instead of implying ownership', count => {
    expect(roomProtectionLabel({ protectedCellCount: count, expandedRoom: { cellCount: 2 } })).toBeNull();
  });
});
