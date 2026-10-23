import { getAuthDebugState } from '../../auth/client';
import { hasCryptoWallet } from '../../mint/walletGate';
import { setActiveRoomVideoRuntime } from '../../roomVideo/uiState';
import { editorState } from '../../config';
import type { RoomGoal } from '../../goals/roomGoals';
import type {
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
import { buildReadyToPublishChecklist, getEditorDraftClearReceipt, type ReadyToPublishChecklist } from './clearCheck';
import type { RoomEdgeSummary } from './edgeGuides';

interface EditorChromeControllerHost {
  getUiBridge(): EditorUiBridge | null;
  getRoomTitle(): string | null;
  getRoomCoordinates(): RoomCoordinates;
  getRoomGoal(): RoomGoal | null;
  getRoomPermissions(): RoomPermissions;
  getMintedTokenId(): string | null;
  getPublishedVersion(): number;
  getRoomVersionHistory(): RoomVersionRecord[];
  getEntrySource(): 'world' | 'direct';
  getCourseEditorState(): EditorCourseUiState;
  getSaveInFlight(): boolean;
  getRoomEdgeSummary?(): RoomEdgeSummary;
}

interface CachedClearCheck {
  key: string;
  receipt: string | null;
  checklist: ReadyToPublishChecklist;
}

export class EditorChromeController {
  private clearCheckCache: CachedClearCheck | null = null;

  constructor(
    private readonly editRuntime: EditorEditRuntime,
    private readonly flowController: EditorSceneFlowController,
    private readonly persistenceController: EditorPersistenceController,
    private readonly toolController: EditorToolController,
    private readonly inspectorController: EditorInspectorController,
    private readonly courseController: EditorCourseController,
    private readonly host: EditorChromeControllerHost,
  ) {}

  /** `zoomOnly` marks a render caused only by a camera zoom step. */
  render(zoomOnly = false): void {
    const uiBridge = this.host.getUiBridge();
    if (!uiBridge) {
      return;
    }

    setActiveRoomVideoRuntime(this.editRuntime);
    const roomGoal = this.host.getRoomGoal();
    const historyState = this.persistenceController.getHistoryState();
    const authenticated = getAuthDebugState().authenticated;

    uiBridge.render(
      buildEditorUiViewModel({
        clearCheck: this.courseController.hasActiveCourseEdit() ? undefined : this.getClearCheck(zoomOnly),
        canUndo: this.host.getRoomPermissions().canSaveDraft && this.editRuntime.hasUndoHistory(),
        canRedo: this.host.getRoomPermissions().canSaveDraft && this.editRuntime.hasRedoHistory(),
        roomTitle: this.host.getRoomTitle(),
        roomCameraCentered: this.editRuntime.roomCameraMode === 'room',
        roomPitsAreDeadly: this.editRuntime.roomPitsAreDeadly,
        roomPlayerHearts: this.editRuntime.roomPlayerHearts,
        roomCoordinates: this.host.getRoomCoordinates(),
        roomGoal,
        roomGoalIntroText: this.editRuntime.getGoalIntroText(),
        roomPlacementMode: this.editRuntime.currentGoalPlacementMode,
        goalUsesMarkers: this.editRuntime.goalUsesMarkers(roomGoal),
        goalSummaryText: this.toolController.getGoalSummaryText(),
        roomPermissions: this.host.getRoomPermissions(),
        publishValidationError: this.editRuntime.getPublishValidationError(),
        mintedTokenId: this.host.getMintedTokenId(),
        canRefreshMintMetadata: historyState.canRefreshMintMetadata,
        saveInFlight: this.host.getSaveInFlight(),
        mintedMetadataCurrent: historyState.mintedMetadataCurrent,
        publishedVersion: this.host.getPublishedVersion(),
        roomVersionHistory: this.host.getRoomVersionHistory(),
        entrySource: this.host.getEntrySource(),
        zoomText: `Zoom: ${Number(editorState.zoom.toFixed(2))}x`,
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

  /**
   * Zoom is not a checklist input, so a zoom-only render reuses the last
   * checklist while the room revision, receipt, edges, title and settings are
   * unchanged and no gesture is mid-edit. Every other render rebuilds it.
   */
  private getClearCheck(zoomOnly: boolean): ReadyToPublishChecklist {
    const edges = this.host.getRoomEdgeSummary?.();
    const key = this.editRuntime.hasUncommittedEdits ? null : JSON.stringify([
      this.editRuntime.documentRevision, this.host.getRoomTitle(), edges ?? null,
      editorState.selectedBackground, editorState.selectedLightingMode, editorState.selectedLightingDarkness,
      editorState.selectedLightingRadius, editorState.selectedWeatherMode, editorState.selectedWeatherIntensity,
    ]);
    const cached = this.clearCheckCache;
    if (
      zoomOnly && key !== null && cached?.key === key
      && getEditorDraftClearReceipt(cached.checklist.roomId) === cached.receipt
    ) return cached.checklist;
    const checklist = buildReadyToPublishChecklist(this.editRuntime.exportRoomSnapshot(), undefined, edges);
    this.clearCheckCache = key === null
      ? null
      : { key, receipt: getEditorDraftClearReceipt(checklist.roomId), checklist };
    return checklist;
  }

  private getSaveStatus(): EditorStatusDetails {
    const statusDetails = this.persistenceController.statusDetails;
    const candidate = statusDetails.text || statusDetails.accentText || statusDetails.linkLabel
      ? statusDetails : this.persistenceController.getIdleStatusDetails();
    if (!hasCryptoWallet() && /token|mint|NFT|wallet|on-chain|owner:|owned by|collect(?: room| & lock)/i.test(`${candidate.text} ${candidate.accentText}`)) {
      return { text: this.host.getRoomPermissions().canSaveDraft ? 'Room saved.' : 'This room is protected.',
        accentText: '', linkLabel: '', linkHref: null };
    }
    if (statusDetails.text || statusDetails.accentText || statusDetails.linkLabel) {
      return statusDetails;
    }

    return this.persistenceController.getIdleStatusDetails();
  }
}
