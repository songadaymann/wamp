import type { MusicPhraseRecord } from '../../music/library';
import {
  ROOM_PATTERN_INSTRUMENT_IDS,
  ROOM_PHRASE_ARRANGEMENT_SLOT_OPTIONS,
  getPatternInstrumentColorCss,
  getPatternInstrumentColorRgbCss,
  getPatternInstrumentIcon,
  getPatternInstrumentLabel,
  type RoomPatternInstrumentId,
  type RoomPhraseArrangementMusic,
} from '../../music/model';

export type EditorMusicComposerMode = 'sequencer' | 'arrangement';

export interface EditorMusicArrangementSelection {
  instrumentId: RoomPatternInstrumentId;
  slotIndex: number;
}

export function renderMusicWorkbenchModeButtons(options: {
  activeMode: EditorMusicComposerMode;
  legacyLocked: boolean;
}): void {
  const modeRoot = document.getElementById('editor-music-composer-modes');
  if (!modeRoot) {
    return;
  }

  modeRoot.replaceChildren(
    ...([
      { mode: 'sequencer', label: 'Sequencer' },
      { mode: 'arrangement', label: 'Arrange' },
    ] as const).map(({ mode, label }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bar-btn bar-btn-small editor-music-chip-button';
      if (mode === options.activeMode) {
        button.classList.add('active');
      }
      button.dataset.roomMusicComposerMode = mode;
      button.textContent = label;
      button.disabled = options.legacyLocked;
      return button;
    }),
  );
}

export function renderMusicArrangementPanel(options: {
  legacyLocked: boolean;
  composerMode: EditorMusicComposerMode;
  getArrangement: () => RoomPhraseArrangementMusic;
  getSelection: () => EditorMusicArrangementSelection;
  getArrangementSlotLabel: (phraseId: string | null) => string;
}): void {
  const panel = document.getElementById('editor-music-arrangement-panel');
  const grid = document.getElementById('editor-music-arrangement-grid');
  const status = document.getElementById('editor-music-arrangement-status');
  const slotCountRoot = document.getElementById('editor-music-arrangement-slot-count');
  const clearButton = document.getElementById('btn-editor-music-arrangement-clear-slot') as HTMLButtonElement | null;
  const clearAllButton = document.getElementById('btn-editor-music-arrangement-clear-all') as HTMLButtonElement | null;
  if (!panel || !grid || !status) {
    return;
  }

  const showPanel = options.composerMode === 'arrangement';
  panel.classList.toggle('hidden', !showPanel);
  if (!showPanel) {
    return;
  }

  const arrangement = options.getArrangement();
  const selection = options.getSelection();
  const slotCount = arrangement.slotCount;
  const selectedSlotIndex = Math.min(selection.slotIndex, Math.max(0, slotCount - 1));
  const selectedPhraseId = arrangement.slots[selection.instrumentId][selectedSlotIndex] ?? null;
  const filledSlotCount = ROOM_PATTERN_INSTRUMENT_IDS.reduce(
    (count, instrumentId) =>
      count + arrangement.slots[instrumentId].filter((phraseId) => phraseId !== null).length,
    0,
  );
  status.textContent = selectedPhraseId
    ? `Selected ${getPatternInstrumentLabel(selection.instrumentId)} ${selectedSlotIndex + 1}. Drag in a phrase, click a library phrase, or clear this slot.`
    : `Selected ${getPatternInstrumentLabel(selection.instrumentId)} ${selectedSlotIndex + 1}. Drag in a phrase or click one in the library to patch it here.`;

  slotCountRoot?.replaceChildren(
    ...ROOM_PHRASE_ARRANGEMENT_SLOT_OPTIONS.map((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bar-btn bar-btn-small editor-music-arrangement-slot-count-button';
      if (option === slotCount) {
        button.classList.add('active');
      }
      button.dataset.roomMusicArrangementSlotCount = String(option);
      button.dataset.roomMusicTooltip = `${option} arrangement slots`;
      button.disabled = options.legacyLocked;
      button.ariaLabel = `Set phrase arrangement to ${option} slots`;
      button.textContent = String(option);
      return button;
    }),
  );

  grid.replaceChildren(
    ...ROOM_PATTERN_INSTRUMENT_IDS.map((instrumentId) => {
      const row = document.createElement('div');
      row.className = 'editor-music-arrangement-row';
      row.dataset.roomMusicArrangementInstrument = instrumentId;
      row.style.setProperty('--editor-music-instrument-accent', getPatternInstrumentColorCss(instrumentId));
      row.style.setProperty('--editor-music-instrument-rgb', getPatternInstrumentColorRgbCss(instrumentId));

      const label = document.createElement('div');
      label.className = 'editor-music-arrangement-label';
      label.textContent = `${getPatternInstrumentIcon(instrumentId)} ${getPatternInstrumentLabel(instrumentId)}`;
      row.append(label);

      const cells = document.createElement('div');
      cells.className = 'editor-music-arrangement-cells';
      cells.dataset.roomMusicArrangementSlotCount = String(slotCount);
      cells.style.setProperty('--editor-music-arrangement-slot-count', String(slotCount));
      for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
        const phraseId = arrangement.slots[instrumentId][slotIndex] ?? null;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'editor-music-arrangement-slot';
        if (
          selection.instrumentId === instrumentId &&
          selectedSlotIndex === slotIndex
        ) {
          button.classList.add('active');
        }
        if (phraseId) {
          button.classList.add('filled');
        }
        button.dataset.roomMusicArrangementInstrument = instrumentId;
        button.dataset.roomMusicArrangementSlot = String(slotIndex);
        button.disabled = options.legacyLocked;
        button.dataset.roomMusicTooltip = phraseId
          ? options.getArrangementSlotLabel(phraseId)
          : `${getPatternInstrumentLabel(instrumentId)} slot ${slotIndex + 1} is empty.`;
        button.ariaLabel = phraseId
          ? `${getPatternInstrumentLabel(instrumentId)} slot ${slotIndex + 1}: ${options.getArrangementSlotLabel(phraseId)}`
          : `Empty ${getPatternInstrumentLabel(instrumentId)} slot ${slotIndex + 1}`;

        const slotNumber = document.createElement('span');
        slotNumber.className = 'editor-music-arrangement-slot-index';
        slotNumber.textContent = String(slotIndex + 1);
        button.append(slotNumber);

        if (phraseId) {
          const slotGlyph = document.createElement('span');
          slotGlyph.className = 'editor-music-arrangement-slot-glyph';
          slotGlyph.textContent = getPatternInstrumentIcon(instrumentId);
          button.append(slotGlyph);
        }

        cells.append(button);
      }

      row.append(cells);
      return row;
    }),
  );

  if (clearButton) {
    clearButton.disabled = options.legacyLocked || selectedPhraseId === null;
  }
  if (clearAllButton) {
    clearAllButton.disabled = options.legacyLocked || filledSlotCount === 0;
  }
}

export function renderMusicLibraryPanel(options: {
  legacyLocked: boolean;
  composerMode: EditorMusicComposerMode;
  activeInstrumentId: RoomPatternInstrumentId;
  items: readonly MusicPhraseRecord[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  getMusicPhraseSampleName: (phrase: MusicPhraseRecord) => string;
  getMusicPhraseKeyLabel: (phrase: MusicPhraseRecord) => string;
  getMusicPhraseRoomLabel: (phrase: MusicPhraseRecord) => string;
}): void {
  const listRoot = document.getElementById('editor-music-library-list');
  const status = document.getElementById('editor-music-library-status');
  const moreButton = document.getElementById('btn-editor-music-library-more') as HTMLButtonElement | null;
  const actionLabel =
    options.composerMode === 'arrangement'
      ? `Drag or click a ${getPatternInstrumentLabel(options.activeInstrumentId)} phrase into the selected slot.`
      : `Insert ${getPatternInstrumentLabel(options.activeInstrumentId)} phrase into the sequencer lane.`;

  if (status) {
    if (options.loading) {
      status.textContent = `Loading ${getPatternInstrumentLabel(options.activeInstrumentId)} phrases...`;
    } else if (options.error) {
      status.textContent = options.error;
    } else if (options.items.length === 0) {
      status.textContent = `No published ${getPatternInstrumentLabel(options.activeInstrumentId).toLowerCase()} phrases yet.`;
    } else {
      status.textContent = actionLabel;
    }
  }

  if (!listRoot) {
    return;
  }

  if (options.loading && options.items.length === 0) {
    listRoot.replaceChildren();
  } else if (options.items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'editor-music-library-empty';
    empty.textContent = 'Publish a sequencer loop to start building the library.';
    listRoot.replaceChildren(empty);
  } else {
    listRoot.replaceChildren(
      ...options.items.map((phrase) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'editor-music-library-item';
        button.dataset.roomMusicPhraseId = phrase.id;
        button.dataset.roomMusicInstrument = phrase.instrumentId;
        button.draggable = !options.legacyLocked;
        button.disabled = options.legacyLocked;
        button.title = phrase.label;
        button.style.setProperty('--editor-music-instrument-accent', getPatternInstrumentColorCss(phrase.instrumentId));
        button.style.setProperty('--editor-music-instrument-rgb', getPatternInstrumentColorRgbCss(phrase.instrumentId));

        const header = document.createElement('span');
        header.className = 'editor-music-library-item-header';

        const icon = document.createElement('span');
        icon.className = 'editor-music-library-item-icon';
        icon.textContent = getPatternInstrumentIcon(phrase.instrumentId);
        header.append(icon);

        const title = document.createElement('span');
        title.className = 'editor-music-library-item-title';
        title.textContent = options.getMusicPhraseSampleName(phrase);
        header.append(title);

        const detail = document.createElement('span');
        detail.className = 'editor-music-library-item-detail';
        detail.textContent = `${options.getMusicPhraseKeyLabel(phrase)} · ${phrase.payload.bpm} BPM`;
        header.append(detail);
        button.append(header);

        const meta = document.createElement('span');
        meta.className = 'editor-music-library-item-meta';
        meta.textContent = `${phrase.creatorDisplayName} · ${options.getMusicPhraseRoomLabel(phrase)}`;
        button.append(meta);

        return button;
      }),
    );
  }

  if (moreButton) {
    moreButton.classList.toggle('hidden', !options.nextCursor);
    moreButton.disabled = options.legacyLocked || options.loadingMore;
    moreButton.textContent = options.loadingMore ? 'Loading...' : 'Load More';
  }
}
