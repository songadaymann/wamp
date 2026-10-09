export interface MusicCell { step: number; row: number }
export interface MusicTouchPoint { x: number; y: number }
export type TouchMusicTool = 'pencil' | 'eraser' | 'copy';

interface TouchMusicGestureHost {
  cellAt(point: MusicTouchPoint): MusicCell | null;
  pan(dx: number, dy: number): void;
  pinch(ratio: number, from: MusicTouchPoint, to: MusicTouchPoint): void;
  preview(cells: readonly MusicCell[]): void;
  commit(cells: readonly MusicCell[], tool: TouchMusicTool): void;
}

const TAP_SLOP = 8;
const sameCell = (a: MusicCell, b: MusicCell) => a.step === b.step && a.row === b.row;
const midpoint = (a: MusicTouchPoint, b: MusicTouchPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: MusicTouchPoint, b: MusicTouchPoint) => Math.hypot(a.x - b.x, a.y - b.y);

/** No draft changes until all contacts release. Pinch owns the rest of a gesture. */
export class TouchMusicGesture {
  private points = new Map<number, MusicTouchPoint>();
  private start: MusicTouchPoint | null = null;
  private cells: MusicCell[] = [];
  private moved = false;
  private suppressed = false;
  private draw = false;
  private tool: TouchMusicTool = 'pencil';

  constructor(private readonly host: TouchMusicGestureHost) {}

  down(id: number, point: MusicTouchPoint, tool: TouchMusicTool, draw: boolean): void {
    this.points.set(id, point);
    if (this.points.size > 1) {
      this.suppressed = true;
      this.cells = [];
      this.host.preview([]);
      return;
    }
    if (this.suppressed) return;
    this.start = point;
    this.moved = false;
    this.tool = tool;
    this.draw = draw || tool === 'copy';
    const cell = this.host.cellAt(point);
    this.cells = cell ? [cell] : [];
    this.host.preview(this.draw ? this.cells : []);
  }

  move(id: number, point: MusicTouchPoint): void {
    const previous = this.points.get(id);
    if (!previous) return;
    const before = [...this.points.values()];
    this.points.set(id, point);
    if (this.points.size === 2) {
      const after = [...this.points.values()];
      const oldDistance = distance(before[0], before[1]);
      if (oldDistance >= 8) this.host.pinch(distance(after[0], after[1]) / oldDistance, midpoint(before[0], before[1]), midpoint(after[0], after[1]));
      return;
    }
    if (this.suppressed || this.points.size !== 1 || !this.start) return;
    if (distance(this.start, point) > TAP_SLOP) this.moved = true;
    if (!this.draw || !this.cells.length) {
      if (this.moved) this.host.pan(previous.x - point.x, previous.y - point.y);
      return;
    }
    const cell = this.host.cellAt(point);
    const last = this.cells.at(-1)!;
    if (!cell || sameCell(last, cell)) return;
    // Fast swipes must also visit the intervening steps, so opt-in ties stay continuous.
    const count = Math.max(Math.abs(cell.step - last.step), Math.abs(cell.row - last.row));
    for (let i = 1; i <= count; i++) {
      this.cells.push({ step: Math.round(last.step + (cell.step - last.step) * i / count), row: Math.round(last.row + (cell.row - last.row) * i / count) });
    }
    this.host.preview(this.cells);
  }

  up(id: number, cancelled = false): void {
    if (!this.points.has(id)) return;
    this.points.delete(id);
    if (cancelled) {
      this.suppressed = true;
      this.cells = [];
      this.host.preview([]);
    }
    if (this.points.size) return;
    const cells = this.cells;
    const shouldCommit = !this.suppressed && cells.length > 0 && (this.draw || !this.moved);
    const tool = this.tool;
    this.cancel();
    if (shouldCommit) this.host.commit(cells, tool);
  }

  cancel(): void {
    this.points.clear();
    this.cells = [];
    this.start = null;
    this.suppressed = false;
    this.host.preview([]);
  }
}

export const TOUCH_MUSIC_MIN_CELL_SIZE = 44;
export const TOUCH_MUSIC_MAX_CELL_SIZE = 88;
export const TOUCH_MUSIC_LABEL_WIDTH = 48;
export const TOUCH_MUSIC_HEADER_HEIGHT = 32;

export function planTouchMusicZoom(size: number, ratio: number, scroll: MusicTouchPoint, from: MusicTouchPoint, to = from) {
  const nextSize = Math.max(TOUCH_MUSIC_MIN_CELL_SIZE, Math.min(TOUCH_MUSIC_MAX_CELL_SIZE, size * ratio));
  const column = Math.max(0, (scroll.x + from.x - TOUCH_MUSIC_LABEL_WIDTH) / size);
  const row = Math.max(0, (scroll.y + from.y - TOUCH_MUSIC_HEADER_HEIGHT) / size);
  return {
    size: nextSize,
    scroll: {
      x: Math.max(0, TOUCH_MUSIC_LABEL_WIDTH + column * nextSize - to.x),
      y: Math.max(0, TOUCH_MUSIC_HEADER_HEIGHT + row * nextSize - to.y),
    },
  };
}
