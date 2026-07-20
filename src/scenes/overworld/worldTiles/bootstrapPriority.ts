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
  visibleEarlyCoverage: boolean;
}

/**
 * Initial L0 coverage owns the cold-boot request budget until it settles. This
 * prevents selection work from contending with the request that can make the
 * entire viewport displayable. A validated visible early-DOM cover can safely
 * release viewport refinement while Phaser hydrates that same L0 imagery;
 * explicit mutation convergence also remains live so optimistic
 * publish/unpublish overlays cannot get stuck.
 */
export function shouldScheduleWorldTileRequest(
  requestKind: WorldTileRequestKind,
  state: WorldTileBootstrapRequestState,
): boolean {
  if (!state.requestSchedulingReady) return false;
  return !state.initialCoveragePending
    || requestKind === 'initial-coverage'
    || requestKind === 'mutation-prefetch'
    || (requestKind === 'viewport-refinement' && state.visibleEarlyCoverage);
}
