import { describe, expect, it } from 'vitest';
import { formatClearTime, formatPostRunBest, getPostRunBest } from './postRunBest';

describe('clear comparison', () => {
  const best = { rankingMode: 'time' as const, displayName: 'Fast Player', elapsedMs: 3500, score: 20 };
  it('compares faster, slower and matching clears at the shown timer precision', () => {
    expect(formatPostRunBest(best, 15000)).toContain('0:11.5 behind');
    expect(formatPostRunBest(best, 2500)).toContain('0:01.0 ahead');
    expect(formatPostRunBest(best, 3500)).toContain('matched the best time');
    expect(formatPostRunBest(best, 3599)).toContain('within 0.1s of the best');
    expect(formatClearTime(59999)).toBe('0:59.9');
    expect(formatClearTime(60000)).toBe('1:00.0');
  });
  it('does not call a score winner the fastest or invent a best when there are no ranked clears', () => {
    expect(formatPostRunBest({ ...best, rankingMode: 'score' }, 15000)).toBe('Leader: Fast Player · 20 pts');
    expect(getPostRunBest({ rankingMode: 'time', entries: [] })).toBeNull();
    expect(formatPostRunBest(null, 15000)).toBe('');
  });
});
