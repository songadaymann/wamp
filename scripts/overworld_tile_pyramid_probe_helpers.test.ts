import { describe, expect, it } from 'vitest';
import {
  evaluateOverworldTileProbeAcceptance,
  evaluateSerializedL0Bootstrap,
  getManifestLevel,
  hasWorldTileCoverageIdentityTransition,
  isCameraReversalTowardOrigin,
  isStableWorldTileReadyFrame,
  parseSnapshotQuery,
  parseWorldTileManifestProbe,
  partitionTrackedRequestsByCoverageBoundaries,
  selectCreditableEarlySharpEvent,
  selectExpectedWorldTileLevel,
  summarizeApiWorkerRequests,
  summarizeTileImagePhase,
  summarizeTrackedNetwork,
} from './overworld_tile_pyramid_probe_helpers.mjs';

const TILE_A = 'https://tiles.example/world-tiles/v/objects/a.png';
const TILE_B = 'https://tiles.example/world-tiles/v/objects/b.png';

function manifestProbe(urls = [TILE_A, TILE_B]) {
  return parseWorldTileManifestProbe({
    level: 0,
    entries: urls.map((url, index) => ({
      address: { level: 0, x: index, y: 0 },
      ready: { url },
    })),
  });
}

function request(overrides = {}) {
  return {
    url: TILE_A,
    method: 'GET',
    manifestLevel: null,
    snapshotQuery: null,
    startedSeq: 1,
    responseSeq: 2,
    finishedSeq: 3,
    failedSeq: null,
    status: 200,
    contentLength: 0,
    cacheStatus: null,
    ...overrides,
  };
}

function l0Manifest(overrides = {}) {
  return request({
    url: 'https://game.example/api/world/tiles/manifest?level=0&minTileX=0&maxTileX=1&minTileY=0&maxTileY=0',
    manifestLevel: 0,
    manifestProbe: manifestProbe(),
    ...overrides,
  });
}

function earlyReadyEvent(overrides = {}) {
  return {
    type: 'early-bootstrap-ready',
    sequence: 3,
    atMs: 8,
    layerPresent: true,
    bodyVisible: true,
    state: {
      schemaVersion: 1,
      status: 'visible',
      decision: { enabled: true, shadow: false },
      viewport: {
        bounds: { minTileX: 0, maxTileX: 1, minTileY: 0, maxTileY: 0 },
      },
      timings: { visibleAtMs: 7.5 },
    },
    ...overrides,
  };
}

function evaluate(overrides = {}) {
  const requests = [
    l0Manifest(),
    request({ url: TILE_A, startedSeq: 4, responseSeq: 5, finishedSeq: 6 }),
    request({
      url: 'https://game.example/api/world/tiles/manifest?level=1',
      manifestLevel: 1,
      startedSeq: 10,
      responseSeq: 11,
      finishedSeq: 12,
      manifestProbe: null,
    }),
  ];
  return evaluateSerializedL0Bootstrap({
    requests,
    clientEvents: [
      { type: 'manifest-request', sequence: 1, level: 0 },
      {
        type: 'byte-cache-hit',
        sequence: 2,
        url: `${TILE_B}?__wamp_tile_hash=hash`,
      },
      earlyReadyEvent(),
      { type: 'manifest-request', sequence: 4, level: 1 },
    ],
    initialCoverageBoundary: { networkSequence: 20, clientSequence: 5 },
    ...overrides,
  });
}

const ACCEPTANCE_ZOOMS = [0.08, 0.10, 0.17, 0.18, 0.20, 0.40, 0.80];

function acceptanceZooms() {
  let expectedLevel = 1;
  return ACCEPTANCE_ZOOMS.map((targetZoom) => {
    expectedLevel = selectExpectedWorldTileLevel(targetZoom, expectedLevel);
    return {
      targetZoom,
      expectedLevel,
      finalState: { zoom: targetZoom },
      targetReady: {
        state: {
          targetLevel: expectedLevel,
          committedLevel: expectedLevel,
        },
      },
    };
  });
}

function acceptancePass(label: 'cold' | 'warm') {
  return {
    coarseReadyMs: label === 'cold' ? 800 : 250,
    sharpReadyMs: label === 'cold' ? 1_400 : 450,
    coarseNetwork: {
      summary: {
        worldTileResponseBytes: 400_000,
        worldTileMissingResponseBodyCount: 0,
        responseBytes: 450_000,
        missingResponseBodyCount: 0,
      },
    },
    sharpNetwork: {
      summary: {
        worldTileResponseBytes: 1_000_000,
        worldTileMissingResponseBodyCount: 0,
        responseBytes: 1_200_000,
        missingResponseBodyCount: 0,
        tileRequestCount: 12,
        manifestMaxResponseBytes: 40_000,
        manifestP95DurationMs: 140,
        manifestMaxDurationMs: 140,
        manifestMissingDurationCount: 0,
      },
    },
    refinementNetwork: {
      summary: {
        tileRequestCount: 12,
        tileResponseBytes: 800_000,
      },
    },
    network: [],
    networkSummary: {
      legacyWorldChunkRequestCount: 0,
    },
    sharp: {
      state: {
        zoom: 0.18,
        targetLevel: 1,
        committedLevel: 1,
      },
    },
    zooms: acceptanceZooms(),
    pan: {
      after: {
        replacementGapFrames: 0,
      },
    },
    clientProbeEvents: label === 'warm'
      ? [
          ...Array.from({ length: 19 }, () => ({ type: 'byte-cache-hit' })),
          { type: 'byte-cache-miss' },
        ]
      : [],
  };
}

function acceptanceResult() {
  return {
    zoomTargets: ACCEPTANCE_ZOOMS,
    cold: acceptancePass('cold'),
    warm: acceptancePass('warm'),
  };
}

describe('overworld tile pyramid probe helpers', () => {
  it('rejects missing and blank manifest levels instead of treating them as L0', () => {
    expect(getManifestLevel('https://game.example/api/world/tiles/manifest')).toBe('invalid');
    expect(getManifestLevel('https://game.example/api/world/tiles/manifest?level=')).toBe('invalid');
    expect(getManifestLevel('https://game.example/api/world/tiles/manifest?level=0')).toBe(0);
  });

  it('retains structured snapshot references and reports malformed payloads', () => {
    expect(parseSnapshotQuery(null).parseError).toBe('missing-body');
    expect(parseSnapshotQuery('{').parseError).toBe('invalid-json');
    expect(parseSnapshotQuery(JSON.stringify({ references: 'not-an-array' })).parseError)
      .toBe('references-not-array');

    const parsed = parseSnapshotQuery(JSON.stringify({
      detail: 'overview',
      references: [
        {
          kind: 'current_preview',
          roomId: '2,-3',
          state: 'claimed_unpublished',
          updatedAt: '2026-07-19T00:00:00.000Z',
          coordinates: { x: 2, y: -3 },
        },
        { kind: 'version', roomId: '4,5', version: 7 },
      ],
    }));
    expect(parsed).toMatchObject({
      parseError: null,
      detail: 'overview',
      referenceCount: 2,
      referenceClasses: ['current_preview:claimed_unpublished', 'version'],
      references: [
        {
          roomId: '2,-3',
          state: 'claimed_unpublished',
          coordinates: { x: 2, y: -3 },
          valid: true,
        },
        { roomId: '4,5', version: 7, valid: true },
      ],
    });
  });

  it('counts a malformed snapshot endpoint request instead of hiding it', () => {
    const snapshotQuery = parseSnapshotQuery(null);
    const summary = summarizeTrackedNetwork([
      request({
        url: 'https://game.example/api/rooms/snapshots/query',
        method: 'POST',
        manifestLevel: null,
        snapshotQuery,
      }),
    ]);
    expect(summary).toMatchObject({
      snapshotQueryCount: 1,
      snapshotQueryPostCount: 1,
      snapshotParseErrorCount: 1,
      snapshotParseErrors: { 'missing-body': 1 },
    });
  });

  it('partitions coarse and refinement traffic at semantic coverage boundaries', () => {
    const requests = [
      request({ url: 'https://game.example/api/world/tiles/config', startedSeq: 1, responseBodyBytes: 110 }),
      l0Manifest({ startedSeq: 7, responseBodyBytes: 2_121 }),
      request({ url: TILE_A, startedSeq: 13, responseBodyBytes: 29_443 }),
      request({ url: TILE_B, startedSeq: 14, responseBodyBytes: 51_587 }),
      request({ url: `${TILE_A}?part=3`, startedSeq: 15, responseBodyBytes: 45_513 }),
      request({ url: `${TILE_B}?part=4`, startedSeq: 16, responseBodyBytes: 54_253 }),
      request({
        url: 'https://game.example/api/world/chunks/summary',
        startedSeq: 37,
        responseBodyBytes: 319_120,
      }),
      request({
        url: 'https://game.example/api/world/tiles/manifest?level=1',
        manifestLevel: 1,
        startedSeq: 51,
        responseBodyBytes: 9_314,
      }),
      request({
        url: 'https://game.example/api/rooms/snapshots/query',
        method: 'POST',
        startedSeq: 126,
        responseBodyBytes: 50_000,
      }),
    ];
    const phases = partitionTrackedRequestsByCoverageBoundaries(requests, {
      coarseCoverageSequence: 25,
      sharpCoverageSequence: 125,
    });

    expect(summarizeTrackedNetwork(phases.coarse).responseBytes).toBe(183_027);
    expect(phases.coarse.some((entry) => entry.url.includes('/chunks/summary'))).toBe(false);
    expect(phases.refinement.map((entry) => entry.startedSeq)).toEqual([37, 51]);
    expect(phases.throughSharp.some((entry) => entry.startedSeq === 126)).toBe(false);
  });

  it('rejects invalid semantic coverage boundary ordering', () => {
    expect(() => partitionTrackedRequestsByCoverageBoundaries([], {
      coarseCoverageSequence: 10,
      sharpCoverageSequence: 9,
    })).toThrow(/cannot occur after sharp coverage/);
  });

  it('credits early sharp only when renderer, target level, and current Phaser coverage key match', () => {
    const bounds = { minTileX: -1, maxTileX: 0, minTileY: -1, maxTileY: 0 };
    const coverageKey = JSON.stringify(['renderer-v1', 1, -1, 0, -1, 0]);
    const event = {
      type: 'early-bootstrap-sharp-ready',
      layerPresent: true,
      bodyVisible: true,
      state: {
        status: 'visible',
        rendererVersion: 'renderer-v1',
        displayLevel: 1,
        targetLevel: 1,
        targetBounds: bounds,
        coverageKey,
        refinementError: null,
        timings: { sharpVisibleAtMs: 321 },
      },
    };
    const phaserState = {
      rollout: { rendererVersion: 'renderer-v1' },
      targetLevel: 1,
      committedLevel: 1,
      coverageEpoch: 4,
      readyCoverageEpoch: 4,
      coverageKey,
    };

    expect(selectCreditableEarlySharpEvent([event], phaserState)).toBe(event);
    expect(selectCreditableEarlySharpEvent([event], {
      durationMs: 321,
      state: phaserState,
    })).toBe(event);
    expect(selectCreditableEarlySharpEvent([event], {
      ...phaserState,
      coverageKey: JSON.stringify(['renderer-v1', 1, 0, 0, 0, 0]),
    })).toBeNull();
    expect(selectCreditableEarlySharpEvent([event], {
      ...phaserState,
      readyCoverageEpoch: 3,
    })).toBeNull();
    expect(selectCreditableEarlySharpEvent([{
      ...event,
      state: { ...event.state, rendererVersion: 'renderer-v2' },
    }], phaserState)).toBeNull();
  });

  it('requires both camera movement and a newer coverage identity for pan transitions', () => {
    const before = {
      camera: { x: 0, y: 0, width: 1_000, height: 600 },
      coverageEpoch: 7,
      coverageKey: 'renderer:1:before',
    };
    const after = {
      camera: { x: 640, y: 0, width: 1_000, height: 600 },
      coverageEpoch: 8,
      coverageKey: 'renderer:1:after',
    };
    expect(hasWorldTileCoverageIdentityTransition(before, after)).toBe(true);
    expect(hasWorldTileCoverageIdentityTransition(before, {
      ...after,
      camera: before.camera,
    })).toBe(false);
    expect(hasWorldTileCoverageIdentityTransition(before, {
      ...after,
      coverageKey: before.coverageKey,
    })).toBe(false);
    expect(hasWorldTileCoverageIdentityTransition(before, {
      ...after,
      coverageEpoch: before.coverageEpoch,
    })).toBe(false);
  });

  it('requires a reversal to move the camera closer to its original coordinates', () => {
    const origin = { camera: { x: 0, y: 0 } };
    const forward = { camera: { x: 640, y: 160 } };
    expect(isCameraReversalTowardOrigin(origin, forward, {
      camera: { x: 100, y: 40 },
    })).toBe(true);
    expect(isCameraReversalTowardOrigin(origin, forward, {
      camera: { x: 800, y: 160 },
    })).toBe(false);
    expect(isCameraReversalTowardOrigin(origin, origin, origin)).toBe(false);
  });

  it('credits pan sharp only after a later ready frame retains the same epoch and key', () => {
    const ready = {
      coverageEpoch: 9,
      coverageKey: 'renderer:1:stable',
      readyCoverageEpoch: 9,
      coverageReadyAtMs: 456,
      targetLevel: 1,
      committedLevel: 1,
      fallbackReason: null,
    };
    expect(isStableWorldTileReadyFrame(ready, { ...ready })).toBe(true);
    expect(isStableWorldTileReadyFrame(ready, {
      ...ready,
      coverageKey: 'renderer:1:next',
    })).toBe(false);
    expect(isStableWorldTileReadyFrame(ready, {
      ...ready,
      readyCoverageEpoch: 8,
    })).toBe(false);
    expect(isStableWorldTileReadyFrame(ready, {
      ...ready,
      coverageEpoch: 10,
      readyCoverageEpoch: 10,
    })).toBe(false);
  });

  it('accepts L0 URLs completed by network or an explicit pre-refinement byte-cache hit', () => {
    expect(evaluate()).toMatchObject({
      source: 'pre-phaser-early-l0',
      coarseReadyMs: 7.5,
      coarseCoverageBoundarySequence: 20,
      readyUrlCount: 2,
      mainManifestLevel: 1,
      refinementLevel: 1,
      missingReadyUrls: [],
    });
  });

  it('treats the first L0 as the early owner and later L0 work as main-client refinement', () => {
    const diagnostics = evaluate({
      requests: [
        l0Manifest(),
        request({ url: TILE_A, startedSeq: 4, responseSeq: 5, finishedSeq: 6 }),
        l0Manifest({ startedSeq: 10, responseSeq: 11, finishedSeq: 12 }),
        request({
          url: 'https://game.example/api/world/tiles/manifest?level=1',
          manifestLevel: 1,
          startedSeq: 13,
          responseSeq: 14,
          finishedSeq: 15,
        }),
      ],
      clientEvents: [
        { type: 'manifest-request', sequence: 1, level: 0 },
        { type: 'byte-cache-hit', sequence: 2, url: TILE_B },
        earlyReadyEvent(),
        { type: 'manifest-request', sequence: 4, level: 0 },
        { type: 'manifest-request', sequence: 5, level: 1 },
      ],
    });
    expect(diagnostics).toMatchObject({
      mainManifestLevel: 0,
      mainManifestLevels: [0, 1],
      refinementLevel: 1,
      coarseNetworkBoundarySequence: 10,
    });
  });

  it('rejects any main-client manifest before the early L0 ready event', () => {
    expect(() => evaluate({
      clientEvents: [
        { type: 'manifest-request', sequence: 1, level: 0 },
        { type: 'manifest-request', sequence: 2, level: 1 },
        earlyReadyEvent(),
      ],
    })).toThrow(/before pre-Phaser L0 coverage was ready/);
  });

  it('requires the early ready event to prove an actually visible layer', () => {
    expect(() => evaluate({
      clientEvents: [
        { type: 'manifest-request', sequence: 1, level: 0 },
        { type: 'byte-cache-hit', sequence: 2, url: TILE_B },
        earlyReadyEvent({ layerPresent: false }),
        { type: 'manifest-request', sequence: 4, level: 1 },
      ],
    })).toThrow(/did not prove visible L0 coverage/);
  });

  it('requires the owner response to completely cover the exact requested viewport', () => {
    expect(() => evaluate({
      requests: [
        l0Manifest({
          url: 'https://game.example/api/world/tiles/manifest?level=0&minTileX=0&maxTileX=2&minTileY=0&maxTileY=0',
        }),
        request({ url: TILE_A, startedSeq: 4, responseSeq: 5, finishedSeq: 6 }),
        request({
          url: 'https://game.example/api/world/tiles/manifest?level=1',
          manifestLevel: 1,
          startedSeq: 10,
        }),
      ],
    })).toThrow(/not a complete cover for its viewport/);

    expect(() => evaluate({
      requests: [
        l0Manifest({ manifestProbe: manifestProbe([TILE_A]) }),
        request({ url: TILE_A, startedSeq: 4, responseSeq: 5, finishedSeq: 6 }),
        request({
          url: 'https://game.example/api/world/tiles/manifest?level=1',
          manifestLevel: 1,
          startedSeq: 10,
        }),
      ],
    })).toThrow(/not a complete cover for its viewport/);
  });

  it('rejects response headers without a successful request-finished event', () => {
    const requests = [
      l0Manifest(),
      request({
        url: TILE_A,
        startedSeq: 4,
        responseSeq: 5,
        finishedSeq: null,
      }),
      request({
        url: 'https://game.example/api/world/tiles/manifest?level=1',
        manifestLevel: 1,
        startedSeq: 10,
      }),
    ];
    expect(() => evaluate({
      requests,
      clientEvents: [
        { type: 'manifest-request', sequence: 1, level: 0 },
        { type: 'byte-cache-hit', sequence: 2, url: TILE_B },
        earlyReadyEvent(),
        { type: 'manifest-request', sequence: 4, level: 1 },
      ],
    })).toThrow(/every ready L0 tile URL/);
  });

  it('rejects refinement that starts before an advertised L0 tile even starts', () => {
    expect(() => evaluate({
      requests: [
        l0Manifest(),
        request({
          url: 'https://game.example/api/world/tiles/manifest?level=1',
          manifestLevel: 1,
          startedSeq: 4,
        }),
        request({ url: TILE_A, startedSeq: 5, finishedSeq: 6 }),
      ],
      clientEvents: [
        { type: 'manifest-request', sequence: 1, level: 0 },
        { type: 'byte-cache-hit', sequence: 2, url: TILE_B },
        earlyReadyEvent(),
        { type: 'manifest-request', sequence: 4, level: 1 },
      ],
    })).toThrow(/every ready L0 tile URL/);
  });

  it('uses event sequence rather than rounded timestamps for ordering', () => {
    expect(() => evaluate({
      requests: [
        l0Manifest({ startedAtMs: 1, finishedSeq: 3 }),
        request({
          url: TILE_A,
          startedSeq: 4,
          responseSeq: 8,
          finishedSeq: 11,
          startedAtMs: 5,
          finishedAtMs: 5,
        }),
        request({
          url: 'https://game.example/api/world/tiles/manifest?level=1',
          manifestLevel: 1,
          startedSeq: 10,
          startedAtMs: 5,
        }),
      ],
      clientEvents: [
        { type: 'manifest-request', sequence: 1, level: 0 },
        { type: 'byte-cache-hit', sequence: 2, url: TILE_B },
        earlyReadyEvent(),
        { type: 'manifest-request', sequence: 4, level: 1 },
      ],
    })).toThrow(/every ready L0 tile URL/);
  });

  it('allows a warm L0 bootstrap satisfied entirely from the persistent byte cache', () => {
    const diagnostics = evaluate({
      requests: [l0Manifest()],
      clientEvents: [
        { type: 'manifest-request', sequence: 1, level: 0 },
        { type: 'byte-cache-hit', sequence: 2, url: TILE_A },
        { type: 'byte-cache-hit', sequence: 3, url: TILE_B },
        earlyReadyEvent({ sequence: 4 }),
      ],
      initialCoverageBoundary: { networkSequence: 20, clientSequence: 5 },
    });
    expect(diagnostics).toMatchObject({
      refinementLevel: null,
      readyUrlCount: 2,
      missingReadyUrls: [],
    });
  });

  it('fails closed when exact Request correlation is lost', () => {
    expect(() => evaluate({
      orphanEvents: [{ type: 'requestfinished', sequence: 4, url: TILE_A }],
    })).toThrow(/without their exact Request/);
  });

  it('accepts a probe result that satisfies every rollout gate', () => {
    expect(evaluateOverworldTileProbeAcceptance(acceptanceResult())).toMatchObject({
      passed: true,
      warmCache: {
        hits: 19,
        misses: 1,
        hitRatio: 0.95,
      },
      failures: [],
    });
  });

  it('reports API concurrency without silently creating an unplanned acceptance gate', () => {
    const result = acceptanceResult();
    result.cold.apiWorkerNetwork = {
      summary: { requestCount: 400, peakInFlight: 391 },
    };
    result.warm.apiWorkerNetwork = {
      summary: { requestCount: 400, peakInFlight: 391 },
    };
    expect(evaluateOverworldTileProbeAcceptance(result)).toMatchObject({
      passed: true,
      failures: [],
    });
  });

  it.each([
    ['coldCoarseReadyMs', 'cold', 'coarseReadyMs', 901, 'cold-coarse-ready'],
    ['warmCoarseReadyMs', 'warm', 'coarseReadyMs', 301, 'warm-coarse-ready'],
    ['coldSharpReadyMs', 'cold', 'sharpReadyMs', 1_501, 'cold-sharp-ready'],
    ['warmSharpReadyMs', 'warm', 'sharpReadyMs', 501, 'warm-sharp-ready'],
  ])('fails the %s latency gate', (_gate, pass, metric, value, failureCode) => {
    const result = acceptanceResult();
    result[pass][metric] = value;
    const acceptance = evaluateOverworldTileProbeAcceptance(result);
    expect(acceptance.passed).toBe(false);
    expect(acceptance.failures).toContainEqual(expect.objectContaining({ code: failureCode, pass }));
  });

  it('fails stable-viewport request and byte budgets independently', () => {
    const result = acceptanceResult();
    result.cold.coarseNetwork.summary.responseBytes = 500_001;
    result.cold.sharpNetwork.summary.responseBytes = 1_500_001;
    result.cold.refinementNetwork.summary.tileRequestCount = 17;
    const codes = evaluateOverworldTileProbeAcceptance(result).failures.map(({ code }) => code);
    expect(codes).toEqual(expect.arrayContaining([
      'coarse-response-bytes',
      'sharp-response-bytes',
      'stable-viewport-tile-requests',
    ]));
  });

  it('applies the 16-request gate only to post-coarse tile refinement', () => {
    const result = acceptanceResult();
    result.cold.coarseNetwork.summary.tileRequestCount = 4;
    result.cold.sharpNetwork.summary.tileRequestCount = 20;
    result.cold.refinementNetwork.summary.tileRequestCount = 16;
    expect(evaluateOverworldTileProbeAcceptance(result).failures).not.toContainEqual(
      expect.objectContaining({ code: 'stable-viewport-tile-requests', pass: 'cold' }),
    );

    result.cold.refinementNetwork.summary.tileRequestCount = 17;
    expect(evaluateOverworldTileProbeAcceptance(result).failures).toContainEqual(
      expect.objectContaining({ code: 'stable-viewport-tile-requests', pass: 'cold' }),
    );
  });

  it('fails any oversized or slow initial stable-view manifest', () => {
    const result = acceptanceResult();
    result.warm.sharpNetwork.summary.manifestMaxResponseBytes = 50_001;
    result.warm.sharpNetwork.summary.manifestP95DurationMs = 150.1;
    const codes = evaluateOverworldTileProbeAcceptance(result).failures.map(({ code }) => code);
    expect(codes).toEqual(expect.arrayContaining([
      'manifest-response-bytes',
      'manifest-latency',
    ]));
  });

  it('gates manifest latency at p95 while retaining the maximum for diagnostics', () => {
    const requests = Array.from({ length: 20 }, (_, index) => request({
      url: `https://game.example/api/world/tiles/manifest?level=1&sample=${index}`,
      manifestLevel: 1,
      startedAtMs: index * 2_000,
      finishedAtMs: index * 2_000 + (index === 19 ? 1_000 : 100),
    }));
    const summary = summarizeTrackedNetwork(requests);
    expect(summary).toMatchObject({
      manifestDurationCount: 20,
      manifestP95DurationMs: 100,
      manifestMaxDurationMs: 1_000,
      manifestMissingDurationCount: 0,
    });

    const result = acceptanceResult();
    result.warm.sharpNetwork.summary.manifestMaxDurationMs = 1_000;
    expect(evaluateOverworldTileProbeAcceptance(result).failures).not.toContainEqual(
      expect.objectContaining({ code: 'manifest-latency', pass: 'warm' }),
    );
  });

  it('fails closed when stable-view response bytes or manifest timing cannot be measured', () => {
    const result = acceptanceResult();
    result.cold.coarseNetwork.summary.missingResponseBodyCount = 1;
    result.cold.sharpNetwork.summary.manifestMissingDurationCount = 1;
    const codes = evaluateOverworldTileProbeAcceptance(result).failures.map(({ code }) => code);
    expect(codes).toEqual(expect.arrayContaining([
      'response-byte-measurement',
      'manifest-latency-measurement',
    ]));
  });

  it('fails replacement gaps and legacy chunk fallback', () => {
    const result = acceptanceResult();
    result.warm.pan.after.replacementGapFrames = 1;
    result.warm.networkSummary.legacyWorldChunkRequestCount = 1;
    const codes = evaluateOverworldTileProbeAcceptance(result).failures.map(({ code }) => code);
    expect(codes).toEqual(expect.arrayContaining([
      'replacement-gap-frames',
      'legacy-world-chunks',
    ]));
  });

  it('fails malformed and potentially published browse snapshot references', () => {
    const result = acceptanceResult();
    result.cold.network = [
      {
        url: 'https://game.example/api/rooms/snapshots/query',
        method: 'POST',
        snapshotQuery: parseSnapshotQuery('{'),
      },
      {
        url: 'https://game.example/api/rooms/snapshots/query',
        method: 'POST',
        snapshotQuery: parseSnapshotQuery(JSON.stringify({
          references: [{ kind: 'current_preview', roomId: '0,0', state: 'published' }],
        })),
      },
      {
        url: 'https://game.example/api/rooms/snapshots/query',
        method: 'POST',
        snapshotQuery: parseSnapshotQuery(JSON.stringify({
          references: [{ kind: 'current_preview', roomId: '1,0' }],
        })),
      },
    ];
    const codes = evaluateOverworldTileProbeAcceptance(result).failures.map(({ code }) => code);
    expect(codes).toEqual(expect.arrayContaining([
      'malformed-snapshot-query',
      'published-browse-snapshot-reference',
    ]));
  });

  it('fails when a labeled zoom target was not actually reached', () => {
    const result = acceptanceResult();
    result.cold.zooms[2].finalState.zoom = 0.177;
    expect(evaluateOverworldTileProbeAcceptance(result).failures).toContainEqual(
      expect.objectContaining({ code: 'target-zoom-not-reached', pass: 'cold' }),
    );
  });

  it('accepts the inclusive 0.006 wheel-step tolerance at the real sampled zooms', () => {
    const result = acceptanceResult();
    result.cold.zooms[0].finalState.zoom = 0.086;
    result.cold.zooms[2].finalState.zoom = 0.172;
    result.cold.zooms[3].finalState.zoom = 0.185;
    expect(evaluateOverworldTileProbeAcceptance(result).failures).not.toContainEqual(
      expect.objectContaining({ code: 'target-zoom-not-reached', pass: 'cold' }),
    );
  });

  it('fails a wrong LOD even if the probe reported the same wrong expectation', () => {
    const result = acceptanceResult();
    result.cold.zooms[2].expectedLevel = 0;
    result.cold.zooms[2].targetReady.state.targetLevel = 0;
    result.cold.zooms[2].targetReady.state.committedLevel = 0;
    expect(evaluateOverworldTileProbeAcceptance(result).failures).toContainEqual(
      expect.objectContaining({ code: 'lod-hysteresis', pass: 'cold', expected: 1 }),
    );
  });

  it('fails closed when the warm persistent byte-cache hit ratio is below 95%', () => {
    const result = acceptanceResult();
    result.warm.clientProbeEvents = [
      ...Array.from({ length: 18 }, () => ({ type: 'byte-cache-hit' })),
      ...Array.from({ length: 2 }, () => ({ type: 'byte-cache-miss' })),
    ];
    expect(evaluateOverworldTileProbeAcceptance(result).failures).toContainEqual(
      expect.objectContaining({ code: 'warm-byte-cache-hit-ratio', pass: 'warm' }),
    );
  });

  it('uses captured response bodies for byte gates instead of incomplete headers', () => {
    const summary = summarizeTrackedNetwork([
      request({
        url: TILE_A,
        contentLength: 10,
        responseBodyBytes: 123,
      }),
    ]);
    expect(summary).toMatchObject({
      tileRequestBytes: 10,
      tileResponseBytes: 123,
      worldTileResponseBytes: 123,
      worldTileMissingResponseBodyCount: 0,
      responseBytes: 123,
      missingResponseBodyCount: 0,
    });
  });

  it('reports coarse and refinement tile-image phases without mixing API bytes into them', () => {
    const phase = summarizeTileImagePhase([
      request({ url: TILE_A, contentLength: 10, responseBodyBytes: 123 }),
      request({ url: TILE_B, contentLength: 20, responseBodyBytes: 456 }),
      request({
        url: 'https://game.example/api/world/tiles/manifest?level=1',
        manifestLevel: 1,
        contentLength: 30,
        responseBodyBytes: 789,
      }),
    ]);
    expect(phase).toEqual({
      requestCount: 2,
      responseCount: 2,
      finishedCount: 2,
      announcedBytes: 30,
      responseBytes: 579,
    });
  });

  it('reports API Worker request volume and true peak in-flight concurrency', () => {
    const summary = summarizeApiWorkerRequests([
      {
        origin: 'https://api.example',
        startedSeq: 1,
        finishedSeq: 8,
        failedSeq: null,
      },
      {
        origin: 'https://api.example',
        startedSeq: 2,
        finishedSeq: null,
        failedSeq: 4,
      },
      {
        origin: 'https://safety-api.example',
        startedSeq: 3,
        finishedSeq: 5,
        failedSeq: null,
      },
      {
        origin: 'https://api.example',
        startedSeq: 9,
        finishedSeq: null,
        failedSeq: null,
      },
    ]);
    expect(summary).toEqual({
      requestCount: 4,
      peakInFlight: 3,
      unfinishedCount: 1,
      failedCount: 1,
      origins: ['https://api.example', 'https://safety-api.example'],
      requestsByOrigin: {
        'https://api.example': 3,
        'https://safety-api.example': 1,
      },
    });
  });

  it('counts CacheStorage-only hits and 304 revalidation as zero transfer', () => {
    const summary = summarizeTrackedNetwork([
      request({
        url: 'https://game.example/api/world/tiles/manifest?level=0',
        manifestLevel: 0,
        status: 304,
        contentLength: 0,
        responseBodyBytes: 123,
        startedAtMs: 10,
        finishedAtMs: 20,
      }),
      request({
        url: TILE_A,
        status: 304,
        contentLength: 0,
        responseBodyBytes: null,
        startedAtMs: 10,
        finishedAtMs: 20,
      }),
    ]);
    expect(summary).toMatchObject({
      responseBytes: 0,
      worldTileResponseBytes: 0,
      missingResponseBodyCount: 0,
      worldTileMissingResponseBodyCount: 0,
      manifestMaxResponseBytes: 123,
      manifestDurationCount: 1,
      manifestP95DurationMs: 10,
      manifestMaxDurationMs: 10,
      manifestMissingDurationCount: 0,
    });
  });
});
