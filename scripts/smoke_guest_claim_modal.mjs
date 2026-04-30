import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:3174/?previewSmoke=1';
const outputDir = path.resolve('output/web-game/guest-claim-modal');

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
  document.body.dataset.appReady = 'true';
  document.getElementById('boot-splash')?.classList.add('hidden');
  document.getElementById('busy-overlay')?.classList.add('hidden');
  document.getElementById('welcome-modal')?.classList.add('hidden');
});

await page.evaluate(() => {
  window.dispatchEvent(
    new CustomEvent('post-run-guest-claim-request', {
      detail: {
        contentType: 'room',
        contentId: 'smoke-room',
        contentTitle: 'Smoke Room',
        roomCoordinates: { x: 2, y: -1 },
        version: 7,
        previousViewerRank: null,
        elapsedMs: 42150,
        deaths: 1,
        score: 180,
        autoSuggestedDifficulty: 'medium',
      },
    }),
  );
});

await page.waitForSelector('#run-guest-claim:not(.hidden)');

const modalState = await page.evaluate(() => {
  const text = document.getElementById('run-rating-modal')?.innerText ?? '';
  const recordsRaw = window.localStorage.getItem('wamp_guest_run_progress_v1');
  return {
    text,
    runRatingHidden: document.getElementById('run-rating-modal')?.classList.contains('hidden') ?? true,
    guestClaimHidden: document.getElementById('run-guest-claim')?.classList.contains('hidden') ?? true,
    qualityHidden:
      document
        .querySelector('#run-rating-modal .run-rating-section-quality')
        ?.classList.contains('hidden') ?? false,
    difficultyHidden:
      document
        .querySelector('#run-rating-modal .run-rating-section-difficulty')
        ?.classList.contains('hidden') ?? false,
    resultHidden: document.getElementById('run-rating-result')?.classList.contains('hidden') ?? false,
    records: recordsRaw ? JSON.parse(recordsRaw) : null,
  };
});

if (modalState.runRatingHidden) {
  throw new Error('Expected run rating modal shell to be visible.');
}
if (modalState.guestClaimHidden) {
  throw new Error('Expected guest claim section to be visible.');
}
if (!modalState.qualityHidden || !modalState.difficultyHidden) {
  throw new Error('Expected rating controls to be hidden for guest claim mode.');
}
if (!modalState.resultHidden) {
  throw new Error('Expected run-result details to be hidden for guest claim mode.');
}
const normalizedModalText = modalState.text.toLowerCase();
if (
  !normalizedModalText.includes('you did it') ||
  !normalizedModalText.includes('you earned 20 xp') ||
  !normalizedModalText.includes('sign in to save your xp and leaderboard progress') ||
  !normalizedModalText.includes('save progress')
) {
  throw new Error('Expected guest claim copy and CTA in modal text.');
}
if (normalizedModalText.includes('run complete')) {
  throw new Error('Expected guest claim modal to hide run-complete kicker.');
}
if (normalizedModalText.includes('potential pxp') || normalizedModalText.includes('guest bank')) {
  throw new Error('Expected simplified guest claim modal without guest-bank stats.');
}
if (!modalState.records?.records?.length) {
  throw new Error('Expected guest progress record in localStorage.');
}

await page.screenshot({
  path: path.join(outputDir, 'guest-claim-modal.png'),
  fullPage: true,
});

await page.click('#btn-run-guest-claim-signin');
await page.waitForFunction(() => document.getElementById('auth-panel')?.classList.contains('menu-open'));

const signInState = await page.evaluate(() => ({
  modalHidden: document.getElementById('run-rating-modal')?.classList.contains('hidden') ?? false,
  authOpen: document.getElementById('auth-panel')?.classList.contains('menu-open') ?? false,
  authStatus: document.getElementById('auth-status')?.textContent ?? '',
}));

if (!signInState.modalHidden || !signInState.authOpen) {
  throw new Error('Expected Save Progress to close the modal and open auth.');
}
if (!signInState.authStatus.includes('save your XP')) {
  throw new Error(`Unexpected auth status after Save Progress: ${signInState.authStatus}`);
}

await page.screenshot({
  path: path.join(outputDir, 'guest-claim-signin.png'),
  fullPage: true,
});

fs.writeFileSync(path.join(outputDir, 'modal-state.json'), JSON.stringify(modalState, null, 2));
fs.writeFileSync(path.join(outputDir, 'signin-state.json'), JSON.stringify(signInState, null, 2));
fs.writeFileSync(path.join(outputDir, 'errors.json'), JSON.stringify(errors, null, 2));

await browser.close();

console.log(`Wrote guest claim modal smoke artifacts to ${outputDir}`);
