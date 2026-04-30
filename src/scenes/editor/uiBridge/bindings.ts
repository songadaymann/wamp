type CleanupCallbacks = Array<() => void>;

export function bindDomEvent(
  cleanupCallbacks: CleanupCallbacks,
  target: Document | Window,
  type: string,
  handler: EventListener,
): void {
  target.addEventListener(type, handler);
  cleanupCallbacks.push(() => target.removeEventListener(type, handler));
}

export function bindButton(
  cleanupCallbacks: CleanupCallbacks,
  button: HTMLButtonElement | HTMLElement | null,
  handler: () => void,
): void {
  if (!button) {
    return;
  }
  button.addEventListener('click', handler);
  cleanupCallbacks.push(() => button.removeEventListener('click', handler));
}

export function bindNumericInput(
  cleanupCallbacks: CleanupCallbacks,
  input: HTMLInputElement | null,
  onCommit: (input: HTMLInputElement) => void,
): void {
  if (!input) {
    return;
  }
  const handleCommit = () => onCommit(input);
  input.addEventListener('input', handleCommit);
  input.addEventListener('change', handleCommit);
  cleanupCallbacks.push(() => {
    input.removeEventListener('input', handleCommit);
    input.removeEventListener('change', handleCommit);
  });
}

export function bindRangeInput(
  cleanupCallbacks: CleanupCallbacks,
  input: HTMLInputElement | null,
  getValue: () => number,
  onCommit: (value: number) => void,
): void {
  if (!input) {
    return;
  }
  const handleCommit = () => onCommit(getValue());
  input.addEventListener('input', handleCommit);
  input.addEventListener('change', handleCommit);
  cleanupCallbacks.push(() => {
    input.removeEventListener('input', handleCommit);
    input.removeEventListener('change', handleCommit);
  });
}

export function bindTextInput(
  cleanupCallbacks: CleanupCallbacks,
  input: HTMLInputElement | HTMLTextAreaElement | null,
  onCommit: (input: HTMLInputElement | HTMLTextAreaElement) => void,
): void {
  if (!input) {
    return;
  }
  const handleCommit = () => onCommit(input);
  input.addEventListener('input', handleCommit);
  input.addEventListener('change', handleCommit);
  cleanupCallbacks.push(() => {
    input.removeEventListener('input', handleCommit);
    input.removeEventListener('change', handleCommit);
  });
}
