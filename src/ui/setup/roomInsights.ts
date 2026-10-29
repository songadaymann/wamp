import type Phaser from 'phaser';
import type { DeathMapCell, RoomInsightsResponse, RoomInsightTarget, RoomInsightSummary, RoomInsightVersionStats } from '../../insights/model';
import { loadRoomInsights } from '../../insights/repository';
import { createModalLifecycle } from './modalLifecycle';
import { subscribeEditorUi } from '../../scenes/editor/uiEvents';
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
  private readonly mapVersionSelect;
  private mapVersion: 'current' | 'previous' = 'current';
  private readonly retry;
  private stopEditorUi: (() => void) | null = null;
  private generation = 0;
  private target: RoomInsightTarget | null = null;
  private result: RoomInsightsResponse | null = null;
  private editorSource: InsightScene | null = null;
  private mappedScene: InsightScene | null = null;
  private openingEditorKey: string | null = null;
  private mappedKey: string | null = null;
  private returnFocus: HTMLElement | null = null;
  private readonly blockedKeys = new Set<string>();
  constructor(private readonly game: Phaser.Game, private readonly doc: Document = document, private readonly win: Window = window,
    private readonly load = loadRoomInsights) {
    this.modal = doc.getElementById('room-insights-modal'); this.closeButton = doc.getElementById('btn-room-insights-close');
    this.status = doc.getElementById('room-insights-status'); this.metrics = doc.getElementById('room-insights-metrics');
    this.coverage = doc.getElementById('room-insights-coverage'); this.toggle = doc.getElementById('room-insights-map') as HTMLInputElement | null;
    this.retry = doc.getElementById('btn-room-insights-retry');
    this.mapVersionSelect = doc.getElementById('room-insights-map-version') as HTMLSelectElement | null;
    this.lifecycle = createModalLifecycle({ doc, modal: this.modal, onClose: () => this.close() });
  }
  init(): void {
    this.mapVersionSelect?.addEventListener('change',this.onMapVersion);
    this.lifecycle.attach(); this.closeButton?.addEventListener('click',this.onClose);
    this.retry?.addEventListener('click',this.onRetry); this.toggle?.addEventListener('change',this.onToggle);
    this.win.addEventListener('room-insights-open',this.onOpen); this.stopEditorUi?.(); this.stopEditorUi = subscribeEditorUi(this.win,this.onEditorChange);
    this.win.addEventListener(APP_MODE_CHANGED_EVENT,this.onEditorChange);
    this.doc.addEventListener('click',this.onEditorClick); this.win.addEventListener('keydown',this.onKeydown,true);
    this.win.addEventListener('keyup',this.onKeyup,true);
  }
  destroy(): void {
    this.close(); this.clearMap(); this.lifecycle.detach();
    this.mapVersionSelect?.removeEventListener('change',this.onMapVersion);
    this.closeButton?.removeEventListener('click',this.onClose); this.retry?.removeEventListener('click',this.onRetry);
    this.toggle?.removeEventListener('change',this.onToggle); this.win.removeEventListener('room-insights-open',this.onOpen);
    this.stopEditorUi?.(); this.stopEditorUi = null; this.doc.removeEventListener('click',this.onEditorClick);
    this.win.removeEventListener(APP_MODE_CHANGED_EVENT,this.onEditorChange);
    this.win.removeEventListener('keydown',this.onKeydown,true);
    this.win.removeEventListener('keyup',this.onKeyup,true); this.blockedKeys.clear();
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
    if (!scene || this.mappedScene !== scene || this.mappedKey !== this.openingEditorKey) { this.clearMap(); this.mapVersion = 'current'; }
    this.doc.getElementById('room-insights-previous')?.classList.add('hidden');
    this.doc.getElementById('room-insights-map-version-label')?.classList.add('hidden');
    this.target = target; this.editorSource = scene; this.result = null; this.generation++;
    scene?.events.on('shutdown',this.onSourceExit); scene?.events.on('sleep',this.onSourceExit);
    this.metrics?.replaceChildren(); if (this.coverage) this.coverage.textContent = '';
    this.text('room-insights-selected-title','Selected version');
    this.text('room-insights-selected-versions','');
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
    this.blockedKeys.add(event.code);
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.close(); return; }
    const active = this.doc.activeElement;
    if ((event.key === ' ' || event.key === 'Enter') && this.modal?.contains(active)
      && (active === this.toggle || active instanceof HTMLButtonElement)) {
      event.preventDefault();
      if (!(active as HTMLInputElement | HTMLButtonElement).disabled && !event.repeat) (active as HTMLElement).click();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(this.modal?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)') ?? []).filter(el => el.getClientRects().length);
    event.preventDefault();
    const index = items.indexOf(active as HTMLElement);
    items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
  };
  private readonly onKeyup = (event: KeyboardEvent) => {
    if (!this.blockedKeys.delete(event.code)) return;
    event.preventDefault(); event.stopImmediatePropagation();
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
    const selected = this.selectedMap(); if (!selected?.deathMap.length) { this.clearMap(); return; }
    this.clearMap(); this.editorSource.setRoomDeathMap(selected.deathMap);
    this.mappedScene = this.editorSource; this.mappedKey = JSON.stringify(this.editorSource.getRoomInsightsTarget());
    this.mappedScene.events.on('shutdown',this.onMappedExit); this.mappedScene.events.on('sleep',this.onMappedExit);
    this.toggle.checked = true;
    this.text('editor-death-map-version',`Death map v${selected.target.version} · orange = busiest tiles`);
    this.doc.getElementById('editor-death-map-key')?.classList.remove('hidden');
  };
  private text(id:string,value:string):void { const el=this.doc.getElementById(id);if(el)el.textContent=value; }
  private selectedMap():RoomInsightVersionStats|null { return this.mapVersion==='previous' ? this.result?.comparison??this.result : this.result; }
  private versionLabel(stats:RoomInsightVersionStats):string {
    const versions=stats.equivalentVersions??[stats.target.version!];
    if(stats.versionGrouping!=='matching')return `Exact published v${stats.target.version}`;
    return versions.length<=6?`Matching leaderboard versions: ${versions.map(v=>`v${v}`).join(', ')}`
      :`${versions.length} matching leaderboard versions, from v${versions[0]} to v${versions[versions.length-1]}`;
  }
  private renderMetrics(target:HTMLElement|null,stats:RoomInsightSummary):void {
    const rows:[string,string][]=[['Finished attempts',stats.attempts.toLocaleString()],['Players',stats.uniquePlayers.toLocaleString()],['Clears',stats.completions.toLocaleString()],
      ['Clear rate',stats.clearRate===null?'—':`${Math.round(stats.clearRate*100)}%`],['Median clear',stats.medianClearMs===null?'—':`${(stats.medianClearMs/1000).toFixed(1)}s`],
      ['Deaths / attempt',stats.averageDeaths===null?'—':stats.averageDeaths.toFixed(1)],['Failed',stats.failures.toLocaleString()],['Abandoned',stats.abandonments.toLocaleString()],
      ['Last played',stats.lastPlayedAt?new Date(stats.lastPlayedAt).toLocaleString():'No plays yet']];
    target?.replaceChildren(...rows.map(([label,value])=>{const row=this.doc.createElement('div'),dt=this.doc.createElement('dt'),dd=this.doc.createElement('dd');dt.textContent=label;dd.textContent=value;row.append(dt,dd);return row;}));
  }
  private renderCoverage():void {
    const selected=this.selectedMap();if(!selected)return;const stats=selected.summary;
    if(this.coverage)this.coverage.textContent=stats.mappedAttempts
      ?`v${selected.target.version}: ${stats.mappedDeaths.toLocaleString()} of ${stats.totalDeaths.toLocaleString()} deaths have locations, from ${stats.mappedAttempts.toLocaleString()} attempts. The first 50 deaths per attempt are recorded. ${selected.deathMapTruncated?'Showing the 4,096 busiest tiles. ':''}${this.editorSource?'Selected-version deaths are drawn over the open draft; layouts may differ. Close this panel to see the map.':'Open this level in the editor, then Room → Insights to see its death map.'}`
      :'Death locations are collected on new plays. Earlier attempts have statistics but no map locations.';
    if(this.toggle){this.toggle.disabled=!this.editorSource||!selected.deathMap.length;this.toggle.checked=this.mappedScene===this.editorSource&&this.mappedKey===JSON.stringify(this.editorSource?.getRoomInsightsTarget());}
  }
  private readonly onMapVersion=()=>{
    const checked=this.toggle?.checked;this.mapVersion=this.mapVersionSelect?.value==='previous'?'previous':'current';
    this.clearMap();this.renderCoverage();if(checked&&this.toggle&&!this.toggle.disabled){this.toggle.checked=true;this.onToggle();}
  };
  private async refresh(): Promise<void> {
    if (!this.target) return;
    const generation = ++this.generation; if (this.status) this.status.textContent = 'Loading play statistics…'; this.retry?.classList.add('hidden');
    try {
      const result = await this.load(this.target); if (generation !== this.generation || !this.lifecycle.isOpen()) return;
      this.result = result;
      if (this.status) this.status.textContent = `${result.title || 'Untitled level'} · published v${result.target.version} · ${result.cells.length} cell${result.cells.length === 1 ? '' : 's'}`;
      this.text('room-insights-selected-title',`Selected layout · v${result.target.version}`);
      this.text('room-insights-selected-versions',this.versionLabel(result));this.renderMetrics(this.metrics,result.summary);
      this.doc.getElementById('room-insights-previous')?.classList.toggle('hidden',!result.comparison);
      if (result.comparison) {
        this.text('room-insights-previous-title',`Previous different layout · v${result.comparison.target.version}`);
        this.text('room-insights-previous-versions',this.versionLabel(result.comparison));
        this.renderMetrics(this.doc.getElementById('room-insights-previous-metrics'),result.comparison.summary);
      } else this.mapVersion = 'current';
      if (this.mapVersionSelect) {
        const choices = [[`Selected v${result.target.version}`,'current'],...(result.comparison?[[`Previous v${result.comparison.target.version}`,'previous']]:[])];
        this.mapVersionSelect.replaceChildren(...choices.map(([label,value])=>{const option=this.doc.createElement('option');option.textContent=label;option.value=value;return option;}));
        this.mapVersionSelect.value=this.mapVersion;
      }
      this.doc.getElementById('room-insights-map-version-label')?.classList.toggle('hidden',!result.comparison);
      const restoreMap=this.mappedScene===this.editorSource && this.mappedKey===JSON.stringify(this.editorSource?.getRoomInsightsTarget());
      this.renderCoverage();
      if (restoreMap && this.toggle) { if (!this.toggle.disabled) { this.toggle.checked=true;this.onToggle(); } else this.clearMap(); }
    } catch (error) {
      if (generation !== this.generation || !this.lifecycle.isOpen()) return;
      if (this.status) this.status.textContent = error instanceof Error ? error.message : 'Play statistics could not load.';
      this.retry?.classList.remove('hidden');
    }
  }
}
