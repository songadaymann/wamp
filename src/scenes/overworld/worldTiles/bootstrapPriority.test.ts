import { describe, expect, it } from 'vitest';
import {
  shouldScheduleWorldTileRequest,
  type WorldTileRequestKind,
} from './bootstrapPriority';

const requestKinds: WorldTileRequestKind[] = [
  'initial-coverage',
  'viewport-refinement',
  'selection-prefetch',
  'mutation-prefetch',
  'config-refresh',
  'context-restoration',
];

describe('world tile bootstrap request priority', () => {
  it('publishes no request source before renderer and byte-cache preparation finish', () => {
    expect(requestKinds.filter((requestKind) => (
      shouldScheduleWorldTileRequest(requestKind, {
        requestSchedulingReady: false,
        initialCoveragePending: true,
        visibleEarlyCoverage: false,
      })
    ))).toEqual([]);
  });

  it('prioritizes initial L0 coverage while preserving explicit mutation convergence', () => {
    expect(requestKinds.filter((requestKind) => (
      shouldScheduleWorldTileRequest(requestKind, {
        requestSchedulingReady: true,
        initialCoveragePending: true,
        visibleEarlyCoverage: false,
      })
    ))).toEqual(['initial-coverage', 'mutation-prefetch']);
  });

  it('starts only viewport refinement early when a visible DOM cover owns coarse paint', () => {
    expect(requestKinds.filter((requestKind) => (
      shouldScheduleWorldTileRequest(requestKind, {
        requestSchedulingReady: true,
        initialCoveragePending: true,
        visibleEarlyCoverage: true,
      })
    ))).toEqual(['initial-coverage', 'viewport-refinement', 'mutation-prefetch']);
  });

  it('resumes every request source after initial coverage settles', () => {
    expect(requestKinds.filter((requestKind) => (
      shouldScheduleWorldTileRequest(requestKind, {
        requestSchedulingReady: true,
        initialCoveragePending: false,
        visibleEarlyCoverage: false,
      })
    ))).toEqual(requestKinds);
  });
});
