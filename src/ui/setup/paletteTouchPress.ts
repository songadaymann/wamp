/** How long a still finger must stay down before it selects a block of tiles. */
export const PALETTE_TOUCH_HOLD_MS = 250;
/** Finger travel that still counts as a tap or a hold; anything further is a swipe. */
export const PALETTE_TOUCH_SLOP_PX = 10;

/**
 * A finger or pen on the tileset picker (F368). The picker scrolls by touch, so a finger that
 * moves is a swipe and selects nothing. A tap picks one tile. Holding still starts a block
 * selection that follows the finger, as a mouse drag does. A second finger cancels the press.
 */
export class PaletteTouchPress<Cell> {
  private press: {
    pointerId: number;
    cell: Cell;
    x: number;
    y: number;
    holding: boolean;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  constructor(private readonly onHold: (cell: Cell) => void) {}

  get active(): boolean { return this.press !== null; }
  get holding(): boolean { return this.press?.holding ?? false; }

  down(pointerId: number, cell: Cell, x: number, y: number): void {
    if (this.press) {
      this.cancel();
      return;
    }
    const press = {
      pointerId,
      cell,
      x,
      y,
      holding: false,
      timer: setTimeout(() => {
        if (this.press !== press) return;
        press.holding = true;
        this.onHold(cell);
      }, PALETTE_TOUCH_HOLD_MS),
    };
    this.press = press;
  }

  /** True while a hold is selecting a block, so the move should extend it. */
  move(pointerId: number, x: number, y: number): boolean {
    const press = this.press;
    if (!press || press.pointerId !== pointerId) return false;
    if (press.holding) return true;
    if (Math.hypot(x - press.x, y - press.y) > PALETTE_TOUCH_SLOP_PX) this.cancel();
    return false;
  }

  /** The tapped cell, or null when the press became a hold or a swipe, or was another pointer. */
  up(pointerId: number): Cell | null {
    const press = this.press;
    if (!press || press.pointerId !== pointerId) return null;
    this.cancel();
    return press.holding ? null : press.cell;
  }

  cancel(): void {
    if (this.press) clearTimeout(this.press.timer);
    this.press = null;
  }
}

/**
 * The picker's default touch handling, installed once. A hold drags the selection instead of
 * scrolling, and a long press shows no menu. A tap closes the phone sheet, so its click would land
 * on whatever was under the sheet; the canvas uses pointer events only, so it never needs the click.
 */
export function bindPaletteTouchDefaults<Cell>(canvas: HTMLCanvasElement, press: PaletteTouchPress<Cell>): () => void {
  const holdScroll = (event: TouchEvent) => { if (press.holding && event.cancelable) event.preventDefault(); };
  const holdMenu = (event: Event) => { if (press.active) event.preventDefault(); };
  const swallowClick = (event: TouchEvent) => { if (event.cancelable) event.preventDefault(); };
  canvas.addEventListener('touchmove', holdScroll, { passive: false });
  canvas.addEventListener('contextmenu', holdMenu);
  canvas.addEventListener('touchend', swallowClick, { passive: false });
  return () => {
    press.cancel();
    canvas.removeEventListener('touchmove', holdScroll);
    canvas.removeEventListener('contextmenu', holdMenu);
    canvas.removeEventListener('touchend', swallowClick);
  };
}
