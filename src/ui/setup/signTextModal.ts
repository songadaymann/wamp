import Phaser from 'phaser';
import { getActiveEditorScene } from './sceneBridge';
import {
  SIGN_TEXT_EDIT_REQUEST_EVENT,
  type SignTextEditRequestDetail,
} from '../../signs/events';

type SignTextModalElements = {
  modal: HTMLElement | null;
  title: HTMLElement | null;
  meta: HTMLElement | null;
  input: HTMLTextAreaElement | null;
  counter: HTMLElement | null;
  status: HTMLElement | null;
  error: HTMLElement | null;
  closeButton: HTMLButtonElement | null;
  cancelButton: HTMLButtonElement | null;
  clearButton: HTMLButtonElement | null;
  saveButton: HTMLButtonElement | null;
};

export class SignTextModalController {
  private readonly elements: SignTextModalElements;
  private activeRequest: SignTextEditRequestDetail | null = null;
  private saving = false;

  private readonly handleCloseClick = (): void => {
    this.close();
  };

  private readonly handleBackdropClick = (event: Event): void => {
    if (event.target === this.elements.modal) {
      this.close();
    }
  };

  private readonly handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.elements.modal?.classList.contains('hidden')) {
      return;
    }

    this.close();
  };

  private readonly handleOpenRequest = (event: Event): void => {
    const detail =
      event instanceof CustomEvent
        ? (event.detail as SignTextEditRequestDetail | undefined)
        : undefined;
    if (!detail) {
      return;
    }

    this.open(detail);
  };

  constructor(
    private readonly game: Phaser.Game,
    private readonly doc: Document = document,
    private readonly windowObj: Window = window,
  ) {
    this.elements = {
      modal: this.doc.getElementById('sign-text-modal'),
      title: this.doc.getElementById('sign-text-title'),
      meta: this.doc.getElementById('sign-text-meta'),
      input: this.doc.getElementById('sign-text-input') as HTMLTextAreaElement | null,
      counter: this.doc.getElementById('sign-text-counter'),
      status: this.doc.getElementById('sign-text-status'),
      error: this.doc.getElementById('sign-text-error'),
      closeButton: this.doc.getElementById('btn-sign-text-close') as HTMLButtonElement | null,
      cancelButton: this.doc.getElementById('btn-sign-text-cancel') as HTMLButtonElement | null,
      clearButton: this.doc.getElementById('btn-sign-text-clear') as HTMLButtonElement | null,
      saveButton: this.doc.getElementById('btn-sign-text-save') as HTMLButtonElement | null,
    };
  }

  init(): void {
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.cancelButton?.addEventListener('click', this.handleCloseClick);
    this.elements.clearButton?.addEventListener('click', () => {
      if (!this.elements.input) {
        return;
      }

      this.elements.input.value = '';
      this.render();
      this.elements.input.focus();
    });
    this.elements.saveButton?.addEventListener('click', () => {
      void this.submit();
    });
    this.elements.input?.addEventListener('input', () => {
      this.render();
    });
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    this.windowObj.addEventListener(
      SIGN_TEXT_EDIT_REQUEST_EVENT,
      this.handleOpenRequest as EventListener,
    );
  }

  destroy(): void {
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.cancelButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    this.windowObj.removeEventListener(
      SIGN_TEXT_EDIT_REQUEST_EVENT,
      this.handleOpenRequest as EventListener,
    );
  }

  private open(detail: SignTextEditRequestDetail): void {
    if (!this.elements.modal) {
      return;
    }

    this.activeRequest = detail;
    this.saving = false;
    this.setError(null);
    if (this.elements.input) {
      this.elements.input.value = detail.currentText;
      this.elements.input.maxLength = detail.maxLength;
    }
    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
    this.render();
    this.windowObj.setTimeout(() => {
      this.elements.input?.focus();
      this.elements.input?.setSelectionRange(
        this.elements.input.value.length,
        this.elements.input.value.length,
      );
    }, 0);
  }

  close(): void {
    if (!this.elements.modal) {
      return;
    }

    this.elements.modal.classList.add('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'true');
    this.activeRequest = null;
    this.saving = false;
    this.setError(null);
  }

  private async submit(): Promise<void> {
    if (!this.activeRequest || this.saving) {
      return;
    }

    const scene = getActiveEditorScene(this.game);
    if (!scene?.setPlacedSignText) {
      this.setError('Sign editing is unavailable right now.');
      return;
    }

    this.saving = true;
    this.setError(null);
    this.render();
    try {
      const updated = await scene.setPlacedSignText(
        this.activeRequest.instanceId,
        this.elements.input?.value ?? '',
      );
      if (!updated) {
        this.setError('That sign could not be updated.');
        return;
      }
      this.close();
    } catch (error) {
      this.setError(error instanceof Error ? error.message : 'Failed to save sign text.');
    } finally {
      this.saving = false;
      if (this.activeRequest) {
        this.render();
      }
    }
  }

  private render(): void {
    if (!this.activeRequest) {
      return;
    }

    const currentLength = this.elements.input?.value.length ?? 0;
    const maxLength = this.activeRequest.maxLength;
    if (this.elements.title) {
      this.elements.title.textContent = `${this.activeRequest.objectLabel} Text`;
    }
    if (this.elements.meta) {
      this.elements.meta.textContent = this.activeRequest.contextHint
        ? `${this.activeRequest.contextHint} · Players see this when they walk by.`
        : 'Players see this when they walk by.';
    }
    if (this.elements.counter) {
      this.elements.counter.textContent = `${currentLength}/${maxLength}`;
    }
    if (this.elements.status) {
      this.elements.status.textContent = 'Leave it blank to keep the sign silent during play.';
    }
    if (this.elements.clearButton) {
      this.elements.clearButton.disabled = currentLength === 0 || this.saving;
    }
    if (this.elements.saveButton) {
      this.elements.saveButton.disabled = this.saving;
      this.elements.saveButton.textContent = this.saving ? 'Saving...' : 'Save Text';
    }
  }

  private setError(message: string | null): void {
    if (!this.elements.error) {
      return;
    }

    this.elements.error.textContent = message ?? '';
    this.elements.error.classList.toggle('hidden', !message);
  }
}
