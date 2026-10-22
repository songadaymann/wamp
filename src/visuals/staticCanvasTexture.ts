import Phaser from 'phaser';

/**
 * Registers a canvas that is drawn once as a plain Phaser texture. textures.addCanvas and
 * createCanvas wrap it in a CanvasTexture, whose constructor reads every pixel back into an
 * ImageData copy kept for the texture's life, and nothing reads it (F304). A plain texture
 * still uploads the canvas and keeps it as its source. Canvases redrawn after upload
 * (animated backgrounds, custom sprites, the custom tile atlas) must stay CanvasTextures.
 */
export function addStaticCanvasTexture(
  textures: Phaser.Textures.TextureManager,
  key: string,
  canvas: HTMLCanvasElement,
): Phaser.Textures.Texture | null {
  return textures.addImage(key, canvas as unknown as HTMLImageElement);
}

/**
 * Takes a canvas from Phaser's pool, as textures.createCanvas does. Removing a texture made
 * from it hands it back to the pool shrunk to 1x1; call releasePooledTextureCanvas if no
 * texture was made.
 */
export function createPooledTextureCanvas(width: number, height: number): HTMLCanvasElement {
  return Phaser.Display.Canvas.CanvasPool.create(null, width, height, Phaser.CANVAS, true);
}

export function releasePooledTextureCanvas(canvas: HTMLCanvasElement): void {
  Phaser.Display.Canvas.CanvasPool.remove(canvas);
}
