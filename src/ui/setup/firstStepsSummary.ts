import { AUTH_STATE_CHANGED_EVENT, getAuthDebugState, promptForSignIn } from '../../auth/client';
import { GUEST_RUN_PROGRESS_CHANGED_EVENT, type GuestRunSaveResult } from '../../guestRooms/runService';
import {
  POST_RUN_GUEST_CLAIM_REQUEST_EVENT, POST_RUN_RATING_REQUEST_EVENT,
  type PostRunRatingRequestDetail,
} from '../../progression/postRunRatingEvents';
import { createModalLifecycle } from './modalLifecycle';
import type { RoomSequenceEntry } from './roomSequenceEvents';

/** Counts completion events from this run, never Next clicks or previous browser history. */
export class FirstStepsSummaryController {
  private entries: RoomSequenceEntry[] = [];
  private readonly clears = new Map<string, PostRunRatingRequestDetail>();
  private readonly modal;
  private readonly count;
  private readonly progress;
  private readonly save;
  private readonly explore;
  private readonly build;
  private readonly closeButton;
  private readonly lifecycle;
  private completed = false;

  constructor(
    private readonly actions: { explore: () => void; build: () => void },
    doc: Document = document, private readonly win: Window = window,
  ) {
    this.modal = doc.getElementById('first-steps-summary-modal');
    this.count = doc.getElementById('first-steps-summary-count');
    this.progress = doc.getElementById('first-steps-summary-progress');
    this.save = doc.getElementById('btn-first-steps-save');
    this.explore = doc.getElementById('btn-first-steps-explore');
    this.build = doc.getElementById('btn-first-steps-build');
    this.closeButton = doc.getElementById('btn-first-steps-close');
    this.lifecycle = createModalLifecycle({ doc, modal: this.modal, onClose: () => this.close() });
  }

  init(): void {
    this.win.addEventListener(AUTH_STATE_CHANGED_EVENT, this.onAuth);
    this.win.addEventListener(POST_RUN_GUEST_CLAIM_REQUEST_EVENT, this.onClear);
    this.win.addEventListener(POST_RUN_RATING_REQUEST_EVENT, this.onClear);
    this.win.addEventListener(GUEST_RUN_PROGRESS_CHANGED_EVENT, this.onProgress);
    this.save?.addEventListener('click', this.onSave);
    this.explore?.addEventListener('click', this.onExplore);
    this.build?.addEventListener('click', this.onBuild);
    this.closeButton?.addEventListener('click', this.onClose);
    this.lifecycle.attach();
  }

  destroy(): void {
    this.win.removeEventListener(AUTH_STATE_CHANGED_EVENT, this.onAuth);
    this.win.removeEventListener(POST_RUN_GUEST_CLAIM_REQUEST_EVENT, this.onClear);
    this.win.removeEventListener(POST_RUN_RATING_REQUEST_EVENT, this.onClear);
    this.win.removeEventListener(GUEST_RUN_PROGRESS_CHANGED_EVENT, this.onProgress);
    this.save?.removeEventListener('click', this.onSave);
    this.explore?.removeEventListener('click', this.onExplore);
    this.build?.removeEventListener('click', this.onBuild);
    this.closeButton?.removeEventListener('click', this.onClose);
    this.lifecycle.detach();
    this.reset([]);
  }

  reset(entries: RoomSequenceEntry[]): void {
    this.close(); this.completed = false; this.entries = entries; this.clears.clear();
  }

  finish(): void {
    this.completed = true; this.render(); this.lifecycle.show();
    this.explore?.focus({ preventScroll: true });
  }

  private close(): void { this.lifecycle.hide(); }
  private readonly onClose = () => this.close();
  private readonly onAuth = () => { if (this.completed) this.render(); };
  private readonly onExplore = () => { this.close(); this.actions.explore(); };
  private readonly onBuild = () => { this.close(); this.actions.build(); };
  private readonly onSave = () => {
    this.close(); promptForSignIn('Sign in to save verified clears. New clears can earn XP.');
  };
  private readonly onClear = (event: Event) => {
    const detail = (event as CustomEvent<PostRunRatingRequestDetail>).detail;
    if (this.completed || detail?.contentType !== 'room'
      || !this.entries.some(entry => entry.roomId === detail.contentId && entry.roomVersion === detail.version)) return;
    const previous = this.clears.get(detail.contentId);
    // Replaying cannot replace an already verified clear with an unverified attempt.
    if (previous?.guestProgress?.status !== 'saved') this.clears.set(detail.contentId, detail);
  };
  private readonly onProgress = (event: Event) => {
    const result = (event as CustomEvent<GuestRunSaveResult>).detail;
    for (const clear of this.clears.values()) {
      if (clear.guestProgress?.clientRunId === result?.clientRunId) clear.guestProgress = result;
    }
    if (this.completed) this.render();
  };

  private render(): void {
    const signedIn = getAuthDebugState().authenticated;
    const clears = [...this.clears.values()];
    const verified = clears.filter(clear => clear.guestProgress?.status === 'saved').length;
    const queued = clears.filter(clear => clear.guestProgress?.status === 'queued').length;
    if (this.count) this.count.textContent = `${clears.length} of ${this.entries.length} rooms cleared.`;
    if (this.progress) this.progress.textContent = signedIn
      ? 'Keep exploring, or make a room of your own.'
      : [
        verified ? `${verified} verified clear${verified === 1 ? '' : 's'} ready to save. Sign in within 14 days; new clears can earn XP.` : '',
        queued ? `${queued} clear${queued === 1 ? '' : 's'} waiting to verify. Keep your browser data while we retry.` : '',
        clears.length > verified + queued ? 'Unverified clears need a replay after sign-in to earn XP.' : '',
        !clears.length ? 'Try the rooms again, or make your own.' : '',
      ].filter(Boolean).join(' ');
    this.save?.classList.toggle('hidden', signedIn || !clears.length);
    if (this.save) this.save.textContent = verified ? 'Save Progress' : 'Sign In';
  }
}
