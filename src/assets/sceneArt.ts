import { installSceneAssetVersions } from './sceneAssetVersions';
import type Phaser from 'phaser';
import { GAME_OBJECTS, getBackgroundGroup, getObjectById, getObjectDefaultFrame, type GameObjectConfig } from '../config';
import treeAtlases from './treeAtlasManifest.json';

export const BOOT_GAME_OBJECTS = GAME_OBJECTS.filter(object => !isLazySceneObject(object));
const loaderPumps = new WeakMap<Phaser.Scene, { count: number; pump: () => void }>();
const pendingByTextures = new WeakMap<object, Map<string, Promise<void>>>();

type ArtAsset = { key: string; texturePath: string; atlasPath?: string; object?: GameObjectConfig };

export function isLazySceneObject(object: GameObjectConfig): boolean {
  return object.category === 'decoration' && object.frameCount === 1 && object.fps === 0;
}

export function getSceneObjectTexture(object: GameObjectConfig): { key: string; frame: string | number } {
  const atlas = getTreeAtlas(object.id);
  return atlas ? { key: atlas.key, frame: object.id } : { key: object.id, frame: getObjectDefaultFrame(object) };
}

export function isBackgroundGroupLoaded(scene: Phaser.Scene, id: string): boolean {
  return (getBackgroundGroup(id)?.layers ?? []).every(layer => scene.textures.exists(layer.key));
}

export async function ensureBackgroundGroupLoaded(scene: Phaser.Scene, id: string): Promise<void> {
  await Promise.all((getBackgroundGroup(id)?.layers ?? []).map(layer => ensureAsset(scene, { key: layer.key, texturePath: layer.path })));
}

export async function ensureSceneObjectTexturesLoaded(scene: Phaser.Scene, objectIds: readonly string[]): Promise<void> {
  const assets = new Map<string, ArtAsset>();
  for (const id of objectIds) {
    const object = getObjectById(id);
    if (!object || !isLazySceneObject(object)) continue;
    const atlas = getTreeAtlas(id);
    const asset: ArtAsset = atlas ?? { key: id, texturePath: object.path, object };
    assets.set(asset.key, asset);
  }
  await Promise.all(Array.from(assets.values(), asset => ensureAsset(scene, asset)));
}

/** Residency is part of a preview's cache key so a placeholder cannot stay cached. */
export function getRoomArtResidency(scene: Phaser.Scene, room: { background: string; placedObjects: readonly { id: string }[] }): string {
  const background = getBackgroundGroup(room.background)?.layers.map(layer => Number(scene.textures.exists(layer.key))).join('') ?? '';
  const objects = (room.placedObjects ?? []).map(placed => {
    const config = getObjectById(placed.id);
    return config && isLazySceneObject(config) ? `${placed.id}:${Number(scene.textures.exists(getSceneObjectTexture(config).key))}` : '';
  }).filter(Boolean).join(',');
  return `${background}|${objects}`;
}

export function createSceneObjectSprite(scene: Phaser.Scene, x: number, y: number, object: GameObjectConfig): Phaser.GameObjects.Sprite {
  const texture = getSceneObjectTexture(object);
  const lazy = isLazySceneObject(object);
  const ready = !lazy || scene.textures.exists(texture.key);
  const sprite = scene.add.sprite(x, y, ready ? texture.key : '__DEFAULT', ready ? texture.frame : undefined);
  if (!ready) {
    sprite.setAlpha(0);
    void ensureSceneObjectTexturesLoaded(scene, [object.id]).then(() => {
      if (!sprite.scene) return;
      sprite.setTexture(texture.key, texture.frame);
      sprite.setAlpha(1);
    }).catch(error => console.warn('Failed to load decoration art.', object.id, error));
  }
  return sprite;
}

function getTreeAtlas(id: string): ArtAsset | undefined {
  const family = /^tree_pack_(.+)_\d{2}$/.exec(id)?.[1];
  return family ? treeAtlases[family as keyof typeof treeAtlases] : undefined;
}

function ensureAsset(scene: Phaser.Scene, asset: ArtAsset): Promise<void> {
  if (scene.textures.exists(asset.key)) return Promise.resolve();
  // Phaser loader states 4/5 are shutdown/destroyed; a new request cannot start there.
  if (scene.load.state >= 4) return Promise.reject(new Error(`Art loader is stopped for ${asset.key}.`));
  let pending = pendingByTextures.get(scene.textures);
  if (!pending) { pending = new Map(); pendingByTextures.set(scene.textures, pending); }
  const existing = pending.get(asset.key);
  if (existing) return existing;
  installSceneAssetVersions(scene);
  const request = new Promise<void>((resolve, reject) => {
    const loader = scene.load;
    const releasePump = retainLoaderPump(scene);
    const cleanup = () => {
      releasePump();
      loader.off('complete', complete);
      loader.off('loaderror', fail);
      scene.events.off('shutdown', cancel);
      scene.events.off('destroy', cancel);
    };
    const complete = () => {
      cleanup();
      if (scene.textures.exists(asset.key)) resolve();
      else reject(new Error(`Art texture ${asset.key} was not registered.`));
    };
    const fail = (file: { key: string }) => {
      if (file.key !== asset.key) return;
      cleanup(); reject(new Error(`Failed to load art texture ${asset.key}.`));
    };
    const cancel = () => { cleanup(); reject(new Error(`Art load cancelled for ${asset.key}.`)); };
    loader.once('complete', complete);
    loader.on('loaderror', fail);
    scene.events.once('shutdown', cancel);
    scene.events.once('destroy', cancel);
    if (asset.atlasPath) loader.atlas(asset.key, asset.texturePath, asset.atlasPath);
    else if (asset.object) loader.spritesheet(asset.key, asset.texturePath, { frameWidth: asset.object.frameWidth, frameHeight: asset.object.frameHeight });
    else loader.image(asset.key, asset.texturePath);
    if (!loader.isLoading()) loader.start();
  });
  pending.set(asset.key, request);
  // Remove failed requests too: selecting the theme/object again can retry.
  void request.finally(() => pending.delete(asset.key)).catch(() => {});
  return request;
}

// Textures are shared across scenes. A room can request art just before Browse sleeps;
// keep its queue progressing so the editor waiting on that same request cannot deadlock.
function retainLoaderPump(scene: Phaser.Scene): () => void {
  let entry = loaderPumps.get(scene);
  if (!entry) {
    entry = { count: 0, pump: () => {
      if (!scene.scene.isActive() && scene.load.isLoading()) scene.load.update();
    } };
    loaderPumps.set(scene, entry);
    scene.game.events.on('step', entry.pump);
  }
  entry.count += 1;
  const retained = entry;
  return () => {
    retained.count -= 1;
    if (retained.count === 0) {
      scene.game.events.off('step', retained.pump);
      loaderPumps.delete(scene);
    }
  };
}
