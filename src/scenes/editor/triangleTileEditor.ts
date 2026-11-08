import { editorState, subscribeEditorState, updateEditorState, type PlacedObject } from '../../config';
import {
  editorSelectionFromGids,
  normalizeTriangleTilePaint,
  orderedSelectionGids,
  triangleTileFieldsFromPaint,
  type TriangleTileFields,
} from '../../config/triangleTileFill';
import { normalizePlacedTriangle } from '../../config/trianglePiece';
import { isTriangleEditorTool } from './editorToolSelection';

export const TRIANGLE_LAYER_REQUIRED_TITLE = 'One of the three must stay on.';

export function activeTriangleLayers(placed: PlacedObject | null): { stroke: boolean; background: boolean; tile: boolean } {
  const geometry = placed ? normalizePlacedTriangle(placed) : null;
  if (geometry) return { stroke: geometry.strokeOn, background: geometry.backgroundOn, tile: geometry.tiles.fill };
  return {
    stroke: editorState.triangleStampStrokeOn,
    background: editorState.triangleStampBackgroundOn,
    tile: editorState.triangleStampTileFill,
  };
}

export function canTurnOffTriangleLayer(
  layers: { stroke: boolean; background: boolean; tile: boolean },
  layer: 'stroke' | 'background' | 'tile',
): boolean {
  const next = { ...layers, [layer]: false };
  return next.stroke || next.background || next.tile;
}

interface StashedTerrainPalette {
  selection: typeof editorState.selection;
  selectedTilesetKey: string;
  selectedTileGid: number;
  tileFlipXMode: typeof editorState.tileFlipXMode;
  tileFlipYMode: typeof editorState.tileFlipYMode;
}

let stashedPalette: StashedTerrainPalette | null = null;
let trianglePalette: StashedTerrainPalette | null = null;
let suppressTileSync = false;
const listeners = new Set<(fields: TriangleTileFields) => boolean>();
let installed = false;

export function triangleTileFieldsFromEditor(): TriangleTileFields {
  return {
    triangleTileFill: editorState.triangleStampTileFill,
    triangleTileMode: editorState.triangleStampTileMode,
    triangleTileSlopeOnly: editorState.triangleStampTileSlopeOnly,
    triangleTileFlipX: editorState.tileFlipXMode,
    triangleTileFlipY: editorState.tileFlipYMode,
    triangleTileGids: editorState.triangleStampTileFill ? orderedSelectionGids(editorState.selection) : [],
  };
}

function openTriangleTileSession(): void {
  if (stashedPalette) return;
  stashedPalette = snapshotPalette();
}

function snapshotPalette(): StashedTerrainPalette {
  return {
    selection: editorState.selection,
    selectedTilesetKey: editorState.selectedTilesetKey,
    selectedTileGid: editorState.selectedTileGid,
    tileFlipXMode: editorState.tileFlipXMode,
    tileFlipYMode: editorState.tileFlipYMode,
  };
}

export function closeTriangleTileSession(): void {
  if (stashedPalette && editorState.triangleStampTileFill) trianglePalette = snapshotPalette();
  const stashed = stashedPalette;
  stashedPalette = null;
  if (!stashed) return;
  suppressTileSync = true;
  updateEditorState(stashed);
  queueMicrotask(() => {
    suppressTileSync = false;
  });
}

export function resumeTriangleTileSession(): void {
  if (!editorState.triangleStampTileFill || !trianglePalette) return;
  openTriangleTileSession();
  const palette = trianglePalette;
  suppressTileSync = true;
  updateEditorState(palette);
  queueMicrotask(() => {
    suppressTileSync = false;
  });
}

function loadTrianglePalette(placed: PlacedObject): void {
  const paint = normalizeTriangleTilePaint(placed);
  const selection = editorSelectionFromGids(paint.gids);
  suppressTileSync = true;
  updateEditorState({
    triangleStampTileFill: paint.fill,
    triangleStampTileMode: paint.mode,
    triangleStampTileSlopeOnly: paint.slopeOnly,
    ...(paint.fill
      ? {
          tileFlipXMode: paint.flipX,
          tileFlipYMode: paint.flipY,
          ...(selection ?? {}),
        }
      : {}),
  });
  queueMicrotask(() => {
    suppressTileSync = false;
  });
}

export function noteTriangleSelection(placed: PlacedObject): void {
  const paint = normalizeTriangleTilePaint(placed);
  if (paint.fill) openTriangleTileSession();
  loadTrianglePalette(placed);
}

export function enableTriangleTileFill(placed: PlacedObject | null): TriangleTileFields {
  openTriangleTileSession();
  const existing = placed ? normalizeTriangleTilePaint(placed) : null;
  if (existing && existing.gids.length > 0) {
    suppressTileSync = true;
    const selection = editorSelectionFromGids(existing.gids);
    updateEditorState({
      triangleStampTileFill: true,
      triangleStampTileMode: existing.mode,
      triangleStampTileSlopeOnly: existing.slopeOnly,
      tileFlipXMode: existing.flipX,
      tileFlipYMode: existing.flipY,
      ...(selection ?? {}),
    });
    queueMicrotask(() => {
      suppressTileSync = false;
    });
    return triangleTileFieldsFromPaint(existing, true);
  }
  updateEditorState({ triangleStampTileFill: true });
  return triangleTileFieldsFromEditor();
}

export function setTriangleSlopeOnly(placed: PlacedObject | null, enabled: boolean): TriangleTileFields {
  updateEditorState({ triangleStampTileSlopeOnly: enabled });
  if (!placed || editorState.triangleStampTileFill) return triangleTileFieldsFromEditor();
  const existing = normalizeTriangleTilePaint(placed);
  return triangleTileFieldsFromPaint({ ...existing, slopeOnly: enabled }, existing.fill);
}

export function disableTriangleTileFill(placed: PlacedObject | null): TriangleTileFields {
  const existing = placed ? normalizeTriangleTilePaint(placed) : null;
  updateEditorState({ triangleStampTileFill: false });
  if (!existing) return triangleTileFieldsFromEditor();
  return triangleTileFieldsFromPaint(existing, false);
}

export function installTriangleTileSync(apply: (fields: TriangleTileFields) => boolean): () => void {
  listeners.add(apply);
  if (!installed) {
    installed = true;
    subscribeEditorState(({ keys }) => {
      const tileKeys = ['selection', 'tileFlipXMode', 'tileFlipYMode', 'triangleStampTileFill', 'triangleStampTileMode', 'triangleStampTileSlopeOnly'];
      if (suppressTileSync || !isTriangleEditorTool() || !editorState.triangleStampTileFill) return;
      if (!keys.some((key) => tileKeys.includes(key))) return;
      const fields = triangleTileFieldsFromEditor();
      for (const listener of listeners) {
        if (listener(fields)) return;
      }
    });
  }
  return () => {
    listeners.delete(apply);
  };
}
