type FriendlyErrorOptions = { error?: unknown; nextStep?: string };

/** Keep useful server explanations, replacing transport errors with a player's next step. */
export function friendlyError(action: string, { error, nextStep = 'Please try again.' }: FriendlyErrorOptions = {}): string {
  const detail = error instanceof Error ? error.message.trim() : '';
  const technical = /^(?:Failed to fetch|Load failed|NetworkError|Network request failed|TypeError:|Unexpected token|HTTP \d|\{)/i.test(detail);
  const message = detail && !technical ? detail : `Couldn't ${action}.`;
  return `${message.replace(/[.!?]?$/, '.')} ${nextStep}`;
}

/** Render a retry action beside an error without injecting server text as HTML. */
export function renderFriendlyError(element: HTMLElement | null, message: string | null,
  retry?: () => void | Promise<void>): void {
  if (!element) return;
  element.replaceChildren();
  element.classList.toggle('hidden', !message);
  if (!message) return;
  const copy = element.ownerDocument.createElement('div');
  copy.textContent = message;
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
