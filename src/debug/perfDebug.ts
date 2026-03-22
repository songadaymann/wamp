export type PerfDebugFlag =
  | 'hud'
  | 'no-presence'
  | 'no-parallax'
  | 'min-hud'
  | 'low-stream';

export interface PerfDebugState {
  enabled: boolean;
  showHud: boolean;
  noPresence: boolean;
  noParallax: boolean;
  minHud: boolean;
  lowStream: boolean;
  flags: PerfDebugFlag[];
  rawTokens: string[];
}

const perfDebugState = resolvePerfDebugState();

export function getPerfDebugState(): PerfDebugState {
  return perfDebugState;
}

export function isPerfNoPresenceEnabled(): boolean {
  return perfDebugState.noPresence;
}

export function isPerfNoParallaxEnabled(): boolean {
  return perfDebugState.noParallax;
}

export function isPerfMinHudEnabled(): boolean {
  return perfDebugState.minHud;
}

export function isPerfLowStreamEnabled(): boolean {
  return perfDebugState.lowStream;
}

export function applyPerfDebugBodyDataset(doc: Document = document): void {
  const body = doc.body;
  if (!body) {
    return;
  }

  body.dataset.perfDebug = perfDebugState.enabled ? 'true' : 'false';
  body.dataset.perfMinHud = perfDebugState.minHud ? 'true' : 'false';
  body.dataset.perfNoPresence = perfDebugState.noPresence ? 'true' : 'false';
  body.dataset.perfNoParallax = perfDebugState.noParallax ? 'true' : 'false';
  body.dataset.perfLowStream = perfDebugState.lowStream ? 'true' : 'false';
}

function resolvePerfDebugState(): PerfDebugState {
  if (typeof window === 'undefined') {
    return {
      enabled: false,
      showHud: false,
      noPresence: false,
      noParallax: false,
      minHud: false,
      lowStream: false,
      flags: [],
      rawTokens: [],
    };
  }

  const params = new URLSearchParams(window.location.search);
  const rawTokens = params
    .getAll('perf')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  const flags = new Set<PerfDebugFlag>();
  for (const token of rawTokens) {
    switch (token) {
      case '1':
      case 'true':
      case 'on':
      case 'debug':
      case 'hud':
        flags.add('hud');
        break;
      case 'no-presence':
      case 'nopresence':
      case 'presence-off':
        flags.add('no-presence');
        break;
      case 'no-parallax':
      case 'noparallax':
      case 'parallax-off':
        flags.add('no-parallax');
        break;
      case 'min-hud':
      case 'minhud':
      case 'hud-min':
        flags.add('min-hud');
        break;
      case 'low-stream':
      case 'lowstream':
      case 'stream-low':
        flags.add('low-stream');
        break;
      default:
        break;
    }
  }

  const normalizedFlags = Array.from(flags.values());
  const enabled = normalizedFlags.length > 0;
  return {
    enabled,
    showHud: enabled,
    noPresence: flags.has('no-presence'),
    noParallax: flags.has('no-parallax'),
    minHud: flags.has('min-hud'),
    lowStream: flags.has('low-stream'),
    flags: normalizedFlags,
    rawTokens,
  };
}
