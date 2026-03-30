import type { PlayerAvatarId } from './model';

export const PLAYER_AVATAR_STORAGE_KEY = 'ep_player_avatar_id_v1';
export const STAGE_ONE_ACTIVE_PLAYER_AVATAR_ID = 'punk-465';

export function resolveActivePlayerAvatarId(): PlayerAvatarId {
  return STAGE_ONE_ACTIVE_PLAYER_AVATAR_ID;
}

export function getStoredPlayerAvatarId(): PlayerAvatarId | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }

  const stored = window.localStorage.getItem(PLAYER_AVATAR_STORAGE_KEY);
  return typeof stored === 'string' && stored.trim().length > 0 ? stored : null;
}
