import { AUTH_STATE_CHANGED_EVENT, AUTH_SESSION_REFRESHED_EVENT, getAuthDebugState, promptForSignIn } from '../../auth/client';
import { GUEST_RUN_PROGRESS_CHANGED_EVENT } from '../../guestRooms/runService';
import { POST_RUN_GUEST_CLAIM_REQUEST_EVENT, POST_RUN_RATING_REQUEST_EVENT } from '../../progression/postRunRatingEvents';
import { loadGuestRunProgress } from '../../progression/guestRunProgress';
import type { DailyResponse } from '../../daily/model';
import { guestDailyProgress } from '../../daily/guestProgress';
import { createDailyRepository, type DailyRepository } from '../../daily/repository';
import { APP_MODE_CHANGED_EVENT } from '../appMode';
import { createModalLifecycle } from './modalLifecycle';

const DISMISSED = 'wamp_daily_dismissed_v1';
export class DailyRoomController {
  private readonly modal;
  private readonly chip;
  private readonly openButtons;
  private readonly closeButton;
  private readonly dismiss;
  private readonly retry;
  private readonly play;
  private readonly copy;
  private readonly save;
  private readonly title;
  private readonly builder;
  private readonly status;
  private readonly progress;
  private readonly board;
  private readonly date;
  private readonly lifecycle;
  private response: DailyResponse | null = null;
  private generation = 0;
  private destroyed = false;
  private busy = false;
  private lastLoaded = 0;
  private timer: number | null = null;
  private observer: MutationObserver | null = null;
  private returnFocus: HTMLElement | null = null;
  private dismissedDate: string | null = null;
  private pendingOpen = false;
  constructor(private readonly doc: Document = document, private readonly win: Window = window,
    private readonly repository: DailyRepository = createDailyRepository()) {
    this.modal = doc.getElementById('daily-room-modal'); this.chip = doc.getElementById('daily-room-chip');
    this.openButtons = ['btn-daily-open','btn-auth-daily'].map(id=>doc.getElementById(id));
    this.closeButton = doc.getElementById('btn-daily-close'); this.dismiss = doc.getElementById('btn-daily-dismiss');
    this.retry = doc.getElementById('btn-daily-retry'); this.play = doc.getElementById('btn-daily-play') as HTMLAnchorElement | null;
    this.copy = doc.getElementById('btn-daily-copy'); this.save = doc.getElementById('btn-daily-save');
    this.title = doc.getElementById('daily-room-title'); this.builder = doc.getElementById('daily-room-builder');
    this.status = doc.getElementById('daily-room-status'); this.progress = doc.getElementById('daily-room-progress');
    this.board = doc.getElementById('daily-room-board'); this.date = doc.getElementById('daily-room-date');
    this.lifecycle = createModalLifecycle({doc,modal:this.modal,onClose:()=>this.close()});
  }
  init(): void {
    try { this.dismissedDate = this.win.localStorage.getItem(DISMISSED); } catch { /* In-memory dismissal still works. */ }
    this.pendingOpen = new URLSearchParams(this.win.location.search).get('today') === '1';
    for (const button of this.openButtons) button?.addEventListener('click',this.onOpen);
    this.closeButton?.addEventListener('click',this.onClose); this.dismiss?.addEventListener('click',this.onDismiss);
    this.retry?.addEventListener('click',this.onRetry); this.copy?.addEventListener('click',this.onCopy);
    this.save?.addEventListener('click',this.onSave); this.play?.addEventListener('click',this.onPlay);
    for (const name of [AUTH_STATE_CHANGED_EVENT,AUTH_SESSION_REFRESHED_EVENT]) this.win.addEventListener(name,this.onAuth);
    for (const name of [POST_RUN_RATING_REQUEST_EVENT,POST_RUN_GUEST_CLAIM_REQUEST_EVENT,GUEST_RUN_PROGRESS_CHANGED_EVENT]) this.win.addEventListener(name,this.onClear);
    this.win.addEventListener(APP_MODE_CHANGED_EVENT,this.onMode); this.win.addEventListener('focus',this.onWake);
    this.win.addEventListener('daily-room-open-request',this.onOpen);
    this.win.addEventListener('online',this.onWake); this.doc.addEventListener('visibilitychange',this.onWake);
    this.doc.addEventListener('keydown',this.onKeydown,true); this.lifecycle.attach();
    this.observer = new MutationObserver(this.onMode); this.observer.observe(this.doc.body,{attributes:true,attributeFilter:['data-app-ready','data-app-mode']});
    this.timer = this.win.setInterval(this.onWake,60000);
    this.renderEntry(); void this.refresh();
  }
  destroy(): void {
    this.destroyed = true; this.generation++; this.observer?.disconnect(); this.lifecycle.detach();
    if (this.timer !== null) this.win.clearInterval(this.timer);
    for (const button of this.openButtons) button?.removeEventListener('click',this.onOpen);
    this.closeButton?.removeEventListener('click',this.onClose); this.dismiss?.removeEventListener('click',this.onDismiss);
    this.retry?.removeEventListener('click',this.onRetry); this.copy?.removeEventListener('click',this.onCopy);
    this.save?.removeEventListener('click',this.onSave); this.play?.removeEventListener('click',this.onPlay);
    for (const name of [AUTH_STATE_CHANGED_EVENT,AUTH_SESSION_REFRESHED_EVENT]) this.win.removeEventListener(name,this.onAuth);
    for (const name of [POST_RUN_RATING_REQUEST_EVENT,POST_RUN_GUEST_CLAIM_REQUEST_EVENT,GUEST_RUN_PROGRESS_CHANGED_EVENT]) this.win.removeEventListener(name,this.onClear);
    this.win.removeEventListener(APP_MODE_CHANGED_EVENT,this.onMode); this.win.removeEventListener('focus',this.onWake);
    this.win.removeEventListener('daily-room-open-request',this.onOpen);
    this.win.removeEventListener('online',this.onWake); this.doc.removeEventListener('visibilitychange',this.onWake);
    this.doc.removeEventListener('keydown',this.onKeydown,true); this.close(false);
  }
  private readonly onOpen = () => {
    if (this.destroyed || !['world','play-world'].includes(this.doc.body.dataset.appMode ?? '')) return;
    this.doc.getElementById('auth-panel')?.classList.remove('menu-open');
    this.returnFocus = this.doc.activeElement instanceof HTMLElement ? this.doc.activeElement : this.openButtons[0];
    this.lifecycle.show(); this.render(); this.closeButton?.focus(); void this.refresh();
  };
  private readonly onClose = () => this.close();
  private close(focus = true): void { this.lifecycle.hide(); if (focus && this.returnFocus?.isConnected) this.returnFocus.focus(); this.returnFocus = null; }
  private readonly onDismiss = () => {
    this.dismissedDate = this.response?.date ?? new Date().toISOString().slice(0,10);
    try { this.win.localStorage.setItem(DISMISSED,this.dismissedDate); } catch { /* Optional persistence. */ }
    this.renderEntry();
  };
  private readonly onRetry = () => { void this.refresh(); };
  private readonly onAuth = () => { this.generation++; this.busy=false; this.response=null; this.board?.replaceChildren(); this.render(); void this.refresh(); };
  private readonly onClear = () => { this.render(); this.lastLoaded=0; void this.refresh(); };
  private readonly onMode = () => {
    this.renderEntry();
    if (!['world','play-world'].includes(this.doc.body.dataset.appMode ?? '')) this.close(false);
    if (this.pendingOpen && this.doc.body.dataset.appMode === 'world' && this.doc.body.dataset.appReady === 'true') { this.pendingOpen=false; this.onOpen(); }
  };
  private readonly onWake = () => {
    if (this.doc.visibilityState === 'hidden') return;
    if (!this.response || this.response.resetsAt <= new Date().toISOString() || this.lifecycle.isOpen() && Date.now()-this.lastLoaded >= 60000) void this.refresh();
  };
  private readonly onPlay = (event: Event) => {
    // Refresh on midnight or a failed read, rather than playing a stale challenge.
    if (!this.response?.pick?.available || this.response.resetsAt <= new Date().toISOString()) { event.preventDefault(); void this.refresh(); }
  };
  private readonly onSave = () => { this.close(); promptForSignIn('Sign in to save your verified daily clear and its completion bonus. Play signed in to join the daily board.'); };
  private readonly onCopy = async () => {
    const generation=this.generation;
    try {
      await this.win.navigator.clipboard.writeText('https://wamp.land/today');
      if (!this.destroyed && generation===this.generation) this.message('Link copied.');
    } catch { if (!this.destroyed && generation===this.generation) this.message('Copy the link below, or try Copy Link again.'); }
  };
  private readonly onKeydown = (event: KeyboardEvent) => {
    if (!this.lifecycle.isOpen()) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.close(); }
    if (event.key !== 'Tab') return;
    const elements=Array.from(this.modal?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? []).filter(el=>el.getClientRects().length>0);
    const first=elements[0],last=elements.at(-1);
    if (event.shiftKey && this.doc.activeElement===first) {event.preventDefault();last?.focus();}
    else if (!event.shiftKey && this.doc.activeElement===last) {event.preventDefault();first?.focus();}
  };
  private async refresh(): Promise<void> {
    if (this.busy || this.destroyed) return;
    this.busy=true; const generation=this.generation;
    if (this.lifecycle.isOpen()) this.message('Loading today’s challenge…');
    try {
      const response=await this.repository.load();
      if (this.destroyed || generation!==this.generation) return;
      this.response=response; this.lastLoaded=Date.now(); this.render();
    } catch {
      if (this.destroyed || generation!==this.generation) return;
      this.response=null; this.render(); this.message('Today’s challenge could not load. Try again when you’re online.',true);
    } finally { if (generation===this.generation) this.busy=false; }
  }
  private renderEntry(): void {
    const ready=this.doc.body.dataset.appReady==='true',mode=this.doc.body.dataset.appMode;
    this.chip?.classList.toggle('hidden',!ready || mode!=='world' || this.dismissedDate===(this.response?.date ?? new Date().toISOString().slice(0,10)));
    this.openButtons[1]?.classList.toggle('hidden',!['world','play-world'].includes(mode ?? ''));
  }
  private message(text: string, error=false): void { if(this.status)this.status.textContent=text; this.retry?.classList.toggle('hidden',!error); }
  private render(): void {
    this.renderEntry(); const response=this.response,pick=response?.pick;
    if (this.title) this.title.textContent=pick?.title ?? 'Room of the Day';
    if (this.builder) this.builder.textContent=pick ? `by ${pick.builderDisplayName}${pick.cellCount>1 ? ` · ${pick.cellCount} cells` : ''}` : '';
    if (this.date) this.date.textContent=response ? `${response.date} · Resets at midnight UTC` : '';
    if (this.play) { this.play.href='/today'; this.play.classList.toggle('hidden',!pick?.available); }
    const auth=getAuthDebugState(); const signed=auth.authenticated && auth.source==='session';
    const progress=response ? signed && response.viewer ? response.viewer : guestDailyProgress(response,loadGuestRunProgress().records) : null;
    if (this.progress) this.progress.textContent=progress ? `Beaten ${progress.completedLast7} of the last 7${progress.completed ? ' · Today cleared!' : ''}${signed && response?.viewer?.rank ? ` · Today #${response.viewer.rank}` : ''}` : '';
    this.save?.classList.toggle('hidden',signed || !progress?.completed);
    this.board?.replaceChildren();
    for (const entry of response?.leaderboard ?? []) {
      const item=this.doc.createElement('li');
      item.textContent=`#${entry.rank} ${entry.displayName} — ${response?.rankingMode==='score' ? `${entry.score} pts` : `${(entry.elapsedMs/1000).toFixed(2)}s`} · ${entry.deaths} deaths`;
      this.board?.append(item);
    }
    const owned=pick?.builderUserId===auth.user?.id;
    this.message(!response ? 'Loading today’s challenge…' : !pick ? 'No eligible community level yet. Try again later.'
      : !pick.available ? 'The builder has updated or removed today’s level. The daily board keeps its original version. A new challenge arrives at midnight UTC.'
      : owned ? 'Your level is Room of the Day!'
      : signed ? `Clear today’s level for +${response.bonusPxp} PXP, once today.`
      : `Guests can play. Sign in to save the +${response.bonusPxp} PXP bonus; play signed in to join today’s board.`,!response || !pick);
    if (response && !response.leaderboard.length && this.board) { const item=this.doc.createElement('li');item.textContent='No ranked clears today yet.';this.board.append(item); }
  }
}
