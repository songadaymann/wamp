import { describe, expect, it } from 'vitest';
import {
  editorDockDrawerTitle,
  INITIAL_EDITOR_DOCK_SHELL_STATE,
  isEditorDockShellActive,
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
  it('uses the same dock model for ordinary and expanded rooms on every device', () => {
    const doc = { body: { dataset: { appMode: 'editor', deviceClass: 'desktop' } } } as unknown as Document;
    expect(isEditorDockShellActive(doc)).toBe(true);
    doc.body.dataset.editorCourseMode = 'true';
    expect(isEditorDockShellActive(doc)).toBe(true);
    doc.body.dataset.deviceClass = 'phone';
    expect(isEditorDockShellActive(doc)).toBe(true);
    doc.body.dataset.appMode = 'world';
    expect(isEditorDockShellActive(doc)).toBe(false);
  });

  it('suppresses redundant ownership and recovery copy without hiding save feedback', () => {
    expect(shouldSuppressEditorShellStatus('Claimed by DoingGreat.')).toBe(true);
    expect(shouldSuppressEditorShellStatus(
      'Recovered local draft. Draft only. Not visible in the world until published.',
    )).toBe(true);
    expect(shouldSuppressEditorShellStatus(
      'Recovered local guest draft. Draft only. Not visible in the world until published.',
    )).toBe(true);
    expect(shouldSuppressEditorShellStatus(
      'Draft only. Not visible in the world until published.',
    )).toBe(true);
    expect(shouldSuppressEditorShellStatus('Saving draft...')).toBe(false);
    expect(shouldSuppressEditorShellStatus('Draft saved v4.')).toBe(false);
    expect(shouldSuppressEditorShellStatus('Draft save failed.')).toBe(false);
  });

  it('defaults to Terrain and keeps the drawer open when the active dock is selected again', () => {
    expect(INITIAL_EDITOR_DOCK_SHELL_STATE).toMatchObject({ activeDock: 'terrain', openPanel: 'terrain' });
    const unchanged = reduce([{ type: 'toggle-dock', dock: 'terrain' }]);
    expect(unchanged).toMatchObject({ activeDock: 'terrain', openPanel: 'terrain' });
  });

  it('keeps the current drawer workspace beneath mutually exclusive popovers', () => {
    const markers = reduce([
      { type: 'toggle-dock', dock: 'stuff' },
      { type: 'toggle-dock', dock: 'markers' },
    ]);
    expect(markers).toMatchObject({ activeDock: 'stuff', openPanel: 'stuff', markersOpen: true });

    const share = reduce([{ type: 'toggle-share' }], markers);
    expect(share).toMatchObject({ markersOpen: false, shareOpen: true });

    const goal = reduce([{ type: 'open-goal' }], share);
    expect(goal).toMatchObject({ activeDock: 'markers', openPanel: 'goal', markersOpen: false, shareOpen: false });
  });

  it('preserves the chosen Room subsection and does not collapse Room on a repeated click', () => {
    const state = reduce([
      { type: 'toggle-room' },
      { type: 'set-room-section', section: 'environment' },
      { type: 'toggle-room' },
    ]);
    expect(state).toMatchObject({ openPanel: 'room', roomSection: 'environment' });
  });

  it('gives Triangle its own drawer title and returns to Terrain when the dock is chosen', () => {
    const triangle = reduce([{ type: 'follow-tool', tool: 'triangle' }]);
    expect(triangle).toMatchObject({ openPanel: 'terrain', triangleSidebar: true });
    expect(editorDockDrawerTitle(triangle)).toBe('Triangle');

    const terrain = reduce([{ type: 'toggle-dock', dock: 'terrain' }], triangle);
    expect(terrain.triangleSidebar).toBe(false);
    expect(editorDockDrawerTitle(terrain)).toBe('Terrain');
  });

  it('leaves Room Setup for Terrain or Triangle when a tool is chosen', () => {
    const room = reduce([{ type: 'toggle-room' }]);
    expect(editorDockDrawerTitle(room)).toBe('Room Setup');

    const fromDraw = reduce([{ type: 'follow-tool', tool: 'pencil' }], room);
    expect(fromDraw).toMatchObject({ openPanel: 'terrain', triangleSidebar: false });
    expect(editorDockDrawerTitle(fromDraw)).toBe('Terrain');

    const fromTriangle = reduce([{ type: 'follow-tool', tool: 'triangle' }], room);
    expect(fromTriangle).toMatchObject({ openPanel: 'terrain', triangleSidebar: true });
    expect(editorDockDrawerTitle(fromTriangle)).toBe('Triangle');
  });

  it('keeps Stuff open when a terrain tool is chosen, but Triangle takes over the drawer', () => {
    const stuff = reduce([{ type: 'toggle-dock', dock: 'stuff' }]);
    expect(reduce([{ type: 'follow-tool', tool: 'pencil' }], stuff)).toMatchObject({
      openPanel: 'stuff',
      triangleSidebar: false,
    });
    expect(reduce([{ type: 'follow-tool', tool: 'triangle' }], stuff)).toMatchObject({
      openPanel: 'terrain',
      triangleSidebar: true,
    });
  });

  it('tracks one-shot spawn placement independently from the Markers popover', () => {
    const pending = reduce([
      { type: 'toggle-dock', dock: 'markers' },
      { type: 'start-spawn' },
    ]);
    expect(pending).toMatchObject({
      activeDock: 'terrain',
      openPanel: 'terrain',
      markersOpen: false,
      spawnPlacementActive: true,
    });
    expect(reduce([{ type: 'finish-spawn' }], pending).spawnPlacementActive).toBe(false);
  });
});
