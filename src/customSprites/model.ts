export const CUSTOM_SPRITE_OBJECT_PREFIX = 'custom_sprite:';
export const CUSTOM_SPRITE_MAX_LIBRARY_SIZE = 64;

export type CustomSpriteKind = 'decoration' | 'collectible' | 'solid' | 'pushable';
export type CustomSpriteStatus = 'active' | 'blocked';
export type CustomSpriteSize = 16 | 32;

export interface CustomSpriteDefinition {
  id: string;
  name: string;
  size: CustomSpriteSize;
  kind: CustomSpriteKind;
  pixels: Array<string | null>;
  status: CustomSpriteStatus;
  createdAt: string;
  updatedAt: string;
}

export function buildCustomSpriteObjectId(id: string): string {
  return `${CUSTOM_SPRITE_OBJECT_PREFIX}${id}`;
}

export function parseCustomSpriteObjectId(objectId: string | null | undefined): string | null {
  if (!objectId?.startsWith(CUSTOM_SPRITE_OBJECT_PREFIX)) {
    return null;
  }

  const id = objectId.slice(CUSTOM_SPRITE_OBJECT_PREFIX.length).trim();
  return id || null;
}

export function isCustomSpriteObjectId(objectId: string | null | undefined): boolean {
  return parseCustomSpriteObjectId(objectId) !== null;
}

export function getCustomSpriteKindLabel(kind: CustomSpriteKind): string {
  switch (kind) {
    case 'collectible':
      return 'Collectible';
    case 'pushable':
      return 'Pushable Block';
    case 'solid':
      return 'Solid Block';
    case 'decoration':
    default:
      return 'Decoration';
  }
}

export function getCustomSpriteCategory(kind: CustomSpriteKind): 'decoration' | 'collectible' | 'platform' {
  switch (kind) {
    case 'collectible':
      return 'collectible';
    case 'pushable':
    case 'solid':
      return 'platform';
    case 'decoration':
    default:
      return 'decoration';
  }
}

export function normalizeCustomSpriteKind(value: unknown): CustomSpriteKind {
  return value === 'collectible' || value === 'solid' || value === 'pushable' || value === 'decoration'
    ? value
    : 'decoration';
}

export function normalizeCustomSpriteSize(value: unknown): CustomSpriteSize {
  return value === 32 ? 32 : 16;
}

function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return null;
  }

  return trimmed.toLowerCase();
}

export function normalizeCustomSpriteDefinition(value: unknown): CustomSpriteDefinition | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const input = value as Partial<CustomSpriteDefinition>;
  if (typeof input.id !== 'string' || !input.id.trim()) {
    return null;
  }

  const size = normalizeCustomSpriteSize(input.size);
  const pixelCount = size * size;
  const sourcePixels = Array.isArray(input.pixels) ? input.pixels : [];
  const pixels = Array.from({ length: pixelCount }, (_, index) => normalizeHexColor(sourcePixels[index]));
  const now = new Date().toISOString();

  return {
    id: input.id.trim().slice(0, 96),
    name: typeof input.name === 'string' && input.name.trim()
      ? input.name.trim().slice(0, 32)
      : 'My Sprite',
    size,
    kind: normalizeCustomSpriteKind(input.kind),
    pixels,
    status: input.status === 'blocked' ? 'blocked' : 'active',
    createdAt: typeof input.createdAt === 'string' && input.createdAt ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === 'string' && input.updatedAt ? input.updatedAt : now,
  };
}

export function normalizeCustomSpriteDefinitions(values: unknown): CustomSpriteDefinition[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const sprites: CustomSpriteDefinition[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const sprite = normalizeCustomSpriteDefinition(value);
    if (!sprite || seen.has(sprite.id)) {
      continue;
    }
    seen.add(sprite.id);
    sprites.push(sprite);
  }

  return sprites.slice(0, CUSTOM_SPRITE_MAX_LIBRARY_SIZE);
}
