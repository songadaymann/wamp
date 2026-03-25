import { isOpenableProfileUserId } from '../ui/setup/profileEvents';
import type { DisplayNameAvailabilityResponse, AuthUser } from './model';
import type { AuthDebugState } from './clientTypes';
import type { AuthUiElements } from './domController';

export interface AuthDisplayNameRenderState {
  lastCheckedDisplayName: string;
  lastDisplayNameAvailability: DisplayNameAvailabilityResponse | null;
}

export function renderAuthUi(
  elements: AuthUiElements,
  state: AuthDebugState,
  displayNameState: AuthDisplayNameRenderState,
  documentObj: Document = document
): void {
  const { authPanel } = elements;
  if (!authPanel) {
    return;
  }

  if (elements.authIdentity) {
    elements.authIdentity.textContent = state.authenticated
      ? buildIdentityText(state.user)
      : 'Guest';
    const canOpenProfile = isOpenableProfileUserId(state.user?.id);
    elements.authIdentity.classList.toggle('profile-trigger', canOpenProfile);
    elements.authIdentity.classList.toggle('auth-identity-clickable', canOpenProfile);
    if (canOpenProfile) {
      elements.authIdentity.setAttribute('role', 'button');
      elements.authIdentity.setAttribute('tabindex', '0');
    } else {
      elements.authIdentity.removeAttribute('role');
      elements.authIdentity.setAttribute('tabindex', '-1');
    }
    elements.authIdentity.setAttribute(
      'aria-label',
      canOpenProfile ? 'Open profile' : 'Account identity'
    );
  }

  if (elements.authStatus) {
    elements.authStatus.textContent = state.status;
  }

  if (elements.authEmailButton) {
    elements.authEmailButton.disabled = state.loading;
  }

  if (elements.authEmailInput) {
    elements.authEmailInput.disabled = state.loading;
  }

  if (elements.authWalletButton) {
    elements.authWalletButton.disabled = state.loading || !state.walletProjectConfigured;
    elements.authWalletButton.textContent = getWalletButtonLabel(state);
  }

  authPanel.classList.toggle('auth-panel-guest', !state.authenticated);

  if (elements.authLogoutButton) {
    elements.authLogoutButton.classList.toggle(
      'hidden',
      !state.authenticated || state.source === 'playfun'
    );
    elements.authLogoutButton.disabled = state.loading;
  }

  if (elements.authDisplayNameRow) {
    elements.authDisplayNameRow.classList.toggle('hidden', !state.authenticated);
  }

  if (elements.authDisplayNameInput) {
    const desiredValue = state.user?.displayName ?? '';
    if (elements.authDisplayNameInput !== documentObj.activeElement) {
      elements.authDisplayNameInput.value = desiredValue;
    }
    elements.authDisplayNameInput.disabled = state.loading || !state.authenticated;
  }

  if (elements.authDisplayNameButton) {
    elements.authDisplayNameButton.classList.toggle('hidden', !state.authenticated);
    elements.authDisplayNameButton.disabled = state.loading || !state.authenticated;
  }

  if (elements.authDisplayNameStatus) {
    elements.authDisplayNameStatus.classList.toggle('hidden', !state.authenticated);
    elements.authDisplayNameStatus.classList.remove('is-available', 'is-taken');

    const draftValue = elements.authDisplayNameInput?.value.replace(/\s+/g, ' ').trim() ?? '';
    if (!state.authenticated || !draftValue) {
      elements.authDisplayNameStatus.textContent = '';
    } else if (draftValue === state.user?.displayName) {
      elements.authDisplayNameStatus.textContent = 'Current display name.';
      elements.authDisplayNameStatus.classList.add('is-available');
    } else if (
      displayNameState.lastCheckedDisplayName === draftValue &&
      displayNameState.lastDisplayNameAvailability
    ) {
      if (displayNameState.lastDisplayNameAvailability.available) {
        elements.authDisplayNameStatus.textContent =
          displayNameState.lastDisplayNameAvailability.claimedByCurrentUser
            ? 'Current display name.'
            : 'Display name is available.';
        elements.authDisplayNameStatus.classList.add('is-available');
      } else {
        elements.authDisplayNameStatus.textContent = 'That display name has already been claimed.';
        elements.authDisplayNameStatus.classList.add('is-taken');
      }
    } else if (elements.authDisplayNameInput === documentObj.activeElement) {
      elements.authDisplayNameStatus.textContent = 'Checking availability...';
    } else {
      elements.authDisplayNameStatus.textContent = '';
    }
  }

  if (elements.testResetButton) {
    elements.testResetButton.classList.toggle('hidden', !state.testResetEnabled);
    elements.testResetButton.disabled = state.loading;
  }

  if (elements.authDebugLink) {
    if (state.debugMagicLink) {
      elements.authDebugLink.classList.remove('hidden');
      elements.authDebugLink.href = state.debugMagicLink;
      elements.authDebugLink.textContent = 'Open debug sign-in link';
    } else {
      elements.authDebugLink.classList.add('hidden');
      elements.authDebugLink.removeAttribute('href');
      elements.authDebugLink.textContent = '';
    }
  }
}

function buildIdentityText(user: AuthUser | null): string {
  if (!user) {
    return 'Guest';
  }

  if (user.email && user.walletAddress) {
    return `${user.displayName} · ${shortenAddress(user.walletAddress)}`;
  }

  if (user.email) {
    return `${user.displayName} · ${user.email}`;
  }

  if (user.walletAddress) {
    return `${user.displayName} · ${shortenAddress(user.walletAddress)}`;
  }

  return user.displayName;
}

function getWalletButtonLabel(state: AuthDebugState): string {
  if (!state.walletProjectConfigured) {
    return 'Wallet ID Missing';
  }

  if (
    state.walletConnected &&
    state.user?.walletAddress?.toLowerCase() === state.walletAddress?.toLowerCase()
  ) {
    return shortenAddress(state.walletAddress ?? '');
  }

  if (state.walletConnected && state.authenticated) {
    return 'Link Wallet';
  }

  return 'Sign In With Wallet';
}

function shortenAddress(address: string): string {
  if (!address) {
    return 'Wallet';
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
