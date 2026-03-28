import Phaser from 'phaser';
import {
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  getBackgroundGroup,
  type BackgroundLayer,
} from '../config';
import { RETRO_COLORS, ensureStarfieldTexture } from '../visuals/starfield';

export interface CourseEditorRoomBackgroundVisuals {
  origin: { x: number; y: number };
  colorRect: Phaser.GameObjects.Rectangle | null;
  layerSprites: Array<{
    sprite: Phaser.GameObjects.TileSprite;
    layer: BackgroundLayer;
  }>;
  fallbackSprites: Phaser.GameObjects.TileSprite[];
}

const FALLBACK_CONFIGS = [
  { parallax: 0.035, tileScale: 1 },
  { parallax: 0.12, tileScale: 0.58 },
] as const;

export function createCourseEditorRoomBackgroundVisuals(
  scene: Phaser.Scene,
  origin: { x: number; y: number },
  backgroundId: string,
): CourseEditorRoomBackgroundVisuals {
  const group = getBackgroundGroup(backgroundId);
  const visuals: CourseEditorRoomBackgroundVisuals = {
    origin: { ...origin },
    colorRect: null,
    layerSprites: [],
    fallbackSprites: [],
  };

  if (!group || group.layers.length === 0) {
    const textureKey = ensureStarfieldTexture(scene);
    visuals.colorRect = scene.add.rectangle(
      origin.x,
      origin.y,
      ROOM_PX_WIDTH,
      ROOM_PX_HEIGHT,
      RETRO_COLORS.backgroundNumber,
    );
    visuals.colorRect.setOrigin(0, 0);
    visuals.colorRect.setDepth(-40);

    for (let index = 0; index < FALLBACK_CONFIGS.length; index += 1) {
      const sprite = scene.add.tileSprite(origin.x, origin.y, ROOM_PX_WIDTH, ROOM_PX_HEIGHT, textureKey);
      sprite.setOrigin(0, 0);
      sprite.setDepth(-39 + index);
      sprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
      visuals.fallbackSprites.push(sprite);
    }

    return visuals;
  }

  if (group.bgColor) {
    const color = Phaser.Display.Color.HexStringToColor(group.bgColor).color;
    visuals.colorRect = scene.add.rectangle(origin.x, origin.y, ROOM_PX_WIDTH, ROOM_PX_HEIGHT, color);
    visuals.colorRect.setOrigin(0, 0);
    visuals.colorRect.setDepth(-40);
  }

  for (let index = 0; index < group.layers.length; index += 1) {
    const layer = group.layers[index];
    const sprite = scene.add.tileSprite(origin.x, origin.y, ROOM_PX_WIDTH, ROOM_PX_HEIGHT, layer.key);
    sprite.setOrigin(0, 0);
    sprite.setDepth(-39 + index);
    sprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    visuals.layerSprites.push({ sprite, layer });
  }

  return visuals;
}

export function syncCourseEditorRoomBackgroundVisuals(
  visuals: CourseEditorRoomBackgroundVisuals,
  camera: Phaser.Cameras.Scene2D.Camera,
): void {
  if (visuals.colorRect) {
    visuals.colorRect.setPosition(visuals.origin.x, visuals.origin.y);
    visuals.colorRect.setSize(ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
  }

  for (const { sprite, layer } of visuals.layerSprites) {
    const scale = ROOM_PX_HEIGHT / layer.height;
    sprite.setPosition(visuals.origin.x, visuals.origin.y);
    sprite.setSize(ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
    sprite.setTileScale(scale, scale);
    sprite.tilePositionX = (camera.scrollX * layer.scrollFactor) / scale;
    sprite.tilePositionY = (camera.scrollY * layer.scrollFactor) / scale;
  }

  for (let index = 0; index < visuals.fallbackSprites.length; index += 1) {
    const sprite = visuals.fallbackSprites[index];
    const config = FALLBACK_CONFIGS[Math.min(index, FALLBACK_CONFIGS.length - 1)];
    sprite.setPosition(visuals.origin.x, visuals.origin.y);
    sprite.setSize(ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
    sprite.setTileScale(config.tileScale, config.tileScale);
    sprite.tilePositionX = (camera.scrollX * config.parallax) / config.tileScale;
    sprite.tilePositionY = (camera.scrollY * config.parallax) / config.tileScale;
  }
}

export function destroyCourseEditorRoomBackgroundVisuals(
  visuals: CourseEditorRoomBackgroundVisuals | null | undefined,
): void {
  if (!visuals) {
    return;
  }

  visuals.colorRect?.destroy();
  for (const { sprite } of visuals.layerSprites) {
    sprite.destroy();
  }
  for (const sprite of visuals.fallbackSprites) {
    sprite.destroy();
  }
}
