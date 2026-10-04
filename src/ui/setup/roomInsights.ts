import type Phaser from 'phaser';
import type { DeathMapCell, RoomInsightsResponse, RoomInsightTarget } from '../../insights/model';
import { loadRoomInsights } from '../../insights/repository';
import { createModalLifecycle } from './modalLifecycle';
import { EDITOR_UI_STATE_CHANGED_EVENT } from '../../scenes/editor/uiEvents';
import { APP_MODE_CHANGED_EVENT } from '../appMode';
interface InsightScene { events: Phaser.Events.EventEmitter; getRoomInsightsTarget(): RoomInsightTarget | null; setRoomDeathMap(points: DeathMapCell[]): void; clearRoomDeathMap(): void }
export class RoomInsightsController {
  private readonly modal;
  private readonly lifecycle;
  private readonly closeButton;
  private readonly status;
  private readonly metrics;
  private readonly coverage;
  private readonly toggle;
  private readonly retry;
  private generation = 0;
  private target: RoomInsightTarget | null = null;
  private result: RoomInsightsResponse | null = null;
  private editorSource: InsightScene | null = null;
  private mappedScene: InsightScene | null = null;
  private openingEditorKey: string | null = null;
  private mappedKey: string | null = null;
  private returnFocus: HTMLElement | null = null;
  constructor(private readonly game: Phaser.Game, private readonly doc: Document = document, private readonly win: Window = window,
    private readonly load = loadRoomInsights) {
    this.modal = doc.getElementById('room-insights-modal'); this.closeButton = doc.getElementById('btn-room-insights-close');
    this.status = doc.getElementById('room-insights-status'); this.metrics = doc.getElementById('room-insights-metrics');
    this.coverage = doc.getElementById('room-insights-coverage'); this.toggle = doc.getElementById('room-insights-map') as HTMLInputElement | null;
    this.retry = doc.getElementById('btn-room-insights-retry');
    this.lifecycle = createModalLifecycle({ doc, modal: this.modal, onClose: () => this.close() });
  }
  init(): void {
    this.lifecycle.attach(); this.closeButton?.addEventListener('click',this.onClose);
    this.retry?.addEventListener('click',this.onRetry); this.toggle?.addEventListener('change',this.onToggle);
    this.win.addEventListener('room-insights-open',this.onOpen); this.win.addEventListener(EDITOR_UI_STATE_CHANGED_EVENT,this.onEditorChange);
    this.win.addEventListener(APP_MODE_CHANGED_EVENT,this.onEditorChange);
    this.doc.addEventListener('click',this.onEditorClick); this.win.addEventListener('keydown',this.onKeydown,true);
  }
  destroy(): void {
    this.close(); this.clearMap(); this.lifecycle.detach();
    this.closeButton?.removeEventListener('click',this.onClose); this.retry?.removeEventListener('click',this.onRetry);
    this.toggle?.removeEventListener('change',this.onToggle); this.win.removeEventListener('room-insights-open',this.onOpen);
    this.win.removeEventListener(EDITOR_UI_STATE_CHANGED_EVENT,this.onEditorChange); this.doc.removeEventListener('click',this.onEditorClick);
    this.win.removeEventListener(APP_MODE_CHANGED_EVENT,this.onEditorChange);
    this.win.removeEventListener('keydown',this.onKeydown,true);
  }
  private currentEditor(): InsightScene | null {
    if (this.doc.body.dataset.appMode !== 'editor') return null;
    for (const key of ['CourseEditorScene','EditorScene']) if (this.game.scene.isActive(key)) return this.game.scene.getScene(key) as unknown as InsightScene;
    return null;
  }
  private readonly onEditorClick = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-room-insights-open], #btn-editor-death-map-clear') : null;
    if (!target) return;
    if (target.id === 'btn-editor-death-map-clear') { this.clearMap(); return; }
    const scene = this.currentEditor(); this.open(scene?.getRoomInsightsTarget() ?? null,scene);
  };
  private readonly onOpen = (event: Event) => {
    const detail = (event as CustomEvent<RoomInsightTarget>).detail;
    if (!detail || !['room','course','expanded_room'].includes(detail.contentType) || typeof detail.contentId !== 'string') return;
    this.doc.getElementById('btn-profile-close')?.click(); this.open(detail,null);
  };
  private open(target: RoomInsightTarget | null, scene: InsightScene | null): void {
    this.editorSource?.events.off('shutdown',this.onSourceExit); this.editorSource?.events.off('sleep',this.onSourceExit);
    this.returnFocus = this.doc.activeElement instanceof HTMLElement ? this.doc.activeElement : null;
    this.openingEditorKey = scene ? JSON.stringify(scene.getRoomInsightsTarget()) : null;
    this.target = target; this.editorSource = scene; this.result = null; this.generation++;
    scene?.events.on('shutdown',this.onSourceExit); scene?.events.on('sleep',this.onSourceExit);
    this.metrics?.replaceChildren(); if (this.coverage) this.coverage.textContent = '';
    if (this.toggle) { this.toggle.checked = false; this.toggle.disabled = true; }
    this.retry?.classList.add('hidden'); this.lifecycle.show(); this.closeButton?.focus();
    if (!target) { if (this.status) this.status.textContent = 'Publish this level to collect play statistics.'; return; }
    void this.refresh();
  }
  private readonly onClose = () => this.close();
  private readonly onRetry = () => { void this.refresh(); };
  private close(): void {
    this.editorSource?.events.off('shutdown',this.onSourceExit); this.editorSource?.events.off('sleep',this.onSourceExit);
    this.generation++; this.lifecycle.hide(); this.result = null; this.returnFocus?.focus({ preventScroll: true });
  }
  private readonly onSourceExit = () => { this.close(); this.clearMap(); };
  private readonly onMappedExit = () => this.clearMap();
  private readonly onKeydown = (event: KeyboardEvent) => {
    if (!this.lifecycle.isOpen()) return;
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.close(); return; }
    if (event.key !== 'Tab') return;
    const items = Array.from(this.modal?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? []).filter(el => el.getClientRects().length);
    if (event.shiftKey && this.doc.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
    else if (!event.shiftKey && this.doc.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
  };
  private readonly onEditorChange = () => {
    if (this.lifecycle.isOpen() && this.editorSource && (this.currentEditor() !== this.editorSource || JSON.stringify(this.editorSource.getRoomInsightsTarget()) !== this.openingEditorKey)) this.close();
    if (this.mappedScene && (this.currentEditor() !== this.mappedScene || JSON.stringify(this.mappedScene.getRoomInsightsTarget()) !== this.mappedKey)) this.clearMap();
  };
  private clearMap(): void {
    this.mappedScene?.events.off('shutdown',this.onMappedExit); this.mappedScene?.events.off('sleep',this.onMappedExit);
    this.mappedScene?.clearRoomDeathMap();
    this.mappedScene = null; this.mappedKey = null; this.doc.getElementById('editor-death-map-key')?.classList.add('hidden');
    if (this.toggle) this.toggle.checked = false;
  }
  private readonly onToggle = () => {
    if (!this.toggle?.checked) { this.clearMap(); return; }
    if (!this.result || !this.editorSource || this.currentEditor() !== this.editorSource) return;
    this.clearMap(); this.editorSource.setRoomDeathMap(this.result.deathMap);
    this.mappedScene = this.editorSource; this.mappedKey = JSON.stringify(this.editorSource.getRoomInsightsTarget());
    this.mappedScene.events.on('shutdown',this.onMappedExit); this.mappedScene.events.on('sleep',this.onMappedExit);
    this.toggle.checked = true; this.doc.getElementById('editor-death-map-key')?.classList.remove('hidden');
  };
  private async refresh(): Promise<void> {
    if (!this.target) return;
    const generation = ++this.generation; if (this.status) this.status.textContent = 'Loading play statistics…'; this.retry?.classList.add('hidden');
    try {
      const result = await this.load(this.target); if (generation !== this.generation || !this.lifecycle.isOpen()) return;
      this.result = result; const stats = result.summary;
      if (this.status) this.status.textContent = `${result.title || 'Untitled level'} · published v${result.target.version} · ${result.cells.length} cell${result.cells.length === 1 ? '' : 's'}`;
      const rows: [string,string][] = [
        ['Finished attempts',stats.attempts.toLocaleString()],['Players',stats.uniquePlayers.toLocaleString()],['Clears',stats.completions.toLocaleString()],
        ['Clear rate',stats.clearRate === null ? '—' : `${Math.round(stats.clearRate*100)}%`],['Median clear',stats.medianClearMs === null ? '—' : `${(stats.medianClearMs/1000).toFixed(1)}s`],
        ['Deaths / attempt',stats.averageDeaths === null ? '—' : stats.averageDeaths.toFixed(1)],['Failed',stats.failures.toLocaleString()],['Abandoned',stats.abandonments.toLocaleString()],
        ['Last played',stats.lastPlayedAt ? new Date(stats.lastPlayedAt).toLocaleString() : 'No plays yet'],
      ];
      this.metrics?.replaceChildren(...rows.map(([label,value]) => { const row = this.doc.createElement('div'); const dt = this.doc.createElement('dt'); const dd = this.doc.createElement('dd'); dt.textContent = label; dd.textContent = value; row.append(dt,dd); return row; }));
      if (this.coverage) this.coverage.textContent = stats.mappedAttempts
        ? `${stats.mappedDeaths.toLocaleString()} of ${stats.totalDeaths.toLocaleString()} deaths have map locations, from ${stats.mappedAttempts.toLocaleString()} attempts. The first 50 deaths per attempt are recorded. ${result.deathMapTruncated ? 'Showing the 4,096 busiest tiles. ' : ''}${this.editorSource ? 'Orange tiles mark the busiest spots. The map shows the published version while you edit a draft. Close this panel to see the map.' : 'Open this level in the editor, then Room → Insights to see its death map.'}`
        : 'Death locations are collected on new plays. Earlier attempts have statistics but no map locations.';
      if (this.toggle) { this.toggle.disabled = !this.editorSource || !result.deathMap.length; this.toggle.checked = this.mappedScene === this.editorSource && this.mappedKey === JSON.stringify(this.editorSource?.getRoomInsightsTarget()); }
    } catch (error) {
      if (generation !== this.generation || !this.lifecycle.isOpen()) return;
      if (this.status) this.status.textContent = error instanceof Error ? error.message : 'Play statistics could not load.';
      this.retry?.classList.remove('hidden');
    }
  }
}
