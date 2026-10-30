type FriendlyErrorOptions = { error?: unknown; nextStep?: string };

/** Keep useful server explanations, replacing transport errors with a player's next step. */
export function friendlyError(action: string, { error, nextStep = 'Please try again.' }: FriendlyErrorOptions = {}): string {
  const detail = error instanceof Error ? error.message.trim() : '';
  // Includes each browser's failed lazy-module download (Chromium, Safari, Firefox).
  const technical = /^(?:Failed to fetch|Load failed|NetworkError|Network request failed|Importing a module script failed|error loading dynamically imported module|TypeError:|Unexpected token|HTTP \d|\{)/i.test(detail);
  const message = detail && !technical ? detail : `Couldn't ${action}.`;
  return `${message.replace(/[.!?]?$/, '.')} ${nextStep}`;
}

type LiveTone = 'error' | 'status';
const pendingWrites = new WeakMap<HTMLElement, { text: string }>();

/** Runs once a frame has been drawn after this one, so the browser has seen the change before. */
function afterNextFrame(element: HTMLElement, callback: () => void): void {
  const view = element.ownerDocument?.defaultView;
  if (view) view.requestAnimationFrame(() => view.requestAnimationFrame(callback));
  else setTimeout(callback, 0);
}

/**
 * Show or clear a menu's error or status line so screen readers announce it (F471). Errors are
 * alerts, read as soon as the line appears. A polite status line that appears already filled, or
 * the same words set again (a second Sign with the fields still empty), often isn't read, so the
 * line is shown empty and gets its words after the next frame. Lines redrawn on every update pass
 * `rerender`, so unchanged words are left alone instead of being read again.
 */
export function setLiveMessage(element: HTMLElement | null, message: string | null | undefined,
  tone: LiveTone = 'error', { rerender = false } = {}): void {
  if (!element) return;
  const text = message ?? '';
  const role = tone === 'error' ? 'alert' : 'status';
  const pending = pendingWrites.get(element);
  if (rerender && text === (pending?.text ?? element.textContent) && element.getAttribute('role') === role) return;
  pendingWrites.delete(element);
  if (element.getAttribute('role') !== role) element.setAttribute('role', role);
  const showing = !element.classList.contains('hidden') && Boolean(element.textContent);
  const repeated = showing && element.textContent === text;
  element.classList.toggle('hidden', !text);
  if (!text || !(repeated || (tone === 'status' && !showing))) {
    element.textContent = text;
    return;
  }
  element.textContent = '';
  const write = { text };
  pendingWrites.set(element, write);
  afterNextFrame(element, () => {
    if (pendingWrites.get(element) !== write) return;
    pendingWrites.delete(element);
    element.textContent = text;
  });
}

/** Render a retry action beside an error without injecting server text as HTML. */
export function renderFriendlyError(element: HTMLElement | null, message: string | null,
  retry?: () => void | Promise<void>, tone: LiveTone = 'error'): void {
  if (!element) return;
  element.replaceChildren();
  element.classList.toggle('hidden', !message);
  if (!message) return;
  // The message is the live part, not the whole box, so 'Try again' isn't read out with it. Each
  // message is a new alert, so a retry that fails again is read again.
  const copy = element.ownerDocument.createElement('div');
  element.append(copy);
  setLiveMessage(copy, message, tone);
  if (!retry) return;
  const button = element.ownerDocument.createElement('button');
  button.type = 'button';
  button.className = 'bar-btn';
  button.textContent = 'Try again';
  button.addEventListener('click', () => {
    button.disabled = true;
    void Promise.resolve().then(retry).catch(() => {}).finally(() => { button.disabled = false; });
  });
  element.append(button);
}
