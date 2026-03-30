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

export interface PlayerAvatarPackDefinition {
  id: PlayerAvatarId;
  atlasAssets: readonly PlayerAtlasAssetEntry[];
  animationKeys: Readonly<Record<PlayerAnimationState, string>>;
  animations: readonly PlayerAnimationDefinition[];
  idleTextureKey: string;
  idleFrame: string;
  visualFeetOffset: number;
}

export type ResolvedPlayerAvatarPack = PlayerAvatarPackDefinition;
