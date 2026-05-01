import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:3175/?previewSmoke=1';
const outputDir = path.resolve('output/web-game/guest-builder-claim-modal');

fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [];

page.on('console', (message) => {
  if (message.type() === 'error') {
    errors.push({ type: 'console.error', text: message.text() });
  }
});
page.on('pageerror', (error) => {
  errors.push({ type: 'pageerror', text: String(error) });
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

await page.evaluate(() => {
  window.localStorage.removeItem('wamp_guest_builder_claim_prompt_seen_v1');
  document.body.dataset.appReady = 'true';
  document.getElementById('boot-splash')?.classList.add('hidden');
  document.getElementById('busy-overlay')?.classList.add('hidden');
  document.getElementById('welcome-modal')?.classList.add('hidden');
});

await page.evaluate(() => {
  window.dispatchEvent(
    new CustomEvent('guest-builder-claim-request', {
      detail: {
        roomId: '2,-11',
        roomCoordinates: { x: 2, y: -11 },
        roomTitle: null,
        potentialBxp: 25,
        source: 'build-threshold',
        buildActivityCount: 30,
      },
    }),
  );
});

await page.waitForSelector('#guest-builder-claim-modal:not(.hidden)');

const modalState = await page.evaluate(() => {
  const text = document.getElementById('guest-builder-claim-modal')?.innerText ?? '';
  const seenRaw = window.localStorage.getItem('wamp_guest_builder_claim_prompt_seen_v1');
  return {
    text,
    modalHidden:
      document.getElementById('guest-builder-claim-modal')?.classList.contains('hidden') ?? true,
    seen: seenRaw ? JSON.parse(seenRaw) : null,
  };
});

if (modalState.modalHidden) {
  throw new Error('Expected guest builder claim modal to be visible.');
}

const normalizedModalText = modalState.text.toLowerCase();
if (
  !normalizedModalText.includes('awesome work') ||
  !normalizedModalText.includes('+25 builder xp') ||
  !normalizedModalText.includes('30 tiles and items') ||
  !normalizedModalText.includes('sign in so you can save this build') ||
  !normalizedModalText.includes('sign in to save')
) {
  throw new Error('Expected guest builder claim copy and CTA in modal text.');
}
if (!modalState.seen?.roomIds?.includes('2,-11')) {
  throw new Error('Expected guest builder modal seen state in localStorage.');
}

await page.screenshot({
  path: path.join(outputDir, 'guest-builder-claim-modal.png'),
  fullPage: true,
});

await page.click('#btn-guest-builder-claim-signin');
await page.waitForFunction(() => document.getElementById('auth-panel')?.classList.contains('menu-open'));

const signInState = await page.evaluate(() => ({
  modalHidden: document.getElementById('guest-builder-claim-modal')?.classList.contains('hidden') ?? false,
  authOpen: document.getElementById('auth-panel')?.classList.contains('menu-open') ?? false,
  authStatus: document.getElementById('auth-status')?.textContent ?? '',
}));

if (!signInState.modalHidden || !signInState.authOpen) {
  throw new Error('Expected Sign In to Save to close the modal and open auth.');
}
if (!signInState.authStatus.includes('save this room')) {
  throw new Error(`Unexpected auth status after Sign In to Save: ${signInState.authStatus}`);
}

await page.screenshot({
  path: path.join(outputDir, 'guest-builder-claim-signin.png'),
  fullPage: true,
});

fs.writeFileSync(path.join(outputDir, 'modal-state.json'), JSON.stringify(modalState, null, 2));
fs.writeFileSync(path.join(outputDir, 'signin-state.json'), JSON.stringify(signInState, null, 2));
fs.writeFileSync(path.join(outputDir, 'errors.json'), JSON.stringify(errors, null, 2));

await browser.close();

console.log(`Wrote guest builder claim modal smoke artifacts to ${outputDir}`);
