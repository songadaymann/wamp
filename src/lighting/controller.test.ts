import { describe, expect, it, vi } from 'vitest';
import { RoomLightingController } from './controller';

vi.mock('phaser', () => ({ default: { WEBGL: 2, BlendModes: { ADD: 1 } } }));

/** A render texture that records the draw calls made on it. */
function fakeRenderTexture(width: number, height: number) {
  const calls: Array<[string, ...unknown[]]> = [];
  const target: Record<string, unknown> = { width, height, calls };
  return new Proxy(target, {
    get(object, key: string) {
      if (key in object) return object[key];
      return (...args: unknown[]) => { calls.push([key, ...args]); return target; };
    },
  }) as unknown as { calls: Array<[string, ...unknown[]]> };
}

describe('dark-room lighting passes (F005)', () => {
  it('cuts every light out of the darkness in one pass and draws every glow in one pass', () => {
    const textures: ReturnType<typeof fakeRenderTexture>[] = [];
    const scene = {
      game: { renderer: { type: 2 } },
      time: { now: 0 },
      textures: { exists: () => true },
      add: {
        renderTexture: (_x: number, _y: number, width: number, height: number) => { const rt = fakeRenderTexture(width, height); textures.push(rt); return rt; },
        rectangle: () => fakeRenderTexture(0, 0),
      },
    };
    const controller = new RoomLightingController({ scene: scene as never, overlayDepth: 10 });
    const emitters = Array.from({ length: 6 }, (_, index) => ({
      x: 40 + index * 80, y: 120, sourceType: 'object' as const, revealRadiusPx: 30, glowRadiusPx: 24, glowColor: 0xff8800, glowAlpha: 0.5,
    }));
    controller.sync({ roomId: '2,1', bounds: { x: 0, y: 0, width: 640, height: 352 },
      lighting: { mode: 'playerAuraDark', darkness: 80, radius: 50 }, emitters });

    const [overlay, glow] = textures;
    const names = (rt: typeof overlay) => rt.calls.map(([name]) => name).filter((name) => /Draw|erase|drawFrame/.test(name));
    expect(names(overlay)).toEqual(['beginDraw', ...emitters.map(() => 'batchDrawFrame'), 'endDraw']);
    expect(overlay.calls.find(([name]) => name === 'endDraw')).toEqual(['endDraw', true]);
    expect(names(glow)).toEqual(['beginDraw', ...emitters.map(() => 'batchDrawFrame'), 'endDraw']);
    expect(glow.calls.filter(([name]) => name === 'batchDrawFrame')[0]).toEqual(['batchDrawFrame', '__room_light_glow_48', undefined, 16, 96, 0.5, 0xff8800]);
  });
});
