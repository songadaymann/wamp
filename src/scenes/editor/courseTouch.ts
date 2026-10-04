import type Phaser from 'phaser';
import { EditorTouchCandidate, EditorTouchGesture, type TouchGesturePoint, type TouchEditScheduler } from './touchGesture';

type TouchAction = 'brush' | 'draw' | 'objects' | 'tap' | 'bend';

interface CourseTouchHost {
  signature(): string;
  schedule: TouchEditScheduler;
  classify(pointer: Phaser.Input.Pointer): TouchAction;
  begin(pointer: Phaser.Input.Pointer): void;
  beginBrush(worldPoint: { x: number; y: number }): void;
  beginObjects(point: TouchGesturePoint): void;
  move(pointer: Phaser.Input.Pointer): void;
  tap(pointer: Phaser.Input.Pointer): void;
  finish(pointer: Phaser.Input.Pointer, bend: boolean): void;
  cancel(): void;
  worldPoint(x: number, y: number): { x: number; y: number };
  pinch(factor: number, anchor: { x: number; y: number }, x: number, y: number): void;
}

/** Keeps multi-finger navigation separate from edits in the multi-cell workspace. */
export class CourseTouchController {
  private readonly gesture = new EditorTouchGesture();
  private action: TouchAction | null = null;
  private start: TouchGesturePoint | null = null;
  private objectsStarted = false;
  private distance = 0;
  private signature = '';
  private readonly candidate: EditorTouchCandidate;
  private anchor = { x: 0, y: 0 };

  constructor(private readonly host: CourseTouchHost) {
    this.candidate = new EditorTouchCandidate(host.schedule);
  }

  get isEditing(): boolean { return this.action !== null; }

  down(pointer: Phaser.Input.Pointer): void {
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
        this.host.pinch(distance / this.distance, this.anchor, (first.x + second.x) / 2, (first.y + second.y) / 2);
      }
      this.distance = distance;
      return;
    }
    if (result !== 'edit' || !this.action) return;
    if (this.action === 'objects' && !this.objectsStarted && this.gesture.isDrag && this.start) {
      this.host.beginObjects(this.start);
      this.objectsStarted = true;
    }
    if (this.action === 'brush') this.candidate.move(pointer);
    if (this.action === 'draw' || this.action === 'bend' || this.objectsStarted
      || (this.action === 'brush' && this.candidate.isStarted)) this.host.move(pointer);
  }

  up(pointer: Phaser.Input.Pointer): void {
    this.validate();
    const result = this.gesture.up(pointer);
    if (pointer.event?.type === 'touchcancel') {
      this.cancel();
      return;
    }
    if (result === 'ignore') return;
    if (this.action === 'brush') this.candidate.activate();
    if (this.action === 'tap' || (this.action === 'objects' && !this.objectsStarted)) {
      if (result === 'tap') this.host.tap(pointer);
    } else if (this.action) this.host.finish(pointer, this.action === 'bend');
    this.action = null;
    this.start = null;
    this.objectsStarted = false;
    this.candidate.cancel();
  }

  validate(): void {
    if (this.action && this.signature !== this.host.signature()) this.cancel();
  }

  cancel(): void {
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
