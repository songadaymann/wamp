import type { LeaderboardRankingMode } from '../runs/model';

export interface PostRunBest {
  rankingMode: LeaderboardRankingMode;
  elapsedMs: number;
  score: number;
  displayName: string;
}

export function getPostRunBest(summary: {
  rankingMode: LeaderboardRankingMode;
  entries: { elapsedMs: number; score: number; userDisplayName: string }[];
} | null): PostRunBest | null {
  const first = summary?.entries[0];
  return summary && first ? { rankingMode: summary.rankingMode, elapsedMs: first.elapsedMs,
    score: first.score, displayName: first.userDisplayName } : null;
}

export function formatPostRunBest(best: PostRunBest | null | undefined, elapsedMs: number): string {
  if (!best) return '';
  if (best.rankingMode !== 'time') return `Leader: ${best.displayName} · ${best.score} pts`;
  const delta = elapsedMs - best.elapsedMs;
  const comparison = delta === 0 ? 'matched the best time' : Math.abs(delta) < 100 ? 'within 0.1s of the best'
    : `${formatClearTime(Math.abs(delta))} ${delta < 0 ? 'ahead' : 'behind'}`;
  return `Best: ${best.displayName} · ${formatClearTime(best.elapsedMs)} · ${comparison}`;
}

export function formatClearTime(elapsedMs: number): string {
  const tenths = Math.floor(Math.max(0, elapsedMs) / 100);
  return `${Math.floor(tenths / 600)}:${(Math.floor(tenths / 10) % 60).toString().padStart(2, '0')}.${tenths % 10}`;
}
