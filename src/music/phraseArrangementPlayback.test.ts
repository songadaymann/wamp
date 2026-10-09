import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PhraseArrangementScheduler,
  findNextArrangementHat,
  getArrangementSlotStart,
  listArrangementSegments,
  type ArrangementLaneSegment,
  type ArrangementTimeline,
} from './phraseArrangementPlayback';
import type { RoomPatternInstrumentId } from './pattern';

const segment = (duration: number, hats: number[] = [], trailing: number | null = null): ArrangementLaneSegment => ({
  buffer: { duration } as AudioBuffer,
  hatTimesSec: hats,
  trailingOpenHatSec: trailing,
});

function timeline(lanes: Partial<Record<RoomPatternInstrumentId, (ArrangementLaneSegment | null)[]>>, slotCount = 3): ArrangementTimeline {
  return { sampleRate: 1000, slotDurationSec: 4, slotCount, lanes: new Map(Object.entries(lanes)) as ArrangementTimeline['lanes'] };
}

describe('Arrange segment timing', () => {
  it('places slots on whole samples and repeats on the rounded loop length', () => {
    const t: ArrangementTimeline = { sampleRate: 48000, slotDurationSec: (60 / 97) * 8, slotCount: 3, lanes: new Map() };
    const loopSamples = Math.round(3 * t.slotDurationSec * 48000);
    for (const index of [-4, -1, 0, 1, 2, 3, 7]) {
      const offsetSamples = (getArrangementSlotStart(t, 0, index)) * 48000;
      expect(Math.abs(offsetSamples - Math.round(offsetSamples))).toBeLessThan(1e-6);
    }
    expect(getArrangementSlotStart(t, 0, 3) * 48000).toBeCloseTo(loopSamples, 6);
    expect((getArrangementSlotStart(t, 0, 4) - getArrangementSlotStart(t, 0, 1)) * 48000).toBeCloseTo(loopSamples, 6);
  });

  it('starts mid-loop inside the current slot and keeps earlier slots that are still ringing', () => {
    // Loop origin 10: slots at 10, 14, 18 (then 22, 26...). Start 5 s in, at 15.
    const t = timeline({ saw: [segment(4.05), segment(4.05), null], drums: [segment(6), null, segment(4.1)] });
    const { segments, nextIndex } = listArrangementSegments(t, 10, 15, -2, 23);
    expect(segments.map((s) => [s.lane, s.slot, +s.segmentStart.toFixed(6), s.when, +s.offset.toFixed(3)])).toEqual([
      ['drums', 0, 10, 15, 5], // 6 s drum tail from slot 0 still sounds at 15
      ['saw', 1, 14, 15, 1],
      ['drums', 2, 18, 18, 0],
      ['saw', 0, 22, 22, 0], // wraps to slot 0 of the next loop
      ['drums', 0, 22, 22, 0],
    ]);
    expect(nextIndex).toBe(4);
    // Continuing from nextIndex never repeats a slot.
    expect(listArrangementSegments(t, 10, 15, nextIndex, 27).segments.map((s) => s.segmentStart)).toEqual([26]);
  });

  it('finds the hat that chokes a trailing open hat in the following slots, wrapping around the loop', () => {
    const t = timeline({ drums: [segment(5, [0.5, 3.5], 3.5), segment(5), segment(5, [1])] });
    // Origin 10: position 0 starts at 10, position 2 at 18.
    expect(findNextArrangementHat(t, 10, 0)).toBeCloseTo(10 + 8 + 1, 9);
    expect(findNextArrangementHat(t, 10, 2)).toBeCloseTo(18 + 4 + 0.5, 9);
    const alone = timeline({ drums: [segment(5, [3.5], 3.5), null, null] });
    expect(findNextArrangementHat(alone, 10, 0)).toBeCloseTo(10 + 12 + 3.5, 9);
  });
});

describe('PhraseArrangementScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function context() {
    const sources: Array<{ buffer: unknown; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn> }> = [];
    const gains: Array<{ gain: { value: number; setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn> }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    const ctx = {
      currentTime: 10,
      createBufferSource: () => {
        const source = { buffer: null, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), addEventListener: vi.fn() };
        sources.push(source); return source;
      },
      createGain: () => {
        const gain = { gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
        gains.push(gain); return gain;
      },
    };
    return { ctx: ctx as unknown as AudioContext & { currentTime: number }, sources, gains };
  }

  it('schedules ahead, keeps scheduling as time passes, and stops every voice', () => {
    const { ctx, sources } = context();
    const sawIn = {} as AudioNode;
    const t = timeline({ saw: [segment(4.05), segment(4.05), segment(4.05)] });
    const scheduler = new PhraseArrangementScheduler(ctx, t, new Map([['saw', sawIn]]), null, 10, 10.02);
    scheduler.start();
    // 1.5 s lookahead from 10: the previous loop's last-slot release tail and the slot at 10.
    expect(sources.map((s) => s.start.mock.calls[0])).toEqual([
      [10.02, expect.closeTo(4.02, 6)],
      [10.02, expect.closeTo(0.02, 6)],
    ]);
    expect(sources[1].connect).toHaveBeenCalledWith(sawIn);
    ctx.currentTime = 12.6; vi.advanceTimersByTime(250);
    expect(sources.map((s) => s.start.mock.calls[0][0])).toEqual([10.02, 10.02, 14]);
    scheduler.stop(13);
    expect(sources[1].stop).toHaveBeenCalledWith(13);
    expect(sources[2].stop).toHaveBeenCalledWith(14); // not yet started: plays nothing
    ctx.currentTime = 20; vi.advanceTimersByTime(1000);
    expect(sources).toHaveLength(3);
    const ended = vi.fn(); ctx.currentTime = 12.9; scheduler.onEnded(ended);
    vi.advanceTimersByTime(150); expect(ended).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100); expect(ended).toHaveBeenCalledOnce();
  });

  it('plays a trailing open hat until the next slot’s hat chokes it over 10 ms', () => {
    const { ctx, sources, gains } = context();
    const drumsIn = {} as AudioNode;
    const voice = { duration: 2 } as AudioBuffer;
    const t = timeline({ drums: [segment(5, [0.5, 3.5], 3.5), segment(5, [0.25])] }, 2);
    const scheduler = new PhraseArrangementScheduler(ctx, t, new Map([['drums', drumsIn]]), voice, 10, 10);
    scheduler.scheduleUntil(15);
    const hat = sources.find((s) => s.buffer === voice)!;
    expect(hat.start).toHaveBeenCalledWith(13.5, 0);
    expect(hat.stop).toHaveBeenCalledWith(expect.closeTo(14.26, 6));
    const choke = gains.find((g) => g.connect.mock.calls[0][0] === drumsIn)!;
    expect(choke.gain.setValueAtTime).toHaveBeenCalledWith(1, 14.25);
    expect(choke.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.closeTo(14.26, 6));
    // Stopping later must not extend the hat past its choke.
    scheduler.stop(20);
    expect(hat.stop).toHaveBeenLastCalledWith(expect.closeTo(14.26, 6));
  });
});
