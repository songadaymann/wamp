import { describe, expect, it } from 'vitest';
import { createDefaultRoomPermissions } from '../../persistence/roomModel';
import type { EditorCourseUiState } from '../../ui/setup/sceneBridge';
import { buildEditorUiViewModel } from './viewModel';

const emptyCourseEditorState: EditorCourseUiState = {
  visible: false,
  statusHidden: true,
  statusText: null,
  roomStepText: '',
  canReturnToCourseBuilder: false,
  goalTypeValue: '',
  goalTypeDisabled: true,
  timeLimitHidden: true,
  timeLimitDisabled: true,
  timeLimitValue: '',
  requiredCountHidden: true,
  requiredCountDisabled: true,
  requiredCountValue: '',
  survivalHidden: true,
  survivalDisabled: true,
  survivalValue: '',
  markerControlsHidden: true,
  placementHintHidden: true,
  placementHintText: '',
  summaryText: '',
  placeStartHidden: true,
  placeStartActive: false,
  placeExitHidden: true,
  placeExitActive: false,
  addCheckpointHidden: true,
  addCheckpointActive: false,
  placeFinishHidden: true,
  placeFinishActive: false,
};

function buildOptions(overrides: Partial<Parameters<typeof buildEditorUiViewModel>[0]> = {}) {
  return {
    roomTitle: 'Test Room',
    roomCoordinates: { x: 0, y: 0 },
    roomGoal: null,
    roomGoalIntroText: null,
    roomPlacementMode: null,
    goalUsesMarkers: false,
    goalSummaryText: '',
    roomPermissions: createDefaultRoomPermissions(),
    publishValidationError: null,
    mintedTokenId: null,
    canRefreshMintMetadata: false,
    saveInFlight: false,
    mintedMetadataCurrent: true,
    roomVersionHistory: [],
    publishedVersion: 0,
    entrySource: 'world' as const,
    zoomText: 'Zoom: 1x',
    saveStatus: { text: '', accentText: '', linkLabel: '', linkHref: null },
    publishNudgeVisible: false,
    publishNudgeText: '',
    publishNudgeActionText: '',
    courseEditorState: emptyCourseEditorState,
    ...overrides,
  };
}

describe('buildEditorUiViewModel history button', () => {
  it('disables History when the room has never been published', () => {
    const viewModel = buildEditorUiViewModel(buildOptions({
      publishedVersion: 0,
      roomVersionHistory: [],
    }));
    expect(viewModel.historyDisabled).toBe(true);
  });

  it('enables History for published rooms even before versions are lazy-loaded', () => {
    const viewModel = buildEditorUiViewModel(buildOptions({
      publishedVersion: 4,
      roomVersionHistory: [],
    }));
    expect(viewModel.historyDisabled).toBe(false);
  });
});
