import {
  ERASER_BRUSH_SIZES,
  TILESETS,
  editorState,
  getTilesetByKey,
  type EraserBrushSize,
  type LayerName,
  type PaletteMode,
  type ToolName,
} from '../../config';
import {
  finalizeBackgroundUpload,
  listBackgroundImages,
  prepareBackgroundUpload,
  uploadBackgroundFile,
  type BackgroundImageSummary,
  type BackgroundUploadPolicy,
} from '../../backgrounds/client';
import {
  DEFAULT_CUSTOM_BACKGROUND_FIT,
  PHOTO_BACKGROUND_ID,
  SOLID_COLOR_BACKGROUND_ID,
  buildCustomBackgroundValue,
  buildSolidColorBackgroundValue,
  getBackgroundSelectionValue,
  getSolidColorFromBackgroundValue,
  normalizeRoomBackground,
  normalizeSolidBackgroundColor,
  parseCustomBackground,
  type CustomBackgroundFit,
} from '../../backgrounds/model';
import type { CourseGoalType } from '../../courses/model';
import type { RoomGoalType } from '../../goals/roomGoals';
import {
  normalizeRoomLightingSliderValue,
  type RoomLightingMode,
} from '../../lighting/model';
import { AUTH_STATE_CHANGED_EVENT } from '../../auth/client';
import { EDITOR_UI_STATE_CHANGED_EVENT } from './uiEvents';
import type {
  EditorInspectorState,
  EditorUiBridgeActions,
  EditorUiRuntimeConfig,
  EditorUiViewModel,
} from './uiBridge/model';
import {
  lookupEditorUiElements,
  type EditorUiElements,
} from './uiBridge/elements';
import {
  bindButton,
  bindDomEvent,
  bindNumericInput,
  bindRangeInput,
  bindTextInput,
} from './uiBridge/bindings';
import {
  applyTilesetTheme,
  renderEditorUiViewModel,
  renderInspectorPanel,
  setDisabled,
  setHidden,
  setText,
  setValue,
} from './uiBridge/panels';

export type {
  EditorCourseUiViewModel,
  EditorGoalUiViewModel,
  EditorInspectorState,
  EditorUiBridgeActions,
  EditorUiPaletteController,
  EditorUiRuntimeConfig,
  EditorUiViewModel,
} from './uiBridge/model';

const runtimeConfig: EditorUiRuntimeConfig = {
  paletteController: null,
  closePanels: () => {},
  openHistory: () => {},
};

const BACKGROUND_UPLOAD_SELECT_VALUE = '__upload_background__';
const DEFAULT_BACKGROUND_PHOTOS_SORT: BackgroundPhotosSort = 'most_used';

type BackgroundPhotosSort = 'most_used' | 'least_used' | 'newest' | 'oldest';

const PREFERRED_TILESET_OPTION_ORDER = [
  'essentials',
  'forest',
  'forest_2',
  'desert',
  'cave',
  'lava',
  'snow',
  'water',
  'smb_lvl1_3_5',
  'text white',
  'text black',
  'signs and graffiti',
  'special',
] as const;

function getEditorTilesets(): typeof TILESETS {
  const preferredOrder = new Map<string, number>(
    PREFERRED_TILESET_OPTION_ORDER.map((key, index) => [key, index])
  );

  return [...TILESETS].sort((left, right) => {
    const leftOrder = preferredOrder.get(left.key);
    const rightOrder = preferredOrder.get(right.key);
    if (leftOrder !== undefined || rightOrder !== undefined) {
      return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
    }

    return left.name.localeCompare(right.name);
  });
}

export function configureEditorUiBridgeRuntime(config: Partial<EditorUiRuntimeConfig>): void {
  if (config.paletteController !== undefined) {
    runtimeConfig.paletteController = config.paletteController;
  }
  if (config.closePanels) {
    runtimeConfig.closePanels = config.closePanels;
  }
  if (config.openHistory) {
    runtimeConfig.openHistory = config.openHistory;
  }
}

function getLayerUiLabel(layer: LayerName): string {
  switch (layer) {
    case 'background':
      return 'Back';
    case 'foreground':
      return 'Front';
    case 'terrain':
    default:
      return 'Gameplay';
  }
}

type EditorFeatureLauncher = 'goal' | 'music' | 'lighting' | 'sprite';

function getEditorFeatureLauncher(value: string | undefined): EditorFeatureLauncher | null {
  switch (value) {
    case 'goal':
    case 'music':
    case 'lighting':
    case 'sprite':
      return value;
    default:
      return null;
  }
}

export class EditorUiBridge {
  private readonly cleanupCallbacks: Array<() => void> = [];
  private readonly elements: EditorUiElements;
  private destroyed = false;
  private moreToolsOpen = false;
  private activeFeatureLauncher: EditorFeatureLauncher | null = null;
  private currentObjectCategory = 'all';
  private lastViewModel: EditorUiViewModel | null = null;
  private backgroundImages: BackgroundImageSummary[] = [];
  private backgroundUploadPolicy: BackgroundUploadPolicy | null = null;
  private backgroundCatalogToken = 0;
  private backgroundUploadInFlight = false;
  private backgroundPhotosSortMode: BackgroundPhotosSort = DEFAULT_BACKGROUND_PHOTOS_SORT;
  private backgroundPhotoControlsMode: 'photo' | 'upload' | null = null;

  constructor(
    private readonly actions: EditorUiBridgeActions,
    private readonly doc: Document = document,
    private readonly windowObj: Window = window,
  ) {
    this.elements = lookupEditorUiElements(this.doc);
    this.populateTilesetOptions();

    this.bindListeners();
    this.syncEditorChromeState();
    runtimeConfig.paletteController?.renderPalette();
    runtimeConfig.paletteController?.renderTilePreview();
    void this.refreshBackgroundImages();
  }

  private populateTilesetOptions(): void {
    if (!this.elements.tilesetSelect) {
      return;
    }

    const editorTilesets = getEditorTilesets();
    const selectedKey =
      getTilesetByKey(editorState.selectedTilesetKey)?.key ?? editorTilesets[0]?.key ?? '';
    this.elements.tilesetSelect.replaceChildren(
      ...editorTilesets.map((tileset) => {
        const option = this.doc.createElement('option');
        option.value = tileset.key;
        option.textContent = tileset.name;
        return option;
      })
    );
    this.elements.tilesetSelect.value = selectedKey;
  }

  render(viewModel: EditorUiViewModel): void {
    if (this.destroyed) {
      return;
    }

    this.lastViewModel = viewModel;
    renderEditorUiViewModel(this.elements, this.doc, viewModel);
    this.syncEditorChromeState();
  }

  renderInspector(state: EditorInspectorState): void {
    if (this.destroyed) {
      return;
    }

    renderInspectorPanel(this.elements, state);
  }

  notifyEditorStateChanged(): void {
    this.windowObj.dispatchEvent(new Event(EDITOR_UI_STATE_CHANGED_EVENT));
  }

  destroy(): void {
    setHidden(this.elements.inspectorRoot, true);
    setHidden(this.elements.pressurePanel, true);
    setHidden(this.elements.containerPanel, true);
    this.destroyed = true;
    for (const cleanup of this.cleanupCallbacks) {
      cleanup();
    }
    this.cleanupCallbacks.length = 0;
  }

  private bindListeners(): void {
    bindDomEvent(this.cleanupCallbacks, this.doc, 'keydown', (event) => {
      this.actions.onDocumentKeyDown(event as KeyboardEvent);
    });
    bindDomEvent(this.cleanupCallbacks, this.windowObj, AUTH_STATE_CHANGED_EVENT, () => {
      this.actions.onAuthStateChanged();
      void this.refreshBackgroundImages();
    });
    bindDomEvent(this.cleanupCallbacks, this.windowObj, EDITOR_UI_STATE_CHANGED_EVENT, () => {
      if (this.lastViewModel) {
        this.syncEditorChromeState();
      }
      this.actions.onRequestRender();
    });

    const commitRoomTitle = () => {
      this.actions.onSetRoomTitle(this.elements.roomTitleInput?.value ?? null);
    };
    this.elements.roomTitleInput?.addEventListener('input', commitRoomTitle);
    this.elements.roomTitleInput?.addEventListener('change', commitRoomTitle);
    if (this.elements.roomTitleInput) {
      this.cleanupCallbacks.push(() => {
        this.elements.roomTitleInput?.removeEventListener('input', commitRoomTitle);
        this.elements.roomTitleInput?.removeEventListener('change', commitRoomTitle);
      });
    }

    for (const button of this.elements.toolButtons) {
      const handler = () => {
        const tool = button.dataset.tool as ToolName | undefined;
        if (!tool) {
          return;
        }
        this.actions.onSelectTool(tool);
        if (tool !== 'rect' && tool !== 'fill') {
          this.moreToolsOpen = false;
        }
      };
      button.addEventListener('click', handler);
      this.cleanupCallbacks.push(() => button.removeEventListener('click', handler));
    }

    for (const button of this.elements.featureButtons) {
      const handler = () => {
        const feature = getEditorFeatureLauncher(button.dataset.editorFeature);
        if (!feature) {
          return;
        }
        this.handleFeatureLauncher(feature);
      };
      button.addEventListener('click', handler);
      this.cleanupCallbacks.push(() => button.removeEventListener('click', handler));
    }

    for (const button of this.elements.moreToolsButtons) {
      const toggleMoreTools = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        this.moreToolsOpen = !this.moreToolsOpen;
        this.syncEditorChromeState();
      };
      button.addEventListener('click', toggleMoreTools);
      this.cleanupCallbacks.push(() => button.removeEventListener('click', toggleMoreTools));
    }

    const closeMoreToolsOnOutsideClick = (event: Event) => {
      if (this.elements.moreToolsPanels.length === 0 || !this.moreToolsOpen) {
        return;
      }
      const target = event.target as Node | null;
      if (
        target &&
        (this.elements.moreToolsPanels.some((panel) => panel.contains(target)) ||
          this.elements.moreToolsButtons.some((button) => button.contains(target)))
      ) {
        return;
      }
      this.moreToolsOpen = false;
      this.syncEditorChromeState();
    };
    this.doc.addEventListener('click', closeMoreToolsOnOutsideClick);
    this.cleanupCallbacks.push(() =>
      this.doc.removeEventListener('click', closeMoreToolsOnOutsideClick)
    );

    const handleEraserBrushChange = () => {
      const target = this.doc.activeElement;
      const selectedInput =
        this.elements.eraseBrushSelects.find((input) => input === target) ?? this.elements.eraseBrushSelects[0];
      const nextSize = Number.parseInt(selectedInput?.value ?? '', 10);
      if (ERASER_BRUSH_SIZES.includes(nextSize as EraserBrushSize)) {
        editorState.eraserBrushSize = nextSize as EraserBrushSize;
        this.syncEditorChromeState();
      }
    };
    for (const input of this.elements.eraseBrushSelects) {
      input.addEventListener('change', handleEraserBrushChange);
      this.cleanupCallbacks.push(() =>
        input.removeEventListener('change', handleEraserBrushChange)
      );
    }

    for (const button of this.elements.clearLayerButtons) {
      bindButton(this.cleanupCallbacks, button, () => {
        if (!this.windowObj.confirm('Clear every tile on the current layer?')) {
          return;
        }
        this.actions.onClearCurrentLayer();
      });
    }

    for (const button of this.elements.clearAllButtons) {
      bindButton(this.cleanupCallbacks, button, () => {
        if (!this.windowObj.confirm('Remove all tiles from Back, Gameplay, and Front?')) {
          return;
        }
        this.actions.onClearAllTiles();
      });
    }

    for (const button of this.elements.clearObjectButtons) {
      bindButton(this.cleanupCallbacks, button, () => {
        if (!this.windowObj.confirm('Remove all placed objects from this room?')) {
          return;
        }
        this.actions.onClearAllObjects();
      });
    }

    const handleLayerClick = (button: HTMLElement) => {
      const layer = button.dataset.layer as LayerName | undefined;
      if (!layer) {
        return;
      }
      editorState.activeLayer = layer;
      this.syncEditorChromeState();
    };
    for (const button of [...this.elements.layerButtons, ...this.elements.layerMiniButtons]) {
      const handler = () => handleLayerClick(button);
      button.addEventListener('click', handler);
      this.cleanupCallbacks.push(() => button.removeEventListener('click', handler));
    }

    bindButton(this.cleanupCallbacks, this.elements.layerGuideButton, () => {
      editorState.showLayerGuides = !editorState.showLayerGuides;
      this.syncEditorChromeState();
    });

    const handleTilesetChange = () => {
      if (!this.elements.tilesetSelect) {
        return;
      }
      editorState.selectedTilesetKey = this.elements.tilesetSelect.value;
      const tileset = getTilesetByKey(this.elements.tilesetSelect.value);
      if (tileset) {
        runtimeConfig.paletteController?.updateSelection(tileset.key, 0, 0, 0, 0);
      }
      runtimeConfig.paletteController?.renderPalette();
      runtimeConfig.paletteController?.renderTilePreview();
      this.syncEditorChromeState();
    };
    this.elements.tilesetSelect?.addEventListener('change', handleTilesetChange);
    if (this.elements.tilesetSelect) {
      this.cleanupCallbacks.push(() =>
        this.elements.tilesetSelect?.removeEventListener('change', handleTilesetChange)
      );
    }

    bindButton(this.cleanupCallbacks, this.elements.flipXButton, () => {
      editorState.tileFlipX = !editorState.tileFlipX;
      runtimeConfig.paletteController?.renderTilePreview();
      this.syncEditorChromeState();
    });
    bindButton(this.cleanupCallbacks, this.elements.flipYButton, () => {
      editorState.tileFlipY = !editorState.tileFlipY;
      runtimeConfig.paletteController?.renderTilePreview();
      this.syncEditorChromeState();
    });

    for (const tab of this.elements.paletteTabs) {
      const handler = () => {
        const mode = (tab.dataset.mode as PaletteMode | undefined) ?? 'tiles';
        editorState.paletteMode = mode;
        if (mode === 'tiles') {
          editorState.selectedObjectId = null;
        } else if (editorState.activeTool !== 'eraser') {
          this.actions.onSelectTool('pencil');
        }
        runtimeConfig.paletteController?.renderTilePreview();
        this.syncEditorChromeState();
      };
      tab.addEventListener('click', handler);
      this.cleanupCallbacks.push(() => tab.removeEventListener('click', handler));
    }

    for (const tab of this.elements.objectCategoryTabs) {
      const handler = () => {
        this.currentObjectCategory = tab.dataset.category || 'all';
        runtimeConfig.paletteController?.setObjectCategory(this.currentObjectCategory);
        this.syncEditorChromeState();
      };
      tab.addEventListener('click', handler);
      this.cleanupCallbacks.push(() => tab.removeEventListener('click', handler));
    }

    const handleBackgroundSelectChange = () => {
      if (!this.elements.backgroundSelect) {
        return;
      }
      this.applyBackgroundSelection(this.elements.backgroundSelect.value);
    };
    this.elements.backgroundSelect?.addEventListener('change', handleBackgroundSelectChange);
    if (this.elements.backgroundSelect) {
      this.cleanupCallbacks.push(() =>
        this.elements.backgroundSelect?.removeEventListener('change', handleBackgroundSelectChange)
      );
    }
    const handleBackgroundSolidColorChange = () => {
      if (!this.elements.backgroundSolidColorInput) {
        return;
      }
      const nextColor = normalizeSolidBackgroundColor(
        this.elements.backgroundSolidColorInput.value,
        editorState.selectedSolidBackgroundColor,
      );
      editorState.selectedSolidBackgroundColor = nextColor;
      if (getBackgroundSelectionValue(editorState.selectedBackground) === SOLID_COLOR_BACKGROUND_ID) {
        const nextBackground = buildSolidColorBackgroundValue(nextColor);
        if (editorState.selectedBackground !== nextBackground) {
          editorState.selectedBackground = nextBackground;
          this.actions.onSelectBackground(nextBackground);
        }
      }
      this.syncEditorChromeState();
    };
    this.elements.backgroundSolidColorInput?.addEventListener('input', handleBackgroundSolidColorChange);
    this.elements.backgroundSolidColorInput?.addEventListener('change', handleBackgroundSolidColorChange);
    if (this.elements.backgroundSolidColorInput) {
      this.cleanupCallbacks.push(() => {
        this.elements.backgroundSolidColorInput?.removeEventListener(
          'input',
          handleBackgroundSolidColorChange,
        );
        this.elements.backgroundSolidColorInput?.removeEventListener(
          'change',
          handleBackgroundSolidColorChange,
        );
      });
    }

    const handleLightingSelectChange = () => {
      if (!this.elements.lightingSelect) {
        return;
      }
      this.applyLightingSelection(this.elements.lightingSelect.value as RoomLightingMode);
    };
    this.elements.lightingSelect?.addEventListener('change', handleLightingSelectChange);
    if (this.elements.lightingSelect) {
      this.cleanupCallbacks.push(() =>
        this.elements.lightingSelect?.removeEventListener('change', handleLightingSelectChange)
      );
    }
    bindRangeInput(
      this.cleanupCallbacks,
      this.elements.lightingDarknessInput,
      () =>
        normalizeRoomLightingSliderValue(
          Number.parseInt(this.elements.lightingDarknessInput?.value ?? '', 10),
          editorState.selectedLightingDarkness,
        ),
      (value) => {
        this.applyLightingDarkness(value);
      },
    );
    bindRangeInput(
      this.cleanupCallbacks,
      this.elements.lightingRadiusInput,
      () =>
        normalizeRoomLightingSliderValue(
          Number.parseInt(this.elements.lightingRadiusInput?.value ?? '', 10),
          editorState.selectedLightingRadius,
        ),
      (value) => {
        this.applyLightingRadius(value);
      },
    );

    for (const button of this.elements.backgroundButtons) {
      const handler = () => {
        const nextBackground = button.dataset.backgroundId;
        if (!nextBackground) {
          return;
        }
        this.applyBackgroundSelection(nextBackground);
      };
      button.addEventListener('click', handler);
      this.cleanupCallbacks.push(() => button.removeEventListener('click', handler));
    }

    const openUploadPicker = () => {
      this.openBackgroundUploadPicker();
    };
    bindButton(this.cleanupCallbacks, this.elements.backgroundUploadButton, openUploadPicker);
    bindButton(this.cleanupCallbacks, this.elements.backgroundUploadCard, openUploadPicker);
    bindButton(this.cleanupCallbacks, this.elements.backgroundPhotosButton, () => this.openBackgroundPhotosModal());
    bindButton(this.cleanupCallbacks, this.elements.backgroundPhotosCloseButton, () => this.closeBackgroundPhotosModal());
    bindButton(this.cleanupCallbacks, this.elements.backgroundUploadModalCloseButton, () => this.closeBackgroundUploadModal());
    for (const button of this.elements.backgroundPhotoFitButtons) {
      const handler = () => {
        this.applyBackgroundPhotoFit(button.dataset.backgroundPhotoFit as CustomBackgroundFit);
      };
      button.addEventListener('click', handler);
      this.cleanupCallbacks.push(() => button.removeEventListener('click', handler));
    }
    const handleBackgroundPhotosSortChange = () => {
      this.backgroundPhotosSortMode = this.getBackgroundPhotosSortMode();
      this.renderBackgroundPhotoGrid();
    };
    this.elements.backgroundPhotosSort?.addEventListener('change', handleBackgroundPhotosSortChange);
    if (this.elements.backgroundPhotosSort) {
      this.cleanupCallbacks.push(() =>
        this.elements.backgroundPhotosSort?.removeEventListener('change', handleBackgroundPhotosSortChange)
      );
    }
    const handleBackgroundUploadInput = () => {
      void this.handleBackgroundUploadFileSelected();
    };
    this.elements.backgroundUploadInput?.addEventListener('change', handleBackgroundUploadInput);
    if (this.elements.backgroundUploadInput) {
      this.cleanupCallbacks.push(() =>
        this.elements.backgroundUploadInput?.removeEventListener('change', handleBackgroundUploadInput)
      );
    }

    const handleGoalTypeChange = () => {
      this.actions.onSetGoalType(
        this.elements.goalTypeSelect?.value ? (this.elements.goalTypeSelect.value as RoomGoalType) : null
      );
    };
    this.elements.goalTypeSelect?.addEventListener('change', handleGoalTypeChange);
    if (this.elements.goalTypeSelect) {
      this.cleanupCallbacks.push(() =>
        this.elements.goalTypeSelect?.removeEventListener('change', handleGoalTypeChange)
      );
    }
    bindNumericInput(this.cleanupCallbacks, this.elements.timeLimitInput, (input) => {
      const seconds = Number.parseInt(input.value, 10);
      this.actions.onSetGoalTimeLimitSeconds(Number.isFinite(seconds) && seconds > 0 ? seconds : null);
    });
    bindNumericInput(this.cleanupCallbacks, this.elements.requiredCountInput, (input) => {
      const requiredCount = Number.parseInt(input.value, 10);
      this.actions.onSetGoalRequiredCount(Number.isFinite(requiredCount) && requiredCount > 0 ? requiredCount : 1);
    });
    bindNumericInput(this.cleanupCallbacks, this.elements.survivalInput, (input) => {
      const seconds = Number.parseInt(input.value, 10);
      this.actions.onSetGoalSurvivalSeconds(Number.isFinite(seconds) && seconds > 0 ? seconds : 30);
    });
    bindTextInput(this.cleanupCallbacks, this.elements.goalIntroInput, (input) => {
      this.actions.onSetGoalIntroText(input.value);
    });
    bindButton(this.cleanupCallbacks, this.elements.placeStartBtn, () => {
      this.actions.onStartGoalMarkerPlacement('start');
      this.requestPhoneEditorAutoCollapse();
    });
    bindButton(this.cleanupCallbacks, this.elements.placeExitBtn, () => {
      this.actions.onStartGoalMarkerPlacement('exit');
      this.requestPhoneEditorAutoCollapse();
    });
    bindButton(this.cleanupCallbacks, this.elements.addCheckpointBtn, () => {
      this.actions.onStartGoalMarkerPlacement('checkpoint');
      this.requestPhoneEditorAutoCollapse();
    });
    bindButton(this.cleanupCallbacks, this.elements.placeFinishBtn, () => {
      this.actions.onStartGoalMarkerPlacement('finish');
      this.requestPhoneEditorAutoCollapse();
    });
    bindButton(this.cleanupCallbacks, this.elements.clearGoalMarkersBtn, () => {
      this.actions.onClearGoalMarkers();
    });

    const handleCourseGoalTypeChange = () => {
      this.actions.onSetCourseGoalType(
        this.elements.courseGoalTypeSelect?.value
          ? (this.elements.courseGoalTypeSelect.value as CourseGoalType)
          : null
      );
    };
    this.elements.courseGoalTypeSelect?.addEventListener('change', handleCourseGoalTypeChange);
    if (this.elements.courseGoalTypeSelect) {
      this.cleanupCallbacks.push(() =>
        this.elements.courseGoalTypeSelect?.removeEventListener('change', handleCourseGoalTypeChange)
      );
    }
    bindNumericInput(this.cleanupCallbacks, this.elements.courseTimeLimitInput, (input) => {
      const seconds = Number.parseInt(input.value, 10);
      this.actions.onSetCourseGoalTimeLimitSeconds(
        Number.isFinite(seconds) && seconds > 0 ? seconds : null
      );
    });
    bindNumericInput(this.cleanupCallbacks, this.elements.courseRequiredCountInput, (input) => {
      const requiredCount = Number.parseInt(input.value, 10);
      this.actions.onSetCourseGoalRequiredCount(
        Number.isFinite(requiredCount) && requiredCount > 0 ? requiredCount : 1
      );
    });
    bindNumericInput(this.cleanupCallbacks, this.elements.courseSurvivalInput, (input) => {
      const seconds = Number.parseInt(input.value, 10);
      this.actions.onSetCourseGoalSurvivalSeconds(
        Number.isFinite(seconds) && seconds > 0 ? seconds : 30
      );
    });
    bindButton(this.cleanupCallbacks, this.elements.coursePlaceStartBtn, () => {
      this.actions.onStartCourseGoalMarkerPlacement('start');
      this.requestPhoneEditorAutoCollapse();
    });
    bindButton(this.cleanupCallbacks, this.elements.coursePlaceExitBtn, () => {
      this.actions.onStartCourseGoalMarkerPlacement('exit');
      this.requestPhoneEditorAutoCollapse();
    });
    bindButton(this.cleanupCallbacks, this.elements.courseAddCheckpointBtn, () => {
      this.actions.onStartCourseGoalMarkerPlacement('checkpoint');
      this.requestPhoneEditorAutoCollapse();
    });
    bindButton(this.cleanupCallbacks, this.elements.coursePlaceFinishBtn, () => {
      this.actions.onStartCourseGoalMarkerPlacement('finish');
      this.requestPhoneEditorAutoCollapse();
    });
    bindButton(this.cleanupCallbacks, this.elements.courseClearMarkersBtn, () => {
      this.actions.onClearCourseGoalMarkers();
    });

    bindButton(this.cleanupCallbacks, this.elements.pressureConnectBtn, () => {
      this.actions.onBeginPressurePlateConnection();
      this.requestPhoneEditorAutoCollapse();
    });
    bindButton(this.cleanupCallbacks, this.elements.pressureClearBtn, () => {
      this.actions.onClearPressurePlateConnection();
    });
    bindButton(this.cleanupCallbacks, this.elements.pressureDoneLaterBtn, () => {
      this.actions.onCancelPressurePlateConnection();
    });
    bindButton(this.cleanupCallbacks, this.elements.containerClearBtn, () => {
      this.actions.onClearContainerContents();
    });
    const handleSwordsmanObjectiveModeChange = () => {
      const value = this.elements.swordsmanObjectiveModeSelect?.value;
      if (value === 'duel' || value === 'collect') {
        this.actions.onSetFocusedSwordsmanObjectiveMode(value);
      }
    };
    this.elements.swordsmanObjectiveModeSelect?.addEventListener('change', handleSwordsmanObjectiveModeChange);
    if (this.elements.swordsmanObjectiveModeSelect) {
      this.cleanupCallbacks.push(() =>
        this.elements.swordsmanObjectiveModeSelect?.removeEventListener(
          'change',
          handleSwordsmanObjectiveModeChange,
        )
      );
    }
    const handleSwordsmanDefeatModeChange = () => {
      const value = this.elements.swordsmanDefeatModeSelect?.value;
      if (value === 'defeatable' || value === 'invincible' || value === 'respawn') {
        this.actions.onSetFocusedSwordsmanDefeatMode(value);
      }
    };
    this.elements.swordsmanDefeatModeSelect?.addEventListener('change', handleSwordsmanDefeatModeChange);
    if (this.elements.swordsmanDefeatModeSelect) {
      this.cleanupCallbacks.push(() =>
        this.elements.swordsmanDefeatModeSelect?.removeEventListener(
          'change',
          handleSwordsmanDefeatModeChange,
        )
      );
    }

    bindButton(this.cleanupCallbacks, this.elements.playBtn, () => {
      runtimeConfig.closePanels();
      void this.actions.onStartPlayMode();
    });
    bindButton(this.cleanupCallbacks, this.elements.backBtn, () => {
      runtimeConfig.closePanels();
      void this.actions.onBack();
    });
    bindButton(this.cleanupCallbacks, this.elements.saveBtn, () => {
      runtimeConfig.closePanels();
      void this.actions.onSaveDraft();
    });
    bindButton(this.cleanupCallbacks, this.elements.publishBtn, () => {
      runtimeConfig.closePanels();
      void this.actions.onPublishRoom();
    });
    bindButton(this.cleanupCallbacks, this.elements.publishNudgeActionBtn, () => {
      runtimeConfig.closePanels();
      void this.actions.onPublishNudge();
    });
    bindButton(this.cleanupCallbacks, this.elements.mintBtn, () => {
      runtimeConfig.closePanels();
      void this.actions.onMintRoom();
    });
    bindButton(this.cleanupCallbacks, this.elements.refreshMetadataBtn, () => {
      runtimeConfig.closePanels();
      void this.actions.onRefreshMintMetadata();
    });
    bindButton(this.cleanupCallbacks, this.elements.historyBtn, () => {
      runtimeConfig.closePanels();
      void runtimeConfig.openHistory();
    });
    for (const fitButton of this.elements.fitBtns) {
      bindButton(this.cleanupCallbacks, fitButton, () => {
        this.actions.onFitToScreen();
      });
    }
    bindButton(this.cleanupCallbacks, this.elements.mobileZoomInBtn, () => {
      this.actions.onZoomIn();
    });
    bindButton(this.cleanupCallbacks, this.elements.mobileZoomOutBtn, () => {
      this.actions.onZoomOut();
    });
  }

  private applyBackgroundSelection(nextBackgroundId: string): void {
    if (!nextBackgroundId) {
      return;
    }
    if (nextBackgroundId === BACKGROUND_UPLOAD_SELECT_VALUE) {
      this.backgroundPhotoControlsMode = 'upload';
      this.openBackgroundUploadPicker();
      this.syncEditorChromeState();
      return;
    }
    if (nextBackgroundId === PHOTO_BACKGROUND_ID) {
      this.backgroundPhotoControlsMode = 'photo';
      this.openBackgroundPhotosModal();
      this.syncEditorChromeState();
      return;
    }
    const normalizedSelection =
      nextBackgroundId === SOLID_COLOR_BACKGROUND_ID
        ? SOLID_COLOR_BACKGROUND_ID
        : normalizeRoomBackground(nextBackgroundId);
    const currentSelection = getBackgroundSelectionValue(editorState.selectedBackground);
    const nextBackground =
      normalizedSelection === SOLID_COLOR_BACKGROUND_ID
        ? buildSolidColorBackgroundValue(editorState.selectedSolidBackgroundColor)
        : normalizedSelection;
    this.backgroundPhotoControlsMode = parseCustomBackground(nextBackground) ? 'photo' : null;
    if (
      currentSelection === normalizedSelection &&
      editorState.selectedBackground === nextBackground
    ) {
      this.syncEditorChromeState();
      return;
    }
    editorState.selectedBackground = nextBackground;
    this.actions.onSelectBackground(nextBackground);
    this.syncEditorChromeState();
    if (normalizedSelection !== SOLID_COLOR_BACKGROUND_ID) {
      this.requestPhoneEditorAutoCollapse();
    }
  }

  private openBackgroundUploadPicker(): void {
    if (this.backgroundUploadInFlight) {
      return;
    }
    this.backgroundPhotoControlsMode = 'upload';
    this.syncEditorChromeState();
    if (!this.backgroundUploadPolicy?.canUpload) {
      this.setBackgroundUploadStatus(
        this.backgroundUploadPolicy?.reason ?? 'Uploads are not available for this account.',
        Boolean(this.backgroundUploadPolicy?.authenticated),
      );
      return;
    }
    if (this.elements.backgroundUploadInput) {
      this.elements.backgroundUploadInput.value = '';
      this.elements.backgroundUploadInput.click();
    }
  }

  private async refreshBackgroundImages(): Promise<void> {
    const token = ++this.backgroundCatalogToken;
    try {
      const payload = await listBackgroundImages();
      if (this.destroyed || token !== this.backgroundCatalogToken) {
        return;
      }
      this.backgroundImages = payload.items;
      this.backgroundUploadPolicy = payload.uploadPolicy;
      this.renderBackgroundPhotoGrid();
      this.renderBackgroundUploadStatus(payload.uploadPolicy, payload.myUploads);
      this.syncEditorChromeState();
    } catch (error) {
      if (this.destroyed || token !== this.backgroundCatalogToken) {
        return;
      }
      this.setBackgroundUploadStatus(
        error instanceof Error ? error.message : 'Could not load uploaded backgrounds.',
        true,
      );
    }
  }

  private openBackgroundPhotosModal(): void {
    if (!this.elements.backgroundPhotosModal) {
      return;
    }
    this.backgroundPhotoControlsMode = 'photo';
    this.syncEditorChromeState();
    this.elements.backgroundPhotosModal.classList.remove('hidden');
    this.elements.backgroundPhotosModal.setAttribute('aria-hidden', 'false');
    this.renderBackgroundPhotoGrid();
  }

  private closeBackgroundPhotosModal(): void {
    if (!this.elements.backgroundPhotosModal) {
      return;
    }
    this.elements.backgroundPhotosModal.classList.add('hidden');
    this.elements.backgroundPhotosModal.setAttribute('aria-hidden', 'true');
  }

  private renderBackgroundPhotoGrid(): void {
    if (!this.elements.backgroundPhotosGrid) {
      return;
    }

    const currentPhoto = parseCustomBackground(editorState.selectedBackground);
    const images = this.getSortedBackgroundImages();
    this.elements.backgroundPhotosGrid.replaceChildren();
    setText(
      this.elements.backgroundPhotosStatus,
      images.length > 0
        ? `${images.length} approved ${images.length === 1 ? 'photo' : 'photos'}.`
        : 'No approved photos yet.',
    );

    for (const image of images) {
      const button = this.doc.createElement('button');
      button.type = 'button';
      button.className = 'background-photo-choice';
      const active = currentPhoto?.id === image.id;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');

      const preview = this.doc.createElement('span');
      preview.className = 'background-photo-choice-preview';
      if (image.thumbnailUrl) {
        preview.style.backgroundImage = `url('${image.thumbnailUrl}')`;
      }

      const name = this.doc.createElement('span');
      name.className = 'background-photo-choice-name';
      name.textContent = image.filename;

      const meta = this.doc.createElement('span');
      meta.className = 'background-photo-choice-meta';
      const usageCount = image.usageCount ?? 0;
      meta.textContent = `${usageCount} ${usageCount === 1 ? 'room' : 'rooms'} using this`;

      button.append(preview, name, meta);
      button.addEventListener('click', () => {
        const fit = parseCustomBackground(editorState.selectedBackground)?.fit ?? DEFAULT_CUSTOM_BACKGROUND_FIT;
        this.applyBackgroundSelection(buildCustomBackgroundValue(image.id, fit));
        this.closeBackgroundPhotosModal();
      });
      this.elements.backgroundPhotosGrid.appendChild(button);
    }
  }

  private getSortedBackgroundImages(): BackgroundImageSummary[] {
    const images = [...this.backgroundImages];
    const compareNewest = (left: BackgroundImageSummary, right: BackgroundImageSummary) =>
      Date.parse(right.createdAt) - Date.parse(left.createdAt);
    switch (this.backgroundPhotosSortMode) {
      case 'least_used':
        return images.sort((left, right) =>
          (left.usageCount ?? 0) - (right.usageCount ?? 0) || compareNewest(left, right)
        );
      case 'newest':
        return images.sort(compareNewest);
      case 'oldest':
        return images.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
      case 'most_used':
      default:
        return images.sort((left, right) =>
          (right.usageCount ?? 0) - (left.usageCount ?? 0) || compareNewest(left, right)
        );
    }
  }

  private getBackgroundPhotosSortMode(): BackgroundPhotosSort {
    const value = this.elements.backgroundPhotosSort?.value;
    return value === 'least_used' || value === 'newest' || value === 'oldest' || value === 'most_used'
      ? value
      : DEFAULT_BACKGROUND_PHOTOS_SORT;
  }

  private applyBackgroundPhotoFit(fit: CustomBackgroundFit): void {
    const currentPhoto = parseCustomBackground(editorState.selectedBackground);
    if (!currentPhoto) {
      return;
    }

    this.applyBackgroundSelection(buildCustomBackgroundValue(currentPhoto.id, fit));
  }

  private renderBackgroundUploadStatus(
    policy: BackgroundUploadPolicy,
    myUploads: BackgroundImageSummary[],
  ): void {
    const pendingCount = myUploads.filter((item) =>
      item.status === 'upload_pending' || item.status === 'pending_review'
    ).length;
    const rejectedCount = myUploads.filter((item) =>
      item.status === 'rejected' || item.status === 'blocked'
    ).length;
    const base = policy.canUpload
      ? `PNG, JPG, or WebP up to ${formatBytes(policy.maxBytes)}.`
      : policy.reason ?? 'Uploads are not available for this account.';
    const suffix = pendingCount > 0
      ? ` ${pendingCount} waiting for review.`
      : rejectedCount > 0
        ? ` ${rejectedCount} not approved.`
        : '';
    this.setBackgroundUploadStatus(`${base}${suffix}`, !policy.canUpload && policy.authenticated);
    setDisabled(this.elements.backgroundUploadButton, !policy.canUpload || this.backgroundUploadInFlight);
    setDisabled(this.elements.backgroundUploadCard, !policy.canUpload || this.backgroundUploadInFlight);
    setDisabled(this.elements.backgroundPhotosButton, this.backgroundUploadInFlight);
  }

  private async handleBackgroundUploadFileSelected(): Promise<void> {
    const file = this.elements.backgroundUploadInput?.files?.[0] ?? null;
    if (!file) {
      return;
    }

    const policy = this.backgroundUploadPolicy;
    if (policy && file.size > policy.maxBytes) {
      this.setBackgroundUploadStatus(`Image must be ${formatBytes(policy.maxBytes)} or smaller.`, true);
      return;
    }
    if (policy && !policy.allowedMimeTypes.includes(file.type)) {
      this.setBackgroundUploadStatus('Upload a PNG, JPG, or WebP image.', true);
      return;
    }

    this.backgroundUploadInFlight = true;
    setDisabled(this.elements.backgroundUploadButton, true);
    setDisabled(this.elements.backgroundUploadCard, true);
    setDisabled(this.elements.backgroundPhotosButton, true);
    this.setBackgroundUploadStatus('Uploading background...', false);
    this.showBackgroundUploadModal({
      title: 'Sending photo',
      meta: 'Preparing your image.',
      status: 'Starting upload...',
      progress: 12,
      done: false,
      error: false,
    });

    try {
      this.showBackgroundUploadModal({
        title: 'Sending photo',
        meta: 'Creating a safe upload slot.',
        status: 'Talking to Cloudflare Images...',
        progress: 24,
        done: false,
        error: false,
      });
      const prepared = await prepareBackgroundUpload({
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      this.showBackgroundUploadModal({
        title: 'Sending photo',
        meta: 'Uploading the image.',
        status: 'Keeping the original out of the game until review finishes.',
        progress: 68,
        done: false,
        error: false,
      });
      await uploadBackgroundFile(prepared.uploadUrl, file);
      this.showBackgroundUploadModal({
        title: 'Checking photo',
        meta: 'Running the first safety pass.',
        status: 'A human review is still required before players can use it.',
        progress: 88,
        done: false,
        error: false,
      });
      const finalized = await finalizeBackgroundUpload(prepared.id);
      await this.refreshBackgroundImages();
      this.setBackgroundUploadStatus(finalized.message, finalized.item.status === 'blocked');
      this.showBackgroundUploadModal({
        title: finalized.item.status === 'approved' ? 'Photo ready' : 'Photo sent',
        meta: finalized.item.status === 'approved'
          ? 'It is ready to use.'
          : 'Human thumbs-up needed. Rooms can use it after review.',
        status: finalized.message,
        progress: 100,
        done: true,
        error: finalized.item.status === 'blocked',
      });
      if (finalized.selectedBackgroundValue) {
        this.applyBackgroundSelection(finalized.selectedBackgroundValue);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Background upload failed.';
      this.setBackgroundUploadStatus(
        message,
        true,
      );
      this.showBackgroundUploadModal({
        title: 'Upload failed',
        meta: 'The photo did not make it through.',
        status: message,
        progress: 100,
        done: true,
        error: true,
      });
    } finally {
      this.backgroundUploadInFlight = false;
      if (this.backgroundUploadPolicy) {
        const disabled = !this.backgroundUploadPolicy.canUpload;
        setDisabled(this.elements.backgroundUploadButton, disabled);
        setDisabled(this.elements.backgroundUploadCard, disabled);
        setDisabled(this.elements.backgroundPhotosButton, false);
      }
    }
  }

  private setBackgroundUploadStatus(message: string, error: boolean): void {
    if (!this.elements.backgroundUploadStatus) {
      return;
    }
    this.elements.backgroundUploadStatus.textContent = message;
    this.elements.backgroundUploadStatus.classList.toggle('error', error);
  }

  private showBackgroundUploadModal(options: {
    title: string;
    meta: string;
    status: string;
    progress: number;
    done: boolean;
    error: boolean;
  }): void {
    if (!this.elements.backgroundUploadModal) {
      return;
    }

    this.elements.backgroundUploadModal.classList.remove('hidden');
    this.elements.backgroundUploadModal.setAttribute('aria-hidden', 'false');
    setText(this.elements.backgroundUploadModalTitle, options.title);
    setText(this.elements.backgroundUploadModalMeta, options.meta);
    setText(this.elements.backgroundUploadModalStatus, options.status);
    this.elements.backgroundUploadModalStatus?.classList.toggle('background-photo-modal-error', options.error);
    this.elements.backgroundUploadProgressBar?.style.setProperty(
      'width',
      `${Math.max(0, Math.min(100, Math.round(options.progress)))}%`,
    );
    setHidden(this.elements.backgroundUploadModalCloseButton, !options.done);
  }

  private closeBackgroundUploadModal(): void {
    if (!this.elements.backgroundUploadModal) {
      return;
    }
    this.elements.backgroundUploadModal.classList.add('hidden');
    this.elements.backgroundUploadModal.setAttribute('aria-hidden', 'true');
  }

  private applyLightingSelection(nextLightingMode: RoomLightingMode): void {
    if (!nextLightingMode || editorState.selectedLightingMode === nextLightingMode) {
      return;
    }
    editorState.selectedLightingMode = nextLightingMode;
    this.actions.onSelectLighting(nextLightingMode);
    this.syncEditorChromeState();
    this.requestPhoneEditorAutoCollapse();
  }

  private applyLightingDarkness(nextDarkness: number): void {
    if (editorState.selectedLightingDarkness === nextDarkness) {
      return;
    }
    editorState.selectedLightingDarkness = nextDarkness;
    this.actions.onSetLightingDarkness(nextDarkness);
    this.syncEditorChromeState();
  }

  private applyLightingRadius(nextRadius: number): void {
    if (editorState.selectedLightingRadius === nextRadius) {
      return;
    }
    editorState.selectedLightingRadius = nextRadius;
    this.actions.onSetLightingRadius(nextRadius);
    this.syncEditorChromeState();
  }

  private handleFeatureLauncher(feature: EditorFeatureLauncher): void {
    this.moreToolsOpen = false;

    if (feature === 'music' || feature === 'sprite') {
      this.activeFeatureLauncher = null;
      this.syncEditorChromeState();
      return;
    }

    const isTogglingOff = this.activeFeatureLauncher === feature;
    this.activeFeatureLauncher = isTogglingOff ? null : feature;
    this.syncEditorChromeState();
  }

  private getFeatureLauncherStatusText(): string {
    return '';
  }

  private usesDesktopFeaturePanels(): boolean {
    return this.doc.body.dataset.appMode === 'editor' && this.doc.body.dataset.deviceClass !== 'phone';
  }

  private requestPhoneEditorAutoCollapse(): void {
    this.windowObj.dispatchEvent(new Event('mobile-editor-auto-collapse'));
  }

  private syncEditorChromeState(): void {
    if (this.destroyed) {
      return;
    }

    for (const button of this.elements.toolButtons) {
      button.classList.toggle('active', button.dataset.tool === editorState.activeTool);
    }

    const musicModeActive = this.doc.body.dataset.editorMusicMode === 'true';
    const spriteModeActive = this.doc.body.dataset.editorSpriteMode === 'true';
    for (const button of this.elements.featureButtons) {
      const feature = getEditorFeatureLauncher(button.dataset.editorFeature);
      const active =
        feature === 'music'
          ? musicModeActive
          : feature === 'sprite'
            ? spriteModeActive
            : Boolean(feature && feature === this.activeFeatureLauncher);
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    const featureStatusText = this.getFeatureLauncherStatusText();
    setText(this.elements.featureStatus, featureStatusText);
    setHidden(this.elements.featureStatus, featureStatusText.length === 0);

    const useFeaturePanels = this.usesDesktopFeaturePanels();
    const courseGoalActive = Boolean(this.elements.courseRoot && !this.elements.courseRoot.classList.contains('hidden'));
    if (this.elements.goalRoot) {
      this.elements.goalRoot.classList.toggle(
        'hidden',
        useFeaturePanels ? this.activeFeatureLauncher !== 'goal' || courseGoalActive : false,
      );
    }
    setHidden(
      this.elements.lightingFeaturePanel,
      useFeaturePanels ? this.activeFeatureLauncher !== 'lighting' : true,
    );

    const showMoreTools =
      this.moreToolsOpen ||
      (editorState.paletteMode === 'tiles' &&
        (editorState.activeTool === 'rect' || editorState.activeTool === 'fill'));
    const moreToolsActive =
      showMoreTools || editorState.activeTool === 'rect' || editorState.activeTool === 'fill';
    for (const button of this.elements.moreToolsButtons) {
      button.classList.toggle('active', moreToolsActive);
    }
    for (const panel of this.elements.moreToolsPanels) {
      panel.classList.toggle('hidden', !showMoreTools);
      panel.dataset.open = showMoreTools ? 'true' : 'false';
    }

    const showEraseControls = editorState.activeTool === 'eraser';
    for (const controls of this.elements.eraseControls) {
      controls.classList.toggle('hidden', !showEraseControls);
    }
    setHidden(this.elements.tileEraseControls, editorState.paletteMode !== 'tiles');
    for (const input of this.elements.eraseBrushSelects) {
      if (input.value !== String(editorState.eraserBrushSize)) {
        input.value = String(editorState.eraserBrushSize);
      }
    }

    for (const button of this.elements.layerButtons) {
      button.classList.toggle('active', button.dataset.layer === editorState.activeLayer);
    }
    for (const button of this.elements.layerMiniButtons) {
      button.classList.toggle('active', button.dataset.layer === editorState.activeLayer);
    }
    if (this.elements.layerChip) {
      this.elements.layerChip.textContent = `Placing on ${getLayerUiLabel(editorState.activeLayer)}`;
      this.elements.layerChip.setAttribute('data-layer-tone', editorState.activeLayer);
    }
    if (this.elements.layerGuideButton) {
      this.elements.layerGuideButton.classList.toggle('active', editorState.showLayerGuides);
      this.elements.layerGuideButton.setAttribute(
        'aria-pressed',
        editorState.showLayerGuides ? 'true' : 'false'
      );
      this.elements.layerGuideButton.textContent = editorState.showLayerGuides
        ? 'Hide Layers'
        : 'See Layers';
    }

    setValue(this.elements.tilesetSelect, editorState.selectedTilesetKey);
    applyTilesetTheme(this.doc, editorState.selectedTilesetKey);
    if (this.elements.flipXButton) {
      this.elements.flipXButton.classList.toggle('active', editorState.tileFlipX);
      this.elements.flipXButton.setAttribute('aria-pressed', editorState.tileFlipX ? 'true' : 'false');
    }
    if (this.elements.flipYButton) {
      this.elements.flipYButton.classList.toggle('active', editorState.tileFlipY);
      this.elements.flipYButton.setAttribute('aria-pressed', editorState.tileFlipY ? 'true' : 'false');
    }

    for (const tab of this.elements.paletteTabs) {
      tab.classList.toggle('active', tab.dataset.mode === editorState.paletteMode);
    }
    const paletteModeIsTiles = editorState.paletteMode === 'tiles';
    this.elements.tilesetSection?.classList.toggle('hidden', !paletteModeIsTiles);
    this.elements.tilePaletteSection?.classList.toggle('hidden', !paletteModeIsTiles);
    this.elements.objectPaletteSection?.classList.toggle('hidden', paletteModeIsTiles);

    for (const tab of this.elements.objectCategoryTabs) {
      tab.classList.toggle('active', (tab.dataset.category || 'all') === this.currentObjectCategory);
    }

    const activeBackgroundId = getBackgroundSelectionValue(editorState.selectedBackground);
    const solidColor = getSolidColorFromBackgroundValue(
      editorState.selectedBackground,
      editorState.selectedSolidBackgroundColor,
    );
    const selectedPhoto = parseCustomBackground(editorState.selectedBackground);
    const backgroundSelectValue = selectedPhoto
      ? PHOTO_BACKGROUND_ID
      : this.backgroundPhotoControlsMode === 'photo'
        ? PHOTO_BACKGROUND_ID
        : this.backgroundPhotoControlsMode === 'upload'
          ? BACKGROUND_UPLOAD_SELECT_VALUE
          : activeBackgroundId;
    setValue(this.elements.backgroundSelect, backgroundSelectValue);
    setHidden(
      this.elements.backgroundSolidControls,
      backgroundSelectValue !== SOLID_COLOR_BACKGROUND_ID
    );
    const showPhotoControls = Boolean(selectedPhoto) || this.backgroundPhotoControlsMode !== null;
    setHidden(this.elements.backgroundUploadControls, !showPhotoControls);
    setHidden(this.elements.backgroundPhotoSelected, !showPhotoControls);
    setHidden(this.elements.backgroundPhotoFitControls, !selectedPhoto);
    const selectedPhotoSummary = selectedPhoto
      ? this.getBackgroundPhotoSummary(selectedPhoto.id)
      : 'No photo selected.';
    setText(this.elements.backgroundPhotoSelected, selectedPhotoSummary);
    for (const button of this.elements.backgroundPhotoFitButtons) {
      const active = Boolean(selectedPhoto && button.dataset.backgroundPhotoFit === selectedPhoto.fit);
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    setValue(this.elements.backgroundSolidColorInput, solidColor);
    setText(this.elements.backgroundSolidColorValue, solidColor.toUpperCase());
    if (this.elements.backgroundSolidCard) {
      this.elements.backgroundSolidCard.style.setProperty('--background-card-solid', solidColor);
    }
    setValue(this.elements.lightingSelect, editorState.selectedLightingMode);
    setHidden(
      this.elements.lightingTuningControls,
      editorState.selectedLightingMode !== 'playerAuraDark'
    );
    setValue(this.elements.lightingDarknessInput, String(editorState.selectedLightingDarkness));
    setValue(this.elements.lightingRadiusInput, String(editorState.selectedLightingRadius));
    setText(this.elements.lightingDarknessValue, `${editorState.selectedLightingDarkness}%`);
    setText(this.elements.lightingRadiusValue, `${editorState.selectedLightingRadius}%`);
    for (const button of this.elements.backgroundButtons) {
      const active = button.dataset.backgroundId === activeBackgroundId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  private getBackgroundPhotoSummary(id: string): string {
    const image = this.backgroundImages.find((item) => item.id === id);
    if (!image) {
      return 'Photo selected.';
    }
    const usageCount = image.usageCount ?? 0;
    return `${image.filename} - used in ${usageCount} ${usageCount === 1 ? 'room' : 'rooms'}`;
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 MB';
  }
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}
