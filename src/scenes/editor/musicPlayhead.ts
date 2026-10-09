interface MusicPlayheadTiming {
  audioCurrentTime: number | null;
  transportStartTime: number | null;
  patternStartTime: number | null;
  loopDurationSec: number | null;
  /** Seconds between scheduling a sample and hearing it (large on Bluetooth). */
  outputLatencySec?: number | null;
}

/** Seconds into the loop that is audible now, measured on the running transport. */
function resolveAudibleLoopOffset(input: MusicPlayheadTiming): number | null {
  if (
    input.audioCurrentTime === null
    || input.loopDurationSec === null
    || input.loopDurationSec <= 0
  ) {
    return null;
  }

  const timelineStart = input.transportStartTime !== null && input.transportStartTime > 0
    ? input.transportStartTime
    : input.patternStartTime;
  if (timelineStart === null) {
    return null;
  }

  const latency = Math.max(0, input.outputLatencySec ?? 0);
  const elapsed = Math.max(0, input.audioCurrentTime - latency - timelineStart);
  return elapsed % input.loopDurationSec;
}

/** Step column for the sequencer playhead, following the renderer's swung step pairs. */
export function resolveMusicPlayheadStep(input: MusicPlayheadTiming & {
  stepCount: number;
  swingPercent?: number | null;
}): number | null {
  const loopOffset = resolveAudibleLoopOffset(input);
  if (loopOffset === null || input.loopDurationSec === null || input.stepCount <= 0) {
    return null;
  }

  const stepDuration = input.loopDurationSec / input.stepCount;
  const pairIndex = Math.floor(loopOffset / (stepDuration * 2));
  const firstStep = pairIndex * 2;
  if (firstStep + 1 >= input.stepCount) {
    return Math.max(0, Math.min(input.stepCount - 1, firstStep));
  }

  // Matches getStepTimingSec in the pattern renderer: the first step of each
  // pair lasts swing% of the pair, so off-beat steps start late.
  const swingRatio = Math.max(0.5, Math.min(0.95, (input.swingPercent ?? 50) / 100));
  const pairOffset = loopOffset - pairIndex * stepDuration * 2;
  return pairOffset < stepDuration * 2 * swingRatio ? firstStep : firstStep + 1;
}

/** Equal-length segment (Arrange slot) audible now, or null when nothing is playing. */
export function resolveMusicPlayheadSegment(input: MusicPlayheadTiming & {
  segmentCount: number;
}): number | null {
  const loopOffset = resolveAudibleLoopOffset(input);
  if (loopOffset === null || input.loopDurationSec === null || input.segmentCount <= 0) {
    return null;
  }

  return Math.max(
    0,
    Math.min(input.segmentCount - 1, Math.floor((loopOffset / input.loopDurationSec) * input.segmentCount)),
  );
}
