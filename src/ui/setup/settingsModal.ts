import {
  getGameSettings,
  subscribeGameSettings,
  updateGameSettings,
  type GameSettings,
  type OverworldPanningStyle,
} from '../../settings/userSettings';

type SettingsModalElements = {
  modal: HTMLElement | null;
  closeButton: HTMLElement | null;
  commentsCheckbox: HTMLInputElement | null;
  musicVolumeInput: HTMLInputElement | null;
  musicVolumeValue: HTMLElement | null;
  sfxVolumeInput: HTMLInputElement | null;
  sfxVolumeValue: HTMLElement | null;
  panningStyleInputs: HTMLInputElement[];
};

export class SettingsModalController {
  private readonly elements: SettingsModalElements;
  private unsubscribeSettings: (() => void) | null = null;

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

  private readonly handleCommentsChange = () => {
    if (!this.elements.commentsCheckbox) {
      return;
    }

    updateGameSettings({
      roomCommentsVisible: this.elements.commentsCheckbox.checked,
    });
  };

  private readonly handleMusicVolumeInput = () => {
    updateGameSettings({
      musicVolume: readVolumeInput(this.elements.musicVolumeInput),
    });
  };

  private readonly handleSfxVolumeInput = () => {
    updateGameSettings({
      sfxVolume: readVolumeInput(this.elements.sfxVolumeInput),
    });
  };

  private readonly handlePanningStyleChange = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.checked) {
      return;
    }

    updateGameSettings({
      panningStyle: normalizePanningStyle(target.value),
    });
  };

  constructor(
    private readonly doc: Document = document,
  ) {
    this.elements = {
      modal: this.doc.getElementById('settings-modal'),
      closeButton: this.doc.getElementById('btn-settings-close'),
      commentsCheckbox: this.doc.getElementById('settings-comments-visible') as HTMLInputElement | null,
      musicVolumeInput: this.doc.getElementById('settings-music-volume') as HTMLInputElement | null,
      musicVolumeValue: this.doc.getElementById('settings-music-volume-value'),
      sfxVolumeInput: this.doc.getElementById('settings-sfx-volume') as HTMLInputElement | null,
      sfxVolumeValue: this.doc.getElementById('settings-sfx-volume-value'),
      panningStyleInputs: Array.from(
        this.doc.querySelectorAll<HTMLInputElement>('input[name="settings-panning-style"]'),
      ),
    };
  }

  init(): void {
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.elements.commentsCheckbox?.addEventListener('change', this.handleCommentsChange);
    this.elements.musicVolumeInput?.addEventListener('input', this.handleMusicVolumeInput);
    this.elements.sfxVolumeInput?.addEventListener('input', this.handleSfxVolumeInput);
    for (const input of this.elements.panningStyleInputs) {
      input.addEventListener('change', this.handlePanningStyleChange);
    }
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    this.unsubscribeSettings = subscribeGameSettings((settings) => this.render(settings));
    this.render(getGameSettings());
  }

  destroy(): void {
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.elements.commentsCheckbox?.removeEventListener('change', this.handleCommentsChange);
    this.elements.musicVolumeInput?.removeEventListener('input', this.handleMusicVolumeInput);
    this.elements.sfxVolumeInput?.removeEventListener('input', this.handleSfxVolumeInput);
    for (const input of this.elements.panningStyleInputs) {
      input.removeEventListener('change', this.handlePanningStyleChange);
    }
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    this.close();
  }

  open(): void {
    if (!this.elements.modal) {
      return;
    }

    this.render(getGameSettings());
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

  private render(settings: GameSettings): void {
    if (this.elements.commentsCheckbox) {
      this.elements.commentsCheckbox.checked = settings.roomCommentsVisible;
    }

    renderVolumeControl(
      this.elements.musicVolumeInput,
      this.elements.musicVolumeValue,
      settings.musicVolume,
    );
    renderVolumeControl(
      this.elements.sfxVolumeInput,
      this.elements.sfxVolumeValue,
      settings.sfxVolume,
    );

    for (const input of this.elements.panningStyleInputs) {
      input.checked = normalizePanningStyle(input.value) === settings.panningStyle;
    }
  }
}

function readVolumeInput(input: HTMLInputElement | null): number {
  if (!input) {
    return 1;
  }

  const value = Number(input.value);
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(1, Math.max(0, value / 100));
}

function renderVolumeControl(
  input: HTMLInputElement | null,
  valueEl: HTMLElement | null,
  volume: number,
): void {
  const percent = Math.round(Math.min(1, Math.max(0, volume)) * 100);
  if (input && input.value !== String(percent)) {
    input.value = String(percent);
  }
  if (valueEl) {
    valueEl.textContent = `${percent}%`;
  }
}

function normalizePanningStyle(value: string): OverworldPanningStyle {
  return value === 'two-finger-drag' ? 'two-finger-drag' : 'option-drag';
}
