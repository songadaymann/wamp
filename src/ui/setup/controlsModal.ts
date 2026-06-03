import { createModalLifecycle } from './modalLifecycle';

type ControlsModalElements = {
  modal: HTMLElement | null;
  closeButton: HTMLElement | null;
};

export class ControlsModalController {
  private readonly elements: ControlsModalElements;
  private readonly lifecycle: ReturnType<typeof createModalLifecycle>;

  private readonly handleCloseClick = () => {
    this.close();
  };

  constructor(
    private readonly doc: Document = document,
  ) {
    this.elements = {
      modal: this.doc.getElementById('controls-modal'),
      closeButton: this.doc.getElementById('btn-controls-close'),
    };
    this.lifecycle = createModalLifecycle({
      doc: this.doc,
      modal: this.elements.modal,
      onClose: () => this.close(),
    });
  }

  init(): void {
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.lifecycle.attach();
  }

  destroy(): void {
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.lifecycle.detach();
    this.close();
  }

  open(): void {
    this.lifecycle.show();
  }

  close(): void {
    this.lifecycle.hide();
  }
}
