import {
  getMusicPhraseSampleName as getMusicPhraseDisplayName,
  type MusicPhraseRecord,
  type MusicPhraseSaveResponse,
} from '../../music/library';
import {
  deleteMusicPhrase,
  getMusicPhrase,
  listMusicPhrases,
  saveMusicPhrases,
} from '../../music/libraryClient';
import {
  ROOM_PATTERN_INSTRUMENT_IDS,
  type RoomMusic,
  type RoomPatternInstrumentId,
} from '../../music/model';
import { isPhraseArrangementRoomMusic } from '../../music/model';
import type { RoomSnapshot } from '../../persistence/roomModel';
import type { EditorMusicArrangementSelection } from './musicUi';

export type EditorMusicPhraseSavePromptMode = 'save' | 'save-as';

export interface EditorMusicPhraseViewState {
  readonly libraryInstrument: RoomPatternInstrumentId;
  readonly libraryItems: readonly MusicPhraseRecord[];
  readonly libraryNextCursor: string | null;
  readonly libraryLoading: boolean;
  readonly libraryLoadingMore: boolean;
  readonly libraryLoaded: boolean;
  readonly libraryError: string | null;
  readonly saveInFlight: boolean;
  readonly deleteInFlight: boolean;
  readonly savePromptMode: EditorMusicPhraseSavePromptMode | null;
  readonly savePromptName: string;
  readonly savePromptError: string | null;
  readonly metadataEditing: boolean;
}

export class EditorMusicPhraseOrchestrator {
  private metadataEditing = false;
  private libraryInstrument: RoomPatternInstrumentId = 'drums';
  private libraryItems: MusicPhraseRecord[] = [];
  private libraryNextCursor: string | null = null;
  private libraryLoading = false;
  private libraryLoadingMore = false;
  private libraryLoaded = false;
  private libraryError: string | null = null;
  private libraryRequestId = 0;
  private saveInFlight = false;
  private deleteInFlight = false;
  private savePromptMode: EditorMusicPhraseSavePromptMode | null = null;
  private savePromptName = '';
  private savePromptError: string | null = null;
  private arrangementSelection: EditorMusicArrangementSelection | null = null;
  private readonly recordCache = new Map<string, MusicPhraseRecord>();
  private readonly detailLoading = new Set<string>();

  getViewState(): EditorMusicPhraseViewState {
    return {
      libraryInstrument: this.libraryInstrument,
      libraryItems: this.libraryItems,
      libraryNextCursor: this.libraryNextCursor,
      libraryLoading: this.libraryLoading,
      libraryLoadingMore: this.libraryLoadingMore,
      libraryLoaded: this.libraryLoaded,
      libraryError: this.libraryError,
      saveInFlight: this.saveInFlight,
      deleteInFlight: this.deleteInFlight,
      savePromptMode: this.savePromptMode,
      savePromptName: this.savePromptName,
      savePromptError: this.savePromptError,
      metadataEditing: this.metadataEditing,
    };
  }

  isMetadataEditing(): boolean {
    return this.metadataEditing;
  }

  setMetadataEditing(value: boolean): void {
    this.metadataEditing = value;
  }

  toggleMetadataEditing(): boolean {
    this.metadataEditing = !this.metadataEditing;
    return this.metadataEditing;
  }

  getSaveInFlight(): boolean {
    return this.saveInFlight;
  }

  setSaveInFlight(value: boolean): void {
    this.saveInFlight = value;
  }

  getDeleteInFlight(): boolean {
    return this.deleteInFlight;
  }

  setDeleteInFlight(value: boolean): void {
    this.deleteInFlight = value;
  }

  getSavePromptMode(): EditorMusicPhraseSavePromptMode | null {
    return this.savePromptMode;
  }

  getSavePromptName(): string {
    return this.savePromptName;
  }

  openSavePrompt(mode: EditorMusicPhraseSavePromptMode, suggestedName: string): void {
    this.savePromptMode = mode;
    this.savePromptName = suggestedName.trim().slice(0, 24);
    this.savePromptError = null;
  }

  closeSavePrompt(): boolean {
    if (!this.savePromptMode) {
      return false;
    }

    this.resetSavePrompt();
    return true;
  }

  resetSavePrompt(): void {
    this.savePromptMode = null;
    this.savePromptName = '';
    this.savePromptError = null;
  }

  setSavePromptName(value: string): void {
    this.savePromptName = value.slice(0, 24);
    if (this.savePromptError) {
      this.savePromptError = null;
    }
  }

  setSavePromptError(message: string | null): void {
    this.savePromptError = message;
  }

  setLibraryError(message: string | null): void {
    this.libraryError = message;
  }

  resetLibraryAfterPublish(): void {
    this.libraryLoaded = false;
    this.libraryError = null;
    this.libraryNextCursor = null;
  }

  canLoadMoreLibrary(): boolean {
    return !this.libraryLoading && !this.libraryLoadingMore && this.libraryNextCursor !== null;
  }

  getCachedPhrase(phraseId: string | null): MusicPhraseRecord | null {
    return phraseId ? this.recordCache.get(phraseId) ?? null : null;
  }

  rememberPhrases(phrases: readonly MusicPhraseRecord[]): void {
    for (const phrase of phrases) {
      this.recordCache.set(phrase.id, phrase);
    }
  }

  async savePhrases(
    snapshot: RoomSnapshot,
    activeInstrumentId: RoomPatternInstrumentId,
    options?: {
      instrumentId?: RoomPatternInstrumentId | null;
      saveMode?: 'overwrite' | 'save-as' | null;
      overwritePhraseId?: string | null;
    },
  ): Promise<MusicPhraseSaveResponse> {
    const response = await saveMusicPhrases(snapshot, options);
    this.rememberPhrases(response.items);
    this.applySavedPhrasesToLibrary(response.items, activeInstrumentId);
    return response;
  }

  async deletePhrase(phraseId: string): Promise<void> {
    await deleteMusicPhrase(phraseId);
    this.recordCache.delete(phraseId);
    this.libraryItems = this.libraryItems.filter((item) => item.id !== phraseId);
    this.libraryError = null;
  }

  async loadPhrase(phraseId: string): Promise<MusicPhraseRecord> {
    const phrase = await getMusicPhrase(phraseId);
    this.rememberPhrases([phrase]);
    return phrase;
  }

  applySavedPhrasesToLibrary(
    phrases: readonly MusicPhraseRecord[],
    activeInstrumentId: RoomPatternInstrumentId,
  ): void {
    if (phrases.length === 0) {
      return;
    }

    const relevantPhrases = phrases.filter((phrase) => phrase.instrumentId === activeInstrumentId);
    if (relevantPhrases.length === 0) {
      return;
    }

    const nextItems = [...this.libraryItems];
    for (const phrase of relevantPhrases) {
      const existingIndex = nextItems.findIndex((item) => item.id === phrase.id);
      if (existingIndex >= 0) {
        nextItems[existingIndex] = phrase;
      } else {
        nextItems.unshift(phrase);
      }
    }

    nextItems.sort((left, right) => {
      const createdAtDiff = Date.parse(right.createdAt) - Date.parse(left.createdAt);
      if (createdAtDiff !== 0) {
        return createdAtDiff;
      }
      return right.id.localeCompare(left.id);
    });

    this.libraryInstrument = activeInstrumentId;
    this.libraryLoaded = true;
    this.libraryError = null;
    this.libraryItems = nextItems;
  }

  ensureArrangementSelection(instrumentId: RoomPatternInstrumentId): void {
    if (!this.arrangementSelection || this.arrangementSelection.instrumentId !== instrumentId) {
      this.arrangementSelection = {
        instrumentId,
        slotIndex: 0,
      };
    }
  }

  getArrangementSelection(activeInstrumentId: RoomPatternInstrumentId): EditorMusicArrangementSelection {
    this.ensureArrangementSelection(activeInstrumentId);
    return this.arrangementSelection as EditorMusicArrangementSelection;
  }

  setArrangementSelection(selection: EditorMusicArrangementSelection): void {
    this.arrangementSelection = { ...selection };
  }

  async loadLibrary(
    instrumentId: RoomPatternInstrumentId,
    reset: boolean,
    render: () => void,
  ): Promise<void> {
    const requestId = this.libraryRequestId + 1;
    this.libraryRequestId = requestId;
    this.libraryInstrument = instrumentId;
    if (reset) {
      this.libraryLoading = true;
      this.libraryLoadingMore = false;
      this.libraryLoaded = false;
      this.libraryItems = [];
      this.libraryNextCursor = null;
      this.libraryError = null;
    } else {
      if (!this.libraryNextCursor) {
        return;
      }
      this.libraryLoadingMore = true;
      this.libraryError = null;
    }
    render();

    try {
      const response = await listMusicPhrases({
        instrumentId,
        cursor: reset ? null : this.libraryNextCursor,
        limit: 24,
      });
      if (requestId !== this.libraryRequestId) {
        return;
      }

      this.rememberPhrases(response.items);
      this.libraryLoaded = true;
      this.libraryItems = reset
        ? [...response.items]
        : [...this.libraryItems, ...response.items];
      this.libraryNextCursor = response.nextCursor;
      this.libraryError = null;
    } catch (error) {
      if (requestId !== this.libraryRequestId) {
        return;
      }
      this.libraryError =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : 'Failed to load music phrases.';
    } finally {
      if (requestId === this.libraryRequestId) {
        this.libraryLoading = false;
        this.libraryLoadingMore = false;
        render();
      }
    }
  }

  ensureLibraryLoaded(
    instrumentId: RoomPatternInstrumentId,
    force: boolean,
    render: () => void,
  ): void {
    const instrumentChanged = this.libraryInstrument !== instrumentId;
    if (force || instrumentChanged) {
      void this.loadLibrary(instrumentId, true, render);
      return;
    }

    if (
      !this.libraryLoading &&
      !this.libraryLoadingMore &&
      !this.libraryLoaded &&
      !this.libraryError
    ) {
      void this.loadLibrary(instrumentId, true, render);
    }
  }

  ensureArrangementPhraseCache(roomMusic: RoomMusic | null, render: () => void): void {
    if (!isPhraseArrangementRoomMusic(roomMusic)) {
      return;
    }

    for (const instrumentId of ROOM_PATTERN_INSTRUMENT_IDS) {
      for (const phraseId of roomMusic.slots[instrumentId]) {
        this.ensurePhraseCached(phraseId, render);
      }
    }
  }

  ensurePhraseCached(phraseId: string | null, render: () => void): void {
    const trimmedPhraseId = phraseId?.trim() ?? '';
    if (!trimmedPhraseId || this.recordCache.has(trimmedPhraseId) || this.detailLoading.has(trimmedPhraseId)) {
      return;
    }

    this.detailLoading.add(trimmedPhraseId);
    void getMusicPhrase(trimmedPhraseId)
      .then((phrase) => {
        this.recordCache.set(phrase.id, phrase);
        render();
      })
      .catch(() => {
        void 0;
      })
      .finally(() => {
        this.detailLoading.delete(trimmedPhraseId);
      });
  }

  getArrangementSlotLabel(phraseId: string | null): string {
    if (!phraseId) {
      return 'Empty';
    }

    const phrase = this.recordCache.get(phraseId) ?? null;
    if (!phrase) {
      return `Phrase ${phraseId.slice(0, 6)}`;
    }

    return this.getMusicPhraseSampleName(phrase);
  }

  getMusicPhraseSampleName(phrase: MusicPhraseRecord): string {
    return getMusicPhraseDisplayName(phrase);
  }

  getMusicPhraseRoomLabel(phrase: MusicPhraseRecord): string {
    return phrase.roomTitle?.trim() ? phrase.roomTitle.trim() : `${phrase.roomX},${phrase.roomY}`;
  }

  getMusicPhraseKeyLabel(phrase: MusicPhraseRecord): string {
    if (phrase.payload.kind === 'drums') {
      return 'No Key';
    }

    return `${phrase.payload.keyTonic} ${phrase.payload.keyMode === 'minor' ? 'Minor' : 'Major'}`;
  }
}
