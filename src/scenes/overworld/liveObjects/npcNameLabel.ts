import type Phaser from 'phaser';

/** Early GameBoy is an 8px bitmap. Any other size rasterizes with grey edges. */
export const NPC_NAME_FONT_SIZE_PX = 8;

export const NPC_NAME_LABEL_FILL = { r: 255, g: 255, b: 255 } as const;
export const NPC_NAME_LABEL_INK = { r: 16, g: 21, b: 34 } as const;

export const NPC_NAME_LABEL_STYLE = {
  fontFamily: '"Early GameBoy", monospace',
  fontSize: `${NPC_NAME_FONT_SIZE_PX}px`,
  color: '#ffffff',
  stroke: '#101522',
  strokeThickness: 1,
  align: 'center' as const,
};

const NEAREST_FILTER = 0;
const SHARPENED = Symbol('npcNameLabelSharpened');

interface NpcNameText {
  active?: boolean;
  scene?: unknown;
  canvas?: HTMLCanvasElement | null;
  style?: { resolution?: number };
  texture?: { setFilter?: (filter: number) => void } | null;
  frame?: { source?: { glTexture?: unknown } | null } | null;
  renderer?: unknown;
  updateText: () => unknown;
  setResolution: (resolution: number) => unknown;
}

/** Draw the name at an integer camera scale so each font pixel lands on a screen pixel. */
export function resolveNpcNameLabelResolution(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return 1;
  }
  return Math.max(1, Math.round(zoom));
}

/** Collapse antialiased greys to solid ink or paper so the name stays pixel-sharp. */
export function quantizeNpcNamePixels(pixels: Uint8ClampedArray): void {
  const fill = NPC_NAME_LABEL_FILL;
  const ink = NPC_NAME_LABEL_INK;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] ?? 0;
    if (alpha < 128) {
      pixels[index + 3] = 0;
      continue;
    }

    const red = pixels[index] ?? 0;
    const green = pixels[index + 1] ?? 0;
    const blue = pixels[index + 2] ?? 0;
    const fillDistance =
      (red - fill.r) ** 2 + (green - fill.g) ** 2 + (blue - fill.b) ** 2;
    const inkDistance = (red - ink.r) ** 2 + (green - ink.g) ** 2 + (blue - ink.b) ** 2;
    const color = fillDistance <= inkDistance ? fill : ink;
    pixels[index] = color.r;
    pixels[index + 1] = color.g;
    pixels[index + 2] = color.b;
    pixels[index + 3] = 255;
  }
}

export function installNpcNameLabelSharpness(label: NpcNameText): void {
  const marked = label as NpcNameText & { [SHARPENED]?: boolean };
  if (marked[SHARPENED]) {
    return;
  }
  marked[SHARPENED] = true;
  label.texture?.setFilter?.(NEAREST_FILTER);

  const updateText = label.updateText.bind(label);
  label.updateText = () => {
    const result = updateText();
    sharpenNpcNameLabelCanvas(label);
    return result;
  };
}

export function syncNpcNameLabelResolution(label: NpcNameText, zoom: number): boolean {
  const resolution = resolveNpcNameLabelResolution(zoom);
  if (label.style?.resolution === resolution) {
    return false;
  }
  label.setResolution(resolution);
  label.texture?.setFilter?.(NEAREST_FILTER);
  return true;
}

function sharpenNpcNameLabelCanvas(label: NpcNameText): void {
  const canvas = label.canvas;
  if (!canvas || canvas.width < 1 || canvas.height < 1) {
    return;
  }
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }

  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  quantizeNpcNamePixels(image.data);
  context.putImageData(image, 0, 0);

  const renderer = label.renderer as {
    gl?: unknown;
    canvasToTexture?: (
      canvas: HTMLCanvasElement,
      glTexture: unknown,
      noRepeat: boolean,
    ) => unknown;
  } | null | undefined;
  const source = label.frame?.source;
  if (renderer?.gl && source && renderer.canvasToTexture) {
    source.glTexture = renderer.canvasToTexture(canvas, source.glTexture, true);
  }
}

export function refreshNpcNameLabelWhenFontReady(label: NpcNameText): void {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts;
  if (!fonts?.load) {
    return;
  }
  void fonts.load(`${NPC_NAME_FONT_SIZE_PX}px "Early GameBoy"`).then(() => {
    if (label.active === false || !label.scene) {
      return;
    }
    label.updateText();
  });
}

export function attachNpcNameLabel(
  scene: Phaser.Scene,
  sprite: { x: number; y: number; depth: number },
  name: string,
): Phaser.GameObjects.Text {
  const label = scene.add.text(sprite.x, sprite.y - 19, name, NPC_NAME_LABEL_STYLE);
  label.setOrigin(0.5, 1);
  label.setDepth(sprite.depth + 0.05);
  installNpcNameLabelSharpness(label);
  if (!syncNpcNameLabelResolution(label, scene.cameras.main.zoom)) {
    label.updateText();
  }
  refreshNpcNameLabelWhenFontReady(label);
  return label;
}
