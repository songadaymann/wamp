import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorMusicWorkflowCoordinator } from './musicWorkflow';
import { globalRoomMusicController } from '../../music/controller';
import { createDefaultRoomPatternMusic, type RoomMusic } from '../../music/model';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../music/controller', () => ({ globalRoomMusicController: { playArrangement: vi.fn().mockResolvedValue(undefined), stopArrangement: vi.fn() } }));
function harness() {
  let music: RoomMusic | null = createDefaultRoomPatternMusic();
  const commit = vi.fn((next: RoomMusic | null) => { music = next; return next; });
  const workflow = new EditorMusicWorkflowCoordinator({ commitRoomMusic: commit, getRoomMusic: () => music, requestRender: vi.fn(), replaceLegacyRoomMusicWithPattern: () => music } as never);
  (workflow as unknown as { musicPreviewState: string }).musicPreviewState = 'playing';
  workflow.attachPatternController({ handlePointerUp: vi.fn() } as never);
  return { workflow, commit, get: () => music, set: (next: RoomMusic | null) => { music = next; } };
}
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => vi.useRealTimers());
describe('actual music workflow preview lifecycle', () => {
  it('commits every authored edit immediately but previews only the final music after quiet', () => {
    const { workflow, commit, get } = harness();
    for (let bpm = 80; bpm < 130; bpm++) { workflow.commitRoomMusic({ ...createDefaultRoomPatternMusic(), bpm }); vi.advanceTimersByTime(5); }
    expect(commit).toHaveBeenCalledTimes(50); expect(globalRoomMusicController.playArrangement).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150); expect(globalRoomMusicController.playArrangement).toHaveBeenCalledExactlyOnceWith(get(), { mode: 'editor-preview', transition: 'immediate' });
  });
  it('flushes pointer release immediately and an Undo-style immediate sync replaces the pending preview', () => {
    const { workflow, set, get } = harness(); workflow.commitRoomMusic(createDefaultRoomPatternMusic()); workflow.handleMusicPointerUp({} as never);
    expect(globalRoomMusicController.playArrangement).toHaveBeenCalledTimes(1);
    workflow.commitRoomMusic({ ...createDefaultRoomPatternMusic(), bpm: 88 }); set({ ...createDefaultRoomPatternMusic(), bpm: 92 }); workflow.syncRoomMusicPreviewPlayback();
    vi.advanceTimersByTime(200); expect(globalRoomMusicController.playArrangement).toHaveBeenCalledTimes(2);
    expect(globalRoomMusicController.playArrangement).toHaveBeenLastCalledWith(get(), { mode: 'editor-preview', transition: 'immediate' });
  });
  it('stop, clear, scene reset and shutdown cannot restart queued playback', () => {
    for (const action of ['stop', 'clear', 'open', 'reset', 'shutdown']) {
      const { workflow } = harness(); workflow.commitRoomMusic(createDefaultRoomPatternMusic());
      if (action === 'stop') workflow.stopRoomMusicPreview();
      else if (action === 'clear') workflow.commitRoomMusic(null);
      else if (action === 'open') workflow.resetForSceneOpen();
      else if (action === 'reset') workflow.resetForRuntimeClear();
      else workflow.resetForShutdown({ stopMode: 'idle', render: false });
      vi.advanceTimersByTime(200);
    }
    expect(globalRoomMusicController.playArrangement).not.toHaveBeenCalled(); expect(globalRoomMusicController.stopArrangement).toHaveBeenCalledTimes(5);
  });
});
