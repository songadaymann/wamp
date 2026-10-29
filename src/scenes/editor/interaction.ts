import { drawEditorShapePreview, EditorPathBendController } from './shapeInteraction';
import { applyEditorMusicCameraFit } from './musicCameraFit';
import { applyInspectPointerPan, zoomInspectCamera } from '../overworld/inspectCameraGestures';
import { drawEditorCursor } from './cursorPreview';
import Phaser from 'phaser';
import { roomVideoPointerDown, roomVideoPointerMove, roomVideoPointerUp } from '../../roomVideo/frames';
import { mouseButtonsReleased } from '../pointerRelease';
import { EditorTouchCandidate, EditorTouchGesture, editorTouchToolKey } from './touchGesture';
import {
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILE_SIZE,
  editorState, updateEditorState,
} from '../../config';
import { isTextInputFocused } from '../../ui/keyboardFocus';
import { getDeviceLayoutState } from '../../ui/deviceLayout';
import type { EditorClipboardState, GoalPlacementMode } from './editRuntime';
import type { EditorObjectMoveController } from './objectMoveController';
import {
  canRepeatSelectedEditorObject,
  getEditorStampKind,
  isDragStampEditorTool,
  isEditorLineCurve,
  resolveEditorLineEnd,
  isEditorShapeOutline,
  isPathEditorTool,
  isPencilSprayPlacement,
} from './editorToolSelection';
import { forEachDraggedTileCell } from './stampDrag';
import { placeEditorPencilStroke, resolveEditorPencilOrigin } from './pencilStroke';
import { EditorSprayTicker } from './sprayTicker';
import { resolveShapeEnd, type EditorShapeKind, type TilePoint } from './shapeTiles';
import {
  clearMusicWorkbenchFrame,
  MusicRoomFitController,
} from './musicRoomFit';

function isPointerShiftDown(pointer: Phaser.Input.Pointer): boolean {
  const event = pointer.event as MouseEvent | KeyboardEvent | TouchEvent | undefined;
  return Boolean(event && 'shiftKey' in event && event.shiftKey);
}


interface EditorInteractionHost {
  objectMove?: EditorObjectMoveController;
  isPracticeTestPlacementActive?: () => boolean;
  tryStartPracticeTestAt?: (tileX: number, tileY: number) => boolean;
  cancelPracticeTestPlacement?: () => boolean;
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
  private readonly sprayTicker = new EditorSprayTicker();
  private spaceDown = false;
  private rectStart: { x: number; y: number } | null = null;
  private shapeEraseActive = false;
  private readonly pathController = new EditorPathBendController<null>({
    preview: bend => this.drawShapeTilesPreview('curve', bend.start.x, bend.start.y,
      bend.end.x, bend.end.y, false, false, bend.mid),
    stamp: bend => {
      this.host.beginTileBatch();
      this.host.stampShape('curve', bend.start.x, bend.start.y, bend.end.x, bend.end.y,
        { erase: bend.erase, mid: bend.mid });
      this.host.commitTileBatch();
    },
    finish: () => this.clearShapePreview(),
  });
  private get pathBend() { return this.pathController.bend; }
  private readonly cursorCoordsEls: HTMLElement[];
  private readonly touchGesture = new EditorTouchGesture();
  private readonly touchCandidate = new EditorTouchCandidate((delay, callback) => {
    const timer = this.scene.time.delayedCall(delay, callback);
    return () => timer.remove(false);
  });
  private touchAction: 'tiles' | 'objects' | 'shape' | 'tap' | 'bend' | 'move' | null = null;
  private touchStartTile: TilePoint | null = null;
  private touchToolKey = '';
  private pinchDistance = 0;
  private pinchAnchor = { x: 0, y: 0 };
  private pinchAnchorWorld = { x: 0, y: 0 };
  // Focus leaving the game (Alt-Tab, a text field, a hidden tab) swallows key and
  // button releases: finish any stroke or pan and forget a held Space.
  private readonly handleInputBlur = (): void => {
    if (this.touchAction) this.cancelTouchEdit();
    this.spaceDown = false;
    const pointer = this.scene.input.activePointer;
    if ((this.isPanning || this.isDrawing) && pointer.isDown && !pointer.wasTouch) this.handleMouseUp(pointer, true);
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
    this.host.objectMove?.validate();
    if (this.touchAction && (this.touchToolKey !== editorTouchToolKey()
      || this.scene.game.canvas.ownerDocument.body.dataset.editorSpriteUiLocked === 'true'
      || this.host.isMusicModeActive() || editorState.isPlaying)) this.cancelTouchEdit();
  }

  tickSpray(deltaMs: number): void {
    const pointer = this.scene.input.activePointer;
    const erasing = pointer.rightButtonDown();
    const active = this.isDrawing && isPencilSprayPlacement() && (pointer.leftButtonDown() || erasing);
    this.sprayTicker.tick(deltaMs, active, editorState.pencilSprayBrushSize, editorState.pencilSprayRate, () => {
      const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      if (erasing) this.host.eraseStampAt(world.x, world.y);
      else this.host.placeTileAt(world.x, world.y);
    });
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
    this.pathController.clear();
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


  reset(): void {
    this.scene.game.events.off('blur', this.handleInputBlur);
    this.scene.game.events.off('hidden', this.handleInputBlur);
    this.scene.events.off('sleep', this.handleInputBlur);
    this.cursorGraphics?.destroy();
    this.rectPreviewGraphics?.destroy();
    this.cursorGraphics = null;
    this.rectPreviewGraphics = null;
    this.isPanning = false;
    this.isDrawing = false;
    this.lastObjectDragCell = null;
    this.tileDragStart = null;
    this.lastDraggedStampOrigin = null;
    this.sprayTicker.reset();
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
      applyEditorMusicCameraFit(this.scene.cameras.main, this.scene.game.canvas, { x: 0, y: 0 },
        zoom => updateEditorState({ zoom }));
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

    updateEditorState({ zoom: usePhonePortraitFit
      ? Number(fitZoom.toFixed(2))
      : Math.round(fitZoom * 4) / 4 });
    updateEditorState({ zoom: Math.max(0.25, Math.min(6, editorState.zoom)) });

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
    if (editorState.activeTool === 'move') {
      this.cursorGraphics?.clear();
      this.host.objectMove?.hover(this.scene.input.activePointer);
      return;
    }
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

    drawEditorCursor(this.cursorGraphics, {
      tile: { x: tileX, y: tileY },
      goalPlacement: Boolean(this.host.getGoalPlacementMode()),
      practicePlacement: this.host.isPracticeTestPlacementActive?.(),
      clipboard: this.host.isClipboardPastePreviewActive() ? this.host.getClipboardPreview() : null,
      stampOrigin: this.getDraggedStampOrigin(tileX, tileY),
      erasing: pointer.rightButtonDown(),
    });
    this.updateCursorCoords(tileX, tileY);
  }

  // Mouse releases over a panel or outside the window arrive as 'pointerupoutside';
  // they finish the stroke, shape or pan exactly like a release over the canvas.
  private readonly handleMouseUp = (pointer: Phaser.Input.Pointer, outside = false): void => {
    if (roomVideoPointerUp(this.scene)) return;
    if (!this.isTouchPointer(pointer) && this.host.objectMove?.up(pointer, outside)) return;
    if (this.handleTouchPointerUp(pointer, outside)) {
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
  };

  setupInput(handleCanvasContextMenu: (event: Event) => void): void {
    this.scene.game.events.on('blur', this.handleInputBlur);
    this.scene.game.events.on('hidden', this.handleInputBlur);
    this.scene.events.on('sleep', this.handleInputBlur);
    this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (
        pointer.leftButtonDown()
        && !this.spaceDown
        && roomVideoPointerDown(this.scene, pointer)
      ) {
        return;
      }
      // Touch reaches Move through the touch gesture, so a second finger pinches (F371).
      if (this.spaceDown || pointer.middleButtonDown()) this.host.objectMove?.stopGesture();
      else if (!this.isTouchPointer(pointer) && this.host.objectMove?.down(pointer)) return;
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
        if (this.host.cancelPracticeTestPlacement?.()) return;
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
      if (this.host.tryStartPracticeTestAt?.(tileX, tileY)) return;
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
      if (roomVideoPointerMove(this.scene, pointer)) {
        return;
      }
      if (!this.isTouchPointer(pointer) && this.host.objectMove?.move(pointer)) return;
      if (this.handleTouchPointerMove(pointer)) {
        return;
      }

      if ((this.isPanning || this.isDrawing) && mouseButtonsReleased(pointer)) {
        this.handleMouseUp(pointer, true);
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
        applyInspectPointerPan(this.scene.cameras.main, this.panStartPointer, this.panStartScroll, pointer);
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

    this.scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => this.handleMouseUp(pointer));
    this.scene.input.on('pointerupoutside', (pointer: Phaser.Input.Pointer) => this.handleMouseUp(pointer, true));
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

    if (!zoomInspectCamera({ camera: this.scene.cameras.main, minZoom: 0.25, maxZoom: 6,
      sourceZoom: editorState.zoom, storeZoom: zoom => updateEditorState({ zoom }),
      constrain: () => this.constrainEditorCamera(),
    }, zoomFactor, { x: screenX, y: screenY })) return;
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
    this.rectStart = null;
    this.pathController.begin(null, start, end, erase);
  }

  private resolvePathBendPointer(pointer: Phaser.Input.Pointer): boolean {
    return this.pathController.resolve(pointer.leftButtonDown(), pointer.rightButtonDown());
  }

  private updatePathBendPreview(pointer: Phaser.Input.Pointer): boolean {
    if (!this.pathBend) return false;
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.pathController.update({ x: Math.floor(world.x / TILE_SIZE), y: Math.floor(world.y / TILE_SIZE) });
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
    drawEditorShapePreview(this.rectPreviewGraphics, kind, { x: x1, y: y1 }, { x: x2, y: y2 },
      { outline, copy: copySelection, mid });
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
    // Move starts only once the finger drags or holds, like a brush, so a second finger can
    // still pinch before Move drops the selection or shows a status (F371).
    if (this.host.objectMove?.claims()) {
      const start = { x: pointer.x, y: pointer.y };
      this.touchAction = 'move';
      this.touchToolKey = editorTouchToolKey();
      this.touchCandidate.down(pointer, () => {
        this.validateTouchEdit();
        if (this.touchAction !== 'move') return;
        this.host.objectMove?.down(pointer, start);
        this.touchToolKey = editorTouchToolKey();
      });
      return true;
    }

    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tile = { x: Math.floor(world.x / TILE_SIZE), y: Math.floor(world.y / TILE_SIZE) };
    if (tile.x < 0 || tile.x >= ROOM_WIDTH || tile.y < 0 || tile.y >= ROOM_HEIGHT) return true;
    this.touchStartTile = tile;
    this.touchToolKey = editorTouchToolKey();
    if (this.pathBend) {
      this.touchAction = 'bend';
      this.updatePathBendPreview(pointer);
    } else if (this.host.getGoalPlacementMode() || this.host.isPracticeTestPlacementActive?.() || this.host.isClipboardPastePreviewActive()
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
    if (this.touchAction === 'move') {
      this.touchCandidate.move(pointer);
      if (this.touchCandidate.isStarted) this.host.objectMove?.move(pointer);
      return true;
    }
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

  private handleTouchPointerUp(pointer: Phaser.Input.Pointer, outside = false): boolean {
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
    if (this.touchAction === 'tiles' || this.touchAction === 'move') this.touchCandidate.activate();
    this.touchCandidate.cancel();
    const action = this.touchAction;
    this.touchAction = null;
    this.touchStartTile = null;
    if (action === 'move') {
      this.host.objectMove?.up(pointer, outside);
      return true;
    }
    if (action === 'tap' || (action === 'objects' && !this.isDrawing)) {
      if (result === 'tap') this.applyTouchTap(pointer);
      return true;
    }
    if (action === 'bend' && this.pathBend) {
      this.updatePathBendPreview(pointer);
      this.pathController.commit();
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
    if (this.host.tryStartPracticeTestAt?.(tileX, tileY)) return;
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
    if (this.touchAction === 'move') this.host.objectMove?.stopGesture();
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
    this.sprayTicker.reset();
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

    placeEditorPencilStroke(this.host, this.lastDraggedStampOrigin, stampOrigin);
    this.lastDraggedStampOrigin = { ...stampOrigin };
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

    return resolveEditorPencilOrigin(this.tileDragStart, { x: tileX, y: tileY });
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
        updateEditorState({ zoom: nextZoom });
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
