import type { PlayerAvatarId } from './model';

export const PLAYER_AVATAR_STORAGE_KEY = 'ep_player_avatar_id_v1';
export const PLAYER_AVATAR_CHANGED_EVENT = 'ep-player-avatar-changed';

function getAvatarIdFromUrl(): PlayerAvatarId | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const avatarId = params.get('avatar') ?? params.get('avatarId');
  return avatarId && avatarId.trim().length > 0 ? avatarId.trim() : null;
}

export function getRequestedPlayerAvatarId(): PlayerAvatarId | null {
  return getAvatarIdFromUrl() ?? getStoredPlayerAvatarId();
}

export function getStoredPlayerAvatarId(): PlayerAvatarId | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }

  const stored = window.localStorage.getItem(PLAYER_AVATAR_STORAGE_KEY);
  return typeof stored === 'string' && stored.trim().length > 0 ? stored.trim() : null;
}

export function setStoredPlayerAvatarId(avatarId: PlayerAvatarId | null): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  const normalizedAvatarId = avatarId && avatarId.trim().length > 0 ? avatarId.trim() : null;
  if (getStoredPlayerAvatarId() === normalizedAvatarId) {
    return;
  }

  if (normalizedAvatarId) {
    window.localStorage.setItem(PLAYER_AVATAR_STORAGE_KEY, normalizedAvatarId);
  } else {
    window.localStorage.removeItem(PLAYER_AVATAR_STORAGE_KEY);
  }

  window.dispatchEvent(
    new CustomEvent(PLAYER_AVATAR_CHANGED_EVENT, {
      detail: {
        avatarId: normalizedAvatarId,
      },
    }),
  );
}
