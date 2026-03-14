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

const TILE_FLIP_CHANGED_EVENT = 'tile-flip-changed';
const EDITOR_LAYER_CHANGED_EVENT = 'editor-layer-changed';

export function setupEditorControls(
  game: Phaser.Game,
  paletteController: PaletteController,
  doc: Document = document,
  windowObj: Window = window,
): void {
  setupToolButtons(doc);
  setupLayerButtons(doc);
  setupLayerStatusChip(doc);
  setupRoomTitleInput(game, doc);
  setupTilesetSelector(paletteController, doc);
  setupTileFlipControls(paletteController, doc);
  setupBackgroundSelector(doc, windowObj);
  setupBackgroundCards(doc, windowObj);
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
  const sync = () => {
    doc.querySelectorAll('.layer-btn').forEach((button) => {
      const layer = (button as HTMLElement).dataset.layer as LayerName;
      button.classList.toggle('active', layer === editorState.activeLayer);
    });
  };

  doc.querySelectorAll('.layer-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const layer = (button as HTMLElement).dataset.layer as LayerName;
      editorState.activeLayer = layer;
      sync();
      doc.defaultView?.dispatchEvent(new Event(EDITOR_LAYER_CHANGED_EVENT));
    });
  });

  doc.defaultView?.addEventListener(EDITOR_LAYER_CHANGED_EVENT, sync);
  sync();
}

function setupBackgroundSelector(doc: Document, windowObj: Window): void {
  const select = doc.getElementById('background-select') as HTMLSelectElement | null;
  if (!select) {
    return;
  }

  select.addEventListener('change', () => {
    editorState.selectedBackground = select.value;
    syncBackgroundCardSelection(doc, select.value);
    windowObj.dispatchEvent(new Event('background-changed'));
    requestPhoneEditorAutoCollapse(doc);
  });
}

function setupTileFlipControls(paletteController: PaletteController, doc: Document): void {
  const flipXButton = doc.getElementById('btn-tile-flip-x') as HTMLButtonElement | null;
  const flipYButton = doc.getElementById('btn-tile-flip-y') as HTMLButtonElement | null;
  if (!flipXButton || !flipYButton) {
    return;
  }

  const sync = () => {
    flipXButton.classList.toggle('active', editorState.tileFlipX);
    flipYButton.classList.toggle('active', editorState.tileFlipY);
    flipXButton.setAttribute('aria-pressed', editorState.tileFlipX ? 'true' : 'false');
    flipYButton.setAttribute('aria-pressed', editorState.tileFlipY ? 'true' : 'false');
  };

  flipXButton.addEventListener('click', () => {
    editorState.tileFlipX = !editorState.tileFlipX;
    sync();
    paletteController.renderTilePreview();
    doc.defaultView?.dispatchEvent(new Event(TILE_FLIP_CHANGED_EVENT));
  });

  flipYButton.addEventListener('click', () => {
    editorState.tileFlipY = !editorState.tileFlipY;
    sync();
    paletteController.renderTilePreview();
    doc.defaultView?.dispatchEvent(new Event(TILE_FLIP_CHANGED_EVENT));
  });

  doc.defaultView?.addEventListener(TILE_FLIP_CHANGED_EVENT, sync);
  sync();
}

function setupLayerStatusChip(doc: Document): void {
  const chip = doc.getElementById('editor-layer-chip');
  if (!chip) {
    return;
  }

  const sync = () => {
    const label =
      editorState.activeLayer === 'terrain'
        ? 'Terrain'
        : editorState.activeLayer === 'background'
          ? 'Background'
          : 'Foreground';
    chip.textContent = `Placing on ${label}`;
    chip.setAttribute('data-layer-tone', editorState.activeLayer);
  };

  doc.defaultView?.addEventListener(EDITOR_LAYER_CHANGED_EVENT, sync);
  sync();
}

function setupBackgroundCards(doc: Document, windowObj: Window): void {
  const select = doc.getElementById('background-select') as HTMLSelectElement | null;
  const cards = Array.from(doc.querySelectorAll<HTMLButtonElement>('[data-background-id]'));
  if (!select || cards.length === 0) {
    return;
  }

  syncBackgroundCardSelection(doc, select.value);
  for (const card of cards) {
    card.addEventListener('click', () => {
      const nextBackground = card.dataset.backgroundId;
      if (!nextBackground || select.value === nextBackground) {
        return;
      }

      select.value = nextBackground;
      editorState.selectedBackground = nextBackground;
      syncBackgroundCardSelection(doc, nextBackground);
      windowObj.dispatchEvent(new Event('background-changed'));
      requestPhoneEditorAutoCollapse(doc);
    });
  }
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
    requestPhoneEditorAutoCollapse(doc);
  });

  addCheckpointBtn?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.startGoalMarkerPlacement?.('checkpoint');
    });
    requestPhoneEditorAutoCollapse(doc);
  });

  placeFinishBtn?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.startGoalMarkerPlacement?.('finish');
    });
    requestPhoneEditorAutoCollapse(doc);
  });

  clearMarkersBtn?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.clearGoalMarkers?.();
    });
  });
}

function requestPhoneEditorAutoCollapse(doc: Document): void {
  doc.defaultView?.dispatchEvent(new Event('mobile-editor-auto-collapse'));
}

function syncBackgroundCardSelection(doc: Document, activeBackgroundId: string): void {
  doc.querySelectorAll<HTMLButtonElement>('[data-background-id]').forEach((button) => {
    const active = button.dataset.backgroundId === activeBackgroundId;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
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
        if (editorState.activeTool !== 'eraser') {
          editorState.activeTool = 'pencil';
          doc.querySelectorAll('.tool-btn').forEach((button) => {
            button.classList.toggle('active', (button as HTMLElement).dataset.tool === 'pencil');
          });
        }
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
