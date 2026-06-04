import Phaser from 'phaser';
import {
  getCustomSpriteCategory,
  getCustomSpritePixelBounds,
  getCustomSpriteKindLabel,
  normalizeCustomSpriteDefinitions,
  parseCustomSpriteObjectId,
  type CustomSpriteDefinition,
} from './model';
import type { GameObjectConfig, PlacedObject } from '../config';
import type { RoomSnapshot } from '../persistence/roomModel';

export const CUSTOM_SPRITES_CHANGED_EVENT = 'custom-sprites-changed';

const STORAGE_KEY = 'wamp.customSprites.v1';
const spriteById = new Map<string, CustomSpriteDefinition>();
const dataUrlById = new Map<string, string>();
const localSpriteIds = new Set<string>();

interface RegisterCustomSpriteOptions {
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

  const sprites = Array.from(spriteById.values())
    .filter((sprite) => sprite.status !== 'blocked' && localSpriteIds.has(sprite.id))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sprites));
}

export function loadCustomSpritesFromStorage(): void {
  if (!hasBrowserStorage()) {
    return;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return;
  }

  try {
    const sprites = normalizeCustomSpriteDefinitions(JSON.parse(raw));
    for (const sprite of sprites) {
      spriteById.set(sprite.id, sprite);
      localSpriteIds.add(sprite.id);
    }
  } catch {
    // Bad local art cache should not block the editor boot.
  }
}

export function registerCustomSprite(sprite: CustomSpriteDefinition, options: RegisterCustomSpriteOptions = {}): void {
  spriteById.set(sprite.id, sprite);
  dataUrlById.delete(sprite.id);
  if (options.persist !== false) {
    localSpriteIds.add(sprite.id);
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
  return listCustomSpriteDefinitions().filter((sprite) => localSpriteIds.has(sprite.id));
}

export function isLocalCustomSpriteId(id: string | null | undefined): boolean {
  return Boolean(id && localSpriteIds.has(id));
}

export function getCustomSpriteDataUrl(sprite: CustomSpriteDefinition): string {
  const cached = dataUrlById.get(sprite.id);
  if (cached) {
    return cached;
  }

  const canvas = createCustomSpriteCanvas(sprite);
  const dataUrl = canvas.toDataURL('image/png');
  dataUrlById.set(sprite.id, dataUrl);
  return dataUrl;
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
