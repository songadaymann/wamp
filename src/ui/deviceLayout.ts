export type DeviceClass = 'desktop' | 'tablet' | 'phone';
export type OrientationState = 'landscape' | 'portrait';

export interface DeviceLayoutState {
  deviceClass: DeviceClass;
  orientationState: OrientationState;
  coarsePointer: boolean;
  standaloneLaunch: boolean;
  standalonePortrait: boolean;
  mobileLandscapeRequired: boolean;
  mobileLandscapeBlocked: boolean;
  viewport: {
    width: number;
    height: number;
  };
}

export const DEVICE_LAYOUT_CHANGED_EVENT = 'device-layout-changed';

const DEFAULT_STATE: DeviceLayoutState = {
  deviceClass: 'desktop',
  orientationState: 'landscape',
  coarsePointer: false,
  standaloneLaunch: false,
  standalonePortrait: false,
  mobileLandscapeRequired: false,
  mobileLandscapeBlocked: false,
  viewport: {
    width: 0,
    height: 0,
  },
};

let state: DeviceLayoutState = { ...DEFAULT_STATE };
let initialized = false;

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

export function detectStandaloneLaunch(windowObj: Window = window): boolean {
  const navigatorWithStandalone = windowObj.navigator as NavigatorWithStandalone;
  const referrer = windowObj.document.referrer ?? '';
  return (
    windowObj.matchMedia('(display-mode: standalone)').matches ||
    windowObj.matchMedia('(display-mode: fullscreen)').matches ||
    windowObj.matchMedia('(display-mode: minimal-ui)').matches ||
    navigatorWithStandalone.standalone === true ||
    referrer.startsWith('android-app://')
  );
}

function classifyDeviceClass(width: number, height: number, coarsePointer: boolean): DeviceClass {
  if (!coarsePointer) {
    return 'desktop';
  }

  const shortestEdge = Math.min(width, height);
  return shortestEdge <= 540 ? 'phone' : 'tablet';
}

function computeState(): DeviceLayoutState {
  const viewport = window.visualViewport;
  const rawWidth = Math.max(0, Math.round(viewport?.width ?? window.innerWidth));
  const rawHeight = Math.max(0, Math.round(viewport?.height ?? window.innerHeight));
  const coarsePointer =
    window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  const standaloneLaunch = detectStandaloneLaunch();
  const standalonePortrait =
    standaloneLaunch &&
    coarsePointer &&
    rawWidth < rawHeight;
  const width = standalonePortrait ? rawHeight : rawWidth;
  const height = standalonePortrait ? rawWidth : rawHeight;
  const orientationState: OrientationState = width >= height ? 'landscape' : 'portrait';
  const deviceClass = classifyDeviceClass(width, height, coarsePointer);
  const mobileLandscapeRequired = coarsePointer && deviceClass !== 'desktop' && !standaloneLaunch;

  return {
    deviceClass,
    orientationState,
    coarsePointer,
    standaloneLaunch,
    standalonePortrait,
    mobileLandscapeRequired,
    mobileLandscapeBlocked: mobileLandscapeRequired && orientationState === 'portrait',
    viewport: {
      width,
      height,
    },
  };
}

function applyStateToDom(nextState: DeviceLayoutState): void {
  document.body.dataset.deviceClass = nextState.deviceClass;
  document.body.dataset.orientationState = nextState.orientationState;
  document.body.dataset.coarsePointer = nextState.coarsePointer ? 'true' : 'false';
  document.body.dataset.standaloneLaunch = nextState.standaloneLaunch ? 'true' : 'false';
  document.body.dataset.standalonePortrait = nextState.standalonePortrait ? 'true' : 'false';
  document.body.dataset.mobileLandscapeBlocked = nextState.mobileLandscapeBlocked ? 'true' : 'false';
  document.documentElement.style.setProperty('--app-viewport-width', `${nextState.viewport.width}px`);
  document.documentElement.style.setProperty('--app-viewport-height', `${nextState.viewport.height}px`);
}

function statesEqual(a: DeviceLayoutState, b: DeviceLayoutState): boolean {
  return (
    a.deviceClass === b.deviceClass &&
    a.orientationState === b.orientationState &&
    a.coarsePointer === b.coarsePointer &&
    a.standaloneLaunch === b.standaloneLaunch &&
    a.standalonePortrait === b.standalonePortrait &&
    a.mobileLandscapeRequired === b.mobileLandscapeRequired &&
    a.mobileLandscapeBlocked === b.mobileLandscapeBlocked &&
    a.viewport.width === b.viewport.width &&
    a.viewport.height === b.viewport.height
  );
}

function refreshState(): void {
  const nextState = computeState();
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

export function isMobileLandscapeBlocked(): boolean {
  return state.mobileLandscapeBlocked;
}
