import Phaser from 'phaser';
import {
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  type BackgroundLayer,
} from '../config';
import { resolveRoomBackground } from '../backgrounds/model';
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
} from '../backgrounds/runtime';
import {
  RETRO_COLORS,
  createStarfieldTileSprite,
  getStarfieldLayerConfig,
  syncStarfieldTileSprite,
} from '../visuals/starfield';

export interface CourseEditorRoomBackgroundVisuals {
  origin: { x: number; y: number };
  colorRect: Phaser.GameObjects.Rectangle | null;
  layerSprites: Array<{
    sprite: BuiltInBackgroundObject | CustomBackgroundObject;
    layer: BackgroundLayer | CustomBackgroundLayer;
  }>;
  fallbackSprites: Phaser.GameObjects.TileSprite[];
}

export function createCourseEditorRoomBackgroundVisuals(
  scene: Phaser.Scene,
  origin: { x: number; y: number },
  backgroundId: string,
): CourseEditorRoomBackgroundVisuals {
  const resolved = resolveRoomBackground(backgroundId);
  const visuals: CourseEditorRoomBackgroundVisuals = {
    origin: { ...origin },
    colorRect: null,
    layerSprites: [],
    fallbackSprites: [],
  };

  if (resolved.kind === 'none') {
    visuals.colorRect = scene.add.rectangle(
      origin.x,
      origin.y,
      ROOM_PX_WIDTH,
      ROOM_PX_HEIGHT,
      RETRO_COLORS.backgroundNumber,
    );
    visuals.colorRect.setOrigin(0, 0);
    visuals.colorRect.setDepth(-40);

    for (let index = 0; index < 2; index += 1) {
      const config = getStarfieldLayerConfig(index);
      const sprite = createStarfieldTileSprite(scene, {
        x: origin.x,
        y: origin.y,
        width: ROOM_PX_WIDTH,
        height: ROOM_PX_HEIGHT,
        depth: -39 + index,
        alpha: config.alpha,
      });
      visuals.fallbackSprites.push(sprite);
    }

    return visuals;
  }

  if (resolved.kind === 'solid') {
    const color = Phaser.Display.Color.HexStringToColor(resolved.color).color;
    visuals.colorRect = scene.add.rectangle(origin.x, origin.y, ROOM_PX_WIDTH, ROOM_PX_HEIGHT, color);
    visuals.colorRect.setOrigin(0, 0);
    visuals.colorRect.setDepth(-40);
    return visuals;
  }

  if (resolved.kind === 'custom') {
    visuals.colorRect = scene.add.rectangle(
      origin.x,
      origin.y,
      ROOM_PX_WIDTH,
      ROOM_PX_HEIGHT,
      RETRO_COLORS.backgroundNumber,
    );
    visuals.colorRect.setOrigin(0, 0);
    visuals.colorRect.setDepth(-40);
    void ensureCustomBackgroundTexture(scene, resolved.id)
      .then(() => {
        if (!visuals.colorRect?.active) {
          return;
        }
        const layer = createCustomBackgroundLayer(scene, resolved.id, resolved.fit);
        const sprite = createCustomBackgroundObject(
          scene,
          layer,
          origin.x,
          origin.y,
          ROOM_PX_WIDTH,
          ROOM_PX_HEIGHT,
          -39,
        );
        visuals.layerSprites.push({ sprite, layer });
        syncCourseEditorRoomBackgroundVisuals(visuals, scene.cameras.main);
      })
      .catch(() => {});
    return visuals;
  }

  if (resolved.group.bgColor) {
    const color = Phaser.Display.Color.HexStringToColor(resolved.group.bgColor).color;
    visuals.colorRect = scene.add.rectangle(origin.x, origin.y, ROOM_PX_WIDTH, ROOM_PX_HEIGHT, color);
    visuals.colorRect.setOrigin(0, 0);
    visuals.colorRect.setDepth(-40);
  }

  for (let index = 0; index < resolved.group.layers.length; index += 1) {
    const layer = resolved.group.layers[index];
    const sprite = createBuiltInBackgroundObject(
      scene,
      layer,
      origin.x,
      origin.y,
      ROOM_PX_WIDTH,
      ROOM_PX_HEIGHT,
      -39 + index,
    );
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
    if ('fit' in layer) {
      syncCustomBackgroundObject(
        sprite as CustomBackgroundObject,
        layer,
        visuals.origin.x,
        visuals.origin.y,
        ROOM_PX_WIDTH,
        ROOM_PX_HEIGHT,
        camera.scrollX,
      );
      continue;
    }

    const scale = getBuiltInBackgroundTileScale(layer, ROOM_PX_HEIGHT);
    syncBuiltInBackgroundObject(
      sprite as BuiltInBackgroundObject,
      layer,
      visuals.origin.x,
      visuals.origin.y,
      ROOM_PX_WIDTH,
      ROOM_PX_HEIGHT,
      (camera.scrollX * layer.scrollFactor) / scale,
      (camera.scrollY * layer.scrollFactor) / scale,
    );
  }

  for (let index = 0; index < visuals.fallbackSprites.length; index += 1) {
    const sprite = visuals.fallbackSprites[index];
    syncStarfieldTileSprite(sprite, camera, getStarfieldLayerConfig(index), {
      x: visuals.origin.x,
      y: visuals.origin.y,
      width: ROOM_PX_WIDTH,
      height: ROOM_PX_HEIGHT,
    });
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
