import type { CustomSpriteDefinition, CustomSpriteKind } from './model';

export const CUSTOM_SPRITE_CATALOG_DEFAULT_PAGE_SIZE = 32;
export const CUSTOM_SPRITE_CATALOG_MAX_PAGE_SIZE = 48;
export const CUSTOM_SPRITE_ACCOUNT_LIMIT = 128;
export const CUSTOM_SPRITE_USE_REQUESTED_EVENT = 'custom-sprite-use-requested';
export const CUSTOM_SPRITE_REMIX_REQUESTED_EVENT = 'custom-sprite-remix-requested';

export type CustomSpriteCatalogStatus = 'active' | 'blocked' | 'deleted';

export interface CustomSpriteCatalogCreator {
  userId: string | null;
  displayName: string;
  username: string | null;
  legacy: boolean;
}

export interface CustomSpriteCatalogRemixSource {
  spriteId: string;
  name: string;
  creatorDisplayName: string;
}

export interface CustomSpriteCatalogEntry {
  sprite: CustomSpriteDefinition;
  revision: number;
  status: CustomSpriteCatalogStatus;
  creator: CustomSpriteCatalogCreator;
  remixedFrom: CustomSpriteCatalogRemixSource | null;
}

export interface CustomSpriteCatalogPage {
  sprites: CustomSpriteCatalogEntry[];
  nextCursor: string | null;
}

export interface CustomSpriteCatalogListOptions {
  query?: string | null;
  kind?: CustomSpriteKind | null;
  cursor?: string | null;
  limit?: number;
}

export interface CustomSpriteCatalogSaveRequest {
  definition: CustomSpriteDefinition;
  expectedRevision?: number | null;
  remixedFromSpriteId?: string | null;
}

export interface CustomSpriteCatalogSaveResponse {
  sprite: CustomSpriteCatalogEntry;
}

export interface CustomSpriteCatalogDeleteResponse {
  deleted: true;
}

export interface CustomSpriteCatalogModerationRequest {
  status: Extract<CustomSpriteCatalogStatus, 'active' | 'blocked'>;
}
