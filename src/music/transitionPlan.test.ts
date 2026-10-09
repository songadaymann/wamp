import { describe, expect, it } from 'vitest';
import { createDefaultRoomMusic, createDefaultRoomPatternMusic, createDefaultRoomPhraseArrangementMusic } from './model';
import { getMusicTransitionPlan } from './transitionPlan';

const pattern = () => createDefaultRoomPatternMusic();
const base = () => ({ prior: pattern(), next: pattern(), now: 5, transportStartTime: 1, hasPriorPlayback: true, hasAudiblePlayback: true, transition: 'room' as const });

describe('room music transition timing', () => {
  it('starts first entry and re-entry after silence at beat one and reanchors transport', () => {
    const p = getMusicTransitionPlan({ ...base(), prior: null, hasPriorPlayback: false, hasAudiblePlayback: false });
    expect(p.startAt).toBe(5.02); expect(p.stopAt).toBe(5); expect(p.loopOffset).toBe(0); expect(p.transportStartTime).toBe(5.02);
  });

  it('keeps compatible tempo, swing and key on the existing bar grid', () => {
    const p = getMusicTransitionPlan({ ...base(), now: 5.5 });
    expect(p.startAt).toBe(7); expect(p.loopOffset).toBe(2); expect(p.transportStartTime).toBe(1); expect(p.fadeDuration).toBe(2);
  });

  it.each(['tempo', 'key', 'swing'] as const)('uses a short own-downbeat blend for incompatible %s', (kind) => {
    const input = base();
    if (kind === 'tempo') input.next.bpm = 60;
    if (kind === 'key') input.next.keyTonic = 'D';
    if (kind === 'swing') input.next.swingPercent = 60;
    const p = getMusicTransitionPlan(input);
    expect(p.startAt).toBe(5.02); expect(p.loopOffset).toBe(0); expect(p.fadeDuration).toBe(0.3); expect(p.transportStartTime).toBe(5.02);
  });

  it('does not treat a future scheduled room as audible transport', () => {
    const p = getMusicTransitionPlan({ ...base(), hasAudiblePlayback: false, transportStartTime: 7 });
    expect(p.quantizeToBar).toBe(false); expect(p.loopOffset).toBe(0); expect(p.startAt).toBe(5.02);
  });

  it('applies the same compatibility rules to phrases and stem packs', () => {
    const phrase = createDefaultRoomPhraseArrangementMusic();
    phrase.bpm = 120;
    expect(getMusicTransitionPlan({ ...base(), next: phrase }).quantizeToBar).toBe(true);
    const stem = createDefaultRoomMusic();
    expect(getMusicTransitionPlan({ ...base(), prior: stem, next: stem }).quantizeToBar).toBe(true);
    expect(getMusicTransitionPlan({ ...base(), next: stem }).loopOffset).toBe(0);
  });

  it('preserves explicit editor immediate-phase and custom fade options', () => {
    const p = getMusicTransitionPlan({ ...base(), transition: 'immediate', fadeDurationSec: 0.1 });
    expect(p.loopOffset).toBeCloseTo(0.02); expect(p.transportStartTime).toBe(1); expect(p.fadeDuration).toBe(0.1);
  });
});
