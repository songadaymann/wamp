import { playSfx } from '../../audio/sfx';

const PRESSABLE_SELECTOR = [
  '.bar-btn',
  '.tool-btn',
  '.layer-btn',
  '.palette-tab',
  '.obj-cat-tab',
  '.object-item',
  '#menu-toggle',
].join(', ');

function isDisabled(target: HTMLElement): boolean {
  if (target instanceof HTMLButtonElement) {
    return target.disabled;
  }

  return target.getAttribute('aria-disabled') === 'true';
}

function resolvePressable(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const element = target.closest(PRESSABLE_SELECTOR);
  return element instanceof HTMLElement ? element : null;
}

export function setupButtonFeedback(doc: Document = document): void {
  let activePressed: HTMLElement | null = null;
  let activeHover: HTMLElement | null = null;

  const clearPressed = () => {
    activePressed?.classList.remove('is-pressed');
    activePressed = null;
  };

  doc.addEventListener('pointerdown', (event) => {
    const target = resolvePressable(event.target);
    if (!target) {
      return;
    }

    if (isDisabled(target)) {
      playSfx('ui-disabled');
      return;
    }

    clearPressed();
    activePressed = target;
    target.classList.add('is-pressed');
  });

  doc.addEventListener('pointerover', (event) => {
    const target = resolvePressable(event.target);
    if (!target || isDisabled(target)) {
      return;
    }

    const fromTarget = resolvePressable((event as PointerEvent).relatedTarget);
    if (fromTarget === target || activeHover === target) {
      return;
    }

    activeHover = target;
    playSfx('ui-hover');
  });

  doc.addEventListener('pointerout', (event) => {
    const target = resolvePressable(event.target);
    const toTarget = resolvePressable((event as PointerEvent).relatedTarget);
    if (target && target === activeHover && toTarget !== target) {
      activeHover = null;
    }
  });

  doc.addEventListener('pointerup', clearPressed);
  doc.addEventListener('pointercancel', clearPressed);
  doc.addEventListener('dragstart', clearPressed);

  doc.addEventListener('click', (event) => {
    const target = resolvePressable(event.target);
    if (!target || isDisabled(target)) {
      return;
    }

    playSfx('ui-click');
  });

  doc.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    const target = resolvePressable(event.target);
    if (!target || isDisabled(target)) {
      return;
    }

    activePressed = target;
    target.classList.add('is-pressed');
  });

  doc.addEventListener('keyup', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      clearPressed();
    }
  });
}
