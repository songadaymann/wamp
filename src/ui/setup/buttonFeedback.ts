import { playSfx } from '../../audio/sfx';
import { isCoarsePointerDevice } from '../deviceLayout';

const PRESSABLE_SELECTOR = [
  '.bar-btn',
  '.tool-btn',
  '.layer-btn',
  '.palette-tab',
  '.obj-cat-tab',
  '.object-subcategory-tab',
  '.object-item',
  '.editor-music-arrangement-slot',
  '.editor-music-library-item',
  '#menu-toggle',
  '.mobile-action-btn',
].join(', ');

const GAMEPLAY_MOBILE_CONTROLS_SELECTOR = '#mobile-play-controls .mobile-action-btn';

function isDisabled(target: HTMLElement): boolean {
  if (target instanceof HTMLButtonElement) {
    return target.disabled || target.getAttribute('aria-disabled') === 'true';
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

function isGameplayMobileControl(target: HTMLElement): boolean {
  return Boolean(target.closest(GAMEPLAY_MOBILE_CONTROLS_SELECTOR));
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
    if (isCoarsePointerDevice()) {
      return;
    }

    const target = resolvePressable(event.target);
    if (!target || isDisabled(target) || isGameplayMobileControl(target)) {
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
    if (!target || isDisabled(target) || isGameplayMobileControl(target)) {
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
