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

/** Eastern calendar month as yyyy_mm. */
export function formatEasternMonth(date: Date = new Date()): string {
  return formatEasternDate(date).slice(0, 7);
}

/** Long Eastern date like "August 12, 2026". */
export function formatEasternLongDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/** Daily automatic capture: yyyy_mm_dd_0.png */
export function dailyScreenshotFileName(easternDate: string): string {
  return `${easternDate}_0.png`;
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

export function monthKeyFromFileName(fileName: string): string | null {
  const match = /^(\d{4}_\d{2})_\d{2}(?:_[0-9])?\.png$/.exec(fileName);
  return match?.[1] ?? null;
}

export function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const match = /^(\d{4})_(\d{2})$/.exec(monthKey);
  if (!match) throw new RangeError(`Invalid month key: ${monthKey}`);
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1 + deltaMonths;
  const shifted = new Date(Date.UTC(year, monthIndex, 1));
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  return `${y}_${m}`;
}

export function displayMonthLabel(monthKey: string): string {
  const match = /^(\d{4})_(\d{2})$/.exec(monthKey);
  if (!match) return monthKey;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
