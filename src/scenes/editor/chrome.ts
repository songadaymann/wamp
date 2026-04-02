import { getAuthDebugState } from '../../auth/client';
import { editorState } from '../../config';
import type { RoomGoal } from '../../goals/roomGoals';
import type {
  RoomBoundaryIngressSettings,
  RoomCoordinates,
  RoomPermissions,
  RoomVersionRecord,
} from '../../persistence/roomRepository';
import type { EditorCourseUiState } from '../../ui/setup/sceneBridge';
import type { EditorEditRuntime } from './editRuntime';
import type { EditorSceneFlowController } from './flow';
import type { EditorInspectorController } from './inspector';
import type { EditorPersistenceController } from './persistence';
import type { EditorToolController } from './tools';
import type { EditorUiBridge } from './uiBridge';
import {
  buildEditorUiViewModel,
} from './viewModel';
import type { EditorCourseController } from './courseController';
import type { EditorStatusDetails } from './roomSession';

interface EditorChromeControllerHost {
  getUiBridge(): EditorUiBridge | null;
  getRoomTitle(): string | null;
  getRoomCoordinates(): RoomCoordinates;
  getRoomBoundaryIngress(): RoomBoundaryIngressSettings;
  getRoomGoal(): RoomGoal | null;
  getRoomPermissions(): RoomPermissions;
  getMintedTokenId(): string | null;
  getRoomVersionHistory(): RoomVersionRecord[];
  getEntrySource(): 'world' | 'direct';
  getCourseEditorState(): EditorCourseUiState;
  getSaveInFlight(): boolean;
}

export class EditorChromeController {
  constructor(
    private readonly editRuntime: EditorEditRuntime,
    private readonly flowController: EditorSceneFlowController,
    private readonly persistenceController: EditorPersistenceController,
    private readonly toolController: EditorToolController,
    private readonly inspectorController: EditorInspectorController,
    private readonly courseController: EditorCourseController,
    private readonly host: EditorChromeControllerHost,
  ) {}

  render(): void {
    const uiBridge = this.host.getUiBridge();
    if (!uiBridge) {
      return;
    }

    const roomGoal = this.host.getRoomGoal();
    const historyState = this.persistenceController.getHistoryState();
    const authenticated = getAuthDebugState().authenticated;

    uiBridge.render(
      buildEditorUiViewModel({
        roomTitle: this.host.getRoomTitle(),
        roomCoordinates: this.host.getRoomCoordinates(),
        roomBoundaryIngress: this.host.getRoomBoundaryIngress(),
        roomGoal,
        roomPlacementMode: this.editRuntime.currentGoalPlacementMode,
        goalUsesMarkers: this.editRuntime.goalUsesMarkers(roomGoal),
        goalSummaryText: this.toolController.getGoalSummaryText(),
        roomPermissions: this.host.getRoomPermissions(),
        mintedTokenId: this.host.getMintedTokenId(),
        canRefreshMintMetadata: historyState.canRefreshMintMetadata,
        saveInFlight: this.host.getSaveInFlight(),
        mintedMetadataCurrent: historyState.mintedMetadataCurrent,
        roomVersionHistory: this.host.getRoomVersionHistory(),
        entrySource: this.host.getEntrySource(),
        zoomText: `Zoom: ${editorState.zoom}x`,
        saveStatus: this.getSaveStatus(),
        publishNudgeVisible: this.flowController.shouldShowPublishNudge(),
        publishNudgeText: authenticated
          ? 'People can’t see this room until you publish it.'
          : 'People can’t see this room until you sign in and publish it.',
        publishNudgeActionText: authenticated ? 'Publish Now' : 'Sign In to Publish',
        courseEditorState: this.host.getCourseEditorState(),
      }),
    );

    this.inspectorController.refreshUi();
  }

  refreshGoalUi(): void {
    this.courseController.redrawMarkers();
    this.render();
  }

  refreshBottomBar(): void {
    this.render();
  }

  private getSaveStatus(): EditorStatusDetails {
    const statusDetails = this.persistenceController.statusDetails;
    if (statusDetails.text || statusDetails.accentText || statusDetails.linkLabel) {
      return statusDetails;
    }

    return this.persistenceController.getIdleStatusDetails();
  }
}
