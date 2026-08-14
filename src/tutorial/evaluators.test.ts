import { describe, expect, it } from 'vitest';
import { createDefaultRoomGoal } from '../goals/roomGoals';
import { cloneRoomSnapshot, createDefaultRoomSnapshot } from '../persistence/roomModel';
import { TUTORIAL_BRIDGE_ROOM } from './config';
import { evaluateBridgeSnapshot, evaluateCreativeChecklist } from './evaluators';
import { createEmptyCreativeChecklist } from './model';

describe('tutorial snapshot evaluators', () => {
  it('requires added terrain inside the pinned bridge corridor', () => {
    const template = createDefaultRoomSnapshot('-10,-6', { x: -10, y: -6 });
    const working = cloneRoomSnapshot(template);
    working.tileData.terrain[12]![15] = 492;
    working.tileData.terrain[12]![16] = 492;
    expect(evaluateBridgeSnapshot(template, working)).toEqual({
      addedTerrainTiles: 2,
      readyToPlaytest: false,
    });
    working.tileData.terrain[12]![17] = 492;
    expect(evaluateBridgeSnapshot(template, working).readyToPlaytest).toBe(true);

    working.tileData.terrain[12]![TUTORIAL_BRIDGE_ROOM.bridgeRegion.maxTileX + 1] = 492;
    expect(evaluateBridgeSnapshot(template, working).addedTerrainTiles).toBe(3);
  });

  it('recognizes the optional creative checklist from room-domain data', () => {
    const room = createDefaultRoomSnapshot('0,0', { x: 0, y: 0 });
    room.background = 'forest';
    room.tileData.terrain[19]![0] = 492;
    room.placedObjects = [
      { id: 'sign', x: 16, y: 16, instanceId: 'deco' },
      { id: 'coin_gold', x: 32, y: 16, instanceId: 'collect' },
      { id: 'slime_blue', x: 48, y: 16, instanceId: 'enemy' },
    ];
    room.spawnPoint = { x: 24, y: 304 };
    const goal = createDefaultRoomGoal('reach_exit');
    if (goal.type !== 'reach_exit') throw new Error('Expected reach-exit goal.');
    goal.exit = { x: 600, y: 304 };
    room.goal = goal;

    expect(evaluateCreativeChecklist(room, createEmptyCreativeChecklist())).toEqual({
      background: 'done',
      ground: 'done',
      decoration: 'done',
      collectible: 'done',
      enemy: 'done',
      spawn_and_goal: 'done',
    });
  });

  it('preserves explicit skips until an item is actually completed', () => {
    const room = createDefaultRoomSnapshot('0,0', { x: 0, y: 0 });
    const previous = createEmptyCreativeChecklist();
    previous.enemy = 'skipped';
    expect(evaluateCreativeChecklist(room, previous).enemy).toBe('skipped');
    room.placedObjects.push({ id: 'slime_blue', x: 16, y: 16, instanceId: 'enemy' });
    expect(evaluateCreativeChecklist(room, previous).enemy).toBe('done');
  });
});
