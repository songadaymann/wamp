import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Math: { Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)) } } }));
import { EditorMusicPatternController } from './musicPatternEditor';
import { createDefaultRoomPatternMusic, getPatternStepMidi, type RoomMusic, type RoomPatternMusic } from '../../music/model';

function fixture() {
  let music: RoomMusic | null = null;
  const commit = vi.fn((next: RoomMusic | null) => { music = next; return next; });
  const preview = vi.fn();
  const controller = new EditorMusicPatternController({} as never, {
    getRoomMusic: () => music, commitRoomMusic: commit, replaceLegacyRoomMusicWithPattern: () => null,
    renderUi: vi.fn(), getMusicPlayheadInfo: () => ({} as never), getMusicPreviewState: () => 'stopped', previewPatternCell: preview,
  });
  return { controller, commit, preview, get: () => music as RoomPatternMusic, set: (next: RoomMusic | null) => { music = next; } };
}

describe('shared touch pattern authoring', () => {
  it('toggles the actual mapped drum lane, with one commit and audition', () => {
    const f = fixture();
    f.controller.commitCellGesture([{ step: 31, row: 21 }], 'pencil');
    expect(f.get().tabs.drums['kick-1']).toEqual([31]);
    expect(f.commit).toHaveBeenCalledOnce();
    expect(f.preview).toHaveBeenCalledOnce();
    f.controller.commitCellGesture([{ step: 31, row: 21 }], 'pencil');
    expect(f.get().tabs.drums['kick-1']).toEqual([]);
  });

  it('keeps tap notes separate and batches explicit connected notes into one history value', () => {
    const f = fixture(); f.controller.setActiveInstrumentTab('triangle');
    f.controller.commitCellGesture([{ step: 0, row: 10 }], 'pencil');
    f.controller.commitCellGesture([{ step: 1, row: 10 }], 'pencil');
    expect(f.get().tabs.triangle.ties.slice(0, 2)).toEqual([false, false]);
    const before = f.get(); f.commit.mockClear(); f.preview.mockClear();
    f.controller.commitCellGesture([2, 3, 4, 5].map(step => ({ step, row: 10 })), 'pencil');
    expect(f.get().tabs.triangle.ties.slice(2, 6)).toEqual([false, true, true, true]);
    expect(f.commit).toHaveBeenCalledOnce();
    expect(f.preview).toHaveBeenCalledOnce();
    expect(before.tabs.triangle.steps.slice(2, 6)).toEqual([null, null, null, null]);
    f.set(before);
    expect(f.controller.getCellState(2, 10).active).toBe(false);
  });

  it('renders and erases using MIDI after key/pitch changes, retaining unrelated tracks', () => {
    const f = fixture(); f.controller.setActiveInstrumentTab('triangle');
    f.controller.commitCellGesture([{ step: 3, row: 10 }], 'pencil');
    const midi = getPatternStepMidi(f.get(), 'triangle', 3);
    const next = structuredClone(f.get()); next.pitchMode = 'chromatic'; next.keyTonic = 'G'; f.set(next);
    const displayed = Array.from({ length: 22 }, (_, row) => row).find(row => f.controller.getCellState(3, row).active)!;
    expect(displayed).toBeDefined();
    expect(getPatternStepMidi(f.get(), 'triangle', 3)).toBe(midi);
    f.controller.commitCellGesture([{ step: 3, row: displayed }], 'eraser');
    expect(f.get().tabs.triangle.steps[3]).toBe(null);
    expect(f.get().tabs.drums).toEqual(next.tabs.drums);
  });

  it('copies a connected phrase and pastes through the same bounded clipboard operations', () => {
    const f = fixture(); f.controller.setActiveInstrumentTab('triangle');
    f.controller.commitCellGesture([0, 1, 2].map(step => ({ step, row: 10 })), 'pencil');
    const before = f.get();
    f.controller.commitCellGesture([{ step: 0, row: 10 }, { step: 2, row: 10 }], 'copy');
    expect(f.get()).toBe(before);
    expect(f.controller.hasClipboardData()).toBe(true);
    f.controller.beginPastePreview(); f.commit.mockClear();
    f.controller.commitCellGesture([{ step: 29, row: 11 }], 'pencil');
    expect(f.commit).toHaveBeenCalledOnce();
    expect(f.get().tabs.triangle.steps.slice(29)).toEqual([11, 11, 11]);
    expect(f.get().tabs.triangle.ties.slice(29)).toEqual([false, true, true]);
    expect(f.controller.isPastePreviewActive()).toBe(false);
  });

  it('rejects out-of-range and inactive drum rows without creating a draft', () => {
    const f = fixture();
    f.controller.commitCellGesture([{ step: 32, row: 21 }, { step: 0, row: 0 }, { step: -1, row: 19 }], 'pencil');
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.preview).not.toHaveBeenCalled();
    f.set(createDefaultRoomPatternMusic());
    f.controller.commitCellGesture([{ step: 0, row: 19 }, { step: 1, row: 19 }], 'eraser');
    expect(f.commit).not.toHaveBeenCalled();
  });
});
