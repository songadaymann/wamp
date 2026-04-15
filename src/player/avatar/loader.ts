import type {
  PlayerAnimationDefinition,
  PlayerAtlasAssetEntry,
} from './model';
import { listRegisteredPlayerAvatarPacks } from './registry';

export function listPlayerAvatarAtlasAssets(): PlayerAtlasAssetEntry[] {
  const atlasAssetsByKey = new Map<string, PlayerAtlasAssetEntry>();
  for (const pack of listRegisteredPlayerAvatarPacks()) {
    for (const atlasAsset of pack.atlasAssets) {
      if (!atlasAssetsByKey.has(atlasAsset.key)) {
        atlasAssetsByKey.set(atlasAsset.key, atlasAsset);
      }
    }
  }
  return [...atlasAssetsByKey.values()];
}

export function listPlayerAvatarAnimations(): PlayerAnimationDefinition[] {
  const animationsByKey = new Map<string, PlayerAnimationDefinition>();
  for (const pack of listRegisteredPlayerAvatarPacks()) {
    for (const animation of pack.animations) {
      if (!animationsByKey.has(animation.key)) {
        animationsByKey.set(animation.key, animation);
      }
    }
  }
  return [...animationsByKey.values()];
}
