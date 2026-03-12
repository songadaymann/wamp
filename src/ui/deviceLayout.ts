export type DeviceClass = 'desktop' | 'tablet' | 'phone';
export type OrientationState = 'landscape' | 'portrait';

export interface DeviceLayoutState {
  deviceClass: DeviceClass;
  orientationState: OrientationState;
  coarsePointer: boolean;
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
  mobileLandscapeRequired: false,
  mobileLandscapeBlocked: false,
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

function computeState(): DeviceLayoutState {
  const width = Math.max(0, Math.round(window.innerWidth));
  const height = Math.max(0, Math.round(window.innerHeight));
  const coarsePointer =
    window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  const orientationState: OrientationState = width >= height ? 'landscape' : 'portrait';
  const deviceClass = classifyDeviceClass(width, height, coarsePointer);
  const mobileLandscapeRequired = coarsePointer && deviceClass !== 'desktop';

  return {
    deviceClass,
    orientationState,
    coarsePointer,
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
  document.body.dataset.mobileLandscapeBlocked = nextState.mobileLandscapeBlocked ? 'true' : 'false';
}

function statesEqual(a: DeviceLayoutState, b: DeviceLayoutState): boolean {
  return (
    a.deviceClass === b.deviceClass &&
    a.orientationState === b.orientationState &&
    a.coarsePointer === b.coarsePointer &&
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
