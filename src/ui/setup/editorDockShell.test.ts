import { describe, expect, it } from 'vitest';
import {
  INITIAL_EDITOR_DOCK_SHELL_STATE,
  reduceEditorDockShellState,
  shouldSuppressEditorShellStatus,
  type EditorDockShellState,
} from './editorDockShell';

function reduce(
  actions: Parameters<typeof reduceEditorDockShellState>[1][],
  initial: EditorDockShellState = { ...INITIAL_EDITOR_DOCK_SHELL_STATE },
): EditorDockShellState {
  return actions.reduce(reduceEditorDockShellState, initial);
}

describe('editor dock shell state', () => {
  it('suppresses idle claimer copy without hiding save or failure feedback', () => {
    expect(shouldSuppressEditorShellStatus('Claimed by DoingGreat.')).toBe(true);
    expect(shouldSuppressEditorShellStatus('Draft saved v4.')).toBe(false);
    expect(shouldSuppressEditorShellStatus('Draft save failed.')).toBe(false);
  });

  it('keeps a dock selected when its drawer is toggled closed', () => {
    const opened = reduce([{ type: 'toggle-dock', dock: 'terrain' }]);
    expect(opened).toMatchObject({ activeDock: 'terrain', openPanel: 'terrain' });

    const closed = reduce([{ type: 'toggle-dock', dock: 'terrain' }], opened);
    expect(closed).toMatchObject({ activeDock: 'terrain', openPanel: null });

    const reopened = reduce([{ type: 'toggle-dock', dock: 'terrain' }], closed);
    expect(reopened).toMatchObject({ activeDock: 'terrain', openPanel: 'terrain' });
  });

  it('makes drawer and popover workspaces mutually exclusive', () => {
    const markers = reduce([
      { type: 'toggle-dock', dock: 'stuff' },
      { type: 'toggle-dock', dock: 'markers' },
    ]);
    expect(markers).toMatchObject({ activeDock: 'markers', openPanel: null, markersOpen: true });

    const share = reduce([{ type: 'toggle-share' }], markers);
    expect(share).toMatchObject({ markersOpen: false, shareOpen: true });

    const goal = reduce([{ type: 'open-goal' }], share);
    expect(goal).toMatchObject({ activeDock: 'markers', openPanel: 'goal', markersOpen: false, shareOpen: false });
  });

  it('preserves the chosen Room subsection while the drawer closes and reopens', () => {
    const state = reduce([
      { type: 'toggle-room' },
      { type: 'set-room-section', section: 'environment' },
      { type: 'close-drawer' },
      { type: 'toggle-room' },
    ]);
    expect(state).toMatchObject({ openPanel: 'room', roomSection: 'environment' });
  });

  it('tracks one-shot spawn placement independently from the Markers popover', () => {
    const pending = reduce([
      { type: 'toggle-dock', dock: 'markers' },
      { type: 'start-spawn' },
    ]);
    expect(pending).toMatchObject({
      activeDock: 'markers',
      openPanel: null,
      markersOpen: false,
      spawnPlacementActive: true,
    });
    expect(reduce([{ type: 'finish-spawn' }], pending).spawnPlacementActive).toBe(false);
  });
});
