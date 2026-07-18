import type {
  PlayerAnimationDefinition,
  PlayerAtlasAssetEntry,
} from './model';
import { listRegisteredPlayerAvatarPacks } from './registry';

export function listPlayerAvatarAtlasAssets(avatarIds?: Iterable<string>): PlayerAtlasAssetEntry[] {
  const atlasAssetsByKey = new Map<string, PlayerAtlasAssetEntry>();
  for (const pack of filterAvatarPacks(avatarIds)) {
    for (const atlasAsset of pack.atlasAssets) {
      if (!atlasAssetsByKey.has(atlasAsset.key)) {
        atlasAssetsByKey.set(atlasAsset.key, atlasAsset);
      }
    }
  }
  return [...atlasAssetsByKey.values()];
}

export function listPlayerAvatarAnimations(avatarIds?: Iterable<string>): PlayerAnimationDefinition[] {
  const animationsByKey = new Map<string, PlayerAnimationDefinition>();
  for (const pack of filterAvatarPacks(avatarIds)) {
    for (const animation of pack.animations) {
      if (!animationsByKey.has(animation.key)) {
        animationsByKey.set(animation.key, animation);
      }
    }
  }
  return [...animationsByKey.values()];
}

function filterAvatarPacks(avatarIds?: Iterable<string>) {
  const packs = listRegisteredPlayerAvatarPacks();
  if (!avatarIds) return packs;
  const requested = new Set(avatarIds);
  return packs.filter((pack) => requested.has(pack.id));
}
