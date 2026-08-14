import Phaser from 'phaser';
import {
  getCustomSpriteCategory,
  getCustomSpritePixelBounds,
  getCustomSpriteKindLabel,
  normalizeCustomSpriteDefinition,
  normalizeCustomSpriteDefinitions,
  parseCustomSpriteObjectId,
  type CustomSpriteDefinition,
} from './model';
import type { GameObjectConfig, PlacedObject } from '../config';
import type { RoomSnapshot } from '../persistence/roomModel';
import {
  CUSTOM_SPRITE_ACCOUNT_LIMIT,
  type CustomSpriteCatalogEntry,
  type CustomSpriteCatalogRemixSource,
} from './catalog';

export const CUSTOM_SPRITES_CHANGED_EVENT = 'custom-sprites-changed';

const LEGACY_STORAGE_KEY = 'wamp.customSprites.v1';
const STORAGE_KEY = 'wamp.customSprites.v2';
const DATA_URL_CACHE_LIMIT = 256;
const spriteById = new Map<string, CustomSpriteDefinition>();
const dataUrlById = new Map<string, string>();
const localSpriteIds = new Set<string>();
const localMetadataById = new Map<string, LocalCustomSpriteMetadata>();
const catalogMetadataById = new Map<string, CatalogCustomSpriteMetadata>();
let currentOwnerUserId: string | null = null;

export type CustomSpriteSyncStatus = 'local' | 'pending' | 'synced' | 'error';

export interface LocalCustomSpriteMetadata {
  ownerUserId: string | null;
  revision: number | null;
  remixedFromSpriteId: string | null;
  syncStatus: CustomSpriteSyncStatus;
  syncError: string | null;
  retryable: boolean;
}

export interface CatalogCustomSpriteMetadata {
  creatorUserId: string | null;
  creatorDisplayName: string;
  creatorUsername: string | null;
  legacy: boolean;
  revision: number;
  remixedFrom: CustomSpriteCatalogRemixSource | null;
}

interface StoredLocalCustomSpriteRecord {
  definition: CustomSpriteDefinition;
  metadata: LocalCustomSpriteMetadata;
}

interface RegisterCustomSpriteOptions {
  persist?: boolean;
  notify?: boolean;
  remixedFromSpriteId?: string | null;
}

interface RegistryMutationOptions {
  persist?: boolean;
  notify?: boolean;
}

function hasBrowserStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function dispatchChanged(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(CUSTOM_SPRITES_CHANGED_EVENT));
}

function persistLocalLibrary(): void {
  if (!hasBrowserStorage()) {
    return;
  }

  const records = Array.from(localSpriteIds)
    .map((id): StoredLocalCustomSpriteRecord | null => {
      const definition = spriteById.get(id);
      const metadata = localMetadataById.get(id);
      return definition && metadata ? { definition, metadata } : null;
    })
    .filter((record): record is StoredLocalCustomSpriteRecord => Boolean(record))
    .filter((record) => record.definition.status !== 'blocked')
    .sort((left, right) => Date.parse(right.definition.updatedAt) - Date.parse(left.definition.updatedAt))
    .slice(0, CUSTOM_SPRITE_ACCOUNT_LIMIT);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    window.localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify(records.map((record) => record.definition)),
    );
  } catch {
    // Keep the in-memory library usable when browser storage is unavailable or full.
  }
}

export function loadCustomSpritesFromStorage(): void {
  if (!hasBrowserStorage()) {
    return;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw && !legacyRaw) {
    return;
  }

  try {
    const records = raw ? normalizeStoredRecords(JSON.parse(raw)) : [];
    if (records.length > 0) {
      for (const record of records) {
        spriteById.set(record.definition.id, record.definition);
        localSpriteIds.add(record.definition.id);
        localMetadataById.set(record.definition.id, record.metadata);
      }
      return;
    }

    const legacyValues = JSON.parse(legacyRaw ?? '[]');
    const sprites = Array.isArray(legacyValues)
      ? legacyValues
          .map(normalizeCustomSpriteDefinition)
          .filter((sprite): sprite is CustomSpriteDefinition => Boolean(sprite))
      : [];
    const seen = new Set<string>();
    for (const sprite of sprites) {
      if (seen.has(sprite.id) || seen.size >= CUSTOM_SPRITE_ACCOUNT_LIMIT) continue;
      seen.add(sprite.id);
      spriteById.set(sprite.id, sprite);
      localSpriteIds.add(sprite.id);
      localMetadataById.set(sprite.id, createLocalMetadata());
    }
    persistLocalLibrary();
  } catch {
    // Bad local art cache should not block the editor boot.
  }
}

export function registerCustomSprite(sprite: CustomSpriteDefinition, options: RegisterCustomSpriteOptions = {}): void {
  spriteById.set(sprite.id, sprite);
  dataUrlById.delete(sprite.id);
  if (options.persist !== false) {
    localSpriteIds.add(sprite.id);
    const existingMetadata = localMetadataById.get(sprite.id);
    localMetadataById.set(sprite.id, {
      ...existingMetadata ?? createLocalMetadata(),
      ownerUserId: existingMetadata?.ownerUserId ?? currentOwnerUserId,
      remixedFromSpriteId:
        options.remixedFromSpriteId
        ?? existingMetadata?.remixedFromSpriteId
        ?? null,
      syncStatus: currentOwnerUserId ? 'pending' : 'local',
      syncError: null,
      retryable: true,
    });
    persistLocalLibrary();
  }
  if (options.notify !== false) {
    dispatchChanged();
  }
}

export function registerCustomSprites(
  sprites: readonly CustomSpriteDefinition[] | null | undefined,
  options: RegisterCustomSpriteOptions = {},
): void {
  if (!sprites || sprites.length === 0) {
    return;
  }

  let changed = false;
  for (const sprite of sprites) {
    if (!sprite?.id) {
      continue;
    }
    spriteById.set(sprite.id, sprite);
    if (options.persist !== false) {
      localSpriteIds.add(sprite.id);
      const existingMetadata = localMetadataById.get(sprite.id);
      localMetadataById.set(sprite.id, {
        ...existingMetadata ?? createLocalMetadata(),
        ownerUserId: existingMetadata?.ownerUserId ?? currentOwnerUserId,
        syncStatus: currentOwnerUserId ? 'pending' : 'local',
        syncError: null,
        retryable: true,
      });
    }
    dataUrlById.delete(sprite.id);
    changed = true;
  }

  if (!changed) {
    return;
  }

  if (options.persist !== false) {
    persistLocalLibrary();
  }
  if (options.notify !== false) {
    dispatchChanged();
  }
}

export function registerCustomSpritesFromSnapshot(room: Pick<RoomSnapshot, 'customSprites'> | null | undefined): void {
  registerCustomSprites(room?.customSprites ?? [], { persist: false, notify: false });
}

export function getCustomSpriteDefinition(id: string | null | undefined): CustomSpriteDefinition | null {
  if (!id) {
    return null;
  }

  return spriteById.get(id) ?? null;
}

export function getCustomSpriteDefinitionByObjectId(objectId: string | null | undefined): CustomSpriteDefinition | null {
  return getCustomSpriteDefinition(parseCustomSpriteObjectId(objectId));
}

export function listCustomSpriteDefinitions(): CustomSpriteDefinition[] {
  return Array.from(spriteById.values())
    .filter((sprite) => sprite.status !== 'blocked')
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function listLocalCustomSpriteDefinitions(): CustomSpriteDefinition[] {
  return listCustomSpriteDefinitions().filter((sprite) => isLocalCustomSpriteId(sprite.id));
}

export function listLocalCustomSpriteRecords(): Array<{
  sprite: CustomSpriteDefinition;
  metadata: LocalCustomSpriteMetadata;
}> {
  return listLocalCustomSpriteDefinitions().map((sprite) => ({
    sprite,
    metadata: getLocalCustomSpriteMetadata(sprite.id) ?? createLocalMetadata(),
  }));
}

export function getCustomSpriteRegistryDebugState(): Record<string, unknown> {
  let approximateDataUrlBytes = 0;
  for (const dataUrl of dataUrlById.values()) {
    approximateDataUrlBytes += dataUrl.length * 2;
  }

  return {
    definitionCount: spriteById.size,
    localDefinitionCount: localSpriteIds.size,
    currentOwnerUserId,
    catalogMetadataCount: catalogMetadataById.size,
    dataUrlCacheCount: dataUrlById.size,
    approximateDataUrlBytes,
  };
}

export function isLocalCustomSpriteId(id: string | null | undefined): boolean {
  if (!id || !localSpriteIds.has(id)) return false;
  const metadata = localMetadataById.get(id);
  return Boolean(metadata && (
    metadata.ownerUserId === null
    || metadata.ownerUserId === currentOwnerUserId
  ));
}

export function removeLocalCustomSprite(id: string | null | undefined): boolean {
  if (!id || !isLocalCustomSpriteId(id) || !localSpriteIds.delete(id)) {
    return false;
  }

  spriteById.delete(id);
  dataUrlById.delete(id);
  localMetadataById.delete(id);
  catalogMetadataById.delete(id);
  persistLocalLibrary();
  dispatchChanged();
  return true;
}

export function getCustomSpriteDataUrl(sprite: CustomSpriteDefinition): string {
  const cached = dataUrlById.get(sprite.id);
  if (cached) {
    return cached;
  }

  const canvas = createCustomSpriteCanvas(sprite);
  const dataUrl = canvas.toDataURL('image/png');
  dataUrlById.set(sprite.id, dataUrl);
  while (dataUrlById.size > DATA_URL_CACHE_LIMIT) {
    const oldestId = dataUrlById.keys().next().value as string | undefined;
    if (!oldestId) break;
    dataUrlById.delete(oldestId);
  }
  return dataUrl;
}

export function configureCustomSpriteOwner(userId: string | null | undefined): void {
  const normalized = typeof userId === 'string' && userId.trim() ? userId.trim() : null;
  if (currentOwnerUserId === normalized) return;
  currentOwnerUserId = normalized;
  dispatchChanged();
}

export function getCurrentCustomSpriteOwnerUserId(): string | null {
  return currentOwnerUserId;
}

export function getLocalCustomSpriteMetadata(id: string): LocalCustomSpriteMetadata | null {
  const metadata = localMetadataById.get(id);
  return metadata ? { ...metadata } : null;
}

export function updateLocalCustomSpriteMetadata(
  id: string,
  updates: Partial<LocalCustomSpriteMetadata>,
  options: RegistryMutationOptions = {},
): void {
  const existing = localMetadataById.get(id);
  if (!existing) return;
  localMetadataById.set(id, { ...existing, ...updates });
  if (options.persist !== false) persistLocalLibrary();
  if (options.notify !== false) dispatchChanged();
}

export function registerOwnedCatalogSprite(
  entry: CustomSpriteCatalogEntry,
  options: RegistryMutationOptions = {},
): void {
  spriteById.set(entry.sprite.id, entry.sprite);
  localSpriteIds.add(entry.sprite.id);
  dataUrlById.delete(entry.sprite.id);
  localMetadataById.set(entry.sprite.id, {
    ownerUserId: entry.creator.userId,
    revision: entry.revision,
    remixedFromSpriteId: entry.remixedFrom?.spriteId ?? null,
    syncStatus: 'synced',
    syncError: null,
    retryable: false,
  });
  setCatalogMetadata(entry);
  if (options.persist !== false) persistLocalLibrary();
  if (options.notify !== false) dispatchChanged();
}

export function commitCustomSpriteLibraryChanges(): void {
  persistLocalLibrary();
  dispatchChanged();
}

export function registerCommunityCatalogSprite(entry: CustomSpriteCatalogEntry): void {
  spriteById.set(entry.sprite.id, entry.sprite);
  dataUrlById.delete(entry.sprite.id);
  setCatalogMetadata(entry);
  dispatchChanged();
}

export function registerCommunityCatalogSprites(entries: readonly CustomSpriteCatalogEntry[]): void {
  if (entries.length === 0) return;
  for (const entry of entries) {
    spriteById.set(entry.sprite.id, entry.sprite);
    dataUrlById.delete(entry.sprite.id);
    setCatalogMetadata(entry);
  }
  dispatchChanged();
}

export function getCustomSpriteCatalogMetadata(id: string | null | undefined): CatalogCustomSpriteMetadata | null {
  if (!id) return null;
  const metadata = catalogMetadataById.get(id);
  return metadata ? {
    ...metadata,
    remixedFrom: metadata.remixedFrom ? { ...metadata.remixedFrom } : null,
  } : null;
}

function setCatalogMetadata(entry: CustomSpriteCatalogEntry): void {
  catalogMetadataById.set(entry.sprite.id, {
    creatorUserId: entry.creator.userId,
    creatorDisplayName: entry.creator.displayName,
    creatorUsername: entry.creator.username,
    legacy: entry.creator.legacy,
    revision: entry.revision,
    remixedFrom: entry.remixedFrom ? { ...entry.remixedFrom } : null,
  });
}

function createLocalMetadata(): LocalCustomSpriteMetadata {
  return {
    ownerUserId: null,
    revision: null,
    remixedFromSpriteId: null,
    syncStatus: 'local',
    syncError: null,
    retryable: true,
  };
}

function normalizeStoredRecords(value: unknown): StoredLocalCustomSpriteRecord[] {
  if (!Array.isArray(value)) return [];
  const records: StoredLocalCustomSpriteRecord[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const input = candidate as {
      definition?: unknown;
      metadata?: Partial<LocalCustomSpriteMetadata>;
    };
    const definition = normalizeCustomSpriteDefinitions([input.definition])[0];
    if (!definition || seen.has(definition.id)) continue;
    seen.add(definition.id);
    const metadata = input.metadata;
    records.push({
      definition,
      metadata: {
        ownerUserId: typeof metadata?.ownerUserId === 'string' && metadata.ownerUserId.trim()
          ? metadata.ownerUserId.trim()
          : null,
        revision: Number.isSafeInteger(metadata?.revision) && Number(metadata?.revision) > 0
          ? Number(metadata?.revision)
          : null,
        remixedFromSpriteId:
          typeof metadata?.remixedFromSpriteId === 'string' && metadata.remixedFromSpriteId.trim()
            ? metadata.remixedFromSpriteId.trim()
            : null,
        syncStatus:
          metadata?.syncStatus === 'pending'
          || metadata?.syncStatus === 'synced'
          || metadata?.syncStatus === 'error'
            ? metadata.syncStatus
            : 'local',
        syncError: typeof metadata?.syncError === 'string' ? metadata.syncError : null,
        retryable: metadata?.retryable !== false,
      },
    });
    if (records.length >= CUSTOM_SPRITE_ACCOUNT_LIMIT) break;
  }
  return records;
}

export function createCustomSpriteCanvas(sprite: CustomSpriteDefinition): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = sprite.size;
  canvas.height = sprite.size;
  const context = canvas.getContext('2d');
  if (!context) {
    return canvas;
  }

  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, sprite.size, sprite.size);
  for (let index = 0; index < sprite.pixels.length; index += 1) {
    const color = sprite.pixels[index];
    if (!color) {
      continue;
    }
    const x = index % sprite.size;
    const y = Math.floor(index / sprite.size);
    context.fillStyle = color;
    context.fillRect(x, y, 1, 1);
  }
  return canvas;
}

export function buildCustomSpriteObjectConfig(sprite: CustomSpriteDefinition): GameObjectConfig {
  const category = getCustomSpriteCategory(sprite.kind);
  const body = getCustomSpriteObjectBody(sprite);

  return {
    id: `custom_sprite:${sprite.id}`,
    name: sprite.name,
    category,
    path: getCustomSpriteDataUrl(sprite),
    frameWidth: sprite.size,
    frameHeight: sprite.size,
    frameCount: 1,
    fps: 0,
    bodyWidth: body.width,
    bodyHeight: body.height,
    bodyOffsetX: body.offsetX,
    bodyOffsetY: body.offsetY,
    behavior: 'static',
    interaction: sprite.kind === 'pushable' ? 'pushable' : undefined,
    customSpriteKind: sprite.kind,
    description: `${getCustomSpriteKindLabel(sprite.kind)} made in the pixel editor.`,
  };
}

function getCustomSpriteObjectBody(
  sprite: CustomSpriteDefinition,
): { width: number; height: number; offsetX: number; offsetY: number } {
  if (sprite.kind === 'decoration' || sprite.kind === 'sign') {
    return { width: 0, height: 0, offsetX: 0, offsetY: 0 };
  }

  if (sprite.kind === 'collectible') {
    const bodySize = Math.max(8, sprite.size - 4);
    const bodyOffset = Math.floor((sprite.size - bodySize) / 2);
    return { width: bodySize, height: bodySize, offsetX: bodyOffset, offsetY: bodyOffset };
  }

  if (sprite.kind === 'pushable') {
    const bounds = getCustomSpritePixelBounds(sprite.pixels, sprite.size);
    if (bounds) {
      return {
        width: bounds.width,
        height: bounds.height,
        offsetX: bounds.minX,
        offsetY: bounds.minY,
      };
    }
  }

  return { width: sprite.size, height: sprite.size, offsetX: 0, offsetY: 0 };
}

export function getCustomSpriteObjectConfig(objectId: string | null | undefined): GameObjectConfig | null {
  const sprite = getCustomSpriteDefinitionByObjectId(objectId);
  return sprite ? buildCustomSpriteObjectConfig(sprite) : null;
}

export function listCustomSpriteObjectConfigs(): GameObjectConfig[] {
  return listCustomSpriteDefinitions().map((sprite) => buildCustomSpriteObjectConfig(sprite));
}

export function getCustomSpriteDefinitionsForPlacedObjects(
  placedObjects: readonly Pick<PlacedObject, 'id'>[],
): CustomSpriteDefinition[] {
  const result: CustomSpriteDefinition[] = [];
  const seen = new Set<string>();
  for (const placed of placedObjects) {
    const id = parseCustomSpriteObjectId(placed.id);
    if (!id || seen.has(id)) {
      continue;
    }
    const sprite = getCustomSpriteDefinition(id);
    if (!sprite) {
      continue;
    }
    seen.add(id);
    result.push(sprite);
  }
  return result;
}

export function ensureCustomSpriteTexture(
  scene: Phaser.Scene,
  objectConfigOrId: Pick<GameObjectConfig, 'id'> | string | null | undefined,
): void {
  const objectId = typeof objectConfigOrId === 'string'
    ? objectConfigOrId
    : objectConfigOrId?.id;
  const sprite = getCustomSpriteDefinitionByObjectId(objectId);
  if (!sprite || scene.textures.exists(`custom_sprite:${sprite.id}`)) {
    return;
  }

  scene.textures.addCanvas(`custom_sprite:${sprite.id}`, createCustomSpriteCanvas(sprite));
}

export function refreshCustomSpriteTexture(
  scene: Phaser.Scene,
  objectConfigOrId: Pick<GameObjectConfig, 'id'> | string | null | undefined,
): void {
  const objectId = typeof objectConfigOrId === 'string'
    ? objectConfigOrId
    : objectConfigOrId?.id;
  const sprite = getCustomSpriteDefinitionByObjectId(objectId);
  if (!sprite) {
    return;
  }

  const textureKey = `custom_sprite:${sprite.id}`;
  const sourceCanvas = createCustomSpriteCanvas(sprite);
  if (!scene.textures.exists(textureKey)) {
    scene.textures.addCanvas(textureKey, sourceCanvas);
    return;
  }

  const texture = scene.textures.get(textureKey) as Phaser.Textures.CanvasTexture;
  if (
    typeof texture.setSize === 'function' &&
    texture.context instanceof CanvasRenderingContext2D
  ) {
    texture.setSize(sprite.size, sprite.size);
    texture.context.clearRect(0, 0, sprite.size, sprite.size);
    texture.context.drawImage(sourceCanvas, 0, 0);
    texture.refresh();
  }
}
