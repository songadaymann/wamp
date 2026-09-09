import type { ReplayAction } from './model';
export const REPLAY_EDITOR_EVENT = 'wamp-replay-editor-action';
export function recordReplayEditorAction(action: ReplayAction): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(REPLAY_EDITOR_EVENT, {detail:action}));
}
