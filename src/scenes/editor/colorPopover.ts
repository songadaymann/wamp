export interface EditorColorPopoverElements {
  popover: HTMLElement | null;
  square: HTMLCanvasElement | null;
  hue: HTMLInputElement | null;
  hex: HTMLInputElement | null;
  dropper: HTMLButtonElement | null;
}

interface EyeDropperResult {
  sRGBHex: string;
}

interface EyeDropperWindow {
  EyeDropper?: new () => { open: () => Promise<EyeDropperResult> };
}

export class EditorColorPopover {
  private hsv = { h: 0, s: 0, v: 1 };
  private openTarget: ((hex: string) => void) | null = null;

  constructor(
    private readonly elements: EditorColorPopoverElements,
    private readonly onColor: (hex: string) => void,
  ) {}

  bind(cleanup: Array<() => void>): void {
    const { square, hue, hex, dropper, popover } = this.elements;
    const paint = () => this.paint();
    const pickFromSquare = (event: PointerEvent) => {
      if (!square) return;
      const rect = square.getBoundingClientRect();
      this.hsv.s = clamp01((event.clientX - rect.left) / rect.width);
      this.hsv.v = 1 - clamp01((event.clientY - rect.top) / rect.height);
      this.emit();
    };
    square?.addEventListener('pointerdown', pickFromSquare);
    hue?.addEventListener('input', () => {
      this.hsv.h = Number(hue.value) || 0;
      this.emit();
    });
    hex?.addEventListener('change', () => {
      const next = normalizeHex(hex.value);
      if (!next) return;
      this.hsv = hexToHsv(next);
      this.emit();
    });
    dropper?.addEventListener('click', () => {
      void this.sampleScreen();
    });
    if (square) cleanup.push(() => square.removeEventListener('pointerdown', pickFromSquare));
    if (popover) popover.addEventListener('pointerdown', (event) => event.stopPropagation());
    paint();
  }

  open(anchor: HTMLElement, hex: string, onColor: (hex: string) => void): void {
    const popover = this.elements.popover;
    if (!popover) return;
    this.openTarget = onColor;
    this.hsv = hexToHsv(normalizeHex(hex) ?? '#FFFFFF');
    popover.classList.remove('hidden');
    const parent = popover.offsetParent as HTMLElement | null;
    const parentRect = parent?.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    if (parentRect) {
      popover.style.left = `${anchorRect.left - parentRect.left}px`;
      popover.style.top = `${anchorRect.bottom - parentRect.top + 6}px`;
    }
    this.paint();
  }

  close(): void {
    this.elements.popover?.classList.add('hidden');
    this.openTarget = null;
  }

  private emit(): void {
    const hex = hsvToHex(this.hsv.h, this.hsv.s, this.hsv.v);
    if (this.elements.hex) this.elements.hex.value = hex;
    this.paint();
    (this.openTarget ?? this.onColor)(hex);
  }

  private paint(): void {
    const square = this.elements.square;
    const hue = this.elements.hue;
    if (hue) hue.value = String(Math.round(this.hsv.h));
    if (this.elements.hex && document.activeElement !== this.elements.hex) {
      this.elements.hex.value = hsvToHex(this.hsv.h, this.hsv.s, this.hsv.v);
    }
    if (!square) return;
    const context = square.getContext('2d');
    if (!context) return;
    const width = square.width;
    const height = square.height;
    const image = context.createImageData(width, height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const color = hsvToRgb(this.hsv.h, x / width, 1 - y / height);
        const offset = (y * width + x) * 4;
        image.data[offset] = color.r;
        image.data[offset + 1] = color.g;
        image.data[offset + 2] = color.b;
        image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    context.strokeStyle = '#111';
    context.strokeRect(this.hsv.s * width - 3, (1 - this.hsv.v) * height - 3, 6, 6);
  }

  private async sampleScreen(): Promise<void> {
    const EyeDropper = (window as EyeDropperWindow).EyeDropper;
    if (!EyeDropper) return;
    try {
      const result = await new EyeDropper().open();
      const next = normalizeHex(result.sRGBHex);
      if (!next) return;
      this.hsv = hexToHsv(next);
      this.emit();
    } catch {
      // The eyedropper dismisses when the user presses Escape.
    }
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeHex(value: string): string | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
  return match ? `#${match[1].toUpperCase()}` : null;
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const rgb = hexToRgb(hex);
  return rgbToHsv(rgb.r, rgb.g, rgb.b);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function hsvToHex(h: number, s: number, v: number): string {
  const { r, g, b } = hsvToRgb(h, s, v);
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  const sector = Math.floor(hue / 60);
  const channels = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector] ?? [0, 0, 0];
  return {
    r: Math.round((channels[0] + m) * 255),
    g: Math.round((channels[1] + m) * 255),
    b: Math.round((channels[2] + m) * 255),
  };
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === red) h = 60 * (((green - blue) / delta) % 6);
    else if (max === green) h = 60 * ((blue - red) / delta + 2);
    else h = 60 * ((red - green) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}
