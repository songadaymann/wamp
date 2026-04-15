export type DeviceClass = 'desktop' | 'tablet' | 'phone';
export type OrientationState = 'landscape' | 'portrait';
export type PerformanceProfile = 'default' | 'reduced';

export interface DeviceLayoutState {
  deviceClass: DeviceClass;
  orientationState: OrientationState;
  coarsePointer: boolean;
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
  const width = Math.max(0, Math.round(viewport?.width ?? window.innerWidth));
  const height = Math.max(0, Math.round(viewport?.height ?? window.innerHeight));
  const coarsePointer =
    window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  const orientationState: OrientationState = width >= height ? 'landscape' : 'portrait';
  const deviceClass = classifyDeviceClass(width, height, coarsePointer);
  const performanceProfile = resolvePerformanceProfile(deviceClass, coarsePointer);

  return {
    deviceClass,
    orientationState,
    coarsePointer,
    performanceProfile,
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
  document.body.dataset.performanceProfile = nextState.performanceProfile;
  document.documentElement.style.setProperty('--app-viewport-width', `${nextState.viewport.width}px`);
  document.documentElement.style.setProperty('--app-viewport-height', `${nextState.viewport.height}px`);
}

function statesEqual(a: DeviceLayoutState, b: DeviceLayoutState): boolean {
  return (
    a.deviceClass === b.deviceClass &&
    a.orientationState === b.orientationState &&
    a.coarsePointer === b.coarsePointer &&
    a.performanceProfile === b.performanceProfile &&
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

export function getPerformanceProfile(): PerformanceProfile {
  return state.performanceProfile;
}
