import Phaser from 'phaser';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import { isTriangleEditorTool } from './editorToolSelection';
import { drawTriangleStampPreview } from './triangleStamp';
import { TriangleHandleController, type TriangleHandleGeometry } from './triangleHandles';
import type { UtilityObjectEditor } from './utilityObjectEdits';
import { normalizePlacedTriangle } from '../../config/trianglePiece';
import type { PlacedObject } from '../../config';

function editorTriangleHandleGeometry(
  placed: PlacedObject | null,
  origin: { x: number; y: number },
): TriangleHandleGeometry | null {
  const geometry = placed ? normalizePlacedTriangle(placed) : null;
  if (!placed?.instanceId || !geometry) return null;
  return {
    instanceId: placed.instanceId,
    anchorX: origin.x + geometry.anchorX,
    anchorY: origin.y + geometry.anchorY,
    legX: geometry.legX,
    legY: geometry.legY,
  };
}

export function createEditorTriangleHandles(host: {
  pinnedId(): string | null;
  placed(id: string | null): PlacedObject | null;
  origin(): { x: number; y: number };
  zoom(): number;
  edits: UtilityObjectEditor;
}): TriangleHandleController {
  return new TriangleHandleController({
    selected: () => editorTriangleHandleGeometry(host.placed(host.pinnedId()), host.origin()),
    hitRadius: () => Math.max(8, 10 / Math.max(host.zoom(), 0.25)),
    roomBounds: () => {
      const origin = host.origin();
      return { minX: origin.x, minY: origin.y, maxX: origin.x + ROOM_PX_WIDTH, maxY: origin.y + ROOM_PX_HEIGHT };
    },
    begin: (instanceId) => { host.edits.beginTriangleDrag(instanceId); },
    apply: (instanceId, next) => { host.edits.applyTriangleDrag(instanceId, next); },
    commit: () => host.edits.commitTriangleDrag(),
  });
}

interface CourseTriangleSlice {
  origin: { x: number; y: number };
  runtime: {
    getPlacedObjectByInstanceId(instanceId: string | null): PlacedObject | null;
    utilityEdits: UtilityObjectEditor;
  };
}

export function createCourseTriangleHandles(host: {
  slices(): Iterable<CourseTriangleSlice>;
  pinnedTriangleId(): string | null;
  zoom(): number;
}): TriangleHandleController {
  let dragRuntime: CourseTriangleSlice['runtime'] | null = null;
  const geometry = (instanceId: string | null) => courseTriangleHandleGeometry(host.slices(), instanceId);
  return new TriangleHandleController({
    selected: () => geometry(host.pinnedTriangleId()),
    hitRadius: () => Math.max(8, 10 / Math.max(host.zoom(), 0.25)),
    roomBounds: () => {
      const id = host.pinnedTriangleId();
      if (!id) return null;
      for (const slice of host.slices()) {
        if (!slice.runtime.getPlacedObjectByInstanceId(id)) continue;
        return {
          minX: slice.origin.x,
          minY: slice.origin.y,
          maxX: slice.origin.x + ROOM_PX_WIDTH,
          maxY: slice.origin.y + ROOM_PX_HEIGHT,
        };
      }
      return null;
    },
    begin: (instanceId) => {
      const match = geometry(instanceId);
      dragRuntime = match?.runtime ?? null;
      dragRuntime?.utilityEdits.beginTriangleDrag(instanceId);
    },
    apply: (instanceId, next) => { dragRuntime?.utilityEdits.applyTriangleDrag(instanceId, next); },
    commit: () => {
      dragRuntime?.utilityEdits.commitTriangleDrag();
      dragRuntime = null;
    },
  });
}

function courseTriangleHandleGeometry(
  slices: Iterable<CourseTriangleSlice>,
  instanceId: string | null,
): (TriangleHandleGeometry & { runtime: CourseTriangleSlice['runtime'] }) | null {
  if (!instanceId) return null;
  for (const slice of slices) {
    const placed = slice.runtime.getPlacedObjectByInstanceId(instanceId);
    const geometry = placed ? normalizePlacedTriangle(placed) : null;
    if (!placed?.instanceId || !geometry) continue;
    return {
      runtime: slice.runtime,
      instanceId: placed.instanceId,
      anchorX: slice.origin.x + geometry.anchorX,
      anchorY: slice.origin.y + geometry.anchorY,
      legX: geometry.legX,
      legY: geometry.legY,
    };
  }
  return null;
}

export function drawCourseTriangleToolCursor(
  graphics: Phaser.GameObjects.Graphics,
  handles: TriangleHandleController,
  tileX: number,
  tileY: number,
  origin: { x: number; y: number },
): boolean {
  if (!isTriangleEditorTool()) return false;
  drawTriangleStampPreview(graphics, tileX, tileY, origin);
  handles.draw(graphics);
  return true;
}
