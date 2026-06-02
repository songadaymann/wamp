import Phaser from 'phaser';
import {
  getAuthDebugState,
  promptForSignIn,
} from '../../auth/client';
import type { RoomSnapshot } from '../../persistence/roomModel';
import {
  buildWampOGramShareUrl,
} from '../../wampOGram/links';
import {
  WAMP_O_GRAM_MAX_MESSAGE_LENGTH,
  WAMP_O_GRAM_MAX_NAME_LENGTH,
  WAMP_O_GRAM_MAX_OCCASION_LENGTH,
  WAMP_O_GRAM_MAX_TITLE_LENGTH,
  normalizeWampOGramPostcardFields,
  type WampOGramPostcardFields,
} from '../../wampOGram/model';
import {
  createWampOGramRepository,
  type WampOGramRepository,
} from '../../wampOGram/repository';
import { renderWampOGramPostcardToPngDataUrl } from '../../wampOGram/render';
import { getActiveEditorScene } from './sceneBridge';

type WampOGramElements = {
  openButton: HTMLButtonElement | null;
  modal: HTMLElement | null;
  closeButton: HTMLButtonElement | null;
  createButton: HTMLButtonElement | null;
  copyButton: HTMLButtonElement | null;
  downloadButton: HTMLButtonElement | null;
  openLinkButton: HTMLButtonElement | null;
  titleInput: HTMLInputElement | null;
  recipientNameInput: HTMLInputElement | null;
  recipientEmailInput: HTMLInputElement | null;
  senderNameInput: HTMLInputElement | null;
  occasionInput: HTMLInputElement | null;
  messageInput: HTMLTextAreaElement | null;
  previewImage: HTMLImageElement | null;
  previewPlaceholder: HTMLElement | null;
  shareLinkInput: HTMLInputElement | null;
  status: HTMLElement | null;
};

export class WampOGramModalController {
  private readonly elements: WampOGramElements;
  private activeSnapshot: RoomSnapshot | null = null;
  private previewDataUrl: string | null = null;
  private shareUrl: string | null = null;
  private previewToken = 0;
  private createInFlight = false;

  private readonly handleOpenClick = () => {
    void this.open();
  };

  private readonly handleCloseClick = () => {
    this.close();
  };

  private readonly handleBackdropClick = (event: Event) => {
    if (event.target === this.elements.modal) {
      this.close();
    }
  };

  private readonly handleDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || this.elements.modal?.classList.contains('hidden')) {
      return;
    }

    this.close();
  };

  private readonly handleFieldInput = () => {
    this.shareUrl = null;
    this.renderShareLink();
    this.schedulePreviewRender();
  };

  private readonly handleCreateClick = () => {
    void this.createWampOGram();
  };

  private readonly handleCopyClick = () => {
    void this.copyShareLink();
  };

  private readonly handleDownloadClick = () => {
    this.downloadPreview();
  };

  private readonly handleOpenLinkClick = () => {
    if (this.shareUrl) {
      window.open(this.shareUrl, '_blank', 'noopener');
    }
  };

  constructor(
    private readonly game: Phaser.Game,
    private readonly repository: WampOGramRepository = createWampOGramRepository(),
    private readonly doc: Document = document,
  ) {
    this.elements = {
      openButton: this.doc.getElementById('btn-wamp-o-gram') as HTMLButtonElement | null,
      modal: this.doc.getElementById('wamp-o-gram-modal'),
      closeButton: this.doc.getElementById('btn-wamp-o-gram-close') as HTMLButtonElement | null,
      createButton: this.doc.getElementById('btn-wamp-o-gram-create') as HTMLButtonElement | null,
      copyButton: this.doc.getElementById('btn-wamp-o-gram-copy') as HTMLButtonElement | null,
      downloadButton: this.doc.getElementById('btn-wamp-o-gram-download') as HTMLButtonElement | null,
      openLinkButton: this.doc.getElementById('btn-wamp-o-gram-open') as HTMLButtonElement | null,
      titleInput: this.doc.getElementById('wamp-o-gram-title') as HTMLInputElement | null,
      recipientNameInput: this.doc.getElementById('wamp-o-gram-recipient-name') as HTMLInputElement | null,
      recipientEmailInput: this.doc.getElementById('wamp-o-gram-recipient-email') as HTMLInputElement | null,
      senderNameInput: this.doc.getElementById('wamp-o-gram-sender-name') as HTMLInputElement | null,
      occasionInput: this.doc.getElementById('wamp-o-gram-occasion') as HTMLInputElement | null,
      messageInput: this.doc.getElementById('wamp-o-gram-message') as HTMLTextAreaElement | null,
      previewImage: this.doc.getElementById('wamp-o-gram-preview-image') as HTMLImageElement | null,
      previewPlaceholder: this.doc.getElementById('wamp-o-gram-preview-placeholder'),
      shareLinkInput: this.doc.getElementById('wamp-o-gram-share-link') as HTMLInputElement | null,
      status: this.doc.getElementById('wamp-o-gram-status'),
    };
  }

  init(): void {
    this.elements.openButton?.addEventListener('click', this.handleOpenClick);
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.elements.createButton?.addEventListener('click', this.handleCreateClick);
    this.elements.copyButton?.addEventListener('click', this.handleCopyClick);
    this.elements.downloadButton?.addEventListener('click', this.handleDownloadClick);
    this.elements.openLinkButton?.addEventListener('click', this.handleOpenLinkClick);
    for (const input of this.getFieldElements()) {
      input.addEventListener('input', this.handleFieldInput);
    }
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
  }

  close(): void {
    this.elements.modal?.classList.add('hidden');
    this.elements.modal?.setAttribute('aria-hidden', 'true');
  }

  async open(): Promise<void> {
    if (!this.elements.modal) {
      return;
    }

    const scene = getActiveEditorScene(this.game);
    const snapshot = scene?.exportWampOGramRoomSnapshot?.() ?? null;
    this.activeSnapshot = snapshot;
    this.previewDataUrl = null;
    this.shareUrl = null;
    this.populateDefaults(snapshot);
    this.renderShareLink();
    this.setStatus(snapshot ? '' : 'Open a normal room editor before making a Wamp-O-Gram.', 'error');
    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');

    if (snapshot) {
      await this.renderPreview();
    }
  }

  private populateDefaults(snapshot: RoomSnapshot | null): void {
    const auth = getAuthDebugState();
    setInputValue(this.elements.titleInput, snapshot?.title ?? '');
    setInputValue(this.elements.senderNameInput, auth.user?.displayName ?? '');
    setInputValue(this.elements.recipientNameInput, '');
    setInputValue(this.elements.recipientEmailInput, '');
    setInputValue(this.elements.occasionInput, '');
    setTextAreaValue(this.elements.messageInput, '');
  }

  private schedulePreviewRender(): void {
    const token = this.previewToken + 1;
    this.previewToken = token;
    window.setTimeout(() => {
      if (this.previewToken === token) {
        void this.renderPreview(token);
      }
    }, 120);
  }

  private async renderPreview(expectedToken = this.previewToken): Promise<void> {
    const snapshot = this.activeSnapshot;
    if (!snapshot) {
      return;
    }

    const token = expectedToken;
    this.previewToken = token;
    this.previewDataUrl = null;
    this.renderPreviewState('Rendering...');

    try {
      const dataUrl = await renderWampOGramPostcardToPngDataUrl(
        snapshot,
        this.readPostcardFieldsForPreview(),
      );
      if (this.previewToken !== token) {
        return;
      }
      this.previewDataUrl = dataUrl;
      if (this.elements.previewImage) {
        this.elements.previewImage.src = dataUrl;
        this.elements.previewImage.classList.remove('hidden');
      }
      this.elements.previewPlaceholder?.classList.add('hidden');
      this.syncButtons();
    } catch (error) {
      if (this.previewToken !== token) {
        return;
      }
      this.renderPreviewState('Preview failed.');
      this.setStatus(error instanceof Error ? error.message : 'Preview failed.', 'error');
    }
  }

  private async createWampOGram(): Promise<void> {
    const snapshot = this.activeSnapshot;
    if (!snapshot || this.createInFlight) {
      return;
    }

    if (!getAuthDebugState().authenticated) {
      promptForSignIn('Sign in to create a Wamp-O-Gram link.');
      return;
    }

    let postcard: WampOGramPostcardFields;
    try {
      postcard = normalizeWampOGramPostcardFields(this.readRawPostcardFields());
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Check the Wamp-O-Gram fields.', 'error');
      return;
    }

    this.setCreateInFlight(true);
    this.setStatus('Creating link...', 'default');
    try {
      const record = await this.repository.create({
        postcard,
        roomSnapshot: snapshot,
      });
      this.shareUrl = buildWampOGramShareUrl(record.slug, window.location.href);
      this.renderShareLink();
      await this.copyShareLink({ silent: true });
      this.setStatus('Link ready.', 'default');
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Could not create Wamp-O-Gram.', 'error');
    } finally {
      this.setCreateInFlight(false);
    }
  }

  private async copyShareLink(options: { silent?: boolean } = {}): Promise<void> {
    if (!this.shareUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(this.shareUrl);
      if (!options.silent) {
        this.setStatus('Link copied.', 'default');
      }
    } catch {
      this.elements.shareLinkInput?.select();
      if (!options.silent) {
        this.setStatus('Copy the selected link.', 'default');
      }
    }
  }

  private downloadPreview(): void {
    if (!this.previewDataUrl) {
      return;
    }

    const anchor = this.doc.createElement('a');
    anchor.href = this.previewDataUrl;
    anchor.download = 'wamp-o-gram.png';
    anchor.click();
  }

  private readRawPostcardFields(): WampOGramPostcardFields {
    return {
      title: readInput(this.elements.titleInput),
      recipientName: readInput(this.elements.recipientNameInput),
      recipientEmail: readInput(this.elements.recipientEmailInput),
      senderName: readInput(this.elements.senderNameInput),
      message: readInput(this.elements.messageInput),
      occasion: readInput(this.elements.occasionInput),
    };
  }

  private readPostcardFieldsForPreview(): WampOGramPostcardFields {
    return {
      title: readLimitedInput(this.elements.titleInput, WAMP_O_GRAM_MAX_TITLE_LENGTH),
      recipientName: readLimitedInput(this.elements.recipientNameInput, WAMP_O_GRAM_MAX_NAME_LENGTH),
      recipientEmail: null,
      senderName: readLimitedInput(this.elements.senderNameInput, WAMP_O_GRAM_MAX_NAME_LENGTH),
      message: readLimitedInput(this.elements.messageInput, WAMP_O_GRAM_MAX_MESSAGE_LENGTH),
      occasion: readLimitedInput(this.elements.occasionInput, WAMP_O_GRAM_MAX_OCCASION_LENGTH),
    };
  }

  private renderPreviewState(text: string): void {
    if (this.elements.previewImage) {
      this.elements.previewImage.classList.add('hidden');
      this.elements.previewImage.removeAttribute('src');
    }
    if (this.elements.previewPlaceholder) {
      this.elements.previewPlaceholder.textContent = text;
      this.elements.previewPlaceholder.classList.remove('hidden');
    }
    this.syncButtons();
  }

  private renderShareLink(): void {
    if (this.elements.shareLinkInput) {
      this.elements.shareLinkInput.value = this.shareUrl ?? '';
    }
    this.syncButtons();
  }

  private setCreateInFlight(value: boolean): void {
    this.createInFlight = value;
    this.syncButtons();
  }

  private syncButtons(): void {
    const hasSnapshot = Boolean(this.activeSnapshot);
    const hasShareUrl = Boolean(this.shareUrl);
    if (this.elements.createButton) {
      this.elements.createButton.disabled = !hasSnapshot || this.createInFlight;
      this.elements.createButton.textContent = this.createInFlight ? 'Creating...' : 'Create Link';
    }
    if (this.elements.copyButton) {
      this.elements.copyButton.disabled = !hasShareUrl;
    }
    if (this.elements.openLinkButton) {
      this.elements.openLinkButton.disabled = !hasShareUrl;
    }
    if (this.elements.downloadButton) {
      this.elements.downloadButton.disabled = !this.previewDataUrl;
    }
  }

  private setStatus(text: string, tone: 'default' | 'error'): void {
    if (!this.elements.status) {
      return;
    }

    this.elements.status.textContent = text;
    this.elements.status.classList.toggle('hidden', !text);
    this.elements.status.dataset.wampOGramTone = tone;
  }

  private getFieldElements(): Array<HTMLInputElement | HTMLTextAreaElement> {
    return [
      this.elements.titleInput,
      this.elements.recipientNameInput,
      this.elements.recipientEmailInput,
      this.elements.senderNameInput,
      this.elements.occasionInput,
      this.elements.messageInput,
    ].filter((input): input is HTMLInputElement | HTMLTextAreaElement => Boolean(input));
  }
}

function setInputValue(input: HTMLInputElement | null, value: string): void {
  if (input) {
    input.value = value;
  }
}

function setTextAreaValue(input: HTMLTextAreaElement | null, value: string): void {
  if (input) {
    input.value = value;
  }
}

function readInput(input: HTMLInputElement | HTMLTextAreaElement | null): string | null {
  const value = input?.value.trim() ?? '';
  return value || null;
}

function readLimitedInput(
  input: HTMLInputElement | HTMLTextAreaElement | null,
  maxLength: number,
): string | null {
  const value = input?.value.replace(/\s+/g, ' ').trim() ?? '';
  return value ? value.slice(0, maxLength) : null;
}
