import { getApiBaseUrl } from './api/baseUrl';
import {
  parseJamRoomReference,
  type JamConfigResponse,
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
const emailInput = document.getElementById('jam-email') as HTMLInputElement | null;
const roomInput = document.getElementById('jam-room') as HTMLInputElement | null;
const roomHelp = document.getElementById('room-reference-help');
const websiteInput = document.getElementById('jam-website') as HTMLInputElement | null;
const rulesInput = document.getElementById('jam-rules') as HTMLInputElement | null;
const submitButton = document.getElementById('jam-submit') as HTMLButtonElement | null;
const entryState = document.getElementById('entry-state');
const statusElement = document.getElementById('jam-status');
const turnstileElement = document.getElementById('jam-turnstile');

let config: JamConfigResponse | null = null;
let busy = false;
let turnstileToken: string | null = null;
let turnstileWidgetId: string | null = null;

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitEntry();
});

roomInput?.addEventListener('input', () => {
  roomInput.setCustomValidity('');
  renderRoomReferencePreview();
});

void initialize();

async function initialize(): Promise<void> {
  setSubmissionEnabled(false);
  try {
    config = await requestJson<JamConfigResponse>('/api/jam');
    renderSubmissionState(config);
    await renderTurnstile(config);
  } catch (error) {
    setEntryState('Unavailable', false);
    setStatus(getErrorMessage(error, 'The submission form could not load. Refresh and try again.'), true);
  }
}

async function submitEntry(): Promise<void> {
  if (busy || !form || !config?.submissionsOpen) {
    return;
  }

  roomInput?.setCustomValidity('');
  if (!form.reportValidity()) {
    return;
  }

  const parsedRoom = parseJamRoomReference(roomInput?.value ?? '');
  if (!parsedRoom) {
    roomInput?.setCustomValidity('Enter coordinates like 12, -4 or a WAMP Room URL.');
    roomInput?.reportValidity();
    return;
  }
  if (config.turnstileRequired && !turnstileToken) {
    setStatus('Complete the Turnstile check before submitting.', true);
    return;
  }

  setBusy(true);
  setStatus('Checking your WAMP account and Room...', false);
  try {
    const response = await requestJson<JamSubmissionResponse>('/api/jam/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: usernameInput?.value ?? '',
        email: emailInput?.value ?? '',
        roomReference: roomInput?.value ?? '',
        rulesAccepted: Boolean(rulesInput?.checked),
        website: websiteInput?.value ?? '',
        turnstileToken,
      }),
    });

    renderSuccess(response);
    if (roomInput) {
      roomInput.value = '';
    }
    if (rulesInput) {
      rulesInput.checked = false;
    }
  } catch (error) {
    setStatus(getErrorMessage(error, 'Your Room could not be submitted. Try again.'), true);
  } finally {
    resetTurnstile();
    setBusy(false);
  }
}

function renderSubmissionState(nextConfig: JamConfigResponse): void {
  if (nextConfig.submissionsOpen) {
    setEntryState('Entries open', true);
    setSubmissionEnabled(true);
    if (submitButton) {
      submitButton.textContent = 'Submit Room';
    }
    return;
  }

  const now = Date.now();
  if (now < Date.parse(nextConfig.openAt)) {
    setEntryState('Opens July 20', false);
    if (submitButton) {
      submitButton.textContent = 'Opens July 20';
    }
    setStatus('Submissions open July 20 at 12:00 AM Eastern.', false);
  } else {
    setEntryState('Entries closed', false);
    if (submitButton) {
      submitButton.textContent = 'Entries Closed';
    }
    setStatus('Submissions closed July 26 at 11:59 PM Eastern.', false);
  }
  setSubmissionEnabled(false);
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
  setSubmissionEnabled(Boolean(config?.submissionsOpen));
  if (submitButton && config?.submissionsOpen) {
    submitButton.textContent = busy ? 'Submitting...' : 'Submit Room';
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

function renderSuccess(response: JamSubmissionResponse): void {
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

function setStatus(message: string, isError: boolean): void {
  if (!statusElement) {
    return;
  }
  statusElement.textContent = message;
  statusElement.classList.toggle('is-error', isError);
  statusElement.classList.remove('is-success');
}

async function renderTurnstile(nextConfig: JamConfigResponse): Promise<void> {
  if (!turnstileElement || !nextConfig.submissionsOpen || !nextConfig.turnstileRequired) {
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
