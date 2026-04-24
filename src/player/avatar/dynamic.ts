import Phaser from 'phaser';
import { createAvatarRepository } from '../../avatars/repository';
import { parseCryptopunkAvatarId } from '../../avatars/model';
import type {
  PlayerAvatarManifest,
  PlayerAvatarId,
  ResolvedPlayerAvatarPack,
} from './model';
import {
  DEFAULT_PLAYER_AVATAR_ID,
  createDefaultCompatibleAvatarPack,
  getRegisteredPlayerAvatarPack,
  registerPlayerAvatarPack,
} from './registry';

const avatarRepository = createAvatarRepository();
const registrationPromisesByAvatarId = new Map<string, Promise<ResolvedPlayerAvatarPack | null>>();
const sceneLoadQueues = new WeakMap<Phaser.Scene, Promise<unknown>>();
const sceneLoadPromises = new WeakMap<
  Phaser.Scene,
  Map<string, Promise<ResolvedPlayerAvatarPack>>
>();
const sceneLoadedAvatarIds = new WeakMap<Phaser.Scene, Set<string>>();

export function isDynamicPlayerAvatarId(avatarId: string): boolean {
  return parseCryptopunkAvatarId(avatarId) !== null;
}

export function isSceneAvatarPackLoaded(
  scene: Phaser.Scene,
  avatarId: PlayerAvatarId
): boolean {
  return sceneLoadedAvatarIds.get(scene)?.has(avatarId) ?? false;
}

export async function ensurePlayerAvatarPackRegistered(
  avatarId: PlayerAvatarId
): Promise<ResolvedPlayerAvatarPack | null> {
  const existing = getRegisteredPlayerAvatarPack(avatarId);
  if (existing) {
    return existing;
  }

  const punkId = parseCryptopunkAvatarId(avatarId);
  if (punkId === null) {
    return null;
  }

  const pending = registrationPromisesByAvatarId.get(avatarId);
  if (pending) {
    return pending;
  }

  const request = (async (): Promise<ResolvedPlayerAvatarPack | null> => {
    const status = await avatarRepository.loadCryptopunkStatus(punkId);
    if (status.pack.status !== 'ready') {
      return null;
    }

    let assetBaseUrl = status.pack.assetBaseUrl?.trim();
    if (!assetBaseUrl && status.pack.manifestUrl) {
      const manifest = await loadPlayerAvatarManifest(status.pack.manifestUrl);
      assetBaseUrl = manifest.assetBaseUrl?.trim();
    }
    if (!assetBaseUrl) {
      throw new Error(`Avatar manifest for ${avatarId} is missing assetBaseUrl.`);
    }

    return registerPlayerAvatarPack(
      createDefaultCompatibleAvatarPack({
        id: avatarId,
        label: `CryptoPunk ${punkId}`,
        kind: 'cryptopunk',
        assetRoot: assetBaseUrl.replace(/\/+$/, ''),
        atlasKeyRoot: `player-${avatarId}`,
        source: status.pack.manifestUrl ?? undefined,
      })
    );
  })();

  registrationPromisesByAvatarId.set(avatarId, request);

  try {
    const pack = await request;
    if (!pack) {
      registrationPromisesByAvatarId.delete(avatarId);
    }
    return pack;
  } catch (error) {
    registrationPromisesByAvatarId.delete(avatarId);
    throw error;
  }
}

export async function ensureSceneAvatarPackLoaded(
  scene: Phaser.Scene,
  avatarId: PlayerAvatarId
): Promise<ResolvedPlayerAvatarPack> {
  const registeredPack = await ensurePlayerAvatarPackRegistered(avatarId);
  const fallbackPack = getRegisteredPlayerAvatarPack(DEFAULT_PLAYER_AVATAR_ID);
  if (!fallbackPack) {
    throw new Error('Default player avatar pack is not registered.');
  }

  const pack = registeredPack ?? fallbackPack;
  if (isSceneAvatarPackLoaded(scene, pack.id)) {
    return pack;
  }

  const scenePending = sceneLoadPromises.get(scene) ?? new Map<string, Promise<ResolvedPlayerAvatarPack>>();
  sceneLoadPromises.set(scene, scenePending);
  const existing = scenePending.get(pack.id);
  if (existing) {
    return existing;
  }

  const request = enqueueSceneLoad(scene, async () => {
    await ensureSceneAtlasAssetsLoaded(scene, pack);
    ensureSceneAnimations(scene, pack);
    markSceneAvatarPackLoaded(scene, pack.id);
    return pack;
  });
  scenePending.set(pack.id, request);

  try {
    return await request;
  } finally {
    scenePending.delete(pack.id);
  }
}

function markSceneAvatarPackLoaded(
  scene: Phaser.Scene,
  avatarId: PlayerAvatarId
): void {
  const loadedAvatarIds = sceneLoadedAvatarIds.get(scene) ?? new Set<string>();
  loadedAvatarIds.add(avatarId);
  sceneLoadedAvatarIds.set(scene, loadedAvatarIds);
}

function enqueueSceneLoad<T>(
  scene: Phaser.Scene,
  task: () => Promise<T>
): Promise<T> {
  const previous = sceneLoadQueues.get(scene) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(task);
  sceneLoadQueues.set(
    scene,
    next.then(
      () => undefined,
      () => undefined
    )
  );
  return next;
}

async function ensureSceneAtlasAssetsLoaded(
  scene: Phaser.Scene,
  pack: ResolvedPlayerAvatarPack
): Promise<void> {
  const missingAssets = pack.atlasAssets.filter((atlas) => !scene.textures.exists(atlas.key));
  if (missingAssets.length === 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const loader = scene.load;
    const requestedKeys = new Set(missingAssets.map((asset) => asset.key));

    const handleComplete = () => {
      cleanup();
      resolve();
    };
    const handleLoadError = (file: Phaser.Loader.File) => {
      if (!requestedKeys.has(file.key)) {
        return;
      }

      cleanup();
      reject(new Error(`Failed to load avatar asset ${file.key} from ${file.src}.`));
    };
    const cleanup = () => {
      loader.off(Phaser.Loader.Events.COMPLETE, handleComplete);
      loader.off(Phaser.Loader.Events.FILE_LOAD_ERROR, handleLoadError);
    };

    loader.once(Phaser.Loader.Events.COMPLETE, handleComplete);
    loader.on(Phaser.Loader.Events.FILE_LOAD_ERROR, handleLoadError);

    for (const atlas of missingAssets) {
      loader.atlas(atlas.key, atlas.texturePath, atlas.atlasPath);
    }

    loader.start();
  });
}

function ensureSceneAnimations(
  scene: Phaser.Scene,
  pack: ResolvedPlayerAvatarPack
): void {
  for (const animation of pack.animations) {
    if (scene.anims.exists(animation.key)) {
      continue;
    }

    scene.anims.create({
      key: animation.key,
      frames: animation.frameNames.map((frameName) => ({
        key: animation.atlasKey,
        frame: frameName,
      })),
      frameRate: animation.frameRate,
      repeat: animation.repeat,
    });
  }
}

async function loadPlayerAvatarManifest(manifestUrl: string): Promise<PlayerAvatarManifest> {
  const response = await fetch(manifestUrl, {
    credentials: 'omit',
  });
  if (!response.ok) {
    throw new Error(`Failed to load avatar manifest ${manifestUrl} (${response.status}).`);
  }

  return (await response.json()) as PlayerAvatarManifest;
}
