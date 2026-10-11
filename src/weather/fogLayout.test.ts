import { describe, expect, it } from 'vitest';
import { layoutFogLobes, type FogLobe } from './fogLayout';
import type { RoomWeatherSettings } from './model';

const bounds = { x: 640, y: -360, width: 480, height: 270 };

// Recorded from the Graphics fillEllipse fog before F004: blob count; sums of x, y, width and
// height; summed opacity; first and last blob as [x, y, width, height, alpha].
const reference = [
  { name: 'fog 50', roomId: '3,-2', weather: { mode: 'fog', intensity: 50 }, timeMs: 1234, bands: 19,
    count: 275, sums: [242876, -59016, 80021, 10936], alpha: 13.582, first: [829, -157, 378, 45, 0.03303], last: [1030, -294, 150, 54, 0.045305] },
  { name: 'fog 100', roomId: '-2,11', weather: { mode: 'fog', intensity: 100 }, timeMs: 98765, bands: 30,
    count: 626, sums: [556869, -145452, 237113, 30459], alpha: 44.2778, first: [772, -221, 264, 76, 0.062632], last: [1024, -214, 192, 25, 0.065382] },
  { name: 'rain 60', roomId: '6,-3', weather: { mode: 'rain', intensity: 60 }, timeMs: 4321, bands: 3,
    count: 14, sums: [12536, -3826, 1904, 218], alpha: 0.1503, first: [807, -221, 83, 10, 0.00784], last: [1049, -277, 101, 8, 0.008579] },
] as const;

const row = (lobe: FogLobe) => [lobe.x, lobe.y, lobe.width, lobe.height, Number(lobe.alpha.toFixed(6))];

describe('fog layout (F004)', () => {
  it.each(reference)('places every $name blob exactly where the Graphics fog drew it', (c) => {
    const out: FogLobe[] = [];
    const count = layoutFogLobes(bounds, c.roomId, c.weather as RoomWeatherSettings, c.timeMs, c.bands, out);
    const lobes = out.slice(0, count);
    expect(count).toBe(c.count);
    expect([0, 1, 2, 3].map((i) => lobes.reduce((sum, lobe) => sum + row(lobe)[i], 0))).toEqual(c.sums);
    expect(Number(lobes.reduce((sum, lobe) => sum + Number(lobe.alpha.toFixed(6)), 0).toFixed(4))).toBe(c.alpha);
    expect(row(lobes[0])).toEqual(c.first);
    expect(row(lobes[count - 1])).toEqual(c.last);
  });

  it('reuses the same blob objects every frame instead of allocating new ones', () => {
    const out: FogLobe[] = [];
    const weather = { mode: 'fog', intensity: 50 } as RoomWeatherSettings;
    layoutFogLobes(bounds, '3,-2', weather, 0, 19, out);
    const first = out[0]; const length = out.length;
    const count = layoutFogLobes(bounds, '3,-2', weather, 16, 19, out);
    expect(out[0]).toBe(first); expect(out.length).toBe(length); expect(count).toBe(length);
    expect(layoutFogLobes(bounds, '3,-2', weather, 32, 2, out)).toBeLessThan(length);
    expect(out.length).toBe(length); // a smaller frame leaves the spare objects for later
  });
});
