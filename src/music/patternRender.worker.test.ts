import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomPatternMusic, ROOM_PATTERN_DRUM_ROWS, type RoomPatternDrumRowId, type RoomPatternPlaybackSequence } from './pattern';
import { renderPatternRequest, type PatternRenderRequest } from './patternRenderCore';

const samples = vi.hoisted(() => new Map<RoomPatternDrumRowId, Float32Array>());
vi.mock('./patternKit', () => ({ getPatternDrumSamples: vi.fn(async () => samples) }));
const context = { sampleRate: 48000, createBuffer: (channels: number, length: number, rate: number) => {
  const arrays = Array.from({ length: channels }, () => new Float32Array(length));
  return { numberOfChannels: channels, length, sampleRate: rate, duration: length / rate, getChannelData: (c: number) => arrays[c] } as AudioBuffer;
} } as AudioContext;

function fingerprint(channels: Float32Array[]): string {
  let hash = 2166136261;
  for (const channel of channels) {
    for (const byte of new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength)) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return `${channels.length}x${channels[0].length}:${hash.toString(16)}`;
}
const bufferChannels = (buffer: AudioBuffer) => Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));

/** A busy swung pattern: every tonal lane, ties, every drum row and panning. */
function busyPattern(): RoomPatternPlaybackSequence {
  const p = createDefaultRoomPatternMusic();
  p.bpm = 128; p.swingPercent = 58;
  for (let s = 0; s < p.stepCount; s += 1) {
    if (s % 2 === 0) p.tabs.triangle.steps[s] = (s * 3) % 7;
    if (s % 3 === 0) p.tabs.saw.steps[s] = (s * 5) % 7;
    if (s % 4 === 1) p.tabs.square.steps[s] = (s * 2) % 7;
    if (s % 2 === 1) p.tabs.triangle.ties[s] = true;
  }
  p.tabs.drums['kick-1'] = [0, 8, 16, 24]; p.tabs.drums.snare = [4, 12, 20, 28];
  p.tabs.drums['closed-hat'] = [2, 6, 10, 14, 18, 22, 26]; p.tabs.drums['open-hat'] = [30, 14];
  p.tabs.drums.crash = [0];
  p.mix.saw.pan = -0.4; p.mix.square.volume = 0.6; p.mix.drums.pan = 0.25;
  return p;
}
function loadDrums(): void {
  ROOM_PATTERN_DRUM_ROWS.forEach((row, index) => samples.set(row.id, Float32Array.from(
    { length: 2000 + index * 900 }, (_, i) => Math.sin(i * (0.05 + index * 0.013)) * Math.exp(-i / (600 + index * 300)),
  )));
}

// Fingerprints of the same renders made by the main-thread renderer before F223.
const BEFORE_F223 = {
  loop: '2x180000:4f52cd96',
  stems: '4x180000:f37daf3b',
  'segment-triangle': '1x182400:efcf2a68',
  'segment-saw': '1x182400:b53d116',
  'segment-square': '1x182400:5869bb25',
  'segment-drums': '1x195500:93ba2588',
};

afterEach(() => { samples.clear(); vi.unstubAllGlobals(); vi.resetModules(); });

describe('music rendering moved off the main thread (F223)', () => {
  it('renders loop, stems and every lane segment bit-for-bit as before', async () => {
    loadDrums();
    const { renderRoomPatternLaneSegment, renderRoomPatternLoopBuffer, renderRoomPatternStemBuffer } = await import('./patternRenderer');
    const p = busyPattern();
    const rendered: Record<string, string> = {
      loop: fingerprint(bufferChannels(await renderRoomPatternLoopBuffer(context, p))),
      stems: fingerprint(bufferChannels(await renderRoomPatternStemBuffer(context, p))),
    };
    for (const id of ['triangle', 'saw', 'square', 'drums'] as const) {
      rendered[`segment-${id}`] = fingerprint(bufferChannels(await renderRoomPatternLaneSegment(context, p, id)));
    }
    expect(rendered).toEqual(BEFORE_F223);
  });

  it('sends drum samples to the worker once, and returns exactly what this thread would render', async () => {
    loadDrums();
    type Message = { type: string; drumsId: number | null; samples?: [string, Float32Array][]; id?: number; request?: PatternRenderRequest };
    const workers: FakeWorker[] = [];
    class FakeWorker extends EventTarget {
      messages: Message[] = [];
      private readonly drums = new Map<number, Map<string, Float32Array>>();
      terminate = vi.fn();
      constructor() { super(); workers.push(this); }
      postMessage(message: Message) {
        this.messages.push(message);
        if (message.type === 'drums') { this.drums.set(message.drumsId ?? 0, new Map(message.samples)); return; }
        const drums = message.drumsId === null ? undefined : this.drums.get(message.drumsId);
        const channels = renderPatternRequest(message.request as PatternRenderRequest, drums ?? new Map());
        queueMicrotask(() => this.dispatchEvent(Object.assign(new Event('message'), { data: { id: message.id, channels } })));
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const { renderRoomPatternStemBuffer, renderRoomPatternLaneSegment } = await import('./patternRenderer');
    const p = busyPattern();
    const stems = await renderRoomPatternStemBuffer(context, p);
    await renderRoomPatternLaneSegment(context, p, 'drums');
    await renderRoomPatternLaneSegment(context, p, 'saw');
    expect(workers).toHaveLength(1);
    expect(workers[0].messages.map((m) => m.type)).toEqual(['drums', 'render', 'render', 'render']);
    expect(workers[0].messages.at(-1)?.drumsId).toBeNull(); // a tonal lane needs no drums
    expect(fingerprint(bufferChannels(stems))).toBe(BEFORE_F223.stems);
  });

  it('falls back to this thread when the worker fails, and stops using it', async () => {
    loadDrums();
    const workers: EventTarget[] = [];
    class BrokenWorker extends EventTarget {
      terminate = vi.fn();
      constructor() { super(); workers.push(this); }
      postMessage(message: { type: string }) {
        if (message.type === 'render') queueMicrotask(() => this.dispatchEvent(new Event('error')));
      }
    }
    vi.stubGlobal('Worker', BrokenWorker);
    const { renderRoomPatternLoopBuffer } = await import('./patternRenderer');
    const p = busyPattern();
    expect(fingerprint(bufferChannels(await renderRoomPatternLoopBuffer(context, p)))).toBe(BEFORE_F223.loop);
    expect(fingerprint(bufferChannels(await renderRoomPatternLoopBuffer(context, p)))).toBe(BEFORE_F223.loop);
    expect(workers).toHaveLength(1);
  });
});
