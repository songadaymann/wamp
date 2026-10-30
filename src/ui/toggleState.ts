/** Marks a choice button selected or not: the `active` look and aria-pressed always change together (F464). */
export function setToggleState(button: HTMLElement | null | undefined, on: boolean): void {
  if (!button) return;
  button.classList.toggle('active', on);
  button.setAttribute('aria-pressed', on ? 'true' : 'false');
}
