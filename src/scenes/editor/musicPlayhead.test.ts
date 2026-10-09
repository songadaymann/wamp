import { describe, expect, it } from 'vitest';
import { resolveMusicPlayheadSegment, resolveMusicPlayheadStep } from './musicPlayhead';

describe('resolveMusicPlayheadStep', () => {
  it('keeps the playhead on the transport when a note edit restarts the loop', () => {
    const step = resolveMusicPlayheadStep({
      audioCurrentTime: 25.5,
      transportStartTime: 10,
      patternStartTime: 25.4,
      loopDurationSec: 8,
      stepCount: 32,
    });

    const transportOffset = (25.5 - 10) % 8;
    expect(step).toBe(Math.floor((transportOffset / 8) * 32));
    expect(step).not.toBe(Math.floor(((25.5 - 25.4) / 8) * 32));
  });

  it('uses the pattern start before the transport is running', () => {
    expect(resolveMusicPlayheadStep({
      audioCurrentTime: 4,
      transportStartTime: 0,
      patternStartTime: 2,
      loopDurationSec: 8,
      stepCount: 32,
    })).toBe(Math.floor((2 / 8) * 32));
  });

  it('follows swung step pairs so the playhead waits for late off-beats', () => {
    // 8 s loop, 32 steps: 0.25 s per step, 0.5 s per pair. At 75% swing the
    // off-beat of each pair starts 0.375 s into the pair instead of 0.25 s.
    const at = (offset: number, swingPercent: number) => resolveMusicPlayheadStep({
      audioCurrentTime: 10 + offset,
      transportStartTime: 10,
      patternStartTime: 10,
      loopDurationSec: 8,
      stepCount: 32,
      swingPercent,
    });
    expect(at(0.3, 50)).toBe(1);
    expect(at(0.3, 75)).toBe(0);
    expect(at(0.38, 75)).toBe(1);
    expect(at(4.3, 75)).toBe(16);
    expect(at(7.9, 75)).toBe(31);
  });

  it('shows what is audible by holding back for output latency', () => {
    const input = { audioCurrentTime: 12, transportStartTime: 10, patternStartTime: 10, loopDurationSec: 8, stepCount: 32 };
    expect(resolveMusicPlayheadStep(input)).toBe(8);
    expect(resolveMusicPlayheadStep({ ...input, outputLatencySec: 0.2 })).toBe(7);
    expect(resolveMusicPlayheadStep({ ...input, audioCurrentTime: 10.1, outputLatencySec: 0.2 })).toBe(0);
  });
});

describe('resolveMusicPlayheadSegment', () => {
  const playing = { transportStartTime: 10, patternStartTime: 10, loopDurationSec: 12, segmentCount: 3 };

  it('maps the transport onto equal Arrange slots and wraps with the loop', () => {
    expect(resolveMusicPlayheadSegment({ ...playing, audioCurrentTime: 10 })).toBe(0);
    expect(resolveMusicPlayheadSegment({ ...playing, audioCurrentTime: 14.01 })).toBe(1);
    expect(resolveMusicPlayheadSegment({ ...playing, audioCurrentTime: 21.99 })).toBe(2);
    expect(resolveMusicPlayheadSegment({ ...playing, audioCurrentTime: 22.5 })).toBe(0);
    expect(resolveMusicPlayheadSegment({ ...playing, audioCurrentTime: 14.1, outputLatencySec: 0.2 })).toBe(0);
  });

  it('is empty when nothing is playing', () => {
    expect(resolveMusicPlayheadSegment({ ...playing, audioCurrentTime: null })).toBeNull();
    expect(resolveMusicPlayheadSegment({ ...playing, audioCurrentTime: 12, loopDurationSec: null })).toBeNull();
    expect(resolveMusicPlayheadSegment({ ...playing, audioCurrentTime: 12, transportStartTime: 0, patternStartTime: null })).toBeNull();
  });
});
