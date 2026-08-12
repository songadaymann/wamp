import { MAX_MANUAL_SHOTS_PER_DAY, SCREENSHOT_KEY_PREFIX } from './config';

/** Eastern-calendar date as yyyy_mm_dd. */
export function formatEasternDate(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA → YYYY-MM-DD
  const isoDate = formatter.format(date);
  return isoDate.replace(/-/g, '_');
}

export function dailyScreenshotFileName(easternDate: string): string {
  return `${easternDate}.png`;
}

export function manualScreenshotFileName(easternDate: string, index: number): string {
  if (!Number.isInteger(index) || index < 1 || index > MAX_MANUAL_SHOTS_PER_DAY) {
    throw new RangeError(`Manual screenshot index must be 1–${MAX_MANUAL_SHOTS_PER_DAY}.`);
  }
  return `${easternDate}_${index}.png`;
}

export function screenshotObjectKey(fileName: string): string {
  return `${SCREENSHOT_KEY_PREFIX}${fileName}`;
}

export function parseManualIndex(fileName: string, easternDate: string): number | null {
  const match = new RegExp(`^${escapeRegExp(easternDate)}_([1-9])\\.png$`).exec(fileName);
  if (!match) return null;
  return Number(match[1]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
