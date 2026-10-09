import { describe, expect, it } from 'vitest';
import { createRoomSmartTerrainState } from '../../autotiling/model';
import { sameSmartMetadata } from './smartHistory';

describe('Smart history metadata comparison', () => {
  it('recognizes equivalent normalized copies without relying on map insertion order', () => {
    const state = createRoomSmartTerrainState();
    expect(sameSmartMetadata(state, structuredClone(state))).toBe(true);
    expect(sameSmartMetadata({ a: 1, b: { x: false } }, { b: { x: false }, a: 1 })).toBe(true);
  });
  it('detects semantic-only settings, nested locks and suppressed-output order changes', () => {
    const state = createRoomSmartTerrainState();
    expect(sameSmartMetadata(state, { ...state, detailsEnabled: !state.detailsEnabled })).toBe(false);
    expect(sameSmartMetadata({ lock: { value: 0 } }, { lock: { value: -1 } })).toBe(false);
    expect(sameSmartMetadata(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameSmartMetadata({}, { deleted: undefined })).toBe(false);
    expect(sameSmartMetadata([], {})).toBe(false);
  });
});
