import type Phaser from 'phaser';
import { ROOM_HEIGHT, ROOM_WIDTH, TILE_SIZE, editorState } from '../../config';
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

interface TileRect { minX: number; minY: number; maxX: number; maxY: number }

/** A Move-tool area selection, valid until its room cell's document changes. */
interface AreaSelection { runtime: EditorEditRuntime; rect: TileRect; revision: number }

type AreaGesture =
  | { kind: 'marquee'; pointerId: number; runtime: EditorEditRuntime; start: { x: number; y: number }; current: { x: number; y: number } }
  | { kind: 'move'; pointerId: number; selection: AreaSelection; start: { x: number; y: number }; offset: { x: number; y: number } };

/**
 * Move tool: drag an object to move it, drag empty space to select an area, and drag
 * inside the selection to move every layer and object in it. Preview only during the
 * gesture; the authored document changes once, on release.
 */
export class EditorObjectMoveController {
  private drag: DragState | null = null;
  private selection: AreaSelection | null = null;
  private area: AreaGesture | null = null;
  private overlay: Phaser.GameObjects.Graphics | null = null;
  private listening = false;
  private activeDocument: Document | null = null;
  private readonly cancelForLifecycle = () => { this.stopGesture(); };
  private readonly cancelForVisibility = () => { if (this.activeDocument?.hidden) this.stopGesture(); };
  private readonly shutdown = () => { this.destroy(); };

  constructor(private readonly scene: Phaser.Scene, private readonly host: ObjectMoveHost) {}

  get isDragging(): boolean { return Boolean(this.drag || this.area); }
  get selectedArea(): TileRect | null { return this.selection ? { ...this.selection.rect } : null; }
  get cursorOverlay(): Phaser.GameObjects.Graphics | null { return this.overlay; }

  activate(): void {
    this.reset();
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
      this.cancel(); this.clearSelection(); this.overlay?.clear();
      return;
    }
    if (this.selection && !this.area && this.selection.runtime.documentRevision !== this.selection.revision) this.clearSelection();
  }

  down(pointer: Phaser.Input.Pointer): boolean {
    this.validate();
    if (editorState.activeTool !== 'move' || !this.host.isEnabled()) return false;
    if (this.drag && this.drag.pointerId !== pointer.id) { this.cancel(); return true; }
    if (!pointer.wasTouch && !pointer.leftButtonDown()) {
      if (pointer.rightButtonDown()) { this.cancel(); return true; }
      this.stopGesture(); return false;
    }
    if (this.area && this.area.pointerId !== pointer.id) { this.cancel(); return true; }
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const runtime = this.host.getRuntimeAt(world.x, world.y);
    const tile = runtime ? this.toTile(runtime, world) : null;
    const selection = this.selection;
    if (runtime && tile && selection?.runtime === runtime && contains(selection.rect, tile)) {
      this.host.prepare(runtime);
      this.selection = selection;
      this.area = { kind: 'move', pointerId: pointer.id, selection, start: tile, offset: { x: 0, y: 0 } };
      this.host.showStatus('Moving the selection. Release to place; Escape cancels.');
      this.drawArea();
      return true;
    }
    const placed = runtime?.findPlacedObjectAt(world.x, world.y);
    if (!runtime || !tile) { this.host.showStatus('Drag an object to move it, or drag across an area to select it.'); return true; }
    if (!placed) {
      this.clearSelection();
      this.host.prepare(runtime);
      this.area = { kind: 'marquee', pointerId: pointer.id, runtime, start: tile, current: tile };
      this.drawArea();
      return true;
    }
    this.clearSelection();
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
    if (this.area) {
      if (pointer.id !== this.area.pointerId) return true;
      const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const runtime = this.area.kind === 'marquee' ? this.area.runtime : this.area.selection.runtime;
      const tile = this.toTile(runtime, world, true);
      if (this.area.kind === 'marquee') this.area.current = tile;
      else this.area.offset = { x: tile.x - this.area.start.x, y: tile.y - this.area.start.y };
      this.drawArea();
      return true;
    }
    if (!this.drag) return false;
    if (pointer.id !== this.drag.pointerId) return true;
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.drag.point = snapObjectMove(this.drag.start, { x: world.x - this.drag.pointerStart.x, y: world.y - this.drag.pointerStart.y });
    this.drawPreview();
    return true;
  }

  up(pointer: Phaser.Input.Pointer, outside = false): boolean {
    if (this.area) return this.finishArea(pointer, outside);
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
    if (this.area) { this.drawArea(); return; }
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const runtime = this.host.getRuntimeAt(world.x, world.y), placed = runtime?.findPlacedObjectAt(world.x, world.y);
    const graphics = this.getOverlay(); graphics.clear();
    this.drawSelection(graphics);
    if (runtime && placed) {
      const bounds = runtime.getPlacedObjectBounds(placed);
      graphics.lineStyle(2 / this.scene.cameras.main.zoom, 0xffd166, 1).strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    }
  }

  /** Escape: stop a drag in progress, otherwise drop the selection. */
  cancel(): boolean {
    return this.stopGesture() || this.clearSelection();
  }

  /** Stop a drag or area gesture but keep the selection (blur, resize, pan, undo). */
  stopGesture(): boolean {
    if (this.area) {
      this.area = null;
      this.redrawIdle();
      this.host.showStatus('Move cancelled.');
      return true;
    }
    if (!this.drag) return false;
    this.restoreSprite(this.drag); this.drag = null; this.overlay?.clear();
    this.host.showStatus('Move cancelled.'); return true;
  }

  /** Room changed or reloaded: stop everything and drop the selection. */
  reset(): void {
    this.stopGesture();
    this.clearSelection();
  }

  private clearSelection(): boolean {
    if (!this.selection) return false;
    this.selection = null;
    this.overlay?.clear();
    return true;
  }

  private finishArea(pointer: Phaser.Input.Pointer, outside: boolean): boolean {
    const area = this.area!;
    if (pointer.id !== area.pointerId) return true;
    const canvas = this.scene.game.canvas.getBoundingClientRect();
    const event = pointer.event as MouseEvent | TouchEvent | undefined;
    if (outside || event?.type === 'touchcancel' || pointer.x < 0 || pointer.y < 0 || pointer.x > canvas.width || pointer.y > canvas.height) {
      this.cancel();
      return true;
    }
    this.move(pointer);
    this.area = null;
    if (area.kind === 'marquee') {
      const rect = normalize(area.start, area.current);
      if (rect.minX === rect.maxX && rect.minY === rect.maxY && area.start.x === area.current.x && area.start.y === area.current.y) {
        this.redrawIdle();
        this.host.showStatus('Drag an object to move it, or drag across an area to select it.');
        return true;
      }
      this.selection = { runtime: area.runtime, rect, revision: area.runtime.documentRevision };
      this.host.showStatus(`Selected ${rect.maxX - rect.minX + 1}×${rect.maxY - rect.minY + 1}. Drag inside it to move every layer and its objects; Escape clears.`);
      this.redrawIdle();
      return true;
    }
    const { selection, offset } = area;
    if (offset.x !== 0 || offset.y !== 0) {
      const moved = selection.runtime.moveArea(selection.rect.minX, selection.rect.minY, selection.rect.maxX, selection.rect.maxY, offset.x, offset.y);
      if (moved) {
        this.selection = { runtime: selection.runtime, rect: shift(selection.rect, offset), revision: selection.runtime.documentRevision };
        this.host.showStatus('Moved the selection. Undo puts it back.');
        this.host.onChanged();
      }
    }
    this.redrawIdle();
    return true;
  }

  private toTile(runtime: EditorEditRuntime, world: { x: number; y: number }, clamp = false): { x: number; y: number } {
    const origin = runtime.getRoomOrigin();
    const x = Math.floor((world.x - origin.x) / TILE_SIZE);
    const y = Math.floor((world.y - origin.y) / TILE_SIZE);
    return clamp ? { x: Math.max(-ROOM_WIDTH, Math.min(2 * ROOM_WIDTH, x)), y: Math.max(-ROOM_HEIGHT, Math.min(2 * ROOM_HEIGHT, y)) } : { x, y };
  }

  private redrawIdle(): void {
    const graphics = this.getOverlay();
    graphics.clear();
    this.drawSelection(graphics);
  }

  private drawSelection(graphics: Phaser.GameObjects.Graphics): void {
    if (!this.selection) return;
    this.strokeTiles(graphics, this.selection.runtime, this.selection.rect, 0x7de5ff, 0.1);
  }

  private drawArea(): void {
    const area = this.area;
    const graphics = this.getOverlay().clear();
    if (!area) return;
    if (area.kind === 'marquee') {
      this.strokeTiles(graphics, area.runtime, normalize(area.start, area.current), 0x7de5ff, 0.14);
      return;
    }
    const target = shift(area.selection.rect, area.offset);
    const inRoom = target.minX >= 0 && target.minY >= 0 && target.maxX < ROOM_WIDTH && target.maxY < ROOM_HEIGHT;
    this.strokeTiles(graphics, area.selection.runtime, area.selection.rect, 0x7de5ff, 0.05);
    this.strokeTiles(graphics, area.selection.runtime, target, inRoom ? 0xffd166 : 0xff6f3c, 0.16);
  }

  private strokeTiles(graphics: Phaser.GameObjects.Graphics, runtime: EditorEditRuntime, rect: TileRect, color: number, fill: number): void {
    const origin = runtime.getRoomOrigin();
    const x = origin.x + rect.minX * TILE_SIZE, y = origin.y + rect.minY * TILE_SIZE;
    const width = (rect.maxX - rect.minX + 1) * TILE_SIZE, height = (rect.maxY - rect.minY + 1) * TILE_SIZE;
    graphics.fillStyle(color, fill).fillRect(x, y, width, height);
    graphics.lineStyle(2 / this.scene.cameras.main.zoom, color, 1).strokeRect(x, y, width, height);
  }

  destroy(): void {
    this.reset(); this.overlay?.destroy(); this.overlay = null;
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

function normalize(a: { x: number; y: number }, b: { x: number; y: number }): TileRect {
  return {
    minX: Math.max(0, Math.min(a.x, b.x)),
    minY: Math.max(0, Math.min(a.y, b.y)),
    maxX: Math.min(ROOM_WIDTH - 1, Math.max(a.x, b.x)),
    maxY: Math.min(ROOM_HEIGHT - 1, Math.max(a.y, b.y)),
  };
}

function contains(rect: TileRect, tile: { x: number; y: number }): boolean {
  return tile.x >= rect.minX && tile.x <= rect.maxX && tile.y >= rect.minY && tile.y <= rect.maxY;
}

function shift(rect: TileRect, offset: { x: number; y: number }): TileRect {
  return { minX: rect.minX + offset.x, minY: rect.minY + offset.y, maxX: rect.maxX + offset.x, maxY: rect.maxY + offset.y };
}
