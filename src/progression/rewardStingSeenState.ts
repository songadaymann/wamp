import type { ProgressionSummary } from './model';

const REWARD_STING_SEEN_STORAGE_KEY = 'everybodys-platformer:reward-stings:seen-progression:v1';

interface StoredSeenProgressionState {
  users: Record<string, ProgressionSummary>;
}

function readState(storage: Storage): StoredSeenProgressionState {
  const raw = storage.getItem(REWARD_STING_SEEN_STORAGE_KEY);
  if (!raw) {
    return { users: {} };
  }

  try {
    const parsed = JSON.parse(raw) as StoredSeenProgressionState | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.users !== 'object' || !parsed.users) {
      return { users: {} };
    }
    return parsed;
  } catch {
    return { users: {} };
  }
}

function writeState(state: StoredSeenProgressionState, storage: Storage): void {
  storage.setItem(REWARD_STING_SEEN_STORAGE_KEY, JSON.stringify(state));
}

export function loadSeenRewardProgression(
  userId: string,
  storage: Storage = window.localStorage,
): ProgressionSummary | null {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return null;
  }

  const state = readState(storage);
  return state.users[normalizedUserId] ?? null;
}

export function saveSeenRewardProgression(
  userId: string,
  progression: ProgressionSummary,
  storage: Storage = window.localStorage,
): void {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return;
  }

  const state = readState(storage);
  state.users[normalizedUserId] = progression;
  writeState(state, storage);
}
