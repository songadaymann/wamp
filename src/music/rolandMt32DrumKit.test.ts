import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

describe('baked drum playback (F023)', () => {
  it('preserves decoded attacks, padding and gain, and retains the tight-kick pitch variant', async () => {
    vi.resetModules();
    vi.stubGlobal('window', { location: { href: 'https://wamp.land/r/-11/-6' } });
    const fetchMock = vi.fn(async (url: string) => { expect(url).toContain("bassdrum.mp3"); return new Response(new ArrayBuffer(64)); });
    vi.stubGlobal('fetch', fetchMock);
    const source = Float32Array.from([0, 0, 0.4, -0.2, 0.8, 0.1, 0, 0]);
    const context = {
      sampleRate: 48000,
      decodeAudioData: vi.fn(async () => ({ getChannelData: () => source })),
    } as unknown as AudioContext;
    const { loadRolandMt32DrumSample } = await import('./rolandMt32DrumKit');
    const normal = await loadRolandMt32DrumSample(context, 'kick-1');
    const tight = await loadRolandMt32DrumSample(context, 'kick-2');
    expect(normal).toEqual(source);
    expect(normal).not.toBe(source);
    expect(tight?.length).toBe(Math.floor(source.length / 1.08));
    expect(tight?.[2]).toBeCloseTo(source[2] * 0.84 + source[3] * 0.16);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://wamp.land/assets/music/roland-mt32/bassdrum.mp3');
  });
});
