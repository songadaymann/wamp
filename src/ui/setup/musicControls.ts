import Phaser from 'phaser';
import type {
  RoomMusicKeyMode,
  RoomMusicKeyTonic,
  RoomPatternInstrumentId,
  RoomPatternPitchMode,
} from '../../music/model';
import { withActiveEditorScene } from './sceneBridge';

function withInstrumentId(
  value: string | undefined,
  callback: (instrumentId: RoomPatternInstrumentId) => void,
): void {
  if (value !== 'drums' && value !== 'triangle' && value !== 'saw' && value !== 'square') {
    return;
  }

  callback(value);
}

function withPitchMode(
  value: string | undefined,
  callback: (mode: RoomPatternPitchMode) => void,
): void {
  if (value !== 'scale' && value !== 'chromatic') {
    return;
  }

  callback(value);
}

function withComposerMode(
  value: string | undefined,
  callback: (mode: 'sequencer' | 'arrangement') => void,
): void {
  if (value !== 'sequencer' && value !== 'arrangement') {
    return;
  }

  callback(value);
}

function withKeyTonic(
  value: string | undefined,
  callback: (tonic: RoomMusicKeyTonic) => void,
): void {
  if (
    value !== 'C' &&
    value !== 'C#' &&
    value !== 'D' &&
    value !== 'D#' &&
    value !== 'E' &&
    value !== 'F' &&
    value !== 'F#' &&
    value !== 'G' &&
    value !== 'G#' &&
    value !== 'A' &&
    value !== 'A#' &&
    value !== 'B'
  ) {
    return;
  }

  callback(value);
}

function withKeyMode(
  value: string | undefined,
  callback: (mode: RoomMusicKeyMode) => void,
): void {
  if (value !== 'major' && value !== 'minor') {
    return;
  }

  callback(value);
}

export function setupRoomMusicControls(
  game: Phaser.Game,
  doc: Document = document,
): void {
  const modeButton = doc.getElementById('btn-editor-music-mode');
  const previewToggleButton = doc.getElementById('btn-editor-music-preview-toggle') as HTMLButtonElement | null;
  const saveButton = doc.getElementById('btn-editor-music-save') as HTMLButtonElement | null;
  const publishButton = doc.getElementById('btn-editor-music-publish') as HTMLButtonElement | null;
  const octaveDownButton = doc.getElementById('btn-editor-music-octave-down');
  const octaveUpButton = doc.getElementById('btn-editor-music-octave-up');
  const replaceLegacyButton = doc.getElementById('btn-editor-music-replace-legacy');
  const keyTonicSelect = doc.getElementById('editor-music-key-tonic-select') as HTMLSelectElement | null;
  const keyModeSelect = doc.getElementById('editor-music-key-mode-select') as HTMLSelectElement | null;
  const libraryRefreshButton = doc.getElementById('btn-editor-music-library-refresh');
  const libraryMoreButton = doc.getElementById('btn-editor-music-library-more');
  const arrangementClearButton = doc.getElementById('btn-editor-music-arrangement-clear-slot');
  let draggedPhraseId: string | null = null;
  let draggedPhraseButton: HTMLElement | null = null;
  let activeDropTarget: HTMLElement | null = null;

  const clearArrangementDropTarget = () => {
    activeDropTarget?.classList.remove('drag-target');
    activeDropTarget = null;
  };

  modeButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.toggleMusicMode?.();
    });
  });

  previewToggleButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.toggleRoomMusicPreview?.();
    });
  });

  saveButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      void scene.saveDraft?.(true, { promptForSignInOnUnauthorized: true });
    });
  });

  publishButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      void scene.publishRoom?.();
    });
  });

  octaveDownButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.shiftRoomMusicOctave?.(-1);
    });
  });

  octaveUpButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.shiftRoomMusicOctave?.(1);
    });
  });

  replaceLegacyButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.replaceLegacyRoomMusicWithPattern?.();
    });
  });

  keyTonicSelect?.addEventListener('change', () => {
    withKeyTonic(keyTonicSelect.value, (tonic) => {
      withActiveEditorScene(game, (scene) => {
        scene.setRoomMusicKeyTonic?.(tonic);
      });
    });
  });

  keyModeSelect?.addEventListener('change', () => {
    withKeyMode(keyModeSelect.value, (mode) => {
      withActiveEditorScene(game, (scene) => {
        scene.setRoomMusicKeyMode?.(mode);
      });
    });
  });

  libraryRefreshButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.refreshMusicPhraseLibrary?.();
    });
  });

  libraryMoreButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.loadMoreMusicPhrases?.();
    });
  });

  arrangementClearButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.clearSelectedArrangementSlot?.();
    });
  });

  doc.addEventListener('dragstart', (event) => {
    const target = event.target as HTMLElement | null;
    const phraseButton = target?.closest<HTMLElement>('[data-room-music-phrase-id]');
    if (!phraseButton || phraseButton instanceof HTMLButtonElement && phraseButton.disabled) {
      draggedPhraseId = null;
      draggedPhraseButton = null;
      clearArrangementDropTarget();
      return;
    }

    const phraseId = phraseButton.dataset.roomMusicPhraseId ?? null;
    if (!phraseId) {
      return;
    }

    draggedPhraseId = phraseId;
    draggedPhraseButton = phraseButton;
    draggedPhraseButton.classList.add('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('text/plain', phraseId);
    }
  });

  doc.addEventListener('dragover', (event) => {
    if (!draggedPhraseId) {
      return;
    }

    const target = event.target as HTMLElement | null;
    const arrangementSlotButton = target?.closest<HTMLElement>('[data-room-music-arrangement-slot]');
    if (
      !arrangementSlotButton ||
      arrangementSlotButton instanceof HTMLButtonElement && arrangementSlotButton.disabled
    ) {
      clearArrangementDropTarget();
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    if (activeDropTarget === arrangementSlotButton) {
      return;
    }

    clearArrangementDropTarget();
    activeDropTarget = arrangementSlotButton;
    activeDropTarget.classList.add('drag-target');
  });

  doc.addEventListener('drop', (event) => {
    if (!draggedPhraseId) {
      return;
    }

    const target = event.target as HTMLElement | null;
    const arrangementSlotButton = target?.closest<HTMLElement>('[data-room-music-arrangement-slot]');
    if (
      !arrangementSlotButton ||
      arrangementSlotButton instanceof HTMLButtonElement && arrangementSlotButton.disabled
    ) {
      clearArrangementDropTarget();
      return;
    }

    event.preventDefault();
    draggedPhraseButton?.classList.remove('is-dragging');
    withInstrumentId(arrangementSlotButton.dataset.roomMusicArrangementInstrument, (instrumentId) => {
      const rawSlotIndex = arrangementSlotButton.dataset.roomMusicArrangementSlot;
      const slotIndex = rawSlotIndex === undefined ? Number.NaN : Number(rawSlotIndex);
      if (!Number.isInteger(slotIndex)) {
        return;
      }

      withActiveEditorScene(game, (scene) => {
        void scene.assignMusicPhraseToArrangementSlot?.(draggedPhraseId as string, instrumentId, slotIndex);
      });
    });
    clearArrangementDropTarget();
  });

  doc.addEventListener('dragend', () => {
    draggedPhraseButton?.classList.remove('is-dragging');
    draggedPhraseButton = null;
    draggedPhraseId = null;
    clearArrangementDropTarget();
  });

  doc.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    const instrumentButton = target.closest<HTMLElement>('[data-room-music-instrument-tab]');
    if (instrumentButton) {
      withInstrumentId(instrumentButton.dataset.roomMusicInstrumentTab, (instrumentId) => {
        withActiveEditorScene(game, (scene) => {
          scene.setMusicPatternInstrumentTab?.(instrumentId);
        });
      });
      return;
    }

    const composerModeButton = target.closest<HTMLElement>('[data-room-music-composer-mode]');
    if (composerModeButton) {
      withComposerMode(composerModeButton.dataset.roomMusicComposerMode, (mode) => {
        withActiveEditorScene(game, (scene) => {
          scene.setMusicComposerMode?.(mode);
        });
      });
      return;
    }

    const pitchModeButton = target.closest<HTMLElement>('[data-room-music-pitch-mode]');
    if (pitchModeButton) {
      withPitchMode(pitchModeButton.dataset.roomMusicPitchMode, (mode) => {
        withActiveEditorScene(game, (scene) => {
          scene.setRoomMusicPitchMode?.(mode);
        });
      });
      return;
    }

    const phraseButton = target.closest<HTMLElement>('[data-room-music-phrase-id]');
    if (phraseButton) {
      const phraseId = phraseButton.dataset.roomMusicPhraseId;
      if (phraseId) {
        withActiveEditorScene(game, (scene) => {
          void scene.useMusicPhrase?.(phraseId);
        });
      }
      return;
    }

    const arrangementSlotButton = target.closest<HTMLElement>('[data-room-music-arrangement-slot]');
    if (arrangementSlotButton) {
      withInstrumentId(arrangementSlotButton.dataset.roomMusicArrangementInstrument, (instrumentId) => {
        const rawSlotIndex = arrangementSlotButton.dataset.roomMusicArrangementSlot;
        const slotIndex = rawSlotIndex === undefined ? Number.NaN : Number(rawSlotIndex);
        if (!Number.isInteger(slotIndex)) {
          return;
        }

        withActiveEditorScene(game, (scene) => {
          scene.selectArrangementSlot?.(instrumentId, slotIndex);
        });
      });
    }
  });
}
