import Phaser from 'phaser';
import type { RoomPatternInstrumentId, RoomPatternPitchMode } from '../../music/model';
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

export function setupRoomMusicControls(
  game: Phaser.Game,
  doc: Document = document,
): void {
  const modeButton = doc.getElementById('btn-editor-music-mode');
  const closeOverlayButton = doc.getElementById('btn-editor-music-overlay-close');
  const previewToggleButton = doc.getElementById('btn-editor-music-preview-toggle') as HTMLButtonElement | null;
  const previewStopButton = doc.getElementById('btn-editor-music-preview-stop');
  const octaveDownButton = doc.getElementById('btn-editor-music-octave-down');
  const octaveUpButton = doc.getElementById('btn-editor-music-octave-up');
  const replaceLegacyButton = doc.getElementById('btn-editor-music-replace-legacy');

  modeButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.toggleMusicMode?.();
    });
  });

  closeOverlayButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.setMusicModeActive?.(false);
    });
  });

  previewToggleButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      const previewState = previewToggleButton.dataset.previewState;
      if (previewState === 'playing') {
        scene.pauseRoomMusicPreview?.();
        return;
      }

      scene.playRoomMusicPreview?.();
    });
  });

  previewStopButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.stopRoomMusicPreview?.();
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

    const pitchModeButton = target.closest<HTMLElement>('[data-room-music-pitch-mode]');
    if (pitchModeButton) {
      withPitchMode(pitchModeButton.dataset.roomMusicPitchMode, (mode) => {
        withActiveEditorScene(game, (scene) => {
          scene.setRoomMusicPitchMode?.(mode);
        });
      });
    }
  });
}
