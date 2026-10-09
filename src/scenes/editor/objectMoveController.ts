import type Phaser from 'phaser';
import { editorState } from '../../config';
import type { EditorEditRuntime } from './editRuntime';
import { snapObjectMove } from './objectMovement';

interface ObjectMoveHost {
  isEnabled(): boolean;
  getRuntimeAt(worldX: number, worldY: number): EditorEditRuntime | null;
  prepare(runtime: EditorEditRuntime): void;
  showStatus(message: string): void;
  onChanged(): void;
  onOverlayCreated?(graphics: Phaser.GameObjects.Graphics): void;
}

interface DragState {
  pointerId: number;
  runtime: EditorEditRuntime;
  instanceId: string;
  start: { x: number; y: number };
  pointerStart: { x: number; y: number };
  point: { x: number; y: number };
  sprite: Phaser.GameObjects.Sprite | null;
  spriteStart: { x: number; y: number } | null;
  bounds: { x: number; y: number; width: number; height: number };
}

/** Preview only during the gesture. The authored document changes once, on release. */
export class EditorObjectMoveController {
  private drag: DragState | null = null;
  private overlay: Phaser.GameObjects.Graphics | null = null;
  private listening = false;
  private activeDocument: Document | null = null;
  private readonly cancelForLifecycle = () => { this.cancel(); };
  private readonly cancelForVisibility = () => { if (this.activeDocument?.hidden) this.cancel(); };
  private readonly shutdown = () => { this.destroy(); };

  constructor(private readonly scene: Phaser.Scene, private readonly host: ObjectMoveHost) {}

  get isDragging(): boolean { return Boolean(this.drag); }
  get cursorOverlay(): Phaser.GameObjects.Graphics | null { return this.overlay; }

  activate(): void {
    this.cancel();
    if (this.listening) return;
    this.listening = true;
    this.activeDocument = this.scene.game.canvas.ownerDocument ?? null;
    this.activeDocument?.addEventListener('visibilitychange', this.cancelForVisibility);
    this.activeDocument?.defaultView?.addEventListener('blur', this.cancelForLifecycle);
    this.scene.game.events.on('blur', this.cancelForLifecycle);
    this.scene.events.on('sleep', this.cancelForLifecycle);
    this.scene.events.on('pause', this.cancelForLifecycle);
    this.scene.scale.on('resize', this.cancelForLifecycle);
    this.scene.events.once('shutdown', this.shutdown);
  }

  validate(): void {
    if (editorState.activeTool !== 'move' || !this.host.isEnabled()) {
      this.cancel(); this.overlay?.clear();
    }
  }

  down(pointer: Phaser.Input.Pointer): boolean {
    this.validate();
    if (editorState.activeTool !== 'move' || !this.host.isEnabled()) return false;
    if (this.drag && this.drag.pointerId !== pointer.id) { this.cancel(); return true; }
    if (!pointer.wasTouch && !pointer.leftButtonDown()) { this.cancel(); return pointer.rightButtonDown(); }
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const runtime = this.host.getRuntimeAt(world.x, world.y);
    const placed = runtime?.findPlacedObjectAt(world.x, world.y);
    if (!runtime || !placed) { this.host.showStatus('Drag an object to move it. Settings and links stay attached.'); return true; }
    this.host.prepare(runtime);
    const sprite = runtime.getPlacedObjectSprite(placed.instanceId);
    const bounds = runtime.getPlacedObjectBounds(placed);
    this.drag = {
      pointerId: pointer.id, runtime, instanceId: placed.instanceId,
      start: { x: placed.x, y: placed.y }, point: { x: placed.x, y: placed.y }, pointerStart: world,
      sprite, spriteStart: sprite ? { x: sprite.x, y: sprite.y } : null,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    };
    this.host.showStatus('Moving object. Release to place; Escape cancels.');
    this.drawPreview();
    return true;
  }

  move(pointer: Phaser.Input.Pointer): boolean {
    this.validate();
    if (!this.drag) return false;
    if (pointer.id !== this.drag.pointerId) return true;
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.drag.point = snapObjectMove(this.drag.start, { x: world.x - this.drag.pointerStart.x, y: world.y - this.drag.pointerStart.y });
    this.drawPreview();
    return true;
  }

  up(pointer: Phaser.Input.Pointer, outside = false): boolean {
    if (!this.drag) return false;
    if (pointer.id !== this.drag.pointerId) return true;
    this.validate();
    if (!this.drag) return true;
    const canvas = this.scene.game.canvas.getBoundingClientRect();
    const event = pointer.event as MouseEvent | TouchEvent | undefined;
    const cancelled = outside || event?.type === 'touchcancel' || pointer.x < 0 || pointer.y < 0 || pointer.x > canvas.width || pointer.y > canvas.height;
    if (cancelled) { this.cancel(); return true; }
    this.move(pointer);
    const drag = this.drag;
    this.restoreSprite(drag);
    this.drag = null; this.overlay?.clear();
    const origin = drag.runtime.getRoomOrigin();
    if (this.host.getRuntimeAt(origin.x + drag.point.x, origin.y + drag.point.y) !== drag.runtime) {
      this.host.showStatus('Move within this room cell.'); return true;
    }
    const changed = drag.runtime.movePlacedObject(drag.instanceId, drag.point, drag.start);
    if (changed) { this.host.showStatus('Object moved. Settings and links kept.'); this.host.onChanged(); }
    return true;
  }

  hover(pointer: Phaser.Input.Pointer): void {
    this.validate();
    if (editorState.activeTool !== 'move' || !this.host.isEnabled()) return;
    if (this.drag) { this.drawPreview(); return; }
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const runtime = this.host.getRuntimeAt(world.x, world.y), placed = runtime?.findPlacedObjectAt(world.x, world.y);
    const graphics = this.getOverlay(); graphics.clear();
    if (runtime && placed) {
      const bounds = runtime.getPlacedObjectBounds(placed);
      graphics.lineStyle(2 / this.scene.cameras.main.zoom, 0xffd166, 1).strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    }
  }

  cancel(): boolean {
    if (!this.drag) return false;
    this.restoreSprite(this.drag); this.drag = null; this.overlay?.clear();
    this.host.showStatus('Move cancelled.'); return true;
  }

  destroy(): void {
    this.cancel(); this.overlay?.destroy(); this.overlay = null;
    this.scene.game.events.off('blur', this.cancelForLifecycle);
    this.scene.events.off('sleep', this.cancelForLifecycle);
    this.scene.events.off('pause', this.cancelForLifecycle);
    this.scene.scale.off('resize', this.cancelForLifecycle);
    this.activeDocument?.removeEventListener('visibilitychange', this.cancelForVisibility);
    this.activeDocument?.defaultView?.removeEventListener('blur', this.cancelForLifecycle);
    this.activeDocument = null;
    this.scene.events.off('shutdown', this.shutdown);
    this.listening = false;
  }

  private getOverlay(): Phaser.GameObjects.Graphics {
    if (!this.overlay) {
      this.overlay = this.scene.add.graphics().setDepth(210);
      this.host.onOverlayCreated?.(this.overlay);
    }
    return this.overlay;
  }

  private restoreSprite(drag: DragState): void {
    if (drag.sprite?.active && drag.spriteStart) drag.sprite.setPosition(drag.spriteStart.x, drag.spriteStart.y);
  }

  private drawPreview(): void {
    const drag = this.drag;
    if (!drag) return;
    const dx = drag.point.x - drag.start.x, dy = drag.point.y - drag.start.y;
    if (drag.sprite?.active && drag.spriteStart) drag.sprite.setPosition(drag.spriteStart.x + dx, drag.spriteStart.y + dy);
    const origin = drag.runtime.getRoomOrigin();
    const valid = this.host.getRuntimeAt(origin.x + drag.point.x, origin.y + drag.point.y) === drag.runtime;
    this.getOverlay().clear().lineStyle(2 / this.scene.cameras.main.zoom, valid ? 0xffd166 : 0xff6f3c, 1).strokeRect(drag.bounds.x + dx, drag.bounds.y + dy, drag.bounds.width, drag.bounds.height);
  }
}
