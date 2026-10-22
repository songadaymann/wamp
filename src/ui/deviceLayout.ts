import { keyboardViewportInset } from './keyboardViewport';
export type DeviceClass = 'desktop' | 'tablet' | 'phone';
export type OrientationState = 'landscape' | 'portrait';
export type PerformanceProfile = 'default' | 'reduced';

export interface DeviceLayoutState {
  deviceClass: DeviceClass;
  orientationState: OrientationState;
  coarsePointer: boolean;
  // True when touch is the device's main input ((pointer: coarse)). Touchscreen laptops have
  // coarsePointer (so finger pan and pinch work) but not touchPrimary, so they get no on-screen
  // play controls.
  touchPrimary: boolean;
  performanceProfile: PerformanceProfile;
  viewport: {
    width: number;
    height: number;
  };
}

type NavigatorWithDeviceMemory = Navigator & {
  deviceMemory?: number;
};

export const DEVICE_LAYOUT_CHANGED_EVENT = 'device-layout-changed';

const DEFAULT_STATE: DeviceLayoutState = {
  deviceClass: 'desktop',
  orientationState: 'landscape',
  coarsePointer: false,
  touchPrimary: false,
  performanceProfile: 'default',
  viewport: {
    width: 0,
    height: 0,
  },
};

let state: DeviceLayoutState = { ...DEFAULT_STATE };
let initialized = false;

function classifyDeviceClass(width: number, height: number, coarsePointer: boolean): DeviceClass {
  if (!coarsePointer) {
    return 'desktop';
  }

  const shortestEdge = Math.min(width, height);
  return shortestEdge <= 540 ? 'phone' : 'tablet';
}

function resolvePerformanceProfile(
  deviceClass: DeviceClass,
  coarsePointer: boolean,
): PerformanceProfile {
  if (coarsePointer || deviceClass === 'phone' || deviceClass === 'tablet') {
    return 'reduced';
  }

  const deviceMemory = (navigator as NavigatorWithDeviceMemory).deviceMemory ?? 0;
  const hardwareConcurrency = navigator.hardwareConcurrency ?? 0;
  if (
    (deviceMemory > 0 && deviceMemory <= 4)
    || (hardwareConcurrency > 0 && hardwareConcurrency <= 4)
  ) {
    return 'reduced';
  }

  return 'default';
}

function computeState(): DeviceLayoutState {
  const viewport = window.visualViewport;
  // Mobile browsers can zoom out to fit the previous desktop layout during a resize.
  // Use the actual screen area in that case, so wide content cannot trap a phone in tablet mode.
  const fitScale = Math.min(1, viewport?.scale ?? 1);
  const width = Math.max(0, Math.round((viewport?.width ?? window.innerWidth) * fitScale));
  const height = Math.max(0, Math.round((viewport?.height ?? window.innerHeight) * fitScale));
  const touchPrimary = window.matchMedia('(pointer: coarse)').matches;
  const coarsePointer = touchPrimary || navigator.maxTouchPoints > 0;
  // An open keyboard or pinch zoom shrinks the visual viewport but not the layout
  // viewport. Orientation and device class follow the layout viewport, so typing in chat
  // keeps a portrait phone in portrait and a landscape tablet a tablet (F354). The fit
  // scale still applies, so a zoomed-out phone is classed by its real screen.
  const layoutWidth = window.innerWidth || width;
  const layoutHeight = window.innerHeight || height;
  const orientationState: OrientationState = layoutWidth >= layoutHeight ? 'landscape' : 'portrait';
  const deviceClass = classifyDeviceClass(
    window.innerWidth ? Math.round(window.innerWidth * fitScale) : width,
    window.innerHeight ? Math.round(window.innerHeight * fitScale) : height,
    coarsePointer,
  );
  const performanceProfile = resolvePerformanceProfile(deviceClass, coarsePointer);

  return {
    deviceClass,
    orientationState,
    coarsePointer,
    touchPrimary,
    performanceProfile,
    viewport: {
      width,
      height,
    },
  };
}

function isEditingText(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && (element.isContentEditable || element.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),textarea'));
}

// An on-screen keyboard opening or closing changes only the height. While a text field has
// focus, keep the layout unless the width changes too (a rotation or a resized window): a
// browser that shrinks the layout viewport for the keyboard must not switch layouts under
// the field mid-word, which moves the field and closes the keyboard.
function keepLayoutWhileTyping(nextState: DeviceLayoutState): DeviceLayoutState {
  if (!isEditingText(document.activeElement) || nextState.viewport.width !== state.viewport.width) {
    return nextState;
  }
  return { ...nextState, deviceClass: state.deviceClass, orientationState: state.orientationState };
}

function updateKeyboardInset(): void {
  const element = document.activeElement;
  const editing = isEditingText(element);
  document.documentElement.style.setProperty('--keyboard-inset', `${editing ? keyboardViewportInset(window.innerHeight, window.visualViewport) : 0}px`);
  if (editing && window.visualViewport && keyboardViewportInset(window.innerHeight, window.visualViewport) > 0) {
    requestAnimationFrame(() => {
      if (document.activeElement !== element) return;
      const viewport = window.visualViewport; if (!viewport) return;
      const bounds = element.getBoundingClientRect();
      if (bounds.top < viewport.offsetTop || bounds.bottom > viewport.offsetTop + viewport.height) element.scrollIntoView({ block: 'nearest' });
    });
  }
}

function applyStateToDom(nextState: DeviceLayoutState): void {
  updateKeyboardInset();
  document.body.dataset.deviceClass = nextState.deviceClass;
  document.body.dataset.orientationState = nextState.orientationState;
  document.body.dataset.coarsePointer = nextState.coarsePointer ? 'true' : 'false';
  document.body.dataset.performanceProfile = nextState.performanceProfile;
  document.documentElement.style.setProperty('--app-viewport-width', `${nextState.viewport.width}px`);
  document.documentElement.style.setProperty('--app-viewport-height', `${nextState.viewport.height}px`);
}

function statesEqual(a: DeviceLayoutState, b: DeviceLayoutState): boolean {
  return (
    a.deviceClass === b.deviceClass &&
    a.orientationState === b.orientationState &&
    a.coarsePointer === b.coarsePointer &&
    a.touchPrimary === b.touchPrimary &&
    a.performanceProfile === b.performanceProfile &&
    a.viewport.width === b.viewport.width &&
    a.viewport.height === b.viewport.height
  );
}

function refreshState(): void {
  updateKeyboardInset();
  const nextState = keepLayoutWhileTyping(computeState());
  if (statesEqual(state, nextState)) {
    return;
  }

  state = nextState;
  applyStateToDom(state);
  window.dispatchEvent(
    new CustomEvent<DeviceLayoutState>(DEVICE_LAYOUT_CHANGED_EVENT, {
      detail: { ...state },
    }),
  );
}

export function initializeDeviceLayout(): DeviceLayoutState {
  if (!initialized) {
    initialized = true;
    state = computeState();
    applyStateToDom(state);
    document.addEventListener('focusin', () => queueMicrotask(refreshState));
    document.addEventListener('focusout', () => queueMicrotask(refreshState));
    window.addEventListener('resize', refreshState);
    window.addEventListener('orientationchange', refreshState);
    window.visualViewport?.addEventListener('resize', refreshState);
    window.visualViewport?.addEventListener('scroll', refreshState);
  } else {
    refreshState();
  }

  return { ...state };
}

export function getDeviceLayoutState(): DeviceLayoutState {
  return { ...state };
}

export function isCoarsePointerDevice(): boolean {
  return state.coarsePointer;
}

export function getPerformanceProfile(): PerformanceProfile {
  return state.performanceProfile;
}

export { prefersReducedMotion } from './reducedMotion';
