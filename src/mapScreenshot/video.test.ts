import { describe, expect, it } from 'vitest';
import {
  clampVideoFps,
  earliestAndLatestDates,
  easternDateToHtmlDate,
  formatVideoDuration,
  htmlDateToEasternDate,
  selectVideoFrames,
  videoDurationSeconds,
} from './video';

describe('map screenshot video frame selection', () => {
  const files = [
    '2026_08_14_2.png',
    '2026_08_12_0.png',
    '2026_08_12_1.png',
    '2026_08_13_0.png',
    '2026_08_14_0.png',
    '2026_08_14_1.png',
  ];

  it('uses the first image of the start day through the last image of the end day', () => {
    expect(selectVideoFrames(files, '2026_08_12', '2026_08_14')).toEqual([
      '2026_08_12_0.png',
      '2026_08_12_1.png',
      '2026_08_13_0.png',
      '2026_08_14_0.png',
      '2026_08_14_1.png',
      '2026_08_14_2.png',
    ]);
  });

  it('limits to a single day with first→last on that day', () => {
    expect(selectVideoFrames(files, '2026_08_14', '2026_08_14')).toEqual([
      '2026_08_14_0.png',
      '2026_08_14_1.png',
      '2026_08_14_2.png',
    ]);
  });

  it('reports earliest and latest dates', () => {
    expect(earliestAndLatestDates(files)).toEqual({
      earliest: '2026_08_12',
      latest: '2026_08_14',
    });
  });

  it('computes duration from frame count and fps', () => {
    expect(videoDurationSeconds(24, 12)).toBe(2);
    expect(formatVideoDuration(2)).toBe('2.00s');
    expect(formatVideoDuration(75)).toBe('1m 15.0s');
  });

  it('clamps fps to 1–60 integers', () => {
    expect(clampVideoFps(12)).toBe(12);
    expect(() => clampVideoFps(0)).toThrow(/Frame rate/);
    expect(() => clampVideoFps(12.5)).toThrow(/Frame rate/);
  });

  it('converts HTML date inputs', () => {
    expect(easternDateToHtmlDate('2026_08_12')).toBe('2026-08-12');
    expect(htmlDateToEasternDate('2026-08-12')).toBe('2026_08_12');
  });
});
