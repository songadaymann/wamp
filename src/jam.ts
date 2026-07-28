import { getApiBaseUrl } from './api/baseUrl';
import type { AuthSessionResponse, MagicLinkRequestResponse } from './auth/model';
import {
  parseJamRoomReference,
  type JamConfigResponse,
  type JamRegistrationResponse,
  type JamSubmissionResponse,
} from './jam/model';

interface JamTurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      theme: 'light';
      callback(token: string): void;
      'expired-callback'(): void;
      'error-callback'(): void;
    },
  ): string;
  reset(widgetId: string): void;
}

const jamWindow = window as typeof window & { turnstile?: JamTurnstileApi };

const form = document.getElementById('jam-entry-form') as HTMLFormElement | null;
const usernameInput = document.getElementById('jam-username') as HTMLInputElement | null;
const usernameHelp = document.getElementById('jam-username-help');
const emailInput = document.getElementById('jam-email') as HTMLInputElement | null;
const emailLabel = document.getElementById('jam-email-label');
const roomInput = document.getElementById('jam-room') as HTMLInputElement | null;
const roomField = document.getElementById('jam-room-field');
const roomHelp = document.getElementById('room-reference-help');
const websiteInput = document.getElementById('jam-website') as HTMLInputElement | null;
const rulesInput = document.getElementById('jam-rules') as HTMLInputElement | null;
const submitButton = document.getElementById('jam-submit') as HTMLButtonElement | null;
const createAccountButton = document.getElementById('jam-create-account') as HTMLButtonElement | null;
const accountAction = document.getElementById('account-action');
const entryState = document.getElementById('entry-state');
const entryHeading = document.getElementById('entry-heading');
const panelKicker = document.getElementById('panel-kicker');
const rulesCopy = document.getElementById('jam-rules-copy');
const statusElement = document.getElementById('jam-status');
const turnstileElement = document.getElementById('jam-turnstile');

let config: JamConfigResponse | null = null;
let busy = false;
let turnstileToken: string | null = null;
let turnstileWidgetId: string | null = null;
let accountRequestBusy = false;

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitEntry();
});

roomInput?.addEventListener('input', () => {
  roomInput.setCustomValidity('');
  renderRoomReferencePreview();
});

createAccountButton?.addEventListener('click', () => {
  void requestAccountLink();
});

void initialize();

async function initialize(): Promise<void> {
  setSubmissionEnabled(false);
  try {
    config = await requestJson<JamConfigResponse>('/api/jam');
    renderSubmissionState(config);
    await renderTurnstile(config);
    await loadSessionIdentity();
  } catch (error) {
    setEntryState('Unavailable', false);
    setStatus(getErrorMessage(error, 'The submission form could not load. Refresh and try again.'), true);
  }
}

async function submitEntry(): Promise<void> {
  if (busy || !form || !config || (!config.registrationOpen && !config.submissionsOpen)) {
    return;
  }

  roomInput?.setCustomValidity('');
  if (!form.reportValidity()) {
    return;
  }

  if (config.submissionsOpen) {
    const parsedRoom = parseJamRoomReference(roomInput?.value ?? '');
    if (!parsedRoom) {
      roomInput?.setCustomValidity('Enter coordinates like 12, -4 or a WAMP Room URL.');
      roomInput?.reportValidity();
      return;
    }
  }
  if (config.turnstileRequired && !turnstileToken) {
    setStatus('Complete the Turnstile check before submitting.', true);
    return;
  }

  setBusy(true);
  setStatus(
    config.submissionsOpen ? 'Checking your WAMP account and Room...' : 'Adding you to the jam list...',
    false,
  );
  try {
    const requestBody = {
      username: usernameInput?.value ?? '',
      email: emailInput?.value ?? '',
      rulesAccepted: Boolean(rulesInput?.checked),
      website: websiteInput?.value ?? '',
      turnstileToken,
    };

    if (config.submissionsOpen) {
      const response = await requestJson<JamSubmissionResponse>('/api/jam/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...requestBody,
          roomReference: roomInput?.value ?? '',
        }),
      });
      renderSubmissionSuccess(response);
      if (roomInput) {
        roomInput.value = '';
      }
    } else {
      const response = await requestJson<JamRegistrationResponse>('/api/jam/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      renderRegistrationSuccess(response);
    }

    if (rulesInput) {
      rulesInput.checked = false;
    }
  } catch (error) {
    setStatus(
      getErrorMessage(
        error,
        config.submissionsOpen
          ? 'Your Room could not be submitted. Try again.'
          : 'You could not be added to the jam list. Try again.',
      ),
      true,
    );
  } finally {
    resetTurnstile();
    setBusy(false);
  }
}

async function requestAccountLink(): Promise<void> {
  if (accountRequestBusy || !emailInput) {
    return;
  }
  if (!emailInput.value.trim() || !emailInput.checkValidity()) {
    emailInput.reportValidity();
    return;
  }

  accountRequestBusy = true;
  if (createAccountButton) {
    createAccountButton.disabled = true;
    createAccountButton.textContent = 'Sending...';
  }
  setStatus('Sending your WAMP account link...', false);
  try {
    const response = await requestJson<MagicLinkRequestResponse>('/api/auth/request-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: emailInput?.value ?? '',
        returnTo: new URL('/jam', window.location.origin).toString(),
      }),
    });
    setStatus(
      response.delivery === 'email'
        ? 'Check your email to finish creating your WAMP account. You can set your username after signing in.'
        : 'Your local WAMP sign-in link is ready in the main game.',
      false,
    );
  } catch (error) {
    setStatus(getErrorMessage(error, 'The account link could not be sent. Try again.'), true);
  } finally {
    accountRequestBusy = false;
    if (createAccountButton) {
      createAccountButton.disabled = false;
      createAccountButton.textContent = 'Create account';
    }
  }
}

function renderSubmissionState(nextConfig: JamConfigResponse): void {
  if (nextConfig.submissionsOpen) {
    setEntryState('Entries open', true);
    setFormCopy('submission');
    setSubmissionEnabled(true);
    return;
  }

  if (nextConfig.registrationOpen) {
    setEntryState('Signups open', true);
    setFormCopy('registration');
    setSubmissionEnabled(true);
    setStatus("Join now and we'll email you before building begins July 20.", false);
    return;
  }

  setEntryState('Entries closed', false);
  setFormCopy('closed');
  setStatus('Jam registration closed July 28 at 8:00 AM Eastern.', false);
  setSubmissionEnabled(false);
}

function setFormCopy(mode: 'registration' | 'submission' | 'closed'): void {
  const isSubmission = mode === 'submission';
  roomField?.classList.toggle('hidden', !isSubmission);
  if (roomInput) {
    roomInput.required = isSubmission;
  }
  if (panelKicker) {
    panelKicker.textContent = isSubmission ? 'Your judged Room' : 'Save your spot';
  }
  if (entryHeading) {
    entryHeading.textContent = isSubmission ? 'Submit your entry' : mode === 'closed' ? 'Jam closed' : 'Join the jam';
  }
  if (emailLabel) {
    emailLabel.textContent = isSubmission ? 'Connected email' : 'Email address';
  }
  if (usernameHelp) {
    usernameHelp.textContent = isSubmission
      ? 'Use the username connected to your WAMP account.'
      : 'No account yet? Enter the username you plan to use.';
  }
  if (rulesCopy) {
    rulesCopy.textContent = isSubmission
      ? 'I made this Room, it was newly claimed July 20-26, and I accept the jam rules.'
      : 'I want to join the jam and I accept the jam rules.';
  }
  if (submitButton) {
    submitButton.textContent = isSubmission ? 'Submit Room' : mode === 'closed' ? 'Entries Closed' : 'Join the Jam';
  }
}

function setEntryState(label: string, isOpen: boolean): void {
  if (!entryState) {
    return;
  }
  entryState.textContent = label;
  entryState.classList.toggle('is-open', isOpen);
}

function setSubmissionEnabled(enabled: boolean): void {
  if (submitButton) {
    submitButton.disabled = !enabled || busy;
  }
}

function setBusy(nextBusy: boolean): void {
  busy = nextBusy;
  setSubmissionEnabled(Boolean(config?.submissionsOpen || config?.registrationOpen));
  if (submitButton && config && (config.submissionsOpen || config.registrationOpen)) {
    submitButton.textContent = busy
      ? (config.submissionsOpen ? 'Submitting...' : 'Joining...')
      : (config.submissionsOpen ? 'Submit Room' : 'Join the Jam');
  }
}

function renderRoomReferencePreview(): void {
  if (!roomHelp || !roomInput) {
    return;
  }
  const parsed = parseJamRoomReference(roomInput.value);
  roomHelp.textContent = parsed
    ? `Judged Room: ${parsed.coordinates.x}, ${parsed.coordinates.y}`
    : 'The Room must belong to the account above.';
}

function renderSubmissionSuccess(response: JamSubmissionResponse): void {
  if (!statusElement) {
    return;
  }

  statusElement.replaceChildren();
  statusElement.classList.remove('is-error');
  statusElement.classList.add('is-success');

  const message = document.createElement('span');
  message.textContent = response.updated ? 'Entry updated. ' : 'Room submitted. ';
  const link = document.createElement('a');
  link.href = response.submission.roomUrl;
  link.textContent = `Open Room ${response.submission.roomCoordinates.x}, ${response.submission.roomCoordinates.y}`;
  statusElement.append(message, link);
}

function renderRegistrationSuccess(response: JamRegistrationResponse): void {
  setStatus(
    response.updated
      ? "You're still on the list. We updated your jam signup and will email you before it begins."
      : "You're in. We'll email you before the jam begins on July 20.",
    false,
  );
  statusElement?.classList.add('is-success');
}

async function loadSessionIdentity(): Promise<void> {
  try {
    const session = await requestJson<AuthSessionResponse>('/api/auth/session');
    if (session.authenticated && session.user) {
      if (usernameInput && session.user.username) {
        usernameInput.value = session.user.username;
      }
      if (emailInput && session.user.email) {
        emailInput.value = session.user.email;
      }
      accountAction?.classList.add('hidden');
    }

    const url = new URL(window.location.href);
    const authResult = url.searchParams.get('auth');
    if (authResult === 'email' && session.authenticated) {
      setStatus('Your WAMP account is ready and signed in.', false);
      url.searchParams.delete('auth');
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    // Registration still works if session lookup is unavailable.
  }
}

function setStatus(message: string, isError: boolean): void {
  if (!statusElement) {
    return;
  }
  statusElement.textContent = message;
  statusElement.classList.toggle('is-error', isError);
  statusElement.classList.remove('is-success');
}

async function renderTurnstile(nextConfig: JamConfigResponse): Promise<void> {
  if (
    !turnstileElement
    || (!nextConfig.registrationOpen && !nextConfig.submissionsOpen)
    || !nextConfig.turnstileRequired
  ) {
    turnstileElement?.classList.add('hidden');
    return;
  }
  if (!nextConfig.turnstileSiteKey) {
    throw new Error('Turnstile is not configured.');
  }

  turnstileElement.classList.remove('hidden');
  await loadTurnstileScript();
  if (!jamWindow.turnstile) {
    throw new Error('Turnstile failed to load.');
  }
  turnstileWidgetId = jamWindow.turnstile.render(turnstileElement, {
    sitekey: nextConfig.turnstileSiteKey,
    theme: 'light',
    callback: (token) => {
      turnstileToken = token;
      setStatus('', false);
    },
    'expired-callback': () => {
      turnstileToken = null;
    },
    'error-callback': () => {
      turnstileToken = null;
      setStatus('Turnstile had trouble. Try again.', true);
    },
  });
}

function loadTurnstileScript(): Promise<void> {
  if (jamWindow.turnstile) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Turnstile failed to load.')), { once: true });
    document.head.append(script);
  });
}

function resetTurnstile(): void {
  turnstileToken = null;
  if (turnstileWidgetId && jamWindow.turnstile) {
    jamWindow.turnstile.reset(turnstileWidgetId);
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    credentials: 'include',
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body
      ? String((body as { error: unknown }).error)
      : text || `Request failed with status ${response.status}.`;
    throw new Error(message);
  }
  return body as T;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
