import Phaser from 'phaser';
import {
  LAYER_NAMES,
  isEditorLayerVisible,
  type LayerName,
} from '../../config';

const EDITOR_LAYER_DATA_KEY = 'editorLayer';

export function tagEditorObjectSprite(
  sprite: Phaser.GameObjects.Sprite,
  layerName: LayerName,
): void {
  sprite.setData(EDITOR_LAYER_DATA_KEY, layerName);
  sprite.setVisible(isEditorLayerVisible(layerName));
}

export function applyEditorLayerVisibility(
  layers: Map<string, Phaser.Tilemaps.TilemapLayer>,
  sprites: readonly Phaser.GameObjects.Sprite[],
): void {
  for (const layerName of LAYER_NAMES) {
    layers.get(layerName)?.setVisible(isEditorLayerVisible(layerName));
  }
  for (const sprite of sprites) {
    const layerName = sprite.getData(EDITOR_LAYER_DATA_KEY) as LayerName | undefined;
    if (!layerName) {
      continue;
    }
    sprite.setVisible(isEditorLayerVisible(layerName));
  }
}
