export const REPLAY_SECONDS = 300;
export const REPLAY_IMAGE_LIMIT = 16_000;
export const REPLAY_ACTIONS = [
  'play_toggle', 'room_start', 'welcome_play', 'welcome_build', 'menu', 'email_submit', 'wallet_open',
  'death', 'completed', 'failed', 'signup_open', 'test', 'stop', 'restart', 'signed_in', 'hidden', 'visible',
] as const;
export type ReplayAction = typeof REPLAY_ACTIONS[number];
export interface ReplaySample {
  sequence: number;
  time: number;
  mode: 'browse' | 'play' | 'edit';
  screen: 'loading' | 'welcome' | 'room_instructions' | 'menu' | 'game';
  room: string | null;
  player: { x: number; y: number } | null;
  actions: ReplayAction[];
  image: string | null;
}
export interface ReplaySession {
  id: string;
  visitor_id: string;
  started_at: string;
  entry_path: string;
  referrer_host: string;
  viewport: string;
  played: number;
  moved: number;
  signup: number;
  signed_in: number;
  samples: number;
  visits: number;
}

// Copy only the small, explicitly supported fields; never serialize debug/auth/DOM state.
export function replayPosition(value: unknown): ReplaySample['player'] {
  if (!value || typeof value !== 'object') return null;
  const { x, y } = value as Record<string, unknown>;
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)
    ? { x: Math.round(x), y: Math.round(y) } : null;
}
