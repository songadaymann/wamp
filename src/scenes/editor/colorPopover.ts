export interface EditorColorPopoverElements {
  popover: HTMLElement | null;
  square: HTMLCanvasElement | null;
  hue: HTMLInputElement | null;
  hex: HTMLInputElement | null;
  dropper: HTMLButtonElement | null;
}

/** Magnified neighborhood shown in the pick loupe (browser eyedropper style). */
export const COLOR_PICK_RADIUS = 6;
export const COLOR_PICK_CELL = 12;

let colorPickArmed = false;

/** True while Pick pixel is waiting for a click (loupe visible). */
export function isColorPickArmed(): boolean {
  return colorPickArmed;
}

export class EditorColorPopover {
  private hsv = { h: 0, s: 0, v: 1 };
  private openTarget: ((hex: string) => void) | null = null;
  private anchor: HTMLElement | null = null;
  private picking = false;
  private reticle: HTMLElement | null = null;
  private reticleCanvas: HTMLCanvasElement | null = null;
  private reticleHex: HTMLElement | null = null;
  private reticleQueued = false;
  private reticleClient = { x: 0, y: 0 };

  constructor(
    private readonly elements: EditorColorPopoverElements,
    private readonly onColor: (hex: string) => void,
  ) {}

  bind(cleanup: Array<() => void>): void {
    const { square, hue, hex, dropper, popover } = this.elements;
    const paint = () => this.paint();
    let draggingSquare = false;
    const pickFromSquare = (event: PointerEvent) => {
      if (!square) return;
      const rect = square.getBoundingClientRect();
      this.hsv.s = clamp01((event.clientX - rect.left) / rect.width);
      this.hsv.v = 1 - clamp01((event.clientY - rect.top) / rect.height);
      this.emit();
    };
    const dragSquare = (event: PointerEvent) => {
      draggingSquare = true;
      square?.setPointerCapture(event.pointerId);
      pickFromSquare(event);
    };
    const slideSquare = (event: PointerEvent) => {
      if (!draggingSquare) return;
      pickFromSquare(event);
    };
    const releaseSquare = (event: PointerEvent) => {
      draggingSquare = false;
      if (square?.hasPointerCapture(event.pointerId)) square.releasePointerCapture(event.pointerId);
    };
    const dismissOutside = (event: PointerEvent) => {
      if (!shouldDismissColorPopover(event.target, popover, this.anchor)) return;
      this.close();
    };
    const keepInside = (event: PointerEvent) => event.stopPropagation();
    square?.addEventListener('pointerdown', dragSquare);
    square?.addEventListener('pointermove', slideSquare);
    square?.addEventListener('pointerup', releaseSquare);
    square?.addEventListener('pointercancel', releaseSquare);
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
    const armDropper = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.picking) this.cancelPick();
      else this.armPick();
    };
    dropper?.addEventListener('click', armDropper);
    popover?.addEventListener('pointerdown', keepInside);
    const doc = popover?.ownerDocument ?? (typeof document === 'undefined' ? null : document);
    const pickPixel = (event: PointerEvent) => {
      if (!this.picking) return;
      if (isDomNode(event.target) && (popover?.contains(event.target) || dropper?.contains(event.target))) return;
      this.cancelPick();
      event.preventDefault();
      event.stopImmediatePropagation();
      this.sampleCanvas(event);
    };
    const moveReticle = (event: PointerEvent) => {
      if (!this.picking) return;
      this.reticleClient = { x: event.clientX, y: event.clientY };
      this.queueReticle();
    };
    const cancelPickKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') this.cancelPick();
    };
    doc?.addEventListener('pointerdown', pickPixel, true);
    doc?.addEventListener('pointermove', moveReticle, true);
    doc?.addEventListener('keydown', cancelPickKey);
    doc?.addEventListener('pointerdown', dismissOutside, true);
    if (square) {
      cleanup.push(() => {
        square.removeEventListener('pointerdown', dragSquare);
        square.removeEventListener('pointermove', slideSquare);
        square.removeEventListener('pointerup', releaseSquare);
        square.removeEventListener('pointercancel', releaseSquare);
      });
    }
    if (dropper) cleanup.push(() => dropper.removeEventListener('click', armDropper));
    if (popover) cleanup.push(() => popover.removeEventListener('pointerdown', keepInside));
    if (doc) {
      cleanup.push(() => {
        this.cancelPick();
        this.reticle?.remove();
        this.reticle = null;
        this.reticleCanvas = null;
        this.reticleHex = null;
        doc.removeEventListener('pointerdown', pickPixel, true);
        doc.removeEventListener('pointermove', moveReticle, true);
        doc.removeEventListener('keydown', cancelPickKey);
        doc.removeEventListener('pointerdown', dismissOutside, true);
      });
    }
    paint();
  }

  open(anchor: HTMLElement, hex: string, onColor: (hex: string) => void): void {
    const popover = this.elements.popover;
    if (!popover) return;
    if (!popover.classList.contains('hidden') && this.anchor === anchor) {
      this.close();
      return;
    }
    this.anchor = anchor;
    this.openTarget = onColor;
    this.hsv = hexToHsv(normalizeHex(hex) ?? '#FFFFFF');
    popover.classList.remove('hidden');
    const anchorRect = anchor.getBoundingClientRect();
    const width = popover.offsetWidth || 184;
    const left = Math.min(
      Math.max(8, anchorRect.left),
      Math.max(8, (popover.ownerDocument.defaultView?.innerWidth ?? 800) - width - 8),
    );
    popover.style.position = 'fixed';
    popover.style.left = `${left}px`;
    popover.style.top = `${anchorRect.bottom + 6}px`;
    this.paint();
  }

  close(): void {
    this.cancelPick();
    this.elements.popover?.classList.add('hidden');
    this.openTarget = null;
    this.anchor = null;
  }

  private emit(exactHex?: string): void {
    const hex = exactHex ?? hsvToHex(this.hsv.h, this.hsv.s, this.hsv.v);
    this.paint();
    if (this.elements.hex && document.activeElement !== this.elements.hex) this.elements.hex.value = hex;
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

  private armPick(): void {
    this.picking = true;
    colorPickArmed = true;
    const doc = this.elements.popover?.ownerDocument ?? document;
    doc.documentElement.classList.add('color-pick-armed');
    this.ensureReticle(doc);
    this.reticle?.classList.remove('hidden');
  }

  private cancelPick(): void {
    this.picking = false;
    colorPickArmed = false;
    this.reticleQueued = false;
    const doc = this.elements.popover?.ownerDocument ?? (typeof document === 'undefined' ? null : document);
    doc?.documentElement.classList.remove('color-pick-armed');
    this.reticle?.classList.add('hidden');
  }

  private ensureReticle(doc: Document): void {
    if (this.reticle) return;
    const size = (COLOR_PICK_RADIUS * 2 + 1) * COLOR_PICK_CELL;
    const root = doc.createElement('div');
    root.id = 'color-pick-reticle';
    root.className = 'color-pick-reticle hidden';
    root.setAttribute('aria-hidden', 'true');
    const canvas = doc.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.className = 'color-pick-reticle-canvas';
    const hex = doc.createElement('div');
    hex.className = 'color-pick-reticle-hex';
    hex.textContent = '#------';
    root.append(canvas, hex);
    doc.body.append(root);
    this.reticle = root;
    this.reticleCanvas = canvas;
    this.reticleHex = hex;
  }

  private queueReticle(): void {
    if (this.reticleQueued || !this.picking) return;
    this.reticleQueued = true;
    const doc = this.elements.popover?.ownerDocument ?? document;
    const view = doc.defaultView;
    const run = () => {
      this.reticleQueued = false;
      if (!this.picking) return;
      this.updateReticle(this.reticleClient.x, this.reticleClient.y);
    };
    if (view) view.requestAnimationFrame(run);
    else run();
  }

  private updateReticle(clientX: number, clientY: number): void {
    const reticle = this.reticle;
    const canvas = this.reticleCanvas;
    if (!reticle || !canvas) return;
    const size = canvas.width;
    // Keep the loupe centered on the hot pixel; the hex chip hangs just below.
    reticle.style.transform = `translate(${Math.round(clientX - size / 2)}px, ${Math.round(clientY - size / 2)}px)`;
    this.readNeighborhood(clientX, clientY, (patch) => {
      if (!this.picking || !patch) {
        reticle.classList.add('is-empty');
        if (this.reticleHex) this.reticleHex.textContent = '';
        return;
      }
      reticle.classList.remove('is-empty');
      paintPickReticle(canvas, patch);
      const center = patchCenter(patch);
      if (this.reticleHex) this.reticleHex.textContent = center ? rgbToHex(center.r, center.g, center.b) : '';
    });
  }

  /**
   * Read the canvas pixel that was authored, not the browser eyedropper.
   * The eyedropper samples the color-managed screen, so each pick of the same
   * triangle comes back slightly paler.
   */
  private sampleCanvas(event: PointerEvent): void {
    this.readNeighborhood(event.clientX, event.clientY, (patch) => {
      const center = patch ? patchCenter(patch) : null;
      if (!center) return;
      const hex = rgbToHex(center.r, center.g, center.b);
      this.hsv = hexToHsv(hex);
      this.emit(hex);
    });
  }

  private readNeighborhood(
    clientX: number,
    clientY: number,
    done: (patch: ColorPickPatch | null) => void,
  ): void {
    const doc = this.elements.popover?.ownerDocument ?? document;
    const stack = doc.elementsFromPoint(clientX, clientY).filter((element) => element !== this.reticle && !this.reticle?.contains(element));
    const canvases = stack.filter((element): element is HTMLCanvasElement => element instanceof HTMLCanvasElement);
    const game = doc.defaultView?.__EVERYBODYS_PLATFORMER_GAME__;
    const canvas = canvases.find((item) => item === game?.canvas) ?? canvases[0];
    if (!canvas) {
      done(null);
      return;
    }
    const renderer = webglRenderer(game);
    if (renderer && canvas === game?.canvas) {
      const rect = canvas.getBoundingClientRect();
      const point = backingPixel(clientX, clientY, rect, renderer.gl.drawingBufferWidth, renderer.gl.drawingBufferHeight);
      if (!point) {
        done(null);
        return;
      }
      const premultiplied = renderer.gl.getContextAttributes()?.premultipliedAlpha !== false;
      renderer.once('postrender', () => {
        done(readWebglNeighborhood(renderer.gl, point.x, point.y, COLOR_PICK_RADIUS, premultiplied));
      });
      return;
    }
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      done(null);
      return;
    }
    const point = backingPixel(clientX, clientY, canvas.getBoundingClientRect(), canvas.width, canvas.height);
    if (!point) {
      done(null);
      return;
    }
    done(readCanvasNeighborhood(context, point.x, point.y, canvas.width, canvas.height, COLOR_PICK_RADIUS));
  }
}

export function shouldDismissColorPopover(
  target: EventTarget | null,
  popover: HTMLElement | null | undefined,
  anchor: HTMLElement | null | undefined,
): boolean {
  if (!popover || popover.classList.contains('hidden')) return false;
  if (!isDomNode(target)) return true;
  if (popover.contains(target)) return false;
  if (anchor?.contains(target)) return false;
  return true;
}

function isDomNode(value: EventTarget | null): value is Node {
  return Boolean(value && typeof (value as Node).nodeType === 'number');
}

interface ReadableWebglRenderer {
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  once(event: string, listener: () => void): void;
}

function webglRenderer(game: { canvas?: HTMLCanvasElement; renderer?: { type?: number; gl?: WebGLRenderingContext | WebGL2RenderingContext; once?: (event: string, listener: () => void) => void } } | undefined): ReadableWebglRenderer | null {
  const renderer = game?.renderer;
  if (!renderer?.gl || renderer.type !== 2 || typeof renderer.once !== 'function') return null;
  return renderer as ReadableWebglRenderer;
}

export function backingPixel(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  bufferWidth: number,
  bufferHeight: number,
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0 || bufferWidth <= 0 || bufferHeight <= 0) return null;
  const x = Math.floor((clientX - rect.left) * (bufferWidth / rect.width));
  const y = Math.floor((clientY - rect.top) * (bufferHeight / rect.height));
  if (x < 0 || y < 0 || x >= bufferWidth || y >= bufferHeight) return null;
  return { x, y };
}

/** Authored color of a canvas pixel. Transparent hits and premultiplied darkening are discarded. */
export function straightPixel(
  red: number,
  green: number,
  blue: number,
  alpha: number,
  premultiplied: boolean,
): { r: number; g: number; b: number } | null {
  if (alpha < 16) return null;
  if (!premultiplied || alpha >= 255) return { r: red, g: green, b: blue };
  const scale = 255 / alpha;
  return {
    r: Math.min(255, Math.round(red * scale)),
    g: Math.min(255, Math.round(green * scale)),
    b: Math.min(255, Math.round(blue * scale)),
  };
}

export function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export interface ColorPickPatch {
  size: number;
  /** Row-major RGBA for the neighborhood, center at floor(size/2). */
  pixels: Uint8ClampedArray;
}

export function patchCenter(patch: ColorPickPatch): { r: number; g: number; b: number } | null {
  const mid = Math.floor(patch.size / 2);
  const offset = (mid * patch.size + mid) * 4;
  return straightPixel(
    patch.pixels[offset],
    patch.pixels[offset + 1],
    patch.pixels[offset + 2],
    patch.pixels[offset + 3],
    false,
  );
}

export function paintPickReticle(canvas: HTMLCanvasElement, patch: ColorPickPatch): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const cell = COLOR_PICK_CELL;
  const size = patch.size;
  canvas.width = size * cell;
  canvas.height = size * cell;
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const alpha = patch.pixels[offset + 3];
      if (alpha < 16) {
        context.fillStyle = ((x + y) & 1) === 0 ? '#2a2a2a' : '#3a3a3a';
      } else {
        context.fillStyle = rgbToHex(patch.pixels[offset], patch.pixels[offset + 1], patch.pixels[offset + 2]);
      }
      context.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const mid = Math.floor(size / 2) * cell;
  context.strokeStyle = '#fff';
  context.lineWidth = 2;
  context.strokeRect(mid + 1, mid + 1, cell - 2, cell - 2);
  context.strokeStyle = '#111';
  context.lineWidth = 1;
  context.strokeRect(mid + 0.5, mid + 0.5, cell - 1, cell - 1);
  const center = mid + cell / 2;
  context.beginPath();
  context.moveTo(center, 0);
  context.lineTo(center, mid);
  context.moveTo(center, mid + cell);
  context.lineTo(center, canvas.height);
  context.moveTo(0, center);
  context.lineTo(mid, center);
  context.moveTo(mid + cell, center);
  context.lineTo(canvas.width, center);
  context.strokeStyle = 'rgba(255,255,255,0.85)';
  context.lineWidth = 1;
  context.stroke();
}

function readCanvasNeighborhood(
  context: CanvasRenderingContext2D,
  pixelX: number,
  pixelY: number,
  width: number,
  height: number,
  radius: number,
): ColorPickPatch {
  const size = radius * 2 + 1;
  const pixels = new Uint8ClampedArray(size * size * 4);
  const left = Math.max(0, pixelX - radius);
  const top = Math.max(0, pixelY - radius);
  const right = Math.min(width - 1, pixelX + radius);
  const bottom = Math.min(height - 1, pixelY + radius);
  const readWidth = right - left + 1;
  const readHeight = bottom - top + 1;
  let sample: ImageData;
  try {
    sample = context.getImageData(left, top, readWidth, readHeight);
  } catch {
    return { size, pixels };
  }
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = pixelX + dx;
      const y = pixelY + dy;
      if (x < left || y < top || x > right || y > bottom) continue;
      const source = ((y - top) * readWidth + (x - left)) * 4;
      const dest = ((dy + radius) * size + (dx + radius)) * 4;
      pixels[dest] = sample.data[source];
      pixels[dest + 1] = sample.data[source + 1];
      pixels[dest + 2] = sample.data[source + 2];
      pixels[dest + 3] = sample.data[source + 3];
    }
  }
  return { size, pixels };
}

function readWebglNeighborhood(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  pixelX: number,
  pixelY: number,
  radius: number,
  premultiplied: boolean,
): ColorPickPatch {
  const size = radius * 2 + 1;
  const left = Math.max(0, pixelX - radius);
  const top = Math.max(0, pixelY - radius);
  const right = Math.min(gl.drawingBufferWidth - 1, pixelX + radius);
  const bottom = Math.min(gl.drawingBufferHeight - 1, pixelY + radius);
  const readWidth = right - left + 1;
  const readHeight = bottom - top + 1;
  const raw = new Uint8Array(readWidth * readHeight * 4);
  const bound = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(left, gl.drawingBufferHeight - 1 - bottom, readWidth, readHeight, gl.RGBA, gl.UNSIGNED_BYTE, raw);
  if (bound) gl.bindFramebuffer(gl.FRAMEBUFFER, bound);
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = pixelX + dx;
      const y = pixelY + dy;
      if (x < left || y < top || x > right || y > bottom) continue;
      const sourceX = x - left;
      const sourceY = bottom - y;
      const source = (sourceY * readWidth + sourceX) * 4;
      const straight = straightPixel(raw[source], raw[source + 1], raw[source + 2], raw[source + 3], premultiplied);
      const dest = ((dy + radius) * size + (dx + radius)) * 4;
      if (!straight) {
        pixels[dest + 3] = 0;
        continue;
      }
      pixels[dest] = straight.r;
      pixels[dest + 1] = straight.g;
      pixels[dest + 2] = straight.b;
      pixels[dest + 3] = 255;
    }
  }
  return { size, pixels };
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
