import assert from 'node:assert/strict';

/** Hold only the first map-config reply so the cold download order is observable. */
export async function installStartupFixture(context, { delayMs = 500 } = {}) {
  await context.addInitScript(() => {
    performance.setResourceTimingBufferSize(2000);
    window.__wampStartupProbe = {};
    localStorage.setItem('wamp_replay_opt_out', '1');
    localStorage.setItem('wamp.settings.musicVolume', '0');
    localStorage.setItem('wamp.settings.sfxVolume', '0');
  });
  let first = true;
  await context.route(url => url.pathname === '/api/world/tiles/config', async route => {
    if (!first) return route.fallback();
    first = false;
    await new Promise(resolve => setTimeout(resolve, delayMs));
    await route.request().frame().evaluate(() => {
      window.__wampStartupProbe.configReleasedAt = performance.now();
      window.__wampStartupProbe.mainStartedAtRelease = typeof window.render_game_to_text === 'function';
    });
    await route.fallback();
  });
}

export async function auditStartupDownloads(page) {
  await page.waitForFunction(() => document.body.dataset.appReady === 'true', null, { timeout: 120000 });
  await page.waitForFunction(() => window.__wampStartupProbe.configReleasedAt > 0);
  const result = await page.evaluate(() => {
    const resources = performance.getEntriesByType('resource');
    return {
      ...window.__wampStartupProbe,
      ready: document.body.dataset.appReady === 'true',
      modules: Array.from(document.querySelectorAll('link[data-wamp-boot-preload]'), link => ({
        file: new URL(link.href).pathname,
        priority: link.fetchPriority || link.getAttribute('fetchpriority'),
        requests: resources.filter(resource => resource.name === link.href)
          .map(resource => ({ start: resource.startTime, end: resource.responseEnd })),
      })),
    };
  });
  assert(result.ready && result.configReleasedAt > 0, 'delayed config still reaches the game');
  assert(result.modules.length > 0, 'built game has early module hints');
  for (const module of result.modules) {
    assert.equal(module.priority, 'low');
    assert.equal(module.requests.length, 1, `preload/import reuse one request: ${module.file}`);
    assert(module.requests[0].start < result.configReleasedAt,
      `game download starts before the first map-config reply: ${module.file}`);
  }
  return result;
}
