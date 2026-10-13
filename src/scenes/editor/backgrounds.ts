import { ensureRoomArtLoaded } from '../../assets/roomArt';
import Phaser from 'phaser';
import {
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  TILE_SIZE,
  type BackgroundLayer,
} from '../../config';
import { resolveRoomBackground } from '../../backgrounds/model';
import {
  createBuiltInBackgroundObject,
  createCustomBackgroundLayer,
  createCustomBackgroundObject,
  ensureCustomBackgroundTexture,
  getBuiltInBackgroundTileScale,
  syncBuiltInBackgroundObject,
  syncCustomBackgroundObject,
  type BuiltInBackgroundObject,
  type CustomBackgroundLayer,
  type CustomBackgroundObject,
} from '../../backgrounds/runtime';
import type { RoomCoordinates } from '../../persistence/roomRepository';
import type { WorldRepository } from '../../persistence/worldRepository';
import type { RoomSnapshot } from '../../persistence/roomModel';
import {
  RETRO_COLORS,
  createStarfieldTileSprite,
  getStarfieldLayerConfig,
  syncStarfieldTileSprite,
} from '../../visuals/starfield';
import { buildRoomSnapshotTexture, buildRoomTextureKey } from '../../visuals/roomSnapshotTexture';

interface ParallaxSprite {
  sprite: BuiltInBackgroundObject | CustomBackgroundObject;
  layer: BackgroundLayer | CustomBackgroundLayer;
}

interface EditorBackgroundHost {
  getRoomId(): string;
  getRoomCoordinates(): RoomCoordinates;
  isSceneActive(): boolean;
}

export class EditorBackgroundController {
  private bgSprites: ParallaxSprite[] = [];
  private fallbackBgSprites: Phaser.GameObjects.TileSprite[] = [];
  private bgColorRect: Phaser.GameObjects.Rectangle | null = null;
  private surroundingRoomImages: Phaser.GameObjects.Image[] = [];
  private surroundingRoomBorders: Phaser.GameObjects.Graphics | null = null;
  private surroundingRoomTextureKeys = new Set<string>();
  private surroundingPreviewToken = 0;
  private backgroundLoadToken = 0;
  private neighborSnapshots: RoomSnapshot[] = [];
  private neighborRevision = 0;
  private neighborStatus: 'loading' | 'ready' | 'error' = 'loading';

  get publishedNeighborSnapshots(): readonly RoomSnapshot[] { return this.neighborSnapshots; }
  get publishedNeighborRevision(): number { return this.neighborRevision; }
  get publishedNeighborStatus(): 'loading' | 'ready' | 'error' { return this.neighborStatus; }

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly worldRepository: WorldRepository,
    private readonly host: EditorBackgroundHost,
  ) {}

  get backgroundLayerCount(): number {
    return this.bgSprites.length;
  }

  reset(): void {
    this.backgroundLoadToken += 1;

    this.surroundingPreviewToken += 1;
    this.clearSurroundingRoomPreviews();

    for (const bg of this.bgSprites) {
      bg.sprite.destroy();
    }
    this.bgSprites = [];

    for (const sprite of this.fallbackBgSprites) {
      sprite.destroy();
    }
    this.fallbackBgSprites = [];

    if (this.bgColorRect) {
      this.bgColorRect.destroy();
      this.bgColorRect = null;
    }
  }

  createBackground(selectedBackground: string): void {
    this.updateBackground(selectedBackground);
  }

  updateBackground(selectedBackground: string): void {
    // The editor draws its backgrounds with the main camera, which paints its own background.
    this.scene.cameras.main.transparent = false;
    const loadToken = ++this.backgroundLoadToken;
    for (const bg of this.bgSprites) {
      bg.sprite.destroy();
    }
    this.bgSprites = [];
    for (const sprite of this.fallbackBgSprites) {
      sprite.destroy();
    }
    this.fallbackBgSprites = [];
    if (this.bgColorRect) {
      this.bgColorRect.destroy();
      this.bgColorRect = null;
    }

    const resolved = resolveRoomBackground(selectedBackground);
    const w = ROOM_PX_WIDTH;
    const h = ROOM_PX_HEIGHT;

    if (resolved.kind === 'none') {
      this.bgColorRect = this.scene.add.rectangle(0, 0, w, h, RETRO_COLORS.backgroundNumber);
      this.bgColorRect.setOrigin(0, 0);
      this.bgColorRect.setDepth(-20);

      this.fallbackBgSprites = [0, 1].map((index) => {
        const config = getStarfieldLayerConfig(index);
        return createStarfieldTileSprite(this.scene, {
          x: 0,
          y: 0,
          width: w,
          height: h,
          depth: -10 + index,
          alpha: config.alpha,
        });
      });
      this.updateBackgroundPreview();
      return;
    }

    if (resolved.kind === 'solid') {
      const color = Phaser.Display.Color.HexStringToColor(resolved.color).color;
      this.bgColorRect = this.scene.add.rectangle(0, 0, w, h, color);
      this.bgColorRect.setOrigin(0, 0);
      this.bgColorRect.setDepth(-20);
      this.updateBackgroundPreview();
      return;
    }

    if (resolved.kind === 'custom') {
      this.bgColorRect = this.scene.add.rectangle(0, 0, w, h, RETRO_COLORS.backgroundNumber);
      this.bgColorRect.setOrigin(0, 0);
      this.bgColorRect.setDepth(-20);
      this.updateBackgroundPreview();

      void ensureCustomBackgroundTexture(this.scene, resolved.id)
        .then(() => {
          if (loadToken !== this.backgroundLoadToken || !this.host.isSceneActive()) {
            return;
          }
          const layer = createCustomBackgroundLayer(this.scene, resolved.id, resolved.fit);
          const sprite = createCustomBackgroundObject(this.scene, layer, 0, 0, w, h, -10);
          this.bgSprites.push({ sprite, layer });
              this.updateBackgroundPreview();
        })
        .catch(() => {});
      return;
    }

    if (resolved.group.bgColor) {
      const color = Phaser.Display.Color.HexStringToColor(resolved.group.bgColor).color;
      this.bgColorRect = this.scene.add.rectangle(0, 0, w, h, color);
      this.bgColorRect.setOrigin(0, 0);
      this.bgColorRect.setDepth(-20);
    }

    for (let index = 0; index < resolved.group.layers.length; index += 1) {
      const layer = resolved.group.layers[index];
      const sprite = createBuiltInBackgroundObject(this.scene, layer, 0, 0, w, h, -10 + index);
      this.bgSprites.push({ sprite, layer });
    }

    this.updateBackgroundPreview();
  }

  updateBackgroundPreview(): void {
    const cam = this.scene.cameras.main;
    const w = ROOM_PX_WIDTH;
    const h = ROOM_PX_HEIGHT;

    if (this.bgColorRect) {
      this.bgColorRect.setPosition(0, 0);
      this.bgColorRect.setSize(w, h);
    }

    for (const bg of this.bgSprites) {
      if ('fit' in bg.layer) {
        syncCustomBackgroundObject(bg.sprite as CustomBackgroundObject, bg.layer, 0, 0, w, h, cam.scrollX);
        continue;
      }

      const scale = getBuiltInBackgroundTileScale(bg.layer, h);
      syncBuiltInBackgroundObject(
        bg.sprite as BuiltInBackgroundObject,
        bg.layer,
        0,
        0,
        w,
        h,
        (cam.scrollX * bg.layer.scrollFactor) / scale,
        0,
      );
    }

    for (let index = 0; index < this.fallbackBgSprites.length; index += 1) {
      const sprite = this.fallbackBgSprites[index];
      syncStarfieldTileSprite(sprite, cam, getStarfieldLayerConfig(index), {
        width: w,
        height: h,
      });
    }
  }

  clearSurroundingRoomPreviews(): void {
    this.neighborSnapshots = [];
    this.neighborStatus = 'loading';
    this.neighborRevision += 1;
    for (const image of this.surroundingRoomImages) {
      image.destroy();
    }
    this.surroundingRoomImages = [];

    if (this.surroundingRoomBorders) {
      this.surroundingRoomBorders.destroy();
      this.surroundingRoomBorders = null;
    }

    for (const textureKey of this.surroundingRoomTextureKeys) {
      if (this.scene.textures.exists(textureKey)) {
        this.scene.textures.remove(textureKey);
      }
    }
    this.surroundingRoomTextureKeys.clear();
  }

  async refreshSurroundingRoomPreviews(radius: number): Promise<void> {
    const token = ++this.surroundingPreviewToken;
    this.neighborStatus = 'loading'; this.neighborRevision += 1;

    try {
      const worldWindow = await this.worldRepository.loadWorldWindow(
        this.host.getRoomCoordinates(),
        radius,
      );

      const publishedNeighbors = worldWindow.rooms.filter(
        (room) => room.id !== this.host.getRoomId() && room.state === 'published',
      );

      const loadedNeighbors = await Promise.all(
        publishedNeighbors.map(async (room) => {
          const snapshot = await this.worldRepository.loadPublishedRoom(room.id, room.coordinates);
          if (token !== this.surroundingPreviewToken || !this.host.isSceneActive()) return null;
          if (snapshot) await ensureRoomArtLoaded(this.scene, snapshot);
          return snapshot ? { room, snapshot } : null;
        }),
      );

      if (token !== this.surroundingPreviewToken || !this.host.isSceneActive()) {
        return;
      }

      this.clearSurroundingRoomPreviews();
      this.neighborSnapshots = loadedNeighbors.flatMap(item => item ? [item.snapshot] : []);
      this.neighborStatus = loadedNeighbors.some(item => !item) ? 'error' : 'ready'; this.neighborRevision += 1;
      this.surroundingRoomBorders = this.scene.add.graphics();
      this.surroundingRoomBorders.setDepth(0);
      this.surroundingRoomBorders.lineStyle(2, RETRO_COLORS.published, 0.24);

      const currentCoordinates = this.host.getRoomCoordinates();

      for (const loadedNeighbor of loadedNeighbors) {
        if (!loadedNeighbor) {
          continue;
        }

        const { room, snapshot } = loadedNeighbor;
        const textureKey = buildRoomTextureKey(snapshot, 'editor-preview', TILE_SIZE);
        if (!this.scene.textures.exists(textureKey)) {
          buildRoomSnapshotTexture(this.scene, snapshot, textureKey, TILE_SIZE);
        }

        this.surroundingRoomTextureKeys.add(textureKey);

        const offsetX = (room.coordinates.x - currentCoordinates.x) * ROOM_PX_WIDTH;
        const offsetY = (room.coordinates.y - currentCoordinates.y) * ROOM_PX_HEIGHT;
        const image = this.scene.add.image(
          offsetX + ROOM_PX_WIDTH / 2,
          offsetY + ROOM_PX_HEIGHT / 2,
          textureKey,
        );
        image.setDepth(-2);
        image.setAlpha(0.92);
        this.surroundingRoomImages.push(image);

        this.surroundingRoomBorders.strokeRect(offsetX, offsetY, ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
      }
    } catch (error) {
      if (token !== this.surroundingPreviewToken) {
        return;
      }

      console.error('Failed to load surrounding room previews', error);
      this.clearSurroundingRoomPreviews();
      this.neighborStatus = 'error'; this.neighborRevision += 1;
    }
  }
}
