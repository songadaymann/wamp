import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPatternDrumSamples } from './patternKit';

afterEach(() => vi.unstubAllGlobals());

/** Enough of an AudioBuffer for the kit's mono mix, trim and normalize steps. */
function fakeBuffer(length: number) {
  const channel = Float32Array.from({ length }, (_, index) => Math.sin(index / 3) * 0.5);
  return { numberOfChannels: 1, length, sampleRate: 44_100, duration: length / 44_100, getChannelData: () => channel };
}

describe('pattern drum samples (F023)', () => {
  it('downloads every distinct drum file once, all at the same time', async () => {
    vi.stubGlobal('window', { location: { href: 'https://wamp.land/' } });
    const requested: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requested.push(String(url));
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return new Response(new ArrayBuffer(64));
    }));
    const audioContext = { sampleRate: 44_100, decodeAudioData: vi.fn(async () => fakeBuffer(2_000)) } as unknown as AudioContext;
    const samples = await getPatternDrumSamples(audioContext);
    expect(samples.size).toBeGreaterThanOrEqual(15);
    expect(new Set(requested).size).toBe(requested.length);
    expect(maxInFlight).toBe(requested.length);
  });
});
