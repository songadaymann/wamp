export type WorldTileRequestKind =
  | 'initial-coverage'
  | 'viewport-refinement'
  | 'selection-prefetch'
  | 'mutation-prefetch'
  | 'config-refresh'
  | 'context-restoration';

export interface WorldTileBootstrapRequestState {
  requestSchedulingReady: boolean;
  initialCoveragePending: boolean;
}

/**
 * Initial L0 coverage owns the cold-boot request budget until it settles. This
 * prevents refinement and selection work from contending with the request that
 * can make the entire viewport displayable, while explicit mutation convergence
 * remains live so optimistic publish/unpublish overlays cannot get stuck.
 */
export function shouldScheduleWorldTileRequest(
  requestKind: WorldTileRequestKind,
  state: WorldTileBootstrapRequestState,
): boolean {
  if (!state.requestSchedulingReady) return false;
  return !state.initialCoveragePending
    || requestKind === 'initial-coverage'
    || requestKind === 'mutation-prefetch';
}
