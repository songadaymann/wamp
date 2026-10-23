import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../auth/client', () => ({ getAuthDebugState: () => ({ authenticated: true }) }));
vi.mock('../../mint/walletGate', () => ({ hasCryptoWallet: () => false }));
vi.mock('../../roomVideo/uiState', () => ({ setActiveRoomVideoRuntime: () => {} }));
vi.mock('./viewModel', () => ({ buildEditorUiViewModel: (options: unknown) => options }));
vi.mock('./clearCheck', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./clearCheck')>();
  return { ...actual, buildReadyToPublishChecklist: vi.fn(actual.buildReadyToPublishChecklist) };
});

import { editorState, updateEditorState } from '../../config';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../persistence/roomModel';
import { buildRoomTemplate } from '../../templates/roomTemplates';
import { EditorChromeController } from './chrome';
import {
  buildReadyToPublishChecklist,
  getEditorDraftFingerprint,
  recordEditorDraftClear,
  type ReadyToPublishChecklist,
} from './clearCheck';
import type { RoomEdgeSummary } from './edgeGuides';

const { buildReadyToPublishChecklist: freshChecklist } = await vi.importActual<typeof import('./clearCheck')>('./clearCheck');

function createHarness(snapshot: RoomSnapshot) {
  const runtime = {
    documentRevision: 1,
    hasUncommittedEdits: false,
    roomCameraMode: 'follow',
    roomPitsAreDeadly: false,
    roomPlayerHearts: 1,
    currentGoalPlacementMode: null,
    exportRoomSnapshot: vi.fn(() => structuredClone(snapshot)),
    hasUndoHistory: () => false,
    hasRedoHistory: () => false,
    getGoalIntroText: () => null,
    goalUsesMarkers: () => true,
    getPublishValidationError: () => null,
  };
  const state = { title: snapshot.title, edges: { connectedNeighbors: 1, openSides: 2, status: 'ready' } as RoomEdgeSummary };
  const rendered: Array<ReadyToPublishChecklist | undefined> = [];
  const uiBridge = { render: (viewModel: { clearCheck?: ReadyToPublishChecklist }) => { rendered.push(viewModel.clearCheck); } };
  const idleStatus = { text: '', accentText: '', linkLabel: '', linkHref: null };
  const chrome = new EditorChromeController(
    runtime as never,
    { shouldShowPublishNudge: () => false } as never,
    { getHistoryState: () => ({}), statusDetails: idleStatus, getIdleStatusDetails: () => idleStatus } as never,
    { getGoalSummaryText: () => '' } as never,
    { refreshUi: () => {} } as never,
    { hasActiveCourseEdit: () => false } as never,
    {
      getUiBridge: () => uiBridge as never,
      getRoomTitle: () => state.title,
      getRoomCoordinates: () => snapshot.coordinates,
      getRoomGoal: () => snapshot.goal,
      getRoomPermissions: () => ({ canSaveDraft: true }) as never,
      getMintedTokenId: () => null,
      getPublishedVersion: () => 0,
      getRoomVersionHistory: () => [],
      getEntrySource: () => 'world',
      getCourseEditorState: () => ({}) as never,
      getSaveInFlight: () => false,
      getRoomEdgeSummary: () => state.edges,
    },
  );
  return { chrome, runtime, state, rendered, last: () => rendered.at(-1)! };
}

describe('editor chrome publish checklist', () => {
  const snapshot = buildRoomTemplate(createDefaultRoomSnapshot('6,9', { x: 6, y: 9 }), 'flat_run', 'forest');
  const builds = vi.mocked(buildReadyToPublishChecklist);

  beforeEach(() => {
    builds.mockClear();
  });

  it('reuses the checklist across zoom steps while its inputs are unchanged', () => {
    const { chrome, runtime, state, last } = createHarness(snapshot);
    chrome.render();
    const first = last();
    for (let step = 0; step < 30; step += 1) chrome.render(true);

    expect(builds).toHaveBeenCalledOnce();
    expect(runtime.exportRoomSnapshot).toHaveBeenCalledOnce();
    expect(last()).toBe(first);
    expect(first).toEqual(freshChecklist(snapshot, undefined, state.edges));
  });

  it('still rebuilds on every render that is not a zoom step', () => {
    const { chrome, last } = createHarness(snapshot);
    chrome.render();
    const first = last();
    chrome.render();
    chrome.render();
    expect(builds).toHaveBeenCalledTimes(3);
    expect(last()).not.toBe(first);
    expect(last()).toEqual(first);
  });

  it('rebuilds a zoom step after any checklist input changes', () => {
    const { chrome, runtime, state, last } = createHarness(snapshot);
    const zoomAfter = (change: () => void) => {
      chrome.render(true);
      builds.mockClear();
      change();
      chrome.render(true);
      expect(builds).toHaveBeenCalledOnce();
    };

    zoomAfter(() => { runtime.documentRevision += 1; });
    zoomAfter(() => { state.title = 'Renamed'; });
    zoomAfter(() => { state.edges = { ...state.edges, connectedNeighbors: 2 }; });
    const weather = editorState.selectedWeatherMode;
    zoomAfter(() => { updateEditorState({ selectedWeatherMode: weather === 'rain' ? 'off' : 'rain' }); });
    updateEditorState({ selectedWeatherMode: weather });

    // A recorded clear changes only the receipt, and the next zoom step shows it.
    chrome.render(true);
    expect(last().cleared).toBe(false);
    recordEditorDraftClear(
      { roomId: snapshot.id, fingerprint: getEditorDraftFingerprint(snapshot), eligible: true },
      { roomId: snapshot.id, roomStatus: 'draft', result: 'completed', qualificationState: 'qualified' },
    );
    builds.mockClear();
    chrome.render(true);
    expect(builds).toHaveBeenCalledOnce();
    expect(last().cleared).toBe(true);
    expect(last()).toEqual(freshChecklist(snapshot, undefined, state.edges));
  });

  it('does not reuse a checklist while a gesture has uncommitted edits', () => {
    const { chrome, runtime } = createHarness(snapshot);
    runtime.hasUncommittedEdits = true;
    chrome.render(true);
    chrome.render(true);
    expect(builds).toHaveBeenCalledTimes(2);

    runtime.hasUncommittedEdits = false;
    chrome.render(true);
    chrome.render(true);
    expect(builds).toHaveBeenCalledTimes(3);
  });
});
