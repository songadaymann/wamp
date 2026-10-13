import type Phaser from 'phaser';
import type { RoomSnapshot } from '../persistence/roomModel';
import { getObjectById } from '../config';
import { ensureBackgroundGroupLoaded, ensureSceneObjectTexturesLoaded, getSceneObjectTexture, isBackgroundGroupLoaded, isLazySceneObject } from './sceneArt';

export function isRoomArtLoaded(scene: Phaser.Scene, room: RoomSnapshot, includeObjects = true): boolean {
  return isBackgroundGroupLoaded(scene, room.background) && (!includeObjects || (room.placedObjects ?? []).every(placed => {
    const config = getObjectById(placed.id);
    return !config || !isLazySceneObject(config) || scene.textures.exists(getSceneObjectTexture(config).key);
  }));
}

export async function ensureRoomArtLoaded(scene: Phaser.Scene, room: RoomSnapshot, includeObjects = true): Promise<void> {
  await Promise.all([
    ensureBackgroundGroupLoaded(scene, room.background),
    ensureSceneObjectTexturesLoaded(scene, includeObjects ? (room.placedObjects ?? []).map(object => object.id) : []),
  ]);
}

/** Preview draws can skip absent art; refresh only after it is resident and still relevant. */
export class RoomPreviewArtLoader {
  private generation = 0;
  private pending = new Set<string>();
  private failed = new Set<string>();

  constructor(private readonly scene: Phaser.Scene, private readonly redraw: () => void) {}

  reset(): void {
    this.generation += 1;
    this.pending.clear(); this.failed.clear();
  }

  ensure(room: RoomSnapshot, includeObjects: boolean): void {
    if (isRoomArtLoaded(this.scene, room, includeObjects)) return;
    const key = `${room.background}|${includeObjects ? (room.placedObjects ?? []).map(object => object.id).join(',') : ''}`;
    if (this.pending.has(key) || this.failed.has(key)) return;
    this.pending.add(key);
    const generation = this.generation;
    void ensureRoomArtLoaded(this.scene, room, includeObjects).then(() => {
      if (generation !== this.generation) return;
      this.pending.delete(key); this.redraw();
    }).catch(error => {
      if (generation !== this.generation) return;
      this.pending.delete(key); this.failed.add(key);
      console.warn('Failed to load preview art.', room.id, error);
    });
  }
}
