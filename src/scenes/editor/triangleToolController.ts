import type Phaser from 'phaser';
import { isTrianglePieceObjectId } from '../../config/trianglePiece';
import type { PlacedObject } from '../../config';
import { isTriangleEditorTool } from './editorToolSelection';
import {
  createCourseTriangleHandles,
  drawCourseTriangleToolCursor,
} from './triangleHandleSetup';
import type { TriangleHandleController } from './triangleHandles';
import type { UtilityObjectEditor } from './utilityObjectEdits';

interface CourseTriangleSlice {
  origin: { x: number; y: number };
  runtime: {
    getPlacedObjectByInstanceId(instanceId: string | null): PlacedObject | null;
    utilityEdits: UtilityObjectEditor;
  };
}

/** Course editor: triangle handles plus primary/secondary/delete helpers. */
export class CourseTriangleToolController {
  readonly handles: TriangleHandleController;

  constructor(private readonly host: {
    slices(): Iterable<CourseTriangleSlice>;
    pinnedTriangleId(): string | null;
    zoom(): number;
    deletePinned(): boolean;
    handleToolAction(slice: CourseTriangleSlice, worldX: number, worldY: number): void;
    removeTriangleAt(slice: CourseTriangleSlice, worldX: number, worldY: number): void;
  }) {
    this.handles = createCourseTriangleHandles({
      slices: () => host.slices(),
      pinnedTriangleId: () => host.pinnedTriangleId(),
      zoom: () => host.zoom(),
    });
  }

  deletePinned(): boolean {
    return this.host.deletePinned();
  }

  handlePrimary(slice: CourseTriangleSlice, worldX: number, worldY: number): boolean {
    if (!isTriangleEditorTool()) return false;
    this.host.handleToolAction(slice, worldX, worldY);
    return true;
  }

  handleSecondary(slice: CourseTriangleSlice, worldX: number, worldY: number): boolean {
    if (!isTriangleEditorTool()) return false;
    this.host.removeTriangleAt(slice, worldX, worldY);
    return true;
  }

  down(worldX: number, worldY: number): boolean {
    return this.handles.down(worldX, worldY);
  }

  move(worldX: number, worldY: number): boolean {
    return this.handles.move(worldX, worldY);
  }

  up(): void {
    this.handles.up();
  }

  drawCursor(
    graphics: Phaser.GameObjects.Graphics,
    tileX: number,
    tileY: number,
    origin: { x: number; y: number },
  ): boolean {
    return drawCourseTriangleToolCursor(graphics, this.handles, tileX, tileY, origin);
  }
}

export function isTrianglePieceFilter(placed: PlacedObject): boolean {
  return isTrianglePieceObjectId(placed.id);
}
