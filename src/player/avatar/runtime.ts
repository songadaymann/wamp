import type { PlayerAvatarId, ResolvedPlayerAvatarPack } from './model';
import {
  DEFAULT_PLAYER_AVATAR_ID,
  getRegisteredPlayerAvatarPack,
} from './registry';
import { resolveActivePlayerAvatarId } from './storage';

export function resolvePlayerAvatarPack(
  avatarId: PlayerAvatarId | null | undefined,
): ResolvedPlayerAvatarPack {
  if (avatarId) {
    const matchingPack = getRegisteredPlayerAvatarPack(avatarId);
    if (matchingPack) {
      return matchingPack;
    }
  }

  const fallbackPack = getRegisteredPlayerAvatarPack(DEFAULT_PLAYER_AVATAR_ID);
  if (!fallbackPack) {
    throw new Error('Default player avatar pack is not registered.');
  }
  return fallbackPack;
}

export function resolveActivePlayerAvatarPack(): ResolvedPlayerAvatarPack {
  return resolvePlayerAvatarPack(resolveActivePlayerAvatarId());
}
