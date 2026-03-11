import Phaser from 'phaser';
import {
  editorState,
  getTilesetByKey,
  type LayerName,
  type PaletteMode,
  type ToolName,
} from '../../config';
import type { RoomGoalType } from '../../goals/roomGoals';
import { withActiveEditorScene } from './sceneBridge';
import { PaletteController } from './paletteController';

export function setupEditorControls(
  game: Phaser.Game,
  paletteController: PaletteController,
  doc: Document = document,
  windowObj: Window = window,
): void {
  setupToolButtons(doc);
  setupLayerButtons(doc);
  setupRoomTitleInput(game, doc);
  setupTilesetSelector(paletteController, doc);
  setupBackgroundSelector(doc, windowObj);
  setupGoalControls(game, doc);
  setupPaletteModeTabs(paletteController, doc);
  setupObjectCategoryTabs(paletteController, doc);
}

function setupRoomTitleInput(game: Phaser.Game, doc: Document): void {
  const input = doc.getElementById('room-title-input') as HTMLInputElement | null;
  if (!input) {
    return;
  }

  const commit = () => {
    withActiveEditorScene(game, (scene) => {
      scene.setRoomTitle?.(input.value);
    });
  };

  input.addEventListener('input', commit);
  input.addEventListener('change', commit);
}

function setupToolButtons(doc: Document): void {
  doc.querySelectorAll('.tool-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const tool = (button as HTMLElement).dataset.tool as ToolName;
      editorState.activeTool = tool;

      doc.querySelectorAll('.tool-btn').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
    });
  });
}

function setupLayerButtons(doc: Document): void {
  doc.querySelectorAll('.layer-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const layer = (button as HTMLElement).dataset.layer as LayerName;
      editorState.activeLayer = layer;

      doc.querySelectorAll('.layer-btn').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
    });
  });
}

function setupBackgroundSelector(doc: Document, windowObj: Window): void {
  const select = doc.getElementById('background-select') as HTMLSelectElement | null;
  if (!select) {
    return;
  }

  select.addEventListener('change', () => {
    editorState.selectedBackground = select.value;
    windowObj.dispatchEvent(new Event('background-changed'));
  });
}

function setupGoalControls(game: Phaser.Game, doc: Document): void {
  const goalTypeSelect = doc.getElementById('goal-type-select') as HTMLSelectElement | null;
  const timeLimitInput = doc.getElementById('goal-time-limit-seconds') as HTMLInputElement | null;
  const requiredCountInput = doc.getElementById('goal-required-count') as HTMLInputElement | null;
  const survivalInput = doc.getElementById('goal-survival-seconds') as HTMLInputElement | null;
  const placeExitBtn = doc.getElementById('btn-goal-place-exit');
  const addCheckpointBtn = doc.getElementById('btn-goal-add-checkpoint');
  const placeFinishBtn = doc.getElementById('btn-goal-place-finish');
  const clearMarkersBtn = doc.getElementById('btn-goal-clear-markers');

  goalTypeSelect?.addEventListener('change', () => {
    withActiveEditorScene(game, (scene) => {
      const nextType = goalTypeSelect.value ? (goalTypeSelect.value as RoomGoalType) : null;
      scene.setGoalType?.(nextType);
    });
  });

  bindNumericGoalInput(timeLimitInput, (input) => {
    withActiveEditorScene(game, (scene) => {
      const seconds = Number.parseInt(input.value, 10);
      scene.setGoalTimeLimitSeconds?.(Number.isFinite(seconds) && seconds > 0 ? seconds : null);
    });
  });

  bindNumericGoalInput(requiredCountInput, (input) => {
    withActiveEditorScene(game, (scene) => {
      const requiredCount = Number.parseInt(input.value, 10);
      scene.setGoalRequiredCount?.(Number.isFinite(requiredCount) && requiredCount > 0 ? requiredCount : 1);
    });
  });

  bindNumericGoalInput(survivalInput, (input) => {
    withActiveEditorScene(game, (scene) => {
      const seconds = Number.parseInt(input.value, 10);
      scene.setGoalSurvivalSeconds?.(Number.isFinite(seconds) && seconds > 0 ? seconds : 30);
    });
  });

  placeExitBtn?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.startGoalMarkerPlacement?.('exit');
    });
  });

  addCheckpointBtn?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.startGoalMarkerPlacement?.('checkpoint');
    });
  });

  placeFinishBtn?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.startGoalMarkerPlacement?.('finish');
    });
  });

  clearMarkersBtn?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.clearGoalMarkers?.();
    });
  });
}

function bindNumericGoalInput(
  input: HTMLInputElement | null,
  onCommit: (input: HTMLInputElement) => void,
): void {
  if (!input) {
    return;
  }

  input.addEventListener('input', () => onCommit(input));
  input.addEventListener('change', () => onCommit(input));
}

function setupPaletteModeTabs(paletteController: PaletteController, doc: Document): void {
  doc.querySelectorAll('.palette-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const mode = (tab as HTMLElement).dataset.mode as PaletteMode;
      editorState.paletteMode = mode;

      doc.querySelectorAll('.palette-tab').forEach((item) => item.classList.remove('active'));
      tab.classList.add('active');

      const tilesetSection = doc.getElementById('tileset-section');
      const tilePaletteSection = doc.getElementById('tile-palette-section');
      const objectPaletteSection = doc.getElementById('object-palette-section');

      if (mode === 'tiles') {
        tilesetSection?.classList.remove('hidden');
        tilePaletteSection?.classList.remove('hidden');
        objectPaletteSection?.classList.add('hidden');
        editorState.selectedObjectId = null;
      } else {
        tilesetSection?.classList.add('hidden');
        tilePaletteSection?.classList.add('hidden');
        objectPaletteSection?.classList.remove('hidden');
        editorState.activeTool = 'pencil';
        doc.querySelectorAll('.tool-btn').forEach((button) => {
          button.classList.toggle('active', (button as HTMLElement).dataset.tool === 'pencil');
        });
      }

      paletteController.renderTilePreview();
    });
  });
}

function setupObjectCategoryTabs(paletteController: PaletteController, doc: Document): void {
  doc.querySelectorAll('.obj-cat-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const category = (tab as HTMLElement).dataset.category || 'all';
      paletteController.setObjectCategory(category);

      doc.querySelectorAll('.obj-cat-tab').forEach((item) => item.classList.remove('active'));
      tab.classList.add('active');
    });
  });
}

function setupTilesetSelector(paletteController: PaletteController, doc: Document): void {
  const select = doc.getElementById('tileset-select') as HTMLSelectElement | null;
  if (!select) {
    return;
  }

  select.addEventListener('change', () => {
    editorState.selectedTilesetKey = select.value;
    const ts = getTilesetByKey(select.value);
    if (ts) {
      paletteController.updateSelection(ts.key, 0, 0, 0, 0);
    }
    paletteController.renderPalette();
    paletteController.renderTilePreview();
  });
}
