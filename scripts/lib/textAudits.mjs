import assert from 'node:assert/strict';

export async function auditReadableFonts(page) {
  const leaks = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => {
    if (!e.getClientRects().length || ['SCRIPT', 'STYLE', 'OPTION'].includes(e.tagName)) return false;
    if (![...e.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) return false;
    return /HomeVideo|Early GameBoy|Super Mario Bros/i.test(getComputedStyle(e).fontFamily);
  }).map(e => ({ tag: e.tagName, id: e.id, text: e.textContent.slice(0, 60), font: getComputedStyle(e).fontFamily })));
  assert.deepEqual(leaks, [], 'Readable text must replace visible pixel-font UI');
}

async function auditRunControls(page) {
  if (!await page.locator('body').evaluate(e => e.dataset.deviceClass === 'phone' && e.dataset.orientationState === 'portrait')) return;
  const goal = await page.locator('.world-goal-panel').boundingBox();
  const stop = await page.locator('#btn-mobile-world-stop').boundingBox();
  const restart = await page.locator('#btn-mobile-world-restart').boundingBox();
  assert(goal && stop && restart);
  assert(goal.y + goal.height <= Math.min(stop.y, restart.y) + 1, 'Goal and run actions must have separate rows');
  assert(stop.x + stop.width <= restart.x, 'Stop and Restart must not overlap');
  for (const id of ['btn-mobile-world-stop', 'btn-mobile-world-restart']) {
    assert(await page.locator('#' + id).evaluate(e => e.scrollWidth <= e.clientWidth + 1), id + ' label must fit');
  }
}


export async function auditReadableText(page, capture = async () => {}) {
  await page.waitForFunction(() => document.body.dataset.appReady === 'true');
  await page.locator('#btn-room-goal-intro-start').waitFor({ state: 'visible' });
  await page.locator('#btn-room-goal-intro-start').click();
  const openSettings = async () => {
    if (!await page.locator('#auth-panel').evaluate(e => e.classList.contains('menu-open'))) await page.locator('#menu-toggle').click();
    await page.locator('#btn-world-settings').click();
    await page.locator('#settings-modal').waitFor({ state: 'visible' });
  };
  await openSettings();
  const style = () => page.locator('#btn-settings-close').evaluate(e => { const s = getComputedStyle(e); return { family: s.fontFamily, size: s.fontSize }; });
  const baseline = await style();
  await page.locator('#settings-text-style').selectOption('readable');
  await page.waitForFunction(() => document.body.dataset.textStyle === 'readable');
  assert((await style()).family.includes('IBM Plex Mono'));
  assert.equal((await style()).size, '12px');
  await capture('readable', page);
  await page.locator('#settings-text-size').selectOption('large');
  await page.waitForFunction(() => document.body.dataset.textSize === 'large');
  assert.equal((await style()).size, '16px');
  const panel = page.locator('#settings-modal .settings-modal-panel');
  assert(await panel.evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'Settings must not scroll sideways');
  for (const id of ['settings-text-style', 'settings-text-size']) {
    const box = await page.locator('#' + id).boundingBox();
    const viewport = page.viewportSize();
    assert(box && box.x >= 0 && box.x + box.width <= viewport.width && box.height >= 44, id + ' must fit with a full touch target');
  }
  await panel.evaluate(e => { e.scrollTop = 0; });
  await capture('large-settings', page);
  await page.locator('#btn-settings-close').click();
  await page.locator('#menu-toggle').click();
  assert(await page.locator('#auth-panel').evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'Menu must not scroll sideways');
  await auditReadableFonts(page);
  await capture('large-menu', page);
  await page.locator('#menu-toggle').click();
  await auditRunControls(page);
  await capture('large-play', page);
  await openSettings();
  await page.locator('#settings-text-style').selectOption('pixel');
  await capture('retro-large', page);
  await page.locator('#btn-settings-close').click();
  await page.locator('#menu-toggle').click();
  await capture('retro-large-menu', page);
  await page.locator('#menu-toggle').click();
  await auditRunControls(page);
  await capture('retro-large-play', page);
  // Restore exact defaults, then retain the preference for the fresh-page audit.
  await openSettings();
  await page.locator('#settings-text-style').selectOption('pixel');
  await page.locator('#settings-text-size').selectOption('normal');
  assert.deepEqual(await style(), baseline, 'Returning to Retro/Normal must restore the original typography');
  await page.locator('#settings-text-style').selectOption('readable');
  await page.locator('#settings-text-size').selectOption('large');
  await page.locator('#btn-settings-close').click();
  return { baseline, textStyle: 'readable', textSize: 'large' };
}
