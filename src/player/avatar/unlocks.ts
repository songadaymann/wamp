import type { PlayerAvatarChoice, PlayerAvatarId } from './model';
import {
  DEFAULT_PLAYER_AVATAR_ID,
  PUNK_465_PLAYER_AVATAR_ID,
  getRegisteredPlayerAvatarPack,
  listRegisteredPlayerAvatarPacks,
} from './registry';

export interface PlayerAvatarUnlockRule {
  avatarId: PlayerAvatarId;
  unlockLevel: number;
  sourceLabel: string;
}

export const PLAYER_LEVEL_AVATAR_UNLOCKS: readonly PlayerAvatarUnlockRule[] = [
  { unlockLevel: 1, avatarId: 'color-ee1841', sourceLabel: 'ee1841' },
  { unlockLevel: 2, avatarId: 'color-ff533f', sourceLabel: 'ff533f' },
  { unlockLevel: 3, avatarId: 'color-ffe86b', sourceLabel: 'ffe86b' },
  { unlockLevel: 4, avatarId: 'color-62b824', sourceLabel: '62b824' },
  { unlockLevel: 5, avatarId: 'color-1b84c2', sourceLabel: '1b84c2' },
  { unlockLevel: 6, avatarId: 'color-5f5fec', sourceLabel: '5f5fec' },
  { unlockLevel: 7, avatarId: 'color-7993f6', sourceLabel: '7993f6' },
  { unlockLevel: 8, avatarId: 'color-f65699', sourceLabel: 'f65699' },
  { unlockLevel: 9, avatarId: 'color-ff8b97', sourceLabel: 'ff8b97' },
  { unlockLevel: 10, avatarId: PUNK_465_PLAYER_AVATAR_ID, sourceLabel: 'Punks' },
] as const;

const AVATAR_UNLOCK_LEVEL_BY_ID = new Map<PlayerAvatarId, number>(
  PLAYER_LEVEL_AVATAR_UNLOCKS.map((rule) => [rule.avatarId, rule.unlockLevel]),
);

export function resolveSelectablePlayerAvatarId(
  avatarId: PlayerAvatarId | null | undefined,
): PlayerAvatarId {
  if (avatarId && getRegisteredPlayerAvatarPack(avatarId)) {
    return avatarId;
  }
  return DEFAULT_PLAYER_AVATAR_ID;
}

export function getPlayerAvatarUnlockLevel(avatarId: PlayerAvatarId): number | null {
  if (avatarId === DEFAULT_PLAYER_AVATAR_ID) {
    return 1;
  }
  return AVATAR_UNLOCK_LEVEL_BY_ID.get(avatarId) ?? null;
}

export function isPlayerAvatarUnlockedForLevel(
  avatarId: PlayerAvatarId,
  playerLevel: number,
): boolean {
  if (avatarId === DEFAULT_PLAYER_AVATAR_ID) {
    return true;
  }

  const unlockLevel = AVATAR_UNLOCK_LEVEL_BY_ID.get(avatarId);
  return typeof unlockLevel === 'number' && normalizePlayerLevel(playerLevel) >= unlockLevel;
}

export function listPlayerAvatarChoicesForLevel(
  playerLevel: number,
  selectedAvatarId: PlayerAvatarId | null | undefined,
): PlayerAvatarChoice[] {
  const normalizedLevel = normalizePlayerLevel(playerLevel);
  const selectedId = resolveSelectablePlayerAvatarId(selectedAvatarId);

  return listRegisteredPlayerAvatarPacks()
    .map((pack) => {
      const unlockLevel = getPlayerAvatarUnlockLevel(pack.id);
      const unlocked = isPlayerAvatarUnlockedForLevel(pack.id, normalizedLevel);
      return {
        avatarId: pack.id,
        label: pack.label,
        kind: pack.kind,
        colorHex: pack.colorHex ?? null,
        unlockLevel,
        unlocked,
        selected: pack.id === selectedId,
      };
    })
    .sort(compareAvatarChoices);
}

function compareAvatarChoices(left: PlayerAvatarChoice, right: PlayerAvatarChoice): number {
  const leftRank = getChoiceRank(left);
  const rightRank = getChoiceRank(right);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  const leftLevel = left.unlockLevel ?? Number.POSITIVE_INFINITY;
  const rightLevel = right.unlockLevel ?? Number.POSITIVE_INFINITY;
  if (leftLevel !== rightLevel) {
    return leftLevel - rightLevel;
  }

  return left.label.localeCompare(right.label);
}

function getChoiceRank(choice: PlayerAvatarChoice): number {
  if (choice.avatarId === DEFAULT_PLAYER_AVATAR_ID) {
    return 0;
  }
  if (choice.unlockLevel !== null) {
    return 1;
  }
  return 2;
}

function normalizePlayerLevel(playerLevel: number): number {
  return Number.isFinite(playerLevel) && playerLevel > 0 ? Math.floor(playerLevel) : 0;
}
