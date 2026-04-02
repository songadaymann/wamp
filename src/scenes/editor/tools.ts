import Phaser from 'phaser';
import {
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILE_SIZE,
  editorState,
  type ToolName,
} from '../../config';
import type { RoomGoal } from '../../goals/roomGoals';
import type { RoomGoalType } from '../../goals/roomGoals';
import type { RoomBoundarySide } from '../../persistence/roomRepository';
import type { EditorMarkerPlacementMode } from '../../ui/setup/sceneBridge';
import type { EditorClipboardState, EditorEditRuntime, GoalPlacementMode } from './editRuntime';
import type { EditorPersistenceController } from './persistence';

interface EditorToolControllerHost {
  startRectDrawing(tileX: number, tileY: number): void;
  clearShapePreview(): void;
  clearCoursePlacementMode(): void;
  renderUi(): void;
}

export class EditorToolController {
  private clipboardPastePreviewActive = false;
  private lastCopySelection: { x1: number; y1: number; x2: number; y2: number } | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly editRuntime: EditorEditRuntime,
    private readonly persistenceController: EditorPersistenceController,
    private readonly host: EditorToolControllerHost,
  ) {}

  reset(): void {
    this.clipboardPastePreviewActive = false;
    this.lastCopySelection = null;
  }

  selectTool(tool: ToolName): void {
    editorState.activeTool = tool;
    this.updateToolUi();
  }

  clearCurrentLayer(): void {
    this.editRuntime.clearCurrentLayer();
  }

  clearAllTiles(): void {
    this.editRuntime.clearAllTiles();
  }

  setGoalType(nextType: RoomGoalType | null): void {
    this.editRuntime.setGoalType(nextType);
  }

  setBoundaryIngress(
    side: RoomBoundarySide,
    entityType: 'objects' | 'enemies',
    allowed: boolean
  ): void {
    this.editRuntime.setBoundaryIngress(side, entityType, allowed);
  }

  setGoalTimeLimitSeconds(seconds: number | null): void {
    this.editRuntime.setGoalTimeLimitSeconds(seconds);
  }

  setGoalRequiredCount(requiredCount: number): void {
    this.editRuntime.setGoalRequiredCount(requiredCount);
  }

  setGoalSurvivalSeconds(seconds: number): void {
    this.editRuntime.setGoalSurvivalSeconds(seconds);
  }

  startGoalMarkerPlacement(mode: EditorMarkerPlacementMode): void {
    this.host.clearCoursePlacementMode();
    this.editRuntime.startGoalMarkerPlacement(mode as GoalPlacementMode);
  }

  clearGoalMarkers(): void {
    this.editRuntime.clearGoalMarkers();
  }

  getGoalEditorState(): {
    goal: RoomGoal | null;
    placementMode: GoalPlacementMode;
    availableCollectibles: number;
    availableEnemies: number;
  } {
    return this.editRuntime.getGoalEditorState();
  }

  getGoalSummaryText(): string {
    return this.editRuntime.getGoalSummaryText();
  }

  getClipboardPreview(): EditorClipboardState | null {
    return this.editRuntime.currentClipboardState;
  }

  isClipboardPastePreviewActive(): boolean {
    return this.clipboardPastePreviewActive;
  }

  beginClipboardPastePreview(): void {
    if (!this.editRuntime.hasClipboardTiles() || editorState.paletteMode !== 'tiles') {
      return;
    }

    this.clipboardPastePreviewActive = true;
    editorState.activeTool = 'copy';
    this.updateToolUi();
    this.persistenceController.setStatusText(
      'Copy preview active. Move the mouse and click to place tiles, or press Esc to cancel.'
    );
  }

  repeatLastCopySelection(): boolean {
    if (
      !this.lastCopySelection
      || editorState.paletteMode !== 'tiles'
      || editorState.activeTool !== 'copy'
    ) {
      return false;
    }

    this.captureCopySelection(
      this.lastCopySelection.x1,
      this.lastCopySelection.y1,
      this.lastCopySelection.x2,
      this.lastCopySelection.y2,
    );
    return true;
  }

  cancelClipboardPastePreview(): void {
    if (!this.clipboardPastePreviewActive) {
      return;
    }

    this.clipboardPastePreviewActive = false;
    this.host.clearShapePreview();
    this.persistenceController.restorePersistenceStatus();
  }

  pasteClipboardAt(tileX: number, tileY: number): void {
    if (!this.clipboardPastePreviewActive) {
      return;
    }

    this.editRuntime.beginTileBatch();
    const pasted = this.editRuntime.pasteClipboardAt(tileX, tileY);
    this.editRuntime.commitTileBatch();
    if (!pasted) {
      this.persistenceController.setStatusText('Nothing to paste at that position.');
      return;
    }

    this.persistenceController.setStatusText(
      'Pasted tile region. Click again to repeat, or press Esc to stop pasting.'
    );
    this.host.renderUi();
  }

  handleToolDown(pointer: Phaser.Input.Pointer): void {
    const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tileX = Math.floor(worldPoint.x / TILE_SIZE);
    const tileY = Math.floor(worldPoint.y / TILE_SIZE);

    if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
      return;
    }

    switch (editorState.activeTool) {
      case 'pencil':
        this.editRuntime.beginTileBatch();
        this.editRuntime.placeTileAt(worldPoint.x, worldPoint.y);
        break;
      case 'eraser':
        this.editRuntime.beginTileBatch();
        this.editRuntime.eraseTileAt(worldPoint.x, worldPoint.y);
        break;
      case 'rect':
        this.editRuntime.beginTileBatch();
        this.host.startRectDrawing(tileX, tileY);
        break;
      case 'fill':
        this.editRuntime.beginTileBatch();
        this.editRuntime.floodFill(tileX, tileY);
        this.editRuntime.commitTileBatch();
        break;
      case 'copy':
        this.host.startRectDrawing(tileX, tileY);
        break;
    }
  }

  captureCopySelection(x1: number, y1: number, x2: number, y2: number): void {
    if (editorState.paletteMode !== 'tiles') {
      return;
    }

    this.lastCopySelection = { x1, y1, x2, y2 };
    const copied = this.editRuntime.copyTilesToClipboard(x1, y1, x2, y2);
    if (!copied) {
      this.clipboardPastePreviewActive = false;
      this.persistenceController.setStatusText('No tiles in that selection to copy.');
      this.host.renderUi();
      return;
    }

    this.beginClipboardPastePreview();
    this.persistenceController.setStatusText(
      'Copied tile region. Move the mouse and click to place it.'
    );
  }

  undo(): void {
    this.editRuntime.undo();
  }

  redo(): void {
    this.editRuntime.redo();
  }

  updateToolUi(): void {
    if (this.clipboardPastePreviewActive && editorState.activeTool !== 'copy') {
      this.cancelClipboardPastePreview();
    }

    if (editorState.activeTool !== 'rect' && editorState.activeTool !== 'copy') {
      this.host.clearShapePreview();
    }

    this.host.renderUi();
  }
}
