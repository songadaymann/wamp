import type Phaser from 'phaser';
import { EditorTouchGesture } from './touchGesture';

interface ComposerTouchHost {
  beginPan(point: { x: number; y: number }): void;
  pan(point: { x: number; y: number }): void;
  worldPoint(x: number, y: number): { x: number; y: number };
  pinch(factor: number, anchor: { x: number; y: number }, x: number, y: number): void;
  select(pointer: Phaser.Input.Pointer): void;
  /** A drag or pinch ended: load the rooms around the new view. */
  settle(): void;
}

/**
 * Expanded Room setup map on a touch screen: one finger drags the map, two pinch-zoom and pan
 * it, and only a tap picks a cell (F365).
 */
export class ComposerTouchController {
  private readonly gesture = new EditorTouchGesture();
  private distance = 0;
  private anchor = { x: 0, y: 0 };
  private pair = '';
  private panning = false;
  private moved = false;

  constructor(private readonly host: ComposerTouchHost) {}

  down(pointer: Phaser.Input.Pointer): void {
    const result = this.gesture.down(pointer);
    if (result === 'edit') this.panning = false;
    if (result === 'pinch') this.startPinch();
  }

  move(pointer: Phaser.Input.Pointer): void {
    const result = this.gesture.move(pointer);
    if (result === 'pinch') {
      // A lifted finger can leave a new pair (2 and 3 of three): measure it afresh.
      if (this.pairKey() !== this.pair) {
        this.startPinch();
        return;
      }
      const [first, second] = [...this.gesture.points.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      if (this.distance > 0 && distance > 0) {
        this.host.pinch(distance / this.distance, this.anchor, (first.x + second.x) / 2, (first.y + second.y) / 2);
        this.moved = true;
      }
      this.distance = distance;
    } else if (result === 'edit' && this.gesture.isDrag) {
      // The drag starts where the finger crosses the tap threshold, so the map never jumps.
      if (this.panning) this.host.pan(pointer);
      else this.host.beginPan(pointer);
      this.panning = true;
      this.moved = true;
    }
  }

  /** A release outside the canvas or a cancelled touch still ends the gesture, but never selects. */
  up(pointer: Phaser.Input.Pointer, outside = false): void {
    const result = this.gesture.up(pointer);
    if (result === 'tap' && !outside && pointer.event?.type !== 'touchcancel') this.host.select(pointer);
    if (this.gesture.points.size > 0 || !this.moved) return;
    this.moved = false;
    this.host.settle();
  }

  reset(): void {
    this.gesture.reset();
    this.panning = false;
    this.moved = false;
  }

  private pairKey(): string {
    return [...this.gesture.points.keys()].slice(0, 2).join(':');
  }

  private startPinch(): void {
    const [first, second] = [...this.gesture.points.values()];
    this.pair = this.pairKey();
    this.distance = Math.hypot(first.x - second.x, first.y - second.y);
    this.anchor = this.host.worldPoint((first.x + second.x) / 2, (first.y + second.y) / 2);
  }
}

export interface ScreenRect { left: number; top: number; width: number; height: number }
export interface MapArea { x: number; y: number; width: number; height: number }

/**
 * The part of the map the setup panel leaves in view, in camera pixels: the largest strip
 * beside it. That is the strip above the phone sheet and the one right of the desktop column.
 * A bar across the top of that strip, such as the phone account controls, is left out too.
 */
export function uncoveredMapArea(canvas: ScreenRect, panel: ScreenRect | null, viewWidth: number, viewHeight: number,
  topBar: ScreenRect | null = null): MapArea {
  if (canvas.width <= 0 || canvas.height <= 0) return { x: 0, y: 0, width: viewWidth, height: viewHeight };
  let area = { x: 0, y: 0, width: canvas.width, height: canvas.height };
  if (panel && panel.width > 0 && panel.height > 0) {
    const left = Math.max(0, panel.left - canvas.left);
    const right = Math.min(canvas.width, panel.left + panel.width - canvas.left);
    const top = Math.max(0, panel.top - canvas.top);
    const bottom = Math.min(canvas.height, panel.top + panel.height - canvas.top);
    const best = right <= left || bottom <= top ? area : [
      { x: 0, y: 0, width: canvas.width, height: top },
      { x: 0, y: bottom, width: canvas.width, height: canvas.height - bottom },
      { x: 0, y: 0, width: left, height: canvas.height },
      { x: right, y: 0, width: canvas.width - right, height: canvas.height },
    ].reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
    if (best.width > 0 && best.height > 0) area = best;
  }
  if (topBar && topBar.width > 0 && topBar.height > 0) {
    const overlap = Math.min(area.x + area.width, topBar.left + topBar.width - canvas.left) - Math.max(area.x, topBar.left - canvas.left);
    const barBottom = topBar.top + topBar.height - canvas.top;
    if (overlap >= area.width / 2 && barBottom > area.y && barBottom < area.y + area.height / 2) {
      area = { ...area, y: barBottom, height: area.y + area.height - barBottom };
    }
  }
  const scaleX = viewWidth / canvas.width;
  const scaleY = viewHeight / canvas.height;
  return { x: area.x * scaleX, y: area.y * scaleY, width: area.width * scaleX, height: area.height * scaleY };
}
