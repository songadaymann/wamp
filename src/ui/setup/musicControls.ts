import Phaser from 'phaser';
import type {
  RoomMusicKeyMode,
  RoomMusicKeyTonic,
  RoomPatternInstrumentId,
  RoomPatternPitchMode,
} from '../../music/model';
import { isCoarsePointerDevice } from '../deviceLayout';
import { syncGameKeyboardFocus } from '../keyboardFocus';
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
  const tempoDownButton = doc.getElementById('btn-editor-music-tempo-down');
  const tempoUpButton = doc.getElementById('btn-editor-music-tempo-up');
  const swingDownButton = doc.getElementById('btn-editor-music-swing-down');
  const swingUpButton = doc.getElementById('btn-editor-music-swing-up');
  const replaceLegacyButton = doc.getElementById('btn-editor-music-replace-legacy');
  const keyTonicSelect = doc.getElementById('editor-music-key-tonic-select') as HTMLSelectElement | null;
  const keyModeSelect = doc.getElementById('editor-music-key-mode-select') as HTMLSelectElement | null;
  const phraseNewButton = doc.getElementById('btn-editor-music-phrase-new');
  const phraseEditButton = doc.getElementById('btn-editor-music-phrase-edit');
  const phraseSaveButton = doc.getElementById('btn-editor-music-phrase-save');
  const phraseNameInput = doc.getElementById('editor-music-phrase-name-input') as HTMLInputElement | null;
  const libraryRefreshButton = doc.getElementById('btn-editor-music-library-refresh');
  const libraryMoreButton = doc.getElementById('btn-editor-music-library-more');
  const arrangementClearButton = doc.getElementById('btn-editor-music-arrangement-clear-slot');
  const arrangementClearAllButton = doc.getElementById('btn-editor-music-arrangement-clear-all');
  let draggedPhraseId: string | null = null;
  let draggedPhraseButton: HTMLElement | null = null;
  let activeDropTarget: HTMLElement | null = null;
  let activeTooltipTarget: HTMLElement | null = null;

  const getMusicTooltip = (): HTMLDivElement => {
    let tooltip = doc.getElementById('editor-music-tooltip') as HTMLDivElement | null;
    if (!tooltip) {
      tooltip = doc.createElement('div');
      tooltip.id = 'editor-music-tooltip';
      doc.body.append(tooltip);
    }
    return tooltip;
  };

  const hideMusicTooltip = () => {
    activeTooltipTarget = null;
    const tooltip = doc.getElementById('editor-music-tooltip');
    tooltip?.classList.remove('visible');
  };

  const positionMusicTooltip = (target: HTMLElement, clientX?: number, clientY?: number) => {
    const tooltip = getMusicTooltip();
    const rect = target.getBoundingClientRect();
    const x = clientX ?? rect.left + rect.width * 0.5;
    const y = clientY ?? rect.top - 8;
    tooltip.style.left = `${Math.round(x)}px`;
    tooltip.style.top = `${Math.round(y)}px`;
  };

  const showMusicTooltip = (target: HTMLElement, clientX?: number, clientY?: number) => {
    if (isCoarsePointerDevice()) {
      return;
    }
    const text = target.dataset.roomMusicTooltip?.trim();
    if (!text) {
      hideMusicTooltip();
      return;
    }

    const tooltip = getMusicTooltip();
    tooltip.textContent = text;
    activeTooltipTarget = target;
    positionMusicTooltip(target, clientX, clientY);
    tooltip.classList.add('visible');
  };

  const clearArrangementDropTarget = () => {
    activeDropTarget?.classList.remove('drag-target');
    activeDropTarget = null;
  };

  const focusPhraseNameInput = () => {
    window.requestAnimationFrame(() => {
      const nextInput = doc.getElementById('editor-music-phrase-name-input') as HTMLInputElement | null;
      nextInput?.focus();
      nextInput?.select();
      syncGameKeyboardFocus(game);
    });
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
      void scene.saveRoomMusicDraftAndPhrases?.();
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

  tempoDownButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.shiftRoomMusicTempo?.(-5);
    });
  });

  tempoUpButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.shiftRoomMusicTempo?.(5);
    });
  });

  swingDownButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.shiftRoomMusicSwing?.(-1);
    });
  });

  swingUpButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.shiftRoomMusicSwing?.(1);
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

  phraseNewButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      const result = scene.startNewRoomMusicPhrase?.();
      if (result && typeof (result as Promise<unknown>).finally === 'function') {
        void (result as Promise<unknown>).finally(() => {
          focusPhraseNameInput();
        });
        return;
      }
      focusPhraseNameInput();
    });
  });

  phraseEditButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.toggleRoomMusicPhraseMetadataEditor?.();
      focusPhraseNameInput();
    });
  });

  phraseNameInput?.addEventListener('input', () => {
    withActiveEditorScene(game, (scene) => {
      scene.setRoomMusicPhraseNameSuffix?.(phraseNameInput.value);
    });
  });

  phraseNameInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    withActiveEditorScene(game, (scene) => {
      void scene.saveActiveRoomMusicPhrase?.();
    });
  });

  phraseNameInput?.addEventListener('focus', () => {
    syncGameKeyboardFocus(game);
  });

  phraseNameInput?.addEventListener('blur', () => {
    syncGameKeyboardFocus(game);
  });

  phraseSaveButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      void scene.saveActiveRoomMusicPhrase?.();
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

  arrangementClearAllButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.clearAllArrangementSlots?.();
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
    hideMusicTooltip();
  });

  doc.addEventListener('pointerover', (event) => {
    const target = event.target as HTMLElement | null;
    const tooltipTarget = target?.closest<HTMLElement>('[data-room-music-tooltip]');
    if (!tooltipTarget || (tooltipTarget instanceof HTMLButtonElement && tooltipTarget.disabled)) {
      return;
    }
    showMusicTooltip(tooltipTarget, (event as PointerEvent).clientX, (event as PointerEvent).clientY);
  });

  doc.addEventListener('pointermove', (event) => {
    if (!activeTooltipTarget) {
      return;
    }
    positionMusicTooltip(activeTooltipTarget, (event as PointerEvent).clientX, (event as PointerEvent).clientY);
  });

  doc.addEventListener('pointerout', (event) => {
    if (!activeTooltipTarget) {
      return;
    }
    const target = event.target as HTMLElement | null;
    const tooltipTarget = target?.closest<HTMLElement>('[data-room-music-tooltip]');
    const relatedTarget = (event as PointerEvent).relatedTarget as HTMLElement | null;
    const relatedTooltipTarget = relatedTarget?.closest<HTMLElement>('[data-room-music-tooltip]') ?? null;
    if (tooltipTarget && tooltipTarget === activeTooltipTarget && relatedTooltipTarget !== activeTooltipTarget) {
      hideMusicTooltip();
    }
  });

  doc.addEventListener('focusin', (event) => {
    const target = event.target as HTMLElement | null;
    const tooltipTarget = target?.closest<HTMLElement>('[data-room-music-tooltip]');
    if (!tooltipTarget || (tooltipTarget instanceof HTMLButtonElement && tooltipTarget.disabled)) {
      return;
    }
    showMusicTooltip(tooltipTarget);
  });

  doc.addEventListener('focusout', (event) => {
    const target = event.target as HTMLElement | null;
    const tooltipTarget = target?.closest<HTMLElement>('[data-room-music-tooltip]');
    if (tooltipTarget && tooltipTarget === activeTooltipTarget) {
      hideMusicTooltip();
    }
  });

  doc.addEventListener('click', (event) => {
    hideMusicTooltip();
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
