/** How long a still finger must stay down before it selects a block of tiles, as a platform long press. */
export const PALETTE_TOUCH_HOLD_MS = 400;
/** Finger travel that still counts as a tap or a hold; anything further is a swipe. */
export const PALETTE_TOUCH_SLOP_PX = 10;
/** A touch this soon after the picker scrolled only stops the scroll, as in a native list. */
export const PALETTE_TOUCH_FLING_STOP_MS = 120;

/**
 * A finger or pen on the tileset picker (F368). The picker scrolls by touch, so a finger that
 * moves is a swipe and selects nothing. A tap picks one tile. Holding still starts a block
 * selection that follows the finger, as a mouse drag does. A second finger cancels the press,
 * and the block of a hold in progress.
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
  private lastScrollAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly onHold: (cell: Cell, pointerId: number) => void,
    private readonly onHoldCancelled: () => void = () => {},
  ) {}

  get active(): boolean { return this.press !== null; }
  get holding(): boolean { return this.press?.holding ?? false; }

  /** The picker or a list around it scrolled. */
  noteScroll(): void { this.lastScrollAt = Date.now(); }

  down(pointerId: number, cell: Cell, x: number, y: number): void {
    if (this.press) {
      this.interrupt();
      return;
    }
    if (Date.now() - this.lastScrollAt < PALETTE_TOUCH_FLING_STOP_MS) return;
    const press = {
      pointerId,
      cell,
      x,
      y,
      holding: false,
      timer: setTimeout(() => {
        if (this.press !== press) return;
        press.holding = true;
        this.onHold(cell, pointerId);
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

  /** Another finger touched the screen: drop the press, and the block of a hold in progress. */
  interrupt(): void {
    const wasHolding = this.holding;
    this.cancel();
    if (wasHolding) this.onHoldCancelled();
  }
}

/**
 * The picker's default touch handling, installed once. A hold drags the selection instead of
 * scrolling, and a long press shows no menu. A tap closes the phone sheet, so its click would land
 * on whatever was under the sheet; the canvas uses pointer events only, so it never needs the click.
 * The body's data-last-pointer lets the picker hint follow the input in use, on touchscreen laptops too.
 */
export function bindPaletteTouchDefaults<Cell>(canvas: HTMLCanvasElement, press: PaletteTouchPress<Cell>): () => void {
  const doc = canvas.ownerDocument;
  const holdScroll = (event: TouchEvent) => { if (press.holding && event.cancelable) event.preventDefault(); };
  const holdMenu = (event: Event) => { if (press.active) event.preventDefault(); };
  const swallowClick = (event: TouchEvent) => { if (event.cancelable) event.preventDefault(); };
  const noteScroll = (event: Event) => { if (event.target instanceof Element && event.target.contains(canvas)) press.noteScroll(); };
  const notePointer = (event: PointerEvent) => { doc.body.dataset.lastPointer = event.pointerType; };
  // A second finger may land anywhere, even outside a short landscape sheet.
  const secondFinger = (event: TouchEvent) => { if (event.touches.length > 1) press.interrupt(); };
  canvas.addEventListener('touchmove', holdScroll, { passive: false });
  canvas.addEventListener('contextmenu', holdMenu);
  canvas.addEventListener('touchend', swallowClick, { passive: false });
  doc.addEventListener('scroll', noteScroll, { capture: true, passive: true });
  doc.addEventListener('pointerdown', notePointer, { capture: true, passive: true });
  doc.addEventListener('touchstart', secondFinger, { capture: true, passive: true });
  return () => {
    press.cancel();
    canvas.removeEventListener('touchmove', holdScroll);
    canvas.removeEventListener('contextmenu', holdMenu);
    canvas.removeEventListener('touchend', swallowClick);
    doc.removeEventListener('scroll', noteScroll, { capture: true });
    doc.removeEventListener('pointerdown', notePointer, { capture: true });
    doc.removeEventListener('touchstart', secondFinger, { capture: true });
  };
}
