import type { PostRunRatingRequestDetail } from '../progression/postRunRatingEvents';

export interface RunShareImage {
  dataUrl: string;
  fileName: string;
}

export function buildRunShareText(
  detail: PostRunRatingRequestDetail,
  title: string | null,
): string {
  const subject = getRunShareSubject(detail, title);
  return `I beat ${subject} in WAMP in ${formatAchievementTime(detail.elapsedMs)}. Can you do better?`;
}

export function buildRunShareUrl(
  detail: PostRunRatingRequestDetail,
  href: string,
): string {
  const url = new URL(href);
  if (detail.contentType === 'room') {
    url.searchParams.set('x', String(detail.roomCoordinates.x));
    url.searchParams.set('y', String(detail.roomCoordinates.y));
  }
  return url.toString();
}

export function createRunShareImageFile(image: RunShareImage): File {
  const [header, data] = image.dataUrl.split(',');
  if (!header || !data) {
    throw new Error('Invalid room snapshot image.');
  }

  const mime = /^data:([^;]+);base64$/.exec(header)?.[1] ?? 'image/png';
  const binary = globalThis.atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], image.fileName, { type: mime });
}

export function canShareRunImage(
  navigatorObj: Navigator,
  file: File,
): boolean {
  return typeof navigatorObj.share === 'function'
    && typeof navigatorObj.canShare === 'function'
    && navigatorObj.canShare({ files: [file] });
}

export function openTwitterShareIntent(
  windowObj: Window,
  text: string,
  url: string,
): void {
  const intent = new URL('https://twitter.com/intent/tweet');
  intent.searchParams.set('text', text);
  intent.searchParams.set('url', url);
  windowObj.open(intent.toString(), '_blank', 'noopener,noreferrer');
}

export function downloadRunShareImage(
  doc: Document,
  image: RunShareImage,
): void {
  const link = doc.createElement('a');
  link.href = image.dataUrl;
  link.download = image.fileName;
  link.rel = 'noopener';
  doc.body.appendChild(link);
  link.click();
  link.remove();
}

function getRunShareSubject(
  detail: PostRunRatingRequestDetail,
  title: string | null,
): string {
  const cleanTitle = title?.replace(/\s+/g, ' ').trim() ?? '';
  if (detail.contentType === 'room') {
    const fallback = `room ${detail.roomCoordinates.x},${detail.roomCoordinates.y}`;
    if (!cleanTitle || cleanTitle === 'Room Challenge') {
      return fallback;
    }
    return `"${cleanTitle}"`;
  }

  return cleanTitle ? `"${cleanTitle}"` : 'this course';
}

function formatAchievementTime(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.round(elapsedMs / 100) / 10);
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)} seconds`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}
