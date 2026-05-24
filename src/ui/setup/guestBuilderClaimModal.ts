import { getAuthDebugState, promptForSignIn } from '../../auth/client';
import { submitLatestGuestRoomDraftForRoom } from '../../guestRooms/client';
import {
  GUEST_BUILDER_CLAIM_REQUEST_EVENT,
  GUEST_BUILDER_POTENTIAL_BXP,
  type GuestBuilderClaimRequestDetail,
} from '../../progression/guestBuilderClaimEvents';

const STORAGE_KEY = 'wamp_guest_builder_claim_prompt_seen_v1';
const inMemorySeenRoomIds = new Set<string>();

type GuestBuilderClaimElements = {
  modal: HTMLElement | null;
  closeButton: HTMLButtonElement | null;
  keepBuildingButton: HTMLButtonElement | null;
  submitGuestButton: HTMLButtonElement | null;
  signInButton: HTMLButtonElement | null;
  title: HTMLElement | null;
  meta: HTMLElement | null;
  xp: HTMLElement | null;
  copy: HTMLElement | null;
};

export class GuestBuilderClaimModalController {
  private readonly elements: GuestBuilderClaimElements;
  private activeDetail: GuestBuilderClaimRequestDetail | null = null;

  private readonly handleCloseClick = () => {
    this.close();
  };

  private readonly handleSignInClick = (event: Event) => {
    event.stopPropagation();
    this.close();
    promptForSignIn('Sign in to save this room to your account and earn Builder XP when you publish.');
  };

  private readonly handleSubmitGuestClick = async (event: Event) => {
    event.stopPropagation();
    const detail = this.activeDetail;
    if (!detail) {
      return;
    }

    this.setText(this.elements.copy, 'Publishing to Guest Rooms...');
    this.elements.submitGuestButton?.setAttribute('disabled', 'true');
    try {
      await submitLatestGuestRoomDraftForRoom(detail.roomId);
      this.setText(
        this.elements.copy,
        'Published to Guest Rooms. People can play it there, but guest-published rooms do not earn XP or account benefits.',
      );
      window.setTimeout(() => this.close(), 1200);
    } catch (error) {
      this.setText(
        this.elements.copy,
        error instanceof Error ? error.message : 'Could not publish to Guest Rooms.',
      );
      this.elements.submitGuestButton?.removeAttribute('disabled');
    }
  };

  private readonly handleBackdropClick = (event: Event) => {
    if (event.target === this.elements.modal) {
      this.close();
    }
  };

  private readonly handleDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !this.isOpen()) {
      return;
    }

    this.close();
  };

  private readonly handleOpenRequest = (event: Event) => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as GuestBuilderClaimRequestDetail | undefined)
        : undefined;
    if (!detail || getAuthDebugState().authenticated) {
      return;
    }

    if ((detail.source === 'auto-save' || detail.source === 'build-threshold') && this.hasSeen(detail.roomId)) {
      return;
    }

    this.markSeen(detail.roomId);
    this.open(detail);
  };

  constructor(
    private readonly doc: Document = document,
    private readonly storage: Storage | null = window.localStorage,
  ) {
    this.elements = {
      modal: this.doc.getElementById('guest-builder-claim-modal'),
      closeButton: this.doc.getElementById('btn-guest-builder-claim-close') as HTMLButtonElement | null,
      keepBuildingButton: this.doc.getElementById('btn-guest-builder-claim-continue') as HTMLButtonElement | null,
      submitGuestButton: this.doc.getElementById('btn-guest-builder-claim-submit-guest') as HTMLButtonElement | null,
      signInButton: this.doc.getElementById('btn-guest-builder-claim-signin') as HTMLButtonElement | null,
      title: this.doc.getElementById('guest-builder-claim-title'),
      meta: this.doc.getElementById('guest-builder-claim-meta'),
      xp: this.doc.getElementById('guest-builder-claim-xp'),
      copy: this.doc.getElementById('guest-builder-claim-copy'),
    };
  }

  init(): void {
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.keepBuildingButton?.addEventListener('click', this.handleCloseClick);
    this.elements.submitGuestButton?.addEventListener('click', this.handleSubmitGuestClick);
    this.elements.signInButton?.addEventListener('click', this.handleSignInClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    window.addEventListener(
      GUEST_BUILDER_CLAIM_REQUEST_EVENT,
      this.handleOpenRequest as EventListener,
    );
  }

  destroy(): void {
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.keepBuildingButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.submitGuestButton?.removeEventListener('click', this.handleSubmitGuestClick);
    this.elements.signInButton?.removeEventListener('click', this.handleSignInClick);
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    window.removeEventListener(
      GUEST_BUILDER_CLAIM_REQUEST_EVENT,
      this.handleOpenRequest as EventListener,
    );
    this.close();
  }

  isOpen(): boolean {
    return Boolean(this.elements.modal && !this.elements.modal.classList.contains('hidden'));
  }

  private open(detail: GuestBuilderClaimRequestDetail): void {
    if (!this.elements.modal) {
      return;
    }

    this.activeDetail = detail;
    this.render();
    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
  }

  close(): void {
    this.elements.modal?.classList.add('hidden');
    this.elements.modal?.setAttribute('aria-hidden', 'true');
    this.activeDetail = null;
  }

  private render(): void {
    const detail = this.activeDetail;
    const potentialBxp = detail?.potentialBxp ?? GUEST_BUILDER_POTENTIAL_BXP;
    const roomLabel = detail?.roomTitle?.trim()
      || (detail ? `Room ${detail.roomCoordinates.x},${detail.roomCoordinates.y}` : 'this room');
    const metaText = this.getMetaText(detail, roomLabel);

    this.setText(this.elements.title, 'Awesome work!');
    this.setText(this.elements.meta, metaText);
    this.setText(this.elements.xp, `+${potentialBxp} Builder XP`);
    const guestSubmissionAvailable = detail?.source === 'publish-attempt';
    this.elements.submitGuestButton?.classList.toggle('hidden', !guestSubmissionAvailable);
    this.elements.submitGuestButton?.removeAttribute('disabled');
    this.setText(
      this.elements.copy,
      guestSubmissionAvailable
        ? 'Sign in to publish it as yours and earn Builder XP. If you cannot sign in, publish it to Guest Rooms without XP or account benefits.'
        : 'Sign in so you can save this build to your account. Add a challenge goal and publish it to claim Builder XP.',
    );
  }

  private getMetaText(detail: GuestBuilderClaimRequestDetail | null, roomLabel: string): string {
    if (detail?.source === 'publish-attempt') {
      return 'Your draft is safe locally. Sign in to publish it.';
    }

    if (detail?.source === 'build-threshold') {
      const count = Math.max(0, Math.round(detail.buildActivityCount ?? 0));
      return count > 0
        ? `You've placed ${count} tiles and items in ${roomLabel}.`
        : `${roomLabel} is saved locally on this browser.`;
    }

    return `${roomLabel} is saved locally on this browser.`;
  }

  private hasSeen(roomId: string): boolean {
    if (inMemorySeenRoomIds.has(roomId)) {
      return true;
    }

    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) {
        return false;
      }
      const parsed = JSON.parse(raw) as { roomIds?: unknown };
      return Array.isArray(parsed.roomIds) && parsed.roomIds.includes(roomId);
    } catch {
      return false;
    }
  }

  private markSeen(roomId: string): void {
    inMemorySeenRoomIds.add(roomId);
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as { roomIds?: unknown }) : {};
      const roomIds = Array.isArray(parsed.roomIds)
        ? parsed.roomIds.filter((value): value is string => typeof value === 'string')
        : [];
      const nextRoomIds = [roomId, ...roomIds.filter((value) => value !== roomId)].slice(0, 50);
      this.storage?.setItem(STORAGE_KEY, JSON.stringify({ roomIds: nextRoomIds }));
    } catch {
      // The prompt is a conversion aid; storage failures should not block editing.
    }
  }

  private setText(element: HTMLElement | null, value: string): void {
    if (element) {
      element.textContent = value;
    }
  }
}
