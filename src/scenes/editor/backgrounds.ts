import Phaser from 'phaser';
import {
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  TILE_SIZE,
  getBackgroundGroup,
  type BackgroundLayer,
} from '../../config';
import type { RoomCoordinates } from '../../persistence/roomRepository';
import type { WorldRepository } from '../../persistence/worldRepository';
import { RETRO_COLORS, ensureStarfieldTexture } from '../../visuals/starfield';
import { buildRoomSnapshotTexture, buildRoomTextureKey } from '../../visuals/roomSnapshotTexture';

interface ParallaxSprite {
  sprite: Phaser.GameObjects.TileSprite;
  layer: BackgroundLayer;
}

interface EditorBackgroundHost {
  getRoomId(): string;
  getRoomCoordinates(): RoomCoordinates;
  getIgnoredBackgroundObjects(): Phaser.GameObjects.GameObject[];
  isSceneActive(): boolean;
}

export class EditorBackgroundController {
  private bgSprites: ParallaxSprite[] = [];
  private fallbackBgSprites: Phaser.GameObjects.TileSprite[] = [];
  private bgColorRect: Phaser.GameObjects.Rectangle | null = null;
  private bgCamera: Phaser.Cameras.Scene2D.Camera | null = null;
  private surroundingRoomImages: Phaser.GameObjects.Image[] = [];
  private surroundingRoomBorders: Phaser.GameObjects.Graphics | null = null;
  private surroundingRoomTextureKeys = new Set<string>();
  private surroundingPreviewToken = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly worldRepository: WorldRepository,
    private readonly host: EditorBackgroundHost,
  ) {}

  get backgroundLayerCount(): number {
    return this.bgSprites.length;
  }

  get hasBackgroundCamera(): boolean {
    return Boolean(this.bgCamera);
  }

  reset(): void {
    if (this.bgCamera && this.scene.cameras.cameras.includes(this.bgCamera)) {
      this.scene.cameras.remove(this.bgCamera, true);
    }

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

    this.bgCamera = null;
  }

  createBackground(selectedBackground: string): void {
    this.updateBackground(selectedBackground);
  }

  updateBackground(selectedBackground: string): void {
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

    const group = getBackgroundGroup(selectedBackground);
    const w = ROOM_PX_WIDTH;
    const h = ROOM_PX_HEIGHT;

    if (!group || group.layers.length === 0) {
      const textureKey = ensureStarfieldTexture(this.scene);

      this.bgColorRect = this.scene.add.rectangle(0, 0, w, h, RETRO_COLORS.backgroundNumber);
      this.bgColorRect.setOrigin(0, 0);
      this.bgColorRect.setDepth(-20);

      const farLayer = this.scene.add.tileSprite(0, 0, w, h, textureKey);
      farLayer.setOrigin(0, 0);
      farLayer.setDepth(-10);
      farLayer.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);

      const nearLayer = this.scene.add.tileSprite(0, 0, w, h, textureKey);
      nearLayer.setOrigin(0, 0);
      nearLayer.setDepth(-9);
      nearLayer.setAlpha(0.28);
      nearLayer.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);

      this.fallbackBgSprites = [farLayer, nearLayer];
      this.syncBackgroundCameraIgnores();
      this.updateBackgroundPreview();
      return;
    }

    if (group.bgColor) {
      const color = Phaser.Display.Color.HexStringToColor(group.bgColor).color;
      this.bgColorRect = this.scene.add.rectangle(0, 0, w, h, color);
      this.bgColorRect.setOrigin(0, 0);
      this.bgColorRect.setDepth(-20);
    }

    for (let index = 0; index < group.layers.length; index += 1) {
      const layer = group.layers[index];
      const sprite = this.scene.add.tileSprite(0, 0, w, h, layer.key);
      sprite.setOrigin(0, 0);
      sprite.setDepth(-10 + index);
      sprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
      this.bgSprites.push({ sprite, layer });
    }

    this.syncBackgroundCameraIgnores();
    this.updateBackgroundPreview();
  }

  syncBackgroundCameraIgnores(): void {
    const mainCam = this.scene.cameras.main;
    if (!this.bgCamera) {
      mainCam.transparent = false;
      return;
    }

    mainCam.transparent = true;
    for (const object of this.host.getIgnoredBackgroundObjects()) {
      this.bgCamera.ignore(object);
    }
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
      bg.sprite.setPosition(0, 0);
      bg.sprite.setSize(w, h);

      const scale = h / bg.layer.height;
      bg.sprite.setTileScale(scale, scale);
      bg.sprite.tilePositionX = (cam.scrollX * bg.layer.scrollFactor) / scale;
      bg.sprite.tilePositionY = 0;
    }

    const fallbackConfigs = [
      { parallax: 0.035, tileScale: 1 },
      { parallax: 0.12, tileScale: 0.58 },
    ];

    for (let index = 0; index < this.fallbackBgSprites.length; index += 1) {
      const sprite = this.fallbackBgSprites[index];
      const config = fallbackConfigs[Math.min(index, fallbackConfigs.length - 1)];
      sprite.setPosition(0, 0);
      sprite.setSize(w, h);
      sprite.setTileScale(config.tileScale, config.tileScale);
      sprite.tilePositionX = (cam.scrollX * config.parallax) / config.tileScale;
      sprite.tilePositionY = (cam.scrollY * config.parallax) / config.tileScale;
    }
  }

  clearSurroundingRoomPreviews(): void {
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
          return snapshot ? { room, snapshot } : null;
        }),
      );

      if (token !== this.surroundingPreviewToken || !this.host.isSceneActive()) {
        return;
      }

      this.clearSurroundingRoomPreviews();
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
    }
  }
}
