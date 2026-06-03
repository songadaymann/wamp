type ModalLifecycleOptions = {
  doc: Document;
  modal: HTMLElement | null;
  onClose: () => void;
};

export function createModalLifecycle(options: ModalLifecycleOptions) {
  const isOpen = (): boolean => Boolean(
    options.modal && !options.modal.classList.contains('hidden'),
  );

  const handleBackdropClick = (event: Event): void => {
    if (event.target === options.modal) {
      options.onClose();
    }
  };

  const handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !isOpen()) {
      return;
    }

    options.onClose();
  };

  return {
    attach(): void {
      options.modal?.addEventListener('click', handleBackdropClick);
      options.doc.addEventListener('keydown', handleDocumentKeydown);
    },

    detach(): void {
      options.modal?.removeEventListener('click', handleBackdropClick);
      options.doc.removeEventListener('keydown', handleDocumentKeydown);
    },

    show(): boolean {
      if (!options.modal) {
        return false;
      }

      options.modal.classList.remove('hidden');
      options.modal.setAttribute('aria-hidden', 'false');
      return true;
    },

    hide(): boolean {
      if (!options.modal) {
        return false;
      }

      options.modal.classList.add('hidden');
      options.modal.setAttribute('aria-hidden', 'true');
      return true;
    },

    isOpen,
  };
}
