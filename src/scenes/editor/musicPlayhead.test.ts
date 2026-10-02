import { describe, expect, it } from 'vitest';
import { resolveMusicPlayheadStep } from './musicPlayhead';

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
});
