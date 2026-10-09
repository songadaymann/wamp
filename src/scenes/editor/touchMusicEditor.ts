import {
  ROOM_PATTERN_DRUM_ROWS,
  ROOM_PATTERN_GRID_ROWS,
  getPatternInstrumentColorCss,
  getPatternInstrumentLabel,
  getPatternRowLabel,
  getRoomMusicKey,
} from '../../music/model';
import { ROOM_PATTERN_ACTIVE_STEP_COLUMNS } from '../../music/pattern';
import type { EditorMusicPatternController } from './musicPatternEditor';
import type { RoomMusicPlayheadInfo } from '../../music/controller';
import { resolveMusicPlayheadStep } from './musicPlayhead';
import { DEVICE_LAYOUT_CHANGED_EVENT } from '../../ui/deviceLayout';
import {
  TouchMusicGesture,
  TOUCH_MUSIC_MIN_CELL_SIZE,
  TOUCH_MUSIC_LABEL_WIDTH,
  TOUCH_MUSIC_HEADER_HEIGHT,
  planTouchMusicZoom,
  type MusicCell,
  type MusicTouchPoint,
  type TouchMusicTool,
} from './touchMusicGesture';

interface TouchMusicEditorState {
  active: boolean;
  sequencer: boolean;
  context: string;
  controller: EditorMusicPatternController;
}

/** Shared DOM presentation of the existing pattern editor for phones and touch tablets. */
export class TouchMusicEditor {
  private state: TouchMusicEditorState | null = null;
  private abort: AbortController | null = null;
  private viewport: HTMLElement | null = null;
  private grid: HTMLElement | null = null;
  private gesture: TouchMusicGesture | null = null;
  private rows: number[] = [];
  private cellSize = TOUCH_MUSIC_MIN_CELL_SIZE;
  private rowSignature = '';
  private editSignature = '';
  private toolsOpen = false;
  private animationFrame = 0;
  private playhead: HTMLElement | null = null;
  private readonly cellButtons = new Map<number, HTMLButtonElement>();

  constructor(private readonly flushPreview: () => void, private readonly getPlayhead: () => RoomMusicPlayheadInfo) {}

  sync(state: TouchMusicEditorState): void {
    this.state = state;
    // Local review can expose the touch workspace on a computer without changing device detection.
    const localTouchPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).get('musicTouch') === '1';
    const touchLayout = localTouchPreview || document.body.dataset.deviceClass === 'phone'
      || (document.body.dataset.deviceClass === 'tablet' && window.matchMedia('(pointer: coarse)').matches);
    if (!state.active || !touchLayout) {
      this.unmount();
      return;
    }
    if (!this.abort) this.mount();
    if (!this.viewport || !this.grid) return;
    document.body.dataset.editorMusicTouch = 'true';
    const controller = state.controller;
    const pattern = controller.getDisplayPattern();
    const instrument = controller.getActiveInstrumentTab();
    const signature = `${state.context}:${state.sequencer}:${instrument}:${getRoomMusicKey(pattern)}`;
    if (signature !== this.editSignature) {
      this.gesture?.cancel();
      this.editSignature = signature;
    }
    const root = document.getElementById('editor-music-touch');
    const legacy = controller.getLegacyStemNoticeVisible();
    root?.classList.toggle('hidden', !state.sequencer || legacy);
    const mix = document.getElementById('editor-music-touch-mix');
    mix?.classList.toggle('hidden', !state.sequencer || legacy);
    this.grid.style.setProperty('--music-touch-accent', getPatternInstrumentColorCss(instrument));
    this.viewport.setAttribute('aria-label', `${getPatternInstrumentLabel(instrument)} sequencer. Tap to edit; drag to pan; pinch to zoom.`);
    const nextRows = instrument === 'drums'
      ? ROOM_PATTERN_DRUM_ROWS.map((row) => row.gridRow)
      : Array.from({ length: ROOM_PATTERN_GRID_ROWS }, (_, row) => row);
    const nextRowSignature = nextRows.join(',');
    if (this.rowSignature !== nextRowSignature) {
      this.rows = nextRows;
      this.rowSignature = nextRowSignature;
      this.buildGrid();
      // Begin near the kick/snare or the middle of the tonal register.
      this.viewport.scrollTop = instrument === 'drums' ? 9 * this.cellSize : 6 * this.cellSize;
    }
    for (const label of this.grid.querySelectorAll<HTMLElement>('[data-music-row-label]')) {
      label.textContent = this.rowLabel(Number(label.dataset.musicRowLabel));
    }
    for (const button of this.cellButtons.values()) {
      const step = Number(button.dataset.step), row = Number(button.dataset.row);
      const cell = controller.getCellState(step, row);
      button.setAttribute('aria-pressed', String(cell.active));
      button.dataset.tied = String(cell.tied);
      button.setAttribute('aria-label', `${this.rowLabel(row)}, step ${step + 1}${cell.tied ? ', connected' : ''}`);
    }
    const paste = document.getElementById('btn-editor-music-touch-paste') as HTMLButtonElement | null;
    if (paste) {
      paste.disabled = !controller.hasClipboardData() || legacy;
      paste.setAttribute('aria-pressed', String(controller.isPastePreviewActive()));
      paste.textContent = controller.isPastePreviewActive() ? 'Cancel' : 'Paste';
    }
    const settings = controller.getActiveInstrumentMix();
    for (const [id, value] of [['volume', settings.volume], ['pan', settings.pan]] as const) {
      const input = document.getElementById(`editor-music-touch-${id}`) as HTMLInputElement | null;
      if (input) input.value = String(Math.round(value * 100));
    }
    this.syncHint();
    this.syncNavigation();
  }

  destroy(): void {
    this.unmount();
    this.state = null;
  }

  cancelGesture(): void { this.gesture?.cancel(); }

  private mount(): void {
    this.viewport = document.getElementById('editor-music-touch-viewport');
    this.grid = document.getElementById('editor-music-touch-grid');
    if (!this.viewport || !this.grid) return;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.gesture = new TouchMusicGesture({
      cellAt: (point) => this.cellAt(point),
      pan: (dx, dy) => { this.viewport!.scrollLeft += dx; this.viewport!.scrollTop += dy; },
      pinch: (ratio, from, to) => this.zoom(ratio, from, to),
      preview: (cells) => this.preview(cells),
      commit: (cells, tool) => {
        this.state?.controller.commitCellGesture(cells, tool);
        this.flushPreview();
        if (tool === 'copy') this.setTool('tap');
        if (this.state) this.sync(this.state);
      },
    });
    this.viewport.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.viewport!.setPointerCapture(event.pointerId);
      const mode = this.getTool();
      this.gesture!.down(event.pointerId, { x: event.clientX, y: event.clientY }, mode.tool, mode.draw);
    }, { signal });
    this.viewport.addEventListener('pointermove', (event) => {
      this.gesture!.move(event.pointerId, { x: event.clientX, y: event.clientY });
    }, { signal });
    this.viewport.addEventListener('pointerup', (event) => this.gesture!.up(event.pointerId), { signal });
    this.viewport.addEventListener('pointercancel', (event) => this.gesture!.up(event.pointerId, true), { signal });
    this.viewport.addEventListener('lostpointercapture', (event) => this.gesture!.up(event.pointerId, true), { signal });
    this.viewport.addEventListener('scroll', () => this.syncNavigation(), { signal });
    this.viewport.addEventListener('wheel', (event) => {
      event.stopPropagation();
      if (event.ctrlKey) {
        event.preventDefault();
        this.gesture?.cancel();
        this.zoom(Math.exp(-event.deltaY / 300), { x: event.clientX, y: event.clientY });
      }
    }, { signal, passive: false });
    this.grid.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLElement>('[data-music-cell]');
      // Pointer editing happens on release; detail=0 also supports keyboard and assistive activation.
      if (!button || event.detail !== 0) return;
      this.gesture?.cancel();
      this.state?.controller.commitCellGesture([{ step: Number(button.dataset.step), row: Number(button.dataset.row) }], this.getTool().tool);
      this.flushPreview();
      if (this.state) this.sync(this.state);
    }, { signal });
    document.getElementById('editor-music-touch-tool')?.addEventListener('change', () => {
      this.gesture?.cancel();
      this.state?.controller.cancelPastePreview();
      this.syncHint();
    }, { signal });
    document.getElementById('btn-editor-music-touch-paste')?.addEventListener('click', () => {
      this.gesture?.cancel();
      this.setTool('tap');
      const controller = this.state!.controller;
      if (controller.isPastePreviewActive()) controller.cancelPastePreview();
      else controller.beginPastePreview();
      this.syncHint();
    }, { signal });
    document.getElementById('btn-editor-music-touch-tools')?.classList.remove('hidden');
    document.getElementById('btn-editor-music-touch-tools')?.addEventListener('click', () => {
      this.gesture?.cancel();
      this.toolsOpen = !this.toolsOpen;
      document.body.dataset.editorMusicTouchTools = String(this.toolsOpen);
      const button = document.getElementById('btn-editor-music-touch-tools')!;
      button.setAttribute('aria-expanded', String(this.toolsOpen));
      button.textContent = this.toolsOpen ? 'Grid' : 'Tools';
    }, { signal });
    for (const button of document.querySelectorAll<HTMLElement>('[data-music-touch-page]')) {
      button.addEventListener('click', () => {
        this.gesture?.cancel();
        const steps = Math.max(1, Math.floor((this.viewport!.clientWidth - TOUCH_MUSIC_LABEL_WIDTH) / this.cellSize));
        this.viewport!.scrollLeft += Number(button.dataset.musicTouchPage) * steps * this.cellSize;
      }, { signal });
    }
    for (const button of document.querySelectorAll<HTMLElement>('[data-music-touch-zoom]')) {
      button.addEventListener('click', () => {
        this.gesture?.cancel();
        const rect = this.viewport!.getBoundingClientRect();
        this.zoom(button.dataset.musicTouchZoom === 'in' ? 1.25 : 0.8, { x: rect.left + TOUCH_MUSIC_LABEL_WIDTH, y: rect.top + TOUCH_MUSIC_HEADER_HEIGHT });
      }, { signal });
    }
    for (const control of ['volume', 'pan'] as const) {
      document.getElementById(`editor-music-touch-${control}`)?.addEventListener('input', (event) => {
        this.gesture?.cancel();
        this.state?.controller.setActiveInstrumentMix({ [control]: Number((event.target as HTMLInputElement).value) / 100 });
      }, { signal });
    }
    window.addEventListener('blur', () => this.gesture?.cancel(), { signal });
    window.addEventListener(DEVICE_LAYOUT_CHANGED_EVENT, () => { this.gesture?.cancel(); if (this.state) this.sync(this.state); }, { signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.gesture?.cancel(); }, { signal });
    document.addEventListener('keydown', () => this.gesture?.cancel(), { signal });
    document.addEventListener('pointerdown', (event) => {
      if (!this.viewport?.contains(event.target as Node)) this.gesture?.cancel();
    }, { signal, capture: true });
    this.setTool('tap');
    const animate = () => {
      const playback = this.getPlayhead();
      const step = this.state?.sequencer && playback.kind === 'pattern'
        ? resolveMusicPlayheadStep({ ...playback, stepCount: ROOM_PATTERN_ACTIVE_STEP_COLUMNS }) : null;
      if (this.playhead) {
        this.playhead.hidden = step === null;
        this.playhead.style.left = `${TOUCH_MUSIC_LABEL_WIDTH + (step ?? 0) * this.cellSize}px`;
      }
      this.animationFrame = window.requestAnimationFrame(animate);
    };
    this.animationFrame = window.requestAnimationFrame(animate);
  }

  private unmount(): void {
    if (!this.abort) return;
    this.gesture?.cancel();
    this.abort.abort();
    window.cancelAnimationFrame(this.animationFrame);
    this.abort = null;
    this.gesture = null;
    this.grid?.replaceChildren();
    this.cellButtons.clear();
    this.playhead = null;
    this.rowSignature = '';
    this.editSignature = '';
    this.cellSize = TOUCH_MUSIC_MIN_CELL_SIZE;
    this.toolsOpen = false;
    delete document.body.dataset.editorMusicTouch;
    delete document.body.dataset.editorMusicTouchTools;
    document.getElementById('btn-editor-music-touch-tools')?.classList.add('hidden');
    document.getElementById('btn-editor-music-touch-tools')?.setAttribute('aria-expanded', 'false');
    const toolsButton = document.getElementById('btn-editor-music-touch-tools');
    if (toolsButton) toolsButton.textContent = 'Tools';
    document.getElementById('editor-music-touch')?.classList.add('hidden');
    document.getElementById('editor-music-touch-mix')?.classList.add('hidden');
    this.viewport = null;
    this.grid = null;
  }

  private buildGrid(): void {
    this.cellButtons.clear();
    const fragment = document.createDocumentFragment();
    const corner = document.createElement('div');
    corner.className = 'editor-music-touch-corner';
    fragment.append(corner);
    for (let step = 0; step < ROOM_PATTERN_ACTIVE_STEP_COLUMNS; step++) {
      const label = document.createElement('div');
      label.className = 'editor-music-touch-step';
      label.textContent = String(step + 1);
      fragment.append(label);
    }
    for (const row of this.rows) {
      const label = document.createElement('div');
      label.className = 'editor-music-touch-row';
      label.dataset.musicRowLabel = String(row);
      fragment.append(label);
      for (let step = 0; step < ROOM_PATTERN_ACTIVE_STEP_COLUMNS; step++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'editor-music-touch-cell';
        button.dataset.musicCell = '';
        button.dataset.step = String(step);
        button.dataset.row = String(row);
        this.cellButtons.set(row * ROOM_PATTERN_ACTIVE_STEP_COLUMNS + step, button);
        fragment.append(button);
      }
    }
    this.grid!.style.setProperty('--music-touch-cell', `${this.cellSize}px`);
    this.grid!.replaceChildren(fragment);
    this.playhead = document.createElement('div');
    this.playhead.className = 'editor-music-touch-playhead';
    this.playhead.setAttribute('aria-hidden', 'true');
    this.playhead.hidden = true;
    this.grid!.append(this.playhead);
  }

  private rowLabel(row: number): string {
    const controller = this.state!.controller, pattern = controller.getDisplayPattern();
    const instrument = controller.getActiveInstrumentTab();
    return getPatternRowLabel(instrument, row, pattern.pitchMode, instrument === 'drums' ? 0 : pattern.octaveShift[instrument], pattern.keyTonic, pattern.keyMode);
  }

  private cellAt(point: MusicTouchPoint): MusicCell | null {
    const rect = this.viewport!.getBoundingClientRect();
    const x = point.x - rect.left - this.viewport!.clientLeft, y = point.y - rect.top - this.viewport!.clientTop;
    if (x < TOUCH_MUSIC_LABEL_WIDTH || y < TOUCH_MUSIC_HEADER_HEIGHT || x >= this.viewport!.clientWidth || y >= this.viewport!.clientHeight) return null;
    const step = Math.floor((x + this.viewport!.scrollLeft - TOUCH_MUSIC_LABEL_WIDTH) / this.cellSize);
    const index = Math.floor((y + this.viewport!.scrollTop - TOUCH_MUSIC_HEADER_HEIGHT) / this.cellSize);
    if (step < 0 || step >= ROOM_PATTERN_ACTIVE_STEP_COLUMNS || index < 0 || index >= this.rows.length) return null;
    return { step, row: this.rows[index] };
  }

  private getTool(): { tool: TouchMusicTool; draw: boolean } {
    const mode = (document.getElementById('editor-music-touch-tool') as HTMLSelectElement | null)?.value ?? 'tap';
    return { tool: mode === 'erase' ? 'eraser' : mode === 'copy' ? 'copy' : 'pencil', draw: mode === 'draw' || mode === 'erase' };
  }

  private setTool(value: string): void {
    const input = document.getElementById('editor-music-touch-tool') as HTMLSelectElement | null;
    if (input) input.value = value;
    this.syncHint();
  }

  private syncHint(): void {
    const hint = document.getElementById('editor-music-touch-hint');
    if (!hint) return;
    const mode = this.getTool();
    hint.textContent = this.state?.controller.isPastePreviewActive() ? 'Tap where the copied notes should go'
      : mode.tool === 'copy' ? 'Drag across the notes to copy'
        : mode.tool === 'eraser' ? 'Tap or draw across notes to erase'
          : mode.draw ? 'Draw notes · Same-row steps connect · Pinch to zoom'
            : 'Tap to edit · Drag to pan · Pinch to zoom';
  }

  private preview(cells: readonly MusicCell[]): void {
    if (!this.grid) return;
    for (const cell of this.grid.querySelectorAll<HTMLElement>('[data-pending]')) delete cell.dataset.pending;
    const mark = (cell: MusicCell) => this.cellButtons.get(cell.row * ROOM_PATTERN_ACTIVE_STEP_COLUMNS + cell.step)?.setAttribute('data-pending', 'true');
    if (cells.length > 1 && this.getTool().tool === 'copy') {
      const first = cells[0], last = cells.at(-1)!;
      for (let row = Math.min(first.row, last.row); row <= Math.max(first.row, last.row); row++) {
        for (let step = Math.min(first.step, last.step); step <= Math.max(first.step, last.step); step++) mark({ step, row });
      }
    } else cells.forEach(mark);
  }

  private zoom(ratio: number, from: MusicTouchPoint, to = from): void {
    const viewport = this.viewport!, rect = viewport.getBoundingClientRect();
    const plan = planTouchMusicZoom(this.cellSize, ratio, { x: viewport.scrollLeft, y: viewport.scrollTop }, { x: from.x - rect.left - viewport.clientLeft, y: from.y - rect.top - viewport.clientTop }, { x: to.x - rect.left - viewport.clientLeft, y: to.y - rect.top - viewport.clientTop });
    this.cellSize = plan.size;
    this.grid!.style.setProperty('--music-touch-cell', `${plan.size}px`);
    viewport.scrollLeft = plan.scroll.x;
    viewport.scrollTop = plan.scroll.y;
    this.syncNavigation();
  }

  private syncNavigation(): void {
    if (!this.viewport) return;
    const first = Math.min(32, Math.floor(this.viewport.scrollLeft / this.cellSize) + 1);
    const last = Math.min(32, Math.ceil((this.viewport.scrollLeft + this.viewport.clientWidth - TOUCH_MUSIC_LABEL_WIDTH) / this.cellSize));
    const output = document.getElementById('editor-music-touch-steps');
    if (output) output.textContent = `${first}–${Math.max(first, last)} / 32`;
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-music-touch-zoom]')) {
      button.disabled = button.dataset.musicTouchZoom === 'out' ? this.cellSize <= 44 : this.cellSize >= 88;
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-music-touch-page]')) {
      button.disabled = Number(button.dataset.musicTouchPage) < 0 ? this.viewport.scrollLeft <= 0 : this.viewport.scrollLeft >= this.viewport.scrollWidth - this.viewport.clientWidth - 1;
    }
  }
}
