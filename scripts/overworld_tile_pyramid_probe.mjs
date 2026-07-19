import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  evaluateOverworldTileProbeAcceptance,
  evaluateSerializedL0Bootstrap,
  getManifestLevel,
  hasWorldTileCoverageIdentityTransition,
  isCameraReversalTowardOrigin,
  isSameZoomDirectionalPanStep,
  isStableWorldTileReadyFrame,
  isWorldTileImageUrl,
  parseSnapshotQuery,
  parseWorldTileManifestProbe,
  partitionTrackedRequestsByCoverageBoundaries,
  selectCreditableEarlySharpEvent,
  selectExpectedWorldTileLevel,
  summarizeApiWorkerRequests,
  summarizeTileImagePhase,
  summarizeTrackedNetwork,
} from './overworld_tile_pyramid_probe_helpers.mjs';

const DEFAULT_URL = 'http://127.0.0.1:3000/?previewSmoke=1&perf=1&mobilePerfHud=0&worldTiles=force';
const DEFAULT_ZOOMS = [0.08, 0.10, 0.17, 0.18, 0.20, 0.40, 0.80];
const TARGET_ZOOM_TOLERANCE = 0.006;

function parseArgs(argv) {
  const args = {
    url: DEFAULT_URL,
    out: 'output/overworld-tile-pyramid/probe',
    headless: true,
    timeoutMs: 20_000,
    zooms: DEFAULT_ZOOMS,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--url' && value) {
      args.url = value;
      index += 1;
    } else if (key === '--out' && value) {
      args.out = value;
      index += 1;
    } else if (key === '--timeout-ms' && value) {
      args.timeoutMs = Number(value);
      index += 1;
    } else if (key === '--zooms' && value) {
      args.zooms = value.split(',').map(Number).filter(Number.isFinite);
      index += 1;
    } else if (key === '--headless' && value) {
      args.headless = value !== '0' && value !== 'false';
      index += 1;
    }
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1_000) {
    throw new Error('--timeout-ms must be at least 1000.');
  }
  if (args.zooms.length === 0 || args.zooms.some((zoom) => zoom <= 0)) {
    throw new Error('--zooms must contain positive comma-separated numbers.');
  }
  return args;
}

async function readState(page) {
  const raw = await page.evaluate(() => window.render_game_to_text?.() ?? '{}');
  return JSON.parse(raw);
}

function tileMetricsFromState(state) {
  const scene = state?.activeScene ?? null;
  return scene?.lodMetrics?.worldTiles ?? scene?.worldTiles ?? null;
}

function summarizeState(state) {
  const scene = state?.activeScene ?? {};
  const metrics = tileMetricsFromState(state);
  const lod = scene.lodMetrics ?? {};
  const previewBuildSegment = scene.mobilePerformance?.topSegments?.find(
    (segment) => segment.label === 'stream.buildChunkPreviewTexture',
  ) ?? null;
  return {
    zoom: scene.zoom ?? null,
    camera: scene.camera?.worldView ?? null,
    mode: scene.mode ?? null,
    targetLevel: metrics?.targetLevel ?? null,
    committedLevel: metrics?.committedLevel ?? null,
    visibleCount: metrics?.visibleCount ?? null,
    readyCount: metrics?.readyCount ?? null,
    targetReadyCount: metrics?.targetReadyCount ?? null,
    staleCount: metrics?.staleCount ?? null,
    coveragePercentage: metrics?.coveragePercentage ?? null,
    targetCoveragePercentage: metrics?.targetCoveragePercentage ?? null,
    coverageEpoch: metrics?.coverageEpoch ?? null,
    coverageKey: metrics?.coverageKey ?? null,
    readyCoverageEpoch: metrics?.readyCoverageEpoch ?? null,
    coverageStartedAtMs: metrics?.coverageStartedAtMs ?? null,
    coverageReadyAtMs: metrics?.coverageReadyAtMs ?? null,
    queueDepths: metrics?.queueDepths ?? null,
    replacementGapFrames: metrics?.replacementGapFrames ?? null,
    fallbackReason: metrics?.fallbackReason ?? null,
    rollout: metrics ? {
      enabled: metrics.enabled ?? false,
      cutoverActive: metrics.cutoverActive ?? false,
      shadow: metrics.shadow ?? false,
      forced: metrics.forced ?? false,
      rendererVersion: metrics.rendererVersion ?? null,
      cohortBucket: metrics.cohortBucket ?? null,
    } : null,
    byteCache: metrics ? {
      hits: metrics.byteCacheHits ?? 0,
      misses: metrics.byteCacheMisses ?? 0,
      evictions: metrics.byteCacheEvictions ?? 0,
    } : null,
    textureCache: metrics ? {
      attachedTileCount: metrics.attachedTileCount ?? 0,
      contextRestorePending: metrics.contextRestorePending ?? false,
    } : null,
    legacyPreviews: {
      loadedRoomCount: lod.loadedPreviewRoomCount ?? 0,
      loadedChunkCount: lod.loadedPreviewChunkCount ?? 0,
      pendingTextureBuildCount: lod.pendingPreviewTextureBuildCount ?? 0,
      buildSegment: previewBuildSegment,
    },
  };
}

function isCompleteCoverage(metrics) {
  return metrics
    && metrics.visibleCount > 0
    && metrics.coveragePercentage === 100
    && metrics.fallbackReason === null;
}

function isSharpReady(metrics) {
  const targetReadyCount = metrics?.targetReadyCount ?? metrics?.readyCount ?? 0;
  const targetCoveragePercentage = metrics?.targetCoveragePercentage
    ?? (metrics?.visibleCount > 0 ? targetReadyCount / metrics.visibleCount * 100 : 0);
  return isCompleteCoverage(metrics)
    && typeof metrics.coverageKey === 'string'
    && metrics.coverageKey.length > 0
    && Number.isSafeInteger(metrics.coverageEpoch)
    && metrics.readyCoverageEpoch === metrics.coverageEpoch
    && Number.isFinite(metrics.coverageReadyAtMs)
    && targetReadyCount === metrics.visibleCount
    && targetCoveragePercentage === 100
    && metrics.staleCount === 0
    && metrics.committedLevel === metrics.targetLevel
    && Number(metrics.queueDepths?.replacementGroups ?? 0) === 0;
}

async function waitForOverworld(page, timeoutMs) {
  await page.waitForFunction(() => {
    try {
      const payload = JSON.parse(window.render_game_to_text?.() ?? '{}');
      return payload?.activeScene?.scene === 'overworld-play' && payload?.appFeedback?.ready === true;
    } catch {
      return false;
    }
  }, null, { timeout: timeoutMs });
}

async function dismissWelcomeModal(page) {
  const closeButton = page.locator('#btn-welcome-close');
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.evaluate((button) => {
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Welcome close control is not a button');
      }
      button.click();
    });
    await page.waitForTimeout(50);
  }
}

async function waitForTileState(page, predicate, timeoutMs) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const state = await readState(page);
    const metrics = tileMetricsFromState(state);
    if (predicate(metrics)) {
      return {
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        state: summarizeState(state),
      };
    }
    await page.waitForTimeout(25);
  }
  const state = await readState(page);
  throw new Error(`Timed out waiting for tile coverage: ${JSON.stringify(summarizeState(state))}`);
}

async function getCanvasBox(page) {
  const box = await page.evaluate(() => {
    let best = null;
    let bestArea = 0;
    for (const canvas of document.querySelectorAll('canvas')) {
      const rect = canvas.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        best = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
    }
    return best;
  });
  if (!box) throw new Error('No visible game canvas was found.');
  return box;
}

async function dispatchWheel(page, deltaY) {
  const box = await getCanvasBox(page);
  await page.evaluate(({ x, y, delta }) => {
    let canvas = null;
    let largest = 0;
    for (const candidate of document.querySelectorAll('canvas')) {
      const rect = candidate.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > largest) {
        largest = area;
        canvas = candidate;
      }
    }
    if (!canvas) throw new Error('Game canvas is unavailable.');
    canvas.dispatchEvent(new WheelEvent('wheel', {
      clientX: x,
      clientY: y,
      deltaY: delta,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      bubbles: true,
      cancelable: true,
    }));
  }, {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
    delta: deltaY,
  });
}

async function approachZoom(page, targetZoom) {
  const startedAt = performance.now();
  const samples = [];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const before = summarizeState(await readState(page));
    const zoom = Number(before.zoom);
    samples.push(before);
    if (Number.isFinite(zoom) && Math.abs(zoom - targetZoom) <= TARGET_ZOOM_TOLERANCE) break;
    const deltaY = zoom > targetZoom ? 45 : -45;
    await dispatchWheel(page, deltaY);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(100);
  const finalState = summarizeState(await readState(page));
  return {
    samples,
    gestureMs: Math.round((performance.now() - startedAt) * 10) / 10,
    reachedTarget: Number.isFinite(Number(finalState.zoom))
      && Math.abs(Number(finalState.zoom) - targetZoom) <= TARGET_ZOOM_TOLERANCE + 1e-9,
    finalState,
  };
}

async function dragViewportWithMiddleButton(page, direction) {
  const box = await getCanvasBox(page);
  const startFraction = direction === 'forward' ? 0.88 : 0.12;
  const endFraction = direction === 'forward' ? 0.12 : 0.88;
  const startX = Math.round(box.x + box.width * startFraction);
  const startY = Math.round(box.y + box.height * 0.5);
  const endX = Math.round(box.x + box.width * endFraction);
  const endY = startY;
  await page.evaluate(() => {
    let canvas = null;
    let largest = 0;
    for (const candidate of document.querySelectorAll('canvas')) {
      const rect = candidate.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > largest) {
        largest = area;
        canvas = candidate;
      }
    }
    canvas?.focus();
  });
  await page.mouse.move(startX, startY);
  let middleButtonDown = false;
  try {
    await page.mouse.down({ button: 'middle' });
    middleButtonDown = true;
    await page.mouse.move(endX, endY, { steps: 24 });
    await page.mouse.up({ button: 'middle' });
    middleButtonDown = false;
  } finally {
    // Keep the probe from leaving a held middle button behind if an intermediate
    // Playwright mouse move throws. The scene's public panning contract treats a
    // middle-button drag as a pan without depending on private runtime hooks.
    if (middleButtonDown) {
      await page.mouse.up({ button: 'middle' }).catch(() => undefined);
    }
  }
}

async function waitForCoverageIdentityTransition(page, before, timeoutMs) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const state = summarizeState(await readState(page));
    if (hasWorldTileCoverageIdentityTransition(before, state)) {
      return {
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        state,
      };
    }
    await page.waitForTimeout(16);
  }
  const state = summarizeState(await readState(page));
  const error = new Error('Timed out waiting for camera and tile coverage identity transition.');
  error.diagnostics = { before, after: state };
  throw error;
}

async function moveViewportDeterministically(page, before, direction) {
  const attempts = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const gestureStart = summarizeState(await readState(page));
    await dragViewportWithMiddleButton(page, direction);
    const gestureEnd = summarizeState(await readState(page));
    const attemptRecord = { attempt, before: gestureStart, after: gestureEnd };
    attempts.push(attemptRecord);

    if (!isSameZoomDirectionalPanStep(gestureStart, gestureEnd, direction)) {
      const error = new Error(
        'Overworld tile probe public middle-button pan changed zoom or moved in the wrong direction.',
      );
      error.diagnostics = { direction, baseline: before, attempts };
      throw error;
    }
    if (gestureEnd.mode !== 'browse' || gestureEnd.targetLevel !== before.targetLevel) {
      const error = new Error('Overworld tile probe public pan left the same-zoom browse contract.');
      error.diagnostics = { direction, baseline: before, attempts };
      throw error;
    }

    let transition;
    try {
      transition = await waitForCoverageIdentityTransition(page, before, 1_500);
    } catch (error) {
      attemptRecord.transitionError = error instanceof Error ? error.message : String(error);
      continue;
    }
    if (!isSameZoomDirectionalPanStep(before, transition.state, direction)) {
      const error = new Error('Overworld tile coverage transitioned outside the requested same-zoom pan.');
      error.diagnostics = { direction, baseline: before, attempts, transition };
      throw error;
    }
    return {
      source: 'public-middle-button-drag',
      attempts,
      ...transition,
    };
  }

  const error = new Error(
    'Overworld tile probe could not produce a same-zoom coverage transition with public pan input.',
  );
  error.diagnostics = { direction, baseline: before, attempts };
  throw error;
}

async function waitForStableSharpTileState(page, expectedCoverageKey, timeoutMs) {
  const startedAt = performance.now();
  let previousReadyState = null;
  while (performance.now() - startedAt < timeoutMs) {
    const raw = await readState(page);
    const metrics = tileMetricsFromState(raw);
    const state = summarizeState(raw);
    const ready = isSharpReady(metrics) && state.coverageKey === expectedCoverageKey;
    if (ready && previousReadyState && isStableWorldTileReadyFrame(previousReadyState, state)) {
      return {
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        previousState: previousReadyState,
        state,
      };
    }
    previousReadyState = ready ? state : null;
    if (ready) {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    } else {
      await page.waitForTimeout(16);
    }
  }
  const state = summarizeState(await readState(page));
  throw new Error(`Timed out waiting for stable sharp tile coverage: ${JSON.stringify(state)}`);
}

function isTrackedNetworkUrl(url) {
  return url.includes('/api/world/tiles/')
    || /\/world-tiles\/.*\.png(?:\?|$)/.test(url)
    || url.includes('/api/rooms/snapshots/query')
    || url.includes('/api/world/chunks');
}

function getApiWorkerOrigin(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname === '/api' || parsed.pathname.startsWith('/api/')
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

async function installClientProbeHooks(page, networkRecorder) {
  const boundaries = new Map();
  const waiters = new Map();
  await page.exposeBinding('__wampWorldTileProbeBoundary', (_source, label) => {
    if (typeof label !== 'string') return null;
    let boundary = boundaries.get(label) ?? null;
    if (!boundary) {
      boundary = networkRecorder.mark(`client-${label}`);
      boundaries.set(label, boundary);
      for (const resolve of waiters.get(label) ?? []) resolve(boundary);
      waiters.delete(label);
    }
    return boundary;
  });
  await page.addInitScript(() => {
    const state = { sequence: 0, events: [] };
    Object.defineProperty(window, '__wampWorldTileProbe', {
      value: state,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    const record = (event) => {
      const entry = {
        ...event,
        sequence: ++state.sequence,
        atMs: performance.now(),
      };
      state.events.push(entry);
      return entry;
    };
    window.addEventListener('wamp:early-world-tiles-ready', (event) => {
      let earlyState = null;
      try {
        earlyState = JSON.parse(JSON.stringify(event.detail ?? null));
      } catch {
        earlyState = null;
      }
      record({
        type: 'early-bootstrap-ready',
        state: earlyState,
        layerPresent: document.querySelector('[data-wamp-early-world-tiles="true"]') !== null,
        bodyVisible: document.body?.dataset.earlyWorldTilesVisible === 'true',
      });
      void window.__wampWorldTileProbeBoundary?.('early-bootstrap-ready');
    }, { once: true });
    window.addEventListener('wamp:early-world-tiles-sharp-ready', (event) => {
      let earlyState = null;
      try {
        earlyState = JSON.parse(JSON.stringify(event.detail ?? null));
      } catch {
        earlyState = null;
      }
      record({
        type: 'early-bootstrap-sharp-ready',
        state: earlyState,
        layerPresent: document.querySelector('[data-wamp-early-world-tiles="true"]') !== null,
        bodyVisible: document.body?.dataset.earlyWorldTilesVisible === 'true',
      });
      void window.__wampWorldTileProbeBoundary?.('early-bootstrap-sharp-ready');
    }, { once: true });
    const manifestLevel = (value) => {
      try {
        const url = new URL(value, window.location.href);
        if (!url.pathname.includes('/api/world/tiles/manifest')) return null;
        const raw = url.searchParams.get('level');
        if (raw === null || raw.trim() === '') return 'invalid';
        const level = Number(raw);
        return Number.isSafeInteger(level) && level >= 0 && level <= 4 ? level : 'invalid';
      } catch {
        return 'invalid';
      }
    };
    const requestUrl = (value) => {
      if (value instanceof Request) return value.url;
      try {
        return new URL(String(value), window.location.href).toString();
      } catch {
        return String(value);
      }
    };

    const originalFetch = window.fetch;
    window.fetch = function probeFetch(input, init) {
      const url = requestUrl(input);
      const level = manifestLevel(url);
      if (level !== null) record({ type: 'manifest-request', level, url });
      return Reflect.apply(originalFetch, this, [input, init]);
    };

    if (typeof Cache !== 'undefined') {
      const originalCacheMatch = Cache.prototype.match;
      Cache.prototype.match = async function probeCacheMatch(request, options) {
        const response = await Reflect.apply(originalCacheMatch, this, [request, options]);
        const url = requestUrl(request);
        if (/\/world-tiles\/.*\.png(?:\?|$)/.test(url)) {
          record({
            type: response ? 'byte-cache-hit' : 'byte-cache-miss',
            url,
          });
        }
        return response;
      };
    }
  });
  return {
    getBoundary: (label) => boundaries.get(label) ?? null,
    waitForBoundary: (label, timeoutMs = 250) => {
      const existing = boundaries.get(label);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve) => {
        const pending = waiters.get(label) ?? [];
        pending.push(resolve);
        waiters.set(label, pending);
        setTimeout(() => {
          const current = waiters.get(label) ?? [];
          const index = current.indexOf(resolve);
          if (index >= 0) current.splice(index, 1);
          if (current.length === 0) waiters.delete(label);
          resolve(boundaries.get(label) ?? null);
        }, timeoutMs);
      });
    },
  };
}

async function markClientProbeBoundary(page, label) {
  return await page.evaluate((boundaryLabel) => {
    const state = window.__wampWorldTileProbe;
    if (!state || !Array.isArray(state.events)) return null;
    const entry = {
      type: 'boundary',
      label: boundaryLabel,
      sequence: ++state.sequence,
      atMs: performance.now(),
    };
    state.events.push(entry);
    return entry;
  }, label);
}

async function readClientProbeEvents(page) {
  return await page.evaluate(() => {
    const events = window.__wampWorldTileProbe?.events;
    return Array.isArray(events) ? events.map((entry) => ({ ...entry })) : [];
  });
}

function attachNetworkRecorder(page, startedAt) {
  const requests = [];
  const apiWorkerRequests = [];
  const requestEntries = new WeakMap();
  const apiWorkerEntries = new WeakMap();
  const ignoredRequests = new WeakSet();
  const responsesByRequest = new WeakMap();
  const pendingTasks = new Set();
  const orphanEvents = [];
  let eventSequence = 0;
  const elapsedMs = () => performance.now() - startedAt;
  const nextSequence = () => {
    eventSequence += 1;
    return eventSequence;
  };
  const recordRequest = (request) => {
    const url = request.url();
    if (!isTrackedNetworkUrl(url)) return null;
    // Actual manifest loads are window.fetch requests and are independently observed by the
    // init-script hook. Chromium can surface response-body inspection as an aborted `other`
    // request for the same URL; recording that probe artifact would invent a second client load.
    if (getManifestLevel(url) !== null && request.resourceType() !== 'fetch') {
      ignoredRequests.add(request);
      return null;
    }
    const isSnapshotQuery = url.includes('/api/rooms/snapshots/query');
    const postData = isSnapshotQuery ? request.postData() : null;
    const entry = {
      url,
      method: request.method(),
      postData,
      snapshotQuery: isSnapshotQuery ? parseSnapshotQuery(postData) : null,
      manifestLevel: getManifestLevel(url),
      manifestProbe: null,
      resourceType: request.resourceType(),
      startedSeq: nextSequence(),
      startedAtMs: elapsedMs(),
      responseSeq: null,
      responseAtMs: null,
      finishedSeq: null,
      finishedAtMs: null,
      failedSeq: null,
      failedAtMs: null,
      failure: null,
      status: null,
      contentLength: 0,
      responseBodyBytes: null,
      responseBodyError: null,
      cacheStatus: null,
      wampCache: null,
      serverTiming: null,
    };
    requestEntries.set(request, entry);
    requests.push(entry);
    return entry;
  };
  const recordApiWorkerRequest = (request) => {
    if (ignoredRequests.has(request)) return null;
    const url = request.url();
    const origin = getApiWorkerOrigin(url);
    if (origin === null) return null;
    const entry = {
      url,
      origin,
      method: request.method(),
      resourceType: request.resourceType(),
      startedSeq: nextSequence(),
      startedAtMs: elapsedMs(),
      responseSeq: null,
      responseAtMs: null,
      finishedSeq: null,
      finishedAtMs: null,
      failedSeq: null,
      failedAtMs: null,
      failure: null,
      status: null,
    };
    apiWorkerEntries.set(request, entry);
    apiWorkerRequests.push(entry);
    return entry;
  };
  const findExactRequestEntry = (request, type) => {
    const entry = requestEntries.get(request) ?? null;
    if (!entry && ignoredRequests.has(request)) return null;
    if (!entry && isTrackedNetworkUrl(request.url())) {
      orphanEvents.push({
        type,
        sequence: nextSequence(),
        atMs: elapsedMs(),
        url: request.url(),
        method: request.method(),
      });
    }
    return entry;
  };
  const trackTask = (task) => {
    pendingTasks.add(task);
    void task.then(
      () => pendingTasks.delete(task),
      () => pendingTasks.delete(task),
    );
  };
  const cloneSnapshotQuery = (snapshotQuery) => snapshotQuery ? {
    ...snapshotQuery,
    referenceKinds: [...snapshotQuery.referenceKinds],
    referenceClasses: [...snapshotQuery.referenceClasses],
    references: snapshotQuery.references.map((reference) => ({
      ...reference,
      coordinates: reference.coordinates ? { ...reference.coordinates } : null,
    })),
  } : null;
  const cloneEntry = (entry) => ({
    ...entry,
    snapshotQuery: cloneSnapshotQuery(entry.snapshotQuery),
    manifestProbe: entry.manifestProbe ? {
      ...entry.manifestProbe,
      readyNonEmptyUrls: [...entry.manifestProbe.readyNonEmptyUrls],
      targetAddresses: [...(entry.manifestProbe.targetAddresses ?? [])],
    } : null,
  });
  const cloneApiWorkerEntry = (entry) => ({ ...entry });

  page.on('request', (request) => {
    recordRequest(request);
    recordApiWorkerRequest(request);
  });
  page.on('response', (response) => {
    const request = response.request();
    const entry = findExactRequestEntry(request, 'response');
    if (entry) {
      responsesByRequest.set(request, response);
      const headers = response.headers();
      Object.assign(entry, {
        responseSeq: nextSequence(),
        responseAtMs: elapsedMs(),
        status: response.status(),
        contentLength: Number(headers['content-length'] ?? 0) || 0,
        cacheStatus: headers['cf-cache-status'] ?? null,
        wampCache: headers['x-wamp-cache'] ?? null,
        serverTiming: headers['server-timing'] ?? null,
      });
    }
    const apiEntry = apiWorkerEntries.get(request) ?? null;
    if (apiEntry) {
      apiEntry.responseSeq = nextSequence();
      apiEntry.responseAtMs = elapsedMs();
      apiEntry.status = response.status();
    }
  });
  page.on('requestfinished', (request) => {
    const entry = findExactRequestEntry(request, 'requestfinished');
    const apiEntry = apiWorkerEntries.get(request) ?? null;
    if (apiEntry) {
      apiEntry.finishedSeq = nextSequence();
      apiEntry.finishedAtMs = elapsedMs();
    }
    if (!entry) return;
    entry.finishedSeq = nextSequence();
    entry.finishedAtMs = elapsedMs();
    const task = (async () => {
      let response = responsesByRequest.get(request) ?? null;
      if (!response) {
        try {
          response = await request.response();
        } catch (error) {
          entry.responseBodyError = error instanceof Error ? error.message : String(error);
        }
      }
      if (!response) {
        entry.responseBodyError ??= 'missing-response';
        if (entry.manifestLevel !== null) {
          entry.manifestProbe = {
            parseError: 'missing-manifest-response',
            level: null,
            readyNonEmptyUrls: [],
          };
        }
        return;
      }
      let body = null;
      try {
        body = await response.body();
        entry.responseBodyBytes = body.byteLength;
      } catch (error) {
        entry.responseBodyError = error instanceof Error ? error.message : String(error);
      }
      if (entry.manifestLevel === null) return;
      try {
        if (!body) throw new Error(entry.responseBodyError ?? 'manifest-body-unavailable');
        entry.manifestProbe = parseWorldTileManifestProbe(JSON.parse(body.toString('utf8')));
      } catch (error) {
        entry.manifestProbe = {
          parseError: `manifest-json:${error instanceof Error ? error.message : String(error)}`,
          level: null,
          readyNonEmptyUrls: [],
        };
      }
    })();
    trackTask(task);
  });
  page.on('requestfailed', (request) => {
    const entry = findExactRequestEntry(request, 'requestfailed');
    const failure = request.failure()?.errorText ?? 'unknown';
    const apiEntry = apiWorkerEntries.get(request) ?? null;
    if (apiEntry) {
      apiEntry.failedSeq = nextSequence();
      apiEntry.failedAtMs = elapsedMs();
      apiEntry.failure = failure;
    }
    if (entry) {
      entry.failedSeq = nextSequence();
      entry.failedAtMs = elapsedMs();
      entry.failure = failure;
    }
  });
  return {
    elapsedMs,
    mark: (label) => ({
      label,
      sequence: nextSequence(),
      atMs: elapsedMs(),
    }),
    settle: async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      while (pendingTasks.size > 0) {
        await Promise.allSettled([...pendingTasks]);
      }
    },
    snapshot: () => requests.map(cloneEntry),
    snapshotStartedBy: (sequence) => requests
      .filter((entry) => entry.startedSeq <= sequence)
      .map(cloneEntry),
    apiWorkerSnapshot: () => apiWorkerRequests.map(cloneApiWorkerEntry),
    apiWorkerSnapshotStartedBy: (sequence) => apiWorkerRequests
      .filter((entry) => entry.startedSeq <= sequence)
      .map(cloneApiWorkerEntry),
    orphanSnapshot: () => orphanEvents.map((entry) => ({ ...entry })),
  };
}

async function captureInitialTileState(page, predicate, timeoutMs, networkRecorder, label) {
  const state = await waitForTileState(page, predicate, timeoutMs);
  const semanticNetworkBoundary = networkRecorder.mark(label);
  const clientBoundary = await markClientProbeBoundary(page, label);
  // Playwright can report a request on the protocol turn after the matching in-page fetch.
  // Preserve a later drain boundary for correlation diagnostics, but gate accounting stays at
  // the semantic boundary observed when the ready state was captured.
  await page.waitForTimeout(10);
  const protocolDrainBoundary = networkRecorder.mark(`${label}-protocol-drain`);
  return {
    state,
    capturedAtMs: semanticNetworkBoundary.atMs,
    boundary: {
      networkSequence: semanticNetworkBoundary.sequence,
      protocolDrainNetworkSequence: protocolDrainBoundary.sequence,
      clientSequence: clientBoundary?.sequence ?? null,
      clientAtMs: clientBoundary?.atMs ?? null,
    },
  };
}

async function readEarlyBootstrapProbeState(page) {
  return await page.evaluate(() => {
    const events = window.__wampWorldTileProbe?.events;
    const readyEvent = Array.isArray(events)
      ? events.find((entry) => entry.type === 'early-bootstrap-ready') ?? null
      : null;
    let currentState = null;
    try {
      currentState = window.__wampEarlyWorldTiles?.getState?.() ?? null;
    } catch {
      currentState = null;
    }
    return {
      readyEvent: readyEvent ? { ...readyEvent } : null,
      currentState,
      layerPresent: document.querySelector('[data-wamp-early-world-tiles="true"]') !== null,
      bodyVisible: document.body?.dataset.earlyWorldTilesVisible === 'true',
    };
  });
}

async function captureEarlyBootstrapCoverage(page, timeoutMs, networkRecorder, clientProbeHooks) {
  const startedAt = performance.now();
  let snapshot = null;
  while (performance.now() - startedAt < timeoutMs) {
    snapshot = await readEarlyBootstrapProbeState(page);
    if (snapshot.readyEvent) {
      const networkBoundary = await clientProbeHooks.waitForBoundary('early-bootstrap-ready')
        ?? networkRecorder.mark('pre-phaser-coarse-coverage-fallback');
      return {
        ...snapshot,
        boundary: {
          networkSequence: networkBoundary.sequence,
          clientSequence: snapshot.readyEvent.sequence,
          clientAtMs: snapshot.readyEvent.atMs ?? null,
        },
      };
    }
    const status = snapshot.currentState?.status;
    if (status === 'disabled' || status === 'failed' || status === 'released') {
      const error = new Error(`Pre-Phaser L0 bootstrap ended in ${status} before visible coverage.`);
      error.diagnostics = { source: 'pre-phaser-early-l0', ...snapshot };
      throw error;
    }
    await page.waitForTimeout(10);
  }
  snapshot = await readEarlyBootstrapProbeState(page).catch(() => snapshot);
  const error = new Error('Timed out waiting for pre-Phaser L0 coverage.');
  error.diagnostics = { source: 'pre-phaser-early-l0', ...snapshot };
  throw error;
}

async function captureReadinessArtifact(page) {
  const [early, state] = await Promise.all([
    readEarlyBootstrapProbeState(page).catch(() => null),
    readState(page).then(summarizeState).catch(() => null),
  ]);
  const metrics = state ? {
    visibleCount: state.visibleCount,
    readyCount: state.readyCount,
    targetReadyCount: state.targetReadyCount,
    coveragePercentage: state.coveragePercentage,
    targetCoveragePercentage: state.targetCoveragePercentage,
    staleCount: state.staleCount,
    targetLevel: state.targetLevel,
    committedLevel: state.committedLevel,
    coverageEpoch: state.coverageEpoch,
    coverageKey: state.coverageKey,
    readyCoverageEpoch: state.readyCoverageEpoch,
    coverageReadyAtMs: state.coverageReadyAtMs,
    queueDepths: state.queueDepths,
    fallbackReason: state.fallbackReason,
  } : null;
  return {
    coarse: {
      source: 'pre-phaser-early-l0',
      ready: early?.readyEvent?.state?.status === 'visible'
        && early.readyEvent.layerPresent === true
        && early.readyEvent.bodyVisible === true,
      observedReadyAtMs: early?.readyEvent?.atMs ?? null,
      visibleAtMs: early?.readyEvent?.state?.timings?.visibleAtMs ?? null,
      event: early?.readyEvent ?? null,
      current: early?.currentState ?? null,
      layerPresent: early?.layerPresent ?? null,
      bodyVisible: early?.bodyVisible ?? null,
    },
    sharp: {
      source: 'phaser-target-lod',
      ready: isSharpReady(metrics),
      state,
    },
  };
}

function captureOutcome(promise) {
  return promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
}

function requireCapture(outcome) {
  if (outcome.ok) return outcome.value;
  throw outcome.error;
}

async function runPass(context, args, label) {
  const page = await context.newPage();
  const navigationStartedAt = performance.now();
  const networkRecorder = attachNetworkRecorder(page, navigationStartedAt);
  const consoleMessages = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleMessages.push({ type: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', (error) => consoleMessages.push({ type: 'pageerror', text: String(error) }));

  try {
  const clientProbeHooks = await installClientProbeHooks(page, networkRecorder);
  await page.goto(args.url, { waitUntil: 'domcontentloaded' });
  const coarseCoveragePromise = captureOutcome(captureEarlyBootstrapCoverage(
    page,
    args.timeoutMs,
    networkRecorder,
    clientProbeHooks,
  ));
  const sharpCoveragePromise = captureOutcome(captureInitialTileState(
    page,
    isSharpReady,
    args.timeoutMs,
    networkRecorder,
    'sharp-coverage',
  ));
  const appReadyPromise = captureOutcome((async () => {
    await waitForOverworld(page, args.timeoutMs);
    return networkRecorder.elapsedMs();
  })());
  const appReadyOutcome = await appReadyPromise;
  const appReadyMs = requireCapture(appReadyOutcome);
  await dismissWelcomeModal(page);
  const [coarseOutcome, sharpOutcome] = await Promise.all([
    coarseCoveragePromise,
    sharpCoveragePromise,
  ]);
  const coarseCapture = requireCapture(coarseOutcome);
  const sharpCapture = requireCapture(sharpOutcome);
  await networkRecorder.settle();
  const protocolDrainRequests = networkRecorder.snapshotStartedBy(
    sharpCapture.boundary.protocolDrainNetworkSequence,
  );
  const protocolDrainApiWorkerRequests = networkRecorder.apiWorkerSnapshotStartedBy(
    sharpCapture.boundary.protocolDrainNetworkSequence,
  );
  const clientProbeEvents = (await readClientProbeEvents(page)).filter((entry) => (
    entry.sequence <= sharpCapture.boundary.clientSequence
  ));
  const sharp = sharpCapture.state;
  const matchedEarlySharpEvent = selectCreditableEarlySharpEvent(clientProbeEvents, sharp);
  const earlySharpBoundary = matchedEarlySharpEvent
    ? await clientProbeHooks.waitForBoundary('early-bootstrap-sharp-ready')
    : null;
  const earlySharpEvent = earlySharpBoundary
    && earlySharpBoundary.sequence >= coarseCapture.boundary.networkSequence
    && earlySharpBoundary.sequence <= sharpCapture.boundary.networkSequence
    ? matchedEarlySharpEvent
    : null;
  const phaserNetworkPhases = partitionTrackedRequestsByCoverageBoundaries(protocolDrainRequests, {
    coarseCoverageSequence: coarseCapture.boundary.networkSequence,
    sharpCoverageSequence: sharpCapture.boundary.networkSequence,
  });
  const phaserApiWorkerPhases = partitionTrackedRequestsByCoverageBoundaries(
    protocolDrainApiWorkerRequests,
    {
      coarseCoverageSequence: coarseCapture.boundary.networkSequence,
      sharpCoverageSequence: sharpCapture.boundary.networkSequence,
    },
  );
  const earlyNetworkPhases = earlySharpEvent
    ? partitionTrackedRequestsByCoverageBoundaries(protocolDrainRequests, {
        coarseCoverageSequence: coarseCapture.boundary.networkSequence,
        sharpCoverageSequence: earlySharpBoundary.sequence,
      })
    : null;
  const earlyApiWorkerPhases = earlySharpEvent
    ? partitionTrackedRequestsByCoverageBoundaries(protocolDrainApiWorkerRequests, {
        coarseCoverageSequence: coarseCapture.boundary.networkSequence,
        sharpCoverageSequence: earlySharpBoundary.sequence,
      })
    : null;
  const bootstrap = evaluateSerializedL0Bootstrap({
    requests: phaserNetworkPhases.throughSharp,
    clientEvents: clientProbeEvents,
    initialCoverageBoundary: coarseCapture.boundary,
    orphanEvents: networkRecorder.orphanSnapshot().filter((entry) => (
      entry.sequence <= sharpCapture.boundary.networkSequence
    )),
  });
  const coarseNetworkRequests = phaserNetworkPhases.coarse;
  const phaserRefinementNetworkRequests = phaserNetworkPhases.refinement;
  const phaserSharpNetworkRequests = phaserNetworkPhases.throughSharp;
  const earlyRefinementNetworkRequests = earlyNetworkPhases?.refinement ?? [];
  const earlySharpNetworkRequests = earlyNetworkPhases?.throughSharp ?? [];
  const coarseApiWorkerRequests = phaserApiWorkerPhases.coarse;
  const phaserRefinementApiWorkerRequests = phaserApiWorkerPhases.refinement;
  const phaserSharpApiWorkerRequests = phaserApiWorkerPhases.throughSharp;
  const earlyRefinementApiWorkerRequests = earlyApiWorkerPhases?.refinement ?? [];
  const earlySharpApiWorkerRequests = earlyApiWorkerPhases?.throughSharp ?? [];
  const refinementNetworkRequests = earlySharpEvent
    ? earlyRefinementNetworkRequests
    : phaserRefinementNetworkRequests;
  const sharpNetworkRequests = earlySharpEvent
    ? earlySharpNetworkRequests
    : phaserSharpNetworkRequests;
  const refinementApiWorkerRequests = earlySharpEvent
    ? earlyRefinementApiWorkerRequests
    : phaserRefinementApiWorkerRequests;
  const sharpApiWorkerRequests = earlySharpEvent
    ? earlySharpApiWorkerRequests
    : phaserSharpApiWorkerRequests;
  const coarseNetworkSummary = summarizeTrackedNetwork(coarseNetworkRequests);
  const refinementNetworkSummary = summarizeTrackedNetwork(refinementNetworkRequests);
  const sharpNetworkSummary = summarizeTrackedNetwork(sharpNetworkRequests);
  const coarse = {
    source: bootstrap.source,
    state: bootstrap.earlyBootstrapState,
    eventAtMs: bootstrap.earlyReadyEventAtMs,
    eventSequence: bootstrap.earlyReadyEventSequence,
    layerPresentAtReady: coarseCapture.readyEvent.layerPresent,
    bodyVisibleAtReady: coarseCapture.readyEvent.bodyVisible,
    currentState: coarseCapture.currentState,
  };
  const coarseReadyMs = bootstrap.coarseReadyMs;
  const phaserSharpReadyMs = Number.isFinite(sharpCapture.boundary.clientAtMs)
    ? sharpCapture.boundary.clientAtMs
    : sharpCapture.capturedAtMs;
  const earlySharpReadyMs = earlySharpEvent?.state?.timings?.sharpVisibleAtMs ?? null;
  const sharpReadyMs = earlySharpReadyMs ?? phaserSharpReadyMs;
  const sharpSource = earlySharpEvent ? 'pre-phaser-target-lod' : 'phaser-target-lod';

  const zooms = [];
  let expectedLevel = Number(sharp.state.committedLevel);
  if (!Number.isInteger(expectedLevel) || expectedLevel < 0 || expectedLevel > 4) {
    throw new Error(`Initial sharp state has an invalid committed LOD: ${expectedLevel}`);
  }
  for (const targetZoom of args.zooms) {
    const approach = await approachZoom(page, targetZoom);
    expectedLevel = selectExpectedWorldTileLevel(Number(approach.finalState.zoom), expectedLevel);
    const coverage = await waitForTileState(page, isCompleteCoverage, args.timeoutMs);
    const targetReady = await waitForTileState(
      page,
      (metrics) => isSharpReady(metrics)
        && metrics.targetLevel === expectedLevel
        && metrics.committedLevel === expectedLevel,
      args.timeoutMs,
    );
    zooms.push({ targetZoom, expectedLevel, ...approach, coverage, targetReady });
  }

  const beforePan = summarizeState(await readState(page));
  const panStartedAt = performance.now();
  const forwardPan = await moveViewportDeterministically(
    page,
    beforePan,
    'forward',
  );
  const reversalStartedAt = performance.now();
  const reversalPan = await moveViewportDeterministically(
    page,
    forwardPan.state,
    'reverse',
  );
  if (!isCameraReversalTowardOrigin(beforePan, forwardPan.state, reversalPan.state)) {
    const error = new Error('Overworld tile probe reversal did not move back toward its origin.');
    error.diagnostics = { beforePan, forwardPan, reversalPan };
    throw error;
  }
  const reversalGestureMs = Math.round((performance.now() - reversalStartedAt) * 10) / 10;
  const panGestureMs = Math.round((performance.now() - panStartedAt) * 10) / 10;
  const panGestureCompletedAt = performance.now();
  const panCoverage = await waitForTileState(
    page,
    (metrics) => isCompleteCoverage(metrics)
      && metrics.coverageKey === reversalPan.state.coverageKey,
    args.timeoutMs,
  );
  const panCoverageMs = Math.round((performance.now() - panGestureCompletedAt) * 10) / 10;
  const panSharp = await waitForStableSharpTileState(
    page,
    reversalPan.state.coverageKey,
    args.timeoutMs,
  );
  const panSharpMs = Math.round((performance.now() - panGestureCompletedAt) * 10) / 10;
  const afterPan = panSharp.state;

  const screenshotPath = path.join(args.out, `${label}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await networkRecorder.settle();
  const network = networkRecorder.snapshot();
  const apiWorkerRequests = networkRecorder.apiWorkerSnapshot();
  const finalClientProbeEvents = await readClientProbeEvents(page);
  const result = {
    label,
    appReadyMs,
    coarseReadyMs,
    sharpReadyMs,
    earlySharpReadyMs,
    phaserSharpReadyMs,
    readiness: {
      coarse: {
        source: 'pre-phaser-early-l0',
        ready: true,
        visibleAtMs: coarseReadyMs,
        eventAtMs: bootstrap.earlyReadyEventAtMs,
        state: bootstrap.earlyBootstrapState,
      },
      sharp: {
        source: sharpSource,
        ready: true,
        readyAtMs: sharpReadyMs,
        earlyReadyAtMs: earlySharpReadyMs,
        phaserReadyAtMs: phaserSharpReadyMs,
        earlyState: earlySharpEvent?.state ?? null,
        state: sharp,
      },
    },
    initialCapture: {
      coarseSource: 'pre-phaser-early-l0',
      sharpSource,
      coarseBoundary: coarseCapture.boundary,
      sharpBoundary: sharpCapture.boundary,
      earlySharpBoundary,
      bootstrap,
      clientEvents: clientProbeEvents,
    },
    coarse,
    coarseNetwork: {
      capturedAtMs: coarseReadyMs,
      boundarySequence: coarseCapture.boundary.networkSequence,
      requests: coarseNetworkRequests,
      summary: coarseNetworkSummary,
      apiWorker: summarizeApiWorkerRequests(coarseApiWorkerRequests),
    },
    refinementNetwork: {
      startedAfterBoundarySequence: coarseCapture.boundary.networkSequence,
      // Legacy field retained so existing artifact readers continue to find a boundary.
      startedAtBoundarySequence: coarseCapture.boundary.networkSequence,
      capturedAtMs: sharpReadyMs,
      requests: refinementNetworkRequests,
      summary: refinementNetworkSummary,
      apiWorker: summarizeApiWorkerRequests(refinementApiWorkerRequests),
    },
    sharpNetwork: {
      capturedAtMs: sharpReadyMs,
      requests: sharpNetworkRequests,
      summary: sharpNetworkSummary,
      apiWorker: summarizeApiWorkerRequests(sharpApiWorkerRequests),
    },
    earlyRefinementNetwork: earlySharpEvent ? {
      startedAfterBoundarySequence: coarseCapture.boundary.networkSequence,
      capturedAtMs: earlySharpReadyMs,
      requests: earlyRefinementNetworkRequests,
      summary: summarizeTrackedNetwork(earlyRefinementNetworkRequests),
      apiWorker: summarizeApiWorkerRequests(earlyRefinementApiWorkerRequests),
    } : null,
    earlySharpNetwork: earlySharpEvent ? {
      capturedAtMs: earlySharpReadyMs,
      boundarySequence: earlySharpBoundary.sequence,
      requests: earlySharpNetworkRequests,
      summary: summarizeTrackedNetwork(earlySharpNetworkRequests),
      apiWorker: summarizeApiWorkerRequests(earlySharpApiWorkerRequests),
    } : null,
    phaserRefinementNetwork: {
      startedAfterBoundarySequence: coarseCapture.boundary.networkSequence,
      capturedAtMs: phaserSharpReadyMs,
      requests: phaserRefinementNetworkRequests,
      summary: summarizeTrackedNetwork(phaserRefinementNetworkRequests),
      apiWorker: summarizeApiWorkerRequests(phaserRefinementApiWorkerRequests),
    },
    phaserSharpNetwork: {
      capturedAtMs: phaserSharpReadyMs,
      boundarySequence: sharpCapture.boundary.networkSequence,
      requests: phaserSharpNetworkRequests,
      summary: summarizeTrackedNetwork(phaserSharpNetworkRequests),
      apiWorker: summarizeApiWorkerRequests(phaserSharpApiWorkerRequests),
    },
    initialTileImagePhases: {
      coarse: summarizeTileImagePhase(coarseNetworkRequests),
      refinement: summarizeTileImagePhase(refinementNetworkRequests),
      cumulativeThroughSharp: summarizeTileImagePhase(sharpNetworkRequests),
      earlyRefinement: earlySharpEvent
        ? summarizeTileImagePhase(earlyRefinementNetworkRequests)
        : null,
      earlyCumulativeThroughSharp: earlySharpEvent
        ? summarizeTileImagePhase(earlySharpNetworkRequests)
        : null,
      phaserRefinement: summarizeTileImagePhase(phaserRefinementNetworkRequests),
      phaserCumulativeThroughSharp: summarizeTileImagePhase(phaserSharpNetworkRequests),
    },
    sharp,
    zooms,
    pan: {
      before: beforePan,
      after: afterPan,
      forward: forwardPan,
      reversal: reversalPan,
      coverage: panCoverage,
      sharp: panSharp,
      panGestureMs,
      reversalGestureMs,
      panCoverageMs,
      panSharpMs,
    },
    network,
    networkSummary: summarizeTrackedNetwork(network),
    apiWorkerNetwork: {
      requests: apiWorkerRequests,
      summary: summarizeApiWorkerRequests(apiWorkerRequests),
    },
    clientProbeEvents: finalClientProbeEvents,
    orphanNetworkEvents: networkRecorder.orphanSnapshot(),
    consoleMessages,
    screenshotPath,
  };
  return result;
  } catch (error) {
    await networkRecorder.settle().catch(() => {});
    const failureScreenshotPath = path.join(args.out, `${label}-failure.png`);
    await page.screenshot({ path: failureScreenshotPath, fullPage: true }).catch(() => {});
    const network = networkRecorder.snapshot();
    const apiWorkerRequests = networkRecorder.apiWorkerSnapshot();
    const state = await readState(page).then(summarizeState).catch(() => null);
    const clientProbeEvents = await readClientProbeEvents(page).catch(() => []);
    const readiness = await captureReadinessArtifact(page).catch(() => ({
      coarse: { source: 'pre-phaser-early-l0', ready: false },
      sharp: { source: 'phaser-target-lod', ready: false },
    }));
    const normalized = error instanceof Error ? error : new Error(String(error));
    normalized.probeArtifact = {
      label,
      elapsedMs: networkRecorder.elapsedMs(),
      error: {
        message: normalized.message,
        stack: normalized.stack ?? null,
        diagnostics: normalized.diagnostics ?? null,
      },
      state,
      readiness,
      network,
      networkSummary: summarizeTrackedNetwork(network),
      apiWorkerNetwork: {
        requests: apiWorkerRequests,
        summary: summarizeApiWorkerRequests(apiWorkerRequests),
      },
      clientProbeEvents,
      orphanNetworkEvents: networkRecorder.orphanSnapshot(),
      consoleMessages,
      screenshotPath: fs.existsSync(failureScreenshotPath) ? failureScreenshotPath : null,
    };
    throw normalized;
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(args.out, { recursive: true });
  const result = {
    generatedAt: new Date().toISOString(),
    url: args.url,
    zoomTargets: args.zooms,
    cold: null,
    warm: null,
    acceptance: null,
  };
  const outputPath = path.join(args.out, 'result.json');
  let browser = null;
  let context = null;
  try {
    browser = await chromium.launch({
      headless: args.headless,
      args: ['--use-gl=angle', '--use-angle=swiftshader'],
    });
    context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    result.cold = await runPass(context, args, 'cold');
    result.warm = await runPass(context, args, 'warm');
    result.acceptance = evaluateOverworldTileProbeAcceptance(result);
    if (!result.acceptance.passed) {
      const error = new Error(
        `Overworld tile acceptance gates failed: ${result.acceptance.failures.map((failure) => (
          `${failure.pass}:${failure.code}`
        )).join(', ')}`,
      );
      error.diagnostics = result.acceptance;
      throw error;
    }
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    result.failure = {
      message: normalized.message,
      stack: normalized.stack ?? null,
      diagnostics: normalized.diagnostics ?? null,
      pass: normalized.probeArtifact ?? null,
    };
    throw normalized;
  } finally {
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`Wrote ${outputPath}`);
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
