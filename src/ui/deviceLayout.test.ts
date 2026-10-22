import { afterEach, describe, expect, it, vi } from 'vitest';

interface DeviceOptions {
  width: number;
  height: number;
  coarse: boolean;
  touchPoints: number;
  visualViewport?: { width: number; height: number; scale: number };
}

class FakeTextField {
  isContentEditable = false;
  matches() { return true; }
}

const fakeDocument = {
  activeElement: null as FakeTextField | null,
  addEventListener: () => {},
  body: { dataset: {} as Record<string, string> },
  documentElement: { style: { setProperty: () => {} } },
};

function stubDevice(options: DeviceOptions) {
  vi.stubGlobal('window', {
    innerWidth: options.width,
    innerHeight: options.height,
    visualViewport: options.visualViewport ? { offsetTop: 0, ...options.visualViewport, addEventListener: () => {} } : undefined,
    matchMedia: (query: string) => ({ matches: query.includes('pointer: coarse') ? options.coarse : false }),
    addEventListener: () => {},
    dispatchEvent: () => true,
  });
  vi.stubGlobal('navigator', { maxTouchPoints: options.touchPoints, hardwareConcurrency: 8 });
  vi.stubGlobal('HTMLElement', FakeTextField);
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('requestAnimationFrame', () => 0);
}

async function loadDeviceLayout(options: DeviceOptions) {
  vi.resetModules();
  fakeDocument.activeElement = null;
  stubDevice(options);
  return import('./deviceLayout');
}

async function classify(options: DeviceOptions) {
  return (await loadDeviceLayout(options)).initializeDeviceLayout();
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

  it('keeps a portrait phone in portrait while the keyboard covers half the screen (F076)', async () => {
    const layout = await classify({ width: 393, height: 660, coarse: true, touchPoints: 5,
      visualViewport: { width: 393, height: 330, scale: 1 } });
    expect(layout).toMatchObject({ deviceClass: 'phone', orientationState: 'portrait', viewport: { width: 393, height: 330 } });
    const landscape = await classify({ width: 844, height: 390, coarse: true, touchPoints: 5,
      visualViewport: { width: 844, height: 180, scale: 1 } });
    expect(landscape.orientationState).toBe('landscape');
  });

  it('keeps a landscape tablet a tablet while the keyboard covers most of the screen (F354)', async () => {
    const layout = await classify({ width: 1180, height: 760, coarse: true, touchPoints: 5,
      visualViewport: { width: 1180, height: 360, scale: 1 } });
    expect(layout).toMatchObject({ deviceClass: 'tablet', orientationState: 'landscape', viewport: { width: 1180, height: 360 } });
    const android = await classify({ width: 1080, height: 760, coarse: true, touchPoints: 5,
      visualViewport: { width: 1080, height: 380, scale: 1 } });
    expect(android.deviceClass).toBe('tablet');
  });

  it('keeps a tablet a tablet while the page is pinch-zoomed (F354)', async () => {
    const layout = await classify({ width: 1180, height: 760, coarse: true, touchPoints: 5,
      visualViewport: { width: 1180 / 1.5, height: 760 / 1.5, scale: 1.5 } });
    expect(layout).toMatchObject({ deviceClass: 'tablet', orientationState: 'landscape' });
  });

  it('holds the layout while a text field has focus, until the width changes (F354)', async () => {
    const tablet = { width: 1180, height: 760, coarse: true, touchPoints: 5 };
    const deviceLayout = await loadDeviceLayout({ ...tablet, visualViewport: { width: 1180, height: 760, scale: 1 } });
    expect(deviceLayout.initializeDeviceLayout()).toMatchObject({ deviceClass: 'tablet', orientationState: 'landscape' });
    // Some browsers shrink the layout viewport for the keyboard too.
    const keyboardOpen = { ...tablet, height: 360, visualViewport: { width: 1180, height: 360, scale: 1 } };
    fakeDocument.activeElement = new FakeTextField();
    stubDevice(keyboardOpen);
    expect(deviceLayout.initializeDeviceLayout()).toMatchObject({
      deviceClass: 'tablet', orientationState: 'landscape', viewport: { width: 1180, height: 360 },
    });
    expect(fakeDocument.body.dataset.deviceClass).toBe('tablet');
    // Rotating the tablet while typing still switches the layout.
    stubDevice({ ...tablet, width: 820, height: 1180, visualViewport: { width: 820, height: 700, scale: 1 } });
    expect(deviceLayout.initializeDeviceLayout()).toMatchObject({ deviceClass: 'tablet', orientationState: 'portrait' });
    // With no field focused, the layout follows the viewport again.
    fakeDocument.activeElement = null;
    stubDevice(keyboardOpen);
    expect(deviceLayout.initializeDeviceLayout()).toMatchObject({ deviceClass: 'phone', orientationState: 'landscape' });
  });

  it('returns to the phone layout when a mobile browser fits overflowing tablet content', async () => {
    const layout = await classify({ width: 738, height: 1598, coarse: true, touchPoints: 5,
      visualViewport: { width: 738, height: 1597.1078, scale: 390 / 738 } });
    expect(layout).toMatchObject({ deviceClass: 'phone', orientationState: 'portrait', viewport: { width: 390, height: 844 } });
  });

  it('keeps that phone a phone when the page is zoomed partway back in (F354)', async () => {
    for (const scale of [0.6, 0.8, 1, 1.5]) {
      const portrait = await classify({ width: 738, height: 1598, coarse: true, touchPoints: 5,
        visualViewport: { width: 390 / scale, height: 844 / scale, scale } });
      expect(portrait).toMatchObject({ deviceClass: 'phone', orientationState: 'portrait' });
      const landscape = await classify({ width: 1598, height: 738, coarse: true, touchPoints: 5,
        visualViewport: { width: 844 / scale, height: 390 / scale, scale } });
      expect(landscape).toMatchObject({ deviceClass: 'phone', orientationState: 'landscape' });
    }
  });
});
