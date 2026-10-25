import Phaser from 'phaser';
import {
  dragTriangleHandle,
  hitTriangleHandle,
  triangleHandlePoints,
  type TriangleHandle,
} from '../../config/trianglePiece';

export interface TriangleHandleGeometry {
  instanceId: string;
  anchorX: number;
  anchorY: number;
  legX: number;
  legY: number;
}

export interface TriangleHandleHost {
  selected(): TriangleHandleGeometry | null;
  pick(worldX: number, worldY: number): TriangleHandleGeometry | null;
  hitRadius(): number;
  begin(instanceId: string): void;
  apply(instanceId: string, next: TriangleHandleGeometry): void;
  commit(): void;
}

export class TriangleHandleController {
  private drag: {
    instanceId: string;
    handle: TriangleHandle;
    start: TriangleHandleGeometry;
    pointerX: number;
    pointerY: number;
  } | null = null;

  constructor(private readonly host: TriangleHandleHost) {}

  down(worldX: number, worldY: number): boolean {
    const geometry = this.host.selected() ?? this.host.pick(worldX, worldY);
    if (!geometry) return false;
    const handle = hitTriangleHandle(
      geometry.anchorX,
      geometry.anchorY,
      geometry.legX,
      geometry.legY,
      worldX,
      worldY,
      this.host.hitRadius(),
    );
    if (!handle) return false;
    this.host.begin(geometry.instanceId);
    this.drag = {
      instanceId: geometry.instanceId,
      handle,
      start: geometry,
      pointerX: worldX,
      pointerY: worldY,
    };
    return true;
  }

  move(worldX: number, worldY: number): boolean {
    if (!this.drag) return false;
    const next = dragTriangleHandle(
      this.drag.start,
      this.drag.handle,
      worldX,
      worldY,
      this.drag.pointerX,
      this.drag.pointerY,
    );
    this.host.apply(this.drag.instanceId, { instanceId: this.drag.instanceId, ...next });
    return true;
  }

  up(): void {
    if (!this.drag) return;
    this.drag = null;
    this.host.commit();
  }

  draw(graphics: Phaser.GameObjects.Graphics | null | undefined): void {
    const geometry = this.host.selected();
    if (!graphics || !geometry) return;
    const radius = Math.max(3, this.host.hitRadius() * 0.45);
    for (const point of triangleHandlePoints(geometry.anchorX, geometry.anchorY, geometry.legX, geometry.legY)) {
      const corner = point.id === 'anchor' || point.id.endsWith('Corner');
      graphics.fillStyle(corner ? 0xfff4c2 : 0x7ec8ff, 0.95);
      graphics.fillCircle(point.x, point.y, radius);
      graphics.lineStyle(1, 0x1c2430, 0.9);
      graphics.strokeCircle(point.x, point.y, radius);
    }
  }
}
