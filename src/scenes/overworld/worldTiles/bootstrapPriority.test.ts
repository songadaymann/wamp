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
        initialCoverageActive: false,
      })
    ))).toEqual([]);
  });

  it('prioritizes initial L0 coverage while preserving explicit mutation convergence', () => {
    expect(requestKinds.filter((requestKind) => (
      shouldScheduleWorldTileRequest(requestKind, {
        requestSchedulingReady: true,
        initialCoverageActive: true,
      })
    ))).toEqual(['initial-coverage', 'mutation-prefetch']);
  });

  it('resumes every request source after initial coverage settles', () => {
    expect(requestKinds.filter((requestKind) => (
      shouldScheduleWorldTileRequest(requestKind, {
        requestSchedulingReady: true,
        initialCoverageActive: false,
      })
    ))).toEqual(requestKinds);
  });
});
