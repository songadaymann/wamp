import { describe, expect, it } from 'vitest';
import { getObjectById } from '../../../config';
import { createLiveObjectRuntimeState } from './objectFactory';

function createState(
  objectId: string,
  policeBehaviorMode: 'hunter' | 'patrol' | null,
  policePatrolShoots: boolean | null,
) {
  const config = getObjectById(objectId);
  if (!config) {
    throw new Error(`Missing ${objectId} test config.`);
  }
  return createLiveObjectRuntimeState({
    config,
    sprite: { x: 40, y: 80 } as never,
    initialDirectionX: 1,
    baseTimeSeed: 0,
    getCurrentTime: () => 1_000,
    objectiveMode: null,
    defeatMode: null,
    policeBehaviorMode,
    policePatrolShoots,
    npcMode: null,
    npcPushable: null,
    npcCanJumpFall: null,
    npcPlayerCollision: null,
    npcFriendlyFire: null,
    npcDefeatMode: null,
    swordsmanTraversalPlannerMode: 'robust',
  });
}

describe('createLiveObjectRuntimeState police defaults', () => {
  it('defaults police enemies to non-shooting hunter behavior', () => {
    expect(createState('police_patrolman', null, null)).toMatchObject({
      aiState: 'patrol',
      aiPlannerMode: 'robust',
      policeBehaviorMode: 'hunter',
      policePatrolShoots: false,
    });
  });

  it('preserves explicit police behavior and ignores police fields on other objects', () => {
    expect(createState('policewoman', 'patrol', true)).toMatchObject({
      policeBehaviorMode: 'patrol',
      policePatrolShoots: true,
    });
    expect(createState('crate', 'patrol', true)).toMatchObject({
      policeBehaviorMode: null,
      policePatrolShoots: false,
    });
  });
});
