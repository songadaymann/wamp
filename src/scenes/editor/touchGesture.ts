import { editorState } from '../../config';

export interface TouchGesturePoint { id: number; x: number; y: number }

export type TouchEditScheduler = (delayMs: number, callback: () => void) => () => void;

/** A second finger can cancel a contact before even a temporary brush mark appears. */
export class EditorTouchCandidate {
  private origin = { x: 0, y: 0 };
  private begin: (() => void) | null = null;
  private cancelTimer: (() => void) | null = null;
  private started = false;

  constructor(private readonly schedule: TouchEditScheduler) {}

  get isStarted(): boolean { return this.started; }

  down(point: { x: number; y: number }, begin: () => void): void {
    this.cancel();
    this.origin = { x: point.x, y: point.y };
    this.begin = begin;
    this.cancelTimer = this.schedule(90, () => this.activate());
  }

  move(point: { x: number; y: number }): void {
    if (Math.hypot(point.x - this.origin.x, point.y - this.origin.y) > 6) this.activate();
  }

  activate(): void {
    const begin = this.begin;
    if (!begin) return;
    this.begin = null;
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.started = true;
    begin();
  }

  cancel(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.begin = null;
    this.started = false;
  }
}

/** A pinch owns every finger until all lift, even after it becomes a single touch. */
export class EditorTouchGesture {
  readonly points = new Map<number, { x: number; y: number }>();
  private primary: number | null = null;
  private pinching = false;
  private origin = { x: 0, y: 0 };
  private moved = false;

  get isDrag(): boolean { return this.moved; }

  down(point: TouchGesturePoint): 'edit' | 'pinch' | 'ignore' {
    this.points.set(point.id, { x: point.x, y: point.y });
    if (this.points.size >= 2) {
      this.pinching = true;
      this.primary = null;
      return 'pinch';
    }
    if (this.pinching) return 'ignore';
    this.primary = point.id;
    this.origin = { x: point.x, y: point.y };
    this.moved = false;
    return 'edit';
  }

  move(point: TouchGesturePoint): 'edit' | 'pinch' | 'ignore' {
    if (!this.points.has(point.id)) return 'ignore';
    this.points.set(point.id, { x: point.x, y: point.y });
    if (this.pinching) return this.points.size >= 2 ? 'pinch' : 'ignore';
    if (this.primary !== point.id) return 'ignore';
    this.moved ||= Math.hypot(point.x - this.origin.x, point.y - this.origin.y) > 10;
    return 'edit';
  }

  up(point: TouchGesturePoint): 'tap' | 'drag' | 'ignore' {
    if (!this.points.has(point.id)) return 'ignore';
    this.move(point);
    this.points.delete(point.id);
    const result = !this.pinching && this.primary === point.id
      ? this.moved ? 'drag' : 'tap'
      : 'ignore';
    if (this.points.size === 0) this.reset();
    return result;
  }

  /** Suppress the rest of an interrupted gesture without admitting its remaining finger. */
  suppress(): void {
    this.primary = null;
    this.pinching = this.points.size > 0;
  }

  reset(): void {
    this.points.clear();
    this.primary = null;
    this.pinching = false;
    this.moved = false;
  }
}

/** Changing a tool while a finger is held cancels its preview instead of mixing operations. */
export function editorTouchToolKey(): string {
  return JSON.stringify({
    tool: editorState.activeTool, mode: editorState.paletteMode, layer: editorState.activeLayer,
    selection: editorState.selection, object: editorState.selectedObjectId,
    tileset: editorState.selectedTilesetKey, tile: editorState.selectedTileGid,
    curve: editorState.lineCurve, fill: editorState.shapeFillMode,
    spray: editorState.pencilSprayMode, smart: editorState.smartMaterial,
    rectOutline: editorState.rectOutline, ellipseOutline: editorState.ellipseOutline,
    brush: editorState.pencilBrushSize, eraser: editorState.eraserBrushSize,
    spraySize: editorState.pencilSprayBrushSize, sprayRate: editorState.pencilSprayRate,
    flipX: editorState.tileFlipXMode, flipY: editorState.tileFlipYMode,
    facing: editorState.objectFacing, style: editorState.smartStyle,
  });
}
