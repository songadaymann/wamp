type AboutModalElements = {
  modal: HTMLElement | null;
  closeButton: HTMLElement | null;
};

export class AboutModalController {
  private readonly elements: AboutModalElements;

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

  constructor(
    private readonly doc: Document = document,
  ) {
    this.elements = {
      modal: this.doc.getElementById('about-modal'),
      closeButton: this.doc.getElementById('btn-about-close'),
    };
  }

  init(): void {
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
  }

  destroy(): void {
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    this.close();
  }

  open(): void {
    if (!this.elements.modal) {
      return;
    }

    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
  }

  close(): void {
    if (!this.elements.modal) {
      return;
    }

    this.elements.modal.classList.add('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'true');
  }
}
