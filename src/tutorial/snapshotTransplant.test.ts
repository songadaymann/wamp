import { describe, expect, it } from 'vitest';
import { createDefaultRoomGoal } from '../goals/roomGoals';
import { cloneRoomSnapshot, createDefaultRoomSnapshot } from '../persistence/roomModel';
import {
  rewriteTutorialSnapshotForClaim,
  tutorialSnapshotContentMatches,
} from './snapshotTransplant';

describe('tutorial snapshot transplant', () => {
  it('rewrites only identity and draft metadata while preserving authored content', () => {
    const source = createDefaultRoomSnapshot('-10,-6', { x: -10, y: -6 });
    source.title = 'A private dream';
    source.background = 'aurora';
    source.tileData.terrain[10]![10] = 492;
    source.placedObjects.push({ id: 'coin_gold', x: 40, y: 40, instanceId: 'coin' });
    source.spawnPoint = { x: 40, y: 300 };
    const goal = createDefaultRoomGoal('reach_exit');
    if (goal.type !== 'reach_exit') throw new Error('Expected reach-exit goal.');
    goal.exit = { x: 600, y: 300 };
    source.goal = goal;

    const transplanted = rewriteTutorialSnapshotForClaim(
      source,
      { x: 7, y: 9 },
      '2026-08-14T12:00:00.000Z',
    );
    expect(transplanted).toMatchObject({
      id: '7,9',
      coordinates: { x: 7, y: 9 },
      version: 1,
      status: 'draft',
      createdAt: '2026-08-14T12:00:00.000Z',
      updatedAt: '2026-08-14T12:00:00.000Z',
      publishedAt: null,
      title: 'A private dream',
      background: 'aurora',
    });
    expect(tutorialSnapshotContentMatches(source, transplanted)).toBe(true);
    expect(source.id).toBe('-10,-6');
  });

  it('detects read-after-error recovery mismatches', () => {
    const expected = createDefaultRoomSnapshot('1,1', { x: 1, y: 1 });
    const actual = cloneRoomSnapshot(expected);
    actual.placedObjects.push({ id: 'coin_gold', x: 16, y: 16, instanceId: 'different' });
    expect(tutorialSnapshotContentMatches(expected, actual)).toBe(false);
  });
});
