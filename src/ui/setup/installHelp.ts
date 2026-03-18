import { isPlayfunMode } from '../../playfun/client';
import { APP_READY_EVENT, isAppReady, isBusyOverlayVisible } from '../appFeedback';
import { DEVICE_LAYOUT_CHANGED_EVENT, getDeviceLayoutState } from '../deviceLayout';

const INSTALL_HELP_DISMISSED_STORAGE_KEY = 'wamp_install_help_dismissed_v1';
const INSTALL_HELP_AUTO_OPEN_DELAY_MS = 900;

type InstallHelpTarget = 'safari-share' | 'browser-menu' | 'generic';

type InstallHelpElements = {
  modal: HTMLElement | null;
  closeButton: HTMLButtonElement | null;
  gotItButton: HTMLButtonElement | null;
  openButton: HTMLButtonElement | null;
  rotateGateOpenButton: HTMLButtonElement | null;
  authPanel: HTMLElement | null;
};

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

export class InstallHelpController {
  private readonly elements: InstallHelpElements;
  private autoOpenTimer: number | null = null;
  private dismissed = false;
  private autoOpened = false;

  private readonly handleOpenClick = () => {
    this.open();
  };

  private readonly handleCloseClick = () => {
    this.close(true);
  };

  private readonly handleBackdropClick = (event: Event) => {
    if (event.target === this.elements.modal) {
      this.close(true);
    }
  };

  private readonly handleDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || this.elements.modal?.classList.contains('hidden')) {
      return;
    }

    this.close(true);
  };

  private readonly handleAppReady = () => {
    this.scheduleAutoOpen();
  };

  private readonly handleDeviceLayoutChanged = () => {
    this.render();
    this.scheduleAutoOpen();
  };

  private readonly handleVisibilityChange = () => {
    if (this.doc.visibilityState !== 'visible') {
      return;
    }

    this.render();
    this.scheduleAutoOpen();
  };

  constructor(
    private readonly doc: Document = document,
    private readonly windowObj: Window = window,
  ) {
    this.elements = {
      modal: this.doc.getElementById('install-help-modal'),
      closeButton: this.doc.getElementById('btn-install-help-close') as HTMLButtonElement | null,
      gotItButton: this.doc.getElementById('btn-install-help-got-it') as HTMLButtonElement | null,
      openButton: this.doc.getElementById('btn-install-help-open') as HTMLButtonElement | null,
      rotateGateOpenButton: this.doc.getElementById('btn-rotate-install-help') as HTMLButtonElement | null,
      authPanel: this.doc.getElementById('auth-panel'),
    };
  }

  init(): void {
    this.dismissed = this.readDismissedState();
    this.applyHelpTarget();
    this.elements.openButton?.addEventListener('click', this.handleOpenClick);
    this.elements.rotateGateOpenButton?.addEventListener('click', this.handleOpenClick);
    this.elements.closeButton?.addEventListener('click', this.handleCloseClick);
    this.elements.gotItButton?.addEventListener('click', this.handleCloseClick);
    this.elements.modal?.addEventListener('click', this.handleBackdropClick);
    this.doc.addEventListener('keydown', this.handleDocumentKeydown);
    this.doc.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.windowObj.addEventListener(APP_READY_EVENT, this.handleAppReady as EventListener);
    this.windowObj.addEventListener(
      DEVICE_LAYOUT_CHANGED_EVENT,
      this.handleDeviceLayoutChanged as EventListener,
    );
    this.render();
    if (isAppReady()) {
      this.scheduleAutoOpen();
    }
  }

  destroy(): void {
    this.clearAutoOpenTimer();
    this.elements.openButton?.removeEventListener('click', this.handleOpenClick);
    this.elements.rotateGateOpenButton?.removeEventListener('click', this.handleOpenClick);
    this.elements.closeButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.gotItButton?.removeEventListener('click', this.handleCloseClick);
    this.elements.modal?.removeEventListener('click', this.handleBackdropClick);
    this.doc.removeEventListener('keydown', this.handleDocumentKeydown);
    this.doc.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.windowObj.removeEventListener(APP_READY_EVENT, this.handleAppReady as EventListener);
    this.windowObj.removeEventListener(
      DEVICE_LAYOUT_CHANGED_EVENT,
      this.handleDeviceLayoutChanged as EventListener,
    );
    this.close(false);
    delete this.doc.body.dataset.installHelpTarget;
  }

  open(): void {
    if (!this.elements.modal || !this.shouldOfferHelp()) {
      return;
    }

    this.clearAutoOpenTimer();
    this.autoOpened = true;
    this.elements.authPanel?.classList.remove('menu-open');
    this.doc.body.dataset.installHelpOpen = 'true';
    this.elements.modal.classList.remove('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'false');
    this.render();
  }

  close(persistDismissal: boolean): void {
    if (!this.elements.modal) {
      return;
    }

    this.elements.modal.classList.add('hidden');
    this.elements.modal.setAttribute('aria-hidden', 'true');
    delete this.doc.body.dataset.installHelpOpen;
    if (persistDismissal && this.shouldOfferHelp()) {
      this.dismissed = true;
      this.writeDismissedState();
    }
    this.render();
  }

  private render(): void {
    this.applyHelpTarget();
    this.elements.openButton?.classList.toggle('hidden', !this.shouldOfferHelp());
    this.elements.rotateGateOpenButton?.classList.toggle('hidden', !this.shouldOfferHelp());

    if (!this.shouldOfferHelp() && this.elements.modal && !this.elements.modal.classList.contains('hidden')) {
      this.close(false);
    }
  }

  private scheduleAutoOpen(): void {
    if (!this.shouldAutoOpen()) {
      return;
    }

    this.clearAutoOpenTimer();
    this.autoOpenTimer = this.windowObj.setTimeout(() => {
      this.autoOpenTimer = null;
      if (!this.shouldAutoOpen()) {
        return;
      }

      this.open();
    }, INSTALL_HELP_AUTO_OPEN_DELAY_MS);
  }

  private clearAutoOpenTimer(): void {
    if (this.autoOpenTimer === null) {
      return;
    }

    this.windowObj.clearTimeout(this.autoOpenTimer);
    this.autoOpenTimer = null;
  }

  private shouldAutoOpen(): boolean {
    const layout = getDeviceLayoutState();
    return (
      this.shouldOfferHelp() &&
      !this.dismissed &&
      !this.autoOpened &&
      !layout.mobileLandscapeBlocked &&
      this.doc.visibilityState === 'visible' &&
      !this.hasBlockingSurface()
    );
  }

  private shouldOfferHelp(): boolean {
    const layout = getDeviceLayoutState();
    return layout.coarsePointer && !this.isStandaloneLaunch() && !isPlayfunMode();
  }

  private applyHelpTarget(): void {
    this.doc.body.dataset.installHelpTarget = this.detectHelpTarget();
  }

  private isStandaloneLaunch(): boolean {
    const navigatorWithStandalone = this.windowObj.navigator as NavigatorWithStandalone;
    return (
      this.windowObj.matchMedia('(display-mode: standalone)').matches ||
      navigatorWithStandalone.standalone === true
    );
  }

  private detectHelpTarget(): InstallHelpTarget {
    const { navigator } = this.windowObj;
    const userAgent = navigator.userAgent ?? '';
    const platform = navigator.platform ?? '';
    const isIos =
      /iPad|iPhone|iPod/i.test(userAgent) ||
      (platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (isIos) {
      return 'safari-share';
    }

    if (/Android/i.test(userAgent) || /Chrome|Chromium|CriOS|Brave|EdgA/i.test(userAgent)) {
      return 'browser-menu';
    }

    return 'generic';
  }

  private hasBlockingSurface(): boolean {
    if (isBusyOverlayVisible()) {
      return true;
    }

    if (this.elements.authPanel?.classList.contains('menu-open')) {
      return true;
    }

    return Array.from(this.doc.querySelectorAll<HTMLElement>('.history-modal')).some((element) => {
      if (element === this.elements.modal) {
        return false;
      }

      return !element.classList.contains('hidden');
    });
  }

  private readDismissedState(): boolean {
    try {
      return this.windowObj.localStorage.getItem(INSTALL_HELP_DISMISSED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private writeDismissedState(): void {
    try {
      this.windowObj.localStorage.setItem(INSTALL_HELP_DISMISSED_STORAGE_KEY, '1');
    } catch {
      // Ignore storage failures and keep the hint session-local.
    }
  }
}
