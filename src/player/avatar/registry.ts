import {
  DEFAULT_PLAYER_ANIMATION_KEYS,
  DEFAULT_PLAYER_ANIMATIONS,
  DEFAULT_PLAYER_ATLAS_ASSETS,
  DEFAULT_PLAYER_ATLAS_KEYS,
  DEFAULT_PLAYER_IDLE_FRAME,
  DEFAULT_PLAYER_IDLE_TEXTURE_KEY,
  DEFAULT_PLAYER_VISUAL_FEET_OFFSET,
} from '../defaultPlayer';
import {
  PLAYER_ANIMATION_STATES,
  type PlayerAnimationDefinition,
  type PlayerAnimationState,
  type PlayerAvatarId,
  type PlayerAvatarPackDefinition,
  type ResolvedPlayerAvatarPack,
} from './model';

export const DEFAULT_PLAYER_AVATAR_ID = 'default-player';
export const PUNK_465_PLAYER_AVATAR_ID = 'punk-465';

const PUNK_465_ASSET_ROOT = 'assets/player/punk-465';
const PUNK_465_ATLAS_KEYS = {
  base: 'player-punk-465-base-atlas',
  combat: 'player-punk-465-combat-atlas',
} as const;

function buildPackAnimationKeys(packId: PlayerAvatarId): Record<PlayerAnimationState, string> {
  return {
    idle: `player-${packId}-idle`,
    run: `player-${packId}-run`,
    'jump-rise': `player-${packId}-jump-rise`,
    'jump-fall': `player-${packId}-jump-fall`,
    'wall-slide': `player-${packId}-wall-slide`,
    'wall-jump': `player-${packId}-wall-jump`,
    land: `player-${packId}-land`,
    'ladder-climb': `player-${packId}-ladder-climb`,
    crouch: `player-${packId}-crouch`,
    crawl: `player-${packId}-crawl`,
    push: `player-${packId}-push`,
    pull: `player-${packId}-pull`,
    'sword-slash': `player-${packId}-sword-slash`,
    'air-slash-down': `player-${packId}-air-slash-down`,
    'gun-fire': `player-${packId}-gun-fire`,
  };
}

function buildStateByAnimationKey(): Record<string, PlayerAnimationState> {
  return Object.fromEntries(
    PLAYER_ANIMATION_STATES.map((state) => [DEFAULT_PLAYER_ANIMATION_KEYS[state], state]),
  ) as Record<string, PlayerAnimationState>;
}

const STATE_BY_DEFAULT_ANIMATION_KEY = buildStateByAnimationKey();

function remapDefaultPlayerAnimationAtlasKey(
  atlasKey: string,
  packAtlasKeys: typeof PUNK_465_ATLAS_KEYS,
): string {
  if (atlasKey === DEFAULT_PLAYER_ATLAS_KEYS.base) {
    return packAtlasKeys.base;
  }
  if (atlasKey === DEFAULT_PLAYER_ATLAS_KEYS.combat) {
    return packAtlasKeys.combat;
  }
  return atlasKey;
}

function cloneDefaultAnimationsForPack(
  animationKeys: Record<PlayerAnimationState, string>,
  packAtlasKeys: typeof PUNK_465_ATLAS_KEYS,
): PlayerAnimationDefinition[] {
  return DEFAULT_PLAYER_ANIMATIONS.map((animation) => {
    const state = STATE_BY_DEFAULT_ANIMATION_KEY[animation.key];
    if (!state) {
      throw new Error(`Missing player animation state mapping for ${animation.key}.`);
    }

    return {
      ...animation,
      key: animationKeys[state],
      atlasKey: remapDefaultPlayerAnimationAtlasKey(animation.atlasKey, packAtlasKeys),
    };
  });
}

const DEFAULT_PLAYER_PACK: PlayerAvatarPackDefinition = {
  id: DEFAULT_PLAYER_AVATAR_ID,
  atlasAssets: DEFAULT_PLAYER_ATLAS_ASSETS,
  animationKeys: DEFAULT_PLAYER_ANIMATION_KEYS,
  animations: DEFAULT_PLAYER_ANIMATIONS,
  idleTextureKey: DEFAULT_PLAYER_IDLE_TEXTURE_KEY,
  idleFrame: DEFAULT_PLAYER_IDLE_FRAME,
  visualFeetOffset: DEFAULT_PLAYER_VISUAL_FEET_OFFSET,
};

const PUNK_465_ANIMATION_KEYS = buildPackAnimationKeys(PUNK_465_PLAYER_AVATAR_ID);

const PUNK_465_PLAYER_PACK: PlayerAvatarPackDefinition = {
  id: PUNK_465_PLAYER_AVATAR_ID,
  atlasAssets: [
    {
      key: PUNK_465_ATLAS_KEYS.base,
      texturePath: `${PUNK_465_ASSET_ROOT}/PlayerSheet.png`,
      atlasPath: `${PUNK_465_ASSET_ROOT}/PlayerSheet.json`,
    },
    {
      key: PUNK_465_ATLAS_KEYS.combat,
      texturePath: `${PUNK_465_ASSET_ROOT}/PlayerCombatActionsSheet.png`,
      atlasPath: `${PUNK_465_ASSET_ROOT}/PlayerCombatActionsSheet.json`,
    },
  ],
  animationKeys: PUNK_465_ANIMATION_KEYS,
  animations: cloneDefaultAnimationsForPack(PUNK_465_ANIMATION_KEYS, PUNK_465_ATLAS_KEYS),
  idleTextureKey: PUNK_465_ATLAS_KEYS.base,
  idleFrame: DEFAULT_PLAYER_IDLE_FRAME,
  visualFeetOffset: DEFAULT_PLAYER_VISUAL_FEET_OFFSET,
};

const PLAYER_AVATAR_PACKS: Record<string, PlayerAvatarPackDefinition> = {
  [DEFAULT_PLAYER_AVATAR_ID]: DEFAULT_PLAYER_PACK,
  [PUNK_465_PLAYER_AVATAR_ID]: PUNK_465_PLAYER_PACK,
};

export function listRegisteredPlayerAvatarPacks(): ResolvedPlayerAvatarPack[] {
  return Object.values(PLAYER_AVATAR_PACKS);
}

export function getRegisteredPlayerAvatarPack(
  avatarId: PlayerAvatarId,
): ResolvedPlayerAvatarPack | null {
  return PLAYER_AVATAR_PACKS[avatarId] ?? null;
}
