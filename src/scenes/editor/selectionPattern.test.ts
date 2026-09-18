import { describe, expect, it } from 'vitest';
import {
  appendPatternCells,
  collectOccupiedDragOrder,
  diagonalPatternIndex,
  pathPatternIndex,
  removePatternCells,
  walkDragCells,
} from './selectionPattern';

describe('selectionPattern', () => {
  it('orders a 4x2 drag by click direction', () => {
    const occupied = () => true;
    expect(
      collectOccupiedDragOrder(0, 0, 3, 1, occupied).map((cell) => `${cell.col},${cell.row}`),
    ).toEqual(['0,0', '1,0', '2,0', '3,0', '0,1', '1,1', '2,1', '3,1']);
    expect(
      collectOccupiedDragOrder(3, 1, 0, 0, occupied).map((cell) => `${cell.col},${cell.row}`),
    ).toEqual(['3,1', '2,1', '1,1', '0,1', '3,0', '2,0', '1,0', '0,0']);
    expect(
      collectOccupiedDragOrder(0, 1, 3, 0, occupied).map((cell) => `${cell.col},${cell.row}`),
    ).toEqual(['0,1', '1,1', '2,1', '3,1', '0,0', '1,0', '2,0', '3,0']);
    expect(
      collectOccupiedDragOrder(3, 0, 0, 1, occupied).map((cell) => `${cell.col},${cell.row}`),
    ).toEqual(['3,0', '2,0', '1,0', '0,0', '3,1', '2,1', '1,1', '0,1']);
  });

  it('renumbers after removing a middle ctrl-selected tile and appends new tiles', () => {
    const order = walkDragCells(0, 0, 3, 0);
    const removed = removePatternCells(order, [{ col: 1, row: 0 }]);
    expect(removed.map((cell) => `${cell.col},${cell.row}`)).toEqual(['0,0', '2,0', '3,0']);
    expect(appendPatternCells(removed, [{ col: 4, row: 0 }]).map((cell) => `${cell.col},${cell.row}`)).toEqual([
      '0,0',
      '2,0',
      '3,0',
      '4,0',
    ]);
  });

  it('builds a repeating diagonal for area stamps and a sequential path for lines', () => {
    const area = [
      [0, 1, 2, 3, 0, 1, 2, 3],
      [3, 0, 1, 2, 3, 0, 1, 2],
      [2, 3, 0, 1, 2, 3, 0, 1],
      [1, 2, 3, 0, 1, 2, 3, 0],
      [0, 1, 2, 3, 0, 1, 2, 3],
    ];
    for (let y = 0; y < area.length; y += 1) {
      for (let x = 0; x < area[y]!.length; x += 1) {
        expect(diagonalPatternIndex(x, y, 4)).toBe(area[y]![x]);
      }
    }
    expect([0, 1, 2, 3, 4, 5].map((step) => pathPatternIndex(step, 4))).toEqual([0, 1, 2, 3, 0, 1]);
  });
});
