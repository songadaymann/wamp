import Phaser from 'phaser';
import {
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILE_SIZE,
  editorState,
  getObjectPreviewRectForTile,
} from '../../config';
import { getEditorObjectConfigById } from '../../customSprites/objectConfig';
import { isTextInputFocused } from '../../ui/keyboardFocus';
import { RETRO_COLORS } from '../../visuals/starfield';
import { getDeviceLayoutState } from '../../ui/deviceLayout';
import type { EditorClipboardState, GoalPlacementMode } from './editRuntime';
import { applyEditorToolSelection, isEditorShapeOutline, isShapeEditorTool } from './editorToolSelection';
import { iterateShapeTiles, resolveShapeEnd, type EditorShapeKind } from './shapeTiles';

function isPointerShiftDown(pointer: Phaser.Input.Pointer): boolean {
  const event = pointer.event as MouseEvent | KeyboardEvent | TouchEvent | undefined;
  return Boolean(event && 'shiftKey' in event && event.shiftKey);
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

interface EditorInteractionHost {
  getNeighborRadius(): number;
  getGoalPlacementMode(): GoalPlacementMode;
  isMusicModeActive(): boolean;
  handleMusicPointerDown(pointer: Phaser.Input.Pointer): void;
  handleMusicPointerMove(pointer: Phaser.Input.Pointer): void;
  handleMusicPointerUp(pointer: Phaser.Input.Pointer): void;
  updateMusicCursorHighlight(graphics: Phaser.GameObjects.Graphics): boolean;
  handleObjectModePrimaryAction(pointer: Phaser.Input.Pointer): boolean;
  handleObjectModeSecondaryAction(worldX: number, worldY: number): boolean;
  handleObjectPlace(pointer: Phaser.Input.Pointer): void;
  handleToolDown(pointer: Phaser.Input.Pointer): void;
  removeGoalMarkerAt(worldX: number, worldY: number): boolean;
  removeObjectAt(worldX: number, worldY: number): void;
  placeGoalMarker(tileX: number, tileY: number): void;
  placeTileAt(worldX: number, worldY: number): void;
  eraseTileAt(worldX: number, worldY: number): void;
  stampShape(
    kind: EditorShapeKind,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options?: { outline?: boolean; erase?: boolean },
  ): void;
  floodErase(tileX: number, tileY: number): void;
  captureCopySelection(x1: number, y1: number, x2: number, y2: number): void;
  getClipboardPreview(): EditorClipboardState | null;
  isClipboardPastePreviewActive(): boolean;
  pasteClipboardAt(tileX: number, tileY: number): void;
  cancelClipboardPastePreview(): void;
  beginTileBatch(): void;
  commitTileBatch(): void;
  startPlayMode(): void;
  updateToolUi(): void;
  updateBackgroundPreview(): void;
  updateZoomUI(): void;
}

export class EditorInteractionController {
  private cursorGraphics: Phaser.GameObjects.Graphics | null = null;
  private rectPreviewGraphics: Phaser.GameObjects.Graphics | null = null;
  private isPanning = false;
  private panStartPointer = { x: 0, y: 0 };
  private panStartScroll = { x: 0, y: 0 };
  private isDrawing = false;
  private tileDragStart: { x: number; y: number } | null = null;
  private lastDraggedStampOrigin: { x: number; y: number } | null = null;
  private spaceDown = false;
  private rectStart: { x: number; y: number } | null = null;
  private shapeEraseActive = false;
  private readonly cursorCoordsEls: HTMLElement[];
  private touchPointers = new Map<number, { x: number; y: number }>();
  private touchPrimaryPointerId: number | null = null;
  private pinchDistance = 0;
  private pinchAnchor = { x: 0, y: 0 };
  private pinchAnchorWorld = { x: 0, y: 0 };
  private hasUserAdjustedCamera = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: EditorInteractionHost,
    doc: Document = document,
  ) {
    this.cursorCoordsEls = [
      doc.getElementById('cursor-coords'),
      doc.getElementById('mobile-editor-cursor-coords'),
    ].filter((element): element is HTMLElement => Boolean(element));
  }

  get cursorOverlay(): Phaser.GameObjects.Graphics | null {
    return this.cursorGraphics;
  }

  get rectPreviewOverlay(): Phaser.GameObjects.Graphics | null {
    return this.rectPreviewGraphics;
  }

  initializeOverlays(): void {
    this.cursorGraphics = this.scene.add.graphics();
    this.cursorGraphics.setDepth(99);

    this.rectPreviewGraphics = this.scene.add.graphics();
    this.rectPreviewGraphics.setDepth(98);
  }

  clearShapePreview(): void {
    this.rectStart = null;
    this.shapeEraseActive = false;
    this.rectPreviewGraphics?.clear();
  }

  private drawOccupiedCellPreview(
    originX: number,
    originY: number,
    width: number,
    height: number,
    occupiedMask: boolean[][],
    stroke: number,
    fillAlpha: number,
    lineAlpha: number,
    lineWidth: number,
  ): void {
    if (!this.cursorGraphics) {
      return;
    }

    let drewAnyCell = false;
    this.cursorGraphics.fillStyle(stroke, fillAlpha);
    this.cursorGraphics.lineStyle(lineWidth, stroke, lineAlpha);
    for (let dy = 0; dy < height; dy += 1) {
      for (let dx = 0; dx < width; dx += 1) {
        if (!occupiedMask[dy]?.[dx]) {
          continue;
        }

        drewAnyCell = true;
        this.cursorGraphics.fillRect(
          (originX + dx) * TILE_SIZE,
          (originY + dy) * TILE_SIZE,
          TILE_SIZE,
          TILE_SIZE,
        );
        this.cursorGraphics.strokeRect(
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

    this.cursorGraphics.fillRect(originX * TILE_SIZE, originY * TILE_SIZE, width * TILE_SIZE, height * TILE_SIZE);
    this.cursorGraphics.strokeRect(originX * TILE_SIZE, originY * TILE_SIZE, width * TILE_SIZE, height * TILE_SIZE);
  }

  reset(): void {
    this.cursorGraphics?.destroy();
    this.rectPreviewGraphics?.destroy();
    this.cursorGraphics = null;
    this.rectPreviewGraphics = null;
    this.isPanning = false;
    this.isDrawing = false;
    this.tileDragStart = null;
    this.lastDraggedStampOrigin = null;
    this.spaceDown = false;
    this.rectStart = null;
    this.shapeEraseActive = false;
    this.touchPointers = new Map();
    this.touchPrimaryPointerId = null;
    this.pinchDistance = 0;
    this.pinchAnchor = { x: 0, y: 0 };
    this.pinchAnchorWorld = { x: 0, y: 0 };
    this.hasUserAdjustedCamera = false;
  }

  setupCamera(): void {
    const cam = this.scene.cameras.main;
    const margin = TILE_SIZE * 4;
    const previewSpanX = ROOM_PX_WIDTH * this.host.getNeighborRadius();
    const previewSpanY = ROOM_PX_HEIGHT * this.host.getNeighborRadius();
    cam.setBounds(
      -previewSpanX - margin,
      -previewSpanY - margin,
      ROOM_PX_WIDTH + previewSpanX * 2 + margin * 2,
      ROOM_PX_HEIGHT + previewSpanY * 2 + margin * 2,
    );
    cam.transparent = true;
    this.fitToScreen({ markManualAdjustment: false });
  }

  centerCameraOnRoom(): void {
    const cam = this.scene.cameras.main;
    cam.setZoom(editorState.zoom);
    cam.centerOn(ROOM_PX_WIDTH / 2, ROOM_PX_HEIGHT / 2);
    this.constrainEditorCamera();
  }

  handleViewportResize(): void {
    if (!this.hasUserAdjustedCamera) {
      this.fitToScreen({ markManualAdjustment: false });
      return;
    }

    if (this.shouldUsePhonePortraitFit()) {
      this.constrainEditorCamera();
      return;
    }

    this.centerCameraOnRoom();
  }

  fitToScreen(options: { markManualAdjustment?: boolean } = {}): void {
    const viewW = this.scene.scale.width;
    const viewH = this.scene.scale.height;
    const usePhonePortraitFit = this.shouldUsePhonePortraitFit();
    const padding = usePhonePortraitFit ? 12 : 32;
    const fitZoom = Math.min(
      (viewW - padding) / ROOM_PX_WIDTH,
      (viewH - padding) / ROOM_PX_HEIGHT,
    );

    editorState.zoom = usePhonePortraitFit
      ? Number(fitZoom.toFixed(2))
      : Math.round(fitZoom * 4) / 4;
    editorState.zoom = Math.max(0.25, Math.min(6, editorState.zoom));

    this.centerCameraOnRoom();
    this.host.updateBackgroundPreview();
    this.host.updateZoomUI();

    if (options.markManualAdjustment !== false) {
      this.hasUserAdjustedCamera = false;
    }
  }

  zoomIn(): void {
    this.handleZoom(1.15);
  }

  zoomOut(): void {
    this.handleZoom(1 / 1.15);
  }

  updateCursorHighlight(): void {
    this.cursorGraphics?.clear();
    if (!this.cursorGraphics || editorState.isPlaying) {
      return;
    }

    if (this.host.isMusicModeActive()) {
      this.host.updateMusicCursorHighlight(this.cursorGraphics);
      return;
    }

    const pointer = this.scene.input.activePointer;
    const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tileX = Math.floor(worldPoint.x / TILE_SIZE);
    const tileY = Math.floor(worldPoint.y / TILE_SIZE);
    if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
      return;
    }

    const goalPlacementMode = this.host.getGoalPlacementMode();
    if (goalPlacementMode) {
      this.cursorGraphics.fillStyle(RETRO_COLORS.frontier, 0.16);
      this.cursorGraphics.fillRect(tileX * TILE_SIZE, tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      this.cursorGraphics.lineStyle(2, RETRO_COLORS.frontier, 0.9);
      this.cursorGraphics.strokeRect(tileX * TILE_SIZE, tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      this.updateCursorCoords(tileX, tileY);
      return;
    }

    if (editorState.paletteMode === 'objects') {
      const objectConfig = editorState.selectedObjectId
        ? getEditorObjectConfigById(editorState.selectedObjectId)
        : null;
      const layerAccent = getEditorLayerAccent();
      if (objectConfig && editorState.activeTool !== 'eraser') {
        const previewRect = getObjectPreviewRectForTile(objectConfig, tileX, tileY);
        this.cursorGraphics.fillStyle(layerAccent.stroke, layerAccent.fillAlpha);
        this.cursorGraphics.fillRect(
          previewRect.x,
          previewRect.y,
          previewRect.width,
          previewRect.height,
        );
        this.cursorGraphics.lineStyle(1, layerAccent.stroke, 0.9);
        this.cursorGraphics.strokeRect(
          previewRect.x,
          previewRect.y,
          previewRect.width,
          previewRect.height,
        );
      } else {
        this.cursorGraphics.lineStyle(2, RETRO_COLORS.danger, 0.85);
        this.cursorGraphics.strokeRect(tileX * TILE_SIZE, tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
      this.updateCursorCoords(tileX, tileY);
      return;
    }

    if (editorState.paletteMode === 'tiles' && this.host.isClipboardPastePreviewActive()) {
      const clipboard = this.host.getClipboardPreview();
      if (clipboard) {
        const layerAccent = getEditorLayerAccent();
        this.drawOccupiedCellPreview(
          tileX,
          tileY,
          clipboard.width,
          clipboard.height,
          clipboard.occupiedMask,
          layerAccent.stroke,
          0.12,
          0.95,
          2,
        );
        this.updateCursorCoords(tileX, tileY);
        return;
      }
    }

    const selection = editorState.selection;
    const stampOrigin =
      editorState.activeTool === 'pencil'
        ? this.getDraggedStampOrigin(tileX, tileY)
        : { x: tileX, y: tileY };
    const eraserBrushSize =
      editorState.paletteMode === 'tiles' && editorState.activeTool === 'eraser'
        ? editorState.eraserBrushSize
        : 1;
    const cursorOrigin =
      editorState.activeTool === 'eraser'
        ? {
            x: tileX - Math.floor(eraserBrushSize * 0.5),
            y: tileY - Math.floor(eraserBrushSize * 0.5),
          }
        : stampOrigin;
    const cursorW =
      editorState.activeTool === 'pencil'
        ? selection.width
        : editorState.activeTool === 'eraser'
          ? eraserBrushSize
          : 1;
    const cursorH =
      editorState.activeTool === 'pencil'
        ? selection.height
        : editorState.activeTool === 'eraser'
          ? eraserBrushSize
          : 1;

    if (editorState.activeTool === 'eraser') {
      this.cursorGraphics.lineStyle(2, RETRO_COLORS.danger, 0.85);
      this.cursorGraphics.strokeRect(
        cursorOrigin.x * TILE_SIZE,
        cursorOrigin.y * TILE_SIZE,
        cursorW * TILE_SIZE,
        cursorH * TILE_SIZE,
      );
    } else {
      const layerAccent = getEditorLayerAccent();
      const occupiedMask =
        editorState.activeTool === 'pencil'
          ? editorState.selection.occupiedMask
          : Array.from({ length: cursorH }, () => Array.from({ length: cursorW }, () => true));
      this.drawOccupiedCellPreview(
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

    this.updateCursorCoords(tileX, tileY);
  }

  setupInput(handleCanvasContextMenu: (event: Event) => void): void {
    this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.handleTouchPointerDown(pointer)) {
        return;
      }

      if (editorState.isPlaying) {
        return;
      }

      if (this.host.isMusicModeActive()) {
        this.host.handleMusicPointerDown(pointer);
        return;
      }

      if (pointer.middleButtonDown() || this.spaceDown) {
        this.isPanning = true;
        this.panStartPointer = { x: pointer.x, y: pointer.y };
        this.panStartScroll = {
          x: this.scene.cameras.main.scrollX,
          y: this.scene.cameras.main.scrollY,
        };
        return;
      }

      if (pointer.rightButtonDown()) {
        const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        if (this.host.removeGoalMarkerAt(worldPoint.x, worldPoint.y)) {
          return;
        }

        if (editorState.paletteMode === 'objects') {
          if (this.host.handleObjectModeSecondaryAction(worldPoint.x, worldPoint.y)) {
            return;
          }
          this.host.removeObjectAt(worldPoint.x, worldPoint.y);
        } else if (editorState.activeTool === 'fill') {
          this.host.beginTileBatch();
          this.host.floodErase(Math.floor(worldPoint.x / TILE_SIZE), Math.floor(worldPoint.y / TILE_SIZE));
          this.host.commitTileBatch();
        } else if (isShapeEditorTool(editorState.activeTool)) {
          this.isDrawing = true;
          this.shapeEraseActive = true;
          this.host.beginTileBatch();
          this.startRectDrawing(
            Math.floor(worldPoint.x / TILE_SIZE),
            Math.floor(worldPoint.y / TILE_SIZE),
          );
        } else {
          this.isDrawing = true;
          this.host.beginTileBatch();
          this.host.eraseTileAt(worldPoint.x, worldPoint.y);
        }
        return;
      }

      if (!pointer.leftButtonDown()) {
        return;
      }

      const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const tileX = Math.floor(worldPoint.x / TILE_SIZE);
      const tileY = Math.floor(worldPoint.y / TILE_SIZE);
      if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
        return;
      }

      const goalPlacementMode = this.host.getGoalPlacementMode();
      if (goalPlacementMode) {
        this.host.placeGoalMarker(tileX, tileY);
        return;
      }

      if (editorState.paletteMode === 'objects') {
        if (editorState.activeTool === 'eraser') {
          if (this.host.handleObjectModeSecondaryAction(worldPoint.x, worldPoint.y)) {
            return;
          }
          this.host.removeObjectAt(worldPoint.x, worldPoint.y);
        } else {
          if (this.host.handleObjectModePrimaryAction(pointer)) {
            return;
          }
          this.host.handleObjectPlace(pointer);
        }
      } else {
        if (this.host.isClipboardPastePreviewActive()) {
          this.host.pasteClipboardAt(tileX, tileY);
          return;
        }
        this.host.handleToolDown(pointer);
        if (editorState.activeTool !== 'fill') {
          this.isDrawing = true;
          this.beginTileDrag(tileX, tileY);
        }
      }
    });

    this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.handleTouchPointerMove(pointer)) {
        return;
      }

      if (editorState.isPlaying) {
        return;
      }

      if (this.host.isMusicModeActive()) {
        this.host.handleMusicPointerMove(pointer);
        return;
      }

      if (this.isPanning) {
        const dx = (this.panStartPointer.x - pointer.x) / this.scene.cameras.main.zoom;
        const dy = (this.panStartPointer.y - pointer.y) / this.scene.cameras.main.zoom;
        this.scene.cameras.main.scrollX = this.panStartScroll.x + dx;
        this.scene.cameras.main.scrollY = this.panStartScroll.y + dy;
        this.constrainEditorCamera();
        this.host.updateBackgroundPreview();
        this.hasUserAdjustedCamera = true;
        return;
      }

      if (editorState.paletteMode !== 'tiles') {
        return;
      }

      if (this.isDrawing && pointer.leftButtonDown()) {
        const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        if (editorState.activeTool === 'pencil') {
          this.placeDraggedTileStamp(worldPoint.x, worldPoint.y);
        } else if (editorState.activeTool === 'eraser') {
          this.host.eraseTileAt(worldPoint.x, worldPoint.y);
        }
      }

      if (this.isDrawing && pointer.rightButtonDown()) {
        const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        if (this.shapeEraseActive && this.rectStart && isShapeEditorTool(editorState.activeTool)) {
          const end = this.resolvePointerShapeEnd(pointer, worldPoint);
          this.drawShapePreview(editorState.activeTool, this.rectStart.x, this.rectStart.y, end.x, end.y);
        } else if (!this.shapeEraseActive) {
          this.host.eraseTileAt(worldPoint.x, worldPoint.y);
        }
      }

      if (
        (isShapeEditorTool(editorState.activeTool) || editorState.activeTool === 'copy') &&
        this.rectStart &&
        pointer.leftButtonDown()
      ) {
        const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const end = this.resolvePointerShapeEnd(pointer, worldPoint);
        if (editorState.activeTool === 'copy') {
          this.drawRectPreview(this.rectStart.x, this.rectStart.y, end.x, end.y);
        } else {
          this.drawShapePreview(editorState.activeTool, this.rectStart.x, this.rectStart.y, end.x, end.y);
        }
      }
    });

    this.scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (this.handleTouchPointerUp(pointer)) {
        return;
      }

      if (this.isPanning) {
        this.isPanning = false;
        return;
      }

      if (this.host.isMusicModeActive()) {
        this.host.handleMusicPointerUp(pointer);
        return;
      }

      if (!this.isDrawing) {
        return;
      }

      if (
        (isShapeEditorTool(editorState.activeTool) || editorState.activeTool === 'copy') &&
        this.rectStart &&
        (pointer.leftButtonReleased() || (this.shapeEraseActive && pointer.rightButtonReleased()))
      ) {
        const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const end = this.resolvePointerShapeEnd(pointer, worldPoint);
        if (editorState.activeTool === 'copy') {
          this.host.captureCopySelection(this.rectStart.x, this.rectStart.y, end.x, end.y);
        } else {
          this.host.stampShape(editorState.activeTool, this.rectStart.x, this.rectStart.y, end.x, end.y, {
            outline: isEditorShapeOutline(editorState.activeTool),
            erase: this.shapeEraseActive,
          });
        }
        this.rectStart = null;
        this.shapeEraseActive = false;
        this.rectPreviewGraphics?.clear();
      }

      if (editorState.activeTool !== 'copy') {
        this.host.commitTileBatch();
      }
      this.isDrawing = false;
      this.clearShapePreview();
      this.clearTileDrag();
    });

    this.scene.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: unknown[], _deltaX: number, deltaY: number) => {
      if (editorState.isPlaying) {
        return;
      }

      const zoomFactor = Phaser.Math.Clamp(Math.exp(-deltaY * 0.00055), 0.92, 1.08);
      this.handleZoom(zoomFactor);
    });

    this.scene.game.canvas.addEventListener('contextmenu', handleCanvasContextMenu);
  }

  setupKeyboard(): void {
    const keyboard = this.scene.input.keyboard!;
    keyboard.on('keydown-R', () => {
      if (isTextInputFocused()) {
        return;
      }
      applyEditorToolSelection('rect');
      this.host.updateToolUi();
    });
    keyboard.on('keydown-E', () => {
      if (isTextInputFocused()) {
        return;
      }
      applyEditorToolSelection('ellipse');
      this.host.updateToolUi();
    });
    keyboard.on('keydown-G', () => {
      if (isTextInputFocused()) {
        return;
      }
      applyEditorToolSelection('fill');
      this.host.updateToolUi();
    });
    keyboard.on('keydown-F', () => {
      if (isTextInputFocused()) {
        return;
      }
      this.fitToScreen();
    });
    keyboard.on('keydown-SPACE', () => { this.spaceDown = true; });
    keyboard.on('keyup-SPACE', () => { this.spaceDown = false; this.isPanning = false; });
    keyboard.on('keydown-P', () => {
      if (isTextInputFocused()) {
        return;
      }
      this.host.startPlayMode();
    });
  }

  private constrainEditorCamera(): void {
    const cam = this.scene.cameras.main;
    const bounds = cam.getBounds();
    const visibleWidth = cam.displayWidth;
    const visibleHeight = cam.displayHeight;
    const cameraOriginX = cam.width * cam.originX;
    const cameraOriginY = cam.height * cam.originY;
    const minScrollX = bounds.x - cameraOriginX + visibleWidth * 0.5;
    const maxScrollX = bounds.x + bounds.width - cameraOriginX - visibleWidth * 0.5;
    const minScrollY = bounds.y - cameraOriginY + visibleHeight * 0.5;
    const maxScrollY = bounds.y + bounds.height - cameraOriginY - visibleHeight * 0.5;

    cam.scrollX =
      visibleWidth >= bounds.width
        ? bounds.centerX - cameraOriginX
        : Phaser.Math.Clamp(cam.scrollX, minScrollX, maxScrollX);
    cam.scrollY =
      visibleHeight >= bounds.height
        ? bounds.centerY - cameraOriginY
        : Phaser.Math.Clamp(cam.scrollY, minScrollY, maxScrollY);
  }

  private handleZoom(zoomFactor: number): void {
    const nextZoom = Phaser.Math.Clamp(editorState.zoom * zoomFactor, 0.25, 6);
    if (Math.abs(nextZoom - editorState.zoom) < 0.0001) {
      return;
    }

    editorState.zoom = Number(nextZoom.toFixed(2));
    this.hasUserAdjustedCamera = true;
    this.centerCameraOnRoom();
    this.host.updateBackgroundPreview();
    this.host.updateZoomUI();
  }

  private drawRectPreview(x1: number, y1: number, x2: number, y2: number): void {
    this.drawShapeTilesPreview('rect', x1, y1, x2, y2, false, true);
  }

  private drawShapePreview(kind: EditorShapeKind, x1: number, y1: number, x2: number, y2: number): void {
    this.drawShapeTilesPreview(kind, x1, y1, x2, y2, isEditorShapeOutline(kind), false);
  }

  private drawShapeTilesPreview(
    kind: EditorShapeKind,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    outline: boolean,
    copySelection: boolean,
  ): void {
    this.rectPreviewGraphics?.clear();
    if (!this.rectPreviewGraphics) {
      return;
    }

    const minX = Math.min(x1, x2);
    const minY = Math.min(y1, y2);
    const maxX = Math.max(x1, x2);
    const maxY = Math.max(y1, y2);
    this.rectPreviewGraphics.fillStyle(RETRO_COLORS.draft, copySelection || !outline ? 0.15 : 0.22);
    if (copySelection || (kind === 'rect' && !outline)) {
      this.rectPreviewGraphics.fillRect(
        minX * TILE_SIZE,
        minY * TILE_SIZE,
        (maxX - minX + 1) * TILE_SIZE,
        (maxY - minY + 1) * TILE_SIZE,
      );
    } else {
      for (const tile of iterateShapeTiles(kind, x1, y1, x2, y2, outline)) {
        this.rectPreviewGraphics.fillRect(tile.x * TILE_SIZE, tile.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
    this.rectPreviewGraphics.lineStyle(1, RETRO_COLORS.draft, 0.65);
    this.rectPreviewGraphics.strokeRect(
      minX * TILE_SIZE,
      minY * TILE_SIZE,
      (maxX - minX + 1) * TILE_SIZE,
      (maxY - minY + 1) * TILE_SIZE,
    );
  }

  private resolvePointerShapeEnd(
    pointer: Phaser.Input.Pointer,
    worldPoint: Phaser.Math.Vector2,
  ): { x: number; y: number } {
    const current = {
      x: Math.floor(worldPoint.x / TILE_SIZE),
      y: Math.floor(worldPoint.y / TILE_SIZE),
    };
    if (!this.rectStart || editorState.activeTool === 'copy' || !isPointerShiftDown(pointer)) {
      return current;
    }
    return resolveShapeEnd(this.rectStart, current, true);
  }

  private updateCursorCoords(tileX: number, tileY: number): void {
    for (const element of this.cursorCoordsEls) {
      element.textContent = `Tile: ${tileX}, ${tileY}`;
    }
  }

  startRectDrawing(tileX: number, tileY: number): void {
    this.rectStart = { x: tileX, y: tileY };
  }

  private handleTouchPointerDown(pointer: Phaser.Input.Pointer): boolean {
    if (!this.isTouchPointer(pointer)) {
      return false;
    }

    if (editorState.isPlaying) {
      return true;
    }

    this.touchPointers.set(pointer.id, { x: pointer.x, y: pointer.y });
    if (this.touchPointers.size >= 2) {
      this.finishCurrentTouchDraw();
      this.beginPinchGesture();
      return true;
    }

    this.touchPrimaryPointerId = pointer.id;
    this.panStartPointer = { x: pointer.x, y: pointer.y };
    this.panStartScroll = {
      x: this.scene.cameras.main.scrollX,
      y: this.scene.cameras.main.scrollY,
    };

    const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tileX = Math.floor(worldPoint.x / TILE_SIZE);
    const tileY = Math.floor(worldPoint.y / TILE_SIZE);

    const goalPlacementMode = this.host.getGoalPlacementMode();
    if (goalPlacementMode) {
      if (tileX >= 0 && tileX < ROOM_WIDTH && tileY >= 0 && tileY < ROOM_HEIGHT) {
        this.host.placeGoalMarker(tileX, tileY);
      }
      return true;
    }

    if (editorState.activeTool === 'eraser' && this.host.removeGoalMarkerAt(worldPoint.x, worldPoint.y)) {
      return true;
    }

    if (editorState.paletteMode === 'objects') {
      if (editorState.activeTool === 'eraser') {
        if (this.host.handleObjectModeSecondaryAction(worldPoint.x, worldPoint.y)) {
          return true;
        }
        this.host.removeObjectAt(worldPoint.x, worldPoint.y);
      } else {
        if (this.host.handleObjectModePrimaryAction(pointer)) {
          return true;
        }
        this.host.handleObjectPlace(pointer);
      }
      return true;
    }

    if (isShapeEditorTool(editorState.activeTool) || editorState.activeTool === 'copy') {
      if (!this.rectStart) {
        this.rectStart = { x: tileX, y: tileY };
      } else {
        const end = resolveShapeEnd(this.rectStart, { x: tileX, y: tileY }, false);
        if (editorState.activeTool === 'copy') {
          this.host.captureCopySelection(this.rectStart.x, this.rectStart.y, end.x, end.y);
        } else {
          this.host.beginTileBatch();
          this.host.stampShape(editorState.activeTool, this.rectStart.x, this.rectStart.y, end.x, end.y, {
            outline: isEditorShapeOutline(editorState.activeTool),
            erase: false,
          });
          this.host.commitTileBatch();
        }
        this.clearShapePreview();
      }
      return true;
    }

    this.host.handleToolDown(pointer);
    if (editorState.activeTool !== 'fill') {
      this.isDrawing = true;
      this.beginTileDrag(tileX, tileY);
    }
    return true;
  }

  private handleTouchPointerMove(pointer: Phaser.Input.Pointer): boolean {
    if (!this.isTouchPointer(pointer)) {
      return false;
    }

    if (!this.touchPointers.has(pointer.id)) {
      return true;
    }

    this.touchPointers.set(pointer.id, { x: pointer.x, y: pointer.y });
    if (this.touchPointers.size >= 2) {
      this.handlePinchMove();
      return true;
    }

    if (this.touchPrimaryPointerId !== pointer.id) {
      return true;
    }

    if (!this.isDrawing || editorState.paletteMode !== 'tiles') {
      return true;
    }

    const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (editorState.activeTool === 'pencil') {
      this.placeDraggedTileStamp(worldPoint.x, worldPoint.y);
    } else if (editorState.activeTool === 'eraser') {
      this.host.eraseTileAt(worldPoint.x, worldPoint.y);
    } else if ((isShapeEditorTool(editorState.activeTool) || editorState.activeTool === 'copy') && this.rectStart) {
      const tileX = Math.floor(worldPoint.x / TILE_SIZE);
      const tileY = Math.floor(worldPoint.y / TILE_SIZE);
      if (editorState.activeTool === 'copy') {
        this.drawRectPreview(this.rectStart.x, this.rectStart.y, tileX, tileY);
      } else {
        this.drawShapePreview(editorState.activeTool, this.rectStart.x, this.rectStart.y, tileX, tileY);
      }
    }

    return true;
  }

  private handleTouchPointerUp(pointer: Phaser.Input.Pointer): boolean {
    if (!this.isTouchPointer(pointer)) {
      return false;
    }

    const wasPinching = this.touchPointers.size >= 2;
    this.touchPointers.delete(pointer.id);

    if (wasPinching) {
      if (this.touchPointers.size === 1) {
        const [remainingId, remainingPoint] = Array.from(this.touchPointers.entries())[0];
        this.touchPrimaryPointerId = remainingId;
        this.panStartPointer = { ...remainingPoint };
        this.panStartScroll = {
          x: this.scene.cameras.main.scrollX,
          y: this.scene.cameras.main.scrollY,
        };
      } else {
        this.touchPrimaryPointerId = null;
      }
      return true;
    }

    this.finishCurrentTouchDraw();
    this.touchPrimaryPointerId = null;
    return true;
  }

  private finishCurrentTouchDraw(): void {
    if (this.isDrawing) {
      if (editorState.activeTool !== 'copy') {
        this.host.commitTileBatch();
      }
      this.isDrawing = false;
    }
    this.clearShapePreview();
    this.clearTileDrag();
  }

  private beginTileDrag(tileX: number, tileY: number): void {
    if (
      editorState.paletteMode !== 'tiles' ||
      editorState.activeTool !== 'pencil'
    ) {
      this.clearTileDrag();
      return;
    }

    this.tileDragStart = { x: tileX, y: tileY };
    this.lastDraggedStampOrigin = { x: tileX, y: tileY };
  }

  private clearTileDrag(): void {
    this.tileDragStart = null;
    this.lastDraggedStampOrigin = null;
  }

  private placeDraggedTileStamp(worldX: number, worldY: number): void {
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);
    const stampOrigin = this.getDraggedStampOrigin(tileX, tileY);

    if (
      this.lastDraggedStampOrigin &&
      this.lastDraggedStampOrigin.x === stampOrigin.x &&
      this.lastDraggedStampOrigin.y === stampOrigin.y
    ) {
      return;
    }

    this.lastDraggedStampOrigin = { ...stampOrigin };
    this.host.placeTileAt(stampOrigin.x * TILE_SIZE, stampOrigin.y * TILE_SIZE);
  }

  private getDraggedStampOrigin(tileX: number, tileY: number): { x: number; y: number } {
    if (
      !this.isDrawing ||
      editorState.paletteMode !== 'tiles' ||
      editorState.activeTool !== 'pencil' ||
      !this.tileDragStart
    ) {
      return { x: tileX, y: tileY };
    }

    const selectionWidth = Math.max(1, editorState.selection.width);
    const selectionHeight = Math.max(1, editorState.selection.height);
    if (selectionWidth === 1 && selectionHeight === 1) {
      return { x: tileX, y: tileY };
    }

    const dx = tileX - this.tileDragStart.x;
    const dy = tileY - this.tileDragStart.y;
    return {
      x: this.tileDragStart.x + Math.floor(dx / selectionWidth) * selectionWidth,
      y: this.tileDragStart.y + Math.floor(dy / selectionHeight) * selectionHeight,
    };
  }

  private beginPinchGesture(): void {
    const points = Array.from(this.touchPointers.values());
    if (points.length < 2) {
      return;
    }

    const [firstPoint, secondPoint] = points;
    this.pinchDistance = Phaser.Math.Distance.Between(
      firstPoint.x,
      firstPoint.y,
      secondPoint.x,
      secondPoint.y,
    );
    this.pinchAnchor = {
      x: (firstPoint.x + secondPoint.x) * 0.5,
      y: (firstPoint.y + secondPoint.y) * 0.5,
    };
    const anchorWorld = this.screenToWorld(this.pinchAnchor.x, this.pinchAnchor.y);
    this.pinchAnchorWorld = {
      x: anchorWorld.x,
      y: anchorWorld.y,
    };
    this.panStartScroll = {
      x: this.scene.cameras.main.scrollX,
      y: this.scene.cameras.main.scrollY,
    };
  }

  private handlePinchMove(): void {
    const points = Array.from(this.touchPointers.values());
    if (points.length < 2) {
      return;
    }

    const [firstPoint, secondPoint] = points;
    const nextDistance = Phaser.Math.Distance.Between(
      firstPoint.x,
      firstPoint.y,
      secondPoint.x,
      secondPoint.y,
    );
    if (this.pinchDistance <= 0) {
      this.pinchDistance = nextDistance;
      return;
    }

    const centerX = (firstPoint.x + secondPoint.x) * 0.5;
    const centerY = (firstPoint.y + secondPoint.y) * 0.5;
    const zoomFactor = nextDistance / this.pinchDistance;
    if (Math.abs(zoomFactor - 1) > 0.02) {
      const nextZoom = Phaser.Math.Clamp(editorState.zoom * zoomFactor, 0.25, 6);
      if (Math.abs(nextZoom - editorState.zoom) >= 0.0001) {
        editorState.zoom = Number(nextZoom.toFixed(2));
        this.scene.cameras.main.setZoom(editorState.zoom);
        this.host.updateZoomUI();
      }
      this.pinchDistance = nextDistance;
    }

    this.scrollWorldPointToScreen(this.pinchAnchorWorld.x, this.pinchAnchorWorld.y, centerX, centerY);
    this.constrainEditorCamera();
    this.host.updateBackgroundPreview();
    this.hasUserAdjustedCamera = true;
  }

  private screenToWorld(screenX: number, screenY: number): Phaser.Math.Vector2 {
    const camera = this.scene.cameras.main;
    const localX = screenX - camera.x;
    const localY = screenY - camera.y;
    return new Phaser.Math.Vector2(
      camera.scrollX + camera.width * camera.originX - camera.displayWidth * 0.5 + localX / camera.zoom,
      camera.scrollY + camera.height * camera.originY - camera.displayHeight * 0.5 + localY / camera.zoom,
    );
  }

  private scrollWorldPointToScreen(worldX: number, worldY: number, screenX: number, screenY: number): void {
    const camera = this.scene.cameras.main;
    const localX = screenX - camera.x;
    const localY = screenY - camera.y;
    camera.setScroll(
      worldX - camera.width * camera.originX + camera.displayWidth * 0.5 - localX / camera.zoom,
      worldY - camera.height * camera.originY + camera.displayHeight * 0.5 - localY / camera.zoom,
    );
  }

  private isTouchPointer(pointer: Phaser.Input.Pointer): boolean {
    const layout = getDeviceLayoutState();
    if (!layout.coarsePointer) {
      return false;
    }

    const event = pointer.event as PointerEvent | MouseEvent | undefined;
    if (!event) {
      return layout.coarsePointer;
    }

    if ('pointerType' in event && typeof event.pointerType === 'string') {
      return event.pointerType === 'touch' || event.pointerType === 'pen';
    }

    return layout.coarsePointer;
  }

  private shouldUsePhonePortraitFit(): boolean {
    const layout = getDeviceLayoutState();
    return (
      layout.deviceClass === 'phone' &&
      layout.orientationState === 'portrait' &&
      layout.coarsePointer
    );
  }
}
