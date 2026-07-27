import { describe, expect, it } from 'vitest';
import { getObjectById, type LayerName } from '../../config';
import {
  liveObjectBlocksPlayerMovement,
  type PlayerCollisionRuntimeObject,
} from './playerCollisionObjects';

function createNpc(
  npcPlayerCollision: boolean,
  layer: LayerName = 'terrain',
): PlayerCollisionRuntimeObject {
  const config = getObjectById('jimothy');
  if (!config) {
    throw new Error('Jimothy config is required for player-collision tests.');
  }

  return {
    config,
    layer,
    runtime: { npcPlayerCollision },
  };
}

describe('runtime objects that block player movement', () => {
  it('does not treat an NPC with Player Collision disabled as a standing obstacle', () => {
    expect(liveObjectBlocksPlayerMovement(createNpc(false))).toBe(false);
  });

  it('treats a terrain-layer NPC with Player Collision enabled as solid', () => {
    expect(liveObjectBlocksPlayerMovement(createNpc(true))).toBe(true);
  });

  it('does not treat a background-layer NPC as solid', () => {
    expect(liveObjectBlocksPlayerMovement(createNpc(true, 'background'))).toBe(false);
  });
});
