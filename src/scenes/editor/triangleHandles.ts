import Phaser from 'phaser';
import { editorState } from '../../config';
import {
  dragTriangleHandle,
  hitTriangleHandle,
  triangleHandleMotion,
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
  hitRadius(): number;
  begin(instanceId: string): void;
  apply(instanceId: string, next: TriangleHandleGeometry): void;
  commit(): void;
}

function handleHalf(hitRadius: number): number {
  return Math.max(6, hitRadius * 0.7);
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
    if (editorState.trianglePaintMode) return false;
    const geometry = this.host.selected();
    if (!geometry) return false;
    const handle = hitTriangleHandle(
      geometry.anchorX,
      geometry.anchorY,
      geometry.legX,
      geometry.legY,
      worldX,
      worldY,
      handleHalf(this.host.hitRadius()),
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
    if (editorState.trianglePaintMode) return;
    const geometry = this.host.selected();
    if (!graphics || !geometry) return;
    const half = handleHalf(this.host.hitRadius());
    for (const point of triangleHandlePoints(geometry.anchorX, geometry.anchorY, geometry.legX, geometry.legY)) {
      drawHandleIcon(graphics, point.x, point.y, half, triangleHandleMotion(point.id), point.id === 'anchor');
    }
  }
}

function drawHandleIcon(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  half: number,
  motion: 'move' | 'vertical' | 'horizontal',
  anchor: boolean,
): void {
  const size = half * 2;
  graphics.fillStyle(anchor ? 0xfff4c2 : 0x7ec8ff, 0.96);
  graphics.fillRect(x - half, y - half, size, size);
  graphics.lineStyle(1, 0x1c2430, 0.95);
  graphics.strokeRect(x - half, y - half, size, size);
  graphics.fillStyle(0x1c2430, 1);
  graphics.lineStyle(1.25, 0x1c2430, 1);
  const inset = Math.max(2.2, half * 0.38);
  if (motion === 'vertical') {
    graphics.fillTriangle(x, y - inset - 0.4, x - inset * 0.7, y - 0.6, x + inset * 0.7, y - 0.6);
    graphics.fillTriangle(x, y + inset + 0.4, x - inset * 0.7, y + 0.6, x + inset * 0.7, y + 0.6);
    return;
  }
  if (motion === 'horizontal') {
    graphics.fillTriangle(x - inset - 0.4, y, x - 0.6, y - inset * 0.7, x - 0.6, y + inset * 0.7);
    graphics.fillTriangle(x + inset + 0.4, y, x + 0.6, y - inset * 0.7, x + 0.6, y + inset * 0.7);
    return;
  }
  const arm = inset + 0.4;
  graphics.beginPath();
  graphics.moveTo(x - arm, y);
  graphics.lineTo(x + arm, y);
  graphics.moveTo(x, y - arm);
  graphics.lineTo(x, y + arm);
  graphics.strokePath();
  const tip = 1.7;
  graphics.fillTriangle(x, y - arm - 0.2, x - tip, y - arm + tip * 1.3, x + tip, y - arm + tip * 1.3);
  graphics.fillTriangle(x, y + arm + 0.2, x - tip, y + arm - tip * 1.3, x + tip, y + arm - tip * 1.3);
  graphics.fillTriangle(x - arm - 0.2, y, x - arm + tip * 1.3, y - tip, x - arm + tip * 1.3, y + tip);
  graphics.fillTriangle(x + arm + 0.2, y, x + arm - tip * 1.3, y - tip, x + arm - tip * 1.3, y + tip);
}
