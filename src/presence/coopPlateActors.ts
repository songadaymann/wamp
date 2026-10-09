import type { WorldGhostPresence } from './worldPresence';

export function getFreshCoopPlatePlayers(
  ghosts: readonly WorldGhostPresence[],
  options: { now: number; localUserId: string | null; instanceOpponentUserId: string | null },
): WorldGhostPresence[] {
  return ghosts.filter(ghost => ghost.mode === 'play'
    && ghost.userId !== options.localUserId && ghost.userId !== options.instanceOpponentUserId
    && !ghost.pvp?.matchId && Number.isFinite(ghost.x) && Number.isFinite(ghost.y)
    && Number.isFinite(ghost.timestamp)
    && options.now - ghost.timestamp >= -2_000 && options.now - ghost.timestamp <= 15_000);
}
