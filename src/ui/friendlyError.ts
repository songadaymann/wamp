type FriendlyErrorOptions = { error?: unknown; nextStep?: string };

/** Keep useful server explanations, replacing transport errors with a player's next step. */
export function friendlyError(action: string, { error, nextStep = 'Please try again.' }: FriendlyErrorOptions = {}): string {
  const detail = error instanceof Error ? error.message.trim() : '';
  const technical = /^(?:Failed to fetch|Load failed|NetworkError|Network request failed|TypeError:|Unexpected token|HTTP \d|\{)/i.test(detail);
  const message = detail && !technical ? detail : `Couldn't ${action}.`;
  return `${message.replace(/[.!?]?$/, '.')} ${nextStep}`;
}

/**
 * Show or clear a menu's error or status line so screen readers announce it (F471). Errors are
 * alerts, which are read even when the line was hidden a moment ago; progress and success lines are
 * polite status. Text that hasn't changed isn't rewritten, so a re-render doesn't read it again.
 */
export function setLiveMessage(element: HTMLElement | null, message: string | null | undefined,
  tone: 'error' | 'status' = 'error'): void {
  if (!element) return;
  const text = message ?? '';
  const role = tone === 'error' ? 'alert' : 'status';
  if (element.getAttribute('role') !== role) element.setAttribute('role', role);
  if (element.textContent !== text) element.textContent = text;
  element.classList.toggle('hidden', !text);
}

/** Render a retry action beside an error without injecting server text as HTML. */
export function renderFriendlyError(element: HTMLElement | null, message: string | null,
  retry?: () => void | Promise<void>): void {
  if (!element) return;
  element.replaceChildren();
  element.classList.toggle('hidden', !message);
  if (!message) return;
  // The message is the alert, not the whole box, so 'Try again' isn't read out as part of it.
  const copy = element.ownerDocument.createElement('div');
  setLiveMessage(copy, message);
  element.append(copy);
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

export function setFeedbackText(element: HTMLElement | null, message: string): void {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('hidden', !message);
}
