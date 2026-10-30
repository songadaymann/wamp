import type Phaser from 'phaser';
import { editorState, TILE_SIZE, getObjectPreviewRectForTile } from '../../config';
import { getEditorObjectConfigById } from '../../customSprites/objectConfig';
import { RETRO_COLORS } from '../../visuals/starfield';
import type { EditorClipboardState } from './editRuntime';
import type { TilePoint } from './shapeTiles';
import { drawClipboardPastePreview } from './clipboardObjects';
import { isPencilBrushPlacement, isPencilSprayPlacement } from './editorToolSelection';
import { clampRandomizeBrushSize } from './randomizeTiles';
import { clampSprayBrushSize, createCircleBrushMask } from './sprayTiles';

type CursorGraphics = Pick<Phaser.GameObjects.Graphics, 'fillStyle' | 'lineStyle' | 'fillRect' | 'strokeRect'>;
interface CursorOptions {
  tile: TilePoint;
  origin?: TilePoint;
  goalPlacement?: boolean;
  practicePlacement?: boolean;
  clipboard?: EditorClipboardState | null;
  stampOrigin?: TilePoint;
  erasing?: boolean;
}

function getEditorLayerAccent(): { stroke: number; fillAlpha: number } {
  switch (editorState.activeLayer) {
    case 'background':
      return { stroke: 0x2f6b7f, fillAlpha: 0.16 };
    case 'foreground':
      return { stroke: 0xff6f3c, fillAlpha: 0.18 };
    case 'terrain':
    default:
      return { stroke: 0x347433, fillAlpha: 0.18 };
  }
}

/** Render in a slice's local grid; every draw is translated into the workspace. */
export function drawEditorCursor(graphics: Phaser.GameObjects.Graphics, options: CursorOptions): void {
  const { x: tileX, y: tileY } = options.tile;
  const origin = options.origin ?? { x: 0, y: 0 };
  const g: CursorGraphics = {
    fillStyle: graphics.fillStyle.bind(graphics), lineStyle: graphics.lineStyle.bind(graphics),
    fillRect: (x, y, w, h) => graphics.fillRect(x + origin.x, y + origin.y, w, h),
    strokeRect: (x, y, w, h) => graphics.strokeRect(x + origin.x, y + origin.y, w, h),
  };
  const goalPlacementMode = options.goalPlacement;
  if (goalPlacementMode || options.practicePlacement) {
    g.fillStyle(RETRO_COLORS.frontier, 0.16);
    g.fillRect(tileX * TILE_SIZE, tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    g.lineStyle(2, RETRO_COLORS.frontier, 0.9);
    g.strokeRect(tileX * TILE_SIZE, tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    return;
  }

  if (editorState.paletteMode === 'objects') {
    const objectConfig = editorState.selectedObjectId
      ? getEditorObjectConfigById(editorState.selectedObjectId)
      : null;
    const layerAccent = getEditorLayerAccent();
    if (objectConfig && editorState.activeTool !== 'eraser') {
      const previewRect = getObjectPreviewRectForTile(objectConfig, tileX, tileY);
      g.fillStyle(layerAccent.stroke, layerAccent.fillAlpha);
      g.fillRect(
        previewRect.x,
        previewRect.y,
        previewRect.width,
        previewRect.height,
      );
      g.lineStyle(1, layerAccent.stroke, 0.9);
      g.strokeRect(
        previewRect.x,
        previewRect.y,
        previewRect.width,
        previewRect.height,
      );
    } else {
      g.lineStyle(2, RETRO_COLORS.danger, 0.85);
      g.strokeRect(tileX * TILE_SIZE, tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
    return;
  }

  if (editorState.paletteMode === 'tiles' && options.clipboard) {
    const clipboard = options.clipboard;
    if (clipboard) {
      drawClipboardPastePreview(graphics, clipboard, { x: origin.x + tileX * TILE_SIZE, y: origin.y + tileY * TILE_SIZE }, getEditorLayerAccent().stroke);
      return;
    }
  }

  const selection = editorState.paletteMode === 'smart'
    ? { width: 1, height: 1, occupiedMask: [[true]] }
    : editorState.selection;
  const stampOrigin =
    editorState.activeTool === 'pencil'
      ? options.stampOrigin ?? { x: tileX, y: tileY }
      : { x: tileX, y: tileY };
  const eraserBrushSize =
    editorState.activeTool === 'eraser'
      ? editorState.eraserBrushSize
      : 1;
  const sprayPlacement = editorState.activeTool === 'pencil' && isPencilSprayPlacement();
  const sprayBrushSize = sprayPlacement
    ? clampSprayBrushSize(editorState.pencilSprayBrushSize)
    : 1;
  const pencilBrushSize =
    editorState.activeTool === 'pencil' && isPencilBrushPlacement()
      ? clampRandomizeBrushSize(editorState.pencilBrushSize)
      : 1;
  const pencilUsesBrushWindow = editorState.activeTool === 'pencil' && isPencilBrushPlacement();
  const randomizeBrushSize =
    editorState.activeTool === 'randomize'
      ? clampRandomizeBrushSize(editorState.randomizeBrushSize)
      : 1;
  const cursorOrigin =
    editorState.activeTool === 'eraser'
      ? {
          x: tileX - Math.floor(eraserBrushSize * 0.5),
          y: tileY - Math.floor(eraserBrushSize * 0.5),
        }
      : editorState.activeTool === 'randomize' || pencilUsesBrushWindow || sprayPlacement
        ? {
            x: tileX - Math.floor(
              (sprayPlacement ? sprayBrushSize : pencilUsesBrushWindow ? pencilBrushSize : randomizeBrushSize) * 0.5,
            ),
            y: tileY - Math.floor(
              (sprayPlacement ? sprayBrushSize : pencilUsesBrushWindow ? pencilBrushSize : randomizeBrushSize) * 0.5,
            ),
          }
      : stampOrigin;
  const cursorW =
    editorState.activeTool === 'pencil'
      ? (sprayPlacement ? sprayBrushSize : pencilUsesBrushWindow ? pencilBrushSize : selection.width)
      : editorState.activeTool === 'eraser'
        ? eraserBrushSize
        : editorState.activeTool === 'randomize'
          ? randomizeBrushSize
          : 1;
  const cursorH =
    editorState.activeTool === 'pencil'
      ? (sprayPlacement ? sprayBrushSize : pencilUsesBrushWindow ? pencilBrushSize : selection.height)
      : editorState.activeTool === 'eraser'
        ? eraserBrushSize
        : editorState.activeTool === 'randomize'
          ? randomizeBrushSize
          : 1;
  const pencilMask = sprayPlacement
    ? createCircleBrushMask(sprayBrushSize)
    : pencilUsesBrushWindow
      ? Array.from({ length: pencilBrushSize }, () => Array.from({ length: pencilBrushSize }, () => true))
      : editorState.paletteMode === 'smart'
        ? [[true]]
        : editorState.selection.occupiedMask;

  if (editorState.activeTool === 'eraser') {
    g.lineStyle(2, RETRO_COLORS.danger, 0.85);
    g.strokeRect(
      cursorOrigin.x * TILE_SIZE,
      cursorOrigin.y * TILE_SIZE,
      cursorW * TILE_SIZE,
      cursorH * TILE_SIZE,
    );
  } else if (editorState.activeTool === 'pencil' && options.erasing) {
    drawOccupiedCellPreview(g,
      cursorOrigin.x,
      cursorOrigin.y,
      cursorW,
      cursorH,
      pencilMask,
      RETRO_COLORS.danger,
      0.18,
      0.9,
      2,
    );
  } else {
    const layerAccent = getEditorLayerAccent();
    const occupiedMask =
      editorState.activeTool === 'pencil'
        ? pencilMask
        : Array.from({ length: cursorH }, () => Array.from({ length: cursorW }, () => true));
    drawOccupiedCellPreview(g,
      cursorOrigin.x,
      cursorOrigin.y,
      cursorW,
      cursorH,
      occupiedMask,
      layerAccent.stroke,
      layerAccent.fillAlpha,
      0.92,
      1,
    );
  }

}

function drawOccupiedCellPreview(
  graphics: CursorGraphics,
  originX: number,
  originY: number,
  width: number,
  height: number,
  occupiedMask: readonly (readonly boolean[])[],
  stroke: number,
  fillAlpha: number,
  lineAlpha: number,
  lineWidth: number,
): void {
  let drewAnyCell = false;
  graphics.fillStyle(stroke, fillAlpha);
  graphics.lineStyle(lineWidth, stroke, lineAlpha);
  for (let dy = 0; dy < height; dy += 1) {
    for (let dx = 0; dx < width; dx += 1) {
      if (!occupiedMask[dy]?.[dx]) {
        continue;
      }

      drewAnyCell = true;
      graphics.fillRect(
        (originX + dx) * TILE_SIZE,
        (originY + dy) * TILE_SIZE,
        TILE_SIZE,
        TILE_SIZE,
      );
      graphics.strokeRect(
        (originX + dx) * TILE_SIZE,
        (originY + dy) * TILE_SIZE,
        TILE_SIZE,
        TILE_SIZE,
      );
    }
  }

  if (drewAnyCell) {
    return;
  }

  graphics.fillRect(originX * TILE_SIZE, originY * TILE_SIZE, width * TILE_SIZE, height * TILE_SIZE);
  graphics.strokeRect(originX * TILE_SIZE, originY * TILE_SIZE, width * TILE_SIZE, height * TILE_SIZE);
}
