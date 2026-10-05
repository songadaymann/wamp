export type LinkShareResult = 'shared' | 'copied' | 'canceled';

export async function copyShareLink(doc: Document, navigatorObj: Navigator, url: string): Promise<void> {
  try {
    if (navigatorObj.clipboard?.writeText) {
      await navigatorObj.clipboard.writeText(url);
      return;
    }
  } catch {
    // Older browsers can still copy during the user's click if the async API is blocked.
  }
  if (typeof doc.execCommand !== 'function') throw new Error('Clipboard unavailable.');
  const previousFocus = doc.activeElement as HTMLElement | null;
  const input = doc.createElement('textarea');
  input.value = url;
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  doc.body.append(input);
  try {
    input.select();
    if (!doc.execCommand('copy')) throw new Error('Clipboard unavailable.');
  } finally {
    input.remove();
    previousFocus?.focus();
  }
}

export async function shareLink(doc: Document, navigatorObj: Navigator, payload: ShareData): Promise<LinkShareResult> {
  if (typeof navigatorObj.share === 'function') {
    // A browser may support text sharing without supporting image attachments.
    let filesSupported = false;
    try { filesSupported = Boolean(payload.files && navigatorObj.canShare?.({ files: payload.files })); }
    catch { /* Share text when file capability detection fails. */ }
    const { files, ...textPayload } = payload;
    try {
      await navigatorObj.share(filesSupported ? { ...textPayload, files } : textPayload);
      return 'shared';
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return 'canceled';
    }
  }
  if (!payload.url) throw new Error('Share link unavailable.');
  await copyShareLink(doc, navigatorObj, payload.url);
  return 'copied';
}
