import { afterEach, describe, expect, it, vi } from 'vitest';

async function classify(options: { width: number; height: number; coarse: boolean; anyFine: boolean; touchPoints: number }) {
  vi.resetModules();
  vi.stubGlobal('window', {
    innerWidth: options.width,
    innerHeight: options.height,
    visualViewport: undefined,
    matchMedia: (query: string) => ({
      matches: query.includes('any-pointer: fine') ? options.anyFine : query.includes('pointer: coarse') ? options.coarse : false,
    }),
    addEventListener: () => {},
  });
  vi.stubGlobal('navigator', { maxTouchPoints: options.touchPoints, hardwareConcurrency: 8 });
  vi.stubGlobal('document', { body: { dataset: {} }, documentElement: { style: { setProperty: () => {} } } });
  const { initializeDeviceLayout } = await import('./deviceLayout');
  return initializeDeviceLayout();
}

describe('device layout classification', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('treats a touchscreen laptop with a trackpad as a desktop', async () => {
    const layout = await classify({ width: 1440, height: 900, coarse: false, anyFine: true, touchPoints: 10 });
    expect(layout.deviceClass).toBe('desktop');
    expect(layout.coarsePointer).toBe(false);
  });

  it('still treats touch-only tablets and phones as touch devices', async () => {
    expect((await classify({ width: 1180, height: 820, coarse: true, anyFine: false, touchPoints: 5 })).deviceClass).toBe('tablet');
    expect((await classify({ width: 844, height: 390, coarse: true, anyFine: false, touchPoints: 5 })).deviceClass).toBe('phone');
  });

  it('counts touch points as touch when the browser reports no fine pointer at all', async () => {
    const layout = await classify({ width: 820, height: 1180, coarse: false, anyFine: false, touchPoints: 5 });
    expect(layout.coarsePointer).toBe(true);
    expect(layout.deviceClass).toBe('tablet');
  });
});
