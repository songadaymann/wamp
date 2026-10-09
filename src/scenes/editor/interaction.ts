import Phaser from 'phaser';
import { EditorTouchCandidate, EditorTouchGesture, editorTouchToolKey } from './touchGesture';
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
import {
  canRepeatSelectedEditorObject,
  getEditorStampKind,
  isDragStampEditorTool,
  isEditorLineCurve,
  resolveEditorLineEnd,
  isEditorShapeOutline,
  isPathEditorTool,
  isPencilBrushPlacement,
  isPencilSprayPlacement,
  isPencilStampPlacement,
} from './editorToolSelection';
import { clampRandomizeBrushSize } from './randomizeTiles';
import { clampSprayBrushSize, createCircleBrushMask, getSprayTilesPerSecond, listCircleBrushOffsets } from './sprayTiles';
import { forEachDraggedTileCell, resolvePencilStampOrigin } from './stampDrag';
import { iterateShapeTiles, resolveShapeEnd, type EditorShapeKind, type TilePoint } from './shapeTiles';
import {
  getScreenAnchorWorldPoint,
  getScrollForScreenAnchor,
} from '../overworld/camera';
import {
  clearMusicWorkbenchFrame,
  MUSIC_ROOM_LABEL_GUTTER,
  MUSIC_ROOM_NEIGHBOR_PEEK,
  MusicRoomFitController,
  planRoomCameraFit,
  readMusicRoomViewport,
  syncMusicWorkbenchFrame,
} from './musicRoomFit';

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
  placeObjectAtTile(tileX: number, tileY: number): void;
  floodFillObjects(tileX: number, tileY: number): number;
  beginObjectBatch(livePreview?: boolean): void;
  commitObjectBatch(): void;
  cancelObjectBatch(): void;
  handleToolDown(pointer: Phaser.Input.Pointer): void;
  removeGoalMarkerAt(worldX: number, worldY: number): boolean;
  removeObjectAt(worldX: number, worldY: number): void;
  placeGoalMarker(tileX: number, tileY: number): void;
  placeTileAt(worldX: number, worldY: number): void;
  paintRandomizeAt(worldX: number, worldY: number): void;
  placeTileStroke(points: readonly TilePoint[]): void;
  eraseTileAt(worldX: number, worldY: number): void;
  eraseStampAt(worldX: number, worldY: number): void;
  stampShape(
    kind: EditorShapeKind,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options?: { outline?: boolean; erase?: boolean; mid?: TilePoint },
  ): void;
  floodErase(tileX: number, tileY: number): void;
  captureCopySelection(x1: number, y1: number, x2: number, y2: number): void;
  getClipboardPreview(): EditorClipboardState | null;
  isClipboardPastePreviewActive(): boolean;
  pasteClipboardAt(tileX: number, tileY: number): void;
  cancelClipboardPastePreview(): void;
  beginTileBatch(): void;
  commitTileBatch(): void;
  cancelTileBatch(): void;
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
  private lastObjectDragCell: TilePoint | null = null;
  private tileDragStart: { x: number; y: number } | null = null;
  private lastDraggedStampOrigin: { x: number; y: number } | null = null;
  private sprayRemainder = 0;
  private spaceDown = false;
  private rectStart: { x: number; y: number } | null = null;
  private shapeEraseActive = false;
  private pathBend: { start: TilePoint; end: TilePoint; mid: TilePoint; erase: boolean } | null = null;
  private readonly cursorCoordsEls: HTMLElement[];
  private readonly touchGesture = new EditorTouchGesture();
  private readonly touchCandidate = new EditorTouchCandidate((delay, callback) => {
    const timer = this.scene.time.delayedCall(delay, callback);
    return () => timer.remove(false);
  });
  private touchAction: 'tiles' | 'objects' | 'shape' | 'tap' | 'bend' | null = null;
  private touchStartTile: TilePoint | null = null;
  private touchToolKey = '';
  private pinchDistance = 0;
  private pinchAnchor = { x: 0, y: 0 };
  private pinchAnchorWorld = { x: 0, y: 0 };
  private readonly handleTouchBlur = (): void => {
    if (this.touchAction) this.cancelTouchEdit();
  };
  private readonly musicRoomFit = new MusicRoomFitController();
  private musicFitLock = false;

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

  stopMusicRoomFit(): void {
    this.musicRoomFit.stop();
  }

  get cursorOverlay(): Phaser.GameObjects.Graphics | null {
    return this.cursorGraphics;
  }

  get rectPreviewOverlay(): Phaser.GameObjects.Graphics | null {
    return this.rectPreviewGraphics;
  }

  get hasPendingTouchEdit(): boolean { return this.touchAction !== null; }

  validateTouchEdit(): void {
    if (this.touchAction && (this.touchToolKey !== editorTouchToolKey()
      || this.scene.game.canvas.ownerDocument.body.dataset.editorSpriteUiLocked === 'true'
      || this.host.isMusicModeActive() || editorState.isPlaying)) this.cancelTouchEdit();
  }

  tickSpray(deltaMs: number): void {
    if (!this.isDrawing || !isPencilSprayPlacement()) {
      this.sprayRemainder = 0;
      return;
    }
    const pointer = this.scene.input.activePointer;
    const painting = pointer.leftButtonDown();
    const erasing = pointer.rightButtonDown();
    if (!painting && !erasing) {
      return;
    }
    const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const size = clampSprayBrushSize(editorState.pencilSprayBrushSize);
    const tilesPerSecond = getSprayTilesPerSecond(size, editorState.pencilSprayRate);
    this.sprayRemainder += tilesPerSecond * Math.max(0, deltaMs) / 1000;
    const cellCount = Math.max(1, listCircleBrushOffsets(size).length);
    const burst = Math.min(cellCount, Math.floor(this.sprayRemainder));
    this.sprayRemainder -= burst;
    for (let i = 0; i < burst; i += 1) {
      if (erasing) {
        this.host.eraseStampAt(worldPoint.x, worldPoint.y);
      } else {
        this.host.placeTileAt(worldPoint.x, worldPoint.y);
      }
    }
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
    this.pathBend = null;
    this.rectPreviewGraphics?.clear();
  }

  cancelPendingShapeOperation(): boolean {
    const hasPendingShape = Boolean(
      this.pathBend
      || (this.rectStart && (isDragStampEditorTool(editorState.activeTool) || editorState.activeTool === 'copy')),
    );
    if (!hasPendingShape) return false;

    const hasOpenEmptyBatch = this.isDrawing
      && editorState.activeTool !== 'copy'
      && !(isPathEditorTool(editorState.activeTool) && isEditorLineCurve());
    if (hasOpenEmptyBatch) this.host.commitTileBatch();
    this.isDrawing = false;
    this.clearShapePreview();
    this.clearTileDrag();
    return true;
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
    this.scene.game.events.off('blur', this.handleTouchBlur);
    this.scene.events.off('sleep', this.handleTouchBlur);
    this.cursorGraphics?.destroy();
    this.rectPreviewGraphics?.destroy();
    this.cursorGraphics = null;
    this.rectPreviewGraphics = null;
    this.isPanning = false;
    this.isDrawing = false;
    this.lastObjectDragCell = null;
    this.tileDragStart = null;
    this.lastDraggedStampOrigin = null;
    this.sprayRemainder = 0;
    this.spaceDown = false;
    this.rectStart = null;
    this.shapeEraseActive = false;
    this.touchCandidate.cancel();
    this.touchGesture.reset();
    this.touchAction = null;
    this.touchStartTile = null;
    this.pinchDistance = 0;
    this.pinchAnchor = { x: 0, y: 0 };
    this.pinchAnchorWorld = { x: 0, y: 0 };
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
    // Round pixels floor scroll every frame, so a cursor-anchored zoom walks away from the pointer.
    cam.setRoundPixels(false);
    this.fitToScreen();
  }

  centerCameraOnRoom(): void {
    const cam = this.scene.cameras.main;
    cam.setZoom(editorState.zoom);
    cam.centerOn(ROOM_PX_WIDTH / 2, ROOM_PX_HEIGHT / 2);
    this.constrainEditorCamera();
  }

  handleViewportResize(): void {
    if (this.host.isMusicModeActive()) {
      this.applyMusicRoomFit();
      return;
    }

    // Palette and dock changes resize the canvas. Keep the current zoom and the same world point
    // in the middle of the view instead of jumping back to the room center.
    const cam = this.scene.cameras.main;
    const centerX = cam.midPoint.x;
    const centerY = cam.midPoint.y;
    cam.centerOn(centerX, centerY);
    this.constrainEditorCamera();
    this.host.updateBackgroundPreview();
  }

  syncMusicRoomCamera(): void {
    this.musicRoomFit.sync(
      this.host.isMusicModeActive(),
      () => this.applyMusicRoomFit(),
      () => {
        clearMusicWorkbenchFrame();
        if (!this.host.isMusicModeActive()) {
          this.fitToScreen();
        }
      },
    );
  }

  private applyMusicRoomFit(): void {
    if (!this.host.isMusicModeActive() || this.musicFitLock) {
      return;
    }

    this.musicFitLock = true;
    try {
      const camera = this.scene.cameras.main;
      const viewport = readMusicRoomViewport(
        this.scene.game.canvas,
        document,
        camera.width,
        camera.height,
      );
      const plan = planRoomCameraFit({
        cameraWidth: camera.width,
        cameraHeight: camera.height,
        originX: camera.originX,
        originY: camera.originY,
        roomX: 0,
        roomY: 0,
        roomWidth: ROOM_PX_WIDTH,
        roomHeight: ROOM_PX_HEIGHT,
        viewport,
        worldInset: {
          left: MUSIC_ROOM_LABEL_GUTTER,
          top: MUSIC_ROOM_NEIGHBOR_PEEK,
          right: MUSIC_ROOM_NEIGHBOR_PEEK,
          bottom: MUSIC_ROOM_NEIGHBOR_PEEK,
        },
      });
      editorState.zoom = plan.zoom;
      camera.setZoom(plan.zoom);
      camera.setScroll(plan.scrollX, plan.scrollY);
      syncMusicWorkbenchFrame(this.scene.game.canvas, camera.width, camera.height, plan);
      this.host.updateBackgroundPreview();
    } finally {
      this.musicFitLock = false;
    }
  }

  fitToScreen(): void {
    if (this.host.isMusicModeActive()) {
      this.applyMusicRoomFit();
      return;
    }

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
  }

  zoomIn(): void {
    const anchor = this.getManualZoomAnchor();
    this.handleZoom(1.15, anchor.x, anchor.y);
  }

  zoomOut(): void {
    const anchor = this.getManualZoomAnchor();
    this.handleZoom(1 / 1.15, anchor.x, anchor.y);
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

    const selection = editorState.paletteMode === 'smart'
      ? { width: 1, height: 1, occupiedMask: [[true]] }
      : editorState.selection;
    const stampOrigin =
      editorState.activeTool === 'pencil'
        ? this.getDraggedStampOrigin(tileX, tileY)
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
      this.cursorGraphics.lineStyle(2, RETRO_COLORS.danger, 0.85);
      this.cursorGraphics.strokeRect(
        cursorOrigin.x * TILE_SIZE,
        cursorOrigin.y * TILE_SIZE,
        cursorW * TILE_SIZE,
        cursorH * TILE_SIZE,
      );
    } else if (editorState.activeTool === 'pencil' && pointer.rightButtonDown()) {
      this.drawOccupiedCellPreview(
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
    this.scene.game.events.on('blur', this.handleTouchBlur);
    this.scene.events.on('sleep', this.handleTouchBlur);
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

      if (this.resolvePathBendPointer(pointer)) {
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
        } else if (isDragStampEditorTool(editorState.activeTool)) {
          this.isDrawing = true;
          this.shapeEraseActive = true;
          if (!(isPathEditorTool(editorState.activeTool) && isEditorLineCurve())) {
            this.host.beginTileBatch();
          }
          this.startRectDrawing(
            Math.floor(worldPoint.x / TILE_SIZE),
            Math.floor(worldPoint.y / TILE_SIZE),
          );
        } else {
          this.isDrawing = true;
          this.host.beginTileBatch();
          this.eraseWithActiveBrush(worldPoint.x, worldPoint.y);
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
          if (editorState.activeTool === 'fill') {
            this.host.floodFillObjects(tileX, tileY);
          } else if (editorState.activeTool === 'pencil' && canRepeatSelectedEditorObject()) {
            this.host.beginObjectBatch(true);
            this.host.placeObjectAtTile(tileX, tileY);
            this.lastObjectDragCell = { x: tileX, y: tileY };
            this.isDrawing = true;
          } else {
            this.host.handleObjectPlace(pointer);
          }
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
        return;
      }

      if (editorState.paletteMode === 'objects') {
        if (this.isDrawing && pointer.leftButtonDown() && this.lastObjectDragCell) {
          const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
          this.placeDraggedObjects(Math.floor(worldPoint.x / TILE_SIZE), Math.floor(worldPoint.y / TILE_SIZE));
        }
        return;
      }

      if (this.isDrawing && pointer.leftButtonDown()) {
        const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        if (editorState.activeTool === 'pencil' && !isPencilSprayPlacement()) {
          this.placeDraggedTileStamp(worldPoint.x, worldPoint.y);
        } else if (editorState.activeTool === 'eraser') {
          this.host.eraseTileAt(worldPoint.x, worldPoint.y);
        } else if (editorState.activeTool === 'randomize') {
          this.host.paintRandomizeAt(worldPoint.x, worldPoint.y);
        }
      }

      if (this.updatePathBendPreview(pointer)) {
        return;
      }

      if (this.isDrawing && pointer.rightButtonDown()) {
        const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        if (this.shapeEraseActive && this.rectStart && isDragStampEditorTool(editorState.activeTool)) {
          const end = this.resolvePointerShapeEnd(pointer, worldPoint);
          this.drawActiveStampPreview(this.rectStart.x, this.rectStart.y, end.x, end.y);
        } else if (!this.shapeEraseActive && !isPencilSprayPlacement()) {
          this.eraseWithActiveBrush(worldPoint.x, worldPoint.y);
        }
      }

      if (
        (isDragStampEditorTool(editorState.activeTool) || editorState.activeTool === 'copy') &&
        this.rectStart &&
        pointer.leftButtonDown()
      ) {
        const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const end = this.resolvePointerShapeEnd(pointer, worldPoint);
        if (editorState.activeTool === 'copy') {
          this.drawRectPreview(this.rectStart.x, this.rectStart.y, end.x, end.y);
        } else {
          this.drawActiveStampPreview(this.rectStart.x, this.rectStart.y, end.x, end.y);
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

      if (this.lastObjectDragCell) {
        this.host.commitObjectBatch();
        this.lastObjectDragCell = null;
        this.isDrawing = false;
        return;
      }

      if (
        (isDragStampEditorTool(editorState.activeTool) || editorState.activeTool === 'copy') &&
        this.rectStart &&
        (pointer.leftButtonReleased() || (this.shapeEraseActive && pointer.rightButtonReleased()))
      ) {
        const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const end = this.resolvePointerShapeEnd(pointer, worldPoint);
        if (editorState.activeTool === 'copy') {
          this.host.captureCopySelection(this.rectStart.x, this.rectStart.y, end.x, end.y);
        } else if (isPathEditorTool(editorState.activeTool) && isEditorLineCurve()) {
          this.beginPathBend(this.rectStart, end, this.shapeEraseActive);
          this.isDrawing = false;
          this.shapeEraseActive = false;
          return;
        } else {
          const kind = getEditorStampKind(editorState.activeTool);
          if (kind) {
            this.host.stampShape(kind, this.rectStart.x, this.rectStart.y, end.x, end.y, {
              outline: isEditorShapeOutline(editorState.activeTool),
              erase: this.shapeEraseActive,
            });
          }
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

    this.scene.input.on('pointerupoutside', (pointer: Phaser.Input.Pointer) => {
      this.handleTouchPointerUp(pointer);
    });
    this.scene.input.on('wheel', (pointer: Phaser.Input.Pointer, _gameObjects: unknown[], _deltaX: number, deltaY: number) => {
      if (editorState.isPlaying || this.host.isMusicModeActive()) {
        return;
      }

      const zoomFactor = Phaser.Math.Clamp(Math.exp(-deltaY * 0.00055), 0.92, 1.08);
      this.handleZoom(zoomFactor, pointer.x, pointer.y);
    });

    this.scene.game.canvas.addEventListener('contextmenu', handleCanvasContextMenu);
  }

  setupKeyboard(): void {
    const keyboard = this.scene.input.keyboard!;
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

  private handleZoom(zoomFactor: number, screenX: number, screenY: number): void {
    if (this.host.isMusicModeActive()) {
      return;
    }

    const camera = this.scene.cameras.main;
    const nextZoom = Phaser.Math.Clamp(editorState.zoom * zoomFactor, 0.25, 6);
    if (Math.abs(nextZoom - editorState.zoom) < 0.0001) {
      return;
    }

    const anchor = getScreenAnchorWorldPoint(screenX, screenY, camera);
    editorState.zoom = nextZoom;
    camera.setZoom(nextZoom);
    const nextScroll = getScrollForScreenAnchor(anchor.x, anchor.y, screenX, screenY, camera);
    camera.setScroll(nextScroll.x, nextScroll.y);
    this.constrainEditorCamera();
    this.host.updateBackgroundPreview();
    this.host.updateZoomUI();
  }

  private getManualZoomAnchor(): { x: number; y: number } {
    const camera = this.scene.cameras.main;
    const pointer = this.scene.input.activePointer;
    if (
      pointer &&
      pointer.x >= 0 &&
      pointer.y >= 0 &&
      pointer.x <= camera.width &&
      pointer.y <= camera.height
    ) {
      return { x: pointer.x, y: pointer.y };
    }

    return { x: camera.width * 0.5, y: camera.height * 0.5 };
  }

  private drawRectPreview(x1: number, y1: number, x2: number, y2: number): void {
    this.drawShapeTilesPreview('rect', x1, y1, x2, y2, false, true);
  }

  private drawActiveStampPreview(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    mid?: TilePoint,
    curveBend = false,
  ): void {
    const kind = getEditorStampKind(editorState.activeTool, curveBend);
    if (!kind) {
      return;
    }
    this.drawShapeTilesPreview(kind, x1, y1, x2, y2, isEditorShapeOutline(editorState.activeTool), false, mid);
  }

  private beginPathBend(start: TilePoint, end: TilePoint, erase: boolean): void {
    const mid = {
      x: Math.round((start.x + end.x) / 2),
      y: Math.round((start.y + end.y) / 2),
    };
    this.pathBend = {
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
      mid,
      erase,
    };
    this.rectStart = null;
    this.drawPathBendPreview();
  }

  private drawPathBendPreview(): void {
    if (!this.pathBend) {
      return;
    }
    this.drawShapeTilesPreview(
      'curve',
      this.pathBend.start.x,
      this.pathBend.start.y,
      this.pathBend.end.x,
      this.pathBend.end.y,
      false,
      false,
      this.pathBend.mid,
    );
  }

  private resolvePathBendPointer(pointer: Phaser.Input.Pointer): boolean {
    if (!this.pathBend) {
      return false;
    }

    if (pointer.rightButtonDown()) {
      if (this.pathBend.erase) {
        this.host.beginTileBatch();
        this.host.stampShape(
          'curve',
          this.pathBend.start.x,
          this.pathBend.start.y,
          this.pathBend.end.x,
          this.pathBend.end.y,
          { erase: true, mid: this.pathBend.mid },
        );
        this.host.commitTileBatch();
      }
      this.clearShapePreview();
      return true;
    }

    if (pointer.leftButtonDown()) {
      if (!this.pathBend.erase) {
        this.host.beginTileBatch();
        this.host.stampShape(
          'curve',
          this.pathBend.start.x,
          this.pathBend.start.y,
          this.pathBend.end.x,
          this.pathBend.end.y,
          { erase: false, mid: this.pathBend.mid },
        );
        this.host.commitTileBatch();
      }
      this.clearShapePreview();
      return true;
    }

    return false;
  }

  private updatePathBendPreview(pointer: Phaser.Input.Pointer): boolean {
    if (!this.pathBend) {
      return false;
    }
    const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.pathBend.mid = {
      x: Math.floor(worldPoint.x / TILE_SIZE),
      y: Math.floor(worldPoint.y / TILE_SIZE),
    };
    this.drawPathBendPreview();
    return true;
  }

  private drawShapeTilesPreview(
    kind: EditorShapeKind,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    outline: boolean,
    copySelection: boolean,
    mid?: TilePoint,
  ): void {
    this.rectPreviewGraphics?.clear();
    if (!this.rectPreviewGraphics) {
      return;
    }

    const minX = Math.min(x1, x2);
    const minY = Math.min(y1, y2);
    const maxX = Math.max(x1, x2);
    const maxY = Math.max(y1, y2);
    const pathTool = kind === 'line' || kind === 'curve';
    this.rectPreviewGraphics.fillStyle(RETRO_COLORS.draft, copySelection || !outline ? 0.15 : 0.22);
    if (copySelection || (kind === 'rect' && !outline)) {
      this.rectPreviewGraphics.fillRect(
        minX * TILE_SIZE,
        minY * TILE_SIZE,
        (maxX - minX + 1) * TILE_SIZE,
        (maxY - minY + 1) * TILE_SIZE,
      );
    } else {
      for (const tile of iterateShapeTiles(kind, x1, y1, x2, y2, outline, mid)) {
        this.rectPreviewGraphics.fillRect(tile.x * TILE_SIZE, tile.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
    if (!pathTool) {
      this.rectPreviewGraphics.lineStyle(1, RETRO_COLORS.draft, 0.65);
      this.rectPreviewGraphics.strokeRect(
        minX * TILE_SIZE,
        minY * TILE_SIZE,
        (maxX - minX + 1) * TILE_SIZE,
        (maxY - minY + 1) * TILE_SIZE,
      );
    }
  }

  private resolvePointerShapeEnd(
    pointer: Phaser.Input.Pointer,
    worldPoint: Phaser.Math.Vector2,
  ): { x: number; y: number } {
    const current = {
      x: Math.floor(worldPoint.x / TILE_SIZE),
      y: Math.floor(worldPoint.y / TILE_SIZE),
    };
    if (!this.rectStart || editorState.activeTool === 'copy') {
      return current;
    }
    if (isPathEditorTool(editorState.activeTool)) {
      return resolveEditorLineEnd(this.rectStart, current, isPointerShiftDown(pointer));
    }
    return resolveShapeEnd(this.rectStart, current, isPointerShiftDown(pointer));
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
    if (!this.isTouchPointer(pointer)) return false;
    if (editorState.isPlaying) return true;
    const action = this.touchGesture.down(pointer);
    if (this.host.isMusicModeActive()) {
      if (action === 'edit') this.host.handleMusicPointerDown(pointer);
      return true;
    }
    if (action === 'pinch') {
      this.cancelTouchEdit();
      this.beginPinchGesture();
      return true;
    }
    if (action !== 'edit') return true;

    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tile = { x: Math.floor(world.x / TILE_SIZE), y: Math.floor(world.y / TILE_SIZE) };
    if (tile.x < 0 || tile.x >= ROOM_WIDTH || tile.y < 0 || tile.y >= ROOM_HEIGHT) return true;
    this.touchStartTile = tile;
    this.touchToolKey = editorTouchToolKey();
    if (this.pathBend) {
      this.touchAction = 'bend';
      this.updatePathBendPreview(pointer);
    } else if (this.host.getGoalPlacementMode() || this.host.isClipboardPastePreviewActive()
      || editorState.activeTool === 'fill') {
      this.touchAction = 'tap';
    } else if (editorState.paletteMode === 'objects') {
      // Object clicks may open inspectors or edit links. Leave those until a real tap;
      // repeatable brushes start only once the finger actually drags.
      this.touchAction = editorState.activeTool === 'pencil' && canRepeatSelectedEditorObject()
        ? 'objects' : 'tap';
    } else {
      this.touchAction = isDragStampEditorTool(editorState.activeTool) || editorState.activeTool === 'copy'
        ? 'shape' : 'tiles';
      if (this.touchAction === 'shape') {
        this.host.handleToolDown(pointer);
        this.isDrawing = true;
      } else {
        this.touchCandidate.down(pointer, () => {
          this.validateTouchEdit();
          if (this.touchAction !== 'tiles') return;
          this.host.beginTileBatch();
          if (editorState.activeTool === 'pencil') this.host.placeTileAt(world.x, world.y);
          else if (editorState.activeTool === 'eraser') this.host.eraseTileAt(world.x, world.y);
          else if (editorState.activeTool === 'randomize') this.host.paintRandomizeAt(world.x, world.y);
          this.isDrawing = true;
          this.beginTileDrag(tile.x, tile.y);
        });
      }
    }
    return true;
  }

  private handleTouchPointerMove(pointer: Phaser.Input.Pointer): boolean {
    if (!this.isTouchPointer(pointer)) return false;
    this.validateTouchEdit();
    const action = this.touchGesture.move(pointer);
    if (this.host.isMusicModeActive()) {
      if (action === 'edit') this.host.handleMusicPointerMove(pointer);
      return true;
    }
    if (action === 'pinch') {
      this.handlePinchMove();
      return true;
    }
    if (action !== 'edit' || !this.touchAction) return true;
    if (this.touchAction === 'bend') {
      this.updatePathBendPreview(pointer);
      return true;
    }
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (this.touchAction === 'objects') {
      if (!this.isDrawing && this.touchGesture.isDrag && this.touchStartTile) {
        this.host.beginObjectBatch(true);
        this.lastObjectDragCell = this.touchStartTile;
        this.host.placeObjectAtTile(this.touchStartTile.x, this.touchStartTile.y);
        this.isDrawing = true;
      }
      if (this.isDrawing) this.placeDraggedObjects(Math.floor(world.x / TILE_SIZE), Math.floor(world.y / TILE_SIZE));
    } else if (this.touchAction === 'shape' && this.rectStart) {
      const end = this.resolvePointerShapeEnd(pointer, world);
      if (editorState.activeTool === 'copy') this.drawRectPreview(this.rectStart.x, this.rectStart.y, end.x, end.y);
      else this.drawActiveStampPreview(this.rectStart.x, this.rectStart.y, end.x, end.y);
    } else if (this.touchAction === 'tiles') {
      this.touchCandidate.move(pointer);
      if (!this.isDrawing) return true;
      if (editorState.activeTool === 'pencil' && !isPencilSprayPlacement()) this.placeDraggedTileStamp(world.x, world.y);
      else if (editorState.activeTool === 'eraser') this.host.eraseTileAt(world.x, world.y);
      else if (editorState.activeTool === 'randomize') this.host.paintRandomizeAt(world.x, world.y);
    }
    return true;
  }

  private handleTouchPointerUp(pointer: Phaser.Input.Pointer): boolean {
    if (!this.isTouchPointer(pointer)) return false;
    this.validateTouchEdit();
    const result = this.touchGesture.up(pointer);
    if (this.host.isMusicModeActive()) {
      if (result !== 'ignore') this.host.handleMusicPointerUp(pointer);
      return true;
    }
    if (pointer.event?.type === 'touchcancel') {
      this.cancelTouchEdit();
      return true;
    }
    if (result === 'ignore') return true;
    if (this.touchAction === 'tiles') this.touchCandidate.activate();
    this.touchCandidate.cancel();
    const action = this.touchAction;
    this.touchAction = null;
    this.touchStartTile = null;
    if (action === 'tap' || (action === 'objects' && !this.isDrawing)) {
      if (result === 'tap') this.applyTouchTap(pointer);
      return true;
    }
    if (action === 'bend' && this.pathBend) {
      this.updatePathBendPreview(pointer);
      const bend = this.pathBend;
      this.host.beginTileBatch();
      this.host.stampShape('curve', bend.start.x, bend.start.y, bend.end.x, bend.end.y,
        { erase: bend.erase, mid: bend.mid });
      this.host.commitTileBatch();
      this.clearShapePreview();
      return true;
    }
    if (action === 'tiles' && result === 'tap' && editorState.activeTool === 'eraser') {
      const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      // Marker removal owns its own history. Undo the uncommitted terrain preview first.
      this.host.cancelTileBatch();
      if (!this.host.removeGoalMarkerAt(world.x, world.y)) {
        this.host.beginTileBatch();
        this.host.eraseTileAt(world.x, world.y);
      }
    }
    this.finishCurrentTouchDraw(pointer);
    return true;
  }

  private applyTouchTap(pointer: Phaser.Input.Pointer): void {
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tileX = Math.floor(world.x / TILE_SIZE);
    const tileY = Math.floor(world.y / TILE_SIZE);
    if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) return;
    if (this.host.getGoalPlacementMode()) {
      this.host.placeGoalMarker(tileX, tileY);
    } else if (editorState.activeTool === 'eraser' && this.host.removeGoalMarkerAt(world.x, world.y)) {
      return;
    } else if (editorState.paletteMode === 'objects') {
      if (editorState.activeTool === 'eraser') {
        if (!this.host.handleObjectModeSecondaryAction(world.x, world.y)) this.host.removeObjectAt(world.x, world.y);
      } else if (!this.host.handleObjectModePrimaryAction(pointer)) {
        if (editorState.activeTool === 'fill') this.host.floodFillObjects(tileX, tileY);
        else this.host.handleObjectPlace(pointer);
      }
    } else if (this.host.isClipboardPastePreviewActive()) {
      this.host.pasteClipboardAt(tileX, tileY);
    } else {
      this.host.handleToolDown(pointer);
    }
  }

  /** Pinch and lifecycle cancellation never consume a committed history entry. */
  cancelTouchEdit(): void {
    this.touchCandidate.cancel();
    if (this.touchAction === 'tiles' || this.touchAction === 'shape') this.host.cancelTileBatch();
    if (this.touchAction === 'objects' && this.isDrawing) this.host.cancelObjectBatch();
    this.touchGesture.suppress();
    this.touchAction = null;
    this.touchStartTile = null;
    this.lastObjectDragCell = null;
    this.isDrawing = false;
    this.clearShapePreview();
    this.clearTileDrag();
    this.sprayRemainder = 0;
  }

  private finishCurrentTouchDraw(pointer: Phaser.Input.Pointer): void {
    if (this.lastObjectDragCell) {
      this.host.commitObjectBatch();
      this.lastObjectDragCell = null;
    } else if (this.rectStart) {
      const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const end = this.resolvePointerShapeEnd(pointer, world);
      if (editorState.activeTool === 'copy') {
        this.host.captureCopySelection(this.rectStart.x, this.rectStart.y, end.x, end.y);
      } else if (isPathEditorTool(editorState.activeTool) && isEditorLineCurve()) {
        this.beginPathBend(this.rectStart, end, false);
        this.isDrawing = false;
        return;
      } else {
        const kind = getEditorStampKind(editorState.activeTool);
        if (kind) this.host.stampShape(kind, this.rectStart.x, this.rectStart.y, end.x, end.y,
          { outline: isEditorShapeOutline(editorState.activeTool), erase: false });
        this.host.commitTileBatch();
      }
    } else if (this.isDrawing) this.host.commitTileBatch();
    this.isDrawing = false;
    this.clearShapePreview();
    this.clearTileDrag();
  }

  private eraseWithActiveBrush(worldX: number, worldY: number): void {
    if (isPencilSprayPlacement() || (editorState.activeTool === 'pencil' && editorState.paletteMode === 'tiles')) {
      this.host.eraseStampAt(worldX, worldY);
      return;
    }
    this.host.eraseTileAt(worldX, worldY);
  }

  private placeDraggedObjects(tileX: number, tileY: number): void {
    const previous = this.lastObjectDragCell;
    if (!previous) return;
    if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) return;
    forEachDraggedTileCell(previous, { x: tileX, y: tileY }, (x, y) => {
      if (x >= 0 && x < ROOM_WIDTH && y >= 0 && y < ROOM_HEIGHT) {
        this.host.placeObjectAtTile(x, y);
      }
    });
    this.lastObjectDragCell = { x: tileX, y: tileY };
  }

  private beginTileDrag(tileX: number, tileY: number): void {
    if (
      editorState.paletteMode === 'objects' ||
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

    const previous = this.lastDraggedStampOrigin;
    this.lastDraggedStampOrigin = { ...stampOrigin };
    if (editorState.paletteMode !== 'smart' || !previous) {
      this.host.placeTileAt(stampOrigin.x * TILE_SIZE, stampOrigin.y * TILE_SIZE);
      return;
    }

    // Pointer events can skip several grid cells during a quick stroke. Fill
    // the segment so a vertical wall does not become disconnected grass caps.
    let x = previous.x;
    let y = previous.y;
    const dx = Math.abs(stampOrigin.x - x);
    const sx = x < stampOrigin.x ? 1 : -1;
    const dy = -Math.abs(stampOrigin.y - y);
    const sy = y < stampOrigin.y ? 1 : -1;
    let error = dx + dy;
    const points: TilePoint[] = [];
    while (x !== stampOrigin.x || y !== stampOrigin.y) {
      const doubled = error * 2;
      if (doubled >= dy) {
        error += dy;
        x += sx;
      }
      if (doubled <= dx) {
        error += dx;
        y += sy;
      }
      points.push({ x: x * TILE_SIZE, y: y * TILE_SIZE });
    }
    this.host.placeTileStroke(points);
  }

  private getDraggedStampOrigin(tileX: number, tileY: number): { x: number; y: number } {
    if (
      !this.isDrawing ||
      editorState.paletteMode === 'objects' ||
      editorState.activeTool !== 'pencil' ||
      !this.tileDragStart
    ) {
      return { x: tileX, y: tileY };
    }

    const stampPlacement = isPencilStampPlacement();
    const selectionWidth = editorState.paletteMode === 'smart' || !stampPlacement
      ? 1
      : Math.max(1, editorState.selection.width);
    const selectionHeight = editorState.paletteMode === 'smart' || !stampPlacement
      ? 1
      : Math.max(1, editorState.selection.height);
    return resolvePencilStampOrigin(
      this.tileDragStart,
      { x: tileX, y: tileY },
      selectionWidth,
      selectionHeight,
      editorState.pencilContinuousStamping || !stampPlacement,
    );
  }

  private beginPinchGesture(): void {
    const points = Array.from(this.touchGesture.points.values());
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
    const points = Array.from(this.touchGesture.points.values());
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
        editorState.zoom = nextZoom;
        this.scene.cameras.main.setZoom(editorState.zoom);
        this.host.updateZoomUI();
      }
      this.pinchDistance = nextDistance;
    }

    this.scrollWorldPointToScreen(this.pinchAnchorWorld.x, this.pinchAnchorWorld.y, centerX, centerY);
    this.constrainEditorCamera();
    this.host.updateBackgroundPreview();
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
    if (pointer.wasTouch) return true;
    const event = pointer.event as PointerEvent | undefined;
    return event?.pointerType === 'touch' || event?.pointerType === 'pen';
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
