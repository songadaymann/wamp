/** Report actual foreground phone buttons without discarding undersized targets. */
export async function readPhoneTapTargets(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('button,[role="button"]')).flatMap(element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    if (!rect.width || !rect.height || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth || style.visibility === 'hidden') return [];
    const x = Math.min(innerWidth - 1, Math.max(0, rect.x + rect.width / 2));
    const y = Math.min(innerHeight - 1, Math.max(0, rect.y + rect.height / 2));
    const foreground = document.elementFromPoint(x, y);
    if (!foreground || !(element === foreground || element.contains(foreground))) return [];
    return [{ id: element.id || element.getAttribute('data-editor-shell-action') || element.textContent?.trim().slice(0, 40), width: rect.width, height: rect.height }];
  }));
}

/** Shrink only the visual viewport, as a keyboard does; a layout resize is a rotation. */
export async function setKeyboardViewport(page, height) {
  await page.evaluate(nextHeight => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error('Visual viewport unavailable');
    window.__mobileKeyboardHeightDescriptor ??= Object.getOwnPropertyDescriptor(viewport, 'height') ?? null;
    Object.defineProperty(viewport, 'height', { configurable: true, get: () => nextHeight });
    viewport.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('resize'));
  }, height);
}
export async function restoreKeyboardViewport(page) {
  await page.evaluate(() => {
    const viewport = window.visualViewport, original = window.__mobileKeyboardHeightDescriptor;
    if (original) Object.defineProperty(viewport, 'height', original);
    else delete viewport.height;
    delete window.__mobileKeyboardHeightDescriptor;
    viewport.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('resize'));
  });
}
