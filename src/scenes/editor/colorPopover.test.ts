import { describe, expect, it } from 'vitest';
import {
  COLOR_PICK_CELL,
  COLOR_PICK_RADIUS,
  backingPixel,
  paintPickReticle,
  patchCenter,
  rgbToHex,
  shouldDismissColorPopover,
  straightPixel,
  type ColorPickPatch,
} from './colorPopover';

function node(inside: Set<unknown> = new Set()) {
  const element = {
    nodeType: 1,
    classList: { contains: (name: string) => name === 'hidden' && (element as { hidden?: boolean }).hidden === true },
    contains: (candidate: unknown) => candidate === element || inside.has(candidate),
    hidden: false,
  };
  return element as unknown as HTMLElement;
}

describe('triangle color popover dismiss', () => {
  it('closes for clicks outside the modal and keeps clicks on the picker or its swatch', () => {
    const inside = node();
    const popover = node(new Set([inside]));
    const swatch = node();
    expect(shouldDismissColorPopover(node(), popover, swatch)).toBe(true);
    expect(shouldDismissColorPopover(inside, popover, swatch)).toBe(false);
    expect(shouldDismissColorPopover(popover, popover, swatch)).toBe(false);
    expect(shouldDismissColorPopover(swatch, popover, swatch)).toBe(false);
    popover.classList.contains = () => true;
    expect(shouldDismissColorPopover(node(), popover, swatch)).toBe(false);
  });
});

describe('canvas color sampling', () => {
  it('maps a click to the backing pixel under the cursor', () => {
    const rect = { left: 100, top: 40, width: 200, height: 100 };
    expect(backingPixel(100, 40, rect, 400, 200)).toEqual({ x: 0, y: 0 });
    expect(backingPixel(150, 90, rect, 400, 200)).toEqual({ x: 100, y: 100 });
    expect(backingPixel(99, 40, rect, 400, 200)).toBeNull();
  });

  it('returns the authored color and drops a clear pixel', () => {
    expect(straightPixel(10, 20, 30, 255, true)).toEqual({ r: 10, g: 20, b: 30 });
    expect(straightPixel(10, 20, 30, 128, true)).toEqual({ r: 20, g: 40, b: 60 });
    expect(straightPixel(10, 20, 30, 0, true)).toBeNull();
    expect(rgbToHex(10, 20, 30)).toBe('#0A141E');
  });

  it('reads the center cell of a pick loupe patch', () => {
    const size = COLOR_PICK_RADIUS * 2 + 1;
    const pixels = new Uint8ClampedArray(size * size * 4);
    const mid = Math.floor(size / 2);
    const offset = (mid * size + mid) * 4;
    pixels[offset] = 72;
    pixels[offset + 1] = 160;
    pixels[offset + 2] = 93;
    pixels[offset + 3] = 255;
    const patch: ColorPickPatch = { size, pixels };
    expect(patchCenter(patch)).toEqual({ r: 72, g: 160, b: 93 });
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        imageSmoothingEnabled: false,
        clearRect() {},
        fillRect() {},
        strokeRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
      }),
    } as unknown as HTMLCanvasElement;
    paintPickReticle(canvas, patch);
    expect(canvas.width).toBe(size * COLOR_PICK_CELL);
    expect(canvas.height).toBe(size * COLOR_PICK_CELL);
  });
});
