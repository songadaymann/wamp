import Phaser from 'phaser';
import {
  ERASER_BRUSH_SIZES,
  editorState,
  getTilesetByKey,
  type EraserBrushSize,
  type LayerName,
  type PaletteMode,
  type ToolName,
} from '../../config';
import type { CourseGoalType } from '../../courses/model';
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
  setupLayerGuideToggle(doc);
  setupRoomTitleInput(game, doc);
  setupTilesetSelector(paletteController, doc);
  setupTileFlipControls(paletteController, doc);
  setupEraserControls(game, doc);
  setupBackgroundSelector(doc, windowObj);
  setupBackgroundCards(doc, windowObj);
  setupGoalControls(game, doc);
  setupPaletteModeTabs(paletteController, doc);
  setupObjectCategoryTabs(paletteController, doc);
  syncEditorToolPanels(doc);
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
      syncEditorToolPanels(doc);
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

function setupEraserControls(game: Phaser.Game, doc: Document): void {
  const select = doc.getElementById('erase-brush-select') as HTMLSelectElement | null;
  const clearLayerButton = doc.getElementById('btn-erase-clear-layer') as HTMLButtonElement | null;
  const clearAllButton = doc.getElementById('btn-erase-clear-all') as HTMLButtonElement | null;

  if (select) {
    select.value = String(editorState.eraserBrushSize);
    select.addEventListener('change', () => {
      const nextSize = Number.parseInt(select.value, 10);
      if (ERASER_BRUSH_SIZES.includes(nextSize as EraserBrushSize)) {
        editorState.eraserBrushSize = nextSize as EraserBrushSize;
      }
    });
  }

  clearLayerButton?.addEventListener('click', () => {
    if (!window.confirm('Clear every terrain tile on the current layer?')) {
      return;
    }

    withActiveEditorScene(game, (scene) => {
      scene.clearCurrentLayer?.();
    });
  });

  clearAllButton?.addEventListener('click', () => {
    if (!window.confirm('Remove all terrain from background, terrain, and foreground?')) {
      return;
    }

    withActiveEditorScene(game, (scene) => {
      scene.clearAllTiles?.();
    });
  });
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

function setupLayerGuideToggle(doc: Document): void {
  const button = doc.getElementById('btn-editor-layer-guides') as HTMLButtonElement | null;
  if (!button) {
    return;
  }

  const sync = () => {
    button.classList.toggle('active', editorState.showLayerGuides);
    button.setAttribute('aria-pressed', editorState.showLayerGuides ? 'true' : 'false');
    button.textContent = editorState.showLayerGuides ? 'Hide Layers' : 'See Layers';
  };

  button.addEventListener('click', () => {
    editorState.showLayerGuides = !editorState.showLayerGuides;
    sync();
  });

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
  const placeStartBtn = doc.getElementById('btn-goal-place-start');
  const placeExitBtn = doc.getElementById('btn-goal-place-exit');
  const addCheckpointBtn = doc.getElementById('btn-goal-add-checkpoint');
  const placeFinishBtn = doc.getElementById('btn-goal-place-finish');
  const clearMarkersBtn = doc.getElementById('btn-goal-clear-markers');
  const courseGoalTypeSelect = doc.getElementById('course-editor-goal-type-select') as HTMLSelectElement | null;
  const courseTimeLimitInput = doc.getElementById('course-editor-time-limit-seconds') as HTMLInputElement | null;
  const courseRequiredCountInput = doc.getElementById('course-editor-required-count') as HTMLInputElement | null;
  const courseSurvivalInput = doc.getElementById('course-editor-survival-seconds') as HTMLInputElement | null;
  const coursePlaceStartBtn = doc.getElementById('btn-course-editor-place-start');
  const coursePlaceExitBtn = doc.getElementById('btn-course-editor-place-exit');
  const courseAddCheckpointBtn = doc.getElementById('btn-course-editor-add-checkpoint');
  const coursePlaceFinishBtn = doc.getElementById('btn-course-editor-place-finish');
  const courseClearMarkersBtn = doc.getElementById('btn-course-editor-clear-markers');
  const coursePreviousRoomBtn = doc.getElementById('btn-course-editor-previous-room');
  const courseNextRoomBtn = doc.getElementById('btn-course-editor-next-room');

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

  placeStartBtn?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.startGoalMarkerPlacement?.('start');
    });
    requestPhoneEditorAutoCollapse(doc);
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

  courseGoalTypeSelect?.addEventListener('change', () => {
    withActiveEditorScene(game, (scene) => {
      const nextType = courseGoalTypeSelect.value
        ? (courseGoalTypeSelect.value as CourseGoalType)
        : null;
      scene.setCourseGoalType?.(nextType);
    });
  });

  bindNumericGoalInput(courseTimeLimitInput, (input) => {
    withActiveEditorScene(game, (scene) => {
      const seconds = Number.parseInt(input.value, 10);
      scene.setCourseGoalTimeLimitSeconds?.(Number.isFinite(seconds) && seconds > 0 ? seconds : null);
    });
  });

  bindNumericGoalInput(courseRequiredCountInput, (input) => {
    withActiveEditorScene(game, (scene) => {
      const requiredCount = Number.parseInt(input.value, 10);
      scene.setCourseGoalRequiredCount?.(Number.isFinite(requiredCount) && requiredCount > 0 ? requiredCount : 1);
    });
  });

  bindNumericGoalInput(courseSurvivalInput, (input) => {
    withActiveEditorScene(game, (scene) => {
      const seconds = Number.parseInt(input.value, 10);
      scene.setCourseGoalSurvivalSeconds?.(Number.isFinite(seconds) && seconds > 0 ? seconds : 30);
    });
  });

  coursePlaceStartBtn?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.startCourseGoalMarkerPlacement?.('start');
    });
    requestPhoneEditorAutoCollapse(doc);
  });

  coursePlaceExitBtn?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.startCourseGoalMarkerPlacement?.('exit');
    });
    requestPhoneEditorAutoCollapse(doc);
  });

  courseAddCheckpointBtn?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.startCourseGoalMarkerPlacement?.('checkpoint');
    });
    requestPhoneEditorAutoCollapse(doc);
  });

  coursePlaceFinishBtn?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.startCourseGoalMarkerPlacement?.('finish');
    });
    requestPhoneEditorAutoCollapse(doc);
  });

  courseClearMarkersBtn?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      scene.clearCourseGoalMarkers?.();
    });
  });

  coursePreviousRoomBtn?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      void scene.editPreviousCourseRoom?.();
    });
  });

  courseNextRoomBtn?.addEventListener('click', () => {
    withActiveEditorScene(game, (scene) => {
      void scene.editNextCourseRoom?.();
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
      syncEditorToolPanels(doc);
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

function syncEditorToolPanels(doc: Document): void {
  const eraseControls = doc.getElementById('erase-controls');
  const showEraseControls =
    editorState.paletteMode === 'tiles' && editorState.activeTool === 'eraser';
  eraseControls?.classList.toggle('hidden', !showEraseControls);
}
