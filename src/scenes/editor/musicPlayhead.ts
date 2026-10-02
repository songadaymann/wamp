/** Step column for the sequencer playhead, measured on the running transport. */
export function resolveMusicPlayheadStep(input: {
  audioCurrentTime: number | null;
  transportStartTime: number | null;
  patternStartTime: number | null;
  loopDurationSec: number | null;
  stepCount: number;
}): number | null {
  if (
    input.audioCurrentTime === null
    || input.loopDurationSec === null
    || input.loopDurationSec <= 0
    || input.stepCount <= 0
  ) {
    return null;
  }

  const timelineStart = input.transportStartTime !== null && input.transportStartTime > 0
    ? input.transportStartTime
    : input.patternStartTime;
  if (timelineStart === null) {
    return null;
  }

  const elapsed = Math.max(0, input.audioCurrentTime - timelineStart);
  const loopOffset = elapsed % input.loopDurationSec;
  return Math.max(
    0,
    Math.min(input.stepCount - 1, Math.floor((loopOffset / input.loopDurationSec) * input.stepCount)),
  );
}
