import type Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import { RETRO_COLORS } from '../../visuals/starfield';
import { iterateShapeTiles, type EditorShapeKind, type TilePoint } from './shapeTiles';

export interface EditorPathBend<T> {
  target: T;
  start: TilePoint;
  end: TilePoint;
  mid: TilePoint;
  erase: boolean;
}

/** Shape state is local to its starting slice, even while the pointer visits another. */
export class EditorPathBendController<T> {
  private current: EditorPathBend<T> | null = null;
  constructor(private readonly host: {
    preview(bend: EditorPathBend<T>): void;
    stamp(bend: EditorPathBend<T>): void;
    finish(): void;
  }) {}

  get bend(): EditorPathBend<T> | null { return this.current; }
  clear(): void { this.current = null; }

  begin(target: T, start: TilePoint, end: TilePoint, erase: boolean): void {
    this.current = { target, start: { ...start }, end: { ...end }, erase,
      mid: { x: Math.round((start.x + end.x) / 2), y: Math.round((start.y + end.y) / 2) } };
    this.host.preview(this.current);
  }

  update(mid: TilePoint): void {
    if (!this.current) return;
    this.current.mid = { ...mid };
    this.host.preview(this.current);
  }

  resolve(left: boolean, right: boolean): boolean {
    if (!this.current || (!left && !right)) return false;
    // The matching button commits; the other cancels. Touch commits explicitly.
    if (right ? this.current.erase : !this.current.erase) this.host.stamp(this.current);
    this.clear(); this.host.finish();
    return true;
  }

  commit(): void {
    if (!this.current) return;
    this.host.stamp(this.current);
    this.clear(); this.host.finish();
  }
}

export function drawEditorShapePreview(
  graphics: Phaser.GameObjects.Graphics | null, kind: EditorShapeKind,
  start: TilePoint, end: TilePoint,
  options: { origin?: TilePoint; mid?: TilePoint; outline: boolean; copy: boolean },
): void {
  graphics?.clear();
  if (!graphics) return;
  const origin = options.origin ?? { x: 0, y: 0 };
  const minX = Math.min(start.x, end.x), minY = Math.min(start.y, end.y);
  const width = (Math.abs(end.x - start.x) + 1) * TILE_SIZE;
  const height = (Math.abs(end.y - start.y) + 1) * TILE_SIZE;
  graphics.fillStyle(RETRO_COLORS.draft, options.copy || !options.outline ? 0.15 : 0.22);
  if (options.copy || (kind === 'rect' && !options.outline)) {
    graphics.fillRect(origin.x + minX * TILE_SIZE, origin.y + minY * TILE_SIZE, width, height);
  } else {
    for (const tile of iterateShapeTiles(kind, start.x, start.y, end.x, end.y, options.outline, options.mid)) {
      graphics.fillRect(origin.x + tile.x * TILE_SIZE, origin.y + tile.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
  if (kind !== 'line' && kind !== 'curve') {
    graphics.lineStyle(1, RETRO_COLORS.draft, 0.65);
    graphics.strokeRect(origin.x + minX * TILE_SIZE, origin.y + minY * TILE_SIZE, width, height);
  }
}
