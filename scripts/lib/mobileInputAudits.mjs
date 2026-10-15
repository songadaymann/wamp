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

/** Decode the actual URLs resolved by CSS, including variables consumed in another sheet. */
export async function readBackgroundThumbnailImages(page) {
  return page.evaluate(async () => {
    const cards = Array.from(document.querySelectorAll('#background-card-grid [data-background-id]'))
      .filter(card => !['none', 'solid_color'].includes(card.dataset.backgroundId));
    if (!cards.length) throw new Error('No built-in background cards');
    const images = cards.flatMap(card => {
      const art = card.querySelector('.background-card-art');
      if (!art) throw new Error('Missing background art');
      const urls = Array.from(getComputedStyle(art).backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g), match => match[1]);
      if (urls.length !== 2) throw new Error(`${card.dataset.backgroundId} needs both thumbnail layers`);
      return urls.map(url => ({ id: card.dataset.backgroundId, url }));
    });
    return Promise.all(images.map(async entry => {
      const url = new URL(entry.url);
      if (!url.pathname.startsWith('/assets/backgrounds/')) throw new Error(`Thumbnail resolved below the wrong directory: ${entry.url}`);
      if (!/^[a-f0-9]{12}$/.test(url.searchParams.get('v') ?? '')) throw new Error(`Thumbnail lost its content version: ${entry.url}`);
      const image = new Image(); image.src = entry.url;
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) throw new Error(`Empty thumbnail: ${entry.url}`);
      return { ...entry, width: image.naturalWidth, height: image.naturalHeight };
    }));
  });
}
