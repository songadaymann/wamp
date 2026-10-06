import { describe, expect, it } from 'vitest';
import { MAX_RUN_RESPAWN_EVENTS, normalizeRankedRunVerificationTrace, type RankedRunVerificationTrace } from './verificationTrace';

const legacy: RankedRunVerificationTrace = { schemaVersion: 1, verificationNonce: 'nonce', snapshotHash: 'hash',
  traceDurationMs: 1000, inputEvents: [], breadcrumbs: [], roomTransitions: [], goalEvents: [] };
const event = { atMs: 500, breadcrumbIndex: 2, goalEventCount: 1,
  fromRoomX: -2, fromRoomY: 3, fromX: 96, fromY: 280,
  kind: 'object', instanceId: 'checkpoint', checkpointIndex: null };

describe('backward-compatible ranked respawn trace transport', () => {
  it('keeps legacy traces without the new optional field unchanged', () => {
    expect(normalizeRankedRunVerificationTrace(legacy)).toEqual(legacy);
  });

  it('preserves references, fractional coordinates and negative world coordinates', () => {
    const input = { ...legacy, respawnEvents: [{ ...event, fromX: 96.25 }] };
    expect(normalizeRankedRunVerificationTrace(input)).toEqual(input);
  });

  it.each([{ kind: 'teleport' }, { breadcrumbIndex: 0 }, { goalEventCount: -1 }, { fromX: Infinity },
    { fromRoomY: 1.5 }, { checkpointIndex: 0 }, { instanceId: '' }, { atMs: -1 }])('rejects malformed reset %j', invalid => {
    expect(normalizeRankedRunVerificationTrace({ ...legacy, respawnEvents: [{ ...event, ...invalid }] })).toBeNull();
  });

  it('rejects malformed and oversized arrays instead of silently stripping reset data', () => {
    expect(normalizeRankedRunVerificationTrace({ ...legacy, respawnEvents: {} })).toBeNull();
    expect(normalizeRankedRunVerificationTrace({ ...legacy, respawnEvents: Array(MAX_RUN_RESPAWN_EVENTS + 1).fill(event) })).toBeNull();
  });

  it('accepts a bound start or Sprint reference only with the matching fields', () => {
    for (const reference of [{ kind: 'start', instanceId: null, checkpointIndex: null },
      { kind: 'goal', instanceId: null, checkpointIndex: 0 }]) {
      expect(normalizeRankedRunVerificationTrace({ ...legacy, respawnEvents: [{ ...event, ...reference }] })?.respawnEvents)
        .toEqual([{ ...event, ...reference }]);
    }
  });
});
