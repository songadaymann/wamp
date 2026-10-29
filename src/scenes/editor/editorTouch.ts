import type Phaser from 'phaser';
import { EditorTouchCandidate, EditorTouchGesture, type TouchGesturePoint, type TouchEditScheduler } from './touchGesture';

type TouchAction = 'brush' | 'draw' | 'objects' | 'tap' | 'bend' | 'move';

/** The Move tool, which claims a first finger only while it is the active tool. */
interface TouchMoveTool {
  claims(): boolean;
  down(pointer: Phaser.Input.Pointer, at?: { x: number; y: number }): boolean;
  move(pointer: Phaser.Input.Pointer): boolean;
  up(pointer: Phaser.Input.Pointer, outside?: boolean): boolean;
  stopGesture(): boolean;
}

interface EditorTouchHost {
  signature(): string;
  isEnabled?: () => boolean;
  schedule: TouchEditScheduler;
  classify(pointer: Phaser.Input.Pointer): TouchAction | null;
  begin(pointer: Phaser.Input.Pointer): void;
  beginBrush(worldPoint: { x: number; y: number }): void;
  beginObjects(point: TouchGesturePoint): void;
  move(pointer: Phaser.Input.Pointer): void;
  tap(pointer: Phaser.Input.Pointer): void;
  finish(pointer: Phaser.Input.Pointer, bend: boolean, tap: boolean): void;
  cancel(): void;
  worldPoint(x: number, y: number): { x: number; y: number };
  pinchThreshold?: number;
  pinch(factor: number, anchor: { x: number; y: number }, x: number, y: number): void;
  moveTool: TouchMoveTool;
}

/** Shared touch arbitration for single-room and multi-cell editing workspaces. */
export class EditorTouchController {
  private readonly gesture = new EditorTouchGesture();
  private action: TouchAction | null = null;
  private start: TouchGesturePoint | null = null;
  private objectsStarted = false;
  private distance = 0;
  private signature = '';
  private readonly candidate: EditorTouchCandidate;
  private anchor = { x: 0, y: 0 };

  constructor(private readonly host: EditorTouchHost) {
    this.candidate = new EditorTouchCandidate(host.schedule);
  }

  get isEditing(): boolean { return this.action !== null; }
  get actionKind(): TouchAction | null { return this.action; }

  down(pointer: Phaser.Input.Pointer): void {
    if (this.host.isEnabled?.() === false) return;
    const result = this.gesture.down(pointer);
    if (result === 'pinch') {
      this.cancel();
      const pair = [...this.gesture.points.values()].slice(0, 2);
      this.distance = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
      this.anchor = this.host.worldPoint((pair[0].x + pair[1].x) / 2, (pair[0].y + pair[1].y) / 2);
      return;
    }
    if (result !== 'edit') return;
    this.start = { id: pointer.id, x: pointer.x, y: pointer.y };
    // Move starts only once the finger drags or holds, so a second finger can still pinch
    // before Move drops the selection or switches the selected cell (F371).
    if (this.host.moveTool.claims()) {
      const start = { x: pointer.x, y: pointer.y };
      this.action = 'move';
      this.signature = this.host.signature();
      this.candidate.down(pointer, () => {
        this.validate();
        if (this.action !== 'move') return;
        this.host.moveTool.down(pointer, start);
        this.signature = this.host.signature();
      });
      return;
    }
    this.signature = this.host.signature();
    this.action = this.host.classify(pointer);
    if (this.action === 'draw') this.host.begin(pointer);
    else if (this.action === 'brush') {
      const world = this.host.worldPoint(pointer.x, pointer.y);
      this.candidate.down(pointer, () => {
        this.validate();
        if (this.action === 'brush') this.host.beginBrush(world);
      });
    }
    else if (this.action === 'bend') this.host.move(pointer);
  }

  move(pointer: Phaser.Input.Pointer): void {
    this.validate();
    const result = this.gesture.move(pointer);
    if (result === 'pinch') {
      const [first, second] = [...this.gesture.points.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      if (this.distance > 0 && distance > 0) {
        const factor = distance / this.distance;
        const threshold = this.host.pinchThreshold ?? 0;
        const zooming = Math.abs(factor - 1) > threshold;
        this.host.pinch(zooming ? factor : 1, this.anchor, (first.x + second.x) / 2, (first.y + second.y) / 2);
        if (zooming || threshold === 0) this.distance = distance;
      } else this.distance = distance;
      return;
    }
    if (result !== 'edit' || !this.action) return;
    if (this.action === 'move') {
      this.candidate.move(pointer);
      if (this.candidate.isStarted) this.host.moveTool.move(pointer);
      return;
    }
    if (this.action === 'objects' && !this.objectsStarted && this.gesture.isDrag && this.start) {
      this.host.beginObjects(this.start);
      this.objectsStarted = true;
    }
    if (this.action === 'brush') this.candidate.move(pointer);
    if (this.action === 'draw' || this.action === 'bend' || this.objectsStarted
      || (this.action === 'brush' && this.candidate.isStarted)) this.host.move(pointer);
  }

  up(pointer: Phaser.Input.Pointer, outside = false): void {
    this.validate();
    const result = this.gesture.up(pointer);
    if (pointer.event?.type === 'touchcancel') {
      this.cancel();
      return;
    }
    if (result === 'ignore') return;
    if (this.action === 'brush' || this.action === 'move') this.candidate.activate();
    if (this.action === 'move') this.host.moveTool.up(pointer, outside);
    else if (this.action === 'tap' || (this.action === 'objects' && !this.objectsStarted)) {
      if (result === 'tap') this.host.tap(pointer);
    } else if (this.action) this.host.finish(pointer, this.action === 'bend', result === 'tap');
    this.action = null;
    this.start = null;
    this.objectsStarted = false;
    this.candidate.cancel();
  }

  validate(): void {
    if (this.action && (this.host.isEnabled?.() === false || this.signature !== this.host.signature())) this.cancel();
  }

  cancel(): void {
    if (this.action === 'move') this.host.moveTool.stopGesture();
    this.candidate.cancel();
    this.host.cancel();
    this.gesture.suppress();
    this.action = null;
    this.start = null;
    this.objectsStarted = false;
  }

  reset(): void {
    this.candidate.cancel();
    this.gesture.reset();
    this.action = null;
    this.start = null;
    this.objectsStarted = false;
  }
}
