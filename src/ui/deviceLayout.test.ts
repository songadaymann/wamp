import { afterEach, describe, expect, it, vi } from 'vitest';

async function classify(options: { width: number; height: number; coarse: boolean; touchPoints: number; visualViewport?: { width: number; height: number; scale: number } }) {
  vi.resetModules();
  vi.stubGlobal('window', {
    innerWidth: options.width,
    innerHeight: options.height,
    visualViewport: options.visualViewport ? { ...options.visualViewport, addEventListener: () => {} } : undefined,
    matchMedia: (query: string) => ({ matches: query.includes('pointer: coarse') ? options.coarse : false }),
    addEventListener: () => {},
  });
  vi.stubGlobal('navigator', { maxTouchPoints: options.touchPoints, hardwareConcurrency: 8 });
  vi.stubGlobal('document', { body: { dataset: {} }, documentElement: { style: { setProperty: () => {} } } });
  const { initializeDeviceLayout } = await import('./deviceLayout');
  return initializeDeviceLayout();
}

describe('device layout classification', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps touch gestures on a touchscreen laptop but does not mark touch as its main input', async () => {
    const layout = await classify({ width: 1440, height: 900, coarse: false, touchPoints: 10 });
    expect(layout.coarsePointer).toBe(true);
    expect(layout.touchPrimary).toBe(false);
  });

  it('marks touch as the main input on phones and tablets', async () => {
    const tablet = await classify({ width: 1180, height: 820, coarse: true, touchPoints: 5 });
    expect(tablet).toMatchObject({ deviceClass: 'tablet', coarsePointer: true, touchPrimary: true });
    const phone = await classify({ width: 844, height: 390, coarse: true, touchPoints: 5 });
    expect(phone).toMatchObject({ deviceClass: 'phone', coarsePointer: true, touchPrimary: true });
  });

  it('treats a mouse-only computer as a desktop', async () => {
    const layout = await classify({ width: 1440, height: 900, coarse: false, touchPoints: 0 });
    expect(layout).toMatchObject({ deviceClass: 'desktop', coarsePointer: false, touchPrimary: false });
  });

  it('returns to the phone layout when a mobile browser fits overflowing tablet content', async () => {
    const layout = await classify({ width: 738, height: 1598, coarse: true, touchPoints: 5,
      visualViewport: { width: 738, height: 1597.1078, scale: 390 / 738 } });
    expect(layout).toMatchObject({ deviceClass: 'phone', orientationState: 'portrait', viewport: { width: 390, height: 844 } });
  });
});
