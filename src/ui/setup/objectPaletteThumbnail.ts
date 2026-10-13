import { assetUrl } from '../../assets/assetUrl';
import { getObjectDefaultFrame, getObjectFrameSourceRect, type GameObjectConfig } from '../../config';

/** Only visible palette images download; animated objects use their authored default frame. */
export function createObjectPaletteThumbnail(doc: Document, object: GameObjectConfig): HTMLImageElement {
  const image = doc.createElement('img');
  image.alt = '';
  image.loading = 'lazy';
  image.src = assetUrl(object.path);
  if (object.frameCount > 1) {
    const canvas = doc.createElement('canvas');
    canvas.width = object.frameWidth; canvas.height = object.frameHeight;
    const source = new Image();
    source.onload = () => {
      const context = canvas.getContext('2d');
      if (!context) return;
      context.imageSmoothingEnabled = false;
      const rect = getObjectFrameSourceRect(object, getObjectDefaultFrame(object), source.naturalWidth || source.width || object.frameWidth);
      context.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, canvas.width, canvas.height);
      image.src = canvas.toDataURL();
    };
    source.src = assetUrl(object.path);
  }
  return image;
}
