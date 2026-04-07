import type { ProgressionDifficulty } from './model';

export interface ProgressionDifficultySuggestionInput {
  elapsedMs: number;
  deaths: number;
  collectiblesCollected?: number;
  enemiesDefeated?: number;
  checkpointsReached?: number;
}

export function suggestProgressionDifficulty(
  input: ProgressionDifficultySuggestionInput
): ProgressionDifficulty {
  const elapsedMinutes = Math.max(0, input.elapsedMs) / 60000;
  const deaths = Math.max(0, input.deaths);
  const collectibles = Math.max(0, input.collectiblesCollected ?? 0);
  const enemies = Math.max(0, input.enemiesDefeated ?? 0);
  const checkpoints = Math.max(0, input.checkpointsReached ?? 0);

  // Keep the v1 heuristic modest and transparent: time + deaths dominate,
  // with small bumps for longer objective-heavy runs.
  const difficultyScore =
    elapsedMinutes * 0.85 +
    deaths * 1.35 +
    Math.min(collectibles, 10) * 0.08 +
    Math.min(enemies, 8) * 0.1 +
    Math.min(checkpoints, 5) * 0.14;

  if (difficultyScore < 0.9) {
    return 'easy';
  }
  if (difficultyScore < 2.6) {
    return 'medium';
  }
  if (difficultyScore < 5.4) {
    return 'hard';
  }
  return 'extreme';
}
