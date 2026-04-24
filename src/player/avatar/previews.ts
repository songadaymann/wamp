import type { PlayerAvatarId } from './model';
import { loadCryptopunkHeadPreviewUrl } from '../../avatars/headPreview';
import { parseCryptopunkAvatarId } from '../../avatars/model';
import { DEFAULT_PLAYER_AVATAR_ID, getRegisteredPlayerAvatarPack } from './registry';

interface AtlasFrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AtlasFrameEntry {
  frame: AtlasFrameRect;
}

interface TextureAtlasJson {
  frames: Record<string, AtlasFrameEntry>;
}

const avatarPreviewCache = new Map<PlayerAvatarId, Promise<string | null>>();

export function createPlayerAvatarPreviewDataUrl(
  avatarId: PlayerAvatarId | null | undefined,
): Promise<string | null> {
  const requestedAvatarId = avatarId ?? '';
  const punkId = parseCryptopunkAvatarId(requestedAvatarId);
  const resolvedAvatarId = getRegisteredPlayerAvatarPack(requestedAvatarId) || punkId !== null
    ? requestedAvatarId as PlayerAvatarId
    : DEFAULT_PLAYER_AVATAR_ID;
  const cached = avatarPreviewCache.get(resolvedAvatarId);
  if (cached) {
    return cached;
  }

  const request = punkId !== null
    ? loadCryptopunkAvatarPreviewDataUrl(punkId, resolvedAvatarId)
    : loadPlayerAvatarPreviewDataUrl(resolvedAvatarId);
  avatarPreviewCache.set(resolvedAvatarId, request);
  return request;
}

async function loadCryptopunkAvatarPreviewDataUrl(
  punkId: number,
  avatarId: PlayerAvatarId,
): Promise<string | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  try {
    return await loadCryptopunkHeadPreviewUrl(punkId);
  } catch (error) {
    console.warn('Failed to render CryptoPunk avatar preview.', avatarId, error);
    return null;
  }
}

async function loadPlayerAvatarPreviewDataUrl(avatarId: PlayerAvatarId): Promise<string | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  const pack = getRegisteredPlayerAvatarPack(avatarId);
  const atlasAsset = pack?.atlasAssets.find((asset) => asset.key === pack.idleTextureKey);
  if (!pack || !atlasAsset) {
    return null;
  }

  try {
    const atlas = await fetchAtlas(atlasAsset.atlasPath);
    const frame = atlas.frames[pack.idleFrame]?.frame;
    if (!frame) {
      return null;
    }

    const image = await loadImage(atlasAsset.texturePath);
    const canvas = document.createElement('canvas');
    canvas.width = frame.w;
    canvas.height = frame.h;
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }

    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      image,
      frame.x,
      frame.y,
      frame.w,
      frame.h,
      0,
      0,
      frame.w,
      frame.h,
    );
    return canvas.toDataURL('image/png');
  } catch (error) {
    console.warn('Failed to render player avatar preview.', avatarId, error);
    return null;
  }
}

async function fetchAtlas(atlasPath: string): Promise<TextureAtlasJson> {
  const response = await fetch(toRootRelativeAssetPath(atlasPath));
  if (!response.ok) {
    throw new Error(`Avatar atlas request failed with ${response.status}.`);
  }
  return await response.json() as TextureAtlasJson;
}

function loadImage(texturePath: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Avatar texture failed to load: ${texturePath}`));
    image.decoding = 'async';
    image.src = toRootRelativeAssetPath(texturePath);
  });
}

function toRootRelativeAssetPath(path: string): string {
  if (path.startsWith('/') || /^https?:\/\//i.test(path)) {
    return path;
  }
  return `/${path}`;
}
