import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.WAMP_SMOKE_URL ?? 'http://127.0.0.1:4519';
const outputDir = path.resolve('output/web-game/wallet-email-link-modal');
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];

page.on('console', (message) => {
  if (message.type() === 'error') {
    consoleErrors.push(message.text());
  }
});

await page.addInitScript(() => {
  const nativeFetch = window.fetch.bind(window);
  window.__walletEmailLinkRequest = null;
  window.fetch = async (input, init) => {
    const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const pathname = new URL(rawUrl, window.location.origin).pathname;
    if (pathname === '/api/auth/session') {
      const sessionEmail = window.localStorage.getItem('wallet-email-smoke-linked') || null;
      return new Response(JSON.stringify({
        authenticated: true,
        source: 'session',
        user: {
          id: 'wallet-user',
          email: sessionEmail,
          walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
          displayName: 'Wallet Player',
          username: 'wallet-player',
          selectedAvatarId: null,
        },
        walletProjectId: null,
        partykitHost: null,
        partykitParty: null,
        chatModeration: { role: 'none', banned: false },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (pathname === '/api/auth/request-link') {
      window.__walletEmailLinkRequest = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({
        ok: true,
        delivery: 'email',
        purpose: 'link_email',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Not mocked by wallet-email smoke.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return nativeFetch(input, init);
  };
});

await page.goto(`${baseUrl}/?previewSmoke=1&renderer=canvas`, { waitUntil: 'domcontentloaded' });
try {
  await page.waitForFunction(
    () => document.querySelector('#btn-auth-email')?.textContent === 'Add Email',
    { timeout: 15_000 },
  );
} catch (error) {
  const debug = await page.evaluate(() => ({
    button: document.querySelector('#btn-auth-email')?.textContent,
    auth: typeof window.render_game_to_text === 'function'
      ? JSON.parse(window.render_game_to_text()).auth
      : null,
  }));
  throw new Error(`Wallet-only auth UI did not render: ${JSON.stringify({ debug, consoleErrors })}`, {
    cause: error,
  });
}
await exposeAuthMenu(page);

await expectText(page, '#btn-auth-email', 'Add Email');
await expectAttribute(page, '#auth-email-input', 'placeholder', 'Add your email address');
await expectText(
  page,
  '#auth-status',
  'Add an email for another way to sign in and recover your account.',
);

await page.fill('#auth-email-input', 'wallet-player@example.com');
await page.click('#btn-auth-email');
await page.waitForFunction(
  () => document.querySelector('#auth-status')?.textContent
    === 'Check your email to finish adding it to this account.',
);
const linkedEmailRequest = await page.evaluate(() => window.__walletEmailLinkRequest);
if (linkedEmailRequest?.email !== 'wallet-player@example.com') {
  throw new Error(`Unexpected link request: ${JSON.stringify(linkedEmailRequest)}`);
}
await page.screenshot({
  path: path.join(outputDir, 'wallet-only-add-email.png'),
  fullPage: true,
});

await page.evaluate(() => {
  window.localStorage.setItem('wallet-email-smoke-linked', 'wallet-player@example.com');
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => document.querySelector('#auth-session-summary-value')?.textContent?.includes('Wallet Player'),
);
await exposeAuthMenu(page);
if (!documentHidden(await page.locator('#auth-email-row').getAttribute('class'))) {
  throw new Error('Email row should be hidden once the account has an email.');
}

const unexpectedErrors = consoleErrors.filter(
  (message) =>
    !message.includes('Failed to load resource')
    && !message.includes('Not mocked by wallet-email smoke')
    && message !== 'Failed to load overworld window',
);
if (unexpectedErrors.length > 0) {
  throw new Error(`Unexpected console errors:\n${unexpectedErrors.join('\n')}`);
}

console.log(JSON.stringify({
  ok: true,
  linkedEmailRequest,
  screenshot: path.join(outputDir, 'wallet-only-add-email.png'),
}));
await browser.close();

async function exposeAuthMenu(targetPage) {
  await targetPage.evaluate(() => {
    document.body.dataset.appReady = 'true';
    for (const selector of ['#boot-splash', '#busy-overlay', '#welcome-modal']) {
      const element = document.querySelector(selector);
      if (element instanceof HTMLElement) {
        element.style.display = 'none';
      }
    }
    document.querySelector('#auth-panel')?.classList.add('menu-open');
  });
}

async function expectText(targetPage, selector, expected) {
  const actual = (await targetPage.locator(selector).textContent())?.trim();
  if (actual !== expected) {
    throw new Error(`${selector} expected "${expected}", got "${actual ?? ''}".`);
  }
}

async function expectAttribute(targetPage, selector, name, expected) {
  const actual = await targetPage.locator(selector).getAttribute(name);
  if (actual !== expected) {
    throw new Error(`${selector}[${name}] expected "${expected}", got "${actual ?? ''}".`);
  }
}

function documentHidden(className) {
  return className?.split(/\s+/).includes('hidden') ?? false;
}
