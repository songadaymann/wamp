import { dateKeyFromFileName } from './naming';

export const MIN_VIDEO_FPS = 1;
export const MAX_VIDEO_FPS = 60;
export const DEFAULT_VIDEO_FPS = 12;

/** Inclusive Eastern-date range → frames ordered oldest → newest. */
export function selectVideoFrames(
  fileNames: readonly string[],
  startDate: string,
  endDate: string,
): string[] {
  if (!isEasternDateKey(startDate) || !isEasternDateKey(endDate)) {
    throw new RangeError('Start and end must be yyyy_mm_dd Eastern dates.');
  }
  if (startDate > endDate) {
    throw new RangeError('Start date must be on or before end date.');
  }

  return fileNames
    .filter((fileName) => {
      const dateKey = dateKeyFromFileName(fileName);
      return dateKey !== null && dateKey >= startDate && dateKey <= endDate;
    })
    .sort((a, b) => a.localeCompare(b));
}

export function videoDurationSeconds(frameCount: number, fps: number): number {
  if (!Number.isFinite(frameCount) || !Number.isFinite(fps) || frameCount <= 0 || fps <= 0) {
    return 0;
  }
  return frameCount / fps;
}

export function formatVideoDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds - minutes * 60;
  return `${minutes}m ${rem.toFixed(1)}s`;
}

export function clampVideoFps(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < MIN_VIDEO_FPS || n > MAX_VIDEO_FPS) {
    throw new RangeError(`Frame rate must be an integer from ${MIN_VIDEO_FPS} to ${MAX_VIDEO_FPS}.`);
  }
  return n;
}

export function isEasternDateKey(value: string): boolean {
  return /^\d{4}_\d{2}_\d{2}$/.test(value);
}

/** HTML date input (yyyy-mm-dd) ↔ Eastern key (yyyy_mm_dd). */
export function easternDateToHtmlDate(easternDate: string): string {
  if (!isEasternDateKey(easternDate)) {
    throw new RangeError(`Invalid Eastern date: ${easternDate}`);
  }
  return easternDate.replace(/_/g, '-');
}

export function htmlDateToEasternDate(htmlDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(htmlDate)) {
    throw new RangeError(`Invalid HTML date: ${htmlDate}`);
  }
  return htmlDate.replace(/-/g, '_');
}

export function earliestAndLatestDates(fileNames: readonly string[]): {
  earliest: string | null;
  latest: string | null;
} {
  let earliest: string | null = null;
  let latest: string | null = null;
  for (const fileName of fileNames) {
    const dateKey = dateKeyFromFileName(fileName);
    if (!dateKey) continue;
    if (earliest === null || dateKey < earliest) earliest = dateKey;
    if (latest === null || dateKey > latest) latest = dateKey;
  }
  return { earliest, latest };
}
