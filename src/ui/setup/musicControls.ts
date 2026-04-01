import Phaser from 'phaser';
import type { RoomMusicLaneId } from '../../music/model';
import { withActiveEditorScene } from './sceneBridge';

function withLaneId(value: string | undefined, callback: (laneId: RoomMusicLaneId) => void): void {
  if (
    value !== 'drums' &&
    value !== 'bass' &&
    value !== 'arp' &&
    value !== 'hold' &&
    value !== 'melody'
  ) {
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
  const arrangeTabButton = doc.getElementById('btn-editor-music-tab-arrange');
  const advancedTabButton = doc.getElementById('btn-editor-music-tab-advanced');
  const pickerModal = doc.getElementById('editor-music-picker-modal');

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

  arrangeTabButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.setMusicEditorTab?.('arrange');
    });
  });

  advancedTabButton?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.setMusicEditorTab?.('advanced');
    });
  });

  pickerModal?.addEventListener('click', (event) => {
    if (event.target !== pickerModal) {
      return;
    }

    withActiveEditorScene(game, (scene) => {
      scene.closeRoomMusicPicker?.();
    });
  });

  doc.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    const closePickerButton = target.closest<HTMLElement>('[data-room-music-picker-close]');
    if (closePickerButton) {
      withActiveEditorScene(game, (scene) => {
        scene.closeRoomMusicPicker?.();
      });
      return;
    }

    const laneButton = target.closest<HTMLButtonElement>('[data-room-music-lane]');
    if (laneButton) {
      withLaneId(laneButton.dataset.roomMusicLane, (laneId) => {
        withActiveEditorScene(game, (scene) => {
          scene.openRoomMusicPicker?.(laneId);
        });
      });
      return;
    }

    const clearLaneButton = target.closest<HTMLButtonElement>('[data-room-music-clear-lane]');
    if (clearLaneButton) {
      withLaneId(clearLaneButton.dataset.roomMusicClearLane, (laneId) => {
        withActiveEditorScene(game, (scene) => {
          scene.clearRoomMusicLaneClip?.(laneId);
        });
      });
      return;
    }

    const previewClipButton = target.closest<HTMLButtonElement>('[data-room-music-preview-clip]');
    if (previewClipButton) {
      const clipId = previewClipButton.dataset.roomMusicPreviewClip;
      if (!clipId) {
        return;
      }

      withActiveEditorScene(game, (scene) => {
        scene.previewRoomMusicClip?.(clipId);
      });
      return;
    }

    const assignClipButton = target.closest<HTMLButtonElement>('[data-room-music-assign-clip]');
    if (assignClipButton) {
      const clipId = assignClipButton.dataset.roomMusicAssignClip;
      if (!clipId) {
        return;
      }

      withLaneId(assignClipButton.dataset.roomMusicAssignLane, (laneId) => {
        withActiveEditorScene(game, (scene) => {
          scene.assignRoomMusicLaneClip?.(laneId, clipId);
        });
      });
    }
  });
}
