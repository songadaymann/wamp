import Phaser from 'phaser';
import { playSfx } from '../../audio/sfx';
import { editorState } from '../../config';
import { globalRoomMusicController } from '../../music/controller';
import {
  extractMusicPhrasePayloadFromPattern,
  type MusicPhraseRecord,
} from '../../music/library';
import {
  ROOM_PATTERN_INSTRUMENT_IDS,
  ROOM_PATTERN_MAX_BPM,
  ROOM_PATTERN_MAX_SWING_PERCENT,
  ROOM_PATTERN_MIN_BPM,
  ROOM_PATTERN_MIN_SWING_PERCENT,
  ROOM_PHRASE_ARRANGEMENT_SLOT_COUNT,
  cloneRoomPatternMusic,
  cloneRoomPhraseArrangementMusic,
  createDefaultRoomPatternMusic,
  createDefaultRoomPhraseArrangementMusic,
  detectRoomPatternTrackKey,
  getPatternInstrumentColorCss,
  getPatternInstrumentColorRgbCss,
  getPatternInstrumentIcon,
  getPatternInstrumentLabel,
  getRoomPhraseArrangementActiveSlotCount,
  isPatternRoomMusic,
  isPhraseArrangementRoomMusic,
  isStemArrangementRoomMusic,
  normalizeRoomPatternBpm,
  normalizeRoomPatternSwingPercent,
  normalizeRoomPhraseArrangementSlotCount,
  rekeyRoomPatternMusicPreservingMidi,
  setRoomPhraseArrangementSlotCount,
  type RoomMusic,
  type RoomMusicKeyMode,
  type RoomMusicKeyTonic,
  type RoomPatternInstrumentId,
  type RoomPatternPitchMode,
  type RoomPatternTonalInstrumentId,
  type RoomPhraseArrangementMusic,
} from '../../music/model';
import type { RoomRecord, RoomSnapshot } from '../../persistence/roomRepository';
import { EditorMusicPatternController } from './musicPatternEditor';
import {
  renderMusicArrangementPanel,
  renderMusicLibraryPanel,
  renderMusicWorkbenchModeButtons,
  type EditorMusicArrangementSelection,
  type EditorMusicComposerMode,
} from './musicUi';
import {
  EditorMusicPhraseOrchestrator,
  type EditorMusicPhraseSavePromptMode,
} from './musicPhraseOrchestrator';

export type EditorMusicPreviewState = 'stopped' | 'playing';

export interface EditorMusicPhraseSaveOptions {
  instrumentId?: RoomPatternInstrumentId | null;
  saveMode?: 'overwrite' | 'save-as' | null;
  overwritePhraseId?: string | null;
}

interface EditorMusicWorkflowPermissions {
  canSaveDraft: boolean;
  canPublish: boolean;
}

interface EditorMusicSaveContext {
  getSavedSnapshot(record: RoomRecord): RoomSnapshot | null;
}

type EditorMusicSummaryScope =
  | { kind: 'room' }
  | { kind: 'cell'; label: string };

export interface EditorMusicWorkflowHost {
  canActivateMusicMode?(): boolean;
  commitRoomMusic(nextMusic: RoomMusic | null): RoomMusic | null;
  getCurrentUserId(): string | null;
  getPublishValidationError(): string | null;
  getRoomMusic(): RoomMusic | null;
  getRoomPermissions(): EditorMusicWorkflowPermissions;
  getRoomVersion(): number;
  getSaveInFlight(): boolean;
  getSummaryScope(): EditorMusicSummaryScope;
  onMusicModeToolActivated?(): void;
  prepareSaveContext?(): EditorMusicSaveContext | null;
  replaceLegacyRoomMusicWithPattern(): RoomMusic | null;
  requestRender(): void;
  saveDraft(force?: boolean, options?: { promptForSignInOnUnauthorized?: boolean }): Promise<RoomRecord | null>;
  shouldRenderAfterPreviewStop?(): boolean;
  updatePersistenceStatus(text: string): void;
}

export class EditorMusicWorkflowCoordinator {
  private patternController: EditorMusicPatternController | null = null;
  private musicModeActive = false;
  private musicComposerMode: EditorMusicComposerMode = 'sequencer';
  private musicPreviewState: EditorMusicPreviewState = 'stopped';
  private preferredPhraseArrangementSlotCount = ROOM_PHRASE_ARRANGEMENT_SLOT_COUNT;
  private readonly musicPhraseOrchestrator = new EditorMusicPhraseOrchestrator();

  constructor(private readonly host: EditorMusicWorkflowHost) {}

  attachPatternController(patternController: EditorMusicPatternController): void {
    this.patternController = patternController;
  }

  isActive(): boolean {
    return this.musicModeActive;
  }

  getComposerMode(): EditorMusicComposerMode {
    return this.musicComposerMode;
  }

  getPreviewState(): EditorMusicPreviewState {
    return this.musicPreviewState;
  }

  isSequencerModeActive(): boolean {
    return this.musicModeActive && this.musicComposerMode === 'sequencer';
  }

  resetForSceneOpen(): void {
    this.musicModeActive = false;
    this.musicComposerMode = 'sequencer';
    this.musicPreviewState = 'stopped';
    this.musicPhraseOrchestrator.resetSavePrompt();
    this.stopPreviewPlayback('editor-preview');
  }

  resetForRuntimeClear(): void {
    this.musicModeActive = false;
    this.musicComposerMode = 'sequencer';
    this.musicPreviewState = 'stopped';
    this.musicPhraseOrchestrator.resetSavePrompt();
    this.stopPreviewPlayback('idle');
  }

  resetForShutdown(options: { stopMode: 'idle' | 'editor-preview'; render: boolean }): void {
    this.musicModeActive = false;
    this.musicPreviewState = 'stopped';
    this.musicPhraseOrchestrator.resetSavePrompt();
    if (options.render) {
      this.renderUi();
    }
    this.stopPreviewPlayback(options.stopMode);
  }

  async handleRoomPublished(): Promise<void> {
    this.musicPhraseOrchestrator.resetLibraryAfterPublish();
    if (this.musicModeActive) {
      await this.loadMusicPhraseLibrary(true);
    }
  }

  async saveRoomMusicDraftAndPhrases(
    options?: EditorMusicPhraseSaveOptions,
  ): Promise<RoomRecord | null> {
    const saveContext =
      this.host.prepareSaveContext?.() ??
      {
        getSavedSnapshot: (record: RoomRecord) => record.draft,
      };
    if (!saveContext) {
      return null;
    }

    const record = await this.host.saveDraft(true, { promptForSignInOnUnauthorized: true });
    if (!record) {
      return null;
    }

    const savedSnapshot = saveContext.getSavedSnapshot(record);
    if (!savedSnapshot || this.musicComposerMode !== 'sequencer' || !isPatternRoomMusic(savedSnapshot.music)) {
      return record;
    }

    this.musicPhraseOrchestrator.setSaveInFlight(true);
    this.requestRender();

    try {
      const response = await this.musicPhraseOrchestrator.savePhrases(
        savedSnapshot,
        this.requirePatternController().getActiveInstrumentTab(),
        {
          instrumentId: options?.instrumentId ?? null,
          saveMode: options?.saveMode ?? null,
          overwritePhraseId: options?.overwritePhraseId ?? null,
        },
      );

      if (options?.instrumentId) {
        const savedPhrase = response.items.find((phrase) => phrase.instrumentId === options.instrumentId) ?? null;
        if (savedPhrase) {
          this.syncActivePatternPhraseRecord(savedPhrase);
        }
      }

      if (response.items.length === 0) {
        const label = options?.instrumentId
          ? `${getPatternInstrumentLabel(options.instrumentId)} phrase`
          : 'phrases';
        this.host.updatePersistenceStatus(`Draft saved v${this.host.getRoomVersion()}. No non-empty ${label} to save yet.`);
      } else {
        this.host.updatePersistenceStatus(
          response.items.length === 1
            ? `Draft saved v${this.host.getRoomVersion()}. Saved 1 phrase.`
            : `Draft saved v${this.host.getRoomVersion()}. Saved ${response.items.length} phrases.`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : 'Phrase save failed.';
      this.musicPhraseOrchestrator.setLibraryError(message);
      this.host.updatePersistenceStatus(`Draft saved v${this.host.getRoomVersion()}. ${message}`);
    } finally {
      this.musicPhraseOrchestrator.setSaveInFlight(false);
      this.requestRender();
    }

    return record;
  }

  closeRoomMusicPhraseSavePrompt(): void {
    if (!this.musicPhraseOrchestrator.closeSavePrompt()) {
      return;
    }

    this.requestRender();
  }

  setRoomMusicPhraseSavePromptName(value: string): void {
    this.musicPhraseOrchestrator.setSavePromptName(value);
    this.requestRender();
  }

  async saveActiveRoomMusicPhrase(): Promise<RoomRecord | null> {
    if (this.musicComposerMode !== 'sequencer') {
      return this.host.saveDraft(true, { promptForSignInOnUnauthorized: true });
    }

    if (!this.hasSavableActiveRoomMusicPhrase()) {
      return this.persistActiveRoomMusicPhrase({ saveMode: this.getOwnedActivePatternPhrase() ? 'overwrite' : 'save-as' });
    }

    if (!this.getOwnedActivePatternPhrase()) {
      this.openRoomMusicPhraseSavePrompt('save');
      return null;
    }

    return this.persistActiveRoomMusicPhrase({ saveMode: 'overwrite' });
  }

  saveAsActiveRoomMusicPhrase(): void {
    if (this.musicComposerMode !== 'sequencer' || !this.hasSavableActiveRoomMusicPhrase()) {
      return;
    }

    this.openRoomMusicPhraseSavePrompt('save-as');
  }

  async confirmRoomMusicPhraseSavePrompt(): Promise<void> {
    if (!this.musicPhraseOrchestrator.getSavePromptMode()) {
      return;
    }

    const trimmedName = this.musicPhraseOrchestrator.getSavePromptName().trim().slice(0, 24);
    if (!trimmedName) {
      this.musicPhraseOrchestrator.setSavePromptError('Name this phrase before saving.');
      this.requestRender();
      return;
    }

    const record = await this.persistActiveRoomMusicPhrase({
      saveMode: 'save-as',
      promptedNameSuffix: trimmedName,
    });
    if (record) {
      this.closeRoomMusicPhraseSavePrompt();
    }
  }

  async startNewRoomMusicPhrase(): Promise<void> {
    if (
      this.host.getSaveInFlight() ||
      this.musicPhraseOrchestrator.getSaveInFlight() ||
      this.musicPhraseOrchestrator.getDeleteInFlight() ||
      !this.host.getRoomPermissions().canSaveDraft
    ) {
      return;
    }

    if (this.musicComposerMode === 'arrangement') {
      const record = await this.host.saveDraft(true, { promptForSignInOnUnauthorized: true });
      if (!record) {
        return;
      }
      this.setMusicComposerMode('sequencer');
    } else {
      const record = await this.persistActiveRoomMusicPhrase({
        saveMode: this.getOwnedActivePatternPhrase() ? 'overwrite' : 'save-as',
      });
      if (!record) {
        return;
      }
    }

    this.requirePatternController().clearActivePhrase();
    this.musicPhraseOrchestrator.setMetadataEditing(true);
    this.host.updatePersistenceStatus(`Started a new ${getPatternInstrumentLabel(this.requirePatternController().getActiveInstrumentTab())} phrase.`);
    this.requestRender();
  }

  toggleRoomMusicPhraseMetadataEditor(): void {
    if (this.musicComposerMode !== 'sequencer') {
      return;
    }

    if (this.musicPhraseOrchestrator.toggleMetadataEditing()) {
      this.ensureActivePatternPhraseCache();
    }
    this.requestRender();
  }

  async deleteActiveRoomMusicPhrase(): Promise<void> {
    if (
      this.musicComposerMode !== 'sequencer' ||
      this.host.getSaveInFlight() ||
      this.musicPhraseOrchestrator.getSaveInFlight() ||
      this.musicPhraseOrchestrator.getDeleteInFlight()
    ) {
      return;
    }

    const phrase = this.getActivePatternPhraseRecord();
    const currentUserId = this.host.getCurrentUserId();
    if (!phrase || !currentUserId || phrase.creatorUserId !== currentUserId) {
      this.host.updatePersistenceStatus('You can only delete phrases you created.');
      return;
    }

    this.musicPhraseOrchestrator.setDeleteInFlight(true);
    this.requestRender();

    try {
      await this.musicPhraseOrchestrator.deletePhrase(phrase.id);
      this.requirePatternController().clearActivePhrase();
      this.musicPhraseOrchestrator.setMetadataEditing(true);
      this.host.updatePersistenceStatus(`Deleted ${this.getMusicPhraseSampleName(phrase)}.`);
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : 'Phrase delete failed.';
      this.musicPhraseOrchestrator.setLibraryError(message);
      this.host.updatePersistenceStatus(message);
    } finally {
      this.musicPhraseOrchestrator.setDeleteInFlight(false);
      this.requestRender();
    }
  }

  setMusicModeActive(active: boolean): void {
    if (active && this.host.canActivateMusicMode && !this.host.canActivateMusicMode()) {
      return;
    }

    this.musicModeActive = active;
    this.musicPhraseOrchestrator.resetSavePrompt();
    if (active) {
      this.musicComposerMode = isPhraseArrangementRoomMusic(this.host.getRoomMusic())
        ? 'arrangement'
        : 'sequencer';
      this.musicPhraseOrchestrator.setMetadataEditing(false);
    }
    if (active && editorState.activeTool !== 'pencil' && editorState.activeTool !== 'eraser' && editorState.activeTool !== 'copy') {
      editorState.activeTool = 'pencil';
      this.host.onMusicModeToolActivated?.();
    }
    if (active) {
      this.ensureArrangementSelection(this.requirePatternController().getActiveInstrumentTab());
      this.ensureMusicPhraseLibraryLoaded();
      this.ensureActivePatternPhraseCache();
    }
    if (!active) {
      this.musicPhraseOrchestrator.setMetadataEditing(false);
      this.requirePatternController().cancelPastePreview();
      if (this.musicPreviewState !== 'stopped') {
        this.stopRoomMusicPreview();
        return;
      }
    }
    this.requestRender();
  }

  toggleMusicMode(): void {
    this.setMusicModeActive(!this.musicModeActive);
  }

  setMusicComposerMode(mode: EditorMusicComposerMode): void {
    if (this.musicComposerMode === mode) {
      return;
    }

    this.musicComposerMode = mode;
    this.musicPhraseOrchestrator.resetSavePrompt();
    if (mode === 'arrangement') {
      this.musicPhraseOrchestrator.setMetadataEditing(false);
      this.ensureArrangementSelection(this.requirePatternController().getActiveInstrumentTab());
    }
    this.ensureMusicPhraseLibraryLoaded();
    this.requestRender();
  }

  setMusicPatternInstrumentTab(instrumentId: RoomPatternInstrumentId): void {
    this.requirePatternController().setActiveInstrumentTab(instrumentId);
    this.musicPhraseOrchestrator.resetSavePrompt();
    if (this.musicComposerMode === 'arrangement') {
      this.ensureArrangementSelection(instrumentId);
    }
    this.ensureMusicPhraseLibraryLoaded();
    this.requestRender();
  }

  setRoomMusicPitchMode(mode: RoomPatternPitchMode): void {
    if (this.musicComposerMode === 'arrangement') {
      const arrangement = this.getEditablePhraseArrangement();
      if (!arrangement || arrangement.pitchMode === mode) {
        return;
      }

      arrangement.pitchMode = mode;
      this.commitRoomMusic(arrangement);
      return;
    }

    this.requirePatternController().setPitchMode(mode);
  }

  setRoomMusicKeyTonic(tonic: RoomMusicKeyTonic): void {
    if (this.musicComposerMode === 'arrangement') {
      const arrangement = this.getEditablePhraseArrangement();
      if (!arrangement || arrangement.keyTonic === tonic) {
        return;
      }

      arrangement.keyTonic = tonic;
      this.commitRoomMusic(arrangement);
      return;
    }

    this.requirePatternController().setKeyTonic(tonic);
  }

  setRoomMusicKeyMode(mode: RoomMusicKeyMode): void {
    if (this.musicComposerMode === 'arrangement') {
      const arrangement = this.getEditablePhraseArrangement();
      if (!arrangement || arrangement.keyMode === mode) {
        return;
      }

      arrangement.keyMode = mode;
      this.commitRoomMusic(arrangement);
      return;
    }

    this.requirePatternController().setKeyMode(mode);
  }

  shiftRoomMusicOctave(delta: number): void {
    if (this.musicComposerMode === 'arrangement') {
      const instrumentId = this.requirePatternController().getActiveInstrumentTab();
      if (instrumentId === 'drums') {
        return;
      }

      const arrangement = this.getEditablePhraseArrangement();
      if (!arrangement) {
        return;
      }

      const nextValue = Phaser.Math.Clamp(arrangement.octaveShift[instrumentId] + delta, -2, 2);
      if (nextValue === arrangement.octaveShift[instrumentId]) {
        return;
      }

      arrangement.octaveShift[instrumentId] = nextValue;
      this.commitRoomMusic(arrangement);
      return;
    }

    this.requirePatternController().shiftActiveOctave(delta);
  }

  shiftRoomMusicTempo(delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) {
      return;
    }

    if (this.musicComposerMode === 'arrangement') {
      const arrangement = this.getEditablePhraseArrangement();
      if (!arrangement) {
        return;
      }

      const nextValue = Phaser.Math.Clamp(Math.round(arrangement.bpm + delta), ROOM_PATTERN_MIN_BPM, ROOM_PATTERN_MAX_BPM);
      if (nextValue === arrangement.bpm) {
        return;
      }

      arrangement.bpm = nextValue;
      this.commitRoomMusic(arrangement);
      return;
    }

    const pattern = this.getEditablePatternMusic();
    if (!pattern) {
      return;
    }

    const nextValue = Phaser.Math.Clamp(Math.round(pattern.bpm + delta), ROOM_PATTERN_MIN_BPM, ROOM_PATTERN_MAX_BPM);
    if (nextValue === pattern.bpm) {
      return;
    }

    pattern.bpm = nextValue;
    this.commitRoomMusic(pattern);
  }

  shiftRoomMusicSwing(delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) {
      return;
    }

    if (this.musicComposerMode === 'arrangement') {
      const arrangement = this.getEditablePhraseArrangement();
      if (!arrangement) {
        return;
      }

      const nextValue = Phaser.Math.Clamp(
        Math.round(arrangement.swingPercent + delta),
        ROOM_PATTERN_MIN_SWING_PERCENT,
        ROOM_PATTERN_MAX_SWING_PERCENT,
      );
      if (nextValue === arrangement.swingPercent) {
        return;
      }

      arrangement.swingPercent = nextValue;
      this.commitRoomMusic(arrangement);
      return;
    }

    const pattern = this.getEditablePatternMusic();
    if (!pattern) {
      return;
    }

    const nextValue = Phaser.Math.Clamp(
      Math.round(pattern.swingPercent + delta),
      ROOM_PATTERN_MIN_SWING_PERCENT,
      ROOM_PATTERN_MAX_SWING_PERCENT,
    );
    if (nextValue === pattern.swingPercent) {
      return;
    }

    pattern.swingPercent = nextValue;
    this.commitRoomMusic(pattern);
  }

  setRoomMusicPhraseNameSuffix(value: string): void {
    if (this.musicComposerMode === 'arrangement') {
      return;
    }

    const pattern = this.getEditablePatternMusic();
    if (!pattern) {
      return;
    }

    const instrumentId = this.requirePatternController().getActiveInstrumentTab();
    const normalized = value.trim().slice(0, 24);
    const nextValue = normalized.length > 0 ? normalized : null;
    if ((pattern.phraseNameSuffixes[instrumentId] ?? null) === nextValue) {
      return;
    }

    pattern.phraseNameSuffixes[instrumentId] = nextValue;
    this.commitRoomMusic(pattern);
  }

  replaceLegacyRoomMusicWithPattern(): void {
    this.requirePatternController().replaceLegacyWithPattern();
  }

  refreshMusicPhraseLibrary(): void {
    this.ensureMusicPhraseLibraryLoaded(true);
  }

  loadMoreMusicPhrases(): void {
    if (!this.musicPhraseOrchestrator.canLoadMoreLibrary()) {
      return;
    }

    void this.loadMusicPhraseLibrary(false);
  }

  async useMusicPhrase(phraseId: string): Promise<void> {
    try {
      const phrase = await this.musicPhraseOrchestrator.loadPhrase(phraseId);
      if (this.musicComposerMode === 'arrangement') {
        await this.assignPhraseToArrangementSlot(phrase);
      } else {
        this.requirePatternController().insertPhrase(phrase, {
          adoptPhraseTiming: this.requirePatternController().isPatternWorkspaceEmpty(),
        });
      }
      playSfx('music-phrase-place', { ignoreCooldown: true });
      this.requestRender();
    } catch (error) {
      this.musicPhraseOrchestrator.setLibraryError(
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : 'Failed to load music phrase.',
      );
      this.requestRender();
    }
  }

  selectArrangementSlot(instrumentId: RoomPatternInstrumentId, slotIndex: number): void {
    if (slotIndex < 0 || slotIndex >= this.getDisplayPhraseArrangement().slotCount) {
      return;
    }

    this.musicPhraseOrchestrator.setArrangementSelection({ instrumentId, slotIndex });
    this.requirePatternController().setActiveInstrumentTab(instrumentId);
    this.ensureMusicPhraseLibraryLoaded();
    this.requestRender();
  }

  clearSelectedArrangementSlot(): void {
    const arrangement = this.getEditablePhraseArrangement();
    if (!arrangement) {
      return;
    }

    const selection = this.getArrangementSelection();
    if (arrangement.slots[selection.instrumentId][selection.slotIndex] === null) {
      return;
    }

    arrangement.slots[selection.instrumentId][selection.slotIndex] = null;
    playSfx('music-slot-clear', { ignoreCooldown: true });
    this.commitRoomMusic(arrangement);
  }

  clearAllArrangementSlots(): void {
    const arrangement = this.getEditablePhraseArrangement();
    if (!arrangement) {
      return;
    }

    let changed = false;
    for (const instrumentId of ROOM_PATTERN_INSTRUMENT_IDS) {
      for (let slotIndex = 0; slotIndex < arrangement.slotCount; slotIndex += 1) {
        if (arrangement.slots[instrumentId][slotIndex] !== null) {
          arrangement.slots[instrumentId][slotIndex] = null;
          changed = true;
        }
      }
    }

    if (!changed) {
      return;
    }

    playSfx('music-slot-clear-all', { ignoreCooldown: true });
    this.commitRoomMusic(arrangement);
  }

  async assignMusicPhraseToArrangementSlot(
    phraseId: string,
    instrumentId: RoomPatternInstrumentId,
    slotIndex: number,
  ): Promise<void> {
    if (slotIndex < 0 || slotIndex >= this.getDisplayPhraseArrangement().slotCount) {
      return;
    }

    this.musicPhraseOrchestrator.setArrangementSelection({ instrumentId, slotIndex });
    this.requirePatternController().setActiveInstrumentTab(instrumentId);
    this.ensureMusicPhraseLibraryLoaded();
    this.requestRender();
    await this.useMusicPhrase(phraseId);
  }

  setRoomMusicArrangementSlotCount(slotCount: number): void {
    const arrangement = this.getEditablePhraseArrangement();
    if (!arrangement) {
      return;
    }

    this.preferredPhraseArrangementSlotCount = normalizeRoomPhraseArrangementSlotCount(slotCount);
    const nextArrangement = setRoomPhraseArrangementSlotCount(arrangement, slotCount);
    if (nextArrangement.slotCount === arrangement.slotCount) {
      this.requestRender();
      return;
    }

    const selection = this.getArrangementSelection();
    if (selection.slotIndex >= nextArrangement.slotCount) {
      this.musicPhraseOrchestrator.setArrangementSelection({
        instrumentId: selection.instrumentId,
        slotIndex: nextArrangement.slotCount - 1,
      });
    }
    this.commitRoomMusic(nextArrangement);
  }

  toggleRoomMusicPreview(): void {
    if (this.musicPreviewState === 'playing') {
      this.stopRoomMusicPreview();
      return;
    }

    this.playRoomMusicPreview();
  }

  stopRoomMusicPreview(): void {
    this.musicPreviewState = 'stopped';
    this.stopPreviewPlayback('editor-preview');
    if (this.host.shouldRenderAfterPreviewStop?.() ?? true) {
      this.requestRender();
    }
  }

  syncRoomMusicPreviewPlayback(): void {
    if (this.musicPreviewState !== 'playing') {
      this.stopPreviewPlayback('editor-preview');
      return;
    }

    const roomMusic = this.host.getRoomMusic();
    if (!roomMusic) {
      this.musicPreviewState = 'stopped';
      this.stopPreviewPlayback('editor-preview');
      return;
    }

    void globalRoomMusicController.playArrangement(roomMusic, {
      mode: 'editor-preview',
      transition: 'immediate',
    });
  }

  commitRoomMusic(nextMusic: RoomMusic | null): RoomMusic | null {
    if (isPhraseArrangementRoomMusic(nextMusic)) {
      this.preferredPhraseArrangementSlotCount = normalizeRoomPhraseArrangementSlotCount(nextMusic.slotCount);
    }
    const committed = this.host.commitRoomMusic(nextMusic);
    if (this.musicPreviewState === 'playing') {
      this.syncRoomMusicPreviewPlayback();
    }
    this.requestRender();
    return committed;
  }

  commitLegacyRoomMusicPatternReplacement(): RoomMusic | null {
    const committed = this.host.replaceLegacyRoomMusicWithPattern();
    if (this.musicPreviewState === 'playing') {
      this.syncRoomMusicPreviewPlayback();
    }
    this.requestRender();
    return committed;
  }

  handleMusicPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.musicComposerMode !== 'sequencer') {
      return;
    }
    this.requirePatternController().handlePointerDown(pointer);
  }

  handleMusicPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.musicComposerMode !== 'sequencer') {
      return;
    }
    this.requirePatternController().handlePointerMove(pointer);
  }

  handleMusicPointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.musicComposerMode !== 'sequencer') {
      return;
    }
    this.requirePatternController().handlePointerUp(pointer);
  }

  updateMusicCursorHighlight(graphics: Phaser.GameObjects.Graphics | null): boolean {
    if (this.musicComposerMode !== 'sequencer' || !graphics) {
      return false;
    }
    return this.requirePatternController().updateCursorHighlight(graphics);
  }

  renderUi(): void {
    const body = document.body;
    body.dataset.editorMusicMode = this.musicModeActive ? 'true' : 'false';
    body.dataset.editorMusicUiLocked = this.musicModeActive ? 'true' : 'false';
    if (this.musicModeActive) {
      this.ensureMusicPhraseLibraryLoaded();
      this.ensureArrangementPhraseCache();
    }

    const modeButton = document.getElementById('btn-editor-music-mode') as HTMLButtonElement | null;
    if (modeButton) {
      const label = modeButton.querySelector<HTMLElement>('[data-button-label], .tool-label');
      if (label) {
        label.textContent = this.musicModeActive ? 'Close' : 'Music';
      } else {
        modeButton.textContent = this.musicModeActive ? 'Close Music' : 'Edit Music';
      }
      modeButton.title = this.musicModeActive ? 'Close Music' : 'Edit Music';
      modeButton.classList.toggle('active', this.musicModeActive);
    }

    const roomMusic = this.host.getRoomMusic();
    const summary = document.getElementById('music-summary');
    if (summary) {
      summary.textContent = this.getSummaryText(roomMusic);
    }

    const overlay = document.getElementById('editor-music-overlay');
    overlay?.classList.toggle('hidden', !this.musicModeActive);
    const workbench = document.getElementById('editor-music-workbench');
    workbench?.classList.toggle('hidden', !this.musicModeActive);
    const legacyLocked = this.requirePatternController().getLegacyStemNoticeVisible();
    const phraseState = this.musicPhraseOrchestrator.getViewState();
    const permissions = this.host.getRoomPermissions();
    const saveInFlight = this.host.getSaveInFlight();
    const scope = this.host.getSummaryScope();
    const entityLabel = scope.kind === 'cell' ? 'cell' : 'room';

    const previewToggleButton = document.getElementById('btn-editor-music-preview-toggle') as HTMLButtonElement | null;
    if (previewToggleButton) {
      const isPlaying = this.musicPreviewState === 'playing';
      previewToggleButton.textContent = isPlaying ? '⏹' : '▶';
      previewToggleButton.title = isPlaying ? 'Stop room music preview' : 'Play room music preview';
      previewToggleButton.ariaLabel = previewToggleButton.title;
      previewToggleButton.disabled = (this.musicPreviewState === 'stopped' && !roomMusic) || saveInFlight;
    }

    const saveButton = document.getElementById('btn-editor-music-save') as HTMLButtonElement | null;
    if (saveButton) {
      const savePhrases = this.musicComposerMode === 'sequencer' && !legacyLocked;
      saveButton.disabled = !permissions.canSaveDraft || saveInFlight || phraseState.saveInFlight;
      saveButton.title = permissions.canSaveDraft
        ? savePhrases
          ? 'Save room draft and phrases (Cmd/Ctrl+S)'
          : 'Save Room Draft (Cmd/Ctrl+S)'
        : `You cannot save drafts for this ${entityLabel}.`;
      saveButton.ariaLabel = saveButton.title;
    }

    const publishButton = document.getElementById('btn-editor-music-publish') as HTMLButtonElement | null;
    if (publishButton) {
      const publishValidationError = this.host.getPublishValidationError();
      publishButton.disabled = !permissions.canPublish || saveInFlight;
      if (publishValidationError) {
        publishButton.setAttribute('aria-disabled', 'true');
      } else {
        publishButton.removeAttribute('aria-disabled');
      }
      publishButton.title = !permissions.canPublish
        ? `You cannot publish this ${entityLabel}.`
        : publishValidationError ?? 'Publish Room (Cmd/Ctrl+Shift+P)';
      publishButton.ariaLabel = publishButton.title;
    }

    const instrumentTabsRoot = document.getElementById('editor-music-instrument-tabs');
    if (instrumentTabsRoot) {
      instrumentTabsRoot.replaceChildren(
        ...ROOM_PATTERN_INSTRUMENT_IDS.map((instrumentId) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'bar-btn bar-btn-small editor-music-tab-button editor-music-icon-button';
          if (instrumentId === this.requirePatternController().getActiveInstrumentTab()) {
            button.classList.add('active');
          }
          button.dataset.roomMusicInstrumentTab = instrumentId;
          button.dataset.roomMusicInstrument = instrumentId;
          button.style.setProperty('--editor-music-instrument-accent', getPatternInstrumentColorCss(instrumentId));
          button.style.setProperty('--editor-music-instrument-rgb', getPatternInstrumentColorRgbCss(instrumentId));
          button.textContent = getPatternInstrumentIcon(instrumentId);
          button.title = getPatternInstrumentLabel(instrumentId);
          button.ariaLabel = getPatternInstrumentLabel(instrumentId);
          return button;
        }),
      );
    }

    const pitchModesRoot = document.getElementById('editor-music-pitch-modes');
    if (pitchModesRoot) {
      const pitchMode = this.getActiveMusicPitchMode();
      pitchModesRoot.replaceChildren(
        ...(['scale', 'chromatic'] as const).map((mode) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'bar-btn bar-btn-small editor-music-chip-button';
          if (mode === pitchMode) {
            button.classList.add('active');
          }
          button.dataset.roomMusicPitchMode = mode;
          button.textContent = mode === 'scale' ? 'Scale Lock' : 'Chromatic';
          button.disabled = legacyLocked;
          return button;
        }),
      );
    }

    const octaveControls = document.getElementById('editor-music-octave-controls');
    const octaveLabel = document.getElementById('editor-music-octave-label');
    const activeOctaveShift = this.getActiveMusicOctaveShift();
    if (octaveControls) {
      octaveControls.classList.toggle('is-inactive', activeOctaveShift === null);
    }
    if (octaveLabel) {
      octaveLabel.textContent =
        activeOctaveShift === null
          ? ''
          : `Octave ${activeOctaveShift >= 0 ? '+' : ''}${activeOctaveShift}`;
    }

    const octaveDownButton = document.getElementById('btn-editor-music-octave-down') as HTMLButtonElement | null;
    const octaveUpButton = document.getElementById('btn-editor-music-octave-up') as HTMLButtonElement | null;
    if (octaveDownButton) {
      octaveDownButton.disabled = activeOctaveShift === null || activeOctaveShift <= -2;
    }
    if (octaveUpButton) {
      octaveUpButton.disabled = activeOctaveShift === null || activeOctaveShift >= 2;
    }

    const tempoLabel = document.getElementById('editor-music-tempo-label');
    if (tempoLabel) {
      tempoLabel.textContent = `Tempo ${this.getActiveMusicTempo()}`;
    }

    const tempoDownButton = document.getElementById('btn-editor-music-tempo-down') as HTMLButtonElement | null;
    const tempoUpButton = document.getElementById('btn-editor-music-tempo-up') as HTMLButtonElement | null;
    const tempoControls = document.getElementById('editor-music-tempo-controls');
    const activeTempo = this.getActiveMusicTempo();
    const hidePhraseTransportControls = this.shouldHidePhraseMetadataTransportControls();
    tempoControls?.classList.toggle('hidden', hidePhraseTransportControls);
    if (tempoDownButton) {
      tempoDownButton.disabled =
        legacyLocked ||
        hidePhraseTransportControls ||
        activeTempo <= ROOM_PATTERN_MIN_BPM;
    }
    if (tempoUpButton) {
      tempoUpButton.disabled =
        legacyLocked ||
        hidePhraseTransportControls ||
        activeTempo >= ROOM_PATTERN_MAX_BPM;
    }

    const swingLabel = document.getElementById('editor-music-swing-label');
    if (swingLabel) {
      swingLabel.textContent = `Swing ${this.getActiveMusicSwing()}%`;
    }

    const swingDownButton = document.getElementById('btn-editor-music-swing-down') as HTMLButtonElement | null;
    const swingUpButton = document.getElementById('btn-editor-music-swing-up') as HTMLButtonElement | null;
    const swingControls = document.getElementById('editor-music-swing-controls');
    const activeSwing = this.getActiveMusicSwing();
    swingControls?.classList.toggle('hidden', hidePhraseTransportControls);
    if (swingDownButton) {
      swingDownButton.disabled =
        legacyLocked ||
        hidePhraseTransportControls ||
        activeSwing <= ROOM_PATTERN_MIN_SWING_PERCENT;
    }
    if (swingUpButton) {
      swingUpButton.disabled =
        legacyLocked ||
        hidePhraseTransportControls ||
        activeSwing >= ROOM_PATTERN_MAX_SWING_PERCENT;
    }

    const phraseActionRow = document.getElementById('editor-music-phrase-action-row');
    const phraseNewButton = document.getElementById('btn-editor-music-phrase-new') as HTMLButtonElement | null;
    const phraseEditButton = document.getElementById('btn-editor-music-phrase-edit') as HTMLButtonElement | null;
    const phraseSaveButton = document.getElementById('btn-editor-music-phrase-save') as HTMLButtonElement | null;
    const phraseSaveAsButton = document.getElementById('btn-editor-music-phrase-save-as') as HTMLButtonElement | null;
    const phraseDeleteButton = document.getElementById('btn-editor-music-phrase-delete') as HTMLButtonElement | null;
    const phraseNameRow = document.getElementById('editor-music-phrase-name-row');
    const phraseNameLabel = document.getElementById('editor-music-phrase-name-label');
    const phraseNameInput = document.getElementById('editor-music-phrase-name-input') as HTMLInputElement | null;
    const activeInstrumentLabel = getPatternInstrumentLabel(this.requirePatternController().getActiveInstrumentTab());
    const showPhraseNameInput = !legacyLocked && this.musicComposerMode === 'sequencer' && phraseState.metadataEditing;
    const canDeletePhrase = !legacyLocked && showPhraseNameInput && this.canDeleteActivePatternPhrase();
    phraseActionRow?.classList.toggle('hidden', legacyLocked);
    phraseNameRow?.classList.toggle('hidden', !showPhraseNameInput);
    if (phraseNameLabel) {
      phraseNameLabel.textContent = `${activeInstrumentLabel} Phrase Name`;
    }
    if (phraseNameInput) {
      phraseNameInput.disabled = !showPhraseNameInput;
      phraseNameInput.placeholder = `Auto: ${activeInstrumentLabel} 1`;
      const nextValue = this.getActiveMusicPhraseNameSuffix();
      const phraseNameFocused = document.activeElement === phraseNameInput;
      if (!phraseNameFocused && phraseNameInput.value !== nextValue) {
        phraseNameInput.value = nextValue;
      }
    }
    if (phraseNewButton) {
      phraseNewButton.disabled =
        legacyLocked ||
        !permissions.canSaveDraft ||
        saveInFlight ||
        phraseState.saveInFlight ||
        phraseState.deleteInFlight;
      phraseNewButton.title = this.musicComposerMode === 'arrangement'
        ? `Save the arrangement draft and open a fresh ${activeInstrumentLabel} sequence.`
        : `Autosave and start a fresh ${activeInstrumentLabel} phrase.`;
      phraseNewButton.ariaLabel = phraseNewButton.title;
    }
    if (phraseEditButton) {
      const disabled = legacyLocked || this.musicComposerMode !== 'sequencer' || phraseState.deleteInFlight;
      phraseEditButton.disabled = disabled;
      phraseEditButton.classList.toggle('active', !disabled && phraseState.metadataEditing);
      phraseEditButton.title = disabled
        ? 'Phrase metadata editing is only available in Sequencer mode.'
        : `${phraseState.metadataEditing ? 'Hide' : 'Edit'} phrase name and delete options.`;
      phraseEditButton.ariaLabel = phraseEditButton.title;
    }
    if (phraseSaveButton) {
      phraseSaveButton.disabled =
        legacyLocked ||
        this.musicComposerMode !== 'sequencer' ||
        !permissions.canSaveDraft ||
        saveInFlight ||
        phraseState.saveInFlight ||
        phraseState.deleteInFlight;
      phraseSaveButton.title = this.musicComposerMode === 'sequencer'
        ? this.getOwnedActivePatternPhrase()
          ? `Detect key and update this ${activeInstrumentLabel} phrase.`
          : `Name and save a new ${activeInstrumentLabel} phrase.`
        : 'Phrase save is only available in Sequencer mode.';
      phraseSaveButton.ariaLabel = phraseSaveButton.title;
    }
    if (phraseSaveAsButton) {
      phraseSaveAsButton.disabled =
        legacyLocked ||
        this.musicComposerMode !== 'sequencer' ||
        !permissions.canSaveDraft ||
        saveInFlight ||
        phraseState.saveInFlight ||
        phraseState.deleteInFlight ||
        !this.hasSavableActiveRoomMusicPhrase();
      phraseSaveAsButton.title = this.musicComposerMode === 'sequencer'
        ? `Save a new named version of this ${activeInstrumentLabel} phrase.`
        : 'Phrase save-as is only available in Sequencer mode.';
      phraseSaveAsButton.ariaLabel = phraseSaveAsButton.title;
    }
    if (phraseDeleteButton) {
      phraseDeleteButton.classList.toggle('hidden', !showPhraseNameInput);
      phraseDeleteButton.disabled = !canDeletePhrase || phraseState.deleteInFlight;
      phraseDeleteButton.title = canDeletePhrase
        ? `Delete your saved ${activeInstrumentLabel} phrase.`
        : 'Only your own saved phrases can be deleted.';
      phraseDeleteButton.ariaLabel = phraseDeleteButton.title;
      phraseDeleteButton.textContent = phraseState.deleteInFlight ? 'Deleting...' : 'Delete';
    }

    const phraseSaveModal = document.getElementById('editor-music-phrase-save-modal');
    const phraseSaveModalTitle = document.getElementById('editor-music-phrase-save-title');
    const phraseSaveModalMeta = document.getElementById('editor-music-phrase-save-meta');
    const phraseSaveModalError = document.getElementById('editor-music-phrase-save-error');
    const phraseSaveModalInput = document.getElementById('editor-music-phrase-save-name-input') as HTMLInputElement | null;
    const phraseSaveModalConfirm = document.getElementById('btn-editor-music-phrase-save-confirm') as HTMLButtonElement | null;
    const showPhraseSaveModal = phraseState.savePromptMode !== null;
    phraseSaveModal?.classList.toggle('hidden', !showPhraseSaveModal);
    phraseSaveModal?.setAttribute('aria-hidden', showPhraseSaveModal ? 'false' : 'true');
    if (phraseSaveModalTitle) {
      phraseSaveModalTitle.textContent = phraseState.savePromptMode === 'save-as' ? 'Save Phrase As' : 'Name Phrase';
    }
    if (phraseSaveModalMeta) {
      phraseSaveModalMeta.textContent = phraseState.savePromptMode === 'save-as'
        ? `Create a new named version of this ${activeInstrumentLabel} phrase.`
        : `Name this ${activeInstrumentLabel} phrase before saving it to your library.`;
    }
    if (phraseSaveModalError) {
      phraseSaveModalError.textContent = phraseState.savePromptError ?? '';
      phraseSaveModalError.classList.toggle('hidden', !phraseState.savePromptError);
    }
    if (phraseSaveModalInput) {
      phraseSaveModalInput.value = phraseState.savePromptName;
      phraseSaveModalInput.disabled = !showPhraseSaveModal || phraseState.saveInFlight;
      phraseSaveModalInput.placeholder = `${activeInstrumentLabel} Phrase`;
    }
    if (phraseSaveModalConfirm) {
      phraseSaveModalConfirm.disabled =
        !showPhraseSaveModal ||
        phraseState.saveInFlight ||
        phraseState.savePromptName.trim().length === 0;
      phraseSaveModalConfirm.textContent = phraseState.saveInFlight
        ? 'Saving...'
        : phraseState.savePromptMode === 'save-as'
          ? 'Save As'
          : 'Save Phrase';
    }

    const legacyNotice = document.getElementById('editor-music-legacy-notice');
    legacyNotice?.classList.toggle('hidden', !legacyLocked);
    this.renderMusicWorkbenchModeButtons(legacyLocked);
    this.renderMusicArrangementPanel(legacyLocked);
    this.renderMusicLibraryPanel(legacyLocked);
  }

  private getDisplayPatternMusic() {
    const roomMusic = this.host.getRoomMusic();
    return isPatternRoomMusic(roomMusic)
      ? roomMusic
      : createDefaultRoomPatternMusic();
  }

  private getEditablePatternMusic() {
    const roomMusic = this.host.getRoomMusic();
    if (isStemArrangementRoomMusic(roomMusic)) {
      return null;
    }

    return isPatternRoomMusic(roomMusic)
      ? cloneRoomPatternMusic(roomMusic)
      : createDefaultRoomPatternMusic();
  }

  private getDisplayPhraseArrangement(): RoomPhraseArrangementMusic {
    const roomMusic = this.host.getRoomMusic();
    return isPhraseArrangementRoomMusic(roomMusic)
      ? roomMusic
      : createDefaultRoomPhraseArrangementMusic(this.preferredPhraseArrangementSlotCount);
  }

  private getEditablePhraseArrangement(): RoomPhraseArrangementMusic | null {
    const roomMusic = this.host.getRoomMusic();
    if (isStemArrangementRoomMusic(roomMusic)) {
      return null;
    }

    return isPhraseArrangementRoomMusic(roomMusic)
      ? cloneRoomPhraseArrangementMusic(roomMusic)
      : createDefaultRoomPhraseArrangementMusic(this.preferredPhraseArrangementSlotCount);
  }

  private getActiveMusicPitchMode(): RoomPatternPitchMode {
    return this.musicComposerMode === 'arrangement'
      ? this.getDisplayPhraseArrangement().pitchMode
      : this.requirePatternController().getPitchMode();
  }

  private getActiveMusicTempo(): number {
    return this.musicComposerMode === 'arrangement'
      ? this.getDisplayPhraseArrangement().bpm
      : this.getDisplayPatternMusic().bpm;
  }

  private getActiveMusicSwing(): number {
    return this.musicComposerMode === 'arrangement'
      ? this.getDisplayPhraseArrangement().swingPercent
      : this.getDisplayPatternMusic().swingPercent;
  }

  private getActiveMusicPhraseNameSuffix(): string {
    return this.getDisplayPatternMusic().phraseNameSuffixes[this.requirePatternController().getActiveInstrumentTab()] ?? '';
  }

  private shouldHidePhraseMetadataTransportControls(): boolean {
    return this.musicComposerMode === 'sequencer' && this.musicPhraseOrchestrator.isMetadataEditing();
  }

  private getActivePatternSourcePhraseId(): string | null {
    if (this.musicComposerMode !== 'sequencer') {
      return null;
    }

    const pattern = this.getDisplayPatternMusic();
    const sourceIds = pattern.sourcePhraseIds[this.requirePatternController().getActiveInstrumentTab()] ?? [];
    const phraseId = sourceIds[0]?.trim();
    return phraseId ? phraseId : null;
  }

  private getActivePatternPhraseRecord(): MusicPhraseRecord | null {
    const phraseId = this.getActivePatternSourcePhraseId();
    if (!phraseId) {
      return null;
    }

    return this.musicPhraseOrchestrator.getCachedPhrase(phraseId);
  }

  private syncActivePatternPhraseRecord(phrase: MusicPhraseRecord): void {
    if (this.musicComposerMode !== 'sequencer') {
      return;
    }

    const instrumentId = this.requirePatternController().getActiveInstrumentTab();
    if (phrase.instrumentId !== instrumentId) {
      return;
    }

    const pattern = this.getEditablePatternMusic();
    if (!pattern) {
      return;
    }

    const nextNameSuffix = this.getMusicPhraseSampleName(phrase);
    const nextSourcePhraseIds = [phrase.id, ...phrase.sourcePhraseIds].filter(
      (value, index, sourceIds) => value.trim() && sourceIds.indexOf(value) === index,
    );
    const currentSourcePhraseIds = pattern.sourcePhraseIds[instrumentId] ?? [];
    const sourceIdsChanged =
      currentSourcePhraseIds.length !== nextSourcePhraseIds.length
      || currentSourcePhraseIds.some((value, index) => value !== nextSourcePhraseIds[index]);
    const nextStoredName = nextNameSuffix.trim() || null;
    const currentStoredName = pattern.phraseNameSuffixes[instrumentId] ?? null;

    if (!sourceIdsChanged && currentStoredName === nextStoredName) {
      return;
    }

    pattern.sourcePhraseIds[instrumentId] = nextSourcePhraseIds;
    pattern.phraseNameSuffixes[instrumentId] = nextStoredName;
    this.commitRoomMusic(pattern);
  }

  private canDeleteActivePatternPhrase(): boolean {
    return this.getOwnedActivePatternPhrase() !== null;
  }

  private getActiveMusicOctaveShift(): number | null {
    if (this.musicComposerMode === 'arrangement') {
      const instrumentId = this.requirePatternController().getActiveInstrumentTab();
      if (instrumentId === 'drums') {
        return null;
      }

      return this.getDisplayPhraseArrangement().octaveShift[instrumentId];
    }

    return this.requirePatternController().getActiveOctaveShift();
  }

  private ensureArrangementSelection(instrumentId: RoomPatternInstrumentId): void {
    this.musicPhraseOrchestrator.ensureArrangementSelection(
      instrumentId,
      this.getDisplayPhraseArrangement().slotCount,
    );
  }

  private getArrangementSelection(): EditorMusicArrangementSelection {
    const instrumentId = this.requirePatternController().getActiveInstrumentTab();
    return this.musicPhraseOrchestrator.getArrangementSelection(
      instrumentId,
      this.getDisplayPhraseArrangement().slotCount,
    );
  }

  private async loadMusicPhraseLibrary(reset: boolean): Promise<void> {
    await this.musicPhraseOrchestrator.loadLibrary(
      this.requirePatternController().getActiveInstrumentTab(),
      reset,
      () => this.requestRender(),
    );
  }

  private ensureMusicPhraseLibraryLoaded(force = false): void {
    this.musicPhraseOrchestrator.ensureLibraryLoaded(
      this.requirePatternController().getActiveInstrumentTab(),
      force,
      () => this.requestRender(),
    );
  }

  private ensureArrangementPhraseCache(): void {
    this.musicPhraseOrchestrator.ensureArrangementPhraseCache(this.host.getRoomMusic(), () => this.requestRender());
  }

  private ensureActivePatternPhraseCache(): void {
    const phraseId = this.getActivePatternSourcePhraseId();
    this.musicPhraseOrchestrator.ensurePhraseCached(phraseId, () => this.requestRender());
  }

  private getArrangementSlotLabel(phraseId: string | null): string {
    return this.musicPhraseOrchestrator.getArrangementSlotLabel(phraseId);
  }

  private getMusicPhraseSampleName(phrase: MusicPhraseRecord): string {
    return this.musicPhraseOrchestrator.getMusicPhraseSampleName(phrase);
  }

  private getMusicPhraseRoomLabel(phrase: MusicPhraseRecord): string {
    return this.musicPhraseOrchestrator.getMusicPhraseRoomLabel(phrase);
  }

  private getMusicPhraseKeyLabel(phrase: MusicPhraseRecord): string {
    return this.musicPhraseOrchestrator.getMusicPhraseKeyLabel(phrase);
  }

  private hasSavableActiveRoomMusicPhrase(): boolean {
    if (this.musicComposerMode !== 'sequencer') {
      return false;
    }

    const pattern = this.getDisplayPatternMusic();
    return (
      extractMusicPhrasePayloadFromPattern(
        pattern,
        this.requirePatternController().getActiveInstrumentTab(),
      ) !== null
    );
  }

  private inferAndApplyActiveRoomMusicPhraseKey(): { tonic: RoomMusicKeyTonic; mode: RoomMusicKeyMode } | null {
    if (this.musicComposerMode !== 'sequencer') {
      return null;
    }

    const instrumentId = this.requirePatternController().getActiveInstrumentTab();
    if (instrumentId === 'drums') {
      return null;
    }

    const pattern = this.getEditablePatternMusic();
    if (!pattern) {
      return null;
    }

    const detectedKey = detectRoomPatternTrackKey(pattern, instrumentId as RoomPatternTonalInstrumentId);
    if (!detectedKey) {
      return null;
    }

    if (pattern.keyTonic === detectedKey.tonic && pattern.keyMode === detectedKey.mode) {
      return detectedKey;
    }

    this.commitRoomMusic(
      rekeyRoomPatternMusicPreservingMidi(
        pattern,
        detectedKey.tonic,
        detectedKey.mode,
      ),
    );
    return detectedKey;
  }

  private getOwnedActivePatternPhrase(): MusicPhraseRecord | null {
    const phrase = this.getActivePatternPhraseRecord();
    const currentUserId = this.host.getCurrentUserId();
    return phrase && currentUserId && phrase.creatorUserId === currentUserId ? phrase : null;
  }

  private getSuggestedActiveMusicPhraseName(): string {
    const currentName = this.getActiveMusicPhraseNameSuffix().trim();
    if (currentName) {
      return currentName;
    }

    const phrase = this.getActivePatternPhraseRecord();
    return phrase ? this.getMusicPhraseSampleName(phrase) : '';
  }

  private openRoomMusicPhraseSavePrompt(mode: EditorMusicPhraseSavePromptMode): void {
    if (this.musicComposerMode !== 'sequencer') {
      return;
    }

    this.musicPhraseOrchestrator.openSavePrompt(mode, this.getSuggestedActiveMusicPhraseName());
    this.requestRender();
    window.requestAnimationFrame(() => {
      const input = document.getElementById('editor-music-phrase-save-name-input') as HTMLInputElement | null;
      input?.focus();
      input?.select();
    });
  }

  private async persistActiveRoomMusicPhrase(
    options?: {
      saveMode?: 'overwrite' | 'save-as';
      promptedNameSuffix?: string | null;
    },
  ): Promise<RoomRecord | null> {
    if (this.musicComposerMode !== 'sequencer') {
      return this.host.saveDraft(true, { promptForSignInOnUnauthorized: true });
    }

    const detectedKey = this.inferAndApplyActiveRoomMusicPhraseKey();
    if (detectedKey) {
      this.host.updatePersistenceStatus(`Detected ${detectedKey.tonic} ${detectedKey.mode === 'minor' ? 'Minor' : 'Major'} before save.`);
    }

    const overwritePhrase = options?.saveMode === 'overwrite' ? this.getOwnedActivePatternPhrase() : null;
    const nextName = (options?.promptedNameSuffix ?? this.getSuggestedActiveMusicPhraseName()).trim();
    this.setRoomMusicPhraseNameSuffix(nextName);

    return this.saveRoomMusicDraftAndPhrases({
      instrumentId: this.requirePatternController().getActiveInstrumentTab(),
      saveMode: overwritePhrase ? 'overwrite' : options?.saveMode ?? null,
      overwritePhraseId: overwritePhrase?.id ?? null,
    });
  }

  private async assignPhraseToArrangementSlot(phrase: MusicPhraseRecord): Promise<void> {
    const selection = this.getArrangementSelection();
    if (phrase.instrumentId !== selection.instrumentId) {
      this.musicPhraseOrchestrator.setLibraryError(`Selected slot expects ${getPatternInstrumentLabel(selection.instrumentId)} phrases.`);
      return;
    }

    const arrangement = this.getEditablePhraseArrangement();
    if (!arrangement) {
      return;
    }

    const arrangementHasAnyPhrase = ROOM_PATTERN_INSTRUMENT_IDS.some((instrumentId) =>
      arrangement.slots[instrumentId].some((phraseId) => phraseId !== null),
    );
    if (!arrangementHasAnyPhrase) {
      arrangement.bpm = normalizeRoomPatternBpm(phrase.payload.bpm);
      arrangement.swingPercent = normalizeRoomPatternSwingPercent(phrase.payload.swingPercent);
      if (phrase.payload.kind === 'tonal') {
        arrangement.keyTonic = phrase.sourceKeyTonic ?? phrase.payload.keyTonic;
        arrangement.keyMode = phrase.sourceKeyMode ?? phrase.payload.keyMode;
      }
    }

    arrangement.slots[selection.instrumentId][selection.slotIndex] = phrase.id;
    this.musicPhraseOrchestrator.setArrangementSelection({
      instrumentId: selection.instrumentId,
      slotIndex: Math.min(arrangement.slotCount - 1, selection.slotIndex + 1),
    });
    this.commitRoomMusic(arrangement);
  }

  private playRoomMusicPreview(): void {
    this.musicPreviewState = 'playing';
    this.syncRoomMusicPreviewPlayback();
    this.renderUi();
  }

  private stopPreviewPlayback(mode: 'idle' | 'editor-preview'): void {
    globalRoomMusicController.stopArrangement({
      transition: 'immediate',
      fadeDurationSec: 0.08,
      mode,
      resetTransport: true,
    });
  }

  private renderMusicWorkbenchModeButtons(legacyLocked: boolean): void {
    renderMusicWorkbenchModeButtons({
      activeMode: this.musicComposerMode,
      legacyLocked,
    });
  }

  private renderMusicArrangementPanel(legacyLocked: boolean): void {
    renderMusicArrangementPanel({
      legacyLocked,
      composerMode: this.musicComposerMode,
      getArrangement: () => this.getDisplayPhraseArrangement(),
      getSelection: () => this.getArrangementSelection(),
      getArrangementSlotLabel: (phraseId) => this.getArrangementSlotLabel(phraseId),
    });
  }

  private renderMusicLibraryPanel(legacyLocked: boolean): void {
    const phraseState = this.musicPhraseOrchestrator.getViewState();
    renderMusicLibraryPanel({
      legacyLocked,
      composerMode: this.musicComposerMode,
      activeInstrumentId: this.requirePatternController().getActiveInstrumentTab(),
      items: phraseState.libraryItems,
      nextCursor: phraseState.libraryNextCursor,
      loading: phraseState.libraryLoading,
      loadingMore: phraseState.libraryLoadingMore,
      error: phraseState.libraryError,
      getMusicPhraseSampleName: (phrase) => this.getMusicPhraseSampleName(phrase),
      getMusicPhraseKeyLabel: (phrase) => this.getMusicPhraseKeyLabel(phrase),
      getMusicPhraseRoomLabel: (phrase) => this.getMusicPhraseRoomLabel(phrase),
    });
  }

  private getSummaryText(roomMusic: RoomMusic | null): string {
    const scope = this.host.getSummaryScope();
    if (scope.kind === 'cell') {
      const selectedLabel = scope.label;
      if (isStemArrangementRoomMusic(roomMusic)) {
        return `Cell ${selectedLabel} has saved WAMP stem music. Replace it to edit on the sequencer grid.`;
      }
      if (isPhraseArrangementRoomMusic(roomMusic)) {
        const filledSlotCount = ROOM_PATTERN_INSTRUMENT_IDS.reduce(
          (count, instrumentId) =>
            count + roomMusic.slots[instrumentId].filter((phraseId: string | null) => phraseId !== null).length,
          0,
        );
        const activeSegmentCount = getRoomPhraseArrangementActiveSlotCount(roomMusic);
        return `Cell ${selectedLabel}: ${filledSlotCount} phrase slots across ${activeSegmentCount} active segments.`;
      }
      if (isPatternRoomMusic(roomMusic)) {
        return `Cell ${selectedLabel}: ${this.requirePatternController().getActiveCellCount()} notes and hits on ${getPatternInstrumentLabel(this.requirePatternController().getActiveInstrumentTab())}.`;
      }
      return this.musicComposerMode === 'arrangement'
        ? `Cell ${selectedLabel}: no phrase arrangement yet.`
        : `Cell ${selectedLabel}: click on the grid to start a sequencer loop.`;
    }

    if (isStemArrangementRoomMusic(roomMusic)) {
      return 'Legacy WAMP stem music is saved in this room. Replace it to edit on the room grid.';
    }
    if (isPhraseArrangementRoomMusic(roomMusic)) {
      const filledSlotCount = ROOM_PATTERN_INSTRUMENT_IDS.reduce(
        (count, instrumentId) =>
          count + roomMusic.slots[instrumentId].filter((phraseId: string | null) => phraseId !== null).length,
        0,
      );
      const activeSegmentCount = getRoomPhraseArrangementActiveSlotCount(roomMusic);
      return `${filledSlotCount} phrase slots arranged across ${activeSegmentCount} active segments.`;
    }
    if (isPatternRoomMusic(roomMusic)) {
      return `${this.requirePatternController().getActiveCellCount()} notes and hits on ${getPatternInstrumentLabel(this.requirePatternController().getActiveInstrumentTab())}.`;
    }
    return this.musicComposerMode === 'arrangement'
      ? 'No phrase arrangement yet. Pick a slot, then click a phrase from the library.'
      : 'No room music yet. Click on the room grid to start a sequencer loop.';
  }

  private requestRender(): void {
    this.host.requestRender();
  }

  private requirePatternController(): EditorMusicPatternController {
    if (!this.patternController) {
      throw new Error('Editor music workflow used before pattern controller was attached.');
    }
    return this.patternController;
  }
}
