import Phaser from 'phaser';
import {
  AUTH_SESSION_REFRESHED_EVENT,
  AUTH_STATE_CHANGED_EVENT,
  getAuthDebugState,
  promptForSignIn,
} from '../../auth/client';
import {
  listMyGuestRoomDrafts,
  loadGuestRoomDraft,
  submitGuestRoomDraft,
} from '../../guestRooms/client';
import type { GuestRoomDraftSummary } from '../../guestRooms/model';
import { renderRoomSnapshotToPngDataUrl } from '../../mint/roomMetadataRender';
import type { RoomSnapshot } from '../../persistence/roomModel';
import { getOverworldScene } from './sceneBridge';

type GuestRoomRecoveryElements = {
  modal: HTMLElement | null;
  closeButton: HTMLButtonElement | null;
  signInButton: HTMLButtonElement | null;
  submitButton: HTMLButtonElement | null;
  goButton: HTMLButtonElement | null;
  title: HTMLElement | null;
  meta: HTMLElement | null;
  preview: HTMLElement | null;
  previewFallback: HTMLElement | null;
  copy: HTMLElement | null;
  status: HTMLElement | null;
};

const PENDING_SIGN_IN_DRAFT_KEY = 'ep_guest_room_recovery_pending_signin_draft_v1';

export class GuestRoomRecoveryModalController {
  private readonly elements: GuestRoomRecoveryElements;
  private activeDraft: GuestRoomDraftSummary | null = null;
  private autoPromptedThisSession = false;
  private loading = false;

  private readonly handleCloseClick = () => this.close();

  private readonly handleSignInClick = () => {
    const draft = this.activeDraft;
    if (!draft) {
      return;
    }

    try {
      window.sessionStorage.setItem(PENDING_SIGN_IN_DRAFT_KEY, draft.id);
    } catch {
      // Pending post-auth resume is best-effort.
    }
    this.close();
    promptForSignIn('Sign in to publish this saved guest room as yours.');
  };

  private readonly handleSubmitClick = async () => {
    const draft = this.activeDraft;
    if (!draft || this.loading) {
      return;
    }

    this.setLoading(true, 'Publishing to Guest Rooms...');
    let published = false;
    try {
      const response = await submitGuestRoomDraft(draft.id);
      this.activeDraft = response.draft;
      published = true;
      this.setStatus('Published to Guest Rooms. It is playable there without XP or account benefits.', false);
      this.elements.submitButton?.setAttribute('disabled', 'true');
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Could not publish to Guest Rooms.', true);
    } finally {
      this.setLoading(false);
      if (published) {
        this.elements.submitButton?.setAttribute('disabled', 'true');
      }
    }
  };

  private readonly handleGoClick = () => {
    const draft = this.activeDraft;
    if (!draft) {
      return;
    }

    this.close();
    this.openDraftInEditor(draft.snapshot);
  };

  private readonly handleAuthStateChanged = () => {
    if (getAuthDebugState().authenticated) {
      void this.openPendingSignInDraft();
    }
  };

  private readonly handleAuthSessionRefreshed = () => {
    void this.maybeOpenReturningGuestDraft();
  };

  constructor(
    private readonly game: Phaser.Game,
    private readonly doc: Document = document,
  ) {
    this.elements = {
      modal: this.doc.getElementById('guest-room-recovery-modal'),
      closeButton: this.doc.getElementById('btn-guest-room-recovery-close') as HTMLButtonElement | null,
      signInButton: this.doc.getElementById('btn-guest-room-recovery-signin') as HTMLButtonElement | null,
      submitButton: this.doc.getElementById('btn-guest-room-recovery-submit') as HTMLButtonElement | null,
      goButton: this.doc.getElementById('btn-guest-room-recovery-go') as HTMLButtonElement | null,
      title: this.doc.getElementById('guest-room-recovery-title'),
      meta: this.doc.getElementById('guest-room-recovery-meta'),
      preview: this.doc.getElementById('guest-room-recovery-preview'),
      previewFallback: this.doc.getElementById('guest-room-recovery-preview-fallback'),
      copy: this.doc.getElementById('guest-room-recovery-copy'),
      status: this.doc.getElementById('guest-room-recovery-status'),
    };
  }

  init(): void {
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.signInButton?.addEventListener('click', this.handleSignInClick);
    this.elements.submitButton?.addEventListener('click', this.handleSubmitClick);
    this.elements.goButton?.addEventListener('click', this.handleGoClick);
    window.addEventListener(AUTH_STATE_CHANGED_EVENT, this.handleAuthStateChanged);
    window.addEventListener(AUTH_SESSION_REFRESHED_EVENT, this.handleAuthSessionRefreshed);
    window.setTimeout(() => {
      void this.maybeOpenReturningGuestDraft();
    }, 3500);
  }

  close(): void {
    this.elements.modal?.classList.add('hidden');
    this.elements.modal?.setAttribute('aria-hidden', 'true');
    this.setStatus('', false);
  }

  private async maybeOpenReturningGuestDraft(): Promise<void> {
    if (this.autoPromptedThisSession || getAuthDebugState().authenticated) {
      return;
    }
    this.autoPromptedThisSession = true;

    try {
      const response = await listMyGuestRoomDrafts();
      const draft = response.drafts.find((candidate) => candidate.status === 'active') ?? null;
      if (draft) {
        await this.open(draft);
      }
    } catch {
      // Guest recovery is best-effort and should not interrupt boot.
    }
  }

  private async openPendingSignInDraft(): Promise<void> {
    let draftId: string | null = null;
    try {
      draftId = window.sessionStorage.getItem(PENDING_SIGN_IN_DRAFT_KEY);
      if (draftId) {
        window.sessionStorage.removeItem(PENDING_SIGN_IN_DRAFT_KEY);
      }
    } catch {
      draftId = null;
    }
    if (!draftId) {
      return;
    }

    try {
      const response = await loadGuestRoomDraft(draftId);
      this.openDraftInEditor(response.draft.snapshot);
    } catch {
      // Token loss or prior submission means there is nothing useful to resume.
    }
  }

  private async open(draft: GuestRoomDraftSummary): Promise<void> {
    this.activeDraft = draft;
    this.render(draft);
    this.elements.modal?.classList.remove('hidden');
    this.elements.modal?.setAttribute('aria-hidden', 'false');
    await this.renderPreview(draft.snapshot);
  }

  private render(draft: GuestRoomDraftSummary): void {
    const roomLabel = `Room ${draft.roomX},${draft.roomY}`;
    const updated = formatShortDate(draft.updatedAt);
    this.setText(this.elements.title, 'You left a room unfinished');
    this.setText(this.elements.meta, updated ? `${roomLabel} - Last edited ${updated}` : roomLabel);
    this.setText(
      this.elements.copy,
      'Your room is still saved for this browser. Sign in to make it yours and publish it in the world.',
    );
    this.elements.signInButton?.removeAttribute('disabled');
    this.elements.submitButton?.removeAttribute('disabled');
    this.elements.goButton?.removeAttribute('disabled');
    this.setStatus('', false);
  }

  private async renderPreview(snapshot: RoomSnapshot): Promise<void> {
    const preview = this.elements.preview;
    if (!preview) {
      return;
    }

    preview.querySelector('img')?.remove();
    this.elements.previewFallback?.classList.remove('hidden');

    try {
      const dataUrl = await renderRoomSnapshotToPngDataUrl(snapshot, { tilePixelSize: 2 });
      if (this.activeDraft?.roomId !== snapshot.id) {
        return;
      }

      const image = this.doc.createElement('img');
      image.src = dataUrl;
      image.alt = 'Saved room preview';
      image.className = 'guest-room-recovery-preview-image';
      preview.appendChild(image);
      this.elements.previewFallback?.classList.add('hidden');
    } catch {
      this.setText(this.elements.previewFallback, `Room ${snapshot.coordinates.x},${snapshot.coordinates.y}`);
    }
  }

  private openDraftInEditor(snapshot: RoomSnapshot): void {
    const overworldScene = getOverworldScene(this.game);
    if (overworldScene?.openGuestDraftRoom) {
      overworldScene.openGuestDraftRoom(snapshot);
      return;
    }

    this.game.scene.stop('EditorScene');
    this.game.scene.run('EditorScene', {
      roomCoordinates: { ...snapshot.coordinates },
      source: 'world',
      roomSnapshot: snapshot,
      forceRoomSnapshot: true,
    });
  }

  private setLoading(loading: boolean, statusText?: string): void {
    this.loading = loading;
    this.elements.signInButton?.toggleAttribute('disabled', loading);
    this.elements.submitButton?.toggleAttribute('disabled', loading);
    this.elements.goButton?.toggleAttribute('disabled', loading);
    if (statusText) {
      this.setStatus(statusText, false);
    }
  }

  private setStatus(text: string, isError: boolean): void {
    if (!this.elements.status) {
      return;
    }

    this.elements.status.textContent = text;
    this.elements.status.classList.toggle('hidden', text.length === 0);
    this.elements.status.classList.toggle('guest-room-recovery-status-error', isError);
  }

  private setText(element: HTMLElement | null, value: string): void {
    if (element) {
      element.textContent = value;
    }
  }
}

function formatShortDate(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(parsed));
}
