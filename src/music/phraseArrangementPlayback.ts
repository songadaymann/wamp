import { ROOM_PATTERN_HAT_CHOKE_FADE_SEC } from './patternRenderer';
import type { RoomPatternInstrumentId } from './pattern';

/** One lane of one Arrange slot, rendered once and replayed wherever the phrase sits. */
export interface ArrangementLaneSegment {
  /** Raw lane audio from the slot start through all tails, before lane drive. */
  buffer: AudioBuffer;
  /** Drums: every hat onset within the slot, ascending. */
  hatTimesSec: readonly number[];
  /** Drums: a final open hat left out of `buffer`, choked by the next hat in the arrangement. */
  trailingOpenHatSec: number | null;
}

export interface ArrangementTimeline {
  /** Slot and loop starts land on whole samples, as in a single rendered loop. */
  sampleRate: number;
  slotDurationSec: number;
  /** Active slots: the loop is slotCount slots long. */
  slotCount: number;
  /** Per lane, one entry per active slot. */
  lanes: ReadonlyMap<RoomPatternInstrumentId, readonly (ArrangementLaneSegment | null)[]>;
}

export interface ScheduledSegment {
  lane: RoomPatternInstrumentId;
  /** Slot position counted from slot 0 of loop 0 (may be negative). */
  index: number;
  slot: number;
  /** When the slot's audio begins on the context clock (may precede `startAt`). */
  segmentStart: number;
  /** Audio-clock start and buffer offset to play from. */
  when: number;
  offset: number;
}

/**
 * When slot position `index` begins: slot index mod slotCount of loop
 * floor(index / slotCount). Offsets are whole samples from `origin`, and the
 * loop repeats every round(loop * sampleRate) samples, like the looped buffer.
 * Where a slot is not a whole number of samples long, its notes land within one
 * sample of a single rendered loop; that keeps one shared render per phrase.
 */
export function getArrangementSlotStart(timeline: ArrangementTimeline, origin: number, index: number): number {
  const { sampleRate, slotCount, slotDurationSec } = timeline;
  const loopSamples = Math.max(1, Math.round(slotCount * slotDurationSec * sampleRate));
  const loop = Math.floor(index / slotCount);
  const slot = index - loop * slotCount;
  return origin + (loop * loopSamples + Math.round(slot * slotDurationSec * sampleRate)) / sampleRate;
}

/**
 * Segment instances for slot positions `fromIndex` onward that begin before
 * `toSec`, clipped so nothing sounds before `startAt`. Returns the next position.
 */
export function listArrangementSegments(
  timeline: ArrangementTimeline,
  origin: number,
  startAt: number,
  fromIndex: number,
  toSec: number,
): { segments: ScheduledSegment[]; nextIndex: number } {
  const segments: ScheduledSegment[] = [];
  if (timeline.slotDurationSec <= 0 || timeline.slotCount <= 0) {
    return { segments, nextIndex: fromIndex };
  }

  let index = fromIndex;
  for (; getArrangementSlotStart(timeline, origin, index) < toSec; index += 1) {
    const segmentStart = getArrangementSlotStart(timeline, origin, index);
    const slot = ((index % timeline.slotCount) + timeline.slotCount) % timeline.slotCount;
    for (const [lane, laneSegments] of timeline.lanes) {
      const segment = laneSegments[slot];
      if (!segment || segmentStart + segment.buffer.duration <= startAt) {
        continue;
      }
      const when = Math.max(segmentStart, startAt);
      segments.push({ lane, index, slot, segmentStart, when, offset: when - segmentStart });
    }
  }
  return { segments, nextIndex: index };
}

/** The first hat after slot position `index`'s trailing open hat, searching the following slots around the loop. */
export function findNextArrangementHat(
  timeline: ArrangementTimeline,
  origin: number,
  index: number,
): number | null {
  const drums = timeline.lanes.get('drums');
  if (!drums) {
    return null;
  }
  for (let step = 1; step <= timeline.slotCount; step += 1) {
    const next = drums[(((index + step) % timeline.slotCount) + timeline.slotCount) % timeline.slotCount];
    if (next && next.hatTimesSec.length > 0) {
      return getArrangementSlotStart(timeline, origin, index + step) + next.hatTimesSec[0];
    }
  }
  return null;
}

const LOOKAHEAD_SEC = 1.5;
const SCHEDULE_INTERVAL_MS = 250;

/**
 * Plays an Arrange timeline by starting each slot's lane segments shortly before
 * they are due, so editing a slot only renders that phrase. Lane inputs are the
 * mixer nodes that apply drive, volume and pan.
 */
type ScheduledVoice = { source: AudioBufferSourceNode; start: number; end: number | null; gain: GainNode | null };

export class PhraseArrangementScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextIndex: number;
  private stopTime: number | null = null;
  private readonly voices = new Set<ScheduledVoice>();
  private endedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly audioContext: AudioContext,
    private readonly timeline: ArrangementTimeline,
    private readonly laneInputs: ReadonlyMap<RoomPatternInstrumentId, AudioNode>,
    private readonly openHatVoice: AudioBuffer | null,
    private readonly origin: number,
    private readonly startAt: number,
  ) {
    // Start far enough back to pick up tails of earlier slots still ringing at startAt.
    let longest = openHatVoice?.duration ?? 0;
    for (const segments of timeline.lanes.values()) {
      for (const segment of segments) {
        longest = Math.max(longest, segment?.buffer.duration ?? 0);
      }
    }
    this.nextIndex = Math.floor((startAt - longest - origin) / timeline.slotDurationSec);
  }

  start(): void {
    this.scheduleUntil(this.audioContext.currentTime + LOOKAHEAD_SEC);
    this.timer = setInterval(() => this.scheduleUntil(this.audioContext.currentTime + LOOKAHEAD_SEC), SCHEDULE_INTERVAL_MS);
  }

  /** Starts every segment due before `horizon` (also used directly by offline rendering). */
  scheduleUntil(horizon: number): void {
    const end = this.stopTime === null ? horizon : Math.min(horizon, this.stopTime);
    const { segments, nextIndex } = listArrangementSegments(this.timeline, this.origin, this.startAt, this.nextIndex, end);
    this.nextIndex = nextIndex;
    for (const item of segments) {
      const segment = this.timeline.lanes.get(item.lane)?.[item.slot];
      const input = this.laneInputs.get(item.lane);
      if (!segment || !input) {
        continue;
      }
      this.play(segment.buffer, input, item.when, item.offset, null, null);
      if (item.lane === 'drums' && segment.trailingOpenHatSec !== null) {
        this.playTrailingOpenHat(item, segment.trailingOpenHatSec, input);
      }
    }
  }

  stop(when: number): void {
    this.stopTime = when;
    this.clearTimer();
    for (const voice of this.voices) {
      try {
        voice.source.stop(Math.min(voice.end ?? Infinity, Math.max(when, voice.start)));
      } catch {
        void 0;
      }
    }
  }

  /** Called once after `stop` once every voice has finished. */
  onEnded(listener: () => void): void {
    const audioContext = this.audioContext;
    const remainingSec = Math.max(0, (this.stopTime ?? audioContext.currentTime) - audioContext.currentTime);
    if (this.endedTimer !== null) clearTimeout(this.endedTimer);
    this.endedTimer = setTimeout(() => {
      this.endedTimer = null;
      listener();
    }, remainingSec * 1000 + 100);
  }

  dispose(): void {
    this.clearTimer();
    for (const voice of this.voices) {
      this.release(voice);
    }
  }

  private playTrailingOpenHat(item: ScheduledSegment, trailingSec: number, input: AudioNode): void {
    const voiceBuffer = this.openHatVoice;
    if (!voiceBuffer) {
      return;
    }
    const hatStart = item.segmentStart + trailingSec;
    const choke = findNextArrangementHat(this.timeline, this.origin, item.index);
    const ringEnd = hatStart + voiceBuffer.duration;
    const end = choke === null ? ringEnd : Math.min(ringEnd, choke + ROOM_PATTERN_HAT_CHOKE_FADE_SEC);
    if (end <= this.startAt) {
      return;
    }
    const gain = this.audioContext.createGain();
    gain.gain.value = 1;
    if (choke !== null && choke < ringEnd) {
      gain.gain.setValueAtTime(1, choke);
      gain.gain.linearRampToValueAtTime(0, choke + ROOM_PATTERN_HAT_CHOKE_FADE_SEC);
    }
    gain.connect(input);
    const when = Math.max(hatStart, this.startAt);
    this.play(voiceBuffer, gain, when, when - hatStart, gain, end);
  }

  private play(
    buffer: AudioBuffer,
    destination: AudioNode,
    when: number,
    offset: number,
    gain: GainNode | null,
    end: number | null,
  ): void {
    if (offset >= buffer.duration) {
      gain?.disconnect();
      return;
    }
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);
    const voice: ScheduledVoice = { source, start: when, end, gain };
    this.voices.add(voice);
    source.addEventListener('ended', () => this.release(voice), { once: true });
    source.start(when, offset);
    const stopAt = Math.min(end ?? Infinity, this.stopTime === null ? Infinity : Math.max(this.stopTime, when));
    if (Number.isFinite(stopAt)) {
      source.stop(stopAt);
    }
  }

  private release(voice: ScheduledVoice): void {
    this.voices.delete(voice);
    try {
      voice.source.disconnect();
    } catch {
      void 0;
    }
    try {
      voice.gain?.disconnect();
    } catch {
      void 0;
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
