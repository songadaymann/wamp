import Phaser from 'phaser';
import {
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  TILE_SIZE,
  colorNumberToCssHex,
  editorState,
  getTilesetUiTheme,
} from '../../config';
import {
  getMusicPhraseSampleName,
  materializeMusicPhraseDrumTrack,
  materializeMusicPhraseTonalTrack,
  type MusicPhraseRecord,
} from '../../music/library';
import {
  ROOM_PATTERN_ACTIVE_STEP_COLUMNS,
} from '../../music/pattern';
import {
  ROOM_PATTERN_DRUM_GRID_START_ROW,
  ROOM_PATTERN_DRUM_ROWS,
  ROOM_PATTERN_GRID_ROWS,
  ROOM_PATTERN_INSTRUMENT_IDS,
  ROOM_PATTERN_TONAL_INSTRUMENT_IDS,
  cloneRoomMusic,
  createDefaultRoomPatternMusic,
  createEmptyRoomPatternDrumTrack,
  createEmptyRoomPatternTonalTrack,
  findPatternRowIndexForMidi,
  getPatternInstrumentColor,
  getPatternDrumRowForGridRow,
  getPatternInstrumentLabel,
  getPatternRowNote,
  getPatternRowLabel,
  getPatternStepMidi,
  isPatternDrumGridRowPlayable,
  isPatternRoomMusic,
  isStemArrangementRoomMusic,
  normalizeRoomPatternBpm,
  normalizeRoomPatternSwingPercent,
  type RoomMusic,
  type RoomMusicKeyMode,
  type RoomMusicKeyTonic,
  type RoomPatternInstrumentMixSettings,
  type RoomPatternInstrumentId,
  type RoomPatternMusic,
  type RoomPatternPitchMode,
  type RoomPatternTonalInstrumentId,
} from '../../music/model';

type EditorMusicPreviewState = 'stopped' | 'playing' | 'paused';
const ROOM_PATTERN_MARGIN_START_STEP = ROOM_PATTERN_ACTIVE_STEP_COLUMNS;

interface EditorMusicPatternHost {
  getRoomMusic(): RoomMusic | null;
  commitRoomMusic(nextMusic: RoomMusic | null): RoomMusic | null;
  replaceLegacyRoomMusicWithPattern(): RoomMusic | null;
  getWorkspaceOrigin?: () => { x: number; y: number };
  renderUi(): void;
  getMusicPlaybackDebugState(): Record<string, unknown>;
  getMusicPreviewState(): EditorMusicPreviewState;
  previewPatternCell(pattern: RoomPatternMusic, instrumentId: RoomPatternInstrumentId, row: number): void;
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
  tonalStepTies: boolean[] | null;
  drumMask: boolean[][] | null;
}

interface MixControlLayout {
  panelX: number;
  panelY: number;
  panelWidth: number;
  panelHeight: number;
  panTrackX: number;
  panTrackY: number;
  panTrackWidth: number;
  panTrackHeight: number;
  volumeTrackX: number;
  volumeTrackY: number;
  volumeTrackWidth: number;
  volumeTrackHeight: number;
  centerX: number;
}

const MIX_PANEL_WIDTH = 96;
const MIX_PANEL_PADDING = 12;
const MIX_TITLE_Y = 18;
const MIX_READOUT_Y = 34;
const MIX_PAN_TRACK_Y = 52;
const MIX_PAN_TRACK_WIDTH = 72;
const MIX_PAN_TRACK_HEIGHT = 8;
const MIX_VOLUME_TRACK_Y = 82;
const MIX_VOLUME_TRACK_WIDTH = 18;
const MIX_VOLUME_TRACK_HEIGHT = ROOM_PX_HEIGHT - 112;

function normalizeRect(rect: MusicRect): MusicRect {
  return {
    x1: Math.min(rect.x1, rect.x2),
    y1: Math.min(rect.y1, rect.y2),
    x2: Math.max(rect.x1, rect.x2),
    y2: Math.max(rect.y1, rect.y2),
  };
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
  private overlayMixControls: Phaser.GameObjects.Graphics | null = null;
  private rowLabels: Phaser.GameObjects.Text[] = [];
  private mixTitleLabel: Phaser.GameObjects.Text | null = null;
  private mixReadoutLabel: Phaser.GameObjects.Text | null = null;
  private activeInstrumentTab: RoomPatternInstrumentId = 'drums';
  private dragMode: 'draw' | 'erase' | 'copy' | null = null;
  private mixDragMode: 'volume' | 'pan' | null = null;
  private dragStartCell: { step: number; row: number } | null = null;
  private dragCurrentCell: { step: number; row: number } | null = null;
  private lastDragCellKey: string | null = null;
  private lastAppliedCell: { step: number; row: number } | null = null;
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
    this.overlayMixControls = this.scene.add.graphics();
    this.overlayMixControls.setDepth(112);

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

    this.mixTitleLabel = this.scene.add.text(0, 0, '', {
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: '11px',
      color: '#f6e8c9',
      stroke: '#090909',
      strokeThickness: 2,
      align: 'center',
    });
    this.mixTitleLabel.setDepth(113);
    this.mixTitleLabel.setOrigin(0.5, 0.5);

    this.mixReadoutLabel = this.scene.add.text(0, 0, '', {
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: '10px',
      color: '#d7d2c4',
      stroke: '#090909',
      strokeThickness: 2,
      align: 'center',
    });
    this.mixReadoutLabel.setDepth(113);
    this.mixReadoutLabel.setOrigin(0.5, 0.5);
  }

  reset(): void {
    this.activeInstrumentTab = 'drums';
    this.dragMode = null;
    this.mixDragMode = null;
    this.dragStartCell = null;
    this.dragCurrentCell = null;
    this.lastDragCellKey = null;
    this.lastAppliedCell = null;
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
      this.overlayMixControls,
      ...this.rowLabels,
      this.mixTitleLabel,
      this.mixReadoutLabel,
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
    this.mixDragMode = null;
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

  getKeyTonic(): RoomMusicKeyTonic {
    return this.getDisplayPattern().keyTonic;
  }

  getKeyMode(): RoomMusicKeyMode {
    return this.getDisplayPattern().keyMode;
  }

  getActiveOctaveShift(): number | null {
    if (this.activeInstrumentTab === 'drums') {
      return null;
    }

    const instrumentId = this.activeInstrumentTab as RoomPatternTonalInstrumentId;
    return this.getDisplayPattern().octaveShift[instrumentId];
  }

  getActiveInstrumentMix(): RoomPatternInstrumentMixSettings {
    return this.getDisplayPattern().mix[this.activeInstrumentTab];
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

  setKeyTonic(tonic: RoomMusicKeyTonic): void {
    const pattern = this.getEditablePattern();
    if (!pattern || pattern.keyTonic === tonic) {
      return;
    }

    pattern.keyTonic = tonic;
    this.commitPattern(pattern);
  }

  setKeyMode(mode: RoomMusicKeyMode): void {
    const pattern = this.getEditablePattern();
    if (!pattern || pattern.keyMode === mode) {
      return;
    }

    pattern.keyMode = mode;
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

  setActiveInstrumentMix(nextValues: Partial<RoomPatternInstrumentMixSettings>): void {
    const pattern = this.getEditablePattern();
    if (!pattern) {
      return;
    }

    const current = pattern.mix[this.activeInstrumentTab];
    const nextVolume =
      nextValues.volume === undefined
        ? current.volume
        : Phaser.Math.Clamp(Math.round(nextValues.volume * 50) / 50, 0, 1);
    const nextPan =
      nextValues.pan === undefined
        ? current.pan
        : Phaser.Math.Clamp(Math.round(nextValues.pan * 20) / 20, -1, 1);

    if (nextVolume === current.volume && nextPan === current.pan) {
      return;
    }

    pattern.mix[this.activeInstrumentTab] = {
      volume: nextVolume,
      pan: nextPan,
    };
    this.commitPattern(pattern);
  }

  isPatternWorkspaceEmpty(): boolean {
    const pattern = this.getEditablePattern();
    if (!pattern) {
      return true;
    }

    const hasDrumContent = ROOM_PATTERN_DRUM_ROWS.some((row) => pattern.tabs.drums[row.id].length > 0);
    if (hasDrumContent) {
      return false;
    }

    const hasTonalContent = ROOM_PATTERN_TONAL_INSTRUMENT_IDS.some((instrumentId) =>
      pattern.tabs[instrumentId].steps.some((rowIndex) => rowIndex !== null),
    );
    if (hasTonalContent) {
      return false;
    }

    return ROOM_PATTERN_INSTRUMENT_IDS.every((instrumentId) =>
      (pattern.sourcePhraseIds[instrumentId]?.length ?? 0) === 0,
    );
  }

  insertPhrase(
    phrase: MusicPhraseRecord,
    options?: {
      adoptPhraseTiming?: boolean;
    },
  ): void {
    const pattern = this.getEditablePattern();
    if (!pattern || phrase.instrumentId !== this.activeInstrumentTab) {
      return;
    }

    if (options?.adoptPhraseTiming) {
      pattern.bpm = normalizeRoomPatternBpm(phrase.payload.bpm);
      pattern.swingPercent = normalizeRoomPatternSwingPercent(phrase.payload.swingPercent);
    }

    if (this.activeInstrumentTab === 'drums') {
      pattern.tabs.drums = materializeMusicPhraseDrumTrack(phrase);
    } else {
      const instrumentId = this.activeInstrumentTab as RoomPatternTonalInstrumentId;
      pattern.tabs[instrumentId] = materializeMusicPhraseTonalTrack(
        phrase,
        pattern.pitchMode,
        pattern.keyTonic,
        pattern.keyMode,
        pattern.octaveShift[instrumentId],
      );
    }

    pattern.sourcePhraseIds[this.activeInstrumentTab] = [
      phrase.id,
      ...phrase.sourcePhraseIds,
    ].filter((value, index, sourceIds) => sourceIds.indexOf(value) === index);
    pattern.phraseNameSuffixes[this.activeInstrumentTab] = getMusicPhraseSampleName(phrase);
    this.commitPattern(pattern);
  }

  clearActivePhrase(): void {
    const pattern = this.getEditablePattern();
    if (!pattern) {
      return;
    }

    if (this.activeInstrumentTab === 'drums') {
      pattern.tabs.drums = createEmptyRoomPatternDrumTrack();
    } else {
      pattern.tabs[this.activeInstrumentTab as RoomPatternTonalInstrumentId] = createEmptyRoomPatternTonalTrack();
    }

    pattern.phraseNameSuffixes[this.activeInstrumentTab] = null;
    pattern.sourcePhraseIds[this.activeInstrumentTab] = [];
    this.clipboard = null;
    this.pastePreviewOrigin = null;
    this.dragMode = null;
    this.dragStartCell = null;
    this.dragCurrentCell = null;
    this.lastDragCellKey = null;
    this.lastAppliedCell = null;
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

    const mixControlHit = this.getMixControlHit(pointer);
    if (mixControlHit) {
      this.mixDragMode = mixControlHit.control;
      this.setActiveInstrumentMix({
        [mixControlHit.control]: mixControlHit.value,
      });
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

    const dragMode =
      tool === 'eraser'
        ? 'erase'
        : this.isCellActive(this.getDisplayPattern(), cell.step, cell.row)
          ? 'erase'
          : 'draw';
    this.dragMode = dragMode;
    this.dragStartCell = cell;
    this.dragCurrentCell = cell;
    this.lastDragCellKey = null;
    this.applyToolToCell(dragMode === 'erase' ? 'eraser' : 'pencil', cell.step, cell.row);
  }

  handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.getLegacyStemNoticeVisible()) {
      return;
    }

    if (this.mixDragMode) {
      const mixControlHit = this.getMixControlHit(pointer, this.mixDragMode);
      if (mixControlHit) {
        this.setActiveInstrumentMix({
          [mixControlHit.control]: mixControlHit.value,
        });
      }
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
      this.mixDragMode = null;
      this.clearDrag();
      return;
    }

    if (this.mixDragMode) {
      const mixControlHit = this.getMixControlHit(pointer, this.mixDragMode);
      if (mixControlHit) {
        this.setActiveInstrumentMix({
          [mixControlHit.control]: mixControlHit.value,
        });
      }
      this.mixDragMode = null;
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
    const mixControlHit = this.getMixControlHit(pointer);
    if (mixControlHit) {
      const layout = this.getMixControlLayout();
      const color = this.getInstrumentColor();
      graphics.lineStyle(2, color, 0.7);
      graphics.fillStyle(color, 0.08);
      if (mixControlHit.control === 'pan') {
        graphics.fillRoundedRect(
          layout.panTrackX - 8,
          layout.panTrackY - 8,
          layout.panTrackWidth + 16,
          layout.panTrackHeight + 16,
          10,
        );
        graphics.strokeRoundedRect(
          layout.panTrackX - 8,
          layout.panTrackY - 8,
          layout.panTrackWidth + 16,
          layout.panTrackHeight + 16,
          10,
        );
      } else {
        graphics.fillRoundedRect(
          layout.volumeTrackX - 12,
          layout.volumeTrackY - 8,
          layout.volumeTrackWidth + 24,
          layout.volumeTrackHeight + 16,
          10,
        );
        graphics.strokeRoundedRect(
          layout.volumeTrackX - 12,
          layout.volumeTrackY - 8,
          layout.volumeTrackWidth + 24,
          layout.volumeTrackHeight + 16,
          10,
        );
      }
      return true;
    }

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

    const hoveredActiveCell = this.isCellActive(this.getDisplayPattern(), cell.step, cell.row);
    const theme = this.getTilesetTheme();
    const color =
      hoveredActiveCell && resolveSequencerTool() !== 'copy'
        ? theme.accentHot
        : this.getInstrumentColor();
    const origin = this.getWorkspaceOrigin();
    graphics.lineStyle(2, color, 0.9);
    graphics.fillStyle(color, hoveredActiveCell ? 0.08 : 0.18);
    graphics.fillRect(origin.x + cell.step * TILE_SIZE, origin.y + cell.row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    graphics.strokeRect(origin.x + cell.step * TILE_SIZE, origin.y + cell.row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
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
    this.drawMixControls();
    this.updateRowLabels();
    this.updateMixLabels();
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
    this.overlayMixControls?.destroy();
    this.overlayMixControls = null;
    for (const label of this.rowLabels) {
      label.destroy();
    }
    this.rowLabels = [];
    this.mixTitleLabel?.destroy();
    this.mixTitleLabel = null;
    this.mixReadoutLabel?.destroy();
    this.mixReadoutLabel = null;
  }

  private setOverlayVisible(visible: boolean): void {
    this.overlayBackdrop?.setVisible(visible);
    this.overlayGrid?.setVisible(visible);
    this.overlayCells?.setVisible(visible);
    this.overlayPlayhead?.setVisible(visible);
    this.overlayMixControls?.setVisible(visible);
    for (const label of this.rowLabels) {
      label.setVisible(visible);
    }
    this.mixTitleLabel?.setVisible(visible);
    this.mixReadoutLabel?.setVisible(visible);

    if (!visible) {
      this.overlayBackdrop?.clear();
      this.overlayGrid?.clear();
      this.overlayCells?.clear();
      this.overlayPlayhead?.clear();
      this.overlayMixControls?.clear();
    }
  }

  private getTilesetTheme() {
    return getTilesetUiTheme(editorState.selectedTilesetKey);
  }

  private getInstrumentColor(instrumentId: RoomPatternInstrumentId = this.activeInstrumentTab): number {
    return getPatternInstrumentColor(instrumentId);
  }

  private getWorkspaceOrigin(): { x: number; y: number } {
    return this.host.getWorkspaceOrigin?.() ?? { x: 0, y: 0 };
  }

  private getLocalPointerWorldPoint(pointer: Phaser.Input.Pointer): Phaser.Math.Vector2 {
    const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const origin = this.getWorkspaceOrigin();
    return new Phaser.Math.Vector2(worldPoint.x - origin.x, worldPoint.y - origin.y);
  }

  private drawBackdrop(): void {
    if (!this.overlayBackdrop) {
      return;
    }

    const theme = this.getTilesetTheme();
    const origin = this.getWorkspaceOrigin();
    this.overlayBackdrop.clear();
    this.overlayBackdrop.fillStyle(0x050506, 0.68);
    this.overlayBackdrop.fillRect(origin.x, origin.y, ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
    this.overlayBackdrop.fillStyle(theme.accentAlt, 0.08);
    this.overlayBackdrop.fillRect(
      origin.x + ROOM_PATTERN_MARGIN_START_STEP * TILE_SIZE,
      origin.y,
      (ROOM_PX_WIDTH - ROOM_PATTERN_MARGIN_START_STEP * TILE_SIZE),
      ROOM_PX_HEIGHT,
    );

    if (this.activeInstrumentTab === 'drums') {
      this.overlayBackdrop.fillStyle(theme.accentWarm, 0.08);
      this.overlayBackdrop.fillRect(
        origin.x,
        origin.y,
        ROOM_PATTERN_ACTIVE_STEP_COLUMNS * TILE_SIZE,
        ROOM_PATTERN_DRUM_GRID_START_ROW * TILE_SIZE,
      );
    }
  }

  private drawGrid(): void {
    if (!this.overlayGrid) {
      return;
    }

    const theme = this.getTilesetTheme();
    const origin = this.getWorkspaceOrigin();
    this.overlayGrid.clear();
    for (let x = 0; x <= ROOM_PATTERN_ACTIVE_STEP_COLUMNS; x += 1) {
      const lineAlpha = x === 16 ? 0.76 : x % 4 === 0 ? 0.4 : 0.14;
      const lineWidth = x === 16 ? 3 : x % 4 === 0 ? 2 : 1;
      const color = x === 16 ? theme.accentHot : x % 4 === 0 ? theme.accentWarm : 0xf2ecd9;
      this.overlayGrid.lineStyle(lineWidth, color, lineAlpha);
      this.overlayGrid.beginPath();
      this.overlayGrid.moveTo(origin.x + x * TILE_SIZE, origin.y);
      this.overlayGrid.lineTo(origin.x + x * TILE_SIZE, origin.y + ROOM_PX_HEIGHT);
      this.overlayGrid.strokePath();
    }

    for (let y = 0; y <= ROOM_HEIGHT; y += 1) {
      const rowAlpha =
        this.activeInstrumentTab === 'drums' && y <= ROOM_PATTERN_DRUM_GRID_START_ROW
          ? 0.08
          : 0.18;
      this.overlayGrid.lineStyle(1, theme.accentAlt, rowAlpha);
      this.overlayGrid.beginPath();
      this.overlayGrid.moveTo(origin.x, origin.y + y * TILE_SIZE);
      this.overlayGrid.lineTo(origin.x + ROOM_PATTERN_ACTIVE_STEP_COLUMNS * TILE_SIZE, origin.y + y * TILE_SIZE);
      this.overlayGrid.strokePath();
    }

    this.overlayGrid.lineStyle(2, theme.accentCool, 0.42);
    this.overlayGrid.strokeRect(
      origin.x,
      origin.y,
      ROOM_PATTERN_ACTIVE_STEP_COLUMNS * TILE_SIZE,
      ROOM_PX_HEIGHT,
    );
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
    const color = this.getInstrumentColor();
    const origin = this.getWorkspaceOrigin();
    if (this.activeInstrumentTab === 'drums') {
      this.overlayCells.fillStyle(color, 0.88);
      for (const row of ROOM_PATTERN_DRUM_ROWS) {
        for (const step of pattern.tabs.drums[row.id]) {
          this.overlayCells.fillRect(
            origin.x + step * TILE_SIZE + 2,
            origin.y + row.gridRow * TILE_SIZE + 2,
            TILE_SIZE - 4,
            TILE_SIZE - 4,
          );
        }
      }
      return;
    }

    this.overlayCells.fillStyle(color, 0.86);
    const instrumentId = this.activeInstrumentTab as RoomPatternTonalInstrumentId;
    const track = pattern.tabs[instrumentId];
    const steps = track.steps;
    let step = 0;
    while (step < steps.length) {
      if (steps[step] === null) {
        step += 1;
        continue;
      }

      const midi = getPatternStepMidi(pattern, instrumentId, step);
      const rowIndex = this.getTonalStepDisplayRow(pattern, instrumentId, step);
      let endStep = step + 1;
      while (
        midi !== null &&
        endStep < steps.length &&
        steps[endStep] !== null &&
        track.ties[endStep] === true &&
        getPatternStepMidi(pattern, instrumentId, endStep) === midi
      ) {
        endStep += 1;
      }
      if (rowIndex !== null) {
        this.overlayCells.fillRect(
          origin.x + step * TILE_SIZE + 2,
          origin.y + rowIndex * TILE_SIZE + 2,
          (endStep - step) * TILE_SIZE - 4,
          TILE_SIZE - 4,
        );
      }
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

    const theme = this.getTilesetTheme();
    const origin = this.getWorkspaceOrigin();
    this.overlayPlayhead.fillStyle(theme.accentWarm, 0.12);
    this.overlayPlayhead.fillRect(origin.x + playheadStep * TILE_SIZE, origin.y, TILE_SIZE, ROOM_PX_HEIGHT);
    this.overlayPlayhead.lineStyle(2, theme.accentWarm, 0.9);
    this.overlayPlayhead.beginPath();
    this.overlayPlayhead.moveTo(origin.x + playheadStep * TILE_SIZE, origin.y);
    this.overlayPlayhead.lineTo(origin.x + playheadStep * TILE_SIZE, origin.y + ROOM_PX_HEIGHT);
    this.overlayPlayhead.strokePath();
  }

  private drawMixControls(): void {
    if (!this.overlayMixControls) {
      return;
    }

    this.overlayMixControls.clear();
    const layout = this.getMixControlLayout();
    const mix = this.getActiveInstrumentMix();
    const disabled = this.getLegacyStemNoticeVisible();
    const theme = this.getTilesetTheme();
    const color = this.getInstrumentColor();
    const panelAlpha = disabled ? 0.16 : 0.28;
    const accentAlpha = disabled ? 0.32 : 0.9;
    const trackAlpha = disabled ? 0.16 : 0.34;

    this.overlayMixControls.fillStyle(0x0a0a0a, 0.82);
    this.overlayMixControls.fillRoundedRect(
      layout.panelX,
      layout.panelY,
      layout.panelWidth,
      layout.panelHeight,
      14,
    );
    this.overlayMixControls.lineStyle(2, theme.accentAlt, panelAlpha);
    this.overlayMixControls.strokeRoundedRect(
      layout.panelX,
      layout.panelY,
      layout.panelWidth,
      layout.panelHeight,
      14,
    );

    this.overlayMixControls.fillStyle(theme.accentAlt, trackAlpha);
    this.overlayMixControls.fillRoundedRect(
      layout.panTrackX,
      layout.panTrackY,
      layout.panTrackWidth,
      layout.panTrackHeight,
      5,
    );
    this.overlayMixControls.lineStyle(1, theme.accentWarm, 0.3);
    this.overlayMixControls.beginPath();
    this.overlayMixControls.moveTo(layout.centerX, layout.panTrackY - 5);
    this.overlayMixControls.lineTo(layout.centerX, layout.panTrackY + layout.panTrackHeight + 5);
    this.overlayMixControls.strokePath();

    const panX = layout.panTrackX + ((mix.pan + 1) * 0.5) * layout.panTrackWidth;
    this.overlayMixControls.fillStyle(color, accentAlpha);
    this.overlayMixControls.fillCircle(panX, layout.panTrackY + layout.panTrackHeight * 0.5, 8);
    this.overlayMixControls.lineStyle(2, 0x090909, disabled ? 0.28 : 0.55);
    this.overlayMixControls.strokeCircle(panX, layout.panTrackY + layout.panTrackHeight * 0.5, 8);

    this.overlayMixControls.fillStyle(theme.accentAlt, trackAlpha);
    this.overlayMixControls.fillRoundedRect(
      layout.volumeTrackX,
      layout.volumeTrackY,
      layout.volumeTrackWidth,
      layout.volumeTrackHeight,
      6,
    );
    const filledHeight = layout.volumeTrackHeight * mix.volume;
    const fillY = layout.volumeTrackY + layout.volumeTrackHeight - filledHeight;
    this.overlayMixControls.fillStyle(color, disabled ? 0.18 : 0.42);
    this.overlayMixControls.fillRoundedRect(
      layout.volumeTrackX,
      fillY,
      layout.volumeTrackWidth,
      Math.max(10, filledHeight),
      6,
    );

    const volumeY = layout.volumeTrackY + (1 - mix.volume) * layout.volumeTrackHeight;
    this.overlayMixControls.fillStyle(color, accentAlpha);
    this.overlayMixControls.fillRoundedRect(
      layout.volumeTrackX - 6,
      volumeY - 5,
      layout.volumeTrackWidth + 12,
      10,
      5,
    );
    this.overlayMixControls.lineStyle(2, 0x090909, disabled ? 0.28 : 0.55);
    this.overlayMixControls.strokeRoundedRect(
      layout.volumeTrackX - 6,
      volumeY - 5,
      layout.volumeTrackWidth + 12,
      10,
      5,
    );
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
    const theme = this.getTilesetTheme();
    const origin = this.getWorkspaceOrigin();
    for (let rowIndex = 0; rowIndex < this.rowLabels.length; rowIndex += 1) {
      const label = this.rowLabels[rowIndex];
      label.setVisible(this.overlayBackdrop?.visible ?? false);
      label.setPosition(origin.x - 8, origin.y + rowIndex * TILE_SIZE + TILE_SIZE * 0.5);
      label.setText(
        getPatternRowLabel(
          this.activeInstrumentTab,
          rowIndex,
          pattern.pitchMode,
          this.activeInstrumentTab === 'drums'
            ? 0
            : pattern.octaveShift[this.activeInstrumentTab as RoomPatternTonalInstrumentId],
          pattern.keyTonic,
          pattern.keyMode,
        ),
      );
      label.setAlpha(
        this.activeInstrumentTab === 'drums' && rowIndex < ROOM_PATTERN_DRUM_GRID_START_ROW
          ? 0.2
          : 0.92,
      );
      label.setColor(
        this.activeInstrumentTab === 'drums' && rowIndex < ROOM_PATTERN_DRUM_GRID_START_ROW
          ? colorNumberToCssHex(theme.accentAlt)
          : colorNumberToCssHex(this.getInstrumentColor())
      );
    }
  }

  private updateMixLabels(): void {
    const layout = this.getMixControlLayout();
    const mix = this.getActiveInstrumentMix();
    const theme = this.getTilesetTheme();
    const panLabel =
      mix.pan <= -0.05
        ? `L${Math.round(Math.abs(mix.pan) * 100)}`
        : mix.pan >= 0.05
          ? `R${Math.round(mix.pan * 100)}`
          : 'C';
    const disabled = this.getLegacyStemNoticeVisible();

    this.mixTitleLabel?.setPosition(layout.centerX, layout.panelY + (MIX_TITLE_Y - 8));
    this.mixTitleLabel?.setText(getPatternInstrumentLabel(this.activeInstrumentTab));
    this.mixTitleLabel?.setAlpha(disabled ? 0.4 : 0.92);
    this.mixTitleLabel?.setColor(colorNumberToCssHex(this.getInstrumentColor()));

    this.mixReadoutLabel?.setPosition(layout.centerX, layout.panelY + (MIX_READOUT_Y - 8));
    this.mixReadoutLabel?.setText(`PAN ${panLabel} · VOL ${Math.round(mix.volume * 100)}%`);
    this.mixReadoutLabel?.setAlpha(disabled ? 0.34 : 0.78);
    this.mixReadoutLabel?.setColor(colorNumberToCssHex(theme.accentWarm));
  }

  private drawSelectionRect(graphics: Phaser.GameObjects.Graphics, rect: MusicRect): void {
    const theme = this.getTilesetTheme();
    const origin = this.getWorkspaceOrigin();
    graphics.lineStyle(2, theme.accentWarm, 0.92);
    graphics.fillStyle(theme.accentWarm, 0.1);
    graphics.fillRect(
      origin.x + rect.x1 * TILE_SIZE,
      origin.y + rect.y1 * TILE_SIZE,
      (rect.x2 - rect.x1 + 1) * TILE_SIZE,
      (rect.y2 - rect.y1 + 1) * TILE_SIZE,
    );
    graphics.strokeRect(
      origin.x + rect.x1 * TILE_SIZE,
      origin.y + rect.y1 * TILE_SIZE,
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

    const color = this.getInstrumentColor();
    const origin = this.getWorkspaceOrigin();
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

        graphics.fillRect(origin.x + targetStep * TILE_SIZE, origin.y + targetRow * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        graphics.strokeRect(origin.x + targetStep * TILE_SIZE, origin.y + targetRow * TILE_SIZE, TILE_SIZE, TILE_SIZE);
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

        graphics.fillRect(origin.x + targetStep * TILE_SIZE, origin.y + targetRow * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        graphics.strokeRect(origin.x + targetStep * TILE_SIZE, origin.y + targetRow * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  private getMixControlLayout(): MixControlLayout {
    const origin = this.getWorkspaceOrigin();
    const marginWidth = ROOM_PX_WIDTH - ROOM_PATTERN_MARGIN_START_STEP * TILE_SIZE;
    const panelWidth = Math.min(MIX_PANEL_WIDTH, marginWidth - MIX_PANEL_PADDING * 2);
    const panelX = origin.x + ROOM_PATTERN_MARGIN_START_STEP * TILE_SIZE + (marginWidth - panelWidth) * 0.5;
    const centerX = panelX + panelWidth * 0.5;
    return {
      panelX,
      panelY: origin.y + 8,
      panelWidth,
      panelHeight: ROOM_PX_HEIGHT - 16,
      panTrackX: centerX - MIX_PAN_TRACK_WIDTH * 0.5,
      panTrackY: origin.y + MIX_PAN_TRACK_Y,
      panTrackWidth: MIX_PAN_TRACK_WIDTH,
      panTrackHeight: MIX_PAN_TRACK_HEIGHT,
      volumeTrackX: centerX - MIX_VOLUME_TRACK_WIDTH * 0.5,
      volumeTrackY: origin.y + MIX_VOLUME_TRACK_Y,
      volumeTrackWidth: MIX_VOLUME_TRACK_WIDTH,
      volumeTrackHeight: MIX_VOLUME_TRACK_HEIGHT,
      centerX,
    };
  }

  private getMixControlHit(
    pointer: Phaser.Input.Pointer,
    preferredControl?: 'volume' | 'pan',
  ): { control: 'volume' | 'pan'; value: number } | null {
    const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const layout = this.getMixControlLayout();
    const panHitRect = new Phaser.Geom.Rectangle(
      layout.panTrackX - 10,
      layout.panTrackY - 12,
      layout.panTrackWidth + 20,
      layout.panTrackHeight + 24,
    );
    const volumeHitRect = new Phaser.Geom.Rectangle(
      layout.volumeTrackX - 18,
      layout.volumeTrackY - 8,
      layout.volumeTrackWidth + 36,
      layout.volumeTrackHeight + 16,
    );

    const panValue = Phaser.Math.Clamp(
      ((worldPoint.x - layout.panTrackX) / layout.panTrackWidth) * 2 - 1,
      -1,
      1,
    );
    const volumeValue = Phaser.Math.Clamp(
      1 - ((worldPoint.y - layout.volumeTrackY) / layout.volumeTrackHeight),
      0,
      1,
    );

    if (preferredControl === 'pan') {
      return { control: 'pan', value: panValue };
    }
    if (preferredControl === 'volume') {
      return { control: 'volume', value: volumeValue };
    }

    if (Phaser.Geom.Rectangle.Contains(panHitRect, worldPoint.x, worldPoint.y)) {
      return { control: 'pan', value: panValue };
    }
    if (Phaser.Geom.Rectangle.Contains(volumeHitRect, worldPoint.x, worldPoint.y)) {
      return { control: 'volume', value: volumeValue };
    }

    return null;
  }

  private getCellFromPointer(pointer: Phaser.Input.Pointer): { step: number; row: number } | null {
    const worldPoint = this.getLocalPointerWorldPoint(pointer);
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

  private isCellActive(pattern: RoomPatternMusic, step: number, row: number): boolean {
    if (this.activeInstrumentTab === 'drums') {
      const drumRow = getPatternDrumRowForGridRow(row);
      return Boolean(drumRow && pattern.tabs.drums[drumRow.id].includes(step));
    }

    const instrumentId = this.activeInstrumentTab as RoomPatternTonalInstrumentId;
    return this.getTonalStepDisplayRow(pattern, instrumentId, step) === row;
  }

  private getTonalStepDisplayRow(
    pattern: RoomPatternMusic,
    instrumentId: RoomPatternTonalInstrumentId,
    step: number,
  ): number | null {
    const midi = getPatternStepMidi(pattern, instrumentId, step);
    if (midi === null) {
      return null;
    }

    return findPatternRowIndexForMidi(
      instrumentId,
      midi,
      pattern.pitchMode,
      pattern.octaveShift[instrumentId],
      pattern.keyTonic,
      pattern.keyMode,
    );
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
      this.host.previewPatternCell(pattern, this.activeInstrumentTab, row);
      this.lastAppliedCell = { step, row };
      return;
    }

    const instrumentId = this.activeInstrumentTab as RoomPatternTonalInstrumentId;
    const track = pattern.tabs[instrumentId];
    const currentRow = track.steps[step];
    const currentDisplayRow = this.getTonalStepDisplayRow(pattern, instrumentId, step);
    if (tool === 'eraser') {
      if (currentDisplayRow !== row) {
        return;
      }
      track.steps[step] = null;
      track.ties[step] = false;
      track.midis[step] = null;
      this.normalizeTonalTrackTies(track);
      this.commitPattern(pattern);
      this.lastAppliedCell = { step, row };
      return;
    }

    const targetMidi = getPatternRowNote(
      instrumentId,
      row,
      pattern.pitchMode,
      pattern.octaveShift[instrumentId],
      pattern.keyTonic,
      pattern.keyMode,
    )?.midi ?? null;
    const shouldTieFromPrevious =
      this.dragMode === 'draw' &&
      this.lastAppliedCell !== null &&
      this.lastAppliedCell.row === row &&
      Math.abs(this.lastAppliedCell.step - step) === 1;
    const currentTie = track.ties[step] === true;
    if (
      currentRow !== null &&
      currentDisplayRow === row &&
      currentTie === shouldTieFromPrevious &&
      (track.midis[step] ?? null) === targetMidi
    ) {
      this.lastAppliedCell = { step, row };
      return;
    }

    track.steps[step] = row;
    track.midis[step] = targetMidi;
    track.ties[step] = shouldTieFromPrevious;
    this.normalizeTonalTrackTies(track);
    this.commitPattern(pattern);
    this.host.previewPatternCell(pattern, this.activeInstrumentTab, row);
    this.lastAppliedCell = { step, row };
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
        tonalStepTies: null,
        drumMask,
      };
      this.host.renderUi();
      return;
    }

    const width = normalized.x2 - normalized.x1 + 1;
    const instrumentId = this.activeInstrumentTab as RoomPatternTonalInstrumentId;
    const track = pattern.tabs[instrumentId];
    const tonalStepRows = Array.from({ length: width }, () => null as number | null);
    const tonalStepTies = Array.from({ length: width }, () => false);
    let hasAny = false;
    for (let stepOffset = 0; stepOffset < width; stepOffset += 1) {
      const absoluteStep = normalized.x1 + stepOffset;
      const absoluteRow = this.getTonalStepDisplayRow(pattern, instrumentId, absoluteStep);
      if (absoluteRow === null || absoluteRow < normalized.y1 || absoluteRow > normalized.y2) {
        continue;
      }
      tonalStepRows[stepOffset] = absoluteRow - normalized.y1;
      tonalStepTies[stepOffset] =
        stepOffset > 0 && track.ties[absoluteStep] === true && tonalStepRows[stepOffset - 1] !== null;
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
      tonalStepTies,
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
      const track = pattern.tabs[this.activeInstrumentTab as RoomPatternTonalInstrumentId];
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

        const targetTie =
          stepOffset > 0 &&
          clipboard.tonalStepTies?.[stepOffset] === true &&
          clipboard.tonalStepRows[stepOffset - 1] !== null;
        const targetMidi = getPatternRowNote(
          this.activeInstrumentTab as RoomPatternTonalInstrumentId,
          targetRow,
          pattern.pitchMode,
          pattern.octaveShift[this.activeInstrumentTab as RoomPatternTonalInstrumentId],
          pattern.keyTonic,
          pattern.keyMode,
        )?.midi ?? null;
        if (
          track.steps[targetStep] !== targetRow ||
          track.ties[targetStep] !== targetTie ||
          (track.midis[targetStep] ?? null) !== targetMidi
        ) {
          track.steps[targetStep] = targetRow;
          track.midis[targetStep] = targetMidi;
          track.ties[targetStep] = targetTie;
          changed = true;
        }
      }
      if (changed) {
        this.normalizeTonalTrackTies(track);
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
    this.mixDragMode = null;
    this.dragStartCell = null;
    this.dragCurrentCell = null;
    this.lastDragCellKey = null;
    this.lastAppliedCell = null;
  }

  private normalizeTonalTrackTies(
    track: RoomPatternMusic['tabs'][RoomPatternTonalInstrumentId],
  ): void {
    if (track.midis.length > track.steps.length) {
      track.midis.length = track.steps.length;
    }
    while (track.midis.length < track.steps.length) {
      track.midis.push(null);
    }

    for (let index = 0; index < track.ties.length; index += 1) {
      if (index === 0) {
        track.ties[index] = false;
        continue;
      }

      const currentRow = track.steps[index];
      const previousRow = track.steps[index - 1];
      track.ties[index] =
        track.ties[index] === true &&
        currentRow !== null &&
        previousRow !== null &&
        this.areTonalStepsSameNote(
          currentRow,
          previousRow,
          track.midis[index] ?? null,
          track.midis[index - 1] ?? null,
        );
    }
  }

  private areTonalStepsSameNote(
    currentRow: number,
    previousRow: number,
    currentMidi: number | null,
    previousMidi: number | null,
  ): boolean {
    if (currentMidi !== null || previousMidi !== null) {
      return currentMidi !== null && previousMidi !== null && currentMidi === previousMidi;
    }

    return currentRow === previousRow;
  }
}
