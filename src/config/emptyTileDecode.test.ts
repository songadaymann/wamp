import { expect, it } from 'vitest';
import { decodeTileDataValue, encodeTileDataValue } from './editorState';
it('shares immutable empty results without sharing decoded occupied tiles', () => {
  const empty = decodeTileDataValue(-1);
  expect(decodeTileDataValue(0)).toBe(empty);
  expect(decodeTileDataValue(-123)).toBe(empty);
  expect(empty).toEqual({ gid: -1, flipX: false, flipY: false });
  expect(Object.isFrozen(empty)).toBe(true);
  expect(decodeTileDataValue(encodeTileDataValue(669, true, true))).toEqual({ gid: 669, flipX: true, flipY: true });
  expect(decodeTileDataValue(669)).not.toBe(decodeTileDataValue(669));
});
