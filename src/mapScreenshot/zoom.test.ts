import { describe, expect, it } from 'vitest';
import { applyGradualZoom, computeIdealFitZoom } from './zoom';
import {
  dailyScreenshotFileName,
  displayMonthLabel,
  formatEasternDate,
  formatEasternMonth,
  manualScreenshotFileName,
  monthKeyFromFileName,
  parseManualIndex,
  screenshotObjectKey,
  shiftMonthKey,
} from './naming';
import { fillInfoOverlayTemplate } from './infoOverlay';
import { padPublishedBounds, roomBoundsToWorldPixels, chooseTileLevelForZoom } from './bounds';
import { buildZipArchive } from './zip';
import { pngDataUrlToArrayBuffer } from './stitch';

describe('map screenshot zoom', () => {
  it('fits the padded world into 4K', () => {
    const world = roomBoundsToWorldPixels({ minX: 0, maxX: 1, minY: 0, maxY: 0 });
    const zoom = computeIdealFitZoom(world);
    expect(zoom).toBeCloseTo(Math.min(3840 / (2 * 640), 2160 / 352), 6);
  });

  it('clamps zoom changes per capture to 0.001', () => {
    expect(applyGradualZoom(0.5, null)).toBe(0.5);
    expect(applyGradualZoom(0.4, 0.5)).toBeCloseTo(0.499, 6);
    expect(applyGradualZoom(0.4995, 0.5)).toBeCloseTo(0.4995, 6);
    expect(applyGradualZoom(0.6, 0.5)).toBeCloseTo(0.501, 6);
  });

  it('still clamps when previous zoom is recovered outside state.json', () => {
    // Simulates loadPreviousZoom falling back to PNG metadata.
    const recoveredPrevious = 0.12;
    const ideal = 0.108;
    expect(applyGradualZoom(ideal, recoveredPrevious)).toBeCloseTo(0.119, 6);
  });
});

describe('map screenshot naming', () => {
  it('builds daily _0 and manual keys', () => {
    expect(dailyScreenshotFileName('2026_08_12')).toBe('2026_08_12_0.png');
    expect(screenshotObjectKey('2026_08_12_0.png')).toBe('screenshots/2026_08_12_0.png');
    expect(manualScreenshotFileName('2026_08_12', 3)).toBe('2026_08_12_3.png');
    expect(parseManualIndex('2026_08_12_3.png', '2026_08_12')).toBe(3);
    expect(parseManualIndex('2026_08_12_0.png', '2026_08_12')).toBeNull();
  });

  it('formats an Eastern date as yyyy_mm_dd', () => {
    // 2026-08-12T10:00:00Z is still Aug 12 in Eastern (EDT).
    expect(formatEasternDate(new Date('2026-08-12T10:00:00.000Z'))).toBe('2026_08_12');
    expect(formatEasternMonth(new Date('2026-08-12T10:00:00.000Z'))).toBe('2026_08');
  });

  it('parses and shifts month keys', () => {
    expect(monthKeyFromFileName('2026_08_12_0.png')).toBe('2026_08');
    expect(monthKeyFromFileName('2026_08_12_3.png')).toBe('2026_08');
    expect(monthKeyFromFileName('bad.png')).toBeNull();
    expect(shiftMonthKey('2026_08', -1)).toBe('2026_07');
    expect(shiftMonthKey('2026_01', -1)).toBe('2025_12');
    expect(shiftMonthKey('2026_12', 1)).toBe('2027_01');
    expect(displayMonthLabel('2026_08')).toBe('August 2026');
  });
});

describe('map screenshot info overlay', () => {
  it('fills placeholders', () => {
    const html = fillInfoOverlayTemplate({
      date: 'August 12, 2026',
      players: 1200,
      builders: 40,
      rooms: 300,
    });
    expect(html).toContain('We All Make A<br>Platformer');
    expect(html).toContain('map-shot-info__date');
    expect(html).toContain('#79ccde');
    expect(html).toContain('August 12, 2026');
    expect(html).toContain('<span class="value">1,200</span>');
    expect(html).toContain('<span class="value">40</span>');
    expect(html).toContain('<span class="value">300</span>');
    expect(html).toContain('#f65699');
  });
});

describe('map screenshot bounds', () => {
  it('pads published bounds by two rooms by default', () => {
    expect(padPublishedBounds({ minX: 0, maxX: 2, minY: -1, maxY: 1, roomCount: 3 })).toEqual({
      minX: -2,
      maxX: 4,
      minY: -3,
      maxY: 3,
      roomCount: 3,
      paddingRooms: 2,
    });
  });

  it('picks tile levels from zoom bands', () => {
    expect(chooseTileLevelForZoom(0.05)).toBe(0);
    expect(chooseTileLevelForZoom(0.15)).toBe(1);
    expect(chooseTileLevelForZoom(0.3)).toBe(2);
    expect(chooseTileLevelForZoom(0.5)).toBe(3);
    expect(chooseTileLevelForZoom(1)).toBe(4);
  });
});

describe('map screenshot zip + png helpers', () => {
  it('builds a zip with local file headers', () => {
    const zip = buildZipArchive([
      { name: 'a.png', bytes: new Uint8Array([1, 2, 3]) },
      { name: 'b.png', bytes: new Uint8Array([4, 5]) },
    ]);
    expect(zip[0]).toBe(0x50); // P
    expect(zip[1]).toBe(0x4b); // K
    expect(zip.byteLength).toBeGreaterThan(50);
  });

  it('decodes png data urls', () => {
    const buffer = pngDataUrlToArrayBuffer('data:image/png;base64,AQID');
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3]));
  });
});
