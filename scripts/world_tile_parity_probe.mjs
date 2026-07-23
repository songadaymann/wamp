import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const PNG_WIDTH = 642;
const PNG_HEIGHT = 354;
const CORE_WIDTH = 640;
const CORE_HEIGHT = 352;
const OVERLAP = 1;
const DEFAULT_CONTRACT = 'wamp-world-tile-render-v2-box-srgb';
const IMMUTABLE_PAGES_ORIGIN = /^https:\/\/[a-f0-9]{8}\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.pages\.dev$/i;

export function parseWorldTileParityArgs(argv) {
  const values = argv.slice(2);
  const args = {
    apiBase: readArg(values, '--api-base') ?? process.env.WORLD_TILE_API_BASE_URL?.trim() ?? '',
    rendererOrigin: readArg(values, '--renderer-origin') ?? process.env.WORLD_TILE_RENDERER_ORIGIN?.trim() ?? '',
    rendererVersion: readArg(values, '--renderer-version') ?? process.env.WORLD_TILE_RENDERER_VERSION?.trim() ?? '',
    rendererContract: readArg(values, '--renderer-contract') ?? DEFAULT_CONTRACT,
    out: readArg(values, '--out') ?? 'output/overworld-tile-pyramid/safety-parity',
    bounds: parseBounds(readArg(values, '--bounds') ?? '-2,2,-2,2'),
    maxLeaves: parseInteger(readArg(values, '--max-leaves') ?? '3', '--max-leaves', 1, 20),
    manifestRuns: parseInteger(readArg(values, '--manifest-runs') ?? '5', '--manifest-runs', 1, 20),
    timeoutMs: parseInteger(readArg(values, '--timeout-ms') ?? '30000', '--timeout-ms', 1_000, 120_000),
    manifestMaxBytes: parseInteger(
      readArg(values, '--manifest-max-bytes') ?? String(50 * 1024),
      '--manifest-max-bytes',
      1,
      2 * 1024 * 1024,
    ),
    manifestMaxMs: parseNumber(readArg(values, '--manifest-max-ms') ?? '150', '--manifest-max-ms', 1),
    pixelToleranceRatio: parseNumber(
      readArg(values, '--pixel-tolerance-ratio') ?? '0.001',
      '--pixel-tolerance-ratio',
      0,
      1,
    ),
    channelTolerance: parseInteger(
      readArg(values, '--channel-tolerance') ?? '1',
      '--channel-tolerance',
      0,
      255,
    ),
    allowIncomplete: values.includes('--allow-incomplete'),
    headless: !values.includes('--headed'),
  };
  if (!args.apiBase || !args.rendererOrigin || !args.rendererVersion) {
    throw new Error(
      'Required: --api-base <url> --renderer-origin <immutable-pages-origin> '
      + '--renderer-version <version> [--out <directory>].',
    );
  }
  args.apiBase = normalizeHttpOrigin(args.apiBase, '--api-base');
  args.rendererOrigin = normalizeImmutableRendererOrigin(args.rendererOrigin);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(args.rendererVersion)) {
    throw new Error('--renderer-version must contain 1-128 URL-safe characters.');
  }
  if (!/^[a-zA-Z0-9:_-]{8,256}$/.test(args.rendererContract)) {
    throw new Error('--renderer-contract must contain 8-256 contract characters.');
  }
  return args;
}

export function parsePngDimensions(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    buffer.length < 24
    || signature.some((value, index) => buffer[index] !== value)
    || buffer.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error('Object is not a valid PNG with an IHDR header.');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function classifyManifestEntry(entry) {
  const readyObjectCurrent = Boolean(
    entry.ready
    && entry.ready.generation === entry.desiredGeneration
    && entry.desiredEmpty === false,
  );
  const readyEmptyCurrent = entry.desiredEmpty === true
    && entry.readyEmptyGeneration === entry.desiredGeneration;
  const stale = Boolean(
    (entry.ready && entry.ready.generation !== entry.desiredGeneration)
    || (Array.isArray(entry.staleRoomIds) && entry.staleRoomIds.length > 0),
  );
  const inconsistent = Boolean(
    (entry.desiredEmpty && entry.ready?.generation === entry.desiredGeneration)
    || (!entry.desiredEmpty && entry.readyEmptyGeneration === entry.desiredGeneration),
  );
  return {
    readyObjectCurrent,
    readyEmptyCurrent,
    stale,
    inconsistent,
    missing: !readyObjectCurrent && !readyEmptyCurrent && !stale,
  };
}

export function percentile(values, quantile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index];
}

async function runProbe(args, report) {
  const configResult = await fetchJsonMeasured(
    `${args.apiBase}/api/world/tiles/config`,
    { signal: AbortSignal.timeout(args.timeoutMs) },
  );
  report.config = responseSummary(configResult);
  report.config.body = configResult.body;
  if (!configResult.response.ok) {
    throw new Error(`Tile config failed with ${configResult.response.status}.`);
  }
  if (configResult.body.activeRendererVersion !== args.rendererVersion) {
    report.failures.push(
      `Active renderer ${String(configResult.body.activeRendererVersion)} does not match ${args.rendererVersion}.`,
    );
  }
  if (configResult.body.available !== true) {
    report.failures.push('Tile config reports availability=false.');
  }

  // Measure the same coverage-only payload used by the tiled browser client.
  // Room summaries are loaded separately below for the leaf parity fixtures.
  const manifestUrl = buildManifestUrl(args, false);
  const manifestResults = [];
  for (let run = 0; run < args.manifestRuns; run += 1) {
    manifestResults.push(await fetchJsonMeasured(manifestUrl, {
      signal: AbortSignal.timeout(args.timeoutMs),
    }));
  }
  const manifestResult = manifestResults.at(-1);
  if (!manifestResult.response.ok) {
    throw new Error(`Tile manifest failed with ${manifestResult.response.status}.`);
  }
  const manifest = manifestResult.body;
  const durations = manifestResults.map((result) => result.durationMs);
  const sizes = manifestResults.map((result) => result.byteLength);
  report.manifest = {
    url: manifestUrl,
    runs: manifestResults.map(responseSummary),
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maximumDecodedBytes: Math.max(...sizes),
    entryCount: Array.isArray(manifest.entries) ? manifest.entries.length : null,
    roomCount: Array.isArray(manifest.rooms) ? manifest.rooms.length : null,
    rendererVersion: manifest.rendererVersion ?? null,
  };
  if (manifest.rendererVersion !== args.rendererVersion) {
    report.failures.push(`Manifest renderer ${String(manifest.rendererVersion)} does not match requested version.`);
  }
  if (report.manifest.p95Ms > args.manifestMaxMs) {
    report.failures.push(`Manifest p95 ${report.manifest.p95Ms}ms exceeds ${args.manifestMaxMs}ms.`);
  }
  if (report.manifest.maximumDecodedBytes > args.manifestMaxBytes) {
    report.failures.push(
      `Manifest ${report.manifest.maximumDecodedBytes} bytes exceeds ${args.manifestMaxBytes} bytes.`,
    );
  }
  if (!Array.isArray(manifest.entries) || !Array.isArray(manifest.rooms)) {
    throw new Error('Manifest is missing entries or room summaries.');
  }

  const roomManifestResult = await fetchJsonMeasured(buildManifestUrl(args, true), {
    signal: AbortSignal.timeout(args.timeoutMs),
  });
  report.roomManifest = responseSummary(roomManifestResult);
  report.roomManifest.roomCount = Array.isArray(roomManifestResult.body?.rooms)
    ? roomManifestResult.body.rooms.length
    : null;
  if (!roomManifestResult.response.ok) {
    throw new Error(`Room-summary manifest failed with ${roomManifestResult.response.status}.`);
  }
  const roomManifest = roomManifestResult.body;
  if (roomManifest.rendererVersion !== args.rendererVersion) {
    report.failures.push(
      `Room-summary manifest renderer ${String(roomManifest.rendererVersion)} does not match requested version.`,
    );
  }
  if (!Array.isArray(roomManifest.rooms)) {
    throw new Error('Room-summary manifest is missing room summaries.');
  }

  const entriesByAddress = new Map(manifest.entries.map((entry) => [addressKey(entry.address), entry]));
  report.entries = summarizeEntries(manifest.entries);
  if (!args.allowIncomplete) {
    if (report.entries.missing.length > 0) {
      report.failures.push(`${report.entries.missing.length} manifest entries are missing current coverage.`);
    }
    if (report.entries.stale.length > 0) {
      report.failures.push(`${report.entries.stale.length} manifest entries are stale.`);
    }
    if (report.entries.inconsistent.length > 0) {
      report.failures.push(`${report.entries.inconsistent.length} manifest entries are internally inconsistent.`);
    }
  }

  const readyEntries = manifest.entries.filter((entry) => entry.ready);
  report.objects = await verifyAdvertisedObjectHeads(readyEntries, args, report.failures);

  const browser = await chromium.launch({ headless: args.headless });
  const page = await browser.newPage();
  const tileBytes = new Map();
  try {
    await loadRendererPage(page, args);
    const currentPublishedRooms = [...roomManifest.rooms]
      .sort((left, right) => left.coordinates.y - right.coordinates.y || left.coordinates.x - right.coordinates.x)
      .filter((room) => {
        const entry = entriesByAddress.get(addressKey({
          rendererVersion: args.rendererVersion,
          level: 4,
          x: room.coordinates.x,
          y: room.coordinates.y,
        }));
        return entry && classifyManifestEntry(entry).readyObjectCurrent;
      });
    const publishedRooms = currentPublishedRooms.slice(0, args.maxLeaves);
    if (publishedRooms.length === 0) {
      report.failures.push('No current published L4 room was available in the requested bounds.');
    }

    const snapshots = await loadPublishedSnapshots(args, publishedRooms);
    report.snapshotQuery = snapshots.summary;
    for (const room of publishedRooms) {
      const snapshot = snapshots.byRoomId.get(room.id);
      if (!snapshot) {
        report.failures.push(`Published snapshot ${room.id} was missing from the batch response.`);
        continue;
      }
      const entry = entriesByAddress.get(addressKey({
        rendererVersion: args.rendererVersion,
        level: 4,
        x: room.coordinates.x,
        y: room.coordinates.y,
      }));
      const result = await verifyLeaf(page, args, room, snapshot, entry, tileBytes);
      report.leaves.push(result);
      if (!result.pass) report.failures.push(`L4 leaf ${room.id} failed pixel/object parity.`);
    }

    const parent = findParentCandidate(args.rendererVersion, currentPublishedRooms, entriesByAddress);
    if (!parent) {
      report.failures.push('No current L3 parent with four current L4 child states was available.');
    } else {
      report.parent = await verifyParent(page, args, parent, entriesByAddress, tileBytes);
      if (!report.parent.pass) report.failures.push(`Parent ${addressKey(parent.address)} failed composition parity.`);
    }
  } finally {
    await page.close();
    await browser.close();
  }
}

async function verifyLeaf(page, args, room, snapshot, entry, tileBytes) {
  const advertised = await fetchTileObject(entry, args, tileBytes);
  const rendered = await page.evaluate(async ({ expectedContract, roomSnapshot }) => {
    const renderer = window.__WORLD_TILE_RENDERER__;
    if (!renderer || renderer.contract !== expectedContract) {
      throw new Error(`Renderer contract mismatch: ${String(renderer?.contract)}.`);
    }
    return renderer.renderLeaf(roomSnapshot);
  }, { expectedContract: args.rendererContract, roomSnapshot: snapshot });
  const expectedBytes = dataUrlToBuffer(rendered.pngDataUrl);
  const comparison = await comparePngs(page, bufferToDataUrl(expectedBytes), bufferToDataUrl(advertised.bytes), {
    channelTolerance: args.channelTolerance,
    pixelToleranceRatio: args.pixelToleranceRatio,
  });
  const advertisedGutter = await inspectPng(page, bufferToDataUrl(advertised.bytes));
  const renderedGutter = await inspectPng(page, bufferToDataUrl(expectedBytes));
  const label = safeFilename(room.id);
  writeFileSync(path.join(args.out, `leaf-${label}-advertised.png`), advertised.bytes);
  writeFileSync(path.join(args.out, `leaf-${label}-rendered.png`), expectedBytes);
  const snapshotIdentityMatches = snapshot.id === room.id
    && snapshot.coordinates?.x === room.coordinates.x
    && snapshot.coordinates?.y === room.coordinates.y
    && snapshot.status === 'published'
    && Number(snapshot.version) === Number(room.version);
  return {
    roomId: room.id,
    coordinates: room.coordinates,
    version: room.version,
    snapshotIdentityMatches,
    advertised: advertised.summary,
    rendered: { byteLength: expectedBytes.length, dimensions: parsePngDimensions(expectedBytes) },
    comparison,
    gutters: { advertised: advertisedGutter, rendered: renderedGutter },
    pass: snapshotIdentityMatches
      && advertised.summary.pass
      && comparison.pass
      && advertisedGutter.pass
      && renderedGutter.pass,
  };
}

async function verifyParent(page, args, parent, entriesByAddress, tileBytes) {
  const parentEntry = entriesByAddress.get(addressKey(parent.address));
  const advertised = await fetchTileObject(parentEntry, args, tileBytes);
  const children = {};
  for (const child of parent.children) {
    const entry = entriesByAddress.get(addressKey(child.address));
    children[child.slot] = entry.ready
      ? bufferToDataUrl((await fetchTileObject(entry, args, tileBytes)).bytes)
      : null;
  }
  const composedDataUrl = await composeParentIndependently(page, children);
  const composedBytes = dataUrlToBuffer(composedDataUrl);
  const comparison = await comparePngs(page, composedDataUrl, bufferToDataUrl(advertised.bytes), {
    channelTolerance: args.channelTolerance,
    pixelToleranceRatio: args.pixelToleranceRatio,
  });
  const advertisedGutter = await inspectPng(page, bufferToDataUrl(advertised.bytes));
  const composedGutter = await inspectPng(page, composedDataUrl);
  const label = safeFilename(addressKey(parent.address));
  writeFileSync(path.join(args.out, `parent-${label}-advertised.png`), advertised.bytes);
  writeFileSync(path.join(args.out, `parent-${label}-composed.png`), composedBytes);
  return {
    address: parent.address,
    children: parent.children.map((child) => ({
      address: child.address,
      slot: child.slot,
      state: classifyManifestEntry(entriesByAddress.get(addressKey(child.address))),
    })),
    advertised: advertised.summary,
    composed: { byteLength: composedBytes.length, dimensions: parsePngDimensions(composedBytes) },
    comparison,
    gutters: { advertised: advertisedGutter, composed: composedGutter },
    pass: advertised.summary.pass
      && comparison.pass
      && advertisedGutter.pass
      && composedGutter.pass,
  };
}

function findParentCandidate(rendererVersion, rooms, entriesByAddress) {
  for (const room of rooms) {
    const address = {
      rendererVersion,
      level: 3,
      x: Math.floor(room.coordinates.x / 2),
      y: Math.floor(room.coordinates.y / 2),
    };
    const parentEntry = entriesByAddress.get(addressKey(address));
    if (!parentEntry || !classifyManifestEntry(parentEntry).readyObjectCurrent) continue;
    const children = [
      { slot: 'northWest', x: address.x * 2, y: address.y * 2 },
      { slot: 'northEast', x: address.x * 2 + 1, y: address.y * 2 },
      { slot: 'southWest', x: address.x * 2, y: address.y * 2 + 1 },
      { slot: 'southEast', x: address.x * 2 + 1, y: address.y * 2 + 1 },
    ].map((child) => ({
      slot: child.slot,
      address: { rendererVersion, level: 4, x: child.x, y: child.y },
    }));
    const allCurrent = children.every((child) => {
      const entry = entriesByAddress.get(addressKey(child.address));
      if (!entry) return false;
      const state = classifyManifestEntry(entry);
      return state.readyObjectCurrent || state.readyEmptyCurrent;
    });
    if (allCurrent) return { address, children };
  }
  return null;
}

async function loadPublishedSnapshots(args, rooms) {
  if (rooms.length === 0) return { byRoomId: new Map(), summary: null };
  const references = rooms.map((room) => ({
    kind: 'current_preview',
    roomId: room.id,
    state: 'published',
    coordinates: room.coordinates,
    ...(room.previewUpdatedAt ? { updatedAt: room.previewUpdatedAt } : {}),
  }));
  const result = await fetchJsonMeasured(`${args.apiBase}/api/rooms/snapshots/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ references, detail: 'full' }),
    signal: AbortSignal.timeout(args.timeoutMs),
  });
  if (!result.response.ok) {
    throw new Error(`Snapshot batch failed with ${result.response.status}: ${result.text.slice(0, 500)}`);
  }
  return {
    byRoomId: new Map((result.body.snapshots ?? []).map((entry) => [entry.reference.roomId, entry.snapshot])),
    summary: {
      ...responseSummary(result),
      requested: references.length,
      returned: result.body.snapshots?.length ?? 0,
      missing: result.body.missing ?? [],
    },
  };
}

async function verifyAdvertisedObjectHeads(entries, args, failures) {
  const results = await mapLimit(entries, 6, async (entry) => {
    const validation = validateObjectUrl(entry.ready, args.rendererVersion);
    if (!validation.pass) failures.push(...validation.errors.map((error) => `${addressKey(entry.address)}: ${error}`));
    const startedAt = performance.now();
    const response = await fetch(entry.ready.url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(args.timeoutMs),
    });
    const durationMs = roundMs(performance.now() - startedAt);
    const contentLength = numberHeader(response.headers.get('content-length'));
    const pass = validation.pass
      && response.ok
      && (contentLength === null || contentLength === entry.ready.byteLength)
      && response.headers.get('content-type')?.toLowerCase().includes('image/png') === true;
    if (!pass) failures.push(`Advertised object HEAD failed parity for ${addressKey(entry.address)}.`);
    return {
      address: entry.address,
      url: entry.ready.url,
      status: response.status,
      durationMs,
      contentLength,
      advertisedByteLength: entry.ready.byteLength,
      contentType: response.headers.get('content-type'),
      cacheStatus: response.headers.get('cf-cache-status'),
      pass,
    };
  });
  return {
    advertised: entries.length,
    passed: results.filter((entry) => entry.pass).length,
    failed: results.filter((entry) => !entry.pass).length,
    results,
  };
}

async function fetchTileObject(entry, args, cache) {
  if (cache.has(entry.ready.url)) return cache.get(entry.ready.url);
  const response = await fetch(entry.ready.url, { signal: AbortSignal.timeout(args.timeoutMs) });
  const bytes = Buffer.from(await response.arrayBuffer());
  const dimensions = parsePngDimensions(bytes);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const summary = {
    url: entry.ready.url,
    status: response.status,
    byteLength: bytes.length,
    advertisedByteLength: entry.ready.byteLength,
    dimensions,
    contentHash: hash,
    advertisedContentHash: entry.ready.contentHash,
    cacheStatus: response.headers.get('cf-cache-status'),
    pass: response.ok
      && bytes.length === entry.ready.byteLength
      && dimensions.width === PNG_WIDTH
      && dimensions.height === PNG_HEIGHT
      && hash === entry.ready.contentHash,
  };
  const value = { bytes, summary };
  cache.set(entry.ready.url, value);
  return value;
}

async function loadRendererPage(page, args) {
  await page.goto(`${args.rendererOrigin}/world-tile-render.html`, {
    waitUntil: 'networkidle',
    timeout: args.timeoutMs,
  });
  await page.waitForFunction(() => window.__WORLD_TILE_RENDERER_READY__ === true, null, {
    timeout: args.timeoutMs,
  });
  const identity = await page.evaluate(() => ({
    contract: window.__WORLD_TILE_RENDERER__?.contract ?? null,
    error: window.__WORLD_TILE_RENDERER_ERROR__ ?? null,
  }));
  if (identity.error || identity.contract !== args.rendererContract) {
    throw new Error(`Renderer page contract failed: ${JSON.stringify(identity)}.`);
  }
}

async function comparePngs(page, expected, actual, options) {
  return page.evaluate(async ({ expectedUrl, actualUrl, channelTolerance, pixelToleranceRatio }) => {
    const load = async (url) => {
      const image = new Image();
      image.decoding = 'sync';
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
    };
    const [left, right] = await Promise.all([load(expectedUrl), load(actualUrl)]);
    if (left.width !== right.width || left.height !== right.height) {
      return { pass: false, dimensionMismatch: true, expected: left, actual: right };
    }
    let differingPixels = 0;
    let maxChannelDelta = 0;
    for (let offset = 0; offset < left.pixels.length; offset += 4) {
      let differs = false;
      for (let channel = 0; channel < 4; channel += 1) {
        const delta = Math.abs(left.pixels[offset + channel] - right.pixels[offset + channel]);
        maxChannelDelta = Math.max(maxChannelDelta, delta);
        if (delta > channelTolerance) differs = true;
      }
      if (differs) differingPixels += 1;
    }
    const totalPixels = left.width * left.height;
    const differingRatio = differingPixels / totalPixels;
    return {
      pass: differingRatio <= pixelToleranceRatio,
      dimensionMismatch: false,
      width: left.width,
      height: left.height,
      totalPixels,
      differingPixels,
      differingRatio,
      maxChannelDelta,
      channelTolerance,
      pixelToleranceRatio,
    };
  }, {
    expectedUrl: expected,
    actualUrl: actual,
    channelTolerance: options.channelTolerance,
    pixelToleranceRatio: options.pixelToleranceRatio,
  });
}

async function inspectPng(page, dataUrl) {
  return page.evaluate(async ({ url, width, height, overlap }) => {
    const image = new Image();
    image.decoding = 'sync';
    image.src = url;
    await image.decode();
    if (image.naturalWidth !== width || image.naturalHeight !== height) {
      return { pass: false, dimensions: { width: image.naturalWidth, height: image.naturalHeight }, gutterMismatches: null };
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    const equal = (a, b) => {
      const left = (a.y * width + a.x) * 4;
      const right = (b.y * width + b.x) * 4;
      return pixels[left] === pixels[right]
        && pixels[left + 1] === pixels[right + 1]
        && pixels[left + 2] === pixels[right + 2]
        && pixels[left + 3] === pixels[right + 3];
    };
    let gutterMismatches = 0;
    for (let x = overlap; x < width - overlap; x += 1) {
      if (!equal({ x, y: 0 }, { x, y: overlap })) gutterMismatches += 1;
      if (!equal({ x, y: height - 1 }, { x, y: height - 1 - overlap })) gutterMismatches += 1;
    }
    for (let y = overlap; y < height - overlap; y += 1) {
      if (!equal({ x: 0, y }, { x: overlap, y })) gutterMismatches += 1;
      if (!equal({ x: width - 1, y }, { x: width - 1 - overlap, y })) gutterMismatches += 1;
    }
    const corners = [
      [{ x: 0, y: 0 }, { x: overlap, y: overlap }],
      [{ x: width - 1, y: 0 }, { x: width - 1 - overlap, y: overlap }],
      [{ x: 0, y: height - 1 }, { x: overlap, y: height - 1 - overlap }],
      [{ x: width - 1, y: height - 1 }, { x: width - 1 - overlap, y: height - 1 - overlap }],
    ];
    for (const [gutter, core] of corners) {
      if (!equal(gutter, core)) gutterMismatches += 1;
    }
    return {
      pass: gutterMismatches === 0,
      dimensions: { width, height },
      gutterMismatches,
    };
  }, { url: dataUrl, width: PNG_WIDTH, height: PNG_HEIGHT, overlap: OVERLAP });
}

async function composeParentIndependently(page, children) {
  return page.evaluate(async ({ sources, coreWidth, coreHeight, overlap }) => {
    const load = async (url) => {
      if (!url) return null;
      const image = new Image();
      image.decoding = 'sync';
      image.src = url;
      await image.decode();
      return image;
    };
    const images = Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([slot, url]) => [slot, await load(url)])));
    const source = document.createElement('canvas');
    source.width = coreWidth * 2;
    source.height = coreHeight * 2;
    const sourceContext = source.getContext('2d', { willReadFrequently: true });
    sourceContext.clearRect(0, 0, source.width, source.height);
    sourceContext.imageSmoothingEnabled = false;
    const destinations = {
      northWest: [0, 0],
      northEast: [coreWidth, 0],
      southWest: [0, coreHeight],
      southEast: [coreWidth, coreHeight],
    };
    for (const [slot, image] of Object.entries(images)) {
      if (!image) continue;
      const [x, y] = destinations[slot];
      sourceContext.drawImage(image, overlap, overlap, coreWidth, coreHeight, x, y, coreWidth, coreHeight);
    }
    const sourcePixels = sourceContext.getImageData(0, 0, source.width, source.height).data;
    const core = document.createElement('canvas');
    core.width = coreWidth;
    core.height = coreHeight;
    const context = core.getContext('2d');
    const output = context.createImageData(coreWidth, coreHeight);
    for (let outputY = 0; outputY < coreHeight; outputY += 1) {
      for (let outputX = 0; outputX < coreWidth; outputX += 1) {
        let alphaSum = 0;
        let redSum = 0;
        let greenSum = 0;
        let blueSum = 0;
        for (let offsetY = 0; offsetY < 2; offsetY += 1) {
          for (let offsetX = 0; offsetX < 2; offsetX += 1) {
            const sourceIndex = (
              (outputY * 2 + offsetY) * source.width
              + outputX * 2
              + offsetX
            ) * 4;
            const alpha = sourcePixels[sourceIndex + 3];
            alphaSum += alpha;
            redSum += sourcePixels[sourceIndex] * alpha;
            greenSum += sourcePixels[sourceIndex + 1] * alpha;
            blueSum += sourcePixels[sourceIndex + 2] * alpha;
          }
        }
        const outputIndex = (outputY * coreWidth + outputX) * 4;
        if (alphaSum > 0) {
          output.data[outputIndex] = Math.round(redSum / alphaSum);
          output.data[outputIndex + 1] = Math.round(greenSum / alphaSum);
          output.data[outputIndex + 2] = Math.round(blueSum / alphaSum);
        }
        output.data[outputIndex + 3] = Math.round(alphaSum / 4);
      }
    }
    context.putImageData(output, 0, 0);
    const guttered = document.createElement('canvas');
    guttered.width = coreWidth + overlap * 2;
    guttered.height = coreHeight + overlap * 2;
    const out = guttered.getContext('2d');
    out.clearRect(0, 0, guttered.width, guttered.height);
    out.imageSmoothingEnabled = false;
    out.drawImage(core, overlap, overlap);
    out.drawImage(core, 0, 0, coreWidth, 1, overlap, 0, coreWidth, 1);
    out.drawImage(core, 0, coreHeight - 1, coreWidth, 1, overlap, coreHeight + overlap, coreWidth, 1);
    out.drawImage(core, 0, 0, 1, coreHeight, 0, overlap, 1, coreHeight);
    out.drawImage(core, coreWidth - 1, 0, 1, coreHeight, coreWidth + overlap, overlap, 1, coreHeight);
    out.drawImage(core, 0, 0, 1, 1, 0, 0, 1, 1);
    out.drawImage(core, coreWidth - 1, 0, 1, 1, coreWidth + overlap, 0, 1, 1);
    out.drawImage(core, 0, coreHeight - 1, 1, 1, 0, coreHeight + overlap, 1, 1);
    out.drawImage(core, coreWidth - 1, coreHeight - 1, 1, 1, coreWidth + overlap, coreHeight + overlap, 1, 1);
    return guttered.toDataURL('image/png');
  }, { sources: children, coreWidth: CORE_WIDTH, coreHeight: CORE_HEIGHT, overlap: OVERLAP });
}

function summarizeEntries(entries) {
  const summary = { ready: [], empty: [], missing: [], stale: [], inconsistent: [] };
  for (const entry of entries) {
    const key = addressKey(entry.address);
    const state = classifyManifestEntry(entry);
    if (state.readyObjectCurrent) summary.ready.push(key);
    if (state.readyEmptyCurrent) summary.empty.push(key);
    if (state.missing) summary.missing.push(key);
    if (state.stale) summary.stale.push({ address: key, staleRoomIds: entry.staleRoomIds ?? [] });
    if (state.inconsistent) summary.inconsistent.push(key);
  }
  return summary;
}

function validateObjectUrl(ready, rendererVersion) {
  const errors = [];
  let url;
  try {
    url = new URL(ready.url);
  } catch {
    return { pass: false, errors: ['Object URL is invalid.'] };
  }
  if (url.protocol !== 'https:') errors.push('Object URL must use HTTPS.');
  if (!/^[a-f0-9]{64}$/.test(ready.contentHash)) errors.push('Content hash is not SHA-256 hex.');
  const expectedSuffix = `/world-tiles/${encodeURIComponent(rendererVersion)}/objects/${ready.contentHash}.png`;
  if (!url.pathname.endsWith(expectedSuffix)) errors.push(`Object URL does not end with ${expectedSuffix}.`);
  if (ready.width !== PNG_WIDTH || ready.height !== PNG_HEIGHT || ready.overlap !== OVERLAP) {
    errors.push('Manifest PNG geometry is not 642x354 with a one-pixel overlap.');
  }
  return { pass: errors.length === 0, errors };
}

async function fetchJsonMeasured(url, init) {
  const startedAt = performance.now();
  const response = await fetch(url, init);
  const bytes = Buffer.from(await response.arrayBuffer());
  const durationMs = roundMs(performance.now() - startedAt);
  const text = bytes.toString('utf8');
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${url} returned invalid JSON: ${text.slice(0, 500)}`);
  }
  return { response, body, text, durationMs, byteLength: bytes.length, url };
}

function responseSummary(result) {
  return {
    url: result.url,
    status: result.response.status,
    durationMs: result.durationMs,
    decodedBytes: result.byteLength,
    contentLength: numberHeader(result.response.headers.get('content-length')),
    etag: result.response.headers.get('etag'),
    cache: result.response.headers.get('x-wamp-cache'),
    cacheStatus: result.response.headers.get('cf-cache-status'),
    serverTiming: result.response.headers.get('server-timing'),
  };
}

export function buildManifestUrl(args, includeRooms = false) {
  const query = new URLSearchParams({
    level: '4',
    minTileX: String(args.bounds.minTileX),
    maxTileX: String(args.bounds.maxTileX),
    minTileY: String(args.bounds.minTileY),
    maxTileY: String(args.bounds.maxTileY),
    includeRooms: includeRooms ? '1' : '0',
  });
  return `${args.apiBase}/api/world/tiles/manifest?${query}`;
}

function parseBounds(value) {
  const values = value.split(',').map((part) => Number(part.trim()));
  if (values.length !== 4 || values.some((part) => !Number.isSafeInteger(part))) {
    throw new Error('--bounds must be minTileX,maxTileX,minTileY,maxTileY safe integers.');
  }
  const [minTileX, maxTileX, minTileY, maxTileY] = values;
  if (minTileX > maxTileX || minTileY > maxTileY) throw new Error('--bounds minimums must not exceed maximums.');
  if (maxTileX - minTileX + 1 > 16 || maxTileY - minTileY + 1 > 16) {
    throw new Error('--bounds must not exceed 16 by 16 tiles.');
  }
  return { minTileX, maxTileX, minTileY, maxTileY };
}

function normalizeHttpOrigin(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTP(S) origin.`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must be a valid HTTP(S) origin.`);
  }
  return url.toString().replace(/\/+$/, '');
}

function normalizeImmutableRendererOrigin(value) {
  const origin = normalizeHttpOrigin(value, '--renderer-origin');
  const url = new URL(origin);
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('--renderer-origin may not contain a path.');
  if (!IMMUTABLE_PAGES_ORIGIN.test(url.origin)) {
    throw new Error('--renderer-origin must be an immutable 8-hex-hash Pages deployment origin.');
  }
  return url.origin;
}

function parseInteger(value, label, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be a safe integer from ${minimum} through ${maximum}.`);
  }
  return parsed;
}

function parseNumber(value, label, minimum, maximum = Number.POSITIVE_INFINITY) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be a number from ${minimum} through ${maximum}.`);
  }
  return parsed;
}

function readArg(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1]?.trim() || null : null;
}

function addressKey(address) {
  return `${address.rendererVersion}:${address.level}:${address.x}:${address.y}`;
}

function safeFilename(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 160);
}

function bufferToDataUrl(bytes) {
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function dataUrlToBuffer(value) {
  const prefix = 'data:image/png;base64,';
  if (typeof value !== 'string' || !value.startsWith(prefix)) throw new Error('Renderer returned a non-PNG data URL.');
  return Buffer.from(value.slice(prefix.length), 'base64');
}

function numberHeader(value) {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMs(value) {
  return Math.round(value * 100) / 100;
}

async function mapLimit(values, concurrency, operation) {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(values[index], index);
    }
  }));
  return results;
}

async function main() {
  let args;
  try {
    args = parseWorldTileParityArgs(process.argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }
  mkdirSync(args.out, { recursive: true });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputs: {
      apiBase: args.apiBase,
      rendererOrigin: args.rendererOrigin,
      rendererVersion: args.rendererVersion,
      rendererContract: args.rendererContract,
      bounds: args.bounds,
      tolerances: {
        pixelRatio: args.pixelToleranceRatio,
        channel: args.channelTolerance,
      },
    },
    config: null,
    manifest: null,
    roomManifest: null,
    entries: null,
    objects: null,
    snapshotQuery: null,
    leaves: [],
    parent: null,
    failures: [],
  };
  try {
    await runProbe(args, report);
  } catch (error) {
    report.failures.push(error instanceof Error ? error.stack ?? error.message : String(error));
  }
  report.passed = report.failures.length === 0;
  report.finishedAt = new Date().toISOString();
  const outputPath = path.join(args.out, 'world-tile-parity-report.json');
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.passed ? 'PASS' : 'FAIL'}: wrote ${outputPath}`);
  if (!report.passed) {
    for (const failure of report.failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && existsSync(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) await main();
