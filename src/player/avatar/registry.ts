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
  type PlayerAtlasAssetEntry,
  type PlayerAvatarId,
  type PlayerAvatarKind,
  type PlayerAvatarPackDefinition,
  type ResolvedPlayerAvatarPack,
} from './model';

export const DEFAULT_PLAYER_AVATAR_ID = 'default-player';
export const PUNK_465_PLAYER_AVATAR_ID = 'punk-465';

export const PLAYER_COLOR_AVATAR_HEXES = [
  '091321',
  '18161c',
  '1b84c2',
  '1c0911',
  '277b30',
  '2c5071',
  '56cfde',
  '5e595e',
  '5f5fec',
  '62b824',
  '7993f6',
  'a51140',
  'aaa4a5',
  'bd382b',
  'c9de3e',
  'ee1841',
  'f65699',
  'faaa39',
  'ff533f',
  'ff8b97',
  'ffe86b',
  'fff3db',
] as const;

interface AvatarAtlasKeys {
  base: string;
  combat: string;
}

interface DefaultCompatiblePackOptions {
  id: PlayerAvatarId;
  label: string;
  kind: PlayerAvatarKind;
  assetRoot: string;
  atlasKeyRoot: string;
  colorHex?: string;
  source?: string;
}

function buildPackAnimationKeys(packId: PlayerAvatarId): Record<PlayerAnimationState, string> {
  return {
    idle: `player-${packId}-idle`,
    run: `player-${packId}-run`,
    'jump-rise': `player-${packId}-jump-rise`,
    'jump-fall': `player-${packId}-jump-fall`,
    'wall-slide': `player-${packId}-wall-slide`,
    'wall-jump': `player-${packId}-wall-jump`,
    'butt-stomp-flip': `player-${packId}-butt-stomp-flip`,
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

function buildStateByDefaultAnimationKey(): Record<string, PlayerAnimationState> {
  return Object.fromEntries(
    PLAYER_ANIMATION_STATES.map((state) => [DEFAULT_PLAYER_ANIMATION_KEYS[state], state]),
  ) as Record<string, PlayerAnimationState>;
}

const STATE_BY_DEFAULT_ANIMATION_KEY = buildStateByDefaultAnimationKey();

function remapDefaultPlayerAnimationAtlasKey(
  atlasKey: string,
  packAtlasKeys: AvatarAtlasKeys,
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
  packAtlasKeys: AvatarAtlasKeys,
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

function createDefaultCompatibleAtlasAssets(
  assetRoot: string,
  atlasKeys: AvatarAtlasKeys,
): PlayerAtlasAssetEntry[] {
  return [
    {
      key: atlasKeys.base,
      texturePath: `${assetRoot}/PlayerSheet.png`,
      atlasPath: `${assetRoot}/PlayerSheet.json`,
    },
    {
      key: atlasKeys.combat,
      texturePath: `${assetRoot}/PlayerCombatActionsSheet.png`,
      atlasPath: `${assetRoot}/PlayerCombatActionsSheet.json`,
    },
  ];
}

export function createDefaultCompatibleAvatarPack(
  options: DefaultCompatiblePackOptions,
): PlayerAvatarPackDefinition {
  const atlasKeys = {
    base: `${options.atlasKeyRoot}-base-atlas`,
    combat: `${options.atlasKeyRoot}-combat-atlas`,
  } as const;
  const animationKeys = buildPackAnimationKeys(options.id);

  return {
    id: options.id,
    label: options.label,
    kind: options.kind,
    colorHex: options.colorHex,
    source: options.source,
    atlasAssets: createDefaultCompatibleAtlasAssets(options.assetRoot, atlasKeys),
    animationKeys,
    animations: cloneDefaultAnimationsForPack(animationKeys, atlasKeys),
    idleTextureKey: atlasKeys.base,
    idleFrame: DEFAULT_PLAYER_IDLE_FRAME,
    visualFeetOffset: DEFAULT_PLAYER_VISUAL_FEET_OFFSET,
  };
}

const DEFAULT_PLAYER_PACK: PlayerAvatarPackDefinition = {
  id: DEFAULT_PLAYER_AVATAR_ID,
  label: 'Default',
  kind: 'default',
  atlasAssets: DEFAULT_PLAYER_ATLAS_ASSETS,
  animationKeys: DEFAULT_PLAYER_ANIMATION_KEYS,
  animations: DEFAULT_PLAYER_ANIMATIONS,
  idleTextureKey: DEFAULT_PLAYER_IDLE_TEXTURE_KEY,
  idleFrame: DEFAULT_PLAYER_IDLE_FRAME,
  visualFeetOffset: DEFAULT_PLAYER_VISUAL_FEET_OFFSET,
};

const PUNK_465_PLAYER_PACK = createDefaultCompatibleAvatarPack({
  id: PUNK_465_PLAYER_AVATAR_ID,
  label: 'Punk 465',
  kind: 'cryptopunk',
  assetRoot: 'assets/player/punk-465',
  atlasKeyRoot: 'player-punk-465',
  source: 'feat/punk-avatar-stage1-2026-03-30',
});

const COLOR_PLAYER_PACKS = PLAYER_COLOR_AVATAR_HEXES.map((hex) =>
  createDefaultCompatibleAvatarPack({
    id: `color-${hex}`,
    label: `Color #${hex.toUpperCase()}`,
    kind: 'color',
    colorHex: hex,
    assetRoot: `assets/player/colors/${hex}`,
    atlasKeyRoot: `player-color-${hex}`,
    source: 'Sprites-and-Things/player/otherColors',
  }),
);

const PLAYER_AVATAR_PACKS = new Map<string, PlayerAvatarPackDefinition>(
  [
    DEFAULT_PLAYER_PACK,
    PUNK_465_PLAYER_PACK,
    ...COLOR_PLAYER_PACKS,
  ].map((pack) => [pack.id, pack]),
);

export function listRegisteredPlayerAvatarPacks(): ResolvedPlayerAvatarPack[] {
  return [...PLAYER_AVATAR_PACKS.values()];
}

export function getRegisteredPlayerAvatarPack(
  avatarId: PlayerAvatarId,
): ResolvedPlayerAvatarPack | null {
  return PLAYER_AVATAR_PACKS.get(avatarId) ?? null;
}

export function registerPlayerAvatarPack(
  pack: PlayerAvatarPackDefinition,
): ResolvedPlayerAvatarPack {
  PLAYER_AVATAR_PACKS.set(pack.id, pack);
  return pack;
}
