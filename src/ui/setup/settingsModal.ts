import { getComfortSettings, subscribeComfortSettings, updateComfortSettings, type ComfortSettings } from '../../settings/comfortSettings';
import { isHapticsAvailable } from '../../feedback/haptics';
import { getFrameRateMode, setFrameRateMode, subscribeFrameRateMode, type FrameRateMode } from '../../performance/frameRateMode';
import {
  getGameSettings,
  subscribeGameSettings,
  updateGameSettings,
  type GameSettings,
  type OverworldPanningStyle,
} from '../../settings/userSettings';
import { resetInspectorWindows } from '../../scenes/editor/inspectorWindows';
import {
  getDevicePerformanceMode,
  setDevicePerformanceMode,
  subscribeDevicePerformanceMode,
  type DevicePerformanceMode,
} from '../../performance/devicePerformanceMode';

type SettingsModalElements = {
  modal: HTMLElement | null;
  closeButton: HTMLElement | null;
  commentsCheckbox: HTMLInputElement | null;
  musicVolumeInput: HTMLInputElement | null;
  musicVolumeValue: HTMLElement | null;
  sfxVolumeInput: HTMLInputElement | null;
  sfxVolumeValue: HTMLElement | null;
  panningStyleInputs: HTMLInputElement[];
  performanceModeInputs: HTMLInputElement[];
  frameRateInputs: HTMLInputElement[];
  builderModeInputs: HTMLInputElement[];
  motionSelect: HTMLSelectElement | null;
  cameraStyleInputs: HTMLInputElement[];
  hapticsRow: HTMLElement | null;
  hapticsCheckbox: HTMLInputElement | null;
  resetOptionWindowsButton: HTMLButtonElement | null;
};

export class SettingsModalController {
  private readonly elements: SettingsModalElements;
  private unsubscribeComfort: (() => void) | null = null;
  private unsubscribeSettings: (() => void) | null = null;
  private unsubscribeFrameRate: (() => void) | null = null;
  private unsubscribePerformanceMode: (() => void) | null = null;

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

  private readonly handlePerformanceModeChange = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.checked) {
      return;
    }

    setDevicePerformanceMode(target.value);
  };

  private readonly handleFrameRateChange = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.checked) setFrameRateMode(target.value);
  };

  private readonly handleBuilderModeChange = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.checked) return;
    updateGameSettings({ builderMode: target.value === 'advanced' ? 'advanced' : 'beginner' });
  };

  private readonly handleMotionChange = () => {
    const value = this.elements.motionSelect?.value;
    updateComfortSettings({ reduceMotion: value === 'on' || value === 'off' ? value : 'system' });
  };
  private readonly handleHapticsChange = () => {
    if (this.elements.hapticsCheckbox) updateComfortSettings({ haptics: this.elements.hapticsCheckbox.checked });
  };
  private readonly handleCameraStyleChange = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.checked)
      updateComfortSettings({ cameraStyle: target.value === 'room' ? 'room' : 'follow' });
  };

  private readonly handleResetOptionWindows = () => {
    resetInspectorWindows();
  };

  constructor(
    private readonly doc: Document = document,
  ) {
    this.elements = {
      modal: this.doc.getElementById('settings-modal'),
      motionSelect: this.doc.getElementById('settings-reduce-motion') as HTMLSelectElement | null,
      hapticsRow: this.doc.getElementById('settings-haptics-row'),
      hapticsCheckbox: this.doc.getElementById('settings-haptics') as HTMLInputElement | null,
      cameraStyleInputs: Array.from(this.doc.querySelectorAll<HTMLInputElement>('input[name="settings-camera-style"]')),
      closeButton: this.doc.getElementById('btn-settings-close'),
      commentsCheckbox: this.doc.getElementById('settings-comments-visible') as HTMLInputElement | null,
      musicVolumeInput: this.doc.getElementById('settings-music-volume') as HTMLInputElement | null,
      musicVolumeValue: this.doc.getElementById('settings-music-volume-value'),
      sfxVolumeInput: this.doc.getElementById('settings-sfx-volume') as HTMLInputElement | null,
      sfxVolumeValue: this.doc.getElementById('settings-sfx-volume-value'),
      panningStyleInputs: Array.from(
        this.doc.querySelectorAll<HTMLInputElement>('input[name="settings-panning-style"]'),
      ),
      performanceModeInputs: Array.from(
        this.doc.querySelectorAll<HTMLInputElement>('input[name="settings-performance-mode"]'),
      ),
      frameRateInputs: Array.from(this.doc.querySelectorAll<HTMLInputElement>('input[name="settings-frame-rate"]')),
      builderModeInputs: Array.from(
        this.doc.querySelectorAll<HTMLInputElement>('input[name="settings-builder-mode"]'),
      ),
      resetOptionWindowsButton: this.doc.getElementById('btn-settings-reset-option-windows') as HTMLButtonElement | null,
    };
  }

  init(): void {
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.motionSelect?.addEventListener('change', this.handleMotionChange);
    this.elements.hapticsCheckbox?.addEventListener('change', this.handleHapticsChange);
    for (const input of this.elements.cameraStyleInputs) input.addEventListener('change', this.handleCameraStyleChange);
    this.unsubscribeComfort = subscribeComfortSettings(settings => this.renderComfort(settings));
    this.renderComfort(getComfortSettings());
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.elements.commentsCheckbox?.addEventListener('change', this.handleCommentsChange);
    this.elements.musicVolumeInput?.addEventListener('input', this.handleMusicVolumeInput);
    this.elements.sfxVolumeInput?.addEventListener('input', this.handleSfxVolumeInput);
    for (const input of this.elements.panningStyleInputs) {
      input.addEventListener('change', this.handlePanningStyleChange);
    }
    for (const input of this.elements.performanceModeInputs) {
      input.addEventListener('change', this.handlePerformanceModeChange);
    }
    for (const input of this.elements.builderModeInputs) {
      input.addEventListener('change', this.handleBuilderModeChange);
    }
    this.elements.resetOptionWindowsButton?.addEventListener('click', this.handleResetOptionWindows);
    for (const input of this.elements.frameRateInputs) input.addEventListener('change', this.handleFrameRateChange);
    this.unsubscribeFrameRate = subscribeFrameRateMode(mode => this.renderFrameRate(mode));
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    this.unsubscribeSettings = subscribeGameSettings((settings) => this.render(settings));
    this.unsubscribePerformanceMode = subscribeDevicePerformanceMode(({ mode }) => {
      this.renderPerformanceMode(mode);
    });
    this.render(getGameSettings());
    this.renderPerformanceMode(getDevicePerformanceMode());
    this.renderFrameRate(getFrameRateMode());
  }

  destroy(): void {
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.motionSelect?.removeEventListener('change', this.handleMotionChange);
    this.elements.hapticsCheckbox?.removeEventListener('change', this.handleHapticsChange);
    for (const input of this.elements.cameraStyleInputs) input.removeEventListener('change', this.handleCameraStyleChange);
    this.unsubscribeComfort?.(); this.unsubscribeComfort = null;
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.elements.commentsCheckbox?.removeEventListener('change', this.handleCommentsChange);
    this.elements.musicVolumeInput?.removeEventListener('input', this.handleMusicVolumeInput);
    this.elements.sfxVolumeInput?.removeEventListener('input', this.handleSfxVolumeInput);
    for (const input of this.elements.panningStyleInputs) {
      input.removeEventListener('change', this.handlePanningStyleChange);
    }
    for (const input of this.elements.performanceModeInputs) {
      input.removeEventListener('change', this.handlePerformanceModeChange);
    }
    for (const input of this.elements.builderModeInputs) {
      input.removeEventListener('change', this.handleBuilderModeChange);
    }
    this.elements.resetOptionWindowsButton?.removeEventListener('click', this.handleResetOptionWindows);
    for (const input of this.elements.frameRateInputs) input.removeEventListener('change', this.handleFrameRateChange);
    this.unsubscribeFrameRate?.(); this.unsubscribeFrameRate = null;
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    this.unsubscribePerformanceMode?.();
    this.unsubscribePerformanceMode = null;
    this.close();
  }

  open(): void {
    if (!this.elements.modal) {
      return;
    }

    this.render(getGameSettings());
    this.renderPerformanceMode(getDevicePerformanceMode());
    this.renderFrameRate(getFrameRateMode());
    this.renderComfort(getComfortSettings());
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
    this.doc.body.dataset.builderMode = settings.builderMode === 'advanced' ? 'advanced' : 'beginner';
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
    for (const input of this.elements.builderModeInputs) {
      input.checked = input.value === (settings.builderMode === 'advanced' ? 'advanced' : 'beginner');
    }
  }

  private renderComfort(settings: ComfortSettings): void {
    this.elements.hapticsRow?.classList.toggle('hidden', !isHapticsAvailable());
    if (this.elements.hapticsCheckbox) this.elements.hapticsCheckbox.checked = settings.haptics;
    if (this.elements.motionSelect) this.elements.motionSelect.value = settings.reduceMotion;
    for (const input of this.elements.cameraStyleInputs) input.checked = input.value === settings.cameraStyle;
  }

  private renderFrameRate(mode: FrameRateMode): void {
    for (const input of this.elements.frameRateInputs) input.checked = input.value === mode;
  }

  private renderPerformanceMode(mode: DevicePerformanceMode): void {
    for (const input of this.elements.performanceModeInputs) {
      input.checked = input.value === mode;
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
