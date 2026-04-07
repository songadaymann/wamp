export const PROFILE_OPEN_REQUEST_EVENT = 'profile-open-request';
export const PROFILE_INVALIDATED_EVENT = 'profile-invalidated';

export interface ProfileOpenRequestDetail {
  userId: string;
}

export interface ProfileInvalidatedDetail {
  userId: string;
}

export function isOpenableProfileUserId(userId: string | null | undefined): userId is string {
  return (
    typeof userId === 'string'
    && userId.trim().length > 0
    && !userId.startsWith('guest-')
  );
}

export function requestProfileOpen(userId: string | null | undefined): boolean {
  if (!isOpenableProfileUserId(userId)) {
    return false;
  }

  window.dispatchEvent(
    new CustomEvent<ProfileOpenRequestDetail>(PROFILE_OPEN_REQUEST_EVENT, {
      detail: { userId },
    })
  );
  return true;
}

export function requestProfileInvalidation(userId: string | null | undefined): boolean {
  if (!isOpenableProfileUserId(userId)) {
    return false;
  }

  window.dispatchEvent(
    new CustomEvent<ProfileInvalidatedDetail>(PROFILE_INVALIDATED_EVENT, {
      detail: { userId },
    })
  );
  return true;
}

export function createProfileTriggerElement(
  doc: Document,
  userId: string | null | undefined,
  label: string,
  className: string,
  fallbackTagName: 'span' | 'div' = 'span'
): HTMLElement {
  if (!isOpenableProfileUserId(userId)) {
    const fallback = doc.createElement(fallbackTagName);
    fallback.className = className;
    fallback.textContent = label;
    return fallback;
  }

  const button = doc.createElement('button');
  button.type = 'button';
  button.className = `${className} profile-trigger`;
  button.textContent = label;
  button.title = `View ${label}'s profile`;
  button.addEventListener('click', () => {
    requestProfileOpen(userId);
  });
  return button;
}
