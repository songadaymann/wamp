export interface AuthUiElements {
  authPanel: HTMLElement | null;
  authIdentity: HTMLElement | null;
  authEmailInput: HTMLInputElement | null;
  authEmailButton: HTMLButtonElement | null;
  authWalletButton: HTMLButtonElement | null;
  authLogoutButton: HTMLButtonElement | null;
  authDisplayNameRow: HTMLElement | null;
  authDisplayNameInput: HTMLInputElement | null;
  authDisplayNameButton: HTMLButtonElement | null;
  authDisplayNameStatus: HTMLElement | null;
  testResetButton: HTMLButtonElement | null;
  authStatus: HTMLElement | null;
  authDebugLink: HTMLAnchorElement | null;
  menuToggle: HTMLElement | null;
}

export interface AuthUiHandlers {
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onIdentityActivate: () => void;
  onEmailSubmit: () => void;
  onWalletSubmit: () => void;
  onLogout: () => void;
  onDisplayNameSubmit: () => void;
  onDisplayNameInput: () => void;
  onTestReset: () => void;
}

export function collectAuthUiElements(doc: Document = document): AuthUiElements {
  return {
    authPanel: doc.getElementById('auth-panel'),
    authIdentity: doc.getElementById('auth-identity'),
    authEmailInput: doc.getElementById('auth-email-input') as HTMLInputElement | null,
    authEmailButton: doc.getElementById('btn-auth-email') as HTMLButtonElement | null,
    authWalletButton: doc.getElementById('btn-auth-wallet') as HTMLButtonElement | null,
    authLogoutButton: doc.getElementById('btn-auth-logout') as HTMLButtonElement | null,
    authDisplayNameRow: doc.getElementById('auth-display-name-row'),
    authDisplayNameInput: doc.getElementById('auth-display-name-input') as HTMLInputElement | null,
    authDisplayNameButton: doc.getElementById('btn-auth-display-name') as HTMLButtonElement | null,
    authDisplayNameStatus: doc.getElementById('auth-display-name-status'),
    testResetButton: doc.getElementById('btn-test-reset') as HTMLButtonElement | null,
    authStatus: doc.getElementById('auth-status'),
    authDebugLink: doc.getElementById('auth-debug-link') as HTMLAnchorElement | null,
    menuToggle: doc.getElementById('menu-toggle'),
  };
}

export function bindAuthUiEvents(
  elements: AuthUiElements,
  handlers: AuthUiHandlers,
  doc: Document = document
): void {
  const { authPanel } = elements;

  elements.menuToggle?.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onToggleMenu();
  });

  doc.addEventListener('click', (event) => {
    if (
      authPanel &&
      authPanel.classList.contains('menu-open') &&
      !authPanel.contains(event.target as Node)
    ) {
      handlers.onCloseMenu();
    }
  });

  elements.authIdentity?.addEventListener('click', handlers.onIdentityActivate);
  elements.authIdentity?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    handlers.onIdentityActivate();
  });

  elements.authEmailButton?.addEventListener('click', handlers.onEmailSubmit);
  elements.authEmailInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    handlers.onEmailSubmit();
  });

  elements.authWalletButton?.addEventListener('click', handlers.onWalletSubmit);
  elements.authLogoutButton?.addEventListener('click', handlers.onLogout);
  elements.authDisplayNameButton?.addEventListener('click', handlers.onDisplayNameSubmit);
  elements.authDisplayNameInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    handlers.onDisplayNameSubmit();
  });
  elements.authDisplayNameInput?.addEventListener('input', handlers.onDisplayNameInput);
  elements.testResetButton?.addEventListener('click', handlers.onTestReset);
}
