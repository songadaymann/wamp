import { TILE_SIZE } from '../config/room';

export function getRoomMetadataBackgroundLayerLayout(
  layer: { width: number; height: number; repeat?: boolean },
  width: number,
  height: number,
): { repeat: boolean; drawWidth: number } {
  if (layer.repeat === false) {
    return { repeat: false, drawWidth: width };
  }
  const scale = height / layer.height;
  return {
    repeat: true,
    drawWidth: Math.max(1, Math.ceil(layer.width * scale)),
  };
}

export function getRoomMetadataObjectDrawRect(
  object: {
    frameWidth: number;
    frameHeight: number;
    displayScale: number;
    displayOffset: { x: number; y: number };
  },
  placedObject: { x: number; y: number },
  tilePixelSize: number,
): { x: number; y: number; width: number; height: number } {
  const scale = tilePixelSize / TILE_SIZE;
  const width = Math.max(1, Math.round(object.frameWidth * object.displayScale * scale));
  const height = Math.max(1, Math.round(object.frameHeight * object.displayScale * scale));
  return {
    x: Math.round((placedObject.x + object.displayOffset.x) * scale - width / 2),
    y: Math.round((placedObject.y + object.displayOffset.y) * scale - height / 2),
    width,
    height,
  };
}
