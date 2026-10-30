// Every browser the smoke and probe scripts launch stays silent: headless Chromium and WebKit on
// macOS still play sound through the computer's speakers. Import this module (for its side
// effect) from any script that uses Playwright; it patches the shared `playwright` exports once.
//
// - Chromium gets `--mute-audio`, which also covers embedded YouTube iframes.
// - WebKit has no mute flag, so each context gets an init script that routes Web Audio into a
//   zero gain before the speakers (the audio graph keeps working for tests that inspect it) and
//   mutes media elements, and YouTube embeds are not loaded.
import { chromium, firefox, webkit } from 'playwright';

const MUTE_PAGE_SCRIPT = `(() => {
  if (window.__wampTestMuted) return;
  window.__wampTestMuted = true;
  if (typeof AudioNode !== 'undefined' && typeof AudioDestinationNode !== 'undefined') {
    const silencers = new WeakMap();
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (target, ...rest) {
      if (target instanceof AudioDestinationNode) {
        let silence = silencers.get(target);
        if (!silence) {
          silence = target.context.createGain();
          silence.gain.value = 0;
          connect.call(silence, target);
          silencers.set(target, silence);
        }
        return connect.call(this, silence, ...rest);
      }
      return connect.call(this, target, ...rest);
    };
  }
  if (typeof HTMLMediaElement !== 'undefined') {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      this.muted = true;
      return play.apply(this, args);
    };
  }
})();`;

const YOUTUBE_EMBED = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com)\/embed\//;

async function muteContext(context) {
  await context.addInitScript(MUTE_PAGE_SCRIPT);
  await context.route(YOUTUBE_EMBED, (route) => route.fulfill({ status: 204, body: '' }));
  return context;
}

function patchBrowser(browser, silenceContexts) {
  if (!silenceContexts || browser.__wampMuted) return browser;
  browser.__wampMuted = true;
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => muteContext(await newContext(...args));
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    const page = await newPage(...args);
    await muteContext(page.context());
    return page;
  };
  return browser;
}

function patchBrowserType(type, { muteFlag, silenceContexts }) {
  if (!type || type.__wampMuted) return;
  type.__wampMuted = true;
  const withFlag = (options = {}) => (muteFlag
    ? { ...options, args: [...new Set([...(options.args ?? []), muteFlag])] }
    : options);
  const launch = type.launch.bind(type);
  type.launch = async (options) => patchBrowser(await launch(withFlag(options)), silenceContexts);
  const launchPersistentContext = type.launchPersistentContext.bind(type);
  type.launchPersistentContext = async (dir, options) => {
    const context = await launchPersistentContext(dir, withFlag(options));
    return silenceContexts ? muteContext(context) : context;
  };
}

patchBrowserType(chromium, { muteFlag: '--mute-audio', silenceContexts: false });
patchBrowserType(webkit, { muteFlag: null, silenceContexts: true });
patchBrowserType(firefox, { muteFlag: null, silenceContexts: true });
