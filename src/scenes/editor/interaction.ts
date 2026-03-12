import Phaser from 'phaser';
import {
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILE_SIZE,
  editorState,
  getObjectById,
} from '../../config';
import { RETRO_COLORS } from '../../visuals/starfield';
import { getDeviceLayoutState, isMobileLandscapeBlocked } from '../../ui/deviceLayout';
import type { GoalPlacementMode } from './editRuntime';

interface EditorInteractionHost {
  getNeighborRadius(): number;
  getGoalPlacementMode(): GoalPlacementMode;
  handleObjectPlace(pointer: Phaser.Input.Pointer): void;
  handleToolDown(pointer: Phaser.Input.Pointer): void;
  removeGoalMarkerAt(worldX: number, worldY: number): boolean;
  removeObjectAt(worldX: number, worldY: number): void;
  placeGoalMarker(tileX: number, tileY: number): void;
  placeTileAt(worldX: number, worldY: number): void;
  eraseTileAt(worldX: number, worldY: number): void;
  fillRect(x1: number, y1: number, x2: number, y2: number): void;
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
  private spaceDown = false;
  private rectStart: { x: number; y: number } | null = null;
  private readonly cursorCoordsEl: HTMLElement | null;
  private touchPointers = new Map<number, { x: number; y: number }>();
  private touchPrimaryPointerId: number | null = null;
  private pinchDistance = 0;
  private pinchAnchor = { x: 0, y: 0 };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: EditorInteractionHost,
    doc: Document = document,
  ) {
    this.cursorCoordsEl = doc.getElementById('cursor-coords');
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

  reset(): void {
    this.cursorGraphics?.destroy();
    this.rectPreviewGraphics?.destroy();
    this.cursorGraphics = null;
    this.rectPreviewGraphics = null;
    this.isPanning = false;
    this.isDrawing = false;
    this.spaceDown = false;
    this.rectStart = null;
    this.touchPointers = new Map();
    this.touchPrimaryPointerId = null;
    this.pinchDistance = 0;
    this.pinchAnchor = { x: 0, y: 0 };
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
    this.centerCameraOnRoom();
  }

  centerCameraOnRoom(): void {
    const cam = this.scene.cameras.main;
    cam.setZoom(editorState.zoom);
    cam.centerOn(ROOM_PX_WIDTH / 2, ROOM_PX_HEIGHT / 2);
    this.constrainEditorCamera();
  }

  fitToScreen(): void {
    const viewW = this.scene.scale.width;
    const viewH = this.scene.scale.height;
    const padding = 32;
    const fitZoom = Math.min(
      (viewW - padding) / ROOM_PX_WIDTH,
      (viewH - padding) / ROOM_PX_HEIGHT,
    );

    editorState.zoom = Math.round(fitZoom * 4) / 4;
    editorState.zoom = Math.max(0.25, Math.min(6, editorState.zoom));

    this.centerCameraOnRoom();
    this.host.updateBackgroundPreview();
    this.host.updateZoomUI();
  }

  updateCursorHighlight(): void {
    this.cursorGraphics?.clear();
    if (!this.cursorGraphics || editorState.isPlaying || isMobileLandscapeBlocked()) {
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
      const objectConfig = editorState.selectedObjectId ? getObjectById(editorState.selectedObjectId) : null;
      if (objectConfig && editorState.activeTool !== 'eraser') {
        this.cursorGraphics.fillStyle(RETRO_COLORS.draft, 0.14);
        this.cursorGraphics.fillRect(
          tileX * TILE_SIZE,
          tileY * TILE_SIZE + TILE_SIZE - objectConfig.frameHeight,
          objectConfig.frameWidth,
          objectConfig.frameHeight,
        );
        this.cursorGraphics.lineStyle(1, RETRO_COLORS.draft, 0.75);
        this.cursorGraphics.strokeRect(
          tileX * TILE_SIZE,
          tileY * TILE_SIZE + TILE_SIZE - objectConfig.frameHeight,
          objectConfig.frameWidth,
          objectConfig.frameHeight,
        );
      } else {
        this.cursorGraphics.lineStyle(2, RETRO_COLORS.danger, 0.85);
        this.cursorGraphics.strokeRect(tileX * TILE_SIZE, tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
      this.updateCursorCoords(tileX, tileY);
      return;
    }

    const selection = editorState.selection;
    const cursorW = editorState.activeTool === 'pencil' ? selection.width : 1;
    const cursorH = editorState.activeTool === 'pencil' ? selection.height : 1;

    if (editorState.activeTool === 'eraser') {
      this.cursorGraphics.lineStyle(2, RETRO_COLORS.danger, 0.85);
      this.cursorGraphics.strokeRect(tileX * TILE_SIZE, tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    } else {
      this.cursorGraphics.fillStyle(RETRO_COLORS.draft, 0.18);
      this.cursorGraphics.fillRect(
        tileX * TILE_SIZE,
        tileY * TILE_SIZE,
        cursorW * TILE_SIZE,
        cursorH * TILE_SIZE,
      );
      this.cursorGraphics.lineStyle(1, RETRO_COLORS.draft, 0.8);
      this.cursorGraphics.strokeRect(
        tileX * TILE_SIZE,
        tileY * TILE_SIZE,
        cursorW * TILE_SIZE,
        cursorH * TILE_SIZE,
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
          this.host.removeObjectAt(worldPoint.x, worldPoint.y);
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

      const goalPlacementMode = this.host.getGoalPlacementMode();
      if (goalPlacementMode) {
        const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const tileX = Math.floor(worldPoint.x / TILE_SIZE);
        const tileY = Math.floor(worldPoint.y / TILE_SIZE);
        if (tileX >= 0 && tileX < ROOM_WIDTH && tileY >= 0 && tileY < ROOM_HEIGHT) {
          this.host.placeGoalMarker(tileX, tileY);
        }
        return;
      }

      if (editorState.paletteMode === 'objects') {
        this.host.handleObjectPlace(pointer);
      } else {
        this.host.handleToolDown(pointer);
        if (editorState.activeTool !== 'fill') {
          this.isDrawing = true;
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

      if (this.isPanning) {
        const dx = (this.panStartPointer.x - pointer.x) / this.scene.cameras.main.zoom;
        const dy = (this.panStartPointer.y - pointer.y) / this.scene.cameras.main.zoom;
        this.scene.cameras.main.scrollX = this.panStartScroll.x + dx;
        this.scene.cameras.main.scrollY = this.panStartScroll.y + dy;
        this.constrainEditorCamera();
        this.host.updateBackgroundPreview();
        return;
      }

      if (editorState.paletteMode !== 'tiles') {
        return;
      }

      if (this.isDrawing && pointer.leftButtonDown()) {
        const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        if (editorState.activeTool === 'pencil') {
          this.host.placeTileAt(worldPoint.x, worldPoint.y);
        } else if (editorState.activeTool === 'eraser') {
          this.host.eraseTileAt(worldPoint.x, worldPoint.y);
        }
      }

      if (this.isDrawing && pointer.rightButtonDown()) {
        const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.host.eraseTileAt(worldPoint.x, worldPoint.y);
      }

      if (editorState.activeTool === 'rect' && this.rectStart && pointer.leftButtonDown()) {
        const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const endX = Math.floor(worldPoint.x / TILE_SIZE);
        const endY = Math.floor(worldPoint.y / TILE_SIZE);
        this.drawRectPreview(this.rectStart.x, this.rectStart.y, endX, endY);
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

      if (!this.isDrawing) {
        return;
      }

      if (editorState.activeTool === 'rect' && this.rectStart && pointer.leftButtonReleased()) {
        const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const endX = Math.floor(worldPoint.x / TILE_SIZE);
        const endY = Math.floor(worldPoint.y / TILE_SIZE);
        this.host.fillRect(this.rectStart.x, this.rectStart.y, endX, endY);
        this.rectStart = null;
        this.rectPreviewGraphics?.clear();
      }

      this.host.commitTileBatch();
      this.isDrawing = false;
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
    keyboard.on('keydown-B', () => { editorState.activeTool = 'pencil'; this.host.updateToolUi(); });
    keyboard.on('keydown-R', () => { editorState.activeTool = 'rect'; this.host.updateToolUi(); });
    keyboard.on('keydown-G', () => { editorState.activeTool = 'fill'; this.host.updateToolUi(); });
    keyboard.on('keydown-E', () => { editorState.activeTool = 'eraser'; this.host.updateToolUi(); });
    keyboard.on('keydown-F', () => { this.fitToScreen(); });
    keyboard.on('keydown-SPACE', () => { this.spaceDown = true; });
    keyboard.on('keyup-SPACE', () => { this.spaceDown = false; this.isPanning = false; });
    keyboard.on('keydown-P', () => { this.host.startPlayMode(); });
  }

  private constrainEditorCamera(): void {
    const cam = this.scene.cameras.main;
    const bounds = cam.getBounds();
    const minScrollX = bounds.x + (cam.displayWidth - cam.width) * 0.5;
    const maxScrollX = Math.max(minScrollX, minScrollX + bounds.width - cam.displayWidth);
    const minScrollY = bounds.y + (cam.displayHeight - cam.height) * 0.5;
    const maxScrollY = Math.max(minScrollY, minScrollY + bounds.height - cam.displayHeight);

    cam.scrollX =
      maxScrollX < minScrollX
        ? bounds.centerX - cam.width * cam.originX
        : Phaser.Math.Clamp(cam.scrollX, minScrollX, maxScrollX);
    cam.scrollY =
      maxScrollY < minScrollY
        ? bounds.centerY - cam.height * cam.originY
        : Phaser.Math.Clamp(cam.scrollY, minScrollY, maxScrollY);
  }

  private handleZoom(zoomFactor: number): void {
    const nextZoom = Phaser.Math.Clamp(editorState.zoom * zoomFactor, 0.25, 6);
    if (Math.abs(nextZoom - editorState.zoom) < 0.0001) {
      return;
    }

    editorState.zoom = Number(nextZoom.toFixed(2));
    this.centerCameraOnRoom();
    this.host.updateBackgroundPreview();
    this.host.updateZoomUI();
  }

  private drawRectPreview(x1: number, y1: number, x2: number, y2: number): void {
    this.rectPreviewGraphics?.clear();
    if (!this.rectPreviewGraphics) {
      return;
    }

    const minX = Math.min(x1, x2);
    const minY = Math.min(y1, y2);
    const maxX = Math.max(x1, x2);
    const maxY = Math.max(y1, y2);

    this.rectPreviewGraphics.fillStyle(RETRO_COLORS.draft, 0.15);
    this.rectPreviewGraphics.fillRect(
      minX * TILE_SIZE,
      minY * TILE_SIZE,
      (maxX - minX + 1) * TILE_SIZE,
      (maxY - minY + 1) * TILE_SIZE,
    );
    this.rectPreviewGraphics.lineStyle(1, RETRO_COLORS.draft, 0.65);
    this.rectPreviewGraphics.strokeRect(
      minX * TILE_SIZE,
      minY * TILE_SIZE,
      (maxX - minX + 1) * TILE_SIZE,
      (maxY - minY + 1) * TILE_SIZE,
    );
  }

  private updateCursorCoords(tileX: number, tileY: number): void {
    if (this.cursorCoordsEl) {
      this.cursorCoordsEl.textContent = `Tile: ${tileX}, ${tileY}`;
    }
  }

  startRectDrawing(tileX: number, tileY: number): void {
    this.rectStart = { x: tileX, y: tileY };
  }

  private handleTouchPointerDown(pointer: Phaser.Input.Pointer): boolean {
    if (!this.isTouchPointer(pointer)) {
      return false;
    }

    if (editorState.isPlaying || isMobileLandscapeBlocked()) {
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
        this.host.removeObjectAt(worldPoint.x, worldPoint.y);
      } else {
        this.host.handleObjectPlace(pointer);
      }
      return true;
    }

    if (editorState.activeTool === 'rect') {
      if (!this.rectStart) {
        this.rectStart = { x: tileX, y: tileY };
      } else {
        this.host.fillRect(this.rectStart.x, this.rectStart.y, tileX, tileY);
        this.rectStart = null;
        this.rectPreviewGraphics?.clear();
      }
      return true;
    }

    this.host.handleToolDown(pointer);
    if (editorState.activeTool !== 'fill') {
      this.isDrawing = true;
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
      this.host.placeTileAt(worldPoint.x, worldPoint.y);
    } else if (editorState.activeTool === 'eraser') {
      this.host.eraseTileAt(worldPoint.x, worldPoint.y);
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
      this.host.commitTileBatch();
      this.isDrawing = false;
    }
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
      this.zoomAroundPoint(zoomFactor, centerX, centerY);
      this.pinchDistance = nextDistance;
    }

    const camera = this.scene.cameras.main;
    const dx = (this.pinchAnchor.x - centerX) / camera.zoom;
    const dy = (this.pinchAnchor.y - centerY) / camera.zoom;
    camera.setScroll(this.panStartScroll.x + dx, this.panStartScroll.y + dy);
    this.constrainEditorCamera();
    this.host.updateBackgroundPreview();
  }

  private zoomAroundPoint(zoomFactor: number, screenX: number, screenY: number): void {
    const camera = this.scene.cameras.main;
    const nextZoom = Phaser.Math.Clamp(editorState.zoom * zoomFactor, 0.25, 6);
    if (Math.abs(nextZoom - editorState.zoom) < 0.0001) {
      return;
    }

    const localX = screenX - camera.x;
    const localY = screenY - camera.y;
    const anchorWorldX =
      camera.scrollX + camera.width * camera.originX - camera.displayWidth * 0.5 + localX / camera.zoom;
    const anchorWorldY =
      camera.scrollY + camera.height * camera.originY - camera.displayHeight * 0.5 + localY / camera.zoom;

    editorState.zoom = Number(nextZoom.toFixed(2));
    camera.setZoom(editorState.zoom);

    const nextScrollX =
      anchorWorldX - camera.width * camera.originX + camera.displayWidth * 0.5 - localX / camera.zoom;
    const nextScrollY =
      anchorWorldY - camera.height * camera.originY + camera.displayHeight * 0.5 - localY / camera.zoom;
    camera.setScroll(nextScrollX, nextScrollY);
    this.constrainEditorCamera();
    this.host.updateBackgroundPreview();
    this.host.updateZoomUI();
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
}
