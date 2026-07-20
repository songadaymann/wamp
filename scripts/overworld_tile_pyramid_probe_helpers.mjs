function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function probeError(message, diagnostics) {
  const error = new Error(message);
  error.diagnostics = diagnostics;
  return error;
}

const LOD_PROMOTION_THRESHOLDS = [0.108, 0.216, 0.432, 0.864];
const LOD_DEMOTION_THRESHOLDS = [Number.NEGATIVE_INFINITY, 0.092, 0.184, 0.368, 0.736];

export const DEFAULT_OVERWORLD_TILE_ACCEPTANCE_GATES = Object.freeze({
  coldCoarseReadyMs: 900,
  warmCoarseReadyMs: 300,
  coldSharpReadyMs: 1_500,
  warmSharpReadyMs: 500,
  coarseResponseBytes: 500_000,
  sharpResponseBytes: 1_500_000,
  manifestBytes: 50_000,
  manifestLatencyMs: 150,
  stableViewportTileRequests: 16,
  targetZoomTolerance: 0.006,
  warmByteCacheHitRatio: 0.95,
});

export function selectExpectedWorldTileLevel(zoom, currentLevel) {
  let nextLevel = currentLevel;
  while (nextLevel < 4 && zoom >= LOD_PROMOTION_THRESHOLDS[nextLevel]) {
    nextLevel += 1;
  }
  while (nextLevel > 0 && zoom <= LOD_DEMOTION_THRESHOLDS[nextLevel]) {
    nextLevel -= 1;
  }
  return nextLevel;
}

export function selectCreditableEarlySharpEvent(events, phaserStateOrCapture) {
  if (!Array.isArray(events) || !isRecord(phaserStateOrCapture)) return null;
  const phaserState = Number.isFinite(phaserStateOrCapture.durationMs)
    && isRecord(phaserStateOrCapture.state)
    ? phaserStateOrCapture.state
    : phaserStateOrCapture;
  const rendererVersion = phaserState.rollout?.rendererVersion;
  const targetLevel = phaserState.targetLevel;
  const coverageKey = phaserState.coverageKey;
  const coverageEpoch = phaserState.coverageEpoch;
  if (
    typeof rendererVersion !== 'string'
    || !Number.isSafeInteger(targetLevel)
    || typeof coverageKey !== 'string'
    || coverageKey.length === 0
    || !Number.isSafeInteger(coverageEpoch)
    || phaserState.readyCoverageEpoch !== coverageEpoch
  ) return null;

  return events.find((entry) => {
    const state = entry?.state;
    if (
      entry?.type !== 'early-bootstrap-sharp-ready'
      || entry.layerPresent !== true
      || entry.bodyVisible !== true
      || !isRecord(state)
      || state.status !== 'visible'
      || state.refinementError !== null
      || state.rendererVersion !== rendererVersion
      || state.targetLevel !== targetLevel
      || state.displayLevel !== targetLevel
      || state.coverageKey !== coverageKey
      || !isRecord(state.targetBounds)
      || !Number.isFinite(state.timings?.sharpVisibleAtMs)
    ) return false;
    return JSON.stringify([
      rendererVersion,
      targetLevel,
      state.targetBounds.minTileX,
      state.targetBounds.maxTileX,
      state.targetBounds.minTileY,
      state.targetBounds.maxTileY,
    ]) === coverageKey;
  }) ?? null;
}

export function hasWorldTileCoverageIdentityTransition(before, after) {
  const beforeCamera = before?.camera;
  const afterCamera = after?.camera;
  return isRecord(beforeCamera)
    && isRecord(afterCamera)
    && Number.isFinite(beforeCamera.x)
    && Number.isFinite(beforeCamera.y)
    && Number.isFinite(afterCamera.x)
    && Number.isFinite(afterCamera.y)
    && (beforeCamera.x !== afterCamera.x || beforeCamera.y !== afterCamera.y)
    && typeof before?.coverageKey === 'string'
    && before.coverageKey.length > 0
    && typeof after?.coverageKey === 'string'
    && after.coverageKey.length > 0
    && after.coverageKey !== before.coverageKey
    && Number.isSafeInteger(before.coverageEpoch)
    && Number.isSafeInteger(after.coverageEpoch)
    && after.coverageEpoch > before.coverageEpoch;
}

export function isSameZoomDirectionalPanStep(before, after, direction, zoomTolerance = 0.000_001) {
  if (direction !== 'forward' && direction !== 'reverse') return false;
  const beforeCamera = before?.camera;
  const afterCamera = after?.camera;
  const beforeZoom = before?.zoom;
  const afterZoom = after?.zoom;
  if (
    !isRecord(beforeCamera)
    || !isRecord(afterCamera)
    || !Number.isFinite(beforeCamera.x)
    || !Number.isFinite(afterCamera.x)
    || !Number.isFinite(beforeZoom)
    || !Number.isFinite(afterZoom)
    || !Number.isFinite(zoomTolerance)
    || zoomTolerance < 0
    || Math.abs(afterZoom - beforeZoom) > zoomTolerance
  ) return false;
  return direction === 'forward'
    ? afterCamera.x > beforeCamera.x
    : afterCamera.x < beforeCamera.x;
}

export function isCameraReversalTowardOrigin(origin, forward, reversal) {
  const originCamera = origin?.camera;
  const forwardCamera = forward?.camera;
  const reversalCamera = reversal?.camera;
  if (![originCamera, forwardCamera, reversalCamera].every(isRecord)) return false;
  const values = [
    originCamera.x,
    originCamera.y,
    forwardCamera.x,
    forwardCamera.y,
    reversalCamera.x,
    reversalCamera.y,
  ];
  if (!values.every(Number.isFinite)) return false;
  const forwardDistance = (forwardCamera.x - originCamera.x) ** 2
    + (forwardCamera.y - originCamera.y) ** 2;
  const reversalDistance = (reversalCamera.x - originCamera.x) ** 2
    + (reversalCamera.y - originCamera.y) ** 2;
  return forwardDistance > 0 && reversalDistance < forwardDistance;
}

export function isStableWorldTileReadyFrame(previous, current) {
  return typeof previous?.coverageKey === 'string'
    && previous.coverageKey.length > 0
    && current?.coverageKey === previous.coverageKey
    && Number.isSafeInteger(previous.coverageEpoch)
    && current?.coverageEpoch === previous.coverageEpoch
    && previous.readyCoverageEpoch === previous.coverageEpoch
    && current.readyCoverageEpoch === current.coverageEpoch
    && Number.isFinite(previous.coverageReadyAtMs)
    && Number.isFinite(current.coverageReadyAtMs)
    && previous.targetLevel === previous.committedLevel
    && current.targetLevel === current.committedLevel
    && current.targetLevel === previous.targetLevel
    && previous.fallbackReason === null
    && current.fallbackReason === null;
}

export function isWorldTileImageUrl(url) {
  return /\/world-tiles\/.*\.png(?:\?|$)/.test(url);
}

export function normalizeWorldTileUrl(value) {
  try {
    const url = new URL(value);
    url.searchParams.delete('__wamp_tile_hash');
    return url.toString();
  } catch {
    return String(value);
  }
}

export function getManifestLevel(url) {
  if (!url.includes('/api/world/tiles/manifest')) return null;
  try {
    const raw = new URL(url).searchParams.get('level');
    if (raw === null || raw.trim() === '') return 'invalid';
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 && value <= 4 ? value : 'invalid';
  } catch {
    return 'invalid';
  }
}

function parseSnapshotReference(reference, index) {
  if (!isRecord(reference)) {
    return {
      index,
      kind: 'invalid',
      roomId: null,
      state: null,
      version: null,
      updatedAt: null,
      coordinates: null,
      valid: false,
    };
  }
  const kind = typeof reference.kind === 'string' ? reference.kind : 'invalid';
  const roomId = typeof reference.roomId === 'string' ? reference.roomId : null;
  const state = typeof reference.state === 'string' ? reference.state : null;
  const version = Number.isSafeInteger(reference.version) ? reference.version : null;
  const updatedAt = typeof reference.updatedAt === 'string' ? reference.updatedAt : null;
  const coordinates = isRecord(reference.coordinates)
    && Number.isSafeInteger(reference.coordinates.x)
    && Number.isSafeInteger(reference.coordinates.y)
    ? { x: reference.coordinates.x, y: reference.coordinates.y }
    : null;
  const valid = Boolean(roomId) && (
    (kind === 'version' && version !== null)
    || (kind === 'current_preview' && (
      state === null || state === 'published' || state === 'claimed_unpublished'
    ))
  );
  return {
    index,
    kind,
    roomId,
    state,
    version,
    updatedAt,
    coordinates,
    valid,
  };
}

export function parseSnapshotQuery(postData) {
  if (typeof postData !== 'string' || postData.length === 0) {
    return {
      parseError: 'missing-body',
      detail: null,
      referenceCount: 0,
      referenceKinds: [],
      referenceClasses: [],
      references: [],
    };
  }
  let body;
  try {
    body = JSON.parse(postData);
  } catch {
    return {
      parseError: 'invalid-json',
      detail: null,
      referenceCount: 0,
      referenceKinds: [],
      referenceClasses: [],
      references: [],
    };
  }
  if (!isRecord(body) || !Array.isArray(body.references)) {
    return {
      parseError: 'references-not-array',
      detail: isRecord(body) && typeof body.detail === 'string' ? body.detail : null,
      referenceCount: 0,
      referenceKinds: [],
      referenceClasses: [],
      references: [],
    };
  }
  const references = body.references.map(parseSnapshotReference);
  const referenceKinds = references.map((reference) => reference.kind);
  const referenceClasses = references.map((reference) => (
    reference.kind === 'current_preview'
      ? `${reference.kind}:${reference.state ?? 'unspecified'}`
      : reference.kind
  ));
  const invalidReferenceCount = references.filter((reference) => !reference.valid).length;
  return {
    parseError: invalidReferenceCount > 0 ? `invalid-references:${invalidReferenceCount}` : null,
    detail: typeof body.detail === 'string' ? body.detail : null,
    referenceCount: references.length,
    referenceKinds,
    referenceClasses,
    references,
  };
}

export function parseWorldTileManifestProbe(body) {
  const invalid = (parseError, level = null) => ({
    parseError,
    level,
    readyNonEmptyUrls: [],
    targetAddresses: [],
  });
  if (!isRecord(body)) return invalid('manifest-not-object');
  if (!Number.isSafeInteger(body.level) || body.level < 0 || body.level > 4) {
    return invalid('invalid-manifest-level');
  }
  if (!Array.isArray(body.entries)) return invalid('manifest-entries-not-array', body.level);
  const readyNonEmptyUrls = [];
  const targetAddresses = [];
  const seenAddresses = new Set();
  for (const entry of body.entries) {
    if (
      !isRecord(entry)
      || !isRecord(entry.address)
      || !Number.isSafeInteger(entry.address.level)
      || entry.address.level < 0
      || entry.address.level > 4
      || !Number.isSafeInteger(entry.address.x)
      || !Number.isSafeInteger(entry.address.y)
    ) {
      return invalid('invalid-manifest-entry', body.level);
    }
    const addressKey = `${entry.address.level}:${entry.address.x},${entry.address.y}`;
    if (seenAddresses.has(addressKey)) return invalid('duplicate-manifest-entry', body.level);
    seenAddresses.add(addressKey);
    if (entry.address.level === body.level) {
      targetAddresses.push(`${entry.address.x},${entry.address.y}`);
    }
    if (entry.address.level !== 0 || entry.ready === null) continue;
    if (!isRecord(entry.ready) || typeof entry.ready.url !== 'string') {
      return invalid('invalid-ready-tile', body.level);
    }
    try {
      readyNonEmptyUrls.push(normalizeWorldTileUrl(new URL(entry.ready.url).toString()));
    } catch {
      return invalid('invalid-ready-url', body.level);
    }
  }
  return {
    parseError: null,
    level: body.level,
    readyNonEmptyUrls: [...new Set(readyNonEmptyUrls)].sort(),
    targetAddresses: targetAddresses.sort(),
  };
}

function countValues(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function getResponseByteLength(entry) {
  if (entry.status === 304) return 0;
  return getResponsePayloadByteLength(entry);
}

function getResponsePayloadByteLength(entry) {
  if (Number.isSafeInteger(entry.responseBodyBytes) && entry.responseBodyBytes >= 0) {
    return entry.responseBodyBytes;
  }
  return Number.isFinite(entry.contentLength) && entry.contentLength >= 0
    ? entry.contentLength
    : 0;
}

function getRequestDurationMs(entry) {
  return Number.isFinite(entry.startedAtMs) && Number.isFinite(entry.finishedAtMs)
    ? Math.max(0, entry.finishedAtMs - entry.startedAtMs)
    : null;
}

function nearestRankPercentile(values, quantile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index];
}

export function summarizeTrackedNetwork(requests) {
  const tileRequests = requests.filter((entry) => isWorldTileImageUrl(entry.url));
  const worldTileRequests = requests.filter((entry) => (
    isWorldTileImageUrl(entry.url) || entry.url.includes('/api/world/tiles/')
  ));
  const manifestRequests = requests.filter((entry) => entry.manifestLevel !== null);
  const snapshotQueries = requests.filter((entry) => entry.url.includes('/api/rooms/snapshots/query'));
  const parsedSnapshotQueries = snapshotQueries.filter((entry) => entry.snapshotQuery !== null);
  const manifestDurations = manifestRequests
    .map(getRequestDurationMs)
    .filter((duration) => duration !== null);
  const snapshotReferenceKinds = parsedSnapshotQueries.flatMap(
    (entry) => entry.snapshotQuery.referenceKinds,
  );
  const snapshotReferenceClasses = parsedSnapshotQueries.flatMap(
    (entry) => entry.snapshotQuery.referenceClasses,
  );
  return {
    requestCount: requests.length,
    tileRequestCount: tileRequests.length,
    tileResponseCount: tileRequests.filter((entry) => entry.status !== null).length,
    tileFinishedCount: tileRequests.filter((entry) => entry.finishedSeq !== null).length,
    tileRequestBytes: tileRequests.reduce((sum, entry) => sum + entry.contentLength, 0),
    tileResponseBytes: tileRequests.reduce((sum, entry) => sum + getResponseByteLength(entry), 0),
    worldTileResponseBytes: worldTileRequests.reduce(
      (sum, entry) => sum + getResponseByteLength(entry),
      0,
    ),
    worldTileMissingResponseBodyCount: worldTileRequests.filter((entry) => (
      entry.finishedSeq !== null
      && entry.status !== 204
      && entry.status !== 304
      && !Number.isSafeInteger(entry.responseBodyBytes)
    )).length,
    manifestRequestCount: manifestRequests.length,
    manifestMaxResponseBytes: Math.max(0, ...manifestRequests.map(getResponsePayloadByteLength)),
    manifestDurationCount: manifestDurations.length,
    manifestP95DurationMs: nearestRankPercentile(manifestDurations, 0.95),
    manifestMaxDurationMs: Math.max(0, ...manifestDurations),
    manifestMissingDurationCount: manifestRequests.length - manifestDurations.length,
    manifestLevels: manifestRequests.map((entry) => entry.manifestLevel),
    manifestLevelCounts: countValues(manifestRequests.map((entry) => String(entry.manifestLevel))),
    snapshotQueryCount: snapshotQueries.length,
    snapshotQueryPostCount: snapshotQueries.filter((entry) => entry.method === 'POST').length,
    snapshotParseErrorCount: parsedSnapshotQueries.filter(
      (entry) => entry.snapshotQuery.parseError !== null,
    ).length,
    snapshotParseErrors: countValues(parsedSnapshotQueries
      .map((entry) => entry.snapshotQuery.parseError)
      .filter((value) => value !== null)),
    snapshotReferenceKindCounts: countValues(snapshotReferenceKinds),
    snapshotReferenceClassCounts: countValues(snapshotReferenceClasses),
    snapshotReferenceCount: parsedSnapshotQueries.reduce(
      (sum, entry) => sum + entry.snapshotQuery.referenceCount,
      0,
    ),
    compactWorldSummaryRequestCount: requests.filter((entry) => (
      entry.url.includes('/api/world/chunks/summary')
    )).length,
    legacyWorldChunkRequestCount: requests.filter((entry) => (
      entry.url.includes('/api/world/chunks') && !entry.url.includes('/api/world/chunks/summary')
    )).length,
    announcedBytes: requests.reduce((sum, entry) => sum + entry.contentLength, 0),
    responseBytes: requests.reduce((sum, entry) => sum + getResponseByteLength(entry), 0),
    missingResponseBodyCount: requests.filter((entry) => (
      entry.finishedSeq !== null
      && entry.status !== 204
      && entry.status !== 304
      && !Number.isSafeInteger(entry.responseBodyBytes)
    )).length,
    immutableCacheHits: requests.filter((entry) => entry.cacheStatus === 'HIT').length,
  };
}

export function summarizeTileImagePhase(requests) {
  const summary = summarizeTrackedNetwork(requests);
  return {
    requestCount: summary.tileRequestCount,
    responseCount: summary.tileResponseCount,
    finishedCount: summary.tileFinishedCount,
    announcedBytes: summary.tileRequestBytes,
    responseBytes: summary.tileResponseBytes,
  };
}

export function partitionTrackedRequestsByCoverageBoundaries(requests, {
  coarseCoverageSequence,
  sharpCoverageSequence,
}) {
  if (!Number.isInteger(coarseCoverageSequence) || !Number.isInteger(sharpCoverageSequence)) {
    throw new TypeError('Coverage boundaries must be integer recorder sequences.');
  }
  if (coarseCoverageSequence > sharpCoverageSequence) {
    throw new RangeError('Coarse coverage cannot occur after sharp coverage.');
  }

  const throughSharp = requests.filter((entry) => (
    Number.isInteger(entry.startedSeq) && entry.startedSeq <= sharpCoverageSequence
  ));
  return {
    coarse: throughSharp.filter((entry) => entry.startedSeq <= coarseCoverageSequence),
    refinement: throughSharp.filter((entry) => entry.startedSeq > coarseCoverageSequence),
    throughSharp,
  };
}

export function summarizeApiWorkerRequests(requests) {
  const events = [];
  const origins = new Set();
  const requestsByOrigin = {};
  for (const entry of requests) {
    if (!Number.isInteger(entry.startedSeq)) continue;
    events.push({ sequence: entry.startedSeq, delta: 1 });
    const endedSeq = Number.isInteger(entry.finishedSeq)
      ? entry.finishedSeq
      : Number.isInteger(entry.failedSeq)
        ? entry.failedSeq
        : null;
    if (endedSeq !== null) events.push({ sequence: endedSeq, delta: -1 });
    if (typeof entry.origin === 'string' && entry.origin.length > 0) {
      origins.add(entry.origin);
      requestsByOrigin[entry.origin] = (requestsByOrigin[entry.origin] ?? 0) + 1;
    }
  }
  events.sort((left, right) => left.sequence - right.sequence || left.delta - right.delta);
  let inFlight = 0;
  let peakInFlight = 0;
  for (const event of events) {
    inFlight += event.delta;
    peakInFlight = Math.max(peakInFlight, inFlight);
  }
  return {
    requestCount: requests.length,
    peakInFlight,
    unfinishedCount: requests.filter((entry) => (
      !Number.isInteger(entry.finishedSeq) && !Number.isInteger(entry.failedSeq)
    )).length,
    failedCount: requests.filter((entry) => Number.isInteger(entry.failedSeq)).length,
    origins: [...origins].sort(),
    requestsByOrigin: Object.fromEntries(Object.entries(requestsByOrigin).sort()),
  };
}

export function summarizeClientTileCacheEvents(events) {
  const hits = events.filter((entry) => entry.type === 'byte-cache-hit').length;
  const misses = events.filter((entry) => entry.type === 'byte-cache-miss').length;
  const lookups = hits + misses;
  return {
    hits,
    misses,
    lookups,
    hitRatio: lookups > 0 ? hits / lookups : null,
  };
}

function isSuccessfulTileResponse(entry) {
  return isWorldTileImageUrl(entry?.url ?? '')
    && Number.isInteger(entry?.finishedSeq)
    && !Number.isInteger(entry?.failedSeq)
    && Number.isInteger(entry?.status)
    && entry.status >= 200
    && entry.status < 300;
}

/**
 * Measures the immutable-byte-cache contract against identities the cold pass
 * actually acquired. Directional guards can legitimately choose additional
 * tiles on the warm pass, and an aborted cold request never produced bytes to
 * persist; neither belongs in the revisit denominator.
 */
export function summarizeWarmRevisitTileCacheEvents(coldNetwork, warmEvents) {
  const coldTileRequests = (Array.isArray(coldNetwork) ? coldNetwork : [])
    .filter((entry) => isWorldTileImageUrl(entry?.url ?? ''));
  const coldAttemptedIdentities = new Set(coldTileRequests
    .map((entry) => normalizeWorldTileUrl(entry.url)));
  const coldCompletedIdentities = new Set(coldTileRequests
    .filter(isSuccessfulTileResponse)
    .map((entry) => normalizeWorldTileUrl(entry.url)));
  const firstWarmLookupByIdentity = new Map();
  const warmOnlyIdentities = new Set();
  const coldIncompleteWarmIdentities = new Set();

  for (const entry of Array.isArray(warmEvents) ? warmEvents : []) {
    if (entry?.type !== 'byte-cache-hit' && entry?.type !== 'byte-cache-miss') continue;
    if (typeof entry.url !== 'string' || !isWorldTileImageUrl(entry.url)) continue;
    const identity = normalizeWorldTileUrl(entry.url);
    if (!coldCompletedIdentities.has(identity)) {
      if (coldAttemptedIdentities.has(identity)) coldIncompleteWarmIdentities.add(identity);
      else warmOnlyIdentities.add(identity);
      continue;
    }
    if (!firstWarmLookupByIdentity.has(identity)) {
      firstWarmLookupByIdentity.set(identity, entry.type);
    }
  }

  const lookupTypes = [...firstWarmLookupByIdentity.values()];
  const hits = lookupTypes.filter((type) => type === 'byte-cache-hit').length;
  const misses = lookupTypes.filter((type) => type === 'byte-cache-miss').length;
  const lookups = hits + misses;
  return {
    hits,
    misses,
    lookups,
    hitRatio: lookups > 0 ? hits / lookups : null,
    coldCompletedIdentities: coldCompletedIdentities.size,
    warmOnlyIdentities: warmOnlyIdentities.size,
    coldIncompleteWarmIdentities: coldIncompleteWarmIdentities.size,
  };
}

function addGateFailure(failures, code, pass, actual, expected, message) {
  failures.push({ code, pass, actual, expected, message });
}

function checkFiniteCeiling(failures, code, pass, actual, expected, message) {
  if (!Number.isFinite(actual) || actual > expected) {
    addGateFailure(failures, code, pass, actual ?? null, expected, message);
  }
}

function checkPassNetworkAcceptance(label, pass, gates, failures) {
  const coarseSummary = pass?.coarseNetwork?.summary;
  const sharpSummary = pass?.sharpNetwork?.summary;
  checkFiniteCeiling(
    failures,
    'coarse-response-bytes',
    label,
    coarseSummary?.responseBytes,
    gates.coarseResponseBytes,
    'Total tracked response bytes through coarse coverage exceeded the budget.',
  );
  checkFiniteCeiling(
    failures,
    'sharp-response-bytes',
    label,
    sharpSummary?.responseBytes,
    gates.sharpResponseBytes,
    'Total tracked response bytes through target-LOD readiness exceeded the budget.',
  );
  checkFiniteCeiling(
    failures,
    'manifest-response-bytes',
    label,
    sharpSummary?.manifestMaxResponseBytes,
    gates.manifestBytes,
    'An initial stable-view manifest exceeded the response-size gate.',
  );
  checkFiniteCeiling(
    failures,
    'manifest-latency',
    label,
    sharpSummary?.manifestP95DurationMs,
    gates.manifestLatencyMs,
    'Initial stable-view manifest p95 exceeded the latency gate.',
  );
  checkFiniteCeiling(
    failures,
    'stable-viewport-tile-requests',
    label,
    pass?.refinementNetwork?.summary?.tileRequestCount,
    gates.stableViewportTileRequests,
    'Target refinement requested too many tile images after proven coarse coverage.',
  );
  if (coarseSummary?.missingResponseBodyCount !== 0 || sharpSummary?.missingResponseBodyCount !== 0) {
    addGateFailure(
      failures,
      'response-byte-measurement',
      label,
      {
        coarseMissing: coarseSummary?.missingResponseBodyCount ?? null,
        sharpMissing: sharpSummary?.missingResponseBodyCount ?? null,
      },
      { coarseMissing: 0, sharpMissing: 0 },
      'A completed stable-view response had no exact body-byte measurement.',
    );
  }
  if (sharpSummary?.manifestMissingDurationCount !== 0) {
    addGateFailure(
      failures,
      'manifest-latency-measurement',
      label,
      sharpSummary?.manifestMissingDurationCount ?? null,
      0,
      'An initial stable-view manifest had no completed duration measurement.',
    );
  }

  const networkSummary = pass?.networkSummary;
  if (networkSummary?.legacyWorldChunkRequestCount !== 0) {
    addGateFailure(
      failures,
      'legacy-world-chunks',
      label,
      networkSummary?.legacyWorldChunkRequestCount ?? null,
      0,
      'Tiled browse issued legacy world-chunk requests.',
    );
  }

  const snapshotRequests = Array.isArray(pass?.network)
    ? pass.network.filter((entry) => entry.url.includes('/api/rooms/snapshots/query'))
    : [];
  for (const [requestIndex, entry] of snapshotRequests.entries()) {
    if (entry.method !== 'POST' || !entry.snapshotQuery || entry.snapshotQuery.parseError !== null) {
      addGateFailure(
        failures,
        'malformed-snapshot-query',
        label,
        {
          requestIndex,
          method: entry.method ?? null,
          parseError: entry.snapshotQuery?.parseError ?? 'missing-probe-data',
        },
        'valid POST payload',
        'A room snapshot query could not be validated.',
      );
      continue;
    }
    const publishedReferences = entry.snapshotQuery.references.filter((reference) => (
      reference.kind === 'current_preview' && reference.state !== 'claimed_unpublished'
    ));
    if (publishedReferences.length > 0) {
      addGateFailure(
        failures,
        'published-browse-snapshot-reference',
        label,
        publishedReferences,
        [],
        'Tiled browse requested mutable previews that may resolve to unchanged published rooms.',
      );
    }
  }
}

function checkPassZoomAcceptance(label, pass, zoomTargets, gates, failures) {
  const zooms = Array.isArray(pass?.zooms) ? pass.zooms : [];
  if (zooms.length !== zoomTargets.length) {
    addGateFailure(
      failures,
      'zoom-scenario-count',
      label,
      zooms.length,
      zoomTargets.length,
      'The probe did not complete every requested zoom scenario.',
    );
  }
  const initialSharpState = pass?.sharp?.state;
  const initialZoom = Number(initialSharpState?.zoom);
  const expectedInitialLevel = Number.isFinite(initialZoom)
    ? selectExpectedWorldTileLevel(initialZoom, 0)
    : null;
  const initialLod = {
    zoom: Number.isFinite(initialZoom) ? initialZoom : null,
    targetLevel: initialSharpState?.targetLevel ?? null,
    committedLevel: initialSharpState?.committedLevel ?? null,
  };
  if (
    expectedInitialLevel === null
    || initialLod.targetLevel !== expectedInitialLevel
    || initialLod.committedLevel !== expectedInitialLevel
  ) {
    addGateFailure(
      failures,
      'initial-lod',
      label,
      initialLod,
      expectedInitialLevel,
      'The initial target and committed LOD do not match the canonical zoom band.',
    );
    return;
  }
  let expectedLevel = expectedInitialLevel;

  for (let index = 0; index < zoomTargets.length; index += 1) {
    const targetZoom = zoomTargets[index];
    const entry = zooms[index];
    if (!entry) continue;
    if (entry.targetZoom !== targetZoom) {
      addGateFailure(
        failures,
        'zoom-scenario-order',
        label,
        entry.targetZoom ?? null,
        targetZoom,
        'Zoom scenarios were not recorded in the requested order.',
      );
    }
    const actualZoom = Number(entry.finalState?.zoom);
    if (
      !Number.isFinite(actualZoom)
      || Math.abs(actualZoom - targetZoom) > gates.targetZoomTolerance + 1e-9
    ) {
      addGateFailure(
        failures,
        'target-zoom-not-reached',
        label,
        actualZoom,
        { targetZoom, tolerance: gates.targetZoomTolerance },
        'The wheel gesture did not reach its labeled target zoom.',
      );
    }

    expectedLevel = selectExpectedWorldTileLevel(targetZoom, expectedLevel);
    const readyState = entry.targetReady?.state;
    const actualLod = {
      reportedExpectedLevel: entry.expectedLevel ?? null,
      targetLevel: readyState?.targetLevel ?? null,
      committedLevel: readyState?.committedLevel ?? null,
    };
    if (
      actualLod.reportedExpectedLevel !== expectedLevel
      || actualLod.targetLevel !== expectedLevel
      || actualLod.committedLevel !== expectedLevel
    ) {
      addGateFailure(
        failures,
        'lod-hysteresis',
        label,
        actualLod,
        expectedLevel,
        'The committed LOD did not follow the promotion/demotion hysteresis contract.',
      );
    }
  }
}

function checkReplacementGaps(label, pass, failures) {
  const replacementGapFrames = pass?.pan?.after?.replacementGapFrames;
  if (replacementGapFrames !== 0) {
    addGateFailure(
      failures,
      'replacement-gap-frames',
      label,
      replacementGapFrames ?? null,
      0,
      'Published imagery disappeared after initial coverage.',
    );
  }
}

export function evaluateOverworldTileProbeAcceptance(result, gateOverrides = {}) {
  const gates = { ...DEFAULT_OVERWORLD_TILE_ACCEPTANCE_GATES, ...gateOverrides };
  const failures = [];
  checkFiniteCeiling(
    failures,
    'cold-coarse-ready',
    'cold',
    result?.cold?.coarseReadyMs,
    gates.coldCoarseReadyMs,
    'Cold coarse coverage missed its latency gate.',
  );
  checkFiniteCeiling(
    failures,
    'warm-coarse-ready',
    'warm',
    result?.warm?.coarseReadyMs,
    gates.warmCoarseReadyMs,
    'Warm coarse coverage missed its latency gate.',
  );
  checkFiniteCeiling(
    failures,
    'cold-sharp-ready',
    'cold',
    result?.cold?.sharpReadyMs,
    gates.coldSharpReadyMs,
    'Cold target-LOD readiness missed its latency gate.',
  );
  checkFiniteCeiling(
    failures,
    'warm-sharp-ready',
    'warm',
    result?.warm?.sharpReadyMs,
    gates.warmSharpReadyMs,
    'Warm target-LOD readiness missed its latency gate.',
  );

  const zoomTargets = Array.isArray(result?.zoomTargets) ? result.zoomTargets : [];
  for (const label of ['cold', 'warm']) {
    const pass = result?.[label];
    checkPassNetworkAcceptance(label, pass, gates, failures);
    checkPassZoomAcceptance(label, pass, zoomTargets, gates, failures);
    checkReplacementGaps(label, pass, failures);
  }

  const warmCache = summarizeWarmRevisitTileCacheEvents(
    result?.cold?.network ?? [],
    result?.warm?.clientProbeEvents ?? [],
  );
  if (warmCache.hitRatio === null || warmCache.hitRatio < gates.warmByteCacheHitRatio) {
    addGateFailure(
      failures,
      'warm-byte-cache-hit-ratio',
      'warm',
      warmCache,
      gates.warmByteCacheHitRatio,
      'Warm immutable tile-byte cache hits were below the required ratio.',
    );
  }

  return {
    passed: failures.length === 0,
    gates,
    warmCache,
    failures,
  };
}

function isSuccessfulFinishedRequest(entry, beforeSequence) {
  return entry.finishedSeq !== null
    && entry.finishedSeq < beforeSequence
    && entry.failedSeq === null
    && Number.isInteger(entry.status)
    && entry.status >= 200
    && entry.status < 300;
}

function parseManifestRequestBounds(url) {
  try {
    const parsed = new URL(url);
    const names = ['minTileX', 'maxTileX', 'minTileY', 'maxTileY'];
    const values = Object.fromEntries(names.map((name) => {
      const raw = parsed.searchParams.get(name);
      if (raw === null || raw.trim() === '') throw new Error(`missing-${name}`);
      const value = Number(raw);
      if (!Number.isSafeInteger(value)) throw new Error(`invalid-${name}`);
      return [name, value];
    }));
    if (values.minTileX > values.maxTileX || values.minTileY > values.maxTileY) {
      throw new Error('unordered-bounds');
    }
    const width = values.maxTileX - values.minTileX + 1;
    const height = values.maxTileY - values.minTileY + 1;
    if (width > 16 || height > 16) throw new Error('oversized-bounds');
    return {
      parseError: null,
      minTileX: values.minTileX,
      maxTileX: values.maxTileX,
      minTileY: values.minTileY,
      maxTileY: values.maxTileY,
      width,
      height,
    };
  } catch (error) {
    return {
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeBounds(value) {
  if (!isRecord(value)) return null;
  const bounds = {
    minTileX: value.minTileX,
    maxTileX: value.maxTileX,
    minTileY: value.minTileY,
    maxTileY: value.maxTileY,
  };
  if (
    !Object.values(bounds).every(Number.isSafeInteger)
    || bounds.minTileX > bounds.maxTileX
    || bounds.minTileY > bounds.maxTileY
  ) return null;
  return bounds;
}

function sameBounds(left, right) {
  return left !== null
    && right !== null
    && left.minTileX === right.minTileX
    && left.maxTileX === right.maxTileX
    && left.minTileY === right.minTileY
    && left.maxTileY === right.maxTileY;
}

function addressesForBounds(bounds) {
  const addresses = [];
  for (let y = bounds.minTileY; y <= bounds.maxTileY; y += 1) {
    for (let x = bounds.minTileX; x <= bounds.maxTileX; x += 1) {
      addresses.push(`${x},${y}`);
    }
  }
  return addresses.sort();
}

export function evaluateSerializedL0Bootstrap({
  requests,
  clientEvents,
  initialCoverageBoundary,
  orphanEvents = [],
}) {
  if (orphanEvents.length > 0) {
    throw probeError('Network recorder observed lifecycle events without their exact Request.', {
      orphanEvents,
    });
  }
  const manifests = requests
    .filter((entry) => entry.manifestLevel !== null)
    .sort((left, right) => left.startedSeq - right.startedSeq);
  if (manifests[0]?.manifestLevel !== 0) {
    throw probeError('The earliest tile coverage manifest must be a valid L0 request.', {
      manifests: manifests.map((entry) => ({
        level: entry.manifestLevel,
        startedSeq: entry.startedSeq,
        url: entry.url,
      })),
    });
  }

  const clientManifests = clientEvents
    .filter((entry) => entry.type === 'manifest-request')
    .sort((left, right) => left.sequence - right.sequence);
  if (clientManifests[0]?.level !== 0) {
    throw probeError('Client instrumentation did not observe an initial L0 manifest.', {
      clientManifests,
    });
  }

  const networkLevels = manifests.map((entry) => entry.manifestLevel);
  const clientLevels = clientManifests.map((entry) => entry.level);
  const comparableLevelCount = Math.min(networkLevels.length, clientLevels.length);
  const commonNetworkLevels = networkLevels.slice(0, comparableLevelCount);
  const commonClientLevels = clientLevels.slice(0, comparableLevelCount);
  if (
    comparableLevelCount === 0
    || JSON.stringify(commonNetworkLevels) !== JSON.stringify(commonClientLevels)
  ) {
    throw probeError('Client and network instrumentation disagree about manifest order.', {
      networkLevels,
      clientLevels,
      comparableLevelCount,
    });
  }

  const earlyReadyEvents = clientEvents
    .filter((entry) => entry.type === 'early-bootstrap-ready')
    .sort((left, right) => left.sequence - right.sequence);
  if (earlyReadyEvents.length !== 1) {
    throw probeError('The pre-Phaser L0 bootstrap did not emit exactly one ready event.', {
      earlyReadyEvents,
    });
  }
  const earlyReady = earlyReadyEvents[0];
  const manifestsBeforeEarlyReady = clientManifests.filter(
    (entry) => entry.sequence < earlyReady.sequence,
  );
  if (manifestsBeforeEarlyReady.length !== 1 || manifestsBeforeEarlyReady[0].level !== 0) {
    throw probeError('A later client manifest began before pre-Phaser L0 coverage was ready.', {
      earlyReady,
      manifestsBeforeEarlyReady,
    });
  }

  const earlyState = isRecord(earlyReady.state) ? earlyReady.state : null;
  const visibleAtMs = earlyState?.timings?.visibleAtMs;
  if (
    earlyState?.schemaVersion !== 1
    || earlyState.status !== 'visible'
    || earlyState.decision?.enabled !== true
    || earlyState.decision?.shadow === true
    || earlyReady.layerPresent !== true
    || earlyReady.bodyVisible !== true
    || !Number.isFinite(visibleAtMs)
    || visibleAtMs < 0
  ) {
    throw probeError('The pre-Phaser bootstrap ready event did not prove visible L0 coverage.', {
      earlyReady,
    });
  }

  const l0Manifest = manifests[0];
  const firstMainManifest = manifests[1] ?? null;
  const firstClientMainManifest = clientManifests.find(
    (entry) => entry.sequence > earlyReady.sequence,
  ) ?? null;
  if (Boolean(firstMainManifest) !== Boolean(firstClientMainManifest)) {
    throw probeError('Client and network instrumentation disagree about the main tile client.', {
      firstMainManifest,
      firstClientMainManifest,
    });
  }
  const coarseCoverageBoundarySequence = initialCoverageBoundary?.networkSequence;
  const mainClientBoundarySequence = firstMainManifest?.startedSeq
    ?? coarseCoverageBoundarySequence;
  const clientBoundarySequence = earlyReady.sequence;
  if (
    !Number.isInteger(coarseCoverageBoundarySequence)
    || !Number.isInteger(mainClientBoundarySequence)
    || !Number.isInteger(clientBoundarySequence)
  ) {
    throw probeError('Pre-Phaser coverage boundaries are unavailable.', {
      initialCoverageBoundary,
      firstMainManifest,
      earlyReady,
    });
  }

  if (!isSuccessfulFinishedRequest(l0Manifest, mainClientBoundarySequence)) {
    throw probeError('The pre-Phaser L0 manifest did not finish before the main tile client.', {
      l0Manifest,
      mainClientBoundarySequence,
    });
  }
  if (!l0Manifest.manifestProbe || l0Manifest.manifestProbe.parseError !== null) {
    throw probeError('The L0 manifest response could not be validated.', {
      manifestProbe: l0Manifest.manifestProbe ?? null,
    });
  }
  if (l0Manifest.manifestProbe.level !== 0) {
    throw probeError('The L0 manifest URL and response body disagree.', {
      requestLevel: l0Manifest.manifestLevel,
      responseLevel: l0Manifest.manifestProbe.level,
    });
  }

  const requestBounds = parseManifestRequestBounds(l0Manifest.url);
  const earlyBounds = normalizeBounds(earlyState?.viewport?.bounds);
  const expectedAddresses = requestBounds.parseError === null
    ? addressesForBounds(requestBounds)
    : [];
  if (
    requestBounds.parseError !== null
    || !sameBounds(requestBounds, earlyBounds)
    || JSON.stringify(l0Manifest.manifestProbe.targetAddresses) !== JSON.stringify(expectedAddresses)
  ) {
    throw probeError('The pre-Phaser L0 manifest was not a complete cover for its viewport.', {
      requestBounds,
      earlyBounds,
      responseAddresses: l0Manifest.manifestProbe.targetAddresses,
      expectedAddresses,
    });
  }

  const prematureTile = requests.find((entry) => (
    isWorldTileImageUrl(entry.url) && entry.startedSeq < l0Manifest.startedSeq
  ));
  if (prematureTile) {
    throw probeError('A tile image request began before the owning L0 manifest.', {
      prematureTile,
      l0Manifest,
    });
  }

  const readyUrls = l0Manifest.manifestProbe.readyNonEmptyUrls;
  const completedNetworkUrls = new Set(requests
    .filter((entry) => (
      isWorldTileImageUrl(entry.url)
      && entry.startedSeq > l0Manifest.startedSeq
      && isSuccessfulFinishedRequest(entry, mainClientBoundarySequence)
    ))
    .map((entry) => normalizeWorldTileUrl(entry.url)));
  const byteCacheHitUrls = new Set(clientEvents
    .filter((entry) => (
      entry.type === 'byte-cache-hit'
      && entry.sequence > clientManifests[0].sequence
      && entry.sequence < earlyReady.sequence
    ))
    .map((entry) => normalizeWorldTileUrl(entry.url)));
  const missingReadyUrls = readyUrls.filter((url) => (
    !completedNetworkUrls.has(url) && !byteCacheHitUrls.has(url)
  ));
  const diagnostics = {
    source: 'pre-phaser-early-l0',
    coarseReadyMs: visibleAtMs,
    earlyReadyEventAtMs: earlyReady.atMs ?? null,
    earlyReadyEventSequence: earlyReady.sequence,
    earlyBootstrapState: earlyState,
    l0ManifestStartedSeq: l0Manifest.startedSeq,
    l0ManifestFinishedSeq: l0Manifest.finishedSeq,
    coarseCoverageBoundarySequence,
    mainClientBoundarySequence,
    // Legacy alias retained for older artifact consumers. This was historically
    // the first main-client manifest sequence, not the semantic coarse-ready boundary.
    coarseNetworkBoundarySequence: mainClientBoundarySequence,
    mainManifestLevel: firstMainManifest?.manifestLevel ?? null,
    mainManifestStartedSeq: firstMainManifest?.startedSeq ?? null,
    refinementLevel: manifests.find((entry) => entry.manifestLevel !== 0)?.manifestLevel ?? null,
    refinementStartedSeq: manifests.find((entry) => entry.manifestLevel !== 0)?.startedSeq ?? null,
    mainManifestLevels: manifests.slice(1).map((entry) => entry.manifestLevel),
    networkBoundarySequence: mainClientBoundarySequence,
    clientBoundarySequence,
    requestBounds,
    readyUrlCount: readyUrls.length,
    completedNetworkUrls: [...completedNetworkUrls].sort(),
    byteCacheHitUrls: [...byteCacheHitUrls].sort(),
    missingReadyUrls,
  };
  if (missingReadyUrls.length > 0) {
    throw probeError('The main tile client began before every ready L0 tile URL was satisfied.', diagnostics);
  }
  return diagnostics;
}
