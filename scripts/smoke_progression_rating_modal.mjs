import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:4175';
const outputDir = path.resolve('output/web-game/progression-rating-modal');

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
await page.evaluate((smokeCourse) => {
  window.dispatchEvent(
    new CustomEvent('post-run-rating-request', {
      detail: {
        contentType: 'course',
        contentId: smokeCourse.id,
        contentTitle: smokeCourse.title,
        version: smokeCourse.version,
        elapsedMs: 84250,
        deaths: 2,
        score: 320,
        autoSuggestedDifficulty: 'hard',
      },
    })
  );
}, {
  id: '5d16d080-7f72-43f8-99e2-d4e71f1b62d0',
  title: 'test',
  version: 5,
});
await page.waitForTimeout(900);

await page.screenshot({
  path: path.join(outputDir, 'modal.png'),
  fullPage: true,
});

const bodyText = await page.evaluate(() => document.body.innerText);
fs.writeFileSync(path.join(outputDir, 'body.txt'), bodyText);
fs.writeFileSync(path.join(outputDir, 'errors.json'), JSON.stringify(errors, null, 2));

await browser.close();

console.log(`Wrote progression rating smoke artifacts to ${outputDir}`);
