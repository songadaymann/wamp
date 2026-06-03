import { createModalLifecycle } from './modalLifecycle';

type AboutModalElements = {
  modal: HTMLElement | null;
  closeButton: HTMLElement | null;
  skillLink: HTMLAnchorElement | null;
  copySkillUrlButton: HTMLButtonElement | null;
  copyStatus: HTMLElement | null;
};

export class AboutModalController {
  private readonly elements: AboutModalElements;
  private readonly lifecycle: ReturnType<typeof createModalLifecycle>;
  private copyStatusResetTimer: number | null = null;

  private readonly handleCloseClick = () => {
    this.close();
  };

  private readonly handleCopySkillUrlClick = () => {
    void this.copySkillUrl();
  };

  constructor(
    private readonly doc: Document = document,
  ) {
    this.elements = {
      modal: this.doc.getElementById('about-modal'),
      closeButton: this.doc.getElementById('btn-about-close'),
      skillLink: this.doc.getElementById('about-skill-link') as HTMLAnchorElement | null,
      copySkillUrlButton: this.doc.getElementById('btn-about-copy-skill-url') as HTMLButtonElement | null,
      copyStatus: this.doc.getElementById('about-copy-status'),
    };
    this.lifecycle = createModalLifecycle({
      doc: this.doc,
      modal: this.elements.modal,
      onClose: () => this.close(),
    });
  }

  init(): void {
    this.syncSkillLinkHref();
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.copySkillUrlButton?.addEventListener('click', this.handleCopySkillUrlClick);
    this.lifecycle.attach();
  }

  destroy(): void {
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.copySkillUrlButton?.removeEventListener('click', this.handleCopySkillUrlClick);
    this.lifecycle.detach();
    this.clearCopyStatusResetTimer();
    this.close();
  }

  open(): void {
    this.lifecycle.show();
  }

  close(): void {
    this.lifecycle.hide();
  }

  private syncSkillLinkHref(): void {
    if (!this.elements.skillLink || typeof window === 'undefined') {
      return;
    }

    this.elements.skillLink.href = this.getSkillUrl();
  }

  private getSkillUrl(): string {
    return new URL('./skill.md', window.location.href).toString();
  }

  private async copySkillUrl(): Promise<void> {
    const skillUrl = this.getSkillUrl();

    try {
      await navigator.clipboard.writeText(skillUrl);
      this.setCopyStatus('Skill URL copied.');
    } catch {
      this.setCopyStatus(`Skill URL: ${skillUrl}`);
    }
  }

  private setCopyStatus(message: string): void {
    if (!this.elements.copyStatus) {
      return;
    }

    this.elements.copyStatus.textContent = message;
    this.elements.copyStatus.classList.remove('hidden');
    this.clearCopyStatusResetTimer();
    this.copyStatusResetTimer = window.setTimeout(() => {
      this.elements.copyStatus?.classList.add('hidden');
      if (this.elements.copyStatus) {
        this.elements.copyStatus.textContent = '';
      }
      this.copyStatusResetTimer = null;
    }, 2600);
  }

  private clearCopyStatusResetTimer(): void {
    if (this.copyStatusResetTimer === null) {
      return;
    }

    window.clearTimeout(this.copyStatusResetTimer);
    this.copyStatusResetTimer = null;
  }
}
