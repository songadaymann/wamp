import type Phaser from 'phaser';
import { assetUrl } from './assetUrl';

const boundScenes = new WeakSet<Phaser.Scene>();

/** Phaser's public addfile event covers images, sheets and both atlas files. */
export function installSceneAssetVersions(scene: Phaser.Scene): void {
  if (boundScenes.has(scene)) return;
  const versionFile = (_key: string, _type: string, _loader: Phaser.Loader.LoaderPlugin, file: Phaser.Loader.File) => {
    if (typeof file.url === 'string') file.url = assetUrl(file.url);
  };
  const cleanup = () => {
    scene.load.off('addfile', versionFile);
    scene.events.off('shutdown', cleanup);
    scene.events.off('destroy', cleanup);
    boundScenes.delete(scene);
  };
  scene.load.on('addfile', versionFile);
  scene.events.once('shutdown', cleanup);
  scene.events.once('destroy', cleanup);
  boundScenes.add(scene);
}
