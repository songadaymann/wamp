import {
  editorState,
  TILE_SIZE,
  type PaletteMode,
  type ToolName,
} from '../../config';
import {
  getSmartBrushDefinition,
  getSmartBrushesForTheme,
  listSmartThemeDefinitions,
  type SmartBrushDefinition,
  type SmartThemeId,
} from '../../autotiling/registry';
import type { SmartStyleId } from '../../autotiling/model';
import {
  EDITOR_SHELL_ESCAPE_REQUESTED_EVENT,
  EDITOR_SPAWN_PLACED_EVENT,
  EDITOR_UI_STATE_CHANGED_EVENT,
  type EditorShellEscapeRequestedDetail,
} from '../../scenes/editor/uiEvents';
import { EDITOR_SIDEBAR_RESIZED_EVENT } from './sidebarSections';
import { type EditorObjectScope, PaletteController } from './paletteController';
import {
  buildSmartPreviewTiles,
  SMART_PREVIEW_COLUMNS,
  SMART_PREVIEW_ROWS,
} from './editorSmartPreview';

export const EDITOR_DOCK_PANEL_IDS = [
  'terrain',
  'stuff',
  'characters',
  'hazards',
  'deco',
  'goal',
  'room',
] as const;

export type EditorDockPanelId = (typeof EDITOR_DOCK_PANEL_IDS)[number];
export type EditorDockId = Exclude<EditorDockPanelId, 'goal' | 'room'> | 'markers';
export type EditorRoomSection = 'background' | 'environment' | 'music' | 'sprite';
type EditorObjectPanelScope = Exclude<EditorObjectScope, 'all'>;

export interface EditorDockShellState {
  openPanel: EditorDockPanelId | null;
  activeDock: EditorDockId | null;
  roomSection: EditorRoomSection;
  markersOpen: boolean;
  shareOpen: boolean;
  spawnPlacementActive: boolean;
}

export type EditorDockShellAction =
  | { type: 'toggle-dock'; dock: EditorDockId }
  | { type: 'toggle-room' }
  | { type: 'open-goal' }
  | { type: 'close-drawer' }
  | { type: 'toggle-share' }
  | { type: 'close-popovers' }
  | { type: 'set-room-section'; section: EditorRoomSection }
  | { type: 'start-spawn' }
  | { type: 'finish-spawn' }
  | { type: 'deactivate' };

export const INITIAL_EDITOR_DOCK_SHELL_STATE: EditorDockShellState = {
  openPanel: null,
  activeDock: null,
  roomSection: 'background',
  markersOpen: false,
  shareOpen: false,
  spawnPlacementActive: false,
};

export function reduceEditorDockShellState(
  state: EditorDockShellState,
  action: EditorDockShellAction,
): EditorDockShellState {
  switch (action.type) {
    case 'toggle-dock': {
      if (action.dock === 'markers') {
        const markersOpen = state.activeDock === 'markers' ? !state.markersOpen : true;
        return {
          ...state,
          openPanel: null,
          activeDock: 'markers',
          markersOpen,
          shareOpen: false,
        };
      }
      return {
        ...state,
        openPanel: state.activeDock === action.dock && state.openPanel === action.dock
          ? null
          : action.dock,
        activeDock: action.dock,
        markersOpen: false,
        shareOpen: false,
      };
    }
    case 'toggle-room':
      return {
        ...state,
        openPanel: state.openPanel === 'room' ? null : 'room',
        activeDock: null,
        markersOpen: false,
      };
    case 'open-goal':
      return {
        ...state,
        openPanel: 'goal',
        activeDock: 'markers',
        markersOpen: false,
        shareOpen: false,
      };
    case 'close-drawer':
      return { ...state, openPanel: null };
    case 'toggle-share':
      return { ...state, shareOpen: !state.shareOpen, markersOpen: false };
    case 'close-popovers':
      return { ...state, markersOpen: false, shareOpen: false };
    case 'set-room-section':
      return { ...state, roomSection: action.section };
    case 'start-spawn':
      return {
        ...state,
        openPanel: null,
        activeDock: 'markers',
        markersOpen: false,
        shareOpen: false,
        spawnPlacementActive: true,
      };
    case 'finish-spawn':
      return { ...state, spawnPlacementActive: false };
    case 'deactivate':
      return {
        ...state,
        openPanel: null,
        markersOpen: false,
        shareOpen: false,
        spawnPlacementActive: false,
      };
  }
}

export function shouldSuppressEditorShellStatus(text: string): boolean {
  return /^Claimed by .+\.$/i.test(text.trim());
}

interface ObjectPanelMemory {
  category: string;
  search: string;
  scrollTop: number;
}

interface SpawnPlacementRestoreState {
  paletteMode: PaletteMode;
  selectedObjectId: string | null;
  activeTool: ToolName;
}

const OBJECT_PANEL_DEFAULTS: Readonly<Record<EditorObjectScope, ObjectPanelMemory>> = {
  all: { category: 'all', search: '', scrollTop: 0 },
  stuff: { category: 'interactive', search: '', scrollTop: 0 },
  characters: { category: 'enemy', search: '', scrollTop: 0 },
  hazards: { category: 'hazard', search: '', scrollTop: 0 },
  deco: { category: 'decoration', search: '', scrollTop: 0 },
};

const PANEL_TITLES: Readonly<Record<EditorDockPanelId, string>> = {
  terrain: 'Terrain',
  stuff: 'Stuff',
  characters: 'Characters',
  hazards: 'Hazards',
  deco: 'Deco',
  goal: 'Goal',
  room: 'Room',
};

const GOAL_INSTRUCTIONS: Readonly<Record<string, string>> = {
  '': 'Remove the current goal. Players can still explore the room freely.',
  reach_exit: 'Place an exit and challenge players to reach it.',
  collect_target: 'Choose how many collectibles a player must gather before the goal completes.',
  collect_race: 'Set a collectible target and optional time limit for a fastest-time challenge.',
  defeat_all: 'The room completes after every goal-counting enemy is defeated.',
  checkpoint_sprint: 'Place a start, ordered checkpoints, and a finish for a timed route.',
  survival: 'Choose how long the player must survive.',
  npc_quest: 'Choose Protect, Escort, or Give, then link the NPC and any required destination.',
};

function cloneObjectMemory(memory: ObjectPanelMemory): ObjectPanelMemory {
  return { ...memory };
}

function isObjectPanel(panel: EditorDockPanelId | null): panel is EditorObjectPanelScope {
  return panel === 'stuff' || panel === 'characters' || panel === 'hazards' || panel === 'deco';
}

function isStandardEditorShellActive(doc: Document): boolean {
  return doc.body.dataset.appMode === 'editor'
    && doc.body.dataset.deviceClass !== 'phone'
    && doc.body.dataset.editorCourseMode !== 'true';
}

function dispatchSelectChange(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

export class EditorDockShellController {
  private state: EditorDockShellState = { ...INITIAL_EDITOR_DOCK_SHELL_STATE };
  private active = false;
  private lastDrawerTrigger: HTMLElement | null = null;
  private lastPopoverTrigger: HTMLElement | null = null;
  private lastStandardTheme: Exclude<SmartThemeId, 'water'> = 'forest';
  private terrainPaletteMode: Exclude<PaletteMode, 'objects'> = 'smart';
  private spawnRestoreState: SpawnPlacementRestoreState | null = null;
  private readonly objectPanelMemory = new Map<EditorObjectPanelScope, ObjectPanelMemory>(
    (['stuff', 'characters', 'hazards', 'deco'] as const).map((scope) => [
      scope,
      cloneObjectMemory(OBJECT_PANEL_DEFAULTS[scope]),
    ]),
  );
  private readonly previewImages = new Map<string, Promise<HTMLImageElement>>();

  constructor(
    private readonly paletteController: PaletteController,
    private readonly doc: Document = document,
  ) {}

  init(): void {
    this.bindDockButtons();
    this.bindTopActions();
    this.bindDrawerControls();
    this.bindChoiceButtons();
    this.bindObjectMemory();
    this.bindGlobalEvents();
    this.syncActivation();
    this.renderSmartPicker();
    this.syncChoiceButtons();
    this.syncProxyActions();
  }

  private dispatch(action: EditorDockShellAction, trigger?: HTMLElement | null): void {
    const previous = this.state;
    if (isObjectPanel(previous.openPanel)) {
      this.rememberObjectPanel(previous.openPanel);
    }
    if (previous.openPanel === 'terrain' && editorState.paletteMode !== 'objects') {
      this.terrainPaletteMode = editorState.paletteMode;
    }

    this.state = reduceEditorDockShellState(previous, action);
    const drawerChanged = previous.openPanel !== this.state.openPanel;
    const popoverChanged = previous.markersOpen !== this.state.markersOpen
      || previous.shareOpen !== this.state.shareOpen;

    if (drawerChanged && this.state.openPanel) {
      this.lastDrawerTrigger = trigger ?? this.lastDrawerTrigger;
      this.preparePanel(this.state.openPanel);
    }
    if (popoverChanged && (this.state.markersOpen || this.state.shareOpen)) {
      this.lastPopoverTrigger = trigger ?? this.lastPopoverTrigger;
    }

    this.syncDom();
    if (drawerChanged) {
      this.queueLayoutResize();
      if (this.state.openPanel) {
        this.focusDrawer();
      } else {
        this.lastDrawerTrigger?.focus({ preventScroll: true });
      }
    }
    if (popoverChanged && (this.state.markersOpen || this.state.shareOpen)) {
      this.focusOpenPopover();
    }
  }

  private bindDockButtons(): void {
    for (const button of this.doc.querySelectorAll<HTMLButtonElement>('[data-editor-dock]')) {
      button.addEventListener('click', () => {
        const dock = button.dataset.editorDock as EditorDockId | undefined;
        if (!dock || !this.active) return;
        this.dispatch({ type: 'toggle-dock', dock }, button);
      });
    }
  }

  private bindTopActions(): void {
    for (const button of this.doc.querySelectorAll<HTMLButtonElement>('[data-editor-shell-action]')) {
      button.addEventListener('click', () => {
        if (!this.active) return;
        switch (button.dataset.editorShellAction) {
          case 'back':
            this.clickExistingButton('btn-editor-back');
            break;
          case 'room':
            this.dispatch({ type: 'toggle-room' }, button);
            break;
          case 'share':
            this.dispatch({ type: 'toggle-share' }, button);
            break;
          case 'test':
            this.clickExistingButton('btn-test-play');
            break;
          case 'publish':
            this.clickExistingButton('btn-publish-room');
            break;
        }
      });
    }

    for (const button of this.doc.querySelectorAll<HTMLButtonElement>('[data-editor-share-action]')) {
      button.addEventListener('click', () => {
        if (!this.active) return;
        switch (button.dataset.editorShareAction) {
          case 'wampogram':
            this.clickExistingButton('btn-wamp-o-gram');
            this.dispatch({ type: 'close-popovers' });
            break;
          case 'copy':
            void this.copyRoomLink();
            break;
          case 'collect':
            this.getCollectActionTarget()?.click();
            this.dispatch({ type: 'close-popovers' });
            break;
          case 'history':
            this.clickExistingButton('btn-room-history');
            this.dispatch({ type: 'close-popovers' });
            break;
        }
      });
    }
  }

  private bindDrawerControls(): void {
    this.doc.getElementById('btn-editor-drawer-close')?.addEventListener('click', () => {
      this.dispatch({ type: 'close-drawer' }, null);
    });
    this.doc.getElementById('btn-editor-markers-close')?.addEventListener('click', () => {
      this.dispatch({ type: 'close-popovers' });
      this.lastPopoverTrigger?.focus({ preventScroll: true });
    });

    for (const button of this.doc.querySelectorAll<HTMLButtonElement>('[data-editor-room-section]')) {
      button.addEventListener('click', () => {
        const section = button.dataset.editorRoomSection as EditorRoomSection | undefined;
        if (!section || !this.active) return;
        if (section === 'music') {
          this.dispatch({ type: 'set-room-section', section });
          this.clickExistingButton('btn-editor-music-mode');
          return;
        }
        if (section === 'sprite') {
          this.dispatch({ type: 'set-room-section', section });
          this.clickExistingButton('btn-editor-sprite-mode');
          return;
        }
        this.dispatch({ type: 'set-room-section', section });
        this.prepareRoomSection(section);
        this.syncDom();
        this.queueLayoutResize();
      });
    }

    this.doc.getElementById('btn-editor-music-close')?.addEventListener('click', () => {
      if (!this.active) return;
      this.clickExistingButton('btn-editor-music-mode');
    });

    for (const button of this.doc.querySelectorAll<HTMLButtonElement>('[data-editor-marker-action]')) {
      button.addEventListener('click', () => {
        if (!this.active) return;
        if (button.dataset.editorMarkerAction === 'spawn') {
          this.beginSpawnPlacement();
          return;
        }
        this.dispatch({ type: 'open-goal' }, button);
      });
    }
  }

  private bindChoiceButtons(): void {
    const bindSelectButtons = (selector: string, selectId: string, dataKey: string) => {
      for (const button of this.doc.querySelectorAll<HTMLButtonElement>(selector)) {
        button.addEventListener('click', () => {
          const select = this.doc.getElementById(selectId) as HTMLSelectElement | null;
          const value = button.dataset[dataKey];
          if (!select || value === undefined) return;
          dispatchSelectChange(select, value);
          this.syncChoiceButtons();
        });
      }
    };

    bindSelectButtons('[data-goal-type-value]', 'goal-type-select', 'goalTypeValue');
    bindSelectButtons('[data-lighting-mode-value]', 'lighting-mode-select', 'lightingModeValue');
    bindSelectButtons('[data-weather-mode-value]', 'weather-mode-select', 'weatherModeValue');
  }

  private bindObjectMemory(): void {
    const search = this.doc.getElementById('object-search-input') as HTMLInputElement | null;
    search?.addEventListener('input', () => {
      if (!isObjectPanel(this.state.openPanel)) return;
      const memory = this.getObjectMemory(this.state.openPanel);
      memory.search = search.value;
    });
    this.doc.getElementById('object-grid')?.addEventListener('scroll', (event) => {
      if (!isObjectPanel(this.state.openPanel)) return;
      this.getObjectMemory(this.state.openPanel).scrollTop = (event.currentTarget as HTMLElement).scrollTop;
    });
    for (const button of this.doc.querySelectorAll<HTMLButtonElement>('.obj-cat-tab')) {
      button.addEventListener('click', () => {
        if (!isObjectPanel(this.state.openPanel)) return;
        this.getObjectMemory(this.state.openPanel).category = button.dataset.category ?? 'all';
      });
    }
  }

  private bindGlobalEvents(): void {
    const win = this.doc.defaultView;
    if (!win) return;

    const modeObserver = new win.MutationObserver(() => {
      this.syncActivation();
      this.syncProxyActions();
    });
    modeObserver.observe(this.doc.body, {
      attributes: true,
      attributeFilter: [
        'data-app-mode',
        'data-device-class',
        'data-editor-course-mode',
        'data-editor-music-mode',
        'data-editor-sprite-mode',
      ],
    });

    const saveStatus = this.doc.getElementById('editor-top-save-status');
    if (saveStatus) {
      new win.MutationObserver(() => this.syncRoutineStatusVisibility()).observe(saveStatus, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    win.addEventListener(EDITOR_UI_STATE_CHANGED_EVENT, () => {
      if (editorState.smartTheme !== 'water') {
        this.lastStandardTheme = editorState.smartTheme;
      }
      this.renderSmartPicker();
      this.syncChoiceButtons();
      this.syncProxyActions();
    });
    win.addEventListener(EDITOR_SPAWN_PLACED_EVENT, () => {
      if (this.state.spawnPlacementActive) this.finishSpawnPlacement(false);
    });
    win.addEventListener(EDITOR_SHELL_ESCAPE_REQUESTED_EVENT, (event) => {
      const detail = (event as CustomEvent<EditorShellEscapeRequestedDetail>).detail;
      if (!this.active || detail.handled) return;
      if (this.state.spawnPlacementActive) {
        this.finishSpawnPlacement(true);
        detail.handled = true;
        return;
      }
      if (this.state.markersOpen || this.state.shareOpen) {
        this.dispatch({ type: 'close-popovers' });
        this.lastPopoverTrigger?.focus({ preventScroll: true });
        detail.handled = true;
        return;
      }
      if (this.state.openPanel) {
        this.dispatch({ type: 'close-drawer' }, null);
        detail.handled = true;
      }
    });

    this.doc.addEventListener('pointerdown', (event) => {
      if (!this.active || (!this.state.markersOpen && !this.state.shareOpen)) return;
      const target = event.target as Node | null;
      const markers = this.doc.getElementById('editor-markers-popover');
      const share = this.doc.getElementById('editor-share-popover');
      const markersTrigger = this.doc.querySelector('[data-editor-dock="markers"]');
      const shareTrigger = this.doc.querySelector('[data-editor-shell-action="share"]');
      if (
        target
        && !markers?.contains(target)
        && !share?.contains(target)
        && !markersTrigger?.contains(target)
        && !shareTrigger?.contains(target)
      ) {
        this.dispatch({ type: 'close-popovers' });
      }
    });

    for (const targetId of [
      'btn-editor-back',
      'btn-test-play',
      'btn-publish-room',
      'btn-mint-room',
      'btn-refresh-room-metadata',
    ]) {
      const target = this.doc.getElementById(targetId);
      if (target) {
        new win.MutationObserver(() => this.syncProxyActions()).observe(target, {
          attributes: true,
          attributeFilter: ['class', 'disabled', 'aria-disabled'],
        });
      }
    }
  }

  private syncActivation(): void {
    const shouldBeActive = isStandardEditorShellActive(this.doc);
    if (shouldBeActive === this.active) return;
    this.active = shouldBeActive;
    if (this.active) {
      this.doc.body.dataset.editorDockShell = 'true';
      this.moveEditorChromeIntoShell();
      this.syncDom();
      this.queueLayoutResize();
      return;
    }

    if (this.state.spawnPlacementActive) this.finishSpawnPlacement(true);
    this.state = reduceEditorDockShellState(this.state, { type: 'deactivate' });
    this.paletteController.setObjectScope('all');
    this.restoreEditorChromeToGameContainer();
    delete this.doc.body.dataset.editorDockShell;
    delete this.doc.body.dataset.editorDrawerOpen;
    delete this.doc.body.dataset.editorShellPanel;
    delete this.doc.body.dataset.editorRoomSection;
    delete this.doc.body.dataset.editorSpawnPlacement;
    this.queueLayoutResize();
  }

  private moveEditorChromeIntoShell(): void {
    const title = this.doc.getElementById('room-title-section');
    const titleSlot = this.doc.getElementById('editor-shell-title-slot');
    const feedback = this.doc.getElementById('editor-room-feedback');
    const statusSlot = this.doc.getElementById('editor-shell-status-slot');
    if (title && titleSlot) titleSlot.append(title);
    if (feedback && statusSlot) statusSlot.append(feedback);
  }

  private restoreEditorChromeToGameContainer(): void {
    const gameContainer = this.doc.getElementById('game-container');
    const title = this.doc.getElementById('room-title-section');
    const feedback = this.doc.getElementById('editor-room-feedback');
    if (!gameContainer) return;
    if (feedback) gameContainer.prepend(feedback);
    if (title) gameContainer.prepend(title);
  }

  private syncDom(): void {
    if (!this.active) return;
    const drawerOpen = this.state.openPanel !== null;
    this.doc.body.dataset.editorDrawerOpen = drawerOpen ? 'true' : 'false';
    this.doc.body.dataset.editorShellPanel = this.state.openPanel ?? 'none';
    this.doc.body.dataset.editorRoomSection = this.state.roomSection;
    this.doc.body.dataset.editorSpawnPlacement = this.state.spawnPlacementActive ? 'true' : 'false';

    const sidebar = this.doc.getElementById('sidebar');
    sidebar?.setAttribute('aria-hidden', drawerOpen ? 'false' : 'true');
    const drawerHeader = this.doc.getElementById('editor-drawer-header');
    drawerHeader?.setAttribute('aria-hidden', drawerOpen ? 'false' : 'true');
    const drawerTitle = this.doc.getElementById('editor-drawer-title');
    if (drawerTitle && this.state.openPanel) drawerTitle.textContent = PANEL_TITLES[this.state.openPanel];

    for (const button of this.doc.querySelectorAll<HTMLButtonElement>('[data-editor-dock]')) {
      const dock = button.dataset.editorDock as EditorDockId;
      const selected = this.state.activeDock === dock;
      const expanded = dock === 'markers'
        ? this.state.markersOpen
        : this.state.openPanel === dock;
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }

    const roomButton = this.doc.querySelector<HTMLButtonElement>('[data-editor-shell-action="room"]');
    roomButton?.setAttribute('aria-pressed', this.state.openPanel === 'room' ? 'true' : 'false');
    roomButton?.setAttribute('aria-expanded', this.state.openPanel === 'room' ? 'true' : 'false');
    const shareButton = this.doc.querySelector<HTMLButtonElement>('[data-editor-shell-action="share"]');
    shareButton?.setAttribute('aria-pressed', this.state.shareOpen ? 'true' : 'false');
    shareButton?.setAttribute('aria-expanded', this.state.shareOpen ? 'true' : 'false');

    this.syncPopover('editor-markers-popover', this.state.markersOpen);
    this.syncPopover('editor-share-popover', this.state.shareOpen);
    for (const button of this.doc.querySelectorAll<HTMLButtonElement>('[data-editor-room-section]')) {
      const active = button.dataset.editorRoomSection === this.state.roomSection;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    this.syncChoiceButtons();
    this.syncRoutineStatusVisibility();
  }

  private syncRoutineStatusVisibility(): void {
    const status = this.doc.getElementById('editor-top-save-status');
    if (!status) return;
    status.classList.toggle(
      'editor-shell-status-suppressed',
      this.active && shouldSuppressEditorShellStatus(status.textContent ?? ''),
    );
  }

  private syncPopover(id: string, open: boolean): void {
    const popover = this.doc.getElementById(id);
    popover?.classList.toggle('hidden', !open);
    popover?.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  private preparePanel(panel: EditorDockPanelId): void {
    if (panel === 'terrain') {
      this.paletteController.setObjectScope('all');
      this.ensurePaletteMode(this.terrainPaletteMode);
      return;
    }
    if (isObjectPanel(panel)) {
      this.activateObjectPanel(panel);
      return;
    }
    this.paletteController.setObjectScope('all');
    if (panel === 'goal') {
      this.ensureFeaturePanel('goal');
      return;
    }
    this.prepareRoomSection(this.state.roomSection);
  }

  private prepareRoomSection(section: EditorRoomSection): void {
    if (section === 'environment') this.ensureFeaturePanel('lighting');
  }

  private ensureFeaturePanel(feature: 'goal' | 'lighting'): void {
    const button = this.doc.querySelector<HTMLButtonElement>(`[data-editor-feature="${feature}"]`);
    if (button?.getAttribute('aria-pressed') !== 'true') button?.click();
  }

  private ensurePaletteMode(mode: Exclude<PaletteMode, 'objects'> | 'objects'): void {
    if (editorState.paletteMode === mode) return;
    this.doc.querySelector<HTMLButtonElement>(`.palette-tab[data-mode="${mode}"]`)?.click();
  }

  private activateObjectPanel(panel: EditorObjectPanelScope): void {
    this.paletteController.setObjectScope(panel);
    this.ensurePaletteMode('objects');
    const memory = this.getObjectMemory(panel);
    const categoryButton = this.doc.querySelector<HTMLButtonElement>(`.obj-cat-tab[data-category="${memory.category}"]`);
    categoryButton?.click();
    const search = this.doc.getElementById('object-search-input') as HTMLInputElement | null;
    if (search && search.value !== memory.search) {
      search.value = memory.search;
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }
    this.doc.defaultView?.requestAnimationFrame(() => {
      const grid = this.doc.getElementById('object-grid');
      if (grid) grid.scrollTop = memory.scrollTop;
    });
  }

  private rememberObjectPanel(panel: EditorObjectPanelScope): void {
    const memory = this.getObjectMemory(panel);
    const activeCategory = this.doc.querySelector<HTMLButtonElement>('.obj-cat-tab.active')?.dataset.category;
    if (activeCategory) memory.category = activeCategory;
    const search = this.doc.getElementById('object-search-input') as HTMLInputElement | null;
    if (search) memory.search = search.value;
    const grid = this.doc.getElementById('object-grid');
    if (grid) memory.scrollTop = grid.scrollTop;
  }

  private getObjectMemory(panel: EditorObjectPanelScope): ObjectPanelMemory {
    const existing = this.objectPanelMemory.get(panel);
    if (existing) return existing;
    const created = cloneObjectMemory(OBJECT_PANEL_DEFAULTS[panel]);
    this.objectPanelMemory.set(panel, created);
    return created;
  }

  private beginSpawnPlacement(): void {
    if (!this.spawnRestoreState) {
      this.spawnRestoreState = {
        paletteMode: editorState.paletteMode,
        selectedObjectId: editorState.selectedObjectId,
        activeTool: editorState.activeTool,
      };
    }
    this.state = reduceEditorDockShellState(this.state, { type: 'start-spawn' });
    editorState.paletteMode = 'objects';
    editorState.selectedObjectId = 'spawn_point';
    editorState.activeTool = 'pencil';
    const instructions = this.doc.getElementById('editor-marker-instructions');
    if (instructions) instructions.textContent = 'Click the room to place the spawn point. Press Escape to cancel.';
    this.syncDom();
    this.doc.defaultView?.dispatchEvent(new Event(EDITOR_UI_STATE_CHANGED_EVENT));
    this.focusGameCanvas();
  }

  private finishSpawnPlacement(cancelled: boolean): void {
    const restore = this.spawnRestoreState;
    this.spawnRestoreState = null;
    if (restore) {
      editorState.paletteMode = restore.paletteMode;
      editorState.selectedObjectId = restore.selectedObjectId;
      editorState.activeTool = restore.activeTool;
    }
    this.state = reduceEditorDockShellState(this.state, { type: 'finish-spawn' });
    const instructions = this.doc.getElementById('editor-marker-instructions');
    if (instructions) {
      instructions.textContent = cancelled
        ? 'Spawn placement cancelled.'
        : 'Spawn placed. Your previous tool is active again.';
    }
    this.syncDom();
    this.doc.defaultView?.dispatchEvent(new Event(EDITOR_UI_STATE_CHANGED_EVENT));
  }

  private focusGameCanvas(): void {
    let best: HTMLCanvasElement | null = null;
    let area = 0;
    for (const canvas of this.doc.querySelectorAll<HTMLCanvasElement>('#game-container canvas')) {
      const nextArea = (canvas.clientWidth || canvas.width) * (canvas.clientHeight || canvas.height);
      if (nextArea > area) {
        best = canvas;
        area = nextArea;
      }
    }
    best?.focus({ preventScroll: true });
  }

  private focusDrawer(): void {
    this.doc.defaultView?.requestAnimationFrame(() => {
      this.doc.getElementById('btn-editor-drawer-close')?.focus({ preventScroll: true });
    });
  }

  private focusOpenPopover(): void {
    this.doc.defaultView?.requestAnimationFrame(() => {
      const popover = this.state.markersOpen
        ? this.doc.getElementById('editor-markers-popover')
        : this.doc.getElementById('editor-share-popover');
      popover?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    });
  }

  private queueLayoutResize(): void {
    const win = this.doc.defaultView;
    if (!win) return;
    win.requestAnimationFrame(() => {
      win.dispatchEvent(new Event(EDITOR_SIDEBAR_RESIZED_EVENT));
      win.dispatchEvent(new Event('resize'));
    });
  }

  private clickExistingButton(id: string): void {
    const target = this.doc.getElementById(id) as HTMLButtonElement | null;
    if (!target || target.disabled) return;
    target.click();
  }

  private syncProxyActions(): void {
    const proxyTargets: ReadonlyArray<[string, string]> = [
      ['back', 'btn-editor-back'],
      ['test', 'btn-test-play'],
      ['publish', 'btn-publish-room'],
    ];
    for (const [action, targetId] of proxyTargets) {
      const proxy = this.doc.querySelector<HTMLButtonElement>(`[data-editor-shell-action="${action}"]`);
      const target = this.doc.getElementById(targetId) as HTMLButtonElement | null;
      if (proxy) proxy.disabled = !target || target.disabled;
    }
    const collect = this.doc.querySelector<HTMLButtonElement>('[data-editor-share-action="collect"]');
    const collectTarget = this.getCollectActionTarget();
    if (collect) {
      collect.disabled = !collectTarget || collectTarget.disabled;
      collect.textContent = collectTarget?.id === 'btn-refresh-room-metadata'
        ? 'Refresh Room Metadata'
        : 'Collect Room';
    }
  }

  private getCollectActionTarget(): HTMLButtonElement | null {
    const refresh = this.doc.getElementById('btn-refresh-room-metadata') as HTMLButtonElement | null;
    if (refresh && !refresh.classList.contains('hidden')) return refresh;
    const mint = this.doc.getElementById('btn-mint-room') as HTMLButtonElement | null;
    return mint && !mint.classList.contains('hidden') ? mint : null;
  }

  private async copyRoomLink(): Promise<void> {
    const status = this.doc.getElementById('editor-share-status');
    const href = this.doc.defaultView?.location.href ?? '';
    try {
      const clipboard = this.doc.defaultView?.navigator.clipboard;
      if (clipboard?.writeText) {
        await clipboard.writeText(href);
      } else {
        const input = this.doc.createElement('textarea');
        input.value = href;
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        this.doc.body.append(input);
        input.select();
        this.doc.execCommand('copy');
        input.remove();
      }
      if (status) status.textContent = 'Room link copied.';
    } catch {
      if (status) status.textContent = 'Could not copy automatically. Use the address bar.';
    }
  }

  private syncChoiceButtons(): void {
    const sync = (selector: string, value: string, dataKey: string) => {
      for (const button of this.doc.querySelectorAll<HTMLButtonElement>(selector)) {
        const active = button.dataset[dataKey] === value;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      }
    };
    const goalSelect = this.doc.getElementById('goal-type-select') as HTMLSelectElement | null;
    const lightingSelect = this.doc.getElementById('lighting-mode-select') as HTMLSelectElement | null;
    const weatherSelect = this.doc.getElementById('weather-mode-select') as HTMLSelectElement | null;
    sync('[data-goal-type-value]', goalSelect?.value ?? '', 'goalTypeValue');
    sync('[data-lighting-mode-value]', lightingSelect?.value ?? 'off', 'lightingModeValue');
    sync('[data-weather-mode-value]', weatherSelect?.value ?? 'off', 'weatherModeValue');
    const instructions = this.doc.getElementById('goal-type-instructions');
    if (instructions) instructions.textContent = GOAL_INSTRUCTIONS[goalSelect?.value ?? ''] ?? GOAL_INSTRUCTIONS[''];
  }

  private renderSmartPicker(): void {
    const themeGrid = this.doc.getElementById('smart-theme-button-grid');
    const brushGrid = this.doc.getElementById('smart-brush-button-grid');
    if (!themeGrid || !brushGrid) return;

    const selectedTheme = editorState.smartTheme === 'water'
      ? this.lastStandardTheme
      : editorState.smartTheme;
    themeGrid.replaceChildren();
    for (const theme of listSmartThemeDefinitions().filter((candidate) => candidate.id !== 'water')) {
      const button = this.createSmartButton(theme.label, theme.defaultBrushId, theme.defaultStyleId);
      button.dataset.smartThemeId = theme.id;
      const active = theme.id === selectedTheme;
      button.classList.add('smart-theme-button');
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.addEventListener('click', () => {
        const select = this.doc.getElementById('smart-theme-select') as HTMLSelectElement | null;
        if (select) {
          dispatchSelectChange(select, theme.id);
          this.renderSmartPicker();
        }
      });
      themeGrid.append(button);
    }

    const brushes = [
      ...getSmartBrushesForTheme(selectedTheme),
      getSmartBrushDefinition('water.tunnel'),
    ];
    brushGrid.replaceChildren();
    for (const brush of brushes) {
      const selectedStyle = brush.supportedStyleIds.includes(editorState.smartStyle)
        ? editorState.smartStyle
        : brush.supportedStyleIds[0];
      const label = brush.id === 'water.tunnel' ? 'Tunnel Backdrop' : brush.label;
      const button = this.createSmartButton(label, brush.id, selectedStyle);
      button.dataset.smartBrushId = brush.id;
      const active = brush.id === editorState.smartMaterial;
      button.classList.add('smart-brush-button');
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.title = brush.description;
      button.addEventListener('click', () => {
        const select = this.doc.getElementById('smart-material-select') as HTMLSelectElement | null;
        if (select) {
          dispatchSelectChange(select, brush.id);
          this.renderSmartPicker();
        }
      });
      brushGrid.append(button);
    }
  }

  private createSmartButton(label: string, brushId: SmartBrushDefinition['id'], styleId: SmartStyleId): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.type = 'button';
    const canvas = this.doc.createElement('canvas');
    canvas.className = 'smart-preview-canvas';
    canvas.width = 160;
    canvas.height = 96;
    canvas.setAttribute('aria-hidden', 'true');
    const labelElement = this.doc.createElement('span');
    labelElement.textContent = label;
    button.append(canvas, labelElement);
    void this.drawSmartPreview(canvas, getSmartBrushDefinition(brushId), styleId);
    return button;
  }

  private async drawSmartPreview(
    canvas: HTMLCanvasElement,
    brush: SmartBrushDefinition,
    requestedStyleId: SmartStyleId,
  ): Promise<void> {
    const styleId = brush.supportedStyleIds.includes(requestedStyleId)
      ? requestedStyleId
      : brush.supportedStyleIds[0];
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.fillStyle = '#18161c';
    context.fillRect(0, 0, canvas.width, canvas.height);
    try {
      const cellWidth = canvas.width / SMART_PREVIEW_COLUMNS;
      const cellHeight = canvas.height / SMART_PREVIEW_ROWS;
      for (const tile of buildSmartPreviewTiles(brush.id, styleId)) {
        const image = await this.loadPreviewImage(tile.path);
        if (!canvas.isConnected) return;
        context.save();
        context.translate(
          tile.x * cellWidth + (tile.flipX ? cellWidth : 0),
          tile.y * cellHeight + (tile.flipY ? cellHeight : 0),
        );
        context.scale(tile.flipX ? -1 : 1, tile.flipY ? -1 : 1);
        context.drawImage(
          image,
          tile.sourceX,
          tile.sourceY,
          TILE_SIZE,
          TILE_SIZE,
          0,
          0,
          cellWidth,
          cellHeight,
        );
        context.restore();
      }
    } catch {
      context.fillStyle = '#79ccde';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  private loadPreviewImage(path: string): Promise<HTMLImageElement> {
    const existing = this.previewImages.get(path);
    if (existing) return existing;
    const created = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load ${path}`));
      image.src = path;
    });
    this.previewImages.set(path, created);
    return created;
  }
}

export function setupEditorDockShell(
  paletteController: PaletteController,
  doc: Document = document,
): EditorDockShellController {
  const controller = new EditorDockShellController(paletteController, doc);
  controller.init();
  return controller;
}
