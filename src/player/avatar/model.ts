export const PLAYER_ANIMATION_STATES = [
  'idle',
  'run',
  'jump-rise',
  'jump-fall',
  'wall-slide',
  'wall-jump',
  'land',
  'ladder-climb',
  'crouch',
  'crawl',
  'push',
  'pull',
  'sword-slash',
  'air-slash-down',
  'gun-fire',
] as const;

export type PlayerAnimationState = (typeof PLAYER_ANIMATION_STATES)[number];

export type PlayerAvatarId = string;

export type PlayerAvatarKind =
  | 'default'
  | 'color'
  | 'cryptopunk'
  | 'custom';

export interface PlayerAtlasAssetEntry {
  key: string;
  texturePath: string;
  atlasPath: string;
}

export interface PlayerAnimationDefinition {
  key: string;
  atlasKey: string;
  frameNames: string[];
  frameRate: number;
  repeat: number;
}

export interface PlayerAvatarManifestAssets {
  baseTexture: string;
  baseAtlas: string;
  combatTexture: string;
  combatAtlas: string;
}

export interface PlayerAvatarManifest {
  version: number;
  avatarId?: string;
  punkId?: number;
  punkType?: string | null;
  accessories?: string[];
  assetBaseUrl: string;
  assets: PlayerAvatarManifestAssets;
  headImageUrl?: string | null;
  generatedAt?: string;
  notes?: string;
}

export interface PlayerAvatarPackDefinition {
  id: PlayerAvatarId;
  label: string;
  kind: PlayerAvatarKind;
  colorHex?: string;
  source?: string;
  atlasAssets: readonly PlayerAtlasAssetEntry[];
  animationKeys: Readonly<Record<PlayerAnimationState, string>>;
  animations: readonly PlayerAnimationDefinition[];
  idleTextureKey: string;
  idleFrame: string;
  visualFeetOffset: number;
}

export type ResolvedPlayerAvatarPack = PlayerAvatarPackDefinition;

export interface PlayerAvatarChoice {
  avatarId: PlayerAvatarId;
  label: string;
  kind: PlayerAvatarKind;
  colorHex: string | null;
  unlockLevel: number | null;
  unlocked: boolean;
  selected: boolean;
}
