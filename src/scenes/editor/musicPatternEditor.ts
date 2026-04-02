import Phaser from 'phaser';
import {
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  TILE_SIZE,
  editorState,
} from '../../config';
import {
  ROOM_PATTERN_ACTIVE_STEP_COLUMNS,
  ROOM_PATTERN_DRUM_GRID_START_ROW,
  ROOM_PATTERN_DRUM_ROWS,
  ROOM_PATTERN_GRID_ROWS,
  ROOM_PATTERN_MARGIN_START_STEP,
  ROOM_PATTERN_TONAL_INSTRUMENT_IDS,
  cloneRoomMusic,
  createDefaultRoomPatternMusic,
  getPatternDrumRowForGridRow,
  getPatternRowLabel,
  isPatternDrumGridRowPlayable,
  isPatternRoomMusic,
  isStemArrangementRoomMusic,
  type RoomMusic,
  type RoomPatternInstrumentId,
  type RoomPatternMusic,
  type RoomPatternPitchMode,
  type RoomPatternTonalInstrumentId,
} from '../../music/model';

type EditorMusicPreviewState = 'stopped' | 'playing' | 'paused';

interface EditorMusicPatternHost {
  getRoomMusic(): RoomMusic | null;
  commitRoomMusic(nextMusic: RoomMusic | null): RoomMusic | null;
  replaceLegacyRoomMusicWithPattern(): RoomMusic | null;
  renderUi(): void;
  getMusicPlaybackDebugState(): Record<string, unknown>;
  getMusicPreviewState(): EditorMusicPreviewState;
}

interface MusicRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface EditorMusicPatternClipboardState {
  instrumentId: RoomPatternInstrumentId;
  width: number;
  height: number;
  tonalStepRows: (number | null)[] | null;
  drumMask: boolean[][] | null;
}

const INSTRUMENT_COLORS: Record<RoomPatternInstrumentId, number> = {
  drums: 0xf7b54a,
  triangle: 0x79c7ff,
  saw: 0xff9356,
  square: 0xc4f36f,
};

function normalizeRect(rect: MusicRect): MusicRect {
  return {
    x1: Math.min(rect.x1, rect.x2),
    y1: Math.min(rect.y1, rect.y2),
    x2: Math.max(rect.x1, rect.x2),
    y2: Math.max(rect.y1, rect.y2),
  };
}

function isMusicToolCopy(): boolean {
  return editorState.activeTool === 'copy';
}

function resolveSequencerTool(): 'pencil' | 'eraser' | 'copy' {
  if (editorState.activeTool === 'eraser') {
    return 'eraser';
  }
  if (editorState.activeTool === 'copy') {
    return 'copy';
  }
  return 'pencil';
}

export class EditorMusicPatternController {
  private overlayBackdrop: Phaser.GameObjects.Graphics | null = null;
  private overlayGrid: Phaser.GameObjects.Graphics | null = null;
  private overlayCells: Phaser.GameObjects.Graphics | null = null;
  private overlayPlayhead: Phaser.GameObjects.Graphics | null = null;
  private rowLabels: Phaser.GameObjects.Text[] = [];
  private activeInstrumentTab: RoomPatternInstrumentId = 'drums';
  private dragMode: 'draw' | 'erase' | 'copy' | null = null;
  private dragStartCell: { step: number; row: number } | null = null;
  private dragCurrentCell: { step: number; row: number } | null = null;
  private lastDragCellKey: string | null = null;
  private clipboard: EditorMusicPatternClipboardState | null = null;
  private pastePreviewOrigin: { step: number; row: number } | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: EditorMusicPatternHost,
  ) {}

  create(): void {
    this.destroyGraphics();
    this.overlayBackdrop = this.scene.add.graphics();
    this.overlayBackdrop.setDepth(108);
    this.overlayGrid = this.scene.add.graphics();
    this.overlayGrid.setDepth(109);
    this.overlayCells = this.scene.add.graphics();
    this.overlayCells.setDepth(110);
    this.overlayPlayhead = this.scene.add.graphics();
    this.overlayPlayhead.setDepth(111);

    this.rowLabels = Array.from({ length: ROOM_PATTERN_GRID_ROWS }, () => {
      const text = this.scene.add.text(-10, 0, '', {
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: '10px',
        color: '#d7d2c4',
        stroke: '#090909',
        strokeThickness: 2,
      });
      text.setDepth(112);
      text.setOrigin(1, 0.5);
      return text;
    });
  }

  reset(): void {
    this.activeInstrumentTab = 'drums';
    this.dragMode = null;
    this.dragStartCell = null;
    this.dragCurrentCell = null;
    this.lastDragCellKey = null;
    this.clipboard = null;
    this.pastePreviewOrigin = null;
    this.updateOverlay(false);
  }

  destroy(): void {
    this.destroyGraphics();
  }

  getIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return ([
      this.overlayBackdrop,
      this.overlayGrid,
      this.overlayCells,
      this.overlayPlayhead,
      ...this.rowLabels,
    ].filter(Boolean) as Phaser.GameObjects.GameObject[]);
  }

  getActiveInstrumentTab(): RoomPatternInstrumentId {
    return this.activeInstrumentTab;
  }

  setActiveInstrumentTab(instrumentId: RoomPatternInstrumentId): void {
    if (this.activeInstrumentTab === instrumentId) {
      return;
    }

    this.activeInstrumentTab = instrumentId;
    this.pastePreviewOrigin = null;
    this.host.renderUi();
  }

  getLegacyStemNoticeVisible(): boolean {
    return isStemArrangementRoomMusic(this.host.getRoomMusic());
  }

  getDisplayPattern(): RoomPatternMusic {
    const roomMusic = this.host.getRoomMusic();
    return isPatternRoomMusic(roomMusic) ? roomMusic : createDefaultRoomPatternMusic();
  }

  getPitchMode(): RoomPatternPitchMode {
    return this.getDisplayPattern().pitchMode;
  }

  getActiveOctaveShift(): number | null {
    if (this.activeInstrumentTab === 'drums') {
      return null;
    }

    const instrumentId = this.activeInstrumentTab as RoomPatternTonalInstrumentId;
    return this.getDisplayPattern().octaveShift[instrumentId];
  }

  getActiveCellCount(): number {
    const pattern = this.getDisplayPattern();
    if (this.activeInstrumentTab === 'drums') {
      return ROOM_PATTERN_DRUM_ROWS.reduce((count, row) => count + pattern.tabs.drums[row.id].length, 0);
    }

    const instrumentId = this.activeInstrumentTab as RoomPatternTonalInstrumentId;
    return pattern.tabs[instrumentId].steps.filter((rowIndex) => rowIndex !== null).length;
  }

  hasClipboardData(): boolean {
    return this.clipboard !== null && this.clipboard.instrumentId === this.activeInstrumentTab;
  }

  isPastePreviewActive(): boolean {
    return this.pastePreviewOrigin !== null;
  }

  replaceLegacyWithPattern(): void {
    if (!this.getLegacyStemNoticeVisible()) {
      return;
    }

    this.clipboard = null;
    this.pastePreviewOrigin = null;
    this.host.replaceLegacyRoomMusicWithPattern();
  }

  setPitchMode(mode: RoomPatternPitchMode): void {
    const pattern = this.getEditablePattern();
    if (!pattern || pattern.pitchMode === mode) {
      return;
    }

    pattern.pitchMode = mode;
    this.commitPattern(pattern);
  }

  shiftActiveOctave(delta: number): void {
    if (this.activeInstrumentTab === 'drums') {
      return;
    }

    const pattern = this.getEditablePattern();
    if (!pattern) {
      return;
    }

    const instrumentId = this.activeInstrumentTab as RoomPatternTonalInstrumentId;
    const nextValue = Phaser.Math.Clamp(pattern.octaveShift[instrumentId] + delta, -2, 2);
    if (nextValue === pattern.octaveShift[instrumentId]) {
      return;
    }

    pattern.octaveShift[instrumentId] = nextValue;
    this.commitPattern(pattern);
  }

  beginPastePreview(): void {
    if (!this.hasClipboardData()) {
      return;
    }

    this.pastePreviewOrigin = { step: 0, row: this.activeInstrumentTab === 'drums' ? ROOM_PATTERN_DRUM_GRID_START_ROW : 0 };
    this.host.renderUi();
  }

  cancelPastePreview(): void {
    if (!this.pastePreviewOrigin) {
      return;
    }

    this.pastePreviewOrigin = null;
    this.host.renderUi();
  }

  handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.getLegacyStemNoticeVisible()) {
      return;
    }

    const cell = this.getCellFromPointer(pointer);
    if (!cell) {
      return;
    }

    const isRightButton = pointer.rightButtonDown();
    const tool = isRightButton ? 'eraser' : resolveSequencerTool();

    if (this.pastePreviewOrigin && !isRightButton) {
      this.applyPaste(cell.step, cell.row);
      return;
    }

    if (tool === 'copy') {
      this.dragMode = 'copy';
      this.dragStartCell = cell;
      this.dragCurrentCell = cell;
      this.lastDragCellKey = null;
      return;
    }

    this.dragMode = tool === 'eraser' ? 'erase' : 'draw';
    this.dragStartCell = cell;
    this.dragCurrentCell = cell;
    this.lastDragCellKey = null;
    this.applyToolToCell(tool, cell.step, cell.row);
  }

  handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.getLegacyStemNoticeVisible()) {
      return;
    }

    const cell = this.getCellFromPointer(pointer);
    if (this.pastePreviewOrigin) {
      this.pastePreviewOrigin = cell
        ? { step: cell.step, row: cell.row }
        : this.pastePreviewOrigin;
      return;
    }

    if (!this.dragMode || !cell) {
      return;
    }

    this.dragCurrentCell = cell;
    if (this.dragMode === 'copy') {
      return;
    }

    this.applyToolToCell(this.dragMode === 'erase' ? 'eraser' : 'pencil', cell.step, cell.row);
  }

  handlePointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.getLegacyStemNoticeVisible()) {
      this.clearDrag();
      return;
    }

    if (this.dragMode === 'copy' && this.dragStartCell && this.dragCurrentCell) {
      this.captureSelection({
        x1: this.dragStartCell.step,
        y1: this.dragStartCell.row,
        x2: this.dragCurrentCell.step,
        y2: this.dragCurrentCell.row,
      });
    }

    if (this.pastePreviewOrigin) {
      const cell = this.getCellFromPointer(pointer);
      if (cell) {
        this.pastePreviewOrigin = { step: cell.step, row: cell.row };
      }
    }

    this.clearDrag();
  }

  updateCursorHighlight(graphics: Phaser.GameObjects.Graphics): boolean {
    graphics.clear();

    if (!this.overlayBackdrop?.visible) {
      return true;
    }

    const pointer = this.scene.input.activePointer;
    const cell = this.getCellFromPointer(pointer);
    if (this.pastePreviewOrigin && this.hasClipboardData()) {
      const previewOrigin = cell ?? this.pastePreviewOrigin;
      this.drawClipboardPreview(graphics, previewOrigin.step, previewOrigin.row);
      return true;
    }

    if (this.dragMode === 'copy' && this.dragStartCell && this.dragCurrentCell) {
      this.drawSelectionRect(
        graphics,
        normalizeRect({
          x1: this.dragStartCell.step,
          y1: this.dragStartCell.row,
          x2: this.dragCurrentCell.step,
          y2: this.dragCurrentCell.row,
        }),
      );
      return true;
    }

    if (!cell || this.getLegacyStemNoticeVisible()) {
      return true;
    }

    const color = resolveSequencerTool() === 'eraser' ? 0xff6f61 : INSTRUMENT_COLORS[this.activeInstrumentTab];
    graphics.lineStyle(2, color, 0.9);
    graphics.fillStyle(color, resolveSequencerTool() === 'eraser' ? 0.08 : 0.18);
    graphics.fillRect(cell.step * TILE_SIZE, cell.row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    graphics.strokeRect(cell.step * TILE_SIZE, cell.row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    return true;
  }

  updateOverlay(active: boolean): void {
    if (!active) {
      this.setOverlayVisible(false);
      return;
    }

    this.setOverlayVisible(true);
    this.drawBackdrop();
    this.drawGrid();
    this.drawCells();
    this.drawPlayhead();
    this.updateRowLabels();
  }

  private destroyGraphics(): void {
    this.overlayBackdrop?.destroy();
    this.overlayBackdrop = null;
    this.overlayGrid?.destroy();
    this.overlayGrid = null;
    this.overlayCells?.destroy();
    this.overlayCells = null;
    this.overlayPlayhead?.destroy();
    this.overlayPlayhead = null;
    for (const label of this.rowLabels) {
      label.destroy();
    }
    this.rowLabels = [];
  }

  private setOverlayVisible(visible: boolean): void {
    this.overlayBackdrop?.setVisible(visible);
    this.overlayGrid?.setVisible(visible);
    this.overlayCells?.setVisible(visible);
    this.overlayPlayhead?.setVisible(visible);
    for (const label of this.rowLabels) {
      label.setVisible(visible);
    }

    if (!visible) {
      this.overlayBackdrop?.clear();
      this.overlayGrid?.clear();
      this.overlayCells?.clear();
      this.overlayPlayhead?.clear();
    }
  }

  private drawBackdrop(): void {
    if (!this.overlayBackdrop) {
      return;
    }

    this.overlayBackdrop.clear();
    this.overlayBackdrop.fillStyle(0x050506, 0.68);
    this.overlayBackdrop.fillRect(0, 0, ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
    this.overlayBackdrop.fillStyle(0x000000, 0.3);
    this.overlayBackdrop.fillRect(
      ROOM_PATTERN_MARGIN_START_STEP * TILE_SIZE,
      0,
      (ROOM_PX_WIDTH - ROOM_PATTERN_MARGIN_START_STEP * TILE_SIZE),
      ROOM_PX_HEIGHT,
    );

    if (this.activeInstrumentTab === 'drums') {
      this.overlayBackdrop.fillStyle(0x000000, 0.26);
      this.overlayBackdrop.fillRect(0, 0, ROOM_PATTERN_ACTIVE_STEP_COLUMNS * TILE_SIZE, ROOM_PATTERN_DRUM_GRID_START_ROW * TILE_SIZE);
    }
  }

  private drawGrid(): void {
    if (!this.overlayGrid) {
      return;
    }

    this.overlayGrid.clear();
    for (let x = 0; x <= ROOM_PATTERN_ACTIVE_STEP_COLUMNS; x += 1) {
      const lineAlpha = x === 16 ? 0.76 : x % 4 === 0 ? 0.4 : 0.14;
      const lineWidth = x === 16 ? 3 : x % 4 === 0 ? 2 : 1;
      const color = x === 16 ? 0xffd073 : 0xf2ecd9;
      this.overlayGrid.lineStyle(lineWidth, color, lineAlpha);
      this.overlayGrid.beginPath();
      this.overlayGrid.moveTo(x * TILE_SIZE, 0);
      this.overlayGrid.lineTo(x * TILE_SIZE, ROOM_PX_HEIGHT);
      this.overlayGrid.strokePath();
    }

    for (let y = 0; y <= ROOM_HEIGHT; y += 1) {
      const rowAlpha =
        this.activeInstrumentTab === 'drums' && y <= ROOM_PATTERN_DRUM_GRID_START_ROW
          ? 0.08
          : 0.18;
      this.overlayGrid.lineStyle(1, 0xf2ecd9, rowAlpha);
      this.overlayGrid.beginPath();
      this.overlayGrid.moveTo(0, y * TILE_SIZE);
      this.overlayGrid.lineTo(ROOM_PATTERN_ACTIVE_STEP_COLUMNS * TILE_SIZE, y * TILE_SIZE);
      this.overlayGrid.strokePath();
    }

    this.overlayGrid.lineStyle(2, 0x86bde8, 0.3);
    this.overlayGrid.strokeRect(0, 0, ROOM_PATTERN_ACTIVE_STEP_COLUMNS * TILE_SIZE, ROOM_PX_HEIGHT);
  }

  private drawCells(): void {
    if (!this.overlayCells) {
      return;
    }

    this.overlayCells.clear();
    if (this.getLegacyStemNoticeVisible()) {
      return;
    }

    const pattern = this.getDisplayPattern();
    const color = INSTRUMENT_COLORS[this.activeInstrumentTab];
    if (this.activeInstrumentTab === 'drums') {
      this.overlayCells.fillStyle(color, 0.88);
      for (const row of ROOM_PATTERN_DRUM_ROWS) {
        for (const step of pattern.tabs.drums[row.id]) {
          this.overlayCells.fillRect(step * TILE_SIZE + 2, row.gridRow * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        }
      }
      return;
    }

    this.overlayCells.fillStyle(color, 0.86);
    const steps = pattern.tabs[this.activeInstrumentTab].steps;
    let step = 0;
    while (step < steps.length) {
      const rowIndex = steps[step];
      if (rowIndex === null) {
        step += 1;
        continue;
      }

      let endStep = step + 1;
      while (endStep < steps.length && steps[endStep] === rowIndex) {
        endStep += 1;
      }
      this.overlayCells.fillRect(
        step * TILE_SIZE + 2,
        rowIndex * TILE_SIZE + 2,
        (endStep - step) * TILE_SIZE - 4,
        TILE_SIZE - 4,
      );
      step = endStep;
    }
  }

  private drawPlayhead(): void {
    if (!this.overlayPlayhead) {
      return;
    }

    this.overlayPlayhead.clear();
    if (this.host.getMusicPreviewState() !== 'playing') {
      return;
    }

    const playheadStep = this.resolvePlayheadStep();
    if (playheadStep === null) {
      return;
    }

    this.overlayPlayhead.fillStyle(0xfef3cf, 0.12);
    this.overlayPlayhead.fillRect(playheadStep * TILE_SIZE, 0, TILE_SIZE, ROOM_PX_HEIGHT);
    this.overlayPlayhead.lineStyle(2, 0xfff6d6, 0.88);
    this.overlayPlayhead.beginPath();
    this.overlayPlayhead.moveTo(playheadStep * TILE_SIZE, 0);
    this.overlayPlayhead.lineTo(playheadStep * TILE_SIZE, ROOM_PX_HEIGHT);
    this.overlayPlayhead.strokePath();
  }

  private resolvePlayheadStep(): number | null {
    const playback = this.host.getMusicPlaybackDebugState();
    const audioCurrentTime =
      typeof playback.audioCurrentTime === 'number' ? playback.audioCurrentTime : null;
    const activePattern =
      playback.activePattern && typeof playback.activePattern === 'object'
        ? (playback.activePattern as Record<string, unknown>)
        : null;
    const currentArrangement =
      playback.currentArrangement && typeof playback.currentArrangement === 'object'
        ? (playback.currentArrangement as Record<string, unknown>)
        : null;

    if (
      audioCurrentTime === null ||
      !activePattern ||
      typeof activePattern.startTime !== 'number' ||
      typeof activePattern.loopDurationSec !== 'number' ||
      !currentArrangement ||
      currentArrangement.kind !== 'pattern'
    ) {
      return null;
    }

    const loopDurationSec = activePattern.loopDurationSec;
    if (loopDurationSec <= 0) {
      return null;
    }

    const elapsed = Math.max(0, audioCurrentTime - activePattern.startTime);
    const loopOffset = elapsed % loopDurationSec;
    return Math.max(0, Math.min(ROOM_PATTERN_ACTIVE_STEP_COLUMNS - 1, Math.floor((loopOffset / loopDurationSec) * ROOM_PATTERN_ACTIVE_STEP_COLUMNS)));
  }

  private updateRowLabels(): void {
    const pattern = this.getDisplayPattern();
    for (let rowIndex = 0; rowIndex < this.rowLabels.length; rowIndex += 1) {
      const label = this.rowLabels[rowIndex];
      label.setVisible(this.overlayBackdrop?.visible ?? false);
      label.setPosition(-8, rowIndex * TILE_SIZE + TILE_SIZE * 0.5);
      label.setText(
        getPatternRowLabel(
          this.activeInstrumentTab,
          rowIndex,
          pattern.pitchMode,
          this.activeInstrumentTab === 'drums'
            ? 0
            : pattern.octaveShift[this.activeInstrumentTab as RoomPatternTonalInstrumentId],
        ),
      );
      label.setAlpha(
        this.activeInstrumentTab === 'drums' && rowIndex < ROOM_PATTERN_DRUM_GRID_START_ROW
          ? 0.2
          : 0.92,
      );
      label.setColor(
        this.activeInstrumentTab === 'drums' && rowIndex < ROOM_PATTERN_DRUM_GRID_START_ROW
          ? '#6f6c66'
          : '#d7d2c4'
      );
    }
  }

  private drawSelectionRect(graphics: Phaser.GameObjects.Graphics, rect: MusicRect): void {
    graphics.lineStyle(2, 0xf7e3af, 0.92);
    graphics.fillStyle(0xf7e3af, 0.1);
    graphics.fillRect(
      rect.x1 * TILE_SIZE,
      rect.y1 * TILE_SIZE,
      (rect.x2 - rect.x1 + 1) * TILE_SIZE,
      (rect.y2 - rect.y1 + 1) * TILE_SIZE,
    );
    graphics.strokeRect(
      rect.x1 * TILE_SIZE,
      rect.y1 * TILE_SIZE,
      (rect.x2 - rect.x1 + 1) * TILE_SIZE,
      (rect.y2 - rect.y1 + 1) * TILE_SIZE,
    );
  }

  private drawClipboardPreview(
    graphics: Phaser.GameObjects.Graphics,
    baseStep: number,
    baseRow: number,
  ): void {
    const clipboard = this.clipboard;
    if (!clipboard || clipboard.instrumentId !== this.activeInstrumentTab) {
      return;
    }

    const color = INSTRUMENT_COLORS[this.activeInstrumentTab];
    graphics.lineStyle(2, color, 0.92);
    graphics.fillStyle(color, 0.18);
    if (clipboard.tonalStepRows) {
      for (let stepOffset = 0; stepOffset < clipboard.tonalStepRows.length; stepOffset += 1) {
        const relativeRow = clipboard.tonalStepRows[stepOffset];
        if (relativeRow === null) {
          continue;
        }

        const targetStep = baseStep + stepOffset;
        const targetRow = baseRow + relativeRow;
        if (!this.isPlayableCell(targetStep, targetRow)) {
          continue;
        }

        graphics.fillRect(targetStep * TILE_SIZE, targetRow * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        graphics.strokeRect(targetStep * TILE_SIZE, targetRow * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
      return;
    }

    if (!clipboard.drumMask) {
      return;
    }

    for (let rowOffset = 0; rowOffset < clipboard.drumMask.length; rowOffset += 1) {
      for (let stepOffset = 0; stepOffset < clipboard.drumMask[rowOffset].length; stepOffset += 1) {
        if (!clipboard.drumMask[rowOffset][stepOffset]) {
          continue;
        }

        const targetStep = baseStep + stepOffset;
        const targetRow = baseRow + rowOffset;
        if (!this.isPlayableCell(targetStep, targetRow)) {
          continue;
        }

        graphics.fillRect(targetStep * TILE_SIZE, targetRow * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        graphics.strokeRect(targetStep * TILE_SIZE, targetRow * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  private getCellFromPointer(pointer: Phaser.Input.Pointer): { step: number; row: number } | null {
    const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const step = Math.floor(worldPoint.x / TILE_SIZE);
    const row = Math.floor(worldPoint.y / TILE_SIZE);
    if (!this.isPlayableCell(step, row)) {
      return null;
    }

    return { step, row };
  }

  private isPlayableCell(step: number, row: number): boolean {
    if (step < 0 || step >= ROOM_PATTERN_ACTIVE_STEP_COLUMNS || row < 0 || row >= ROOM_PATTERN_GRID_ROWS) {
      return false;
    }

    if (this.activeInstrumentTab === 'drums') {
      return isPatternDrumGridRowPlayable(row);
    }

    return true;
  }

  private getEditablePattern(): RoomPatternMusic | null {
    const roomMusic = this.host.getRoomMusic();
    if (isStemArrangementRoomMusic(roomMusic)) {
      return null;
    }

    if (isPatternRoomMusic(roomMusic)) {
      return cloneRoomMusic(roomMusic) as RoomPatternMusic;
    }

    return createDefaultRoomPatternMusic();
  }

  private commitPattern(pattern: RoomPatternMusic): void {
    this.host.commitRoomMusic(pattern);
  }

  private applyToolToCell(tool: 'pencil' | 'eraser', step: number, row: number): void {
    const cellKey = `${tool}:${step}:${row}`;
    if (this.lastDragCellKey === cellKey) {
      return;
    }
    this.lastDragCellKey = cellKey;

    const pattern = this.getEditablePattern();
    if (!pattern) {
      return;
    }

    if (this.activeInstrumentTab === 'drums') {
      const drumRow = getPatternDrumRowForGridRow(row);
      if (!drumRow) {
        return;
      }

      const steps = [...pattern.tabs.drums[drumRow.id]];
      const existingIndex = steps.indexOf(step);
      if (tool === 'eraser') {
        if (existingIndex < 0) {
          return;
        }
        steps.splice(existingIndex, 1);
      } else if (existingIndex < 0) {
        steps.push(step);
        steps.sort((left, right) => left - right);
      } else {
        return;
      }

      pattern.tabs.drums[drumRow.id] = steps;
      this.commitPattern(pattern);
      return;
    }

    const currentRow = pattern.tabs[this.activeInstrumentTab].steps[step];
    if (tool === 'eraser') {
      if (currentRow !== row) {
        return;
      }
      pattern.tabs[this.activeInstrumentTab].steps[step] = null;
      this.commitPattern(pattern);
      return;
    }

    if (currentRow === row) {
      return;
    }
    pattern.tabs[this.activeInstrumentTab].steps[step] = row;
    this.commitPattern(pattern);
  }

  private captureSelection(rect: MusicRect): void {
    const normalized = normalizeRect(rect);
    const pattern = this.getDisplayPattern();
    if (this.activeInstrumentTab === 'drums') {
      const height = normalized.y2 - normalized.y1 + 1;
      const width = normalized.x2 - normalized.x1 + 1;
      const drumMask = Array.from({ length: height }, () => Array.from({ length: width }, () => false));
      let hasAny = false;
      for (let rowOffset = 0; rowOffset < height; rowOffset += 1) {
        const absoluteRow = normalized.y1 + rowOffset;
        const drumRow = getPatternDrumRowForGridRow(absoluteRow);
        if (!drumRow) {
          continue;
        }
        for (let stepOffset = 0; stepOffset < width; stepOffset += 1) {
          const absoluteStep = normalized.x1 + stepOffset;
          const active = pattern.tabs.drums[drumRow.id].includes(absoluteStep);
          drumMask[rowOffset][stepOffset] = active;
          hasAny ||= active;
        }
      }
      if (!hasAny) {
        return;
      }
      this.clipboard = {
        instrumentId: 'drums',
        width,
        height,
        tonalStepRows: null,
        drumMask,
      };
      this.host.renderUi();
      return;
    }

    const width = normalized.x2 - normalized.x1 + 1;
    const tonalStepRows = Array.from({ length: width }, () => null as number | null);
    let hasAny = false;
    for (let stepOffset = 0; stepOffset < width; stepOffset += 1) {
      const absoluteStep = normalized.x1 + stepOffset;
      const absoluteRow = pattern.tabs[this.activeInstrumentTab].steps[absoluteStep];
      if (absoluteRow === null || absoluteRow < normalized.y1 || absoluteRow > normalized.y2) {
        continue;
      }
      tonalStepRows[stepOffset] = absoluteRow - normalized.y1;
      hasAny = true;
    }
    if (!hasAny) {
      return;
    }
    this.clipboard = {
      instrumentId: this.activeInstrumentTab,
      width,
      height: normalized.y2 - normalized.y1 + 1,
      tonalStepRows,
      drumMask: null,
    };
    this.host.renderUi();
  }

  private applyPaste(baseStep: number, baseRow: number): void {
    const clipboard = this.clipboard;
    if (!clipboard || clipboard.instrumentId !== this.activeInstrumentTab) {
      return;
    }

    const pattern = this.getEditablePattern();
    if (!pattern) {
      return;
    }

    let changed = false;
    if (clipboard.tonalStepRows) {
      for (let stepOffset = 0; stepOffset < clipboard.tonalStepRows.length; stepOffset += 1) {
        const relativeRow = clipboard.tonalStepRows[stepOffset];
        if (relativeRow === null) {
          continue;
        }

        const targetStep = baseStep + stepOffset;
        const targetRow = baseRow + relativeRow;
        if (!this.isPlayableCell(targetStep, targetRow)) {
          continue;
        }

        if (pattern.tabs[this.activeInstrumentTab as RoomPatternTonalInstrumentId].steps[targetStep] !== targetRow) {
          pattern.tabs[this.activeInstrumentTab as RoomPatternTonalInstrumentId].steps[targetStep] = targetRow;
          changed = true;
        }
      }
    } else if (clipboard.drumMask) {
      for (let rowOffset = 0; rowOffset < clipboard.drumMask.length; rowOffset += 1) {
        const targetRow = baseRow + rowOffset;
        const drumRow = getPatternDrumRowForGridRow(targetRow);
        if (!drumRow) {
          continue;
        }

        const steps = [...pattern.tabs.drums[drumRow.id]];
        let localChanged = false;
        for (let stepOffset = 0; stepOffset < clipboard.drumMask[rowOffset].length; stepOffset += 1) {
          if (!clipboard.drumMask[rowOffset][stepOffset]) {
            continue;
          }

          const targetStep = baseStep + stepOffset;
          if (!this.isPlayableCell(targetStep, targetRow) || steps.includes(targetStep)) {
            continue;
          }
          steps.push(targetStep);
          localChanged = true;
        }
        if (localChanged) {
          steps.sort((left, right) => left - right);
          pattern.tabs.drums[drumRow.id] = steps;
          changed = true;
        }
      }
    }

    if (!changed) {
      return;
    }

    this.commitPattern(pattern);
    this.pastePreviewOrigin = null;
  }

  private clearDrag(): void {
    this.dragMode = null;
    this.dragStartCell = null;
    this.dragCurrentCell = null;
    this.lastDragCellKey = null;
  }
}
