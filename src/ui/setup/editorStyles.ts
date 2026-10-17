import editorStylesUrl from '../../styles/editor-bundle.css?url';

let ready: Promise<void> | null = null;

/** Await styles before showing either editor. Failed downloads can be retried. */
export function ensureEditorStylesReady(): Promise<void> {
  ready ??= new Promise<void>((resolve, reject) => {
    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = editorStylesUrl;
    sheet.dataset.wampEditorStyles = 'true';
    const fail = () => {
      window.clearTimeout(timeout);
      sheet.onload = null;
      sheet.onerror = null;
      sheet.remove();
      ready = null;
      reject(new Error('The editor styles could not be loaded. Please try again.'));
    };
    const timeout = window.setTimeout(fail, 20_000);
    sheet.onload = () => {
      window.clearTimeout(timeout);
      sheet.onload = null;
      sheet.onerror = null;
      resolve();
    };
    sheet.onerror = fail;
    // Shared responsive styles must follow the editor's desktop defaults.
    const shared = document.head.querySelector('link[rel="stylesheet"]');
    document.head.insertBefore(sheet, shared);
  });
  return ready;
}
