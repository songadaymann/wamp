import { describe, expect, it } from 'vitest';
import {
  TILE_SIZE,
  getObjectById,
  getObjectPlacementPointForTile,
  getObjectPreviewRectForTile,
  getObjectRuntimeBodyRect,
} from '../config';
import {
  DEFAULT_POLICE_BEHAVIOR_MODE,
  POLICE_ENEMY_ANIMATIONS,
  POLICE_ENEMY_EXTRA_SPRITESHEETS,
  POLICE_ENEMY_OBJECT_IDS,
  getPlacedPoliceBehaviorMode,
  getPlacedPolicePatrolShoots,
  getPoliceAnimationKey,
  isPoliceEnemyObjectId,
  normalizePoliceBehaviorMode,
} from './policeEnemy';

describe('police enemy model', () => {
  it('normalizes persisted behavior with safe hunter and no-shoot defaults', () => {
    expect(normalizePoliceBehaviorMode('hunter')).toBe('hunter');
    expect(normalizePoliceBehaviorMode('patrol')).toBe('patrol');
    expect(normalizePoliceBehaviorMode('wander')).toBeNull();
    expect(getPlacedPoliceBehaviorMode({ id: 'policewoman' })).toBe(DEFAULT_POLICE_BEHAVIOR_MODE);
    expect(getPlacedPolicePatrolShoots({ id: 'police_patrolman' })).toBe(false);
    expect(getPlacedPolicePatrolShoots({ id: 'police_patrolman', policePatrolShoots: true })).toBe(true);
    expect(getPlacedPoliceBehaviorMode({ id: 'slime_blue', policeBehaviorMode: 'patrol' })).toBeNull();
  });

  it('registers complete animation manifests for both placeable variants', () => {
    expect(POLICE_ENEMY_OBJECT_IDS.every(isPoliceEnemyObjectId)).toBe(true);
    for (const objectId of POLICE_ENEMY_OBJECT_IDS) {
      expect(getPoliceAnimationKey(objectId, 'idle')).toBe(`${objectId}-idle`);
      expect(POLICE_ENEMY_ANIMATIONS.map((animation) => animation.key)).toEqual(
        expect.arrayContaining([
          `${objectId}-idle`,
          `${objectId}-run`,
          `${objectId}-jump-rise`,
          `${objectId}-jump-fall`,
          `${objectId}-shoot`,
          `${objectId}-reload`,
          `${objectId}-hurt`,
          `${objectId}-death`,
        ]),
      );
    }
    expect(POLICE_ENEMY_EXTRA_SPRITESHEETS).toHaveLength(12);
  });

  it('bottom-aligns preview art and collision bodies to the placement tile', () => {
    const tileX = 10;
    const tileY = 15;
    const tileBottom = (tileY + 1) * TILE_SIZE;

    for (const objectId of POLICE_ENEMY_OBJECT_IDS) {
      const config = getObjectById(objectId);
      expect(config).toBeDefined();
      expect(config?.displayScale).toBe(1.25);
      const placementPoint = getObjectPlacementPointForTile(config!, tileX, tileY);
      const previewRect = getObjectPreviewRectForTile(config!, tileX, tileY);
      const bodyRect = getObjectRuntimeBodyRect(config!, placementPoint);

      expect(previewRect.y + previewRect.height).toBe(tileBottom);
      expect(bodyRect.y + bodyRect.height).toBe(tileBottom);
    }
  });
});
