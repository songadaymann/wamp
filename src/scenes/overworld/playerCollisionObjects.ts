import {
  isSolidRuntimeObjectConfig,
  placedObjectLayerAllowsRuntimeCollision,
  type GameObjectConfig,
  type LayerName,
} from '../../config';

export interface PlayerCollisionRuntimeObject {
  config: GameObjectConfig;
  layer: LayerName;
  runtime: {
    npcPlayerCollision: boolean;
  };
}

export function liveObjectBlocksPlayerMovement(
  liveObject: PlayerCollisionRuntimeObject,
): boolean {
  return (
    isSolidRuntimeObjectConfig(liveObject.config) &&
    placedObjectLayerAllowsRuntimeCollision(liveObject.config, liveObject) &&
    (
      liveObject.config.category !== 'npc' ||
      liveObject.runtime.npcPlayerCollision
    )
  );
}
