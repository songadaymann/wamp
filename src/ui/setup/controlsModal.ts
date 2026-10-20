import { createModalLifecycle } from './modalLifecycle';
import { KeyboardBindingsEditor } from './keyboardBindingsEditor';

type ControlsModalElements = {
  modal: HTMLElement | null;
  closeButton: HTMLElement | null;
};

export class ControlsModalController {
  private readonly elements: ControlsModalElements;
  private readonly lifecycle: ReturnType<typeof createModalLifecycle>;
  private readonly bindings: KeyboardBindingsEditor;

  private readonly handleCloseClick = () => {
    this.close();
  };

  constructor(
    private readonly doc: Document = document,
  ) {
    this.bindings = new KeyboardBindingsEditor(this.doc);
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
    this.bindings.init();
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.lifecycle.attach();
  }

  destroy(): void {
    this.bindings.destroy();
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.lifecycle.detach();
    this.close();
  }

  open(): void {
    this.bindings.open();
    this.lifecycle.show();
  }

  close(): void {
    this.bindings.cancel();
    this.lifecycle.hide();
  }
}
