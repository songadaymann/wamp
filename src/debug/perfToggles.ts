const PERF_TOGGLE_NAMES = [
  'single-room',
  'no-live-objects',
  'no-previews',
  'half-res',
] as const;

export type PerfToggleName = (typeof PERF_TOGGLE_NAMES)[number];

export interface PerfToggleState {
  enabled: PerfToggleName[];
  singleRoom: boolean;
  noLiveObjects: boolean;
  noPreviews: boolean;
  halfRes: boolean;
}

const PERF_TOGGLE_NAME_SET = new Set<string>(PERF_TOGGLE_NAMES);

function readPerfToggleState(): PerfToggleState {
  const query = new URLSearchParams(window.location.search);
  const enabled = new Set<PerfToggleName>();

  for (const value of query.getAll('perf')) {
    for (const token of value.split(',')) {
      const normalized = token.trim().toLowerCase();
      if (!normalized || !PERF_TOGGLE_NAME_SET.has(normalized)) {
        continue;
      }
      enabled.add(normalized as PerfToggleName);
    }
  }

  const enabledList = Array.from(enabled.values()).sort();

  return {
    enabled: enabledList,
    singleRoom: enabled.has('single-room'),
    noLiveObjects: enabled.has('no-live-objects'),
    noPreviews: enabled.has('no-previews'),
    halfRes: enabled.has('half-res'),
  };
}

const perfToggleState = readPerfToggleState();

export function getPerfToggleState(): PerfToggleState {
  return {
    enabled: [...perfToggleState.enabled],
    singleRoom: perfToggleState.singleRoom,
    noLiveObjects: perfToggleState.noLiveObjects,
    noPreviews: perfToggleState.noPreviews,
    halfRes: perfToggleState.halfRes,
  };
}

export function isPerfSingleRoomEnabled(): boolean {
  return perfToggleState.singleRoom;
}

export function isPerfNoLiveObjectsEnabled(): boolean {
  return perfToggleState.noLiveObjects;
}

export function isPerfNoPreviewsEnabled(): boolean {
  return perfToggleState.noPreviews;
}

export function isPerfHalfResEnabled(): boolean {
  return perfToggleState.halfRes;
}
